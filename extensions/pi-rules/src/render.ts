/**
 * Turns fragments into an injectable plan: which fragments apply, which are
 * dropped and why, and the exact section and guideline text for this run.
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
	PlannedSection,
	RulesState,
} from "./types.ts";

const RULE_PREFIX = /^[-*]\s+/;
const SECTION_PREFIX = "pi_rules_";
const SECTION_GROUP_PATTERN = /[^a-z0-9_-]+/g;

/** System-prompt section name for a fragment group, normalized for pi's validator. */
function sectionTag(group: string): string {
	const normalized = group
		.trim()
		.toLowerCase()
		.replace(SECTION_GROUP_PATTERN, "_")
		.replace(/^[^a-z]+/, "");
	const safe = normalized === "" ? "extra" : normalized;
	return safe.startsWith(SECTION_PREFIX) ? safe : `${SECTION_PREFIX}${safe}`;
}

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
	const sectionBuckets = new Map<string, string[]>();
	const activeInfo: ActiveFragment[] = [];

	for (const fragment of active) {
		activeInfo.push({ id: fragment.meta.id, chars: fragment.body.length });

		if (fragment.meta.target === "rule") {
			for (const raw of fragment.body.split("\n")) {
				const line = raw.trim().replace(RULE_PREFIX, "");
				if (!line || seenGuidelines.has(line)) continue;
				seenGuidelines.add(line);
				guidelines.push(line);
			}
			continue;
		}

		const tag = sectionTag(fragment.meta.group);
		const bodies = sectionBuckets.get(tag) ?? [];
		bodies.push(fragment.body.trim());
		sectionBuckets.set(tag, bodies);
	}

	const sections: PlannedSection[] = [...sectionBuckets.entries()].map(([tag, bodies]) => ({
		tag,
		content: bodies.join("\n\n"),
	}));

	const chars =
		guidelines.reduce((sum, line) => sum + line.length, 0) +
		sections.reduce((sum, section) => sum + section.content.length, 0);

	return { sections, guidelines, active: activeInfo, dropped, chars };
}
