import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CallRow, GroupSummary } from "./state.ts";
import type { ThemeLike } from "./theme.ts";

/** One line per call; `└` closes the list. */
const ROW_PREFIX = " ├ ";
const ROW_PREFIX_LAST = " └ ";
/** Gutter under an opened result: the branch continues, or closes on the last call. */
const CHILD_GUTTER = " │ ";
const CHILD_CLOSED = "   ";
/** Columns pi's card text is offset from the gutter, so it lines up with the rows above. */
const CARD_TEXT_OFFSET = 2;
export const CHILD_INDENT = 3;

/**
 * One image pi drew for a call: the caption for the row above it, and how many
 * rows it covers.
 *
 * The row count comes from pi's own image component rather than from parsing
 * the escape sequence: kitty and iTerm2 put the sequence on different rows, and
 * nothing here needs to know which protocol drew it.
 */
export interface ImageRun {
	label?: string;
	rows: number;
}

/** Width reserved left of pi's card: the gutter plus the card's own offset. */
export function cardIndent(padLeft: number): number {
	return CHILD_INDENT + Math.max(0, CARD_TEXT_OFFSET - padLeft);
}

/**
 * Columns pi pads inside its card: its `outputPad`, 0 or 1.
 *
 * That field is private, so when pi stops exposing it the padding is measured
 * from pi's own rows instead: the leading whitespace most content rows carry
 * is that padding. A larger number is content indentation, not padding, so the
 * answer never leaves 0 or 1.
 */
export function measurePadLeft(lines: readonly string[]): number {
	const counts = new Map<number, number>();
	for (const line of lines) {
		const text = stripTerminalSequences(line);
		if (text.trim() === "") continue;
		const lead = text.length - text.trimStart().length;
		counts.set(lead, (counts.get(lead) ?? 0) + 1);
	}
	let best = 0;
	let bestCount = 0;
	for (const [lead, count] of counts) {
		if (count > bestCount) {
			best = lead;
			bestCount = count;
		}
	}
	return best >= 1 ? 1 : 0;
}

/** `▸ 4 calls · bash×3 read×1 · ✻ 2 thoughts · ▦ 1 · 1.2s` (`▾` once the group is open) */
export function formatSummary(summary: GroupSummary, theme: ThemeLike, width: number, open = false): string {
	const sep = theme.fg("muted", " · ");
	const parts = [
		`${theme.fg("accent", open ? "▾" : "▸")} ${theme.fg("toolTitle", theme.bold(`${summary.count} ${plural(summary.count, "call")}`))}`,
	];
	const breakdown = summary.breakdown.map(({ name, count }) => theme.fg("muted", `${name}×${count}`));
	if (breakdown.length > 0) parts.push(breakdown.join(theme.fg("muted", " ")));
	if (summary.thoughts > 0) {
		parts.push(theme.fg("warning", `✻ ${summary.thoughts} ${plural(summary.thoughts, "thought")}`));
	}
	if (summary.images > 0) parts.push(theme.fg("accent", `${imageGlyph()} ${summary.images}`));
	const failed = summary.failures.length;
	if (failed > 0) parts.push(theme.fg("error", `${failed} failed`));
	if (summary.running) parts.push(theme.fg("warning", `running ${summary.running}`));
	else if (summary.durationMs > 0) parts.push(theme.fg("muted", formatDuration(summary.durationMs)));
	return truncateToWidth(` ${parts.join(sep)}`, width, "…");
}

/** ` ├ ▸ read  src/state.ts            0.2s` — one folded call inside the group. */
export function formatCallRow(row: CallRow, theme: ThemeLike, width: number, last: boolean): string {
	const prefix = theme.fg("muted", last ? ROW_PREFIX_LAST : ROW_PREFIX);
	const arrow = theme.fg("accent", row.expanded ? "▾" : "▸");
	const marker = row.images ? theme.fg("accent", imageGlyph()) : "";
	const status = [marker, formatStatus(row, theme)].filter((part) => part.length > 0).join(" ");
	const statusWidth = status ? visibleWidth(status) + 1 : 0;
	const bodyWidth = Math.max(1, width - visibleWidth(prefix) - statusWidth);
	const preview = row.preview ? ` ${theme.fg("muted", row.preview)}` : "";
	const body = truncateToWidth(`${arrow} ${theme.fg("toolTitle", row.name)}${preview}`, bodyWidth, "…");
	const pad = " ".repeat(Math.max(0, bodyWidth - visibleWidth(body)));
	return `${prefix}${body}${pad}${status ? ` ${status}` : ""}`;
}

function formatStatus(row: CallRow, theme: ThemeLike): string {
	if (row.running) return theme.fg("warning", "running");
	const time = typeof row.durationMs === "number" ? formatDuration(row.durationMs) : undefined;
	if (row.failed) return theme.fg("error", time ? `✗ ${time}` : "✗");
	return time ? theme.fg("muted", time) : "";
}

/** Pi's card background for one call: the same rule its own rows use. */
export function cardColor(row: CallRow): string {
	if (row.running) return "toolPendingBg";
	if (row.failed) return "toolErrorBg";
	return "toolSuccessBg";
}

/** Pad one row to the terminal width and paint it with the card color. */
export function paintRow(line: string, theme: ThemeLike, color: string, width: number): string {
	const pad = Math.max(0, width - visibleWidth(line));
	// `truncateToWidth` closes with a full reset; a colour reset keeps the card
	// color alive for the right-hand padding and the status column.
	const body = line.replaceAll("\x1b[0m", "\x1b[22m\x1b[39m");
	return theme.bg(color, `${body}${" ".repeat(pad)}`);
}

/**
 * First row of an expanded call's card, in place of Pi's top padding row: the
 * tree joint, the open arrow, and — only when something is worth reporting —
 * the call's state. The joint stays on the terminal background; the rest of
 * the row is painted with the card color.
 */
export function formatCardStrip(row: CallRow, theme: ThemeLike, width: number, last: boolean, card: string): string {
	const gutter = theme.fg("muted", last ? ROW_PREFIX_LAST : ROW_PREFIX);
	const head = theme.fg("accent", "▾");
	const status = stripStatus(row, theme);
	const tail = status ? ` ${status}` : "";
	const inner = Math.max(0, width - CHILD_INDENT);
	const gap = Math.max(0, inner - visibleWidth(head) - visibleWidth(tail));
	const line = truncateToWidth(`${head}${" ".repeat(gap)}${tail}`, inner, "…");
	return `${gutter}${paintRow(line, theme, card, inner)}`;
}

/** A plain row that keeps the tree trunk running between two cards. */
export function formatTrunkRow(theme: ThemeLike): string {
	return theme.fg("muted", CHILD_GUTTER);
}


/** Only a failure, a live call or an image result earns a status up there. */
function stripStatus(row: CallRow, theme: ThemeLike): string {
	const parts: string[] = [];
	if (row.images) parts.push(theme.fg("accent", imageGlyph()));
	if (row.running) parts.push(theme.fg("warning", "running"));
	else if (row.failed) {
		const time = typeof row.durationMs === "number" ? formatDuration(row.durationMs) : undefined;
		parts.push(theme.fg("error", time ? `✗ ${time}` : "✗"));
	}
	return parts.join(" ");
}

/** Whether a rendered row carries no text (Pi's card padding row does not). */
function isBlankRow(line: string): boolean {
	return stripTerminalSequences(line).trim() === "";
}
/**
 * Pi's own rendering for one opened call, below its status row.
 *
 * The caller replaces Pi's top padding row with the card's status strip; the
 * rest of the card — native call line included — is Pi's own, so the call is
 * never drawn twice. Rows arrive already painted by Pi at the inner width, so
 * they only need the tree gutter (kept on the terminal background, so the card
 * starts to the right of the trunk), pi's own padding column (kept as a card
 * column so the text lines up with the call rows above), and a clip.
 *
 * Pi puts a `Spacer(1)` above its card. That row is dropped and `skip` tells
 * the mouse patch how many rows Pi still counts above the body.
 *
 * Images are the exception: the caption and the image stay outside the card.
 * Their rows cannot be clipped, painted or wrapped, so they are shifted to the
 * text column with plain padding only, and the rows an image covers stay
 * exactly as pi drew them because the TUI counts them.
 * When pi's image rows are not where its own components report them, the caller
 * gets `passthrough` and the block stays at full width.
 */
export interface NestedResult {
	lines: string[];
	indent: number;
	/** Rows Pi rendered above the first row kept here (its own spacer). */
	skip: number;
	/** The first body row is Pi's top padding, which the status strip replaces. */
	blankTop: boolean;
	/** Pi's image rows could not be located: never indent or clip the block. */
	passthrough?: boolean;
}

export function nestResult(
	native: string[],
	theme: ThemeLike | undefined,
	width: number,
	runs: readonly ImageRun[] | null,
	last: boolean,
	card: string,
	padLeft: number,
): NestedResult {
	if (!theme) return { lines: native, indent: 0, skip: 0, blankTop: false };
	const skip = native[0] === "" ? 1 : 0;
	const body = skip === 1 ? native.slice(1) : native;
	const spans = runs === null ? undefined : imageSpans(body, runs);
	if (spans === undefined) {
		return { lines: body, indent: 0, skip, blankTop: false, passthrough: true };
	}
	const graphics = new Set<number>();
	for (const span of spans) {
		for (let index = span.start; index <= span.end; index++) graphics.add(index);
	}
	// Pi's top padding row is where the status strip goes — unless an image
	// already starts there.
	const blankTop = body.length > 0 && isBlankRow(body[0] ?? "") && !graphics.has(0);
	const captions = new Map<number, string>();
	for (const span of spans) {
		if (span.label === undefined) continue;
		if (span.start > 0 && isBlankRow(body[span.start - 1] ?? "")) captions.set(span.start - 1, span.label);
	}
	const indent = cardIndent(padLeft);
	const pad = indent - CHILD_INDENT;
	const prefix = theme.fg("muted", last ? CHILD_CLOSED : CHILD_GUTTER);
	const cardPad = theme.bg(card, " ".repeat(pad));
	// The caption and the image stay outside the card: their rows cannot be
	// painted or clipped, so they only get plain padding up to the text column.
	const outside = " ".repeat(pad + padLeft);
	const inner = Math.max(0, width - indent);
	const outsideInner = Math.max(0, width - CHILD_INDENT - outside.length);
	return {
		lines: body.map((line, index) => {
			const caption = captions.get(index);
			if (caption !== undefined) {
				const text = `${theme.fg("accent", imageGlyph())} ${theme.fg("muted", caption)}`;
				return `${prefix}${outside}${truncateToWidth(text, outsideInner, "…")}`;
			}
			// The rows an image covers keep exactly what pi drew: a gutter written
			// there would land on the image.
			if (graphics.has(index)) return line === "" ? line : `${prefix}${outside}${line}`;
			if (visibleWidth(line) === 0) return `${prefix}${cardPad}${theme.bg(card, " ".repeat(inner))}`;
			return `${prefix}${cardPad}${truncateToWidth(line, inner, "…")}`;
		}),
		indent,
		skip,
		blankTop,
	};
}

/** ` ✗ bash failed · 1.8s` — one row per failed call, right under the summary. */
export function formatFailedRow(
	failure: { name: string; durationMs?: number },
	theme: ThemeLike,
	width: number,
): string {
	const time = typeof failure.durationMs === "number" ? ` ${theme.fg("muted", formatDuration(failure.durationMs))}` : "";
	const line = ` ${theme.fg("error", "✗")} ${theme.fg("toolTitle", failure.name)} ${theme.fg("error", "failed")}${time}`;
	return truncateToWidth(line, width, "…");
}

/** Same shape as Pi's own `Took 1.2s`: seconds, then minutes, then hours. */
export function formatDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const total = Math.floor(seconds);
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m ${total % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One image inside pi's block: the rows it covers and the caption for the row above. */
interface ImageSpan {
	start: number;
	end: number;
	label?: string;
}

/**
 * Where the images sit in pi's block, from the components pi drew them with.
 *
 * Pi appends every image, one `Spacer(1)` row ahead of it, so the block ends
 * with the images in order and their row counts walk backwards from the end.
 * Every row of a span must be control-only — a blank row reserved for the image
 * plus the single row that carries the sequence — and exactly one row must
 * carry it. Anything else means pi lays its images out differently now, and
 * the caller leaves the block untouched.
 *
 * Kitty puts the sequence on the first row it covers and reserves the blanks
 * after it; iTerm2 puts it on the last row, under a cursor-up prefix.
 */
function imageSpans(body: readonly string[], runs: readonly ImageRun[]): ImageSpan[] | undefined {
	if (runs.length === 0) return [];
	const spans: ImageSpan[] = [];
	let cursor = body.length;
	for (let index = runs.length - 1; index >= 0; index--) {
		const rows = runs[index]?.rows ?? 0;
		if (!Number.isInteger(rows) || rows < 1 || rows > cursor) return undefined;
		const start = cursor - rows;
		const span = { start, end: cursor - 1, label: runs[index]?.label };
		if (!holdsGraphics(body, span)) return undefined;
		spans.unshift(span);
		cursor = start;
		if (index > 0) {
			// One `Spacer(1)` row above every image: consuming it keeps the image
			// above aligned as well.
			if (cursor < 1 || body[cursor - 1] !== "") return undefined;
			cursor--;
		}
	}
	return spans;
}

/** Every row of the span is control-only, and exactly one of them draws the image. */
function holdsGraphics(body: readonly string[], span: ImageSpan): boolean {
	let sequences = 0;
	for (let index = span.start; index <= span.end; index++) {
		const line = body[index] ?? "";
		if (visibleWidth(line) !== 0) return false;
		if (line !== "") sequences++;
	}
	return sequences === 1;
}

/** `▦` in the same geometric-shapes set as `▸`/`✻`; `#` if it ever measures wide. */
let glyph: string | undefined;
function imageGlyph(): string {
	glyph ??= visibleWidth("▦") === 1 ? "▦" : "#";
	return glyph;
}
function plural(count: number, one: string): string {
	return count === 1 ? one : `${one}s`;
}
