/**
 * Herdr Extension
 *
 * Mechanical layer for the herdr skills: argv construction, JSON field digging,
 * pane/agent identifier hand-off, and the state gates the handoff flow relies
 * on. Policy — which topology to use, whether a handoff is warranted, how to
 * phrase it — stays in the `herdr` and `herdr-handoff` skills.
 *
 * Tools are declared only inside a Herdr pane (HERDR_ENV=1 plus a non-empty
 * HERDR_PANE_ID). Outside one there is nothing they could talk to, so they are
 * registered as `hidden` and cost no prompt space.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callHerdr } from "./src/cli.ts";
import { checkCompatibility, isHerdrPane } from "./src/gates.ts";
import { type HerdrSessionState, type HerdrToolExposure, registerHerdrTools } from "./src/tools.ts";

const STATUS_TIMEOUT_MS = 5_000;

export default function herdr(pi: ExtensionAPI) {
	const state: HerdrSessionState = { warning: null };
	let exposure: HerdrToolExposure | undefined;

	// Tools cannot be unregistered, so the exposure is re-applied for every
	// session: a session that is not inside a Herdr pane never declares them.
	const applyExposure = (next: HerdrToolExposure) => {
		if (exposure === next) return;
		exposure = next;
		registerHerdrTools(pi, state, next);
	};

	applyExposure("hidden");

	pi.on("session_start", async (_event, ctx) => {
		const inside = isHerdrPane();
		state.warning = null;
		applyExposure(inside ? "direct" : "hidden");
		if (!inside) return;

		// A protocol change makes optional fields disappear, which otherwise
		// reads as "missing data" inside the tools. Name the real cause early.
		try {
			const status = await callHerdr({ args: ["status", "--json"] }, STATUS_TIMEOUT_MS);
			const report = checkCompatibility(status);
			if (report.compatible) return;
			state.warning = `Herdr protocol check failed. ${report.reason ?? ""}`.trim();
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			state.warning = `Herdr protocol check failed: ${detail}`;
		}
		if (ctx.hasUI) ctx.ui.notify(state.warning, "warning");
	});
}
