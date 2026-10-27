/**
 * Pure parsing helpers for herdr responses.
 *
 * Herdr omits optional fields instead of sending `null` or `false`, so every
 * reader here has to distinguish "absent" from "false". Nothing in this module
 * touches the filesystem or a process, which keeps it directly testable.
 */

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";
/** `unknown` means the field was absent or not a boolean — never assume false. */
export type TriState = true | false | "unknown";

export interface PaneRect {
	width: number;
	height: number;
}

export interface AgentView {
	paneId: string;
	name: string | null;
	kind: string | null;
	displayAgent: string | null;
	status: AgentStatus;
	cwd: string | null;
	focused: boolean;
	interactiveReady: TriState;
	launchPending: TriState;
	/** Absent `completion_seq` means "no completed turn yet" — reported as 0. */
	completionSeq: number;
	stateChangeSeq: number | null;
	sessionKind: string | null;
	sessionPath: string | null;
	sessionSource: string | null;
}

const AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export function readString(record: Record<string, unknown> | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function readNumber(record: Record<string, unknown> | null, key: string): number | null {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `pane split --cwd <dir>` echoes the directory back with a trailing
 * separator, so paths from different responses are not string-equal.
 * Drive roots and `/` keep their separator.
 */
export function normalizeCwd(value: string | null): string | null {
	if (!value) return null;
	const trimmed = value.replace(/[\\/]+$/, "");
	if (trimmed === "") return value;
	if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
	return trimmed;
}

export function readTriState(record: Record<string, unknown> | null, key: string): TriState {
	const value = record?.[key];
	return typeof value === "boolean" ? value : "unknown";
}

export function normalizeStatus(value: unknown): AgentStatus {
	return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value)
		? (value as AgentStatus)
		: "unknown";
}

/** Every CLI control response wraps its body in `result`. */
export function unwrapResult(payload: unknown): Record<string, unknown> | null {
	return asRecord(asRecord(payload)?.result);
}

export function extractAgent(payload: unknown): Record<string, unknown> | null {
	const result = unwrapResult(payload);
	return asRecord(result?.agent) ?? result;
}

export function extractPane(payload: unknown): Record<string, unknown> | null {
	const result = unwrapResult(payload);
	return asRecord(result?.pane) ?? result;
}

export function extractPaneId(payload: unknown): string | null {
	const pane = extractPane(payload);
	return readString(pane, "pane_id");
}

export function normalizeAgentView(payload: unknown): AgentView | null {
	const agent = extractAgent(payload);
	const paneId = readString(agent, "pane_id");
	if (!agent || !paneId) return null;

	const session = asRecord(agent.agent_session);
	const sessionKind = readString(session, "kind");
	return {
		paneId,
		name: readString(agent, "name"),
		kind: readString(agent, "agent"),
		displayAgent: readString(agent, "display_agent"),
		status: normalizeStatus(agent.agent_status),
		cwd: normalizeCwd(readString(agent, "cwd")),
		focused: agent.focused === true,
		interactiveReady: readTriState(agent, "interactive_ready"),
		launchPending: readTriState(agent, "launch_pending"),
		completionSeq: readNumber(agent, "completion_seq") ?? 0,
		stateChangeSeq: readNumber(agent, "state_change_seq"),
		sessionKind,
		sessionPath: sessionKind === "path" ? readString(session, "value") : null,
		sessionSource: readString(session, "source"),
	};
}

export function extractPaneRect(layoutPayload: unknown, paneId: string): PaneRect | null {
	const layout = asRecord(unwrapResult(layoutPayload)?.layout);
	const panes = layout?.panes;
	if (!Array.isArray(panes)) return null;
	for (const entry of panes) {
		const pane = asRecord(entry);
		const rect = asRecord(pane?.rect);
		if (readString(pane, "pane_id") !== paneId) continue;
		const width = readNumber(rect, "width");
		const height = readNumber(rect, "height");
		if (width === null || height === null) return null;
		return { width, height };
	}
	return null;
}

/** Server errors are `{"error":{"code","message"}}`; syntax errors are text. */
export function parseErrorPayload(text: string): { code: string | null; message: string } | null {
	const parsed = parseJson(text);
	const error = asRecord(asRecord(parsed)?.error) ?? asRecord(parsed);
	const message = readString(error, "message");
	if (!message) return null;
	return { code: readString(error, "code"), message };
}

export function parseJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

export const DEFAULT_TEXT_LIMIT = 40_000;

export function truncateText(
	text: string,
	limit = DEFAULT_TEXT_LIMIT,
): { text: string; truncated: boolean; fullLength: number } {
	if (text.length <= limit) return { text, truncated: false, fullLength: text.length };
	return {
		text: `${text.slice(0, limit)}\n\n[... truncated: ${text.length - limit} more characters]`,
		truncated: true,
		fullLength: text.length,
	};
}

export function describeAgentView(view: AgentView): string {
	const lines = [
		`pane ${view.paneId} · ${view.name ?? "(unnamed)"} · kind ${view.kind ?? "unknown"} · status ${view.status}`,
		`cwd ${view.cwd ?? "unknown"} · completion_seq ${view.completionSeq} · state_change_seq ${view.stateChangeSeq ?? "unknown"}`,
	];
	if (view.interactiveReady !== "unknown") lines.push(`interactive_ready ${view.interactiveReady}`);
	if (view.launchPending !== "unknown") lines.push(`launch_pending ${view.launchPending}`);
	if (view.sessionPath) lines.push(`session ${view.sessionPath}`);
	else if (view.sessionKind) lines.push(`session kind ${view.sessionKind} (no readable path)`);
	return lines.join("\n");
}
