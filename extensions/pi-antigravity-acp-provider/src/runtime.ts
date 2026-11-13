import type {
	ContentBlock,
	InitializeResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionNotification,
} from "@agentclientprotocol/sdk/unstable";
import {
	collapseSystemMessages,
	getCurrentSystemPrompt,
	getCurrentTools,
	normalizeContext,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";

import {
	clearAntigravityCredentials,
	inspectAntigravityAuth,
	removeConversation,
	type AntigravityAuthHealth,
} from "./acp/antigravity.js";
import { AntigravityAcpConnection, type AntigravityConnectionHandlers, type AntigravityConnectionOptions } from "./acp/connection.js";
import { abortError, AntigravityAcpError, errorMessage } from "./acp/errors.js";
import {
	classifyEndTurnError,
	isConnectionClosedError,
	isRetryablePromptError,
	isWedgedSessionError,
	TurnOutputBuffer,
} from "./acp/turn-recovery.js";
import { AcpSessionStore } from "./acp/session-store.js";
import { sessionModels, sessionModes, type AcpModelInfo, type AcpNewSessionResponse, type SessionState } from "./acp/session-state.js";
import { parseUsageQuota, type AntigravityQuotaSnapshot } from "./acp/usage-quota.js";
import {
	MANAGED_AUTH_MARKER,
	PERMISSION_RESULT_KIND,
	PERMISSION_TOOL_NAME,
} from "./constants.js";
export { MANAGED_AUTH_MARKER, PERMISSION_RESULT_KIND, PERMISSION_TOOL_NAME } from "./constants.js";
import { mapSessionUpdate } from "./acp/events.js";
import { ensureAntigravityAcpReady } from "./acp/setup.js";
import { HeadlessOAuthRelay, shouldUseHeadlessOAuth } from "./acp/headless-oauth.js";
import {
	PiMcpBridge,
	piToolFingerprint,
	planToolProjection,
	type ToolOmission,
	type PiToolInvocation,
} from "./mcp/bridge.js";
import type { PermissionMode } from "./config.js";
import { resolveAcpModelId } from "./models.js";
import { type PromptParts, buildPromptParts, currentSystemInstructions } from "./stream/context.js";
import { PiEventWriter } from "./stream/pi-events.js";
import { usageFromPrompt } from "./stream/usage.js";
import { RuntimeMetrics } from "./status.js";

const PERMISSION_TIMEOUT_MS = 120_000;
const TOOL_BATCH_MS = 100;
const DEFAULT_QUOTA_CACHE_MS = 180_000;
const QUOTA_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAYS_MS = [500, 1_500];
const DEFAULT_PROACTIVE_ROLLOVER_TURNS = 30;
const DEFAULT_PROACTIVE_ROLLOVER_CONTEXT_RATIO = 0.85;

export interface AntigravityRuntimeOptions {
	retryDelaysMs?: number[];
	proactiveRolloverTurns?: number;
	proactiveRolloverContextRatio?: number;
	quotaCacheMs?: number;
}

type AntigravityModel = Model<"antigravity-acp">;

interface PendingPermission {
	id: string;
	request: RequestPermissionRequest;
	resolve: (response: RequestPermissionResponse) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface PendingPiTool {
	invocation: PiToolInvocation;
	/** Resolve the MCP request and release its bounded work-watchdog hold. */
	resolve: (result: CallToolResult) => void;
}

interface Binding {
	key: string;
	cwd: string;
	connection: AntigravityAcpConnection;
	initialize: InitializeResponse;
	session: AcpNewSessionResponse;
	mode: PermissionMode;
	instructionsFingerprint: string | undefined;
	needsReconstruction: boolean;
	modelId: string;
	messageCount: number;
	historyFingerprint: string;
	expectedAssistantFingerprint: string | undefined;
	pendingContextCount: number;
	pendingContextFingerprint: string;
	writer: PiEventWriter | undefined;
	turnBuffer: TurnOutputBuffer | undefined;
	permission: PendingPermission | undefined;
	pendingTools: Map<string, PendingPiTool>;
	/** Latest `usage_update.used` and the inference count of the running ACP prompt. */
	contextUsed: number | undefined;
	inferences: number;
	turnsInAcpSession: number;
	consecutiveTransportFailures: number;
	toolBatchTimer: ReturnType<typeof setTimeout> | undefined;
	bridge: PiMcpBridge | undefined;
	toolFingerprint: string;
	omittedTools: ToolOmission[];
	turnCompletion: Promise<void> | undefined;
	abortRequested: boolean;
	piSessionId: string | undefined;
	apiKey: string | undefined;
	quotaSessionIds: Set<string>;
	restored: boolean;
}

interface StandbyConnection {
	connection: AntigravityAcpConnection;
	initialize: InitializeResponse;
	apiKey: string | undefined;
	quotaSessionIds: Set<string>;
}

export interface PermissionView {
	id: string;
	title: string;
	options: Array<{ id: string; label: string; kind: string }>;
}

export interface ManualGoogleLoginInteraction {
	showAuthorizationUrl: (url: string, instructions: string) => void;
	promptForCallback: (signal: AbortSignal) => Promise<string>;
}

export interface PermissionToolResult {
	kind: typeof PERMISSION_RESULT_KIND;
	requestId: string;
	optionId?: string;
	cancelled: boolean;
}

export interface RuntimeSnapshot {
	bindings: number;
	permissionMode: PermissionMode;
	metrics: ReturnType<RuntimeMetrics["snapshot"]>;
	processes: Array<{
		key: string;
		pid?: number;
		generation: number;
		sessionId: string;
		modelId: string;
		confirmedPermissionMode: PermissionMode;
		omittedTools: ToolOmission[];
		alive: boolean;
		waitingForPermission: boolean;
		waitingForTools: number;
		agentVersion: string | undefined;
		mcpHttp: boolean;
		restored: boolean;
		ignoredStdoutNoiseLines: number;
		stderrTail?: string;
	}>;
}

export type AntigravityConnectionFactory = (options: AntigravityConnectionOptions) => AntigravityAcpConnection;

export class AntigravityRuntime {
	private readonly bindings = new Map<string, Promise<Binding>>();
	private readonly resolvedBindings = new Set<Binding>();
	private disposed = false;
	private closePromise: Promise<void> | undefined;
	private bindingEpoch = 0;
	private readonly activeConnections = new Set<AntigravityAcpConnection>();
	private readonly queues = new Map<string, Promise<void>>();
	private modeChanges = Promise.resolve();
	private standby: Promise<StandbyConnection> | undefined;
	private standbyQueue = Promise.resolve();
	private readonly quotaCollectors = new Map<string, (delta: string) => void>();

	private readonly connectionFactory: AntigravityConnectionFactory;
	private readonly ensureAgent: boolean;
	private readonly sessionStore: AcpSessionStore | undefined;
	private readonly metrics = new RuntimeMetrics();
	private permissionMode: PermissionMode;
	private readonly retryDelaysMs: number[];
	private readonly proactiveRolloverTurns: number;
	private readonly proactiveRolloverContextRatio: number;
	private readonly quotaCacheMs: number;
	private quotaCache: AntigravityQuotaSnapshot | undefined;
	private quotaInFlight: { epoch: number; snapshot: Promise<AntigravityQuotaSnapshot> } | undefined;

	constructor(
		connectionFactory?: AntigravityConnectionFactory,
		permissionMode: PermissionMode = "yolo",
		sessionStore?: AcpSessionStore,
		options: AntigravityRuntimeOptions = {},
	) {
		this.connectionFactory = connectionFactory ?? ((connectionOptions) => new AntigravityAcpConnection(connectionOptions));
		this.ensureAgent = connectionFactory === undefined;
		this.permissionMode = permissionMode;
		this.sessionStore = sessionStore ?? (this.ensureAgent ? new AcpSessionStore() : undefined);
		this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
		this.proactiveRolloverTurns = options.proactiveRolloverTurns ?? DEFAULT_PROACTIVE_ROLLOVER_TURNS;
		this.proactiveRolloverContextRatio = options.proactiveRolloverContextRatio ?? DEFAULT_PROACTIVE_ROLLOVER_CONTEXT_RATIO;
		this.quotaCacheMs = options.quotaCacheMs ?? DEFAULT_QUOTA_CACHE_MS;
	}

	/** Pre-warms a standby ACP process and runs handshake + auth off the critical path. */
	async prewarm(apiKey?: string): Promise<void> {
		if (this.disposed) return;
		const existing = this.standby;
		if (existing) {
			const settled = await existing.catch(() => undefined);
			if (settled && settled.connection.process.alive && normalizeAuthKey(settled.apiKey) === normalizeAuthKey(apiKey)) {
				return;
			}
			if (this.standby === existing) this.standby = undefined;
			if (settled) await settled.connection.close().catch(() => undefined);
		}
		if (this.disposed) return;
		const epoch = this.bindingEpoch;
		const created = (async (): Promise<StandbyConnection> => {
			if (this.ensureAgent) await ensureAntigravityAcpReady();
			this.assertEpoch(epoch);
			const connection = this.createConnection({
				cwd: process.cwd(),
				handlers: {
					onUpdate: ({ sessionId, update }) => {
						if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
							this.quotaCollectors.get(sessionId)?.(update.content.text);
						}
					},
					onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
				},
			});
			try {
				const initialize = await connection.initialize();
				this.assertEpoch(epoch);
				await authenticateForCredential(connection, initialize, apiKey);
				this.assertEpoch(epoch);
				const entry: StandbyConnection = {
					connection,
					initialize,
					apiKey,
					quotaSessionIds: new Set(),
				};
				void connection.process.exited.then(() => {
					if (this.standby === created) this.standby = undefined;
					for (const qid of entry.quotaSessionIds) removeConversation(qid);
					entry.quotaSessionIds.clear();
				}).catch(() => undefined);
				return entry;
			} catch (error) {
				await connection.close().catch(() => undefined);
				throw error;
			}
		})();
		this.standby = created;
		try {
			await created;
		} catch (error) {
			if (this.standby === created) this.standby = undefined;
			throw error;
		}
	}

	stream(model: AntigravityModel, context: Context, options: SimpleStreamOptions = {}): PiEventWriter {
		const writer = new PiEventWriter(model);
		// ACP has no mid-conversation system-message API. Replay Pi's prompt/tool
		// deltas into a checkpoint; its fingerprint invalidates stale warm sessions.
		try {
			const transcript = collapseSystemMessages(normalizeContext(context));
			const resolvedContext: Context = {
				messages: transcript.messages,
				systemPrompt: getCurrentSystemPrompt(transcript.messages),
				tools: getCurrentTools(transcript.messages),
			};
			currentSystemInstructions(resolvedContext);
			void this.runQueued(model, resolvedContext, options, writer).catch((error: unknown) => {
				writer.fail(error, options.signal?.aborted === true || isAbort(error));
			});
		} catch (error) {
			writer.fail(error, options.signal?.aborted === true || isAbort(error));
		}
		return writer;
	}

	async discoverModels(apiKey: string | undefined, signal?: AbortSignal): Promise<AcpModelInfo[]> {
		this.assertActive();
		const epoch = this.bindingEpoch;
		if (signal?.aborted) throw abortError();
		if (this.ensureAgent) await ensureAntigravityAcpReady();
		if (signal?.aborted) throw abortError();
		this.assertEpoch(epoch);
		const connection = this.createConnection({ cwd: process.cwd() });
		try {
			const initialize = await connection.initialize(signal);
			this.assertEpoch(epoch);
			await authenticateForCredential(connection, initialize, apiKey, signal);
			this.assertEpoch(epoch);
			const session = await connection.newSession(process.cwd(), signal);
			this.assertEpoch(epoch);
			return sessionModels(session)?.availableModels ?? [];
		} finally {
			await connection.close();
		}
	}

	/** Live quota from agy's own `/usage`, which answers without model inference. */
	async quota(apiKey: string | undefined, signal?: AbortSignal, force = false): Promise<AntigravityQuotaSnapshot> {
		this.assertActive();
		if (signal?.aborted) throw abortError();
		if (!force && this.quotaCache && Date.now() - this.quotaCache.at < this.quotaCacheMs) return this.quotaCache;
		const epoch = this.bindingEpoch;
		if (this.quotaInFlight?.epoch !== epoch) {
			const request = {
				epoch,
				snapshot: this.fetchQuota(apiKey)
					.then((snapshot) => {
						if (this.bindingEpoch === epoch) this.quotaCache = snapshot;
						return snapshot;
					})
					.finally(() => { if (this.quotaInFlight === request) this.quotaInFlight = undefined; }),
			};
			this.quotaInFlight = request;
		}
		const shared = this.quotaInFlight.snapshot;
		if (!signal) return shared;
		// One caller's abort must not cancel the request other callers share.
		return new Promise((resolve, reject) => {
			const onAbort = () => reject(abortError());
			signal.addEventListener("abort", onAbort, { once: true });
			shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
		});
	}

	private async fetchQuota(apiKey: string | undefined): Promise<AntigravityQuotaSnapshot> {
		this.assertActive();
		const epoch = this.bindingEpoch;
		const normalizedKey = normalizeAuthKey(apiKey);
		const idleBinding = [...this.resolvedBindings].find(
			(candidate) =>
				candidate.connection.process.alive &&
				!candidate.turnCompletion &&
				!candidate.permission &&
				candidate.pendingTools.size === 0 &&
				normalizeAuthKey(candidate.apiKey) === normalizedKey,
		);
		if (idleBinding) {
			return this.enqueueKey(idleBinding.key, async () => {
				this.assertEpoch(epoch);
				if (idleBinding.connection.process.alive) {
					return this.runQuotaQuery(idleBinding.connection, epoch, idleBinding.quotaSessionIds);
				}
				return this.fetchQuota(apiKey);
			});
		}

		const standbyPromise = this.standby;
		if (standbyPromise) {
			const standbyEntry = await standbyPromise.catch(() => undefined);
			this.assertEpoch(epoch);
			if (
				standbyEntry &&
				this.standby === standbyPromise &&
				standbyEntry.connection.process.alive &&
				normalizeAuthKey(standbyEntry.apiKey) === normalizedKey
			) {
				return this.enqueueStandby(async () => {
					this.assertEpoch(epoch);
					return this.runQuotaQuery(standbyEntry.connection, epoch, standbyEntry.quotaSessionIds);
				});
			}
		}

		// Fall back to a short-lived process when no warm pipeline is idle.
		if (this.ensureAgent) await ensureAntigravityAcpReady();
		this.assertEpoch(epoch);
		const ownedQuotaSessions = new Set<string>();
		const connection = this.createConnection({
			cwd: process.cwd(),
			promptIdleTimeoutMs: QUOTA_TIMEOUT_MS,
			handlers: {
				onUpdate: ({ sessionId, update }) => {
					if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
						this.quotaCollectors.get(sessionId)?.(update.content.text);
					}
				},
				onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			},
		});
		try {
			const initialize = await connection.initialize();
			this.assertEpoch(epoch);
			await authenticateForCredential(connection, initialize, apiKey);
			this.assertEpoch(epoch);
			return await this.runQuotaQuery(connection, epoch, ownedQuotaSessions);
		} finally {
			await connection.close();
			if (!connection.process.alive) {
				for (const qid of ownedQuotaSessions) removeConversation(qid);
			}
		}
	}

	private async runQuotaQuery(
		connection: AntigravityAcpConnection,
		epoch: number,
		quotaSessionIds: Set<string>,
	): Promise<AntigravityQuotaSnapshot> {
		let sessionId: string | undefined;
		let text = "";
		try {
			sessionId = (await connection.newSession(process.cwd())).sessionId;
			this.assertEpoch(epoch);
			quotaSessionIds.add(sessionId);
			this.quotaCollectors.set(sessionId, (delta) => {
				text += delta;
			});
			// agy answers a bare "/usage" text block itself: no model turn, no quota spent.
			await connection.prompt({ sessionId, prompt: [{ type: "text", text: "/usage" }] });
			return parseUsageQuota(text);
		} finally {
			if (sessionId) {
				this.quotaCollectors.delete(sessionId);
				if (process.platform !== "win32") removeConversation(sessionId);
			}
		}
	}

	private async enqueueKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(key) ?? Promise.resolve();
		let release!: () => void;
		const queue = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.queues.set(key, queue);
		await previous;
		try {
			return await fn();
		} finally {
			release();
			if (this.queues.get(key) === queue) this.queues.delete(key);
		}
	}

	private async enqueueStandby<T>(fn: () => Promise<T>): Promise<T> {
		const previous = this.standbyQueue;
		let release!: () => void;
		const queue = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.standbyQueue = queue;
		await previous;
		try {
			return await fn();
		} finally {
			release();
		}
	}

	async loginGoogle(
		signal?: AbortSignal,
		onProgress?: (message: string) => void,
		manualInteraction?: ManualGoogleLoginInteraction,
	): Promise<void> {
		this.assertActive();
		const epoch = this.bindingEpoch;
		if (this.ensureAgent) await ensureAntigravityAcpReady(onProgress);
		this.assertEpoch(epoch);
		const useManualOAuth = manualInteraction !== undefined && shouldUseHeadlessOAuth();
		const relay = useManualOAuth ? new HeadlessOAuthRelay() : undefined;
		const connection = this.createConnection({
			cwd: process.cwd(),
			...(relay ? { env: relay.env } : {}),
		});
		try {
			const initialize = await connection.initialize();
			this.assertEpoch(epoch);
			const method = initialize.authMethods?.find((candidate) =>
				/log\s*in\s+with\s+google|google\s+account|oauth-personal/iu.test(
					`${candidate.id} ${candidate.name}`,
				),
			);
			if (!method) throw new AntigravityAcpError("auth", "Antigravity ACP did not advertise Google login");
			const authentication = connection.authenticate(
				{ methodId: method.id },
				signal,
				relay ? 10 * 60_000 : undefined,
			);
			void authentication.catch(() => undefined);
			if (relay && manualInteraction) {
				const captured = await raceAuthentication(relay.waitForAuthorization(signal), authentication);
				if (captured.authenticated) {
					onProgress?.("Antigravity reused the saved Google login.");
				} else {
					const instructions =
						"Open this URL in a browser on your local machine. After Google redirects to localhost, the page may fail to load; copy the complete localhost URL from the browser address bar and paste it below.";
					manualInteraction.showAuthorizationUrl(captured.value.url, instructions);
					const promptController = new AbortController();
					let entered: Awaited<ReturnType<typeof raceAuthentication<string>>>;
					try {
						entered = await raceAuthentication(
							manualInteraction.promptForCallback(promptController.signal),
							authentication,
						);
					} catch (error) {
						promptController.abort();
						throw error;
					}
					if (entered.authenticated) {
						promptController.abort();
					} else {
						await relay.forwardCallback(entered.value, captured.value, signal);
					}
				}
			}
			await authentication;
			this.assertEpoch(epoch);
			await connection.newSession(process.cwd(), signal);
			this.assertEpoch(epoch);
		} finally {
			relay?.dispose();
			await connection.close();
		}
	}

	async verifyApiKey(
		apiKey: string,
		signal?: AbortSignal,
		onProgress?: (message: string) => void,
	): Promise<void> {
		this.assertActive();
		const epoch = this.bindingEpoch;
		if (this.ensureAgent) await ensureAntigravityAcpReady(onProgress);
		this.assertEpoch(epoch);
		const connection = this.createConnection({ cwd: process.cwd() });
		try {
			const initialize = await connection.initialize();
			this.assertEpoch(epoch);
			await authenticateForCredential(connection, initialize, apiKey, signal);
			this.assertEpoch(epoch);
			await connection.newSession(process.cwd(), signal);
			this.assertEpoch(epoch);
		} finally {
			await connection.close();
		}
	}

	async authHealth(apiKey?: string): Promise<AntigravityAuthHealth & { networkValid?: boolean; error?: string }> {
		const local = inspectAntigravityAuth();
		try {
			await this.discoverModels(apiKey ?? (hasUsableLocalAuth(local) ? MANAGED_AUTH_MARKER : undefined));
			return { ...local, networkValid: true };
		} catch (error) {
			return { ...local, networkValid: false, error: errorMessage(error) };
		}
	}

	async logout(): Promise<void> {
		await this.closeBindings();
		this.quotaCache = undefined;
		this.sessionStore?.clear();
		clearAntigravityCredentials();
	}

	setPermissionMode(mode: PermissionMode): Promise<void> {
		const change = this.modeChanges.then(async () => {
			this.assertActive();
			this.permissionMode = mode;
			await Promise.all([...this.resolvedBindings].map(async (binding) => {
				if (binding.mode === mode && this.confirmedMode(binding) === mode) return;
				// Never change policy under an executing turn or leave an unsupported session alive.
				if (!binding.turnCompletion && supportsMode(binding.connection.getSessionState(binding.session.sessionId), mode)) {
					try {
						await binding.connection.setMode(binding.session.sessionId, mode);
						if (this.confirmedMode(binding) === mode) { binding.mode = mode; return; }
					} catch { /* Close below; the next turn must negotiate again. */ }
				}
				await this.invalidateBinding(binding);
			}));
		});
		this.modeChanges = change.catch(() => undefined);
		return change;
	}

	getPermission(requestId: string): PermissionView | undefined {
		for (const binding of this.resolvedBindings) {
			if (binding.permission?.id === requestId) return permissionView(binding.permission);
		}
		return undefined;
	}

	async snapshot(includeStderr = false): Promise<RuntimeSnapshot> {
		const entries = [...this.bindings.entries()];
		const processes = await Promise.all(
			entries.map(async ([key, pending]) => {
				const binding = await pending;
				const pid = binding.connection.process.pid;
				return {
					key,
					...(pid === undefined ? {} : { pid }),
					generation: binding.connection.process.generation,
					sessionId: binding.session.sessionId,
					modelId: binding.modelId,
					confirmedPermissionMode: binding.mode,
					omittedTools: binding.omittedTools,
					alive: binding.connection.process.alive,
					waitingForPermission: binding.permission !== undefined,
					waitingForTools: binding.pendingTools.size,
					agentVersion: binding.initialize.agentInfo?.version,
					mcpHttp: binding.initialize.agentCapabilities?.mcpCapabilities?.http === true,
					restored: binding.restored,
					ignoredStdoutNoiseLines: binding.connection.process.ignoredStdoutNoiseLines,
					...(includeStderr ? { stderrTail: binding.connection.process.stderrTail } : {}),
				};
			}),
		);
		return {
			bindings: processes.length,
			permissionMode: this.permissionMode,
			metrics: this.metrics.snapshot(),
			processes,
		};
	}

	close(): Promise<void> {
		this.disposed = true;
		return this.closePromise ??= this.closeBindings();
	}

	/** Closes one Pi session's binding but keeps its saved record so a later turn can resume it. */
	async closeSession(piSessionId: string): Promise<void> {
		const key = `sid:${piSessionId}`;
		this.queues.delete(key);
		const binding = await this.bindings.get(key)?.catch(() => undefined);
		if (!binding) return;
		const completion = binding.turnCompletion;
		if (completion) {
			abortTurn(binding);
			void binding.connection.cancel(binding.session.sessionId).catch(() => undefined);
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([completion, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1_500); })]);
			clearTimeout(timer);
		}
		await this.dropBinding(key, binding, false);
	}

	private async closeBindings(): Promise<void> {
		this.bindingEpoch += 1;
		const pending = [...this.bindings.values()];
		const standby = this.standby;
		this.standby = undefined;
		this.bindings.clear();
		for (const binding of this.resolvedBindings) {
			cancelPermission(binding);
			cancelPiTools(binding, "Provider shut down before Pi returned the tool result");
		}
		this.resolvedBindings.clear();
		// Includes authentication/discovery and sessions still initializing, not just warm bindings.
		await Promise.allSettled([
			...[...this.activeConnections].map((connection) => connection.close()),
			...(standby
				? [standby.then((entry) => entry.connection.close()).catch(() => undefined)]
				: []),
		]);
		await Promise.allSettled(
			pending.map(async (binding) => {
				const value = await binding;
				await Promise.allSettled([
					value.connection.close(),
					value.bridge?.close() ?? Promise.resolve(),
				]);
			}),
		);
	}

	private async runQueued(
		model: AntigravityModel,
		context: Context,
		options: SimpleStreamOptions,
		writer: PiEventWriter,
	): Promise<void> {
		this.assertActive();
		const epoch = this.bindingEpoch;
		if (this.ensureAgent) await ensureAntigravityAcpReady();
		await this.modeChanges;
		this.assertEpoch(epoch);
		const persistent = Boolean(options.sessionId);
		const key = options.sessionId
			? `sid:${options.sessionId}`
			: (this.findContinuationKey(context) ?? `ephemeral:${crypto.randomUUID()}`);
		const tools = context.tools ?? [];
		const acpModelId = resolveAcpModelId(model, options.reasoning);
		let binding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);
		await this.modeChanges;
		this.assertEpoch(epoch);
		// Check before continuation early returns as well as before fresh prompts.
		if (binding.mode !== this.permissionMode || this.confirmedMode(binding) !== this.permissionMode ||
			binding.toolFingerprint !== piToolFingerprint(tools)) {
			await this.invalidateBinding(binding);
			binding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);
		}

		// A permission tool result resumes the still-running ACP prompt rather than
		// starting a second Antigravity turn.
		if (binding.permission) {
			const pending = binding.permission;
			const result = findPermissionResult(context, pending.id);
			if (!result) {
				cancelPermission(binding);
				await this.dropBinding(key, binding);
				binding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);
			} else {
				binding.writer = writer;
				binding.turnBuffer = new TurnOutputBuffer(writer);
				this.noteContinuationInstructions(binding, context);
				binding.pendingContextCount = context.messages.length;
				binding.pendingContextFingerprint = messagesFingerprint(context.messages);
				binding.permission = undefined;
				clearTimeout(pending.timer);
				if (
					!result.cancelled &&
					result.optionId &&
					pending.request.options.some((option) => option.optionId === result.optionId)
				) {
					pending.resolve({ outcome: { outcome: "selected", optionId: result.optionId } });
				} else {
					pending.resolve({ outcome: { outcome: "cancelled" } });
				}
				await this.awaitContinuation(binding, options.signal);
				return;
			}
		}

		if (binding.pendingTools.size > 0) {
			const results = [...binding.pendingTools.values()].map((pending) => ({
				pending,
				message: findToolResult(context, pending.invocation.id, pending.invocation.name),
			}));
			if (results.some((result) => result.message === undefined)) {
				cancelPiTools(binding, "Pi continued without returning every requested tool result");
				await this.dropBinding(key, binding);
				binding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);
			} else {
				binding.writer = writer;
				binding.turnBuffer = new TurnOutputBuffer(writer);
				this.noteContinuationInstructions(binding, context);
				binding.pendingContextCount = context.messages.length;
				binding.pendingContextFingerprint = messagesFingerprint(context.messages);
				for (const { pending, message } of results) {
					binding.pendingTools.delete(pending.invocation.id);
					pending.resolve(toMcpToolResult(message as ToolResultMessage));
				}
				await this.awaitContinuation(binding, options.signal);
				return;
			}
		}

		const previous = this.queues.get(key) ?? Promise.resolve();
		let release!: () => void;
		const queue = new Promise<void>((resolve) => { release = resolve; });
		this.queues.set(key, queue);
		await previous;

		try {
			await this.modeChanges;
			this.assertEpoch(epoch);
			// A queued caller may hold an obsolete binding after shutdown/mode changes.
			binding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);
			if (
				binding.needsReconstruction || binding.mode !== this.permissionMode ||
				this.confirmedMode(binding) !== this.permissionMode ||
				binding.toolFingerprint !== piToolFingerprint(tools) ||
				context.messages.length < binding.messageCount ||
				messagesFingerprint(context.messages.slice(0, binding.messageCount)) !==
					binding.historyFingerprint
			) {
				await this.dropBinding(key, binding, true);
				binding = await this.getBinding(key, model, acpModelId, options.apiKey, writer, tools, options.signal);
			} else if (this.shouldProactivelyRollover(binding, model, context)) {
				binding = await this.rolloverBinding(key, binding, model, acpModelId, writer, tools, options.signal);
			}
			binding = await this.executeTurnWithRecovery(
				key,
				binding,
				epoch,
				model,
				acpModelId,
				context,
				tools,
				writer,
				options,
			);
		} catch (error) {
			binding.writer?.fail(error, isAbort(error));
			if (isAbort(error) || binding.abortRequested) abortTurn(binding);
			if (!binding.connection.process.alive) await this.dropBinding(key, binding);
			throw error;
		} finally {
			binding.turnCompletion = undefined;
			binding.abortRequested = false;
			binding.writer = undefined;
			binding.turnBuffer = undefined;
			release();
			if (this.queues.get(key) === queue) this.queues.delete(key);
			if (!persistent) await this.dropBinding(key, binding);
		}
	}

	private shouldProactivelyRollover(binding: Binding, model: AntigravityModel, context: Context): boolean {
		if (binding.messageCount === 0 || hasTrailingToolResults(context)) return false;
		if (this.proactiveRolloverTurns > 0 && binding.turnsInAcpSession >= this.proactiveRolloverTurns) {
			return true;
		}
		if (
			this.proactiveRolloverContextRatio > 0 &&
			model.contextWindow > 0 &&
			binding.contextUsed !== undefined &&
			binding.contextUsed >= Math.floor(model.contextWindow * this.proactiveRolloverContextRatio)
		) {
			return true;
		}
		return false;
	}

	private async rolloverBinding(
		key: string,
		binding: Binding,
		model: AntigravityModel,
		acpModelId: string,
		writer: PiEventWriter,
		tools: NonNullable<Context["tools"]>,
		signal?: AbortSignal,
		forceProcessReplace = false,
	): Promise<Binding> {
		if (binding.piSessionId) this.sessionStore?.remove(binding.piSessionId);
		if (!forceProcessReplace && binding.connection.process.alive) {
			try {
				const mcpServer = binding.bridge ? await binding.bridge.start() : undefined;
				const mcpServers = mcpServer ? [mcpServer] : [];
				const session = await binding.connection.newSession(binding.cwd, signal, mcpServers);
				const mode = this.permissionMode;
				if (!supportsMode(session, mode)) {
					throw new AntigravityAcpError(
						"protocol",
						`Antigravity rolled-over session did not advertise permission mode '${mode}'; refusing to prompt`,
					);
				}
				if (sessionModes(session)?.currentModeId !== mode) {
					await binding.connection.setMode(session.sessionId, mode, signal);
				}
				if (sessionModes(binding.connection.getSessionState(session.sessionId))?.currentModeId !== mode) {
					throw new AntigravityAcpError("protocol", "Antigravity did not confirm the requested permission mode");
				}
				if (sessionModels(session)?.currentModelId !== acpModelId) {
					await binding.connection.setModel(session.sessionId, acpModelId, signal);
				}
				binding.session = session;
				binding.mode = mode;
				binding.modelId = acpModelId;
				binding.instructionsFingerprint = undefined;
				binding.needsReconstruction = false;
				binding.messageCount = 0;
				binding.historyFingerprint = messagesFingerprint([]);
				binding.expectedAssistantFingerprint = undefined;
				binding.pendingContextCount = 0;
				binding.pendingContextFingerprint = messagesFingerprint([]);
				binding.contextUsed = undefined;
				binding.inferences = 0;
				binding.turnsInAcpSession = 0;
				binding.consecutiveTransportFailures = 0;
				binding.restored = false;
				return binding;
			} catch (error) {
				if (isAbort(error) || signal?.aborted) throw error;
				// Fall through to full process replacement if in-process session/new failed.
			}
		}
		await this.dropBinding(key, binding, true);
		return this.getBinding(key, model, acpModelId, binding.apiKey, writer, tools, signal);
	}

	private async executeTurnWithRecovery(
		key: string,
		initialBinding: Binding,
		epoch: number,
		model: AntigravityModel,
		acpModelId: string,
		context: Context,
		tools: NonNullable<Context["tools"]>,
		writer: PiEventWriter,
		options: SimpleStreamOptions,
	): Promise<Binding> {
		let binding = initialBinding;
		const maxRetries = this.retryDelaysMs.length;
		for (let attempt = 0; ; attempt += 1) {
			await this.modeChanges;
			this.assertEpoch(epoch);
			if (binding.mode !== this.permissionMode || this.confirmedMode(binding) !== this.permissionMode) {
				await this.invalidateBinding(binding);
				throw new AntigravityAcpError("protocol", "Permission mode changed before prompting; retry the turn");
			}
			if (!binding.connection.process.alive) {
				binding = await this.rolloverBinding(key, binding, model, acpModelId, writer, tools, options.signal);
			}
			binding.writer = writer;
			const turnBuffer = new TurnOutputBuffer(writer);
			binding.turnBuffer = turnBuffer;

			if (binding.modelId !== acpModelId) {
				try {
					await binding.connection.setModel(binding.session.sessionId, acpModelId, options.signal);
					binding.modelId = acpModelId;
				} catch (error) {
					await this.invalidateBinding(binding);
					throw error;
				}
			}

			const fresh = binding.messageCount === 0;
			let unseenStart = binding.messageCount;
			const expected = context.messages[unseenStart];
			if (
				!fresh &&
				expected?.role === "assistant" &&
				binding.expectedAssistantFingerprint === messageFingerprint(expected)
			) {
				unseenStart += 1;
			}
			const parts = adaptPromptToCapabilities(
				buildPromptParts(context, fresh, unseenStart),
				binding.initialize,
			);

			binding.instructionsFingerprint = instructionFingerprint(context);
			binding.needsReconstruction = false;
			binding.pendingContextCount = context.messages.length;
			binding.pendingContextFingerprint = messagesFingerprint(context.messages);
			binding.contextUsed = undefined;
			binding.inferences = 0;

			let completeTurn: (() => void) | undefined;
			let onTurnAbort: (() => void) | undefined;
			binding.turnCompletion = new Promise<void>((resolve) => {
				completeTurn = resolve;
			});
			if (options.signal) {
				const promptBinding = binding;
				onTurnAbort = () => abortTurn(promptBinding);
				options.signal.addEventListener("abort", onTurnAbort, { once: true });
				if (options.signal.aborted) onTurnAbort();
			}

			let response: Awaited<ReturnType<AntigravityAcpConnection["prompt"]>>;
			try {
				response = await binding.connection.prompt(
					{ sessionId: binding.session.sessionId, prompt: parts.prompt },
					options.signal,
				);
			} catch (error) {
				if (onTurnAbort) options.signal?.removeEventListener("abort", onTurnAbort);
				completeTurn?.();
				binding.turnCompletion = undefined;

				if (isAbort(error) || binding.abortRequested) throw error;
				const nonRetryableCode = error instanceof AntigravityAcpError &&
					(error.code === "auth" || error.code === "quota" || error.code === "invalid_input");
				const canRecover =
					!nonRetryableCode &&
					!turnBuffer.hasCommittedOutput &&
					attempt < maxRetries &&
					(isRetryablePromptError(error) || isWedgedSessionError(error) || !binding.connection.process.alive);
				if (!canRecover) throw error;

				binding.consecutiveTransportFailures += 1;
				const closed = !binding.connection.process.alive || isConnectionClosedError(error);
				if (closed || isWedgedSessionError(error) || binding.consecutiveTransportFailures >= 2) {
					binding = await this.rolloverBinding(
						key,
						binding,
						model,
						acpModelId,
						writer,
						tools,
						options.signal,
						closed,
					);
				}
				await sleepWithAbort(this.retryDelaysMs[attempt]!, options.signal);
				continue;
			}

			if (onTurnAbort) options.signal?.removeEventListener("abort", onTurnAbort);
			completeTurn?.();
			binding.turnCompletion = undefined;

			const activeWriter = binding.writer ?? writer;
			const activeBuffer = binding.turnBuffer ?? turnBuffer;
			if (binding.abortRequested) throw abortError();
			const usage = usageFromPrompt(response);
			this.metrics.record(response, usage);

			const endTurnError = classifyEndTurnError(
				activeBuffer.rawText,
				usage.totalTokens,
				response.stopReason,
				activeBuffer.toolCallsCount,
				binding.modelId,
			);
			if (endTurnError) {
				if (!endTurnError.retryable) {
					throw endTurnError.error;
				}
				binding.consecutiveTransportFailures += 1;
				if (!activeBuffer.hasCommittedOutput && attempt < maxRetries) {
					if (
						!binding.connection.process.alive ||
						endTurnError.wedged ||
						binding.consecutiveTransportFailures >= 2
					) {
						binding = await this.rolloverBinding(key, binding, model, acpModelId, writer, tools, options.signal);
					}
					await sleepWithAbort(this.retryDelaysMs[attempt]!, options.signal);
					continue;
				}
				throw endTurnError.error;
			}

			activeBuffer.flushText();
			binding.consecutiveTransportFailures = 0;
			binding.turnsInAcpSession += 1;
			if (binding.contextUsed !== undefined) {
				// Pi sizes the context from the last message's totalTokens, but the response sums every
				// inference. agy adds cache reads to `used` twice; with one inference the response's cache
				// count is that inference's, so subtracting it is exact. Longer prompts with cache reads
				// still overcount by the last inference's cached tokens.
				activeWriter.message.usage = {
					...usage,
					totalTokens: binding.inferences === 1 ? Math.max(0, binding.contextUsed - usage.cacheRead) : binding.contextUsed,
				};
			} else activeWriter.message.usage = usage;
			activeWriter.message.rawStopReason = response.stopReason;
			binding.messageCount = binding.pendingContextCount || parts.messageCount;
			binding.historyFingerprint = binding.pendingContextFingerprint;
			binding.expectedAssistantFingerprint = messageFingerprint(activeWriter.message);
			this.persistBinding(binding);
			switch (response.stopReason) {
				case "cancelled":
					throw abortError();
				case "max_tokens":
				case "max_turn_requests":
					activeWriter.done("length");
					break;
				default:
					activeWriter.done("stop");
			}
			return binding;
		}
	}

	private async awaitContinuation(binding: Binding, signal?: AbortSignal): Promise<void> {
		const completion = binding.turnCompletion;
		if (!completion) return;
		if (!signal) {
			await completion;
			return;
		}
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const abort = () => {
			if (binding.turnCompletion !== completion || binding.abortRequested) return;
			abortTurn(binding);
			void binding.connection.cancel(binding.session.sessionId).catch(() => undefined);
			killTimer = setTimeout(() => {
				if (binding.turnCompletion === completion) void binding.connection.close();
			}, 1_500);
		};
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
		try {
			await completion;
		} finally {
			signal.removeEventListener("abort", abort);
			if (killTimer) clearTimeout(killTimer);
		}
	}

	private findContinuationKey(context: Context): string | undefined {
		for (const binding of this.resolvedBindings) {
			if (binding.permission && findPermissionResult(context, binding.permission.id)) return binding.key;
			if (
				binding.pendingTools.size > 0 &&
				[...binding.pendingTools.values()].every((pending) =>
					findToolResult(context, pending.invocation.id, pending.invocation.name),
				)
			) {
				return binding.key;
			}
		}
		return undefined;
	}

	private async getBinding(
		key: string,
		model: AntigravityModel,
		acpModelId: string,
		apiKey: string | undefined,
		writer: PiEventWriter,
		tools: Context["tools"],
		signal?: AbortSignal,
	): Promise<Binding> {
		this.assertActive();
		const existing = this.bindings.get(key);
		if (existing) return existing;
		const created = this.createBinding(key, model, acpModelId, apiKey, writer, tools ?? [], signal).catch((error) => {
			if (this.bindings.get(key) === created) this.bindings.delete(key);
			throw error;
		});
		this.bindings.set(key, created);
		return created;
	}

	private async acquireConnection(
		apiKey: string | undefined,
		cwd: string,
		handlers: AntigravityConnectionHandlers,
		epoch: number,
		signal?: AbortSignal,
	): Promise<{
		connection: AntigravityAcpConnection;
		initialize: InitializeResponse;
		quotaSessionIds: Set<string>;
	}> {
		const pendingStandby = this.standby;
		if (pendingStandby) {
			this.standby = undefined;
			await this.standbyQueue.catch(() => undefined);
			const entry = await pendingStandby.catch(() => undefined);
			this.assertEpoch(epoch);
			if (entry && entry.connection.process.alive && normalizeAuthKey(entry.apiKey) === normalizeAuthKey(apiKey)) {
				entry.connection.setHandlers(handlers);
				return {
					connection: entry.connection,
					initialize: entry.initialize,
					quotaSessionIds: entry.quotaSessionIds,
				};
			}
			if (entry) await entry.connection.close().catch(() => undefined);
		}
		const connection = this.createConnection({ cwd, handlers });
		try {
			const initialize = await connection.initialize(signal);
			this.assertEpoch(epoch);
			await authenticateForCredential(connection, initialize, apiKey, signal);
			this.assertEpoch(epoch);
			return { connection, initialize, quotaSessionIds: new Set<string>() };
		} catch (error) {
			await connection.close().catch(() => undefined);
			throw error;
		}
	}

	private async createBinding(
		key: string,
		model: AntigravityModel,
		acpModelId: string,
		apiKey: string | undefined,
		writer: PiEventWriter,
		tools: NonNullable<Context["tools"]>,
		signal?: AbortSignal,
	): Promise<Binding> {
		const cwd = process.cwd();
		let binding: Binding | undefined;
		let bridge: PiMcpBridge | undefined;
		const epoch = this.bindingEpoch;
		const handlers: AntigravityConnectionHandlers = {
			onUpdate: (notification) => this.consumeUpdate(binding, notification),
			onPermission: (request) => this.requestPermission(binding, request),
		};
		const { connection, initialize, quotaSessionIds } = await this.acquireConnection(apiKey, cwd, handlers, epoch, signal);
		try {
			const omittedTools = initialize.agentCapabilities?.mcpCapabilities?.http === true
				? planToolProjection(tools)
				: tools.filter((tool) => tool.name !== PERMISSION_TOOL_NAME).map((tool) => ({ name: tool.name, reason: "Agent did not advertise MCP over HTTP" }));
			let mcpServer;
			if (tools.length > 0 && initialize.agentCapabilities?.mcpCapabilities?.http === true) {
				bridge = new PiMcpBridge({
					tools,
					onCall: (invocation) => this.requestPiTool(binding, invocation),
				});
				mcpServer = await bridge.start();
			}
			const mcpServers = mcpServer ? [mcpServer] : [];
			const piSessionId = key.startsWith("sid:") ? key.slice(4) : undefined;
			const saved = piSessionId ? this.sessionStore?.get(piSessionId) : undefined;
			let session: AcpNewSessionResponse | undefined;
			let restored = false;
			if (saved?.cwd === cwd) {
				if (initialize.agentCapabilities?.sessionCapabilities?.resume) {
					try {
						const resumed = await connection.resumeSession(saved.acpSessionId, cwd, mcpServers, signal);
						session = { sessionId: saved.acpSessionId, ...resumed };
						restored = true;
					} catch {
						// Some Antigravity builds advertise the draft method before implementing it.
					}
				}
				if (!session && initialize.agentCapabilities?.loadSession === true) {
					try {
						const loaded = await connection.loadSession(saved.acpSessionId, cwd, mcpServers, signal);
						session = { sessionId: saved.acpSessionId, ...loaded };
						restored = true;
					} catch {
						this.sessionStore?.remove(saved.piSessionId);
					}
				}
			}
			session ??= await connection.newSession(cwd, signal, mcpServers);
			this.assertEpoch(epoch);
			const mode = this.permissionMode;
			if (!supportsMode(session, mode)) {
				if (piSessionId) this.sessionStore?.remove(piSessionId);
				throw new AntigravityAcpError("protocol", `Antigravity ${restored ? "restored" : "new"} session did not advertise permission mode '${mode}'; refusing to prompt`);
			}
			if (sessionModes(session)?.currentModeId !== mode) await connection.setMode(session.sessionId, mode, signal);
			if (sessionModes(connection.getSessionState(session.sessionId))?.currentModeId !== mode) {
				throw new AntigravityAcpError("protocol", "Antigravity did not confirm the requested permission mode");
			}
			const currentModel = sessionModels(session)?.currentModelId;
			if (currentModel !== acpModelId) await connection.setModel(session.sessionId, acpModelId, signal);
			this.assertEpoch(epoch);
			if (mode !== this.permissionMode) throw new AntigravityAcpError("protocol", "Permission mode changed during session setup; retry the turn");
			const createdBinding: Binding = {
				key,
				cwd,
				connection,
				initialize,
				session,
				mode,
				instructionsFingerprint: undefined,
				needsReconstruction: false,
				modelId: acpModelId,
				messageCount: restored && saved ? saved.messageCount : 0,
				historyFingerprint: restored && saved ? saved.historyFingerprint : messagesFingerprint([]),
				expectedAssistantFingerprint: restored ? saved?.expectedAssistantFingerprint : undefined,
				pendingContextCount: 0,
				pendingContextFingerprint: messagesFingerprint([]),
				writer,
				turnBuffer: undefined,
				permission: undefined,
				pendingTools: new Map(),
				contextUsed: undefined,
				inferences: 0,
				turnsInAcpSession: 0,
				consecutiveTransportFailures: 0,
				toolBatchTimer: undefined,
				bridge,
				toolFingerprint: piToolFingerprint(tools),
				omittedTools,
				turnCompletion: undefined,
				abortRequested: false,
				piSessionId,
				apiKey,
				quotaSessionIds,
				restored,
			};
			binding = createdBinding;
			this.persistBinding(createdBinding);
			this.resolvedBindings.add(createdBinding);
			void connection.process.exited.then(() => {
				cancelPermission(createdBinding);
				cancelPiTools(createdBinding, "Antigravity process exited before Pi returned the tool result");
				this.resolvedBindings.delete(createdBinding);
				for (const qid of createdBinding.quotaSessionIds) removeConversation(qid);
				createdBinding.quotaSessionIds.clear();
				void bridge?.close().catch(() => undefined);
				const current = this.bindings.get(key);
				if (current) void current.then((value) => {
					if (value === createdBinding && this.bindings.get(key) === current) this.bindings.delete(key);
				}).catch(() => undefined);
			}).catch(() => undefined);
			return createdBinding;
		} catch (error) {
			await Promise.allSettled([connection.close(), bridge?.close() ?? Promise.resolve()]);
			throw error;
		}
	}

	private persistBinding(binding: Binding): void {
		if (!binding.piSessionId) return;
		if (binding.needsReconstruction) { this.sessionStore?.remove(binding.piSessionId); return; }
		this.sessionStore?.save({
			piSessionId: binding.piSessionId,
			acpSessionId: binding.session.sessionId,
			acpModelId: binding.modelId,
			cwd: binding.cwd,
			messageCount: binding.messageCount,
			historyFingerprint: binding.historyFingerprint,
			...(binding.expectedAssistantFingerprint
				? { expectedAssistantFingerprint: binding.expectedAssistantFingerprint }
				: {}),
			lastActive: Date.now(),
		});
	}

	private requestPiTool(
		binding: Binding | undefined,
		invocation: PiToolInvocation,
	): Promise<CallToolResult> {
		if (!binding?.writer || binding.writer.finished || binding.permission || binding.abortRequested) {
			return Promise.resolve({
				content: [{ type: "text", text: "Pi cannot accept this tool call in the current turn" }],
				isError: true,
			});
		}
		return new Promise<CallToolResult>((resolve) => {
			let release: (() => void) | undefined;
			try {
				release = binding.connection.holdPromptWatchdog(binding.session.sessionId);
				const held = release;
				binding.pendingTools.set(invocation.id, { invocation, resolve: (result) => { held(); resolve(result); } });
				binding.turnBuffer?.markToolCall();
				binding.writer?.toolCall(invocation.id, invocation.name, invocation.arguments);
				if (binding.toolBatchTimer) clearTimeout(binding.toolBatchTimer);
				binding.toolBatchTimer = setTimeout(() => {
					binding.toolBatchTimer = undefined;
					binding.writer?.done("toolUse");
				}, TOOL_BATCH_MS);
				binding.toolBatchTimer.unref();
			} catch {
				binding.pendingTools.delete(invocation.id);
				release?.();
				resolve({ content: [{ type: "text", text: "Pi could not accept the tool call" }], isError: true });
			}
		});
	}

	private requestPermission(
		binding: Binding | undefined,
		request: RequestPermissionRequest,
	): Promise<RequestPermissionResponse> {
		if (!binding?.writer || binding.writer.finished || binding.permission || binding.abortRequested || request.sessionId !== binding.session.sessionId) {
			return Promise.resolve({ outcome: { outcome: "cancelled" } });
		}
		const id = crypto.randomUUID();
		return new Promise<RequestPermissionResponse>((resolve) => {
			const timer = setTimeout(() => {
				if (binding.permission?.id !== id) return;
				binding.permission = undefined;
				resolve({ outcome: { outcome: "cancelled" } });
			}, PERMISSION_TIMEOUT_MS);
			timer.unref();
			binding.permission = { id, request, resolve, timer };
			try {
				binding.turnBuffer?.markToolCall();
				binding.writer?.toolCall(id, PERMISSION_TOOL_NAME, { requestId: id });
				binding.writer?.done("toolUse");
			} catch {
				clearTimeout(timer);
				if (binding.permission?.id === id) binding.permission = undefined;
				resolve({ outcome: { outcome: "cancelled" } });
			}
		});
	}

	private consumeUpdate(binding: Binding | undefined, notification: SessionNotification): void {
		if (notification.update.sessionUpdate === "agent_message_chunk" && notification.update.content.type === "text") {
			const quotaCollector = this.quotaCollectors.get(notification.sessionId);
			if (quotaCollector) {
				quotaCollector(notification.update.content.text);
				return;
			}
		}
		if (!binding || notification.sessionId !== binding.session.sessionId) return;
		if ((notification.update.sessionUpdate === "config_option_update" || notification.update.sessionUpdate === "current_mode_update") &&
			this.confirmedMode(binding) !== this.permissionMode) {
			binding.writer?.fail(new AntigravityAcpError("protocol", "Antigravity changed the permission mode unexpectedly; session closed"), false);
			void this.invalidateBinding(binding).catch(() => undefined);
			return;
		}
		if (!binding.writer) return;
		const turnBuffer = binding.turnBuffer;
		for (const activity of mapSessionUpdate(notification)) {
			if (activity.type === "text") {
				if (turnBuffer) turnBuffer.text(activity.delta);
				else binding.writer.text(activity.delta);
			} else if (activity.type === "thought") {
				if (turnBuffer) turnBuffer.thinking(activity.delta);
				else binding.writer.thinking(activity.delta);
			} else if (activity.type === "plan") {
				if (turnBuffer) turnBuffer.plan(activity.summary, activity.text);
				else binding.writer.thinking(activity.text);
			} else if (activity.type === "tool") {
				if (turnBuffer) turnBuffer.toolActivity(activity.summary, activity.text);
				else binding.writer.thinking(activity.text);
			} else if (activity.type === "usage") {
				binding.contextUsed = activity.used;
				binding.inferences += 1;
				if (!binding.writer.finished) binding.writer.message.usage.totalTokens = activity.used;
			}
		}
	}

	private async dropBinding(key: string, binding: Binding, removeSaved = false): Promise<void> {
		const current = this.bindings.get(key);
		if (current && (await current) === binding && this.bindings.get(key) === current) {
			if (removeSaved && binding.piSessionId) this.sessionStore?.remove(binding.piSessionId);
			this.bindings.delete(key);
		}
		this.resolvedBindings.delete(binding);
		cancelPermission(binding);
		cancelPiTools(binding, "Antigravity session closed before Pi returned the tool result");
		await Promise.allSettled([binding.connection.close(), binding.bridge?.close() ?? Promise.resolve()]);
	}

	private confirmedMode(binding: Binding): string | undefined {
		return sessionModes(binding.connection.getSessionState(binding.session.sessionId))?.currentModeId;
	}

	private noteContinuationInstructions(binding: Binding, context: Context): void {
		if (binding.instructionsFingerprint !== instructionFingerprint(context)) {
			// ACP has no system-update RPC. Finish this immutable prompt, then rebuild;
			// do not persist a fingerprint claiming the new instructions reached ACP.
			binding.needsReconstruction = true;
			if (binding.piSessionId) this.sessionStore?.remove(binding.piSessionId);
		}
	}

	private async invalidateBinding(binding: Binding): Promise<void> {
		if (binding.turnCompletion) abortTurn(binding);
		await this.dropBinding(binding.key, binding, true);
	}

	private createConnection(options: AntigravityConnectionOptions): AntigravityAcpConnection {
		this.assertActive();
		const connection = this.connectionFactory(options);
		this.activeConnections.add(connection);
		void connection.process.exited.then(() => this.activeConnections.delete(connection)).catch(() => undefined);
		return connection;
	}

	private assertEpoch(epoch: number): void {
		this.assertActive();
		if (epoch !== this.bindingEpoch) throw new AntigravityAcpError("process_exit", "Antigravity session was closed during setup");
	}

	private assertActive(): void {
		if (this.disposed) throw new AntigravityAcpError("process_exit", "Antigravity ACP runtime is closed");
	}
}

async function authenticateForCredential(
	connection: AntigravityAcpConnection,
	initialize: InitializeResponse,
	apiKey: string | undefined,
	signal?: AbortSignal,
): Promise<void> {
	if (!apiKey || apiKey === MANAGED_AUTH_MARKER) return;
	const method = initialize.authMethods?.find((candidate) => {
		const meta = candidate._meta as Record<string, unknown> | null | undefined;
		return "api-key" in (meta ?? {}) || /api key/iu.test(candidate.name);
	});
	if (!method) throw new AntigravityAcpError("auth", "Antigravity ACP did not advertise API-key authentication");
	await connection.authenticate({ methodId: method.id, _meta: { "api-key": apiKey } }, signal);
}

function adaptPromptToCapabilities(parts: PromptParts, initialize: InitializeResponse): PromptParts {
	const capabilities = initialize.agentCapabilities?.promptCapabilities;
	const output: ContentBlock[] = [];
	for (const block of parts.prompt) {
		if (block.type === "image" && capabilities?.image !== true) {
			throw new AntigravityAcpError("invalid_input", "This Antigravity ACP runtime did not advertise image input");
		}
		if (block.type === "resource" && capabilities?.embeddedContext !== true) {
			const resource = block.resource;
			if ("text" in resource) output.push({ type: "text", text: resource.text });
			continue;
		}
		output.push(block);
	}
	return { ...parts, prompt: output };
}

function hasUsableLocalAuth(health: AntigravityAuthHealth): boolean {
	return health.status === "api-key-env" || health.status === "oauth-refreshable";
}

function supportsMode(session: SessionState, mode: PermissionMode): boolean {
	return sessionModes(session)?.availableModes.some((candidate) => candidate.id === mode) === true;
}

function permissionView(permission: PendingPermission): PermissionView {
	const call = permission.request.toolCall;
	const details = {
		kind: call.kind,
		locations: call.locations,
		content: call.content,
		rawInput: call.rawInput,
	};
	const visibleDetails = JSON.stringify(details, null, 2).slice(0, 8_000);
	return {
		id: permission.id,
		title: `${call.title ?? "Antigravity requests permission"}\n\n${visibleDetails}`,
		options: permission.request.options.map((option) => ({
			id: option.optionId,
			label: option.name,
			kind: option.kind,
		})),
	};
}

function findPermissionResult(context: Context, requestId: string): PermissionToolResult | undefined {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (
			message?.role !== "toolResult" ||
			message.toolName !== PERMISSION_TOOL_NAME ||
			message.toolCallId !== requestId
		) {
			continue;
		}
		const details = message.details as Partial<PermissionToolResult> | undefined;
		if (
			details?.kind === PERMISSION_RESULT_KIND &&
			details.requestId === requestId &&
			typeof details.cancelled === "boolean"
		) {
			return details as PermissionToolResult;
		}
		// A missing/disabled tool or malformed output is an immediate denial,
		// never an implicit approval and never a hung ACP request.
		return {
			kind: PERMISSION_RESULT_KIND,
			requestId,
			cancelled: true,
		};
	}
	return undefined;
}

function messagesFingerprint(messages: Context["messages"]): string {
	const fingerprints = messages.map(messageFingerprint);
	return createHash("sha256").update(fingerprints.join("\n")).digest("hex");
}

function messageFingerprint(message: Context["messages"][number]): string {
	let value: unknown;
	if (message.role === "user") {
		value = { role: message.role, content: message.content };
	} else if (message.role === "assistant") {
		value = {
			role: message.role,
			provider: message.provider,
			model: message.model,
			content: message.content,
		};
	} else if (message.role === "system") {
		value = {
			role: message.role,
			content: message.content,
			sections: message.sections,
			toolsAdded: message.toolsAdded,
			toolsRemoved: message.toolsRemoved,
		};
	} else {
		value = {
			role: message.role,
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: message.content,
			isError: message.isError,
		};
	}
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, child]) => child !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function findToolResult(
	context: Context,
	toolCallId: string,
	toolName: string,
): ToolResultMessage | undefined {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (
			message?.role === "toolResult" &&
			message.toolCallId === toolCallId &&
			message.toolName === toolName
		) {
			return message;
		}
	}
	return undefined;
}

function toMcpToolResult(message: ToolResultMessage): CallToolResult {
	return {
		content: message.content.map((block) =>
			block.type === "text"
				? { type: "text" as const, text: block.text }
				: { type: "image" as const, data: block.data, mimeType: block.mimeType },
		),
		isError: message.isError,
	};
}

function cancelPermission(binding: Binding): void {
	if (!binding.permission) return;
	clearTimeout(binding.permission.timer);
	binding.permission.resolve({ outcome: { outcome: "cancelled" } });
	binding.permission = undefined;
}

function instructionFingerprint(context: Context): string {
	return createHash("sha256").update(currentSystemInstructions(context)).digest("hex");
}

function abortTurn(binding: Binding): void {
	binding.abortRequested = true;
	cancelPermission(binding);
	cancelPiTools(binding, "Pi turn was aborted before returning the tool result");
}

function cancelPiTools(binding: Binding, reason: string): void {
	if (binding.toolBatchTimer) clearTimeout(binding.toolBatchTimer);
	binding.toolBatchTimer = undefined;
	for (const pending of binding.pendingTools.values()) {
		pending.resolve({ content: [{ type: "text", text: reason }], isError: true });
	}
	binding.pendingTools.clear();
}

async function raceAuthentication<T>(
	step: Promise<T>,
	authentication: Promise<void>,
): Promise<{ authenticated: true } | { authenticated: false; value: T }> {
	return Promise.race([
		step.then((value) => ({ authenticated: false as const, value })),
		authentication.then(() => ({ authenticated: true as const })),
	]);
}

function isAbort(error: unknown): boolean {
	return error instanceof AntigravityAcpError
		? error.code === "aborted"
		: error instanceof DOMException && error.name === "AbortError";
}

function normalizeAuthKey(apiKey: string | undefined): string {
	return !apiKey || apiKey === MANAGED_AUTH_MARKER ? "" : apiKey;
}

function hasTrailingToolResults(context: Context): boolean {
	for (let index = context.messages.length - 1; index >= 0; index -= 1) {
		const role = context.messages[index]?.role;
		if (role === "system") continue;
		return role === "toolResult";
	}
	return false;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		timer.unref?.();
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
