/**
 * Applies a plan to the mutable prompt options of one run.
 *
 * The previous injection is removed first, so repeated calls in one process
 * cannot accumulate guidelines.
 */

import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { Plan } from "./types.ts";

const injectedGuidelines = new Set<string>();

export function applyPlan(options: NormalizedBuildSystemPromptOptions, plan: Plan): void {
	if (injectedGuidelines.size > 0) {
		for (let index = options.promptGuidelines.length - 1; index >= 0; index -= 1) {
			const line = options.promptGuidelines[index];
			if (line !== undefined && injectedGuidelines.has(line)) options.promptGuidelines.splice(index, 1);
		}
		injectedGuidelines.clear();
	}

	for (const guideline of plan.guidelines) {
		options.promptGuidelines.push(guideline);
		injectedGuidelines.add(guideline);
	}
}
