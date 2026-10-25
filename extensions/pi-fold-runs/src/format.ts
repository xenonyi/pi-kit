import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CallRow, GroupSummary } from "./state.ts";
import type { ThemeLike } from "./theme.ts";

/** One line per call; `└` closes the list. */
const ROW_PREFIX = " ├ ";
const ROW_PREFIX_LAST = " └ ";
/** Gutter under an opened result: the branch continues, or closes on the last call. */
const CHILD_GUTTER = " │ ";
const CHILD_CLOSED = "   ";
/** Terminal graphics prefixes, mirroring pi-tui's (unexported) image check. */
const KITTY_PREFIX = "\x1b_G";
const ITERM2_PREFIX = "\x1b]1337;File=";
export const CHILD_INDENT = 3;
/** One extra card column, so card text lines up with the call rows above. */
const CARD_PAD = 1;
export const CARD_INDENT = CHILD_INDENT + CARD_PAD;

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
 * starts to the right of the trunk), one extra card column that lines the text
 * up with the call rows above, and a clip.
 *
 * Pi puts a `Spacer(1)` above its card. That row is dropped and `skip` tells
 * the mouse patch how many rows Pi still counts above the body.
 *
 * Images are the exception: the caption and the image stay outside the card.
 * Their rows cannot be clipped, painted or wrapped, so they are shifted to the
 * text column with plain padding only, and the blank rows an image covers stay
 * empty because the TUI counts them.
 * If Pi drew no graphics row at all the caller gets `passthrough`.
 */
export interface NestedResult {
	lines: string[];
	indent: number;
	/** Rows Pi rendered above the first row kept here (its own spacer). */
	skip: number;
	/** The first body row is Pi's top padding, which the status strip replaces. */
	blankTop: boolean;
	/** The block has images but drew no graphics row: never indent or clip it. */
	passthrough?: boolean;
}

/** The rows one image occupies: kitty starts at the sequence, iTerm2 ends on it. */
interface ImageSpan {
	start: number;
	end: number;
}

export function nestResult(
	native: string[],
	theme: ThemeLike | undefined,
	width: number,
	images: boolean,
	last: boolean,
	card: string,
	labels?: readonly string[],
): NestedResult {
	if (!theme) return { lines: native, indent: 0, skip: 0, blankTop: false };
	const skip = native[0] === "" ? 1 : 0;
	const body = skip === 1 ? native.slice(1) : native;
	const blankTop = body.length > 0 && isBlankRow(body[0] ?? "");
	const spans = images ? imageSpans(body) : [];
	if (images && spans.length === 0) {
		return { lines: body, indent: 0, skip, blankTop, passthrough: true };
	}
	const graphics = new Set<number>();
	for (const span of spans) {
		for (let index = span.start; index <= span.end; index++) graphics.add(index);
	}
	const captions = new Map<number, string>();
	for (let i = 0; i < spans.length; i++) {
		const span = spans[i];
		const label = labels?.[i];
		if (!span || !label) continue;
		if (span.start > 0 && isBlankRow(body[span.start - 1] ?? "")) captions.set(span.start - 1, label);
	}
	const prefix = theme.fg("muted", last ? CHILD_CLOSED : CHILD_GUTTER);
	const pad = theme.bg(card, " ".repeat(CARD_PAD));
	// The caption and the image stay outside the card: their rows cannot be
	// painted or clipped, so they only get plain padding up to the text column.
	const outside = " ".repeat(CARD_PAD + 1);
	const inner = Math.max(0, width - CARD_INDENT);
	const outsideInner = Math.max(0, width - CHILD_INDENT - outside.length);
	return {
		lines: body.map((line, index) => {
			const caption = captions.get(index);
			if (caption) {
				const text = `${theme.fg("accent", imageGlyph())} ${theme.fg("muted", caption)}`;
				return `${prefix}${outside}${truncateToWidth(text, outsideInner, "…")}`;
			}
			if (graphics.has(index)) {
				return isImageLine(line) ? `${prefix}${outside}${line}` : line;
			}
			if (visibleWidth(line) === 0) return `${prefix}${pad}${theme.bg(card, " ".repeat(inner))}`;
			return `${prefix}${pad}${truncateToWidth(line, inner, "…")}`;
		}),
		indent: CARD_INDENT,
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

/**
 * The row spans of one nested block that belong to terminal graphics.
 *
 * Kitty puts the sequence on the first row it covers and pads the rest with
 * blank rows; iTerm2 puts it on the last row and reserves the blanks above.
 * Writing a gutter into those rows would paint over the image.
 */
function imageSpans(native: readonly string[]): ImageSpan[] {
	const spans: ImageSpan[] = [];
	for (let i = 0; i < native.length; i++) {
		const line = native[i] ?? "";
		if (!isImageLine(line)) continue;
		const covered = kittyRows(line) || (line.includes(KITTY_PREFIX) ? 1 : 0);
		if (covered > 0) {
			spans.push({ start: i, end: Math.min(native.length, i + covered) - 1 });
			continue;
		}
		let start = i;
		for (let row = i - 1; row >= 0 && (native[row] ?? "") === ""; row--) start = row;
		spans.push({ start, end: i });
	}
	return spans;
}

/** Rows a kitty sequence covers, `0` when this line is not a kitty sequence. */
function kittyRows(line: string): number {
	const start = line.indexOf(KITTY_PREFIX);
	if (start < 0) return 0;
	const end = line.indexOf(";", start);
	if (end < 0) return 0;
	// Only the parameter list: base64 payload can contain `r=` by accident.
	const match = /(?:^|,)r=(\d+)(?:,|$)/.exec(line.slice(start + KITTY_PREFIX.length, end));
	const rows = match ? Number(match[1]) : 0;
	return Number.isInteger(rows) && rows > 1 ? rows : 0;
}

/**
 * Mirror of pi-tui's `isImageLine`, which the package does not export: the
 * sequence starts the row (kitty, iTerm2) or follows a cursor-up prefix
 * (multi-row iTerm2).
 */
function isImageLine(line: string): boolean {
	return line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX);
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
