import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** A picture needs the blank rows it covers, so a card that renders one stays native. */
const IMAGE_MARKERS = ["\x1b_G", "\x1b]1337;File="];

export interface FoldRowOptions {
	/** Appended after the row, e.g. codemode's call counts. */
	info?: string;
	/**
	 * Keep the blank rows the component draws above and below the folded row. Pi's
	 * default shell supplies that padding around a renderer, but a
	 * `renderShell: "self"` tool pads inside its own component, so dropping them
	 * would leave a card without the background rows every other card has.
	 */
	ownPadding?: boolean;
}

/**
 * The rows a collapsed call draws: its first visible row, plus the tool's own
 * padding rows when the tool renders its own shell.
 *
 * Pi's default shell (background, horizontal padding, the blank rows above and
 * below) wraps whatever a renderer returns, so folding only picks which call rows
 * survive. A self-rendered shell has no such wrapper: its rows carry the
 * background and padding themselves, so its blank rows have to be kept as-is.
 * `undefined` means nothing could be kept safely and the caller draws the native rows.
 */
export function foldCallRow(native: readonly string[], width: number, options: FoldRowOptions = {}): string[] | undefined {
	if (native.some((line) => IMAGE_MARKERS.some((marker) => line.includes(marker)))) return undefined;
	const index = native.findIndex((line) => stripTerminalSequences(line).trim() !== "");
	if (index === -1) return undefined;

	const line = native[index] ?? "";
	const row = options.info ? appendCallInfo(line, options.info, width) : truncateToWidth(line, width);
	if (!options.ownPadding) return [row];

	// Blank rows straight above the content are the tool's top padding.
	let above = index;
	while (above > 0 && isBlankRow(native[above - 1] ?? "")) above--;
	const next = native[index + 1];
	const below = next !== undefined && isBlankRow(next) ? [next] : [];
	return [...native.slice(above, index), row, ...below];
}

function isBlankRow(line: string): boolean {
	return stripTerminalSequences(line).trim() === "";
}

/** Keep the native row, adding metadata after it while one padding cell stays free. */
function appendCallInfo(line: string, info: string, width: number): string {
	const content = truncateToWidth(line, width);
	const used = visibleWidth(stripTerminalSequences(content).trimEnd());
	const available = width - used - 1;
	if (available < 4) return content;

	const text = truncateToWidth(` · ${stripTerminalSequences(info).replaceAll(/\s+/g, " ")}`, available, "…");
	return `${content}${text}`;
}
