/**
 * Tool definitions.
 *
 * Each tool is one mechanical step the model used to assemble by hand: argv,
 * PowerShell translation, JSON field digging, and ID hand-off. Policy that
 * needs judgement stays in the herdr skills.
 *
 * Results that carry identifiers also declare `outputSchema` and return
 * `structuredContent`, so scripts (codemode) get the pane/agent id as data
 * instead of parsing it out of prose. Scraping ids from text is how a caller
 * ends up closing its own pane.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	agentGetArgs,
	agentPromptArgs,
	agentReadArgs,
	agentStartArgs,
	checkAgentName,
	checkPassthrough,
	checkPromptText,
	chooseSplitDirection,
	MAX_PROMPT_TEXT_CHARS,
	paneSplitArgs,
	READ_SOURCES,
	type SplitDirection,
} from "./args.ts";
import { callHerdr, HerdrError, runHerdr, sleep } from "./cli.ts";
import { gatePromptTarget, sequencesOf, spawnReadiness, startObserved } from "./gates.ts";
import {
	describeAgentView,
	extractPaneId,
	extractPaneRect,
	normalizeAgentView,
	normalizeCwd,
	parseJson,
	readString,
	type AgentView,
	truncateText,
	unwrapResult,
} from "./normalize.ts";

export interface HerdrSessionState {
	/** Set when `herdr status` does not match the verified protocol. */
	warning: string | null;
}

/** Delay before re-reading the target to see whether a submission started a turn. */
export const SUBMISSION_PROBE_MS = 3_000;

const PANE_CALL_TIMEOUT_MS = 10_000;
const SPLIT_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 20_000;


type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type HerdrToolExposure = "direct" | "hidden";

function withWarning(state: HerdrSessionState, text: string): string {
	return state.warning ? `${state.warning}\n\n${text}` : text;
}

function textResult(
	state: HerdrSessionState,
	text: string,
	details: unknown,
	structuredContent?: JsonObject,
) {
	const base = { content: [{ type: "text" as const, text: withWarning(state, text) }], details };
	return structuredContent === undefined ? base : { ...base, structuredContent };
}

function errorResult(
	state: HerdrSessionState,
	text: string,
	details: unknown,
	structuredContent?: JsonObject,
) {
	const base = {
		content: [{ type: "text" as const, text: withWarning(state, text) }],
		details,
		isError: true,
	};
	return structuredContent === undefined ? base : { ...base, structuredContent };
}

function describeError(error: unknown): { code: string | null; message: string } {
	if (error instanceof HerdrError) return { code: error.code, message: error.message };
	if (error instanceof Error) return { code: null, message: error.message };
	return { code: null, message: String(error) };
}

async function callerPane(signal?: AbortSignal): Promise<{ paneId: string; cwd: string | null }> {
	const payload = await callHerdr({ args: ["pane", "current", "--current"], signal }, PANE_CALL_TIMEOUT_MS);
	const pane = unwrapResult(payload)?.pane as Record<string, unknown> | undefined;
	const paneId = readString(pane ?? null, "pane_id");
	if (!paneId) {
		throw new HerdrError("herdr pane current --current did not report a pane_id; nothing was changed.", {
			code: "unexpected_output",
		});
	}
	return { paneId, cwd: normalizeCwd(readString(pane ?? null, "cwd")) };
}

async function resolveSplitDirection(
	requested: SplitDirection | undefined,
	paneId: string,
	signal?: AbortSignal,
): Promise<{ direction: SplitDirection; reason: string }> {
	if (requested) return { direction: requested, reason: "explicit direction" };
	const payload = await callHerdr({ args: ["pane", "layout", "--pane", paneId], signal }, PANE_CALL_TIMEOUT_MS);
	const rect = extractPaneRect(payload, paneId);
	if (!rect) {
		throw new HerdrError(
			`Could not read the geometry of pane ${paneId}. Pass direction explicitly ("right" or "down").`,
			{ code: "unexpected_output" },
		);
	}
	const choice = chooseSplitDirection(rect);
	if (!choice.ok) throw new HerdrError(choice.reason, { code: "pane_too_small" });
	return { direction: choice.direction, reason: choice.reason };
}

async function readAgent(target: string, signal?: AbortSignal): Promise<AgentView> {
	const payload = await callHerdr({ args: agentGetArgs(target), signal }, PANE_CALL_TIMEOUT_MS);
	const view = normalizeAgentView(payload);
	if (!view) {
		throw new HerdrError(`herdr agent get ${target} returned no agent record.`, { code: "unexpected_output" });
	}
	return view;
}

const DirectionParameter = Type.Optional(
	Type.Union([Type.Literal("right"), Type.Literal("down")], {
		description:
			'Split direction. Only "right" and "down" exist. Omit to derive it from the caller pane geometry (widest axis first).',
	}),
);

const DirectionSchema = Type.Union([Type.Literal("right"), Type.Literal("down")]);
const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);
const TriStateSchema = Type.Union([Type.Boolean(), Type.Literal("unknown")]);

const PaneSplitParameters = Type.Object({
	direction: DirectionParameter,
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the new pane. Defaults to the caller pane's current directory.",
		}),
	),
	focus: Type.Optional(
		Type.Boolean({
			description: "Move the user's focus to the new pane. Defaults to false (background work).",
		}),
	),
});

const PaneSplitOutput = Type.Object({
	paneId: Type.String({ description: "Pane id of the new pane. Never predict it." }),
	direction: DirectionSchema,
	cwd: NullableString,
	fromPaneId: Type.String({ description: "The pane that was split." }),
});

const AgentSpawnParameters = Type.Object({
	name: Type.String({
		description: "Unique agent name matching [a-z][a-z0-9_-]{0,31}, for example handoff-1.",
	}),
	kind: Type.String({
		description:
			"Agent kind passed to `agent start --kind`. Known kinds: pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qwen, letta, maki, muse.",
	}),
	direction: DirectionParameter,
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the new pane. Defaults to the caller pane's directory." }),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: "How long `agent start` waits for interactive readiness. Default 30000, max 300000.",
		}),
	),
});

const AgentSpawnOutput = Type.Object({
	paneId: Type.String({ description: "Pane id created for the agent, even when startup failed." }),
	name: Type.String(),
	kind: Type.String(),
	direction: DirectionSchema,
	cwd: NullableString,
	ready: Type.Boolean(),
	status: NullableString,
	error: Type.Optional(Type.Object({ code: NullableString, message: Type.String() })),
});

const AgentTargetParameters = Type.Object({
	target: Type.String({
		description:
			"Live agent name or the pane id currently hosting it (for example w1:p2). Names are cleared when the occupant exits.",
	}),
});

const AgentGetOutput = Type.Object({
	paneId: Type.String(),
	name: NullableString,
	kind: NullableString,
	status: Type.String(),
	cwd: NullableString,
	interactiveReady: TriStateSchema,
	launchPending: TriStateSchema,
	completionSeq: Type.Number(),
	stateChangeSeq: NullableNumber,
	sessionPath: NullableString,
	sessionKind: NullableString,
	sessionSource: NullableString,
});

const AgentPromptParameters = Type.Object({
	target: Type.String({
		description:
			"Live agent name or hosting pane id. Must be idle or done; blocked, working, and unknown targets are refused.",
	}),
	text: Type.String({
		description: `Prompt text, submitted as one paste plus Enter. Up to ${MAX_PROMPT_TEXT_CHARS} characters; write longer documents to a file and point at the path instead.`,
	}),
});

const AgentPromptOutput = Type.Object({
	target: Type.String(),
	submitted: Type.Boolean(),
	startObserved: Type.Union([Type.Boolean(), Type.Null()]),
	probeMs: Type.Number(),
	status: NullableString,
	paneId: NullableString,
	stateChangeSeqBefore: NullableNumber,
	stateChangeSeqAfter: NullableNumber,
});

const AgentReadParameters = Type.Object({
	target: Type.String({ description: "Live agent name or hosting pane id." }),
	source: Type.Optional(
		Type.Union(
			READ_SOURCES.map((source) => Type.Literal(source)),
			{
				description:
					"Read source: visible (viewport), recent (with soft wraps), recent-unwrapped (preferred for transcripts), detection (agent-detection snapshot). Default recent-unwrapped.",
			},
		),
	),
	lines: Type.Optional(
		Type.Number({
			description:
				"Rows to request. Default 120. Small values may only cover the viewport; scrollback capture needs a few hundred.",
		}),
	),
});

const AgentReadOutput = Type.Object({
	target: Type.String(),
	source: Type.String(),
	lines: Type.Number(),
	chars: Type.Number(),
	text: Type.String({ description: "The trimmed output; scripts receive this instead of the text content." }),
	truncated: Type.Boolean(),
});

const PassthroughParameters = Type.Object({
	args: Type.Array(Type.String(), {
		description:
			'Arguments after the herdr binary, for example ["pane","list"]. No shell is involved, so no quoting is needed. Only the local session unless the arguments include --machine.',
	}),
	json: Type.Optional(Type.Boolean({ description: "Parse stdout as JSON when possible. Defaults to true." })),
	timeoutMs: Type.Optional(
		Type.Number({ description: "Call timeout in milliseconds. Defaults to 20000; long waits need a larger value." }),
	),
});

const PassthroughOutput = Type.Object({
	args: Type.Array(Type.String()),
	exitCode: NullableNumber,
	timedOut: Type.Boolean(),
	stdoutChars: Type.Number(),
	stdout: Type.String(),
	stderr: Type.String(),
	json: Type.Optional(Type.Unknown()),
	stdoutTruncated: Type.Boolean(),
});

export function registerHerdrTools(
	pi: ExtensionAPI,
	state: HerdrSessionState,
	exposure: HerdrToolExposure,
) {
	const paneSplit = defineTool({
		name: "herdr_pane_split",
		label: "Herdr: Split pane",
		description:
			"Split the calling Herdr pane and return the new pane id. Derives right/down from the caller geometry when direction is omitted, defaults to --no-focus, and inherits the caller's working directory. Local session only; use herdr_cli with --machine for remote hosts.",
		promptSnippet: "Split the current Herdr pane and get the new pane id",
		promptGuidelines: [
			"Use herdr_pane_split before starting an agent or running a command in a sibling pane; read the returned paneId instead of predicting one.",
			"Keep focus in the calling pane unless the user asked to switch.",
			"Never scrape the pane id out of this tool's prose; read `structuredContent.paneId` (or the `details.paneId`) instead.",
		],
		parameters: PaneSplitParameters,
		outputSchema: PaneSplitOutput,
		exposure,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const caller = await callerPane(signal);
			const { direction, reason } = await resolveSplitDirection(params.direction, caller.paneId, signal);
			const cwd = params.cwd ?? caller.cwd;
			const payload = await callHerdr(
				{ args: paneSplitArgs({ direction, cwd, focus: params.focus === true }), signal },
				SPLIT_TIMEOUT_MS,
			);
			const paneId = extractPaneId(payload);
			if (!paneId) {
				throw new HerdrError("pane split reported success without a pane_id.", { code: "unexpected_output" });
			}
			const structured = { paneId, direction, cwd, fromPaneId: caller.paneId };
			const text = [
				`New pane: ${paneId}`,
				`split ${caller.paneId} ${direction} (${reason})`,
				`cwd: ${cwd ?? "unknown"}`,
			].join("\n");
			return textResult(state, text, structured, structured);
		},
	});

	const agentSpawn = defineTool({
		name: "herdr_agent_spawn",
		label: "Herdr: Spawn agent",
		description:
			"Create a sibling pane in the current tab and start an agent in it, then report whether it reached an interactive prompt. Combines pane split, agent start, and the readiness check. Returns the pane id even when startup is not ready so the caller can inspect or close it. Never retries. Local session only.",
		promptSnippet: "Create a sibling pane and start an agent in it",
		promptGuidelines: [
			"Use herdr_agent_spawn for the handoff default: a sibling pane in the current tab with the caller's working directory.",
			"Do not retry after a readiness failure: read the pane first.",
			"Only close the pane this tool created, and only when the handoff failed or the user cancelled. Take the id from `structuredContent.paneId`.",
		],
		parameters: AgentSpawnParameters,
		outputSchema: AgentSpawnOutput,
		exposure,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const nameCheck = checkAgentName(params.name);
			if (nameCheck.denied) throw new HerdrError(nameCheck.reason ?? "invalid agent name", { code: "invalid_name" });

			const caller = await callerPane(signal);
			const { direction, reason } = await resolveSplitDirection(params.direction, caller.paneId, signal);
			const cwd = params.cwd ?? caller.cwd;
			const splitPayload = await callHerdr(
				{ args: paneSplitArgs({ direction, cwd, focus: false }), signal },
				SPLIT_TIMEOUT_MS,
			);
			const paneId = extractPaneId(splitPayload);
			if (!paneId) {
				throw new HerdrError("pane split reported success without a pane_id.", { code: "unexpected_output" });
			}

			const startBudget = params.timeoutMs ?? START_TIMEOUT_MS;
			let startPayload: unknown;
			try {
				startPayload = await callHerdr(
					{
						args: agentStartArgs({ name: params.name, kind: params.kind, paneId, timeoutMs: params.timeoutMs }),
						signal,
					},
					startBudget + SPLIT_TIMEOUT_MS,
				);
			} catch (error) {
				const failure = describeError(error);
				const structured = {
					paneId,
					name: params.name,
					kind: params.kind,
					direction,
					cwd,
					ready: false,
					status: null,
					error: failure,
				};
				const text = [
					`New pane: ${paneId}`,
					`Pane was created (${direction}, ${reason}) but agent start failed.`,
					`Code: ${failure.code ?? "unknown"}`,
					`Message: ${failure.message}`,
					`The pane still exists. Read it with herdr_agent_read before retrying, and close it with herdr_cli ["pane","close","${paneId}"] only if you created it and the handoff is abandoned.`,
				].join("\n");
				return errorResult(state, text, structured, structured);
			}

			const view = normalizeAgentView(startPayload);
			if (!view) {
				const structured = {
					paneId,
					name: params.name,
					kind: params.kind,
					direction,
					cwd,
					ready: false,
					status: null,
				};
				const text = [
					`New pane: ${paneId}`,
					"agent start returned success but carried no agent record. Read the pane before prompting.",
				].join("\n");
				return errorResult(state, text, structured, structured);
			}

			const readiness = spawnReadiness(view);
			const summary = [
				`New pane: ${paneId}`,
				`Agent ${params.name} (${params.kind}); split ${direction} (${reason}).`,
				describeAgentView(view),
			].join("\n");
			const structured = {
				paneId,
				name: params.name,
				kind: params.kind,
				direction,
				cwd,
				ready: readiness.ready,
				status: view.status,
			};
			if (!readiness.ready) {
				return errorResult(state, `${summary}\n\n${readiness.reason ?? ""}`.trim(), structured, structured);
			}
			return textResult(state, summary, structured, structured);
		},
	});

	const agentGet = defineTool({
		name: "herdr_agent_get",
		label: "Herdr: Get agent",
		description:
			'Read one Herdr agent\'s normalized state: name, kind, status, cwd, interactive_ready, launch_pending, completion_seq, state_change_seq, and the agent session path. Missing optional fields become null or "unknown" instead of false; completion_seq is 0 until a turn completes.',
		promptSnippet: "Read a Herdr agent's status and sequences",
		promptGuidelines: [
			"Use herdr_agent_get before prompting or reporting progress; do not infer state from sidebar order.",
			"completion_seq stays 0 until the agent finishes a turn, so compare it against the value recorded before a handoff.",
		],
		parameters: AgentTargetParameters,
		outputSchema: AgentGetOutput,
		exposure,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const view = await readAgent(params.target, signal);
			const structured = {
				paneId: view.paneId,
				name: view.name,
				kind: view.kind,
				status: view.status,
				cwd: view.cwd,
				interactiveReady: view.interactiveReady,
				launchPending: view.launchPending,
				completionSeq: view.completionSeq,
				stateChangeSeq: view.stateChangeSeq,
				sessionPath: view.sessionPath,
				sessionKind: view.sessionKind,
				sessionSource: view.sessionSource,
			};
			return textResult(state, describeAgentView(view), structured, structured);
		},
	});

	const agentPrompt = defineTool({
		name: "herdr_agent_prompt",
		label: "Herdr: Prompt agent",
		description:
			"Submit text to an idle or done Herdr agent without --wait, then re-read it after 3 seconds to report whether activity was observed. Refuses blocked, working, and unknown targets so a live turn cannot be clobbered. Returns submitted, startObserved, and the sequence values on both sides of the probe.",
		promptSnippet: "Submit a prompt to an idle Herdr agent",
		promptGuidelines: [
			"Use herdr_agent_prompt for handoff delivery. It never waits for the target: ownership transfers immediately.",
			"startObserved=false means no activity was seen, not that the text was dropped. Read the pane before resubmitting.",
			"A blocked target must be shown to the user; never answer an approval dialog on their behalf.",
		],
		parameters: AgentPromptParameters,
		outputSchema: AgentPromptOutput,
		exposure,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const textCheck = checkPromptText(params.text);
			if (textCheck.denied) throw new HerdrError(textCheck.reason ?? "invalid prompt text", { code: "invalid_text" });

			const before = await readAgent(params.target, signal);
			const gate = gatePromptTarget(before);
			if (!gate.allow) throw new HerdrError(gate.reason ?? "target is not promptable", { code: "not_promptable" });

			await callHerdr({ args: agentPromptArgs(params.target, params.text), signal }, PROMPT_TIMEOUT_MS);
			await sleep(SUBMISSION_PROBE_MS, signal);

			let after: AgentView | null = null;
			let probeError: { code: string | null; message: string } | null = null;
			try {
				after = await readAgent(params.target, signal);
			} catch (error) {
				probeError = describeError(error);
			}

			const observed = startObserved(sequencesOf(before), after ? sequencesOf(after) : null);
			const lines = [
				`Submitted to ${params.target}: ${params.text.length} characters (no --wait).`,
				observed === null
					? `Activity probe inconclusive: could not re-read the agent after ${SUBMISSION_PROBE_MS}ms (${probeError?.message ?? "no data"}). Read the pane before resubmitting.`
					: observed
						? "Activity observed: the agent started a turn."
						: `No activity observed within ${SUBMISSION_PROBE_MS}ms. That does not prove the text was dropped: read the pane before resubmitting.`,
			];
			if (after) lines.push(describeAgentView(after));

			const structured = {
				target: params.target,
				submitted: true,
				startObserved: observed,
				probeMs: SUBMISSION_PROBE_MS,
				status: after?.status ?? null,
				paneId: after?.paneId ?? before.paneId,
				stateChangeSeqBefore: before.stateChangeSeq,
				stateChangeSeqAfter: after?.stateChangeSeq ?? null,
			};
			return textResult(state, lines.join("\n"), { ...structured, probeError }, structured);
		},
	});

	const agentRead = defineTool({
		name: "herdr_agent_read",
		label: "Herdr: Read agent pane",
		description:
			"Read terminal output from a Herdr agent pane. Defaults to source recent-unwrapped with 120 rows, which may only cover the viewport; request more rows for scrollback. Output is truncated for the model, and the detail carries the full length.",
		promptSnippet: "Read output from a Herdr agent pane",
		promptGuidelines: [
			"Use herdr_agent_read to see where an agent is stuck; prefer the agent session path from herdr_agent_get when a lossless transcript is needed.",
			"Large reads while the agent is working can fail with agent_not_idle; wait or read a smaller source.",
		],
		parameters: AgentReadParameters,
		outputSchema: AgentReadOutput,
		exposure,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const source = params.source ?? "recent-unwrapped";
			const lines = Math.max(1, Math.floor(params.lines ?? 120));
			const outcome = await runHerdr({
				args: agentReadArgs(params.target, source, lines),
				signal,
				timeoutMs: 30_000,
			});
			if (outcome.exitCode !== 0) {
				const failure = describeError(
					new HerdrError(outcome.stderr.trim() || outcome.stdout.trim() || "herdr agent read failed", {
						exitCode: outcome.exitCode,
						stderr: outcome.stderr,
						stdout: outcome.stdout,
					}),
				);
				throw new HerdrError(failure.message, { code: failure.code, exitCode: outcome.exitCode });
			}
			const body = truncateText(outcome.stdout.trimEnd());
			const structured = {
				target: params.target,
				source,
				lines,
				chars: body.fullLength,
				text: body.text,
				truncated: body.truncated,
			};
			return textResult(state, body.text || "(no output)", structured, structured);
		},
	});

	const passthrough = defineTool({
		name: "herdr_cli",
		label: "Herdr: CLI",
		description:
			"Run any other herdr subcommand with an argv array (no shell) and return stdout, stderr, exit code, and parsed JSON. Blocks a bare invocation, server stop, update, and workspace close --group. Use it for actions the other herdr tools do not cover, and include --machine when the target is a saved remote host.",
		promptSnippet: "Run a herdr subcommand the other tools do not cover",
		promptGuidelines: [
			"Read the contract with `herdr --skill` before relying on flags that the dedicated herdr tools do not expose.",
			"Parse ids from the returned JSON; never predict pane, tab, workspace, or agent identifiers.",
		],
		parameters: PassthroughParameters,
		outputSchema: PassthroughOutput,
		exposure,
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const denial = checkPassthrough(params.args, process.env.HERDR_PANE_ID);
			if (denial.denied) throw new HerdrError(denial.reason ?? "refused", { code: "refused" });

			const outcome = await runHerdr({ args: params.args, signal, timeoutMs: params.timeoutMs });
			const parsed = params.json === false ? undefined : parseJson(outcome.stdout);
			const stdout = truncateText(outcome.stdout.trimEnd());
			const stderr = truncateText(outcome.stderr.trimEnd(), 4_000);
			const text = [
				`herdr ${params.args.join(" ")}`,
				`exit: ${outcome.exitCode ?? "signal"}${outcome.timedOut ? " (timed out)" : ""}`,
				stdout.text ? `\nstdout:\n${stdout.text}` : "",
				stderr.text ? `\nstderr:\n${stderr.text}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const structured = {
				args: params.args,
				exitCode: outcome.exitCode,
				timedOut: outcome.timedOut,
				stdoutChars: stdout.fullLength,
				stdoutTruncated: stdout.truncated,
				stdout: stdout.text,
				stderr: stderr.text,
				json: (parsed ?? null) as JsonValue,
			};
			const details = { ...structured, json: parsed ?? null };
			if (outcome.exitCode !== 0 || outcome.timedOut) return errorResult(state, text, details, structured);
			return textResult(state, text, details, structured);
		},
	});

	for (const tool of [paneSplit, agentSpawn, agentGet, agentPrompt, agentRead, passthrough]) {
		pi.registerTool(tool);
	}
}
