import { homedir } from "node:os";
import { formatReadLineRange, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/**
 * Card rendering for the hashline tools.
 *
 * Pi draws a tool call and its result through the tool's own renderers; without
 * them the generic fallback prints the whole arguments object and a truncated
 * result. These follow the shape of the built-in `read` and `edit` cards: the
 * call is one identifying line, a collapsed result draws nothing (or an applied
 * summary for edits), and an expanded result shows the stored hashline rows.
 */

type AnyDefinition = ToolDefinition<any, any, any>;
type RenderCall = NonNullable<AnyDefinition["renderCall"]>;
type RenderResult = NonNullable<AnyDefinition["renderResult"]>;
type Theme = Parameters<RenderCall>[1];
type CallContext = Parameters<RenderCall>[2];
type ResultContext = Parameters<RenderResult>[3];

/** The call arguments these cards read. */
interface ReadArgs {
	path?: string;
	offset?: number;
	limit?: number;
}

interface EditArgs {
	path?: string;
}

/** The fields of `formatRead`'s view these cards read. */
interface HashView {
	text: string;
	changed?: boolean;
	deletedLines?: number;
	insertedLines?: number;
}

export const hashReadRenderers = {
	renderCall(rawArgs, theme, context) {
		const args = rawArgs as ReadArgs;
		const text = reusable(context);
		const range = formatReadLineRange(args.offset, args.limit);
		text.setText(`${title("hash_read", theme)} ${styledPath(args.path, theme)}${range ? theme.fg("warning", range) : ""}`);
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = reusable(context);
		const body = editable(viewOf(result)?.text ?? contentText(result)).trimEnd();
		if (context.isError) text.setText(`\n${theme.fg("error", body)}`);
		// Collapsed, a read shows no output: folded cards keep one row, and with
		// folding off this is what the built-in `read` card does too.
		else if (!options.expanded) text.setText("");
		else text.setText(`\n${tint(body, theme)}`);
		return text;
	},
} satisfies Partial<AnyDefinition>;

export const hashEditRenderers = {
	renderCall(rawArgs, theme, context) {
		const text = reusable(context);
		text.setText(`${title("hash_edit", theme)} ${styledPath((rawArgs as EditArgs).path, theme)}`);
		return text;
	},
	renderResult(result, options, theme, context) {
		const text = reusable(context);
		const view = viewOf(result);
		const body = editable(view?.text ?? contentText(result)).trimEnd();
		if (context.isError) {
			text.setText(`\n${theme.fg("error", body)}`);
			return text;
		}
		const summary = editSummary(view, theme);
		text.setText(options.expanded ? `${summary}\n\n${tint(body, theme)}` : summary);
		return text;
	},
} satisfies Partial<AnyDefinition>;

/** Reuse the component Pi hands back, like Pi's own renderers do. */
function reusable(context: CallContext | ResultContext): Text {
	return context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
}

function title(name: string, theme: Theme): string {
	return theme.fg("toolTitle", theme.bold(name));
}

/** Accent path with the home directory shortened, matching Pi's tool headers. */
function styledPath(rawPath: unknown, theme: Theme): string {
	const path = typeof rawPath === "string" ? rawPath : "";
	if (!path) return theme.fg("toolOutput", "...");
	const home = homedir();
	const shown = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
	return theme.fg("accent", shown);
}

function editSummary(view: HashView | undefined, theme: Theme): string {
	if (!view) return "";
	if (view.changed === false) return theme.fg("muted", "unchanged");
	const added = view.insertedLines ?? 0;
	const removed = view.deletedLines ?? 0;
	return `${theme.fg("success", `+${added}`)}${theme.fg("dim", " / ")}${theme.fg("error", `-${removed}`)}`;
}

/** Tabs and stray carriage returns are not valid card content. */
function editable(text: string): string {
	return text.replaceAll("\t", "   ").replaceAll("\r", "");
}

function tint(body: string, theme: Theme): string {
	return body
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
}

function viewOf(result: { details?: unknown }): HashView | undefined {
	const details = result.details;
	if (typeof details !== "object" || details === null) return undefined;
	return typeof (details as HashView).text === "string" ? (details as HashView) : undefined;
}

function contentText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
}
