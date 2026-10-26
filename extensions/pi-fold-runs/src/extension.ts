import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadFoldConfig } from "./config.ts";
import { installPatches } from "./patches.ts";
import { getRuntime, getShapeProblem, setRuntime } from "./runtime.ts";
import { resetState } from "./state.ts";
import { checkPiVersion, TESTED_LINE } from "./version.ts";

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
	let activated = false;
	const applyConfig = (ctx: ExtensionContext) => {
		const loaded = loadFoldConfig(ctx.cwd, ctx.isProjectTrusted());
		const version = checkPiVersion();
		// The patches reach into pi's own components: on a pi line they were not
		// written against, prefer pi's rows over a transcript that may be wrong.
		const disabledByVersion = !version.supported && loaded.config.autoDisableOnUnknownVersion;
		setRuntime({
			config: disabledByVersion ? { ...loaded.config, enabled: false } : loaded.config,
			source: loaded.source,
			version,
		});
		if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
		if (loaded.config.enabled && !version.supported) {
			ctx.ui.notify(versionWarning(version.raw, disabledByVersion), "warning");
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		resetState();
		applyConfig(ctx);
		if (activated) return;

		installPatches();
		pi.on("session_tree", () => resetState());
		pi.on("session_shutdown", () => resetState());
		pi.registerCommand("fold", {
			description: "Show tool-group folding settings",
			handler: async (_args, ctx) => {
				const healthy = getRuntime().config.enabled && getShapeProblem() === undefined;
				ctx.ui.notify(describe(), healthy ? "info" : "warning");
			},
		});
		activated = true;
	});
}

function describe(): string {
	const { config, source, version } = getRuntime();
	const pinned = config.pinned.length > 0 ? `, pinned ${config.pinned.join(", ")}` : "";
	const parts = [`Fold runs ${config.enabled ? "on" : "off"}${pinned}`];
	if (version) {
		parts.push(`pi ${version.raw}${version.supported ? "" : ` (untested, expected ${TESTED_LINE})`}`);
	}
	const problem = getShapeProblem();
	if (problem) parts.push(`pi's component shape changed: ${problem}`);
	parts.push(`settings: ${source ?? "built-in defaults"}`, "expand with Ctrl+O");
	return parts.join(" · ");
}

/** An untested pi is reported; `autoDisableOnUnknownVersion` decides whether it is also obeyed. */
function versionWarning(raw: string, disabled: boolean): string {
	const head = `pi-fold-runs: pi ${raw} is outside the tested ${TESTED_LINE}`;
	return disabled
		? `${head}; folding is off. Check the transcript, then set autoDisableOnUnknownVersion: false to turn it back on.`
		: `${head}; folding stays on, but check the transcript.`;
}
