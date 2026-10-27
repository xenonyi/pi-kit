/**
 * Pure argv construction and policy checks.
 *
 * Keeping these as plain functions makes the error-prone parts — direction
 * derivation, the passthrough denylist, and the "never pass --wait" rule —
 * verifiable without touching a live Herdr session.
 */

import type { PaneRect } from "./normalize.ts";

/** `herdr pane split --direction` accepts only these two values. */
export type SplitDirection = "right" | "down";

/** A split is worth doing only when the resulting half stays usable. */
export const MIN_SPLIT_COLUMNS = 40;
export const MIN_SPLIT_ROWS = 8;

export type DirectionChoice =
	| { ok: true; direction: SplitDirection; reason: string }
	| { ok: false; reason: string };

/**
 * Wide panes split right, narrow or tall panes split down. A pane that is too
 * small in both axes is refused instead of producing an unusable sliver.
 */
export function chooseSplitDirection(
	rect: PaneRect,
	minColumns = MIN_SPLIT_COLUMNS,
	minRows = MIN_SPLIT_ROWS,
): DirectionChoice {
	const halfWidth = Math.floor(rect.width / 2);
	const halfHeight = Math.floor(rect.height / 2);
	const canRight = halfWidth >= minColumns;
	const canDown = halfHeight >= minRows;

	if (!canRight && !canDown) {
		return {
			ok: false,
			reason: `Pane ${rect.width}x${rect.height} is too small to split: each half would keep at most ${halfWidth} columns or ${halfHeight} rows (needs ${minColumns} columns or ${minRows} rows). Resize the pane or use an explicit direction on a larger pane.`,
		};
	}

	if (canRight && (!canDown || rect.width >= rect.height)) {
		return {
			ok: true,
			direction: "right",
			reason: `${rect.width}x${rect.height} is ${rect.width >= rect.height ? "wider than tall" : "narrow but tall enough to split sideways"}; each half keeps ${halfWidth} columns.`,
		};
	}

	return {
		ok: true,
		direction: "down",
		reason: `${rect.width}x${rect.height} is narrower than tall; each half keeps ${halfHeight} rows.`,
	};
}

export interface Denial {
	denied: boolean;
	reason?: string;
}

const EMPTY_REASON =
	"Refusing an empty herdr invocation: a bare `herdr` launches or attaches the TUI instead of querying. Pass a subcommand.";

const DENYLIST: Array<{ match: (args: string[]) => boolean; reason: string }> = [
	{
		match: (args) => args.length === 0,
		reason: EMPTY_REASON,
	},
	{
		match: (args) => args[0] === "server" && args[1] === "stop",
		reason:
			"Refusing `herdr server stop`: it stops the running server and every pane process in this session. Stop it from the host shell when that is really intended.",
	},
	{
		match: (args) => args[0] === "update",
		reason:
			"Refusing `herdr update`: it replaces the binary this extension was written against. Update from the host shell, then reload this session.",
	},
	{
		match: (args) => args[0] === "workspace" && args[1] === "close" && args.includes("--group"),
		reason:
			"Refusing `herdr workspace close --group`: it closes the primary workspace and its linked worktree workspaces. Close the workspace you created without --group, or ask the user.",
	},
];

/**
 * The denylist is short on purpose: only unrecoverable calls and calls that
 * would break the extension itself. `callerPaneId` guards the one mistake that
 * looks harmless: closing the pane this session runs in, which ends it.
 */
/** Global options may precede the subcommand, so the denylist must look past them. */
const GLOBAL_VALUE_OPTIONS = new Set(["--machine", "--session", "--remote", "--remote-keybindings"]);
const GLOBAL_FLAGS = new Set(["--handoff", "--default-config"]);

export function stripGlobalOptions(args: string[]): { args: string[]; machine: string | null } {
	let index = 0;
	let machine: string | null = null;
	while (index < args.length) {
		const arg = args[index];
		if (GLOBAL_VALUE_OPTIONS.has(arg)) {
			if (arg === "--machine") machine = args[index + 1] ?? null;
			index += 2;
			continue;
		}
		if (GLOBAL_FLAGS.has(arg)) {
			index += 1;
			continue;
		}
		break;
	}
	return { args: args.slice(index), machine };
}

export function checkPassthrough(args: string[], callerPaneId?: string | null): Denial {
	const { args: rest, machine } = stripGlobalOptions(args);
	if (rest.length === 0) return { denied: true, reason: EMPTY_REASON };

	// A remote pane id can coincidentally equal this session's id; only the local
	// session is at risk, so the caller-pane guard applies without --machine.
	const closesCaller =
		!machine &&
		rest[0] === "pane" &&
		rest[1] === "close" &&
		typeof callerPaneId === "string" &&
		callerPaneId.length > 0 &&
		rest.includes(callerPaneId);
	if (closesCaller) {
		return {
			denied: true,
			reason: `Refusing to close pane ${callerPaneId}: it hosts this session, so closing it ends the agent. Close only panes you created, and never the calling pane.`,
		};
	}
	for (const entry of DENYLIST) {
		if (entry.match(rest)) return { denied: true, reason: entry.reason };
	}
	return { denied: false };
}

export interface PaneSplitOptions {
	direction: SplitDirection;
	cwd?: string | null;
	focus?: boolean;
	/** Target pane instead of `--current`; required when splitting a saved machine. */
	paneId?: string | null;
}

export function paneSplitArgs(options: PaneSplitOptions): string[] {
	const args = ["pane", "split"];
	if (options.paneId) args.push("--pane", options.paneId);
	else args.push("--current");
	args.push("--direction", options.direction);
	if (options.cwd) args.push("--cwd", options.cwd);
	args.push(options.focus ? "--focus" : "--no-focus");
	return args;
}

/** Prefix an argv with `--machine` when a saved remote host is selected. */
export function withMachine(machine: string | null | undefined, args: string[]): string[] {
	const label = machine?.trim();
	return label ? ["--machine", label, ...args] : args;
}

/**
 * `--current` resolves only inside the calling session. A saved machine shares
 * no caller context, so a remote split must name its pane.
 */
export function checkSplitTarget(machine: string | null | undefined, pane: string | null | undefined): Denial {
	if (machine?.trim() && !pane?.trim()) {
		return {
			denied: true,
			reason:
				"Splitting a remote pane needs an explicit pane id: --current only resolves inside the calling session, and a saved machine shares none. Pass pane with a pane id from that machine.",
		};
	}
	return { denied: false };
}


export interface AgentStartOptions {
	name: string;
	kind: string;
	paneId: string;
	timeoutMs?: number;
}

export function agentStartArgs(options: AgentStartOptions): string[] {
	const args = ["agent", "start", options.name, "--kind", options.kind, "--pane", options.paneId];
	if (options.timeoutMs !== undefined) args.push("--timeout", String(options.timeoutMs));
	return args;
}

/** Handoff semantics: never wait, never pass `--until`. */
export function agentPromptArgs(target: string, text: string): string[] {
	return ["agent", "prompt", target, text];
}

export function agentGetArgs(target: string): string[] {
	return ["agent", "get", target];
}

export const READ_SOURCES = ["visible", "recent", "recent-unwrapped", "detection"] as const;
export type ReadSource = (typeof READ_SOURCES)[number];

export function agentReadArgs(target: string, source: ReadSource, lines: number): string[] {
	return ["agent", "read", target, "--source", source, "--lines", String(lines)];
}

/**
 * Windows caps a child process command line near 32k UTF-16 units. Beyond this
 * the handoff skill's fallback applies: write the document to a file and pass
 * the file path in the prompt instead of the full text.
 */
export const MAX_PROMPT_TEXT_CHARS = 28_000;

export function checkPromptText(text: string): Denial {
	if (text.trim().length === 0) return { denied: true, reason: "Refusing to submit an empty prompt." };
	if (text.length > MAX_PROMPT_TEXT_CHARS) {
		return {
			denied: true,
			reason: `Prompt text is ${text.length} characters; the limit is ${MAX_PROMPT_TEXT_CHARS}. Write the document to a file and submit a prompt that points at that path instead.`,
		};
	}
	return { denied: false };
}

/** Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. */
export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export function checkAgentName(name: string): Denial {
	if (!AGENT_NAME_PATTERN.test(name)) {
		return {
			denied: true,
			reason: `Agent name "${name}" is invalid: use [a-z][a-z0-9_-]{0,31}.`,
		};
	}
	return { denied: false };
}
