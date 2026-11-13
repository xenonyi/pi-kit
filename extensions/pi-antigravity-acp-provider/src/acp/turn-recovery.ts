import { AntigravityAcpError, errorMessage } from "./errors.js";
import { quotaExhaustion } from "./quota.js";
import type { PiEventWriter } from "../stream/pi-events.js";

const MAX_BUFFER_CHARS = 512;
const MAX_ERROR_TEXT_CHARS = 500;

const ERROR_PREFIX_CANDIDATES = [
	"502",
	"503",
	"504",
	"http 502",
	"http 503",
	"http 504",
	"error",
	"the model is currently unreachable",
	"model is currently unreachable",
	"unable to reach",
	"upstream connect error",
	"upstream request timeout",
	"request failed",
	"network error",
	"connection reset",
	"connection refused",
	"connection closed",
	"connection timed out",
	"usage limit reached",
	"resource_exhausted",
	"quota exceeded",
	"rate limit exceeded",
	"authentication required",
	"unauthenticated",
	"invalid api key",
	"oauth token",
	"acp internal error",
	"conversation corrupt",
	"checkpoint",
];

const TRANSIENT_ERROR_PATTERNS = [
	/^(?:error[:\s-]*)?(?:http\s+)?50[234](?:\s+(?:bad\s+gateway|service\s+unavailable|gateway\s+timeout))?[.!\s]*$/iu,
	/^(?:the\s+model\s+is\s+currently\s+unreachable|model\s+is\s+currently\s+unreachable|unable\s+to\s+reach\s+(?:the\s+)?model|upstream\s+connect\s+error(?:\s+or\s+disconnect\/reset\s+before\s+headers)?|upstream\s+request\s+timeout)[.!\s]*$/iu,
	/\b(?:502\s+bad\s+gateway|503\s+service\s+unavailable|504\s+gateway\s+timeout|the\s+model\s+is\s+currently\s+unreachable|upstream\s+connect\s+error\s+or\s+disconnect\/reset\s+before\s+headers)\b/iu,
	/^(?:request\s+failed|network\s+error|connection\s+(?:reset|refused|closed|timed\s+out))\b.*\b(?:502|503|504|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket\s+hang\s+up)\b/iu,
];

const WEDGED_ERROR_PATTERNS = [
	/\b(?:acp\s+internal\s+error|conversation\s+corrupt|checkpoint\s+(?:error|corrupt|failed))\b/iu,
];

const AUTH_ERROR_PATTERNS = [
	/^(?:authentication\s+required|unauthenticated|invalid\s+api\s+key|oauth\s+token\s+(?:expired|invalid))\b/iu,
];

const QUOTA_ERROR_PATTERNS = [
	/\b(?:RESOURCE_EXHAUSTED|quota\s+exceeded|rate\s+limit\s+exceeded)\b/iu,
];

export type EndTurnClassification =
	| { kind: "quota"; retryable: false; wedged: false; error: AntigravityAcpError }
	| { kind: "auth"; retryable: false; wedged: false; error: AntigravityAcpError }
	| { kind: "wedged"; retryable: true; wedged: true; error: AntigravityAcpError }
	| { kind: "transient"; retryable: true; wedged: false; error: AntigravityAcpError };

/**
 * Returns true when `text` could still be the leading prefix of a known
 * server/gateway error banner, so short prefixes are held until either
 * they diverge into normal prose or `end_turn` confirms the error.
 */
export function couldBeErrorPrefix(text: string): boolean {
	const normalized = text.trimStart().toLowerCase();
	if (!normalized) return true;
	if (normalized.length > MAX_BUFFER_CHARS) return false;
	return ERROR_PREFIX_CANDIDATES.some(
		(candidate) => candidate.startsWith(normalized) || normalized.startsWith(candidate),
	);
}

/**
 * Classifies an `end_turn` or `refusal` reply that may actually be an
 * unstructured backend/gateway error returned as plain assistant text.
 */
export function classifyEndTurnError(
	text: string,
	totalTokens: number,
	stopReason: string,
	toolCallCount: number,
	modelId: string,
): EndTurnClassification | undefined {
	if (toolCallCount > 0) return undefined;

	if (totalTokens === 0 || stopReason === "refusal") {
		const quota = quotaExhaustion(text);
		if (quota) {
			return {
				kind: "quota",
				retryable: false,
				wedged: false,
				error: new AntigravityAcpError(
					"quota",
					`Antigravity quota exceeded for ${modelId}.${quota.resetAt ? ` Resets at ${quota.resetAt}.` : ""}`,
				),
			};
		}
	}

	const trimmed = text.trim();
	if (!trimmed || trimmed.length > MAX_ERROR_TEXT_CHARS) return undefined;
	// Avoid misclassifying normal prose/code replies that happen to quote error strings.
	if (trimmed.includes("```")) return undefined;

	if (totalTokens === 0 || stopReason === "refusal") {
		if (QUOTA_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return {
				kind: "quota",
				retryable: false,
				wedged: false,
				error: new AntigravityAcpError("quota", `Antigravity quota exceeded for ${modelId}: ${trimmed}`),
			};
		}
		if (AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return {
				kind: "auth",
				retryable: false,
				wedged: false,
				error: new AntigravityAcpError("auth", `Antigravity authentication required: ${trimmed}`),
			};
		}
	}

	if (WEDGED_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return {
			kind: "wedged",
			retryable: true,
			wedged: true,
			error: new AntigravityAcpError("protocol", `Antigravity session error: ${trimmed}`),
		};
	}

	if (
		(totalTokens === 0 || stopReason === "refusal" || isStandaloneGatewayLine(trimmed)) &&
		TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(trimmed))
	) {
		return {
			kind: "transient",
			retryable: true,
			wedged: false,
			error: new AntigravityAcpError("protocol", `Antigravity backend unreachable: ${trimmed}`),
		};
	}

	return undefined;
}

function isStandaloneGatewayLine(trimmed: string): boolean {
	return (
		trimmed.length <= 160 &&
		/^(?:50[234]\b|the\s+model\s+is\s+currently\s+unreachable|upstream\s+connect\s+error)/iu.test(trimmed)
	);
}

export function isConnectionClosedError(error: unknown): boolean {
	const message = errorMessage(error);
	return /\b(?:acp\s+connection\s+is\s+closed|acp\s+outbound\s+channel\s+is\s+closed|connection\s+(?:is\s+)?closed|stream\s+(?:is\s+)?closed|request\s+closed|epipe|broken\s+pipe)\b/iu.test(
		message,
	);
}

export function isRetryablePromptError(error: unknown): boolean {
	if (error instanceof AntigravityAcpError) {
		if (error.code === "aborted" || error.code === "auth" || error.code === "quota" || error.code === "invalid_input") {
			return false;
		}
		if (error.code === "timeout" || error.code === "process_exit") return true;
	}
	const message = errorMessage(error);
	return (
		/\b(?:502|503|504|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket\s+hang\s+up|currently\s+unreachable|upstream\s+connect\s+error)\b/iu.test(
			message,
		) ||
		isConnectionClosedError(error) ||
		isWedgedSessionError(error)
	);
}

export function isWedgedSessionError(error: unknown): boolean {
	const message = errorMessage(error);
	return WEDGED_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Per-attempt streaming buffer that:
 * 1. Holds suspected error-banner prefixes until confirmed safe or rejected at `end_turn`;
 * 2. Synthesizes deduplicated plan/tool progress into `thinking` only when native thought
 *    chunks are absent;
 * 3. Tracks whether irreversible user-visible output has already been committed.
 */
export class TurnOutputBuffer {
	private bufferedText = "";
	private textFlushed = false;
	private thinkingEmitted = false;
	private toolCallCount = 0;
	private fullText = "";
	private hasNativeThought = false;
	private lastSyntheticPlan: string | undefined;
	private lastSyntheticTool: string | undefined;

	constructor(private readonly writer: PiEventWriter) {}

	get rawText(): string {
		return this.fullText;
	}

	get toolCallsCount(): number {
		return this.toolCallCount;
	}

	get hasCommittedOutput(): boolean {
		return this.textFlushed || this.thinkingEmitted || this.toolCallCount > 0;
	}

	text(delta: string): void {
		if (!delta) return;
		this.fullText += delta;
		if (this.textFlushed) {
			this.writer.text(delta);
			return;
		}
		this.bufferedText += delta;
		if (!couldBeErrorPrefix(this.bufferedText)) {
			this.flushText();
		}
	}

	thinking(delta: string): void {
		if (!delta) return;
		this.hasNativeThought = true;
		this.thinkingEmitted = true;
		this.writer.thinking(delta);
	}

	plan(summary: string, fullText: string): void {
		const rendered = this.hasNativeThought ? fullText : summary;
		if (!rendered || rendered === this.lastSyntheticPlan) return;
		this.lastSyntheticPlan = rendered;
		this.thinkingEmitted = true;
		this.writer.thinking(rendered);
	}

	toolActivity(summary: string, fullText: string): void {
		const rendered = this.hasNativeThought ? fullText : summary;
		if (!rendered || rendered === this.lastSyntheticTool) return;
		this.lastSyntheticTool = rendered;
		this.thinkingEmitted = true;
		this.writer.thinking(rendered);
	}

	markToolCall(): void {
		this.flushText();
		this.toolCallCount += 1;
	}

	flushText(): void {
		if (this.textFlushed) return;
		this.textFlushed = true;
		if (this.bufferedText) {
			const pending = this.bufferedText;
			this.bufferedText = "";
			this.writer.text(pending);
		}
	}
}
