/** Read-only literal preview, with schema-validated JSON editing on demand. */
import {
	type ExtensionCommandContext, DynamicBorder, ExtensionEditorComponent, getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import {
	Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi,
	type MarkdownTheme, type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { HANDOFF_INTRO, handoffSections, validateHandoffData, type HandoffData } from "./data.ts";
import type { HandoffDestination } from "./options.ts";

export const PANEL_RESERVED_ROWS = 2;

function panelRowBudget(termRows: number): number {
	return Math.max(1, Math.min(Math.floor(termRows * 0.92), termRows - PANEL_RESERVED_ROWS));
}

/** Render the plain prompt verbatim; only section headings and list markers get styling. */
function previewLines(data: HandoffData, width: number, theme: MarkdownTheme): string[] {
	const lines: string[] = [];
	const wrap = (text: string, prefix = "", indent = ""): void => {
		const available = Math.max(1, width - visibleWidth(prefix));
		const chunks = text === "" ? [""] : wrapTextWithAnsi(text, available);
		for (const [index, chunk] of chunks.entries()) {
			lines.push(`${index === 0 ? prefix : indent}${chunk}`);
		}
	};
	wrap(HANDOFF_INTRO);
	for (const { title, body } of handoffSections(data)) {
		lines.push("", theme.heading(title), "");
		for (const line of body.split("\n")) {
			if (line === "") { lines.push(""); continue; }
			const item = /^((?:- |\d+\. ))(.*)$/.exec(line);
			if (item) wrap(item[2], theme.listBullet(item[1]), " ".repeat(visibleWidth(item[1])));
			else wrap(line);
		}
	}
	return lines;
}

interface ReviewOperation {
	cancelUI?: () => void;
}

/** Bottom overlay used by the literal preview; the JSON editor is inline. */
const OVERLAY = {
	overlay: true,
	overlayOptions: {
		anchor: "bottom-center" as const,
		width: "100%" as const,
		margin: { bottom: PANEL_RESERVED_ROWS },
	},
};

export async function reviewHandoff(
	ctx: ExtensionCommandContext,
	initial: HandoffData,
	options: { destination: HandoffDestination; operation: ReviewOperation; isValid: () => boolean },
): Promise<HandoffData | undefined> {
	let data = validateHandoffData(initial);
	const { operation, isValid } = options;
	const destination = options.destination === "here" ? "same pane"
		: options.destination === "tab" ? "new herdr tab" : `split ${options.destination}`;

	while (isValid()) {
		const action = await ctx.ui.custom<"accept" | "edit" | undefined>((tui, theme, kb, done) => {
			const finish = (value: "accept" | "edit" | undefined) => {
				if (operation.cancelUI !== cancelUI) return;
				operation.cancelUI = undefined;
				done(value);
			};
			const cancelUI = () => finish(undefined);
			operation.cancelUI = cancelUI;
			const markdownTheme = getMarkdownTheme();
			let previewWidth = -1;
			let previewBody: string[] = [];
			const buildPreview = (width: number): string[] => {
				if (width !== previewWidth) {
					previewWidth = width;
					previewBody = previewLines(data, width, markdownTheme);
				}
				return previewBody;
			};
			const border = new DynamicBorder((text) => theme.fg("border", text));
			let offset = 0;
			let viewport = 1;
			let contentHeight = 0;
			const confirm = kb.getKeys("tui.select.confirm").join("/");
			const cancel = kb.getKeys("tui.select.cancel").join("/");
			const scrollKeys = ["j", "k", ...kb.getKeys("tui.select.up"), ...kb.getKeys("tui.select.down")].join("/");
			const keyHint = (keys: string, description: string) =>
				theme.fg("dim", keys.toLowerCase()) + theme.fg("muted", ` ${description}`);

			return {
				render(width: number): string[] {
					if (width < 1) return [];
					const budget = panelRowBudget(tui.terminal.rows ?? 24);
					const title = budget >= 6
						? [theme.fg("accent", `Review structured handoff → ${destination} (nothing sent)`)] : [];
					const hintRows = budget >= 5 ? 2 : budget >= 4 ? 1 : 0;
					// Reserve the frame and hints before sizing content; drop chrome on short terminals.
					viewport = Math.max(0, budget - Math.min(2, budget) - title.length - hintRows);
					const lines = buildPreview(width);
					contentHeight = lines.length;
					offset = Math.min(offset, Math.max(0, contentHeight - viewport));
					const separator = theme.fg("muted", " · ");
					const actions = [keyHint(confirm, "confirm"), keyHint("ctrl+e", "edit json"), keyHint(cancel, "cancel")].join(separator);
					const navigation = keyHint(`${scrollKeys} pageup/pagedown home/end`, `scroll (${offset + 1}/${contentHeight})`)
						+ (tui.mode === "fullscreen" ? theme.fg("muted", " / wheel") : "");
					const hints = hintRows === 2 ? [actions, navigation]
						: hintRows === 1 ? [`${keyHint("j/k", "scroll")}${separator}${actions}`] : [];
					const frame = border.render(width);
					return [
						...frame,
						...title,
						...lines.slice(offset, offset + viewport),
						...hints,
						...(budget > 1 ? frame : []),
					].map((line) => truncateToWidth(line, width));
				},
				handleInput(input: string): void {
					if (!isValid() || operation.cancelUI !== cancelUI) return;
					if (kb.matches(input, "tui.select.cancel")) return cancelUI();
					if (kb.matches(input, "tui.select.confirm")) return finish("accept");
					if (matchesKey(input, Key.ctrl("e"))) return finish("edit");
					if (kb.matches(input, "tui.select.up") || matchesKey(input, "k")) offset--;
					else if (kb.matches(input, "tui.select.down") || matchesKey(input, "j")) offset++;
					else if (matchesKey(input, Key.pageUp)) offset -= viewport;
					else if (matchesKey(input, Key.pageDown)) offset += viewport;
					else if (matchesKey(input, Key.home)) offset = 0;
					else if (matchesKey(input, Key.end)) offset = contentHeight;
					else return;
					offset = Math.max(0, Math.min(offset, Math.max(0, contentHeight - viewport)));
					tui.requestRender();
				},
				handleMouse(event: TuiMouseEvent): { handled: true } | undefined {
					if (event.type !== "wheel") return undefined;
					if (!isValid() || operation.cancelUI !== cancelUI) return undefined;
					const delta = event.wheelDelta ?? 0;
					const next = Math.max(0, Math.min(offset + delta, Math.max(0, contentHeight - viewport)));
					if (next !== offset) {
						offset = next;
						tui.requestRender();
					}
					// Consume at the edges too, so the wheel never scrolls the transcript behind the overlay.
					return { handled: true };
				},
				invalidate(): void { previewWidth = -1; },
			};
		}, OVERLAY);
		if (!isValid() || action === undefined) return undefined;
		if (action === "accept") return data;

		let json = JSON.stringify(data, null, 2);
		while (isValid()) {
			const edited = await ctx.ui.custom<string | undefined>((tui, _theme, kb, done) => {
				const finish = (value: string | undefined) => {
					if (operation.cancelUI !== cancelUI) return;
					operation.cancelUI = undefined;
					done(value);
				};
				const cancelUI = () => finish(undefined);
				operation.cancelUI = cancelUI;
				const editor = new ExtensionEditorComponent(
					tui, kb, "Edit handoff JSON (confirm validates; cancel returns to preview)",
					json, finish, cancelUI,
					{ description: "All fields are required. schemaVersion and goal must remain unchanged. External editor disabled to protect pasted text." },
				);
				const renderEditor = editor.render.bind(editor);
				editor.render = (width: number): string[] => {
					const lines = renderEditor(width);
					const budget = panelRowBudget(tui.terminal.rows ?? 24);
					return lines.length > budget ? lines.slice(lines.length - budget) : lines;
				};
				const handleInput = editor.handleInput.bind(editor);
				editor.handleInput = (input) => {
					if (!isValid() || operation.cancelUI !== cancelUI) return;
					if (!kb.matches(input, "tui.select.cancel") && kb.matches(input, "app.editor.external")) {
						ctx.ui.notify("External editor is disabled in handoff review to protect collapsed paste content.", "warning");
						return;
					}
					handleInput(input);
				};
				return editor;
			});
			if (!isValid()) return undefined;
			if (edited === undefined) break;
			json = edited;
			try {
				if (Buffer.byteLength(json, "utf8") > 1024 * 1024) throw new Error("Review JSON exceeds 1 MiB");
				data = validateHandoffData(JSON.parse(json) as unknown, initial.goal);
				break;
			} catch (error) {
				ctx.ui.notify(`Invalid handoff JSON: ${error instanceof Error ? error.message : String(error)}. Draft retained; fix it or cancel back to the preview.`, "warning");
			}
		}
	}
	return undefined;
}
