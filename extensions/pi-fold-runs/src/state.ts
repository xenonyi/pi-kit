import { getCapabilities } from "@earendil-works/pi-tui";
import type { FoldConfig } from "./config.ts";

/**
 * Grouping of one assistant segment's thinking runs and tool calls, derived at
 * render time from transcript order:
 *
 *   ▸ 4 calls · bash×3 read×1 · ✻ 2 thoughts · 1.2s
 *
 * A group is everything between two boundaries: a user message, an assistant
 * message with visible text, or a session notice. Pi gives every model step its
 * own assistant message, and a step that only thinks and calls a tool carries no
 * text — those "carrier" steps do not split the group, so a reply that runs six
 * tools in six steps still folds into one line.
 *
 * Folded, the group's first member draws the summary line plus one row per
 * failed call and every other member draws nothing. Open, a folded call draws
 * its one-line row, while an opened call is replaced by Pi's own card, whose
 * first row is the status strip, so a call is never drawn twice.
 *
 * Nothing here persists: a restored session rebuilds the same groups because the
 * components are rebuilt in the same order.
 */

/** The slice of `ToolExecutionComponent` this module reads. */
export interface ToolBox {
	toolName: string;
	isPartial: boolean;
	expanded: boolean;
	/** Raw arguments, read only to build the row's one-line preview. */
	args?: unknown;
	/** Pi's own switch for terminal graphics (`false` keeps images textual). */
	showImages?: boolean;
	/** Pi's horizontal padding inside the card (`outputPad`: 0 or 1). */
	outputPad?: number;
	/** Pi's result; `content` is read for image blocks, nothing else. */
	result?: { isError?: boolean; durationMs?: number; content?: unknown };
	/**
	 * Pi's drawn images, in result order: the pixel size for the caption and
	 * pi's own renderer, so a card can be laid out around the rows it covers.
	 */
	imageComponents?: ReadonlyArray<{
		dimensions?: { widthPx?: number; heightPx?: number };
		render?(width: number): string[];
	}>;
	ui?: { requestRender?(): void };
	setExpanded(expanded: boolean): void;
}

export interface GroupSummary {
	count: number;
	/** Per-tool counts, most frequent first, ties alphabetical. */
	breakdown: Array<{ name: string; count: number }>;
	/** Thinking runs listed inside this group. */
	thoughts: number;
	/** Image blocks this group's results carry. */
	images: number;
	/** Sum of the durations that are known. */
	durationMs: number;
	/** Members that finished with an error, in render order. */
	failures: Array<{ name: string; durationMs?: number }>;
	running?: string;
}

/** What a component should draw this frame. */
export interface ToolPlan {
	/** Draw the group summary (and, folded, its failure rows) above this tool. */
	header: boolean;
	/** Draw this call's own one-line row in the group. */
	row: boolean;
	/** Append Pi's own rendering for this call below its row (result opened). */
	block: boolean;
	/** Hand the whole component back to Pi (pinned tool, unknown structure). */
	native: boolean;
}

export type CarrierPlan = "native" | "hidden";

export type AssistantRole = "boundary" | "carrier" | "plain";

interface Group {
	/** The tools themselves, so the summary always reads live state. */
	members: ToolBox[];
	thoughts: number;
	/** Per carrier: how many of its runs the total already includes. */
	counted: Map<object, number>;
	/** A carrier rendered in this group: it may still be showing Pi's label. */
	hasCarrier: boolean;
	/** 0 = summary line only, 1 = one row per call (results still folded). */
	level: 0 | 1;
}

const NATIVE_PLAN: ToolPlan = { header: false, row: false, block: false, native: true };

const newGroup = (): Group => ({ members: [], thoughts: 0, counted: new Map(), hasCarrier: false, level: 0 });

/** The group of the boundary rendered most recently in this frame. */
let current: Group = newGroup();
/** A tool or thinking run joined a group whose summary already rendered. */
let lateJoin = false;

const groupOfBoundary = new WeakMap<object, Group>();
const groupOfCarrier = new WeakMap<object, Group>();
const groupOfTool = new WeakMap<object, Group>();

export function resetState(): void {
	current = newGroup();
	lateJoin = false;
}

/**
 * A component that starts a new group. Idempotent: every component keeps one
 * group, so re-rendering an earlier boundary cannot steal the rest of the frame.
 */
export function noteBoundary(component: object): void {
	let group = groupOfBoundary.get(component);
	if (!group) {
		group = newGroup();
		groupOfBoundary.set(component, group);
	}
	current = group;
}

/**
 * Whether anything joined since the last check. The render patch then asks for
 * one more frame, so a summary that rendered before its newest member catches up.
 */
export function takeLateJoin(): boolean {
	const late = lateJoin;
	lateJoin = false;
	return late;
}

function join(tool: ToolBox): Group {
	const known = groupOfTool.get(tool);
	if (known) return known;
	const group = current;
	// A carrier rendered before this call and now has to stop drawing its label,
	// or the summary would sit under a leftover `Thinking...` for the whole call.
	if (group.members.length > 0 || group.hasCarrier || tool.expanded) lateJoin = true;
	// Ctrl+O expanded new boxes before they rendered: the group is open.
	if (tool.expanded) group.level = 1;
	group.members.push(tool);
	groupOfTool.set(tool, group);
	return group;
}

export function planTool(tool: ToolBox, config: FoldConfig): ToolPlan {
	if (config.pinned.includes(tool.toolName)) {
		// Pi's own row, and the group ends here so what follows stays in order.
		noteBoundary(tool);
		return NATIVE_PLAN;
	}
	const group = join(tool);
	// Any expanded box (ctrl+o, or a result opened by a click) opens the group.
	const open = group.level === 1 || group.members.some((member) => member.expanded);
	if (open && group.level === 0) group.level = 1;
	// One line per call, drawn by the call itself: members render in transcript
	// order, so an opened result lands directly under its own row.
	return {
		header: group.members[0] === tool,
		row: open,
		block: open && tool.expanded,
		native: false,
	};
}

/** One call's line inside the group. */
export interface CallRow {
	name: string;
	/** `key=value …` one-line preview of the arguments. */
	preview?: string;
	/** Set when the result drew terminal graphics, for the `▦` marker. */
	images: boolean;
	running: boolean;
	failed: boolean;
	durationMs?: number;
	expanded: boolean;
}

export function isLastMember(tool: object): boolean {
	const group = groupOfTool.get(tool);
	return group !== undefined && group.members[group.members.length - 1] === tool;
}

/** Whether the call rendered just above this one is an open card as well. */
export function cardAbove(tool: object): boolean {
	const group = groupOfTool.get(tool);
	if (!group) return false;
	const index = group.members.indexOf(tool as ToolBox);
	if (index <= 0) return false;
	return group.members[index - 1]?.expanded === true;
}

/**
 * Image blocks Pi draws as terminal graphics: they arrive as whole-line escape
 * sequences, so a result that has them cannot be laid out as text. The count is
 * gated on the same conditions Pi uses to draw them, so `0` also means "safe to
 * indent and clip".
 */
export function imageCount(tool: ToolBox): number {
	if (tool.showImages === false) return 0;
	if (!getCapabilities().images) return 0;
	const content = tool.result?.content;
	if (!Array.isArray(content)) return 0;
	let count = 0;
	for (const block of content) {
		if (!isRecord(block) || block.type !== "image") continue;
		if (typeof block.data !== "string" || block.data.length === 0) continue;
		if (typeof block.mimeType !== "string" || block.mimeType.length === 0) continue;
		count++;
	}
	return count;
}

export function callRowOf(tool: ToolBox): CallRow {
	return {
		name: tool.toolName,
		preview: previewOf(tool.args),
		images: imageCount(tool) > 0,
		running: tool.isPartial,
		failed: !tool.isPartial && tool.result?.isError === true,
		durationMs: tool.result?.durationMs,
		expanded: tool.expanded,
	};
}

/**
 * Room the one value a folded row shows: a path, a command, or the head of a
 * script fits, and every row of a group ends its text at the same column.
 */
const PREVIEW_CHARS = 44;

/**
 * Argument names that identify a call, best first. Only the winner is shown, so
 * it has to be the value that tells two calls of the same tool apart; unknown
 * names fall in behind, alphabetically.
 */
const IDENTITY_KEYS = ["pattern", "path", "file", "command", "code", "query", "url", "prompt", "question", "script"];

/** `tools.<name>(` — how a codemode script reaches the tools it really runs. */
const NESTED_CALL = /\btools\.([A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Pi's folded call header, rebuilt as one line this module can lay out: the one
 * identifying argument, and how many others the row left out.
 */
function previewOf(args: unknown): string | undefined {
	if (args == null) return undefined;
	try {
		const entries: Array<[string, unknown]> = isRecord(args) && !Array.isArray(args)
			? Object.entries(args)
			: [["args", args]];
		// `null` says the argument was left out: nothing to report in one row.
		const set = entries.filter(([, value]) => value !== null && value !== undefined);
		if (set.length === 0) return undefined;
		const primary = set.reduce((best, entry) => (ranksBefore(entry[0], best[0]) ? entry : best));
		const text = (primary[0] === "code" ? nestedCalls(primary[1]) : undefined) ?? previewValue(primary[1]);
		const hidden = set.length - 1;
		return hidden > 0 ? `${text} +${hidden}` : text;
	} catch {
		return undefined;
	}
}

/** Rank of an argument name; everything unnamed shares the last place. */
function rankOf(name: string): number {
	const index = IDENTITY_KEYS.indexOf(name);
	return index === -1 ? IDENTITY_KEYS.length : index;
}

function ranksBefore(name: string, other: string): boolean {
	const rank = rankOf(name);
	const otherRank = rankOf(other);
	return rank !== otherRank ? rank < otherRank : name < other;
}

/**
 * What a script argument runs: `read×2 powershell`, in the order it names them.
 *
 * A codemode call is told apart by the tools inside it, not by its opening
 * `const`; a script that names no tool keeps its own text.
 */
function nestedCalls(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const counts = new Map<string, number>();
	for (const [, name] of value.matchAll(NESTED_CALL)) {
		if (name === undefined) continue;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	if (counts.size === 0) return undefined;
	return [...counts].map(([name, count]) => (count === 1 ? name : `${name}×${count}`)).join(" ");
}

/**
 * One argument value, squeezed into the room a folded row has for it.
 *
 * `JSON.stringify` writes a newline as `\n` and every quote and backslash as
 * two characters, so a script argument would spend the whole row on escapes and
 * name nothing. Strings are therefore shown as they read, flattened to one
 * line; everything else keeps its JSON shape. What is still too long is cut
 * with `…`.
 */
function previewValue(value: unknown): string {
	const text = typeof value === "string" ? value.replaceAll(/\s+/g, " ").trim() : jsonish(value);
	return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
}

function jsonish(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/**
 * One click on the summary line flips the whole group:
 *
 *   0  ▸ 6 calls · …           summary only
 *   1  ▾ 6 calls · …           one row per call, results still folded
 *      clicking a call's own row toggles that call's result, nothing else
 *
 * So one click from level 1 — or from a group with results open — folds
 * everything back. The summary line is the group's switch; a call's own row is
 * not, which is what `withPointerClick` below protects.
 */
export function toggleGroupLevel(component: object): void {
	const group = groupOfTool.get(component);
	if (!group) return;
	if (group.level === 0) {
		group.level = 1;
		return;
	}
	group.level = 0;
	for (const member of group.members) member.setExpanded(false);
}

/**
 * Pi calls `setExpanded` from two very different places: `ctrl+o` drives every
 * box from one global flag, and a click on one call's row toggles just that box
 * inside its `MouseRegion`. The same boolean arrives either way, so the handler
 * that forwards clicks marks them with `withPointerClick`:
 *
 *   - global expand:   level 1, every call's row on screen
 *   - global collapse: level 0 once no member is expanded any more
 *   - a row click:     one member's result; collapsing it leaves the group at
 *                      level 1, so folding the group stays an explicit action
 *
 * A single-member group proves the flag is needed: `ctrl+o` and a click look
 * identical in member state there.
 *
 * Returns whether the level changed, so the patch can request one more frame.
 */

/** >0 only while a click is being forwarded to Pi's own row handlers. */
let pointerDepth = 0;

/** Run Pi's mouse dispatch with the click source marked. */
export function withPointerClick<T>(run: () => T): T {
	pointerDepth++;
	try {
		return run();
	} finally {
		pointerDepth--;
	}
}

export function noteExpanded(tool: object, expanded: boolean): boolean {
	const group = groupOfTool.get(tool);
	if (!group) return false;
	const before = group.level;
	if (expanded) group.level = 1;
	// A click closes one result only, so the group keeps its rows on screen.
	else if (pointerDepth === 0 && !group.members.some((member) => member.expanded)) group.level = 0;
	return group.level !== before;
}

export function summaryFor(tool: object, config: FoldConfig): GroupSummary | undefined {
	const group = groupOfTool.get(tool);
	if (!group) return undefined;
	const counts = new Map<string, number>();
	let durationMs = 0;
	const failures: Array<{ name: string; durationMs?: number }> = [];
	let running: string | undefined;
	let images = 0;
	for (const member of group.members) {
		counts.set(member.toolName, (counts.get(member.toolName) ?? 0) + 1);
		if (!member.isPartial && member.result?.isError === true) failures.push({ name: member.toolName, durationMs: member.result.durationMs });
		const duration = member.result?.durationMs;
		if (typeof duration === "number" && Number.isFinite(duration)) durationMs += duration;
		images += imageCount(member);
		if (config.showRunning && member.isPartial && running === undefined) running = member.toolName;
	}
	const breakdown = [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	return { count: group.members.length, breakdown, thoughts: group.thoughts, images, durationMs, failures, running };
}

/**
 * A message that only thinks and calls tools. Its thinking is counted into the
 * group; folded, the message draws nothing, so no bare `Thinking...` is left
 * behind next to a summary line that already says how many runs there were.
 */
export function planCarrier(component: object, runs: readonly string[]): CarrierPlan {
	let group = groupOfCarrier.get(component);
	if (!group) {
		group = current;
		groupOfCarrier.set(component, group);
		group.hasCarrier = true;
	}
	const counted = group.counted.get(component) ?? 0;
	if (runs.length !== counted) {
		group.thoughts = Math.max(0, group.thoughts + runs.length - counted);
		group.counted.set(component, runs.length);
		lateJoin = true;
	}
	// Thinking comes back only when ctrl+o opened every call: a click that opens
	// one result must not dump the whole group's reasoning into the transcript.
	if (group.members.length === 0 || group.members.every((member) => member.expanded)) return "native";
	return "hidden";
}

/**
 * The message grew text and became a boundary: its runs are no longer rows of
 * the old group, so they must stop being counted there.
 */
export function dropCarrier(component: object): void {
	const group = groupOfCarrier.get(component);
	if (!group) return;
	const counted = group.counted.get(component) ?? 0;
	if (counted === 0) return;
	group.thoughts = Math.max(0, group.thoughts - counted);
	group.counted.set(component, 0);
	lateJoin = true;
}

/**
 * - `boundary`: has visible text → starts a group, renders as usual
 * - `carrier`:  only thinking and/or tool calls → folds into the current group
 * - `plain`:    an error, an abort or a truncation notice → renders as usual
 */
export function classifyAssistant(message: unknown): AssistantRole {
	if (!isRecord(message) || !Array.isArray(message.content)) return "boundary";
	let hasToolCall = false;
	let hasThinking = false;
	for (const block of message.content as unknown[]) {
		if (!isRecord(block)) continue;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim()) return "boundary";
		if (block.type === "toolCall") hasToolCall = true;
		if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) hasThinking = true;
	}
	// A length stop renders "Response was truncated", and errors/aborts carry the
	// message the turn ended on — never fold those away.
	const terminal = message.stopReason === "length" || message.stopReason === "error" || message.stopReason === "aborted";
	if (hasToolCall) return message.stopReason === "length" ? "plain" : "carrier";
	// A step that only thought (the last one of a turn often does) has nothing to
	// show but a `Thinking...` label: it belongs to the group like any other run.
	if (hasThinking && !terminal) return "carrier";
	return "plain";
}

/**
 * The message's thinking, one entry per run: Pi renders consecutive thinking
 * blocks as one block, so a run is what a single label stands for.
 */
export function thinkingRuns(message: unknown): string[] {
	if (!isRecord(message) || !Array.isArray(message.content)) return [];
	const content = message.content as unknown[];
	const runs: string[] = [];
	for (let i = 0; i < content.length; i++) {
		const block = content[i];
		if (!isRecord(block) || block.type !== "thinking") continue;
		const texts: string[] = [];
		for (; i < content.length; i++) {
			const next = content[i];
			if (!isRecord(next) || next.type !== "thinking") break;
			if (typeof next.thinking === "string" && next.thinking.trim()) texts.push(next.thinking.trim());
		}
		i--;
		if (texts.length > 0) runs.push(texts.join("\n\n"));
	}
	return runs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
