/**
 * Turns fragments into an injectable plan: which fragments apply, which are
 * dropped and why, and the exact guideline text for this run.
 *
 * The order is the fragment order from the scanner (path order), so the result
 * is stable across runs and machines.
 */

import { matchConditions } from "./conditions.ts";
import type {
	ActiveFragment,
	DroppedFragment,
	Fragment,
	MachineEnv,
	Plan,
	RulesState,
} from "./types.ts";

const RULE_PREFIX = /^[-*]\s+/;

export function buildPlan(fragments: Fragment[], env: MachineEnv, state: RulesState): Plan {
	const disabled = new Set(state.disabled);
	const active: Fragment[] = [];
	const dropped: DroppedFragment[] = [];

	for (const fragment of fragments) {
		if (!fragment.meta.enabled) {
			dropped.push({ id: fragment.meta.id, reason: "disabled in frontmatter" });
			continue;
		}
		if (disabled.has(fragment.meta.id)) {
			dropped.push({ id: fragment.meta.id, reason: "disabled locally" });
			continue;
		}
		const outcome = matchConditions(fragment.meta.conditions, env);
		if (!outcome.matched) {
			dropped.push({ id: fragment.meta.id, reason: outcome.reason ?? "conditions not met" });
			continue;
		}
		active.push(fragment);
	}

	const guidelines: string[] = [];
	const seenGuidelines = new Set<string>();
	const activeInfo: ActiveFragment[] = [];

	for (const fragment of active) {
		activeInfo.push({ id: fragment.meta.id, chars: fragment.body.length });

		for (const raw of fragment.body.split("\n")) {
			const line = raw.trim().replace(RULE_PREFIX, "");
			if (!line || seenGuidelines.has(line)) continue;
			seenGuidelines.add(line);
			guidelines.push(line);
		}
	}

	const chars = guidelines.reduce((sum, line) => sum + line.length, 0);

	return { guidelines, active: activeInfo, dropped, chars };
}
