import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadFoldConfig } from "./config.ts";
import { installPatches } from "./patches.ts";
import { getRuntime, setRuntime } from "./runtime.ts";
import { resetState } from "./state.ts";

/**
 * Fold one assistant segment's thinking and tool calls into a single summary
 * line: `▸ 4 calls · bash×3 read×1 · ✻ 2 thoughts · 1.2s`.
 *
 * Folded, the group is one summary line. Clicking it opens one line per call
 * inside the group; clicking a call's line opens Pi's own card, whose first row
 * carries the open arrow and the state, and clicking it again closes just that
 * result. Clicking the summary folds everything, and
 * `ctrl+o` opens or folds every call at once.
 *
 * Only the rows are folded: nothing is registered as a tool, the model still
 * receives every result, and every expanded view is exactly what Pi renders
 * without this extension.
 *
 * Terminal graphics are the one exception: the caption and the image stay
 * outside the card, shifted to its text column; the rows the image covers stay
 * empty because the TUI counts them, so nothing is clipped or painted over.
 */
export default function foldRuns(pi: ExtensionAPI): void {
	const applyConfig = (ctx: ExtensionContext) => {
		const loaded = loadFoldConfig(ctx.cwd, ctx.isProjectTrusted());
		setRuntime({ config: loaded.config, source: loaded.source });
		if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
	};

	pi.on("session_start", (_event, ctx) => {
		resetState();
		applyConfig(ctx);
	});
	pi.on("session_tree", () => resetState());
	pi.on("session_shutdown", () => resetState());

	installPatches();

	pi.registerCommand("fold", {
		description: "Show tool-group folding settings",
		handler: async (_args, ctx) => {
			ctx.ui.notify(describe(), getRuntime().config.enabled ? "info" : "warning");
		},
	});
}

function describe(): string {
	const { config, source } = getRuntime();
	const pinned = config.pinned.length > 0 ? `, pinned ${config.pinned.join(", ")}` : "";
	return `Fold runs ${config.enabled ? "on" : "off"}${pinned} · settings: ${source ?? "built-in defaults"} · expand with Ctrl+O`;
}
