import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadFoldConfig } from "./config.ts";
import { foldToolRenderers } from "./render.ts";
import { getRuntime, setRuntime } from "./runtime.ts";

/**
 * Fold every tool card to one row by wrapping Pi's own tool renderers.
 *
 * `registerToolRenderer` is the documented way into the transcript, so nothing
 * here patches a Pi class or reads a private field: the call renderer keeps its
 * first visible row, the collapsed result renderer draws no rows, and an expanded
 * card hands both back to Pi byte for byte. Only rendering changes; tool
 * execution, permissions, and the result the model sees are untouched.
 */
export default function foldRuns(pi: ExtensionAPI): void {
	let commandRegistered = false;
	pi.registerToolRenderer(foldToolRenderers);

	pi.on("session_start", (_event, ctx) => {
		// Print, JSON and RPC runs must keep Pi's own rows.
		if (ctx.mode !== "tui") {
			setRuntime({ config: { enabled: false, pinned: [] } });
			return;
		}

		const loaded = loadFoldConfig(ctx.cwd, ctx.isProjectTrusted());
		setRuntime({ config: loaded.config, source: loaded.source });
		if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
		if (commandRegistered) return;

		pi.registerCommand("fold", {
			description: "Show per-call folding settings",
			handler: async (_args, ctx) => {
				ctx.ui.notify(describe(), getRuntime().config.enabled ? "info" : "warning");
			},
		});
		commandRegistered = true;
	});
}

function describe(): string {
	const { config, source } = getRuntime();
	const pinned = config.pinned.length > 0 ? `, pinned ${config.pinned.join(", ")}` : "";
	const parts = [`Fold runs ${config.enabled ? "on (one row per call)" : "off"}${pinned}`];
	parts.push(`pi ${VERSION}`, `settings: ${source ?? "built-in defaults"}`, "expand with Ctrl+O");
	parts.push("cards without call and result renderers, and image results stay native");
	return parts.join(" · ");
}
