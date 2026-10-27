/**
 * Applies a plan to the mutable prompt options of one run.
 *
 * The previous injection is removed first, so repeated calls in one process
 * cannot accumulate content; sections owned by configuration or other
 * extensions are left untouched.
 */

import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { Plan } from "./types.ts";

interface Injection {
	/** Injected tag -> content written by this extension. */
	sections: Map<string, string>;
	/** Guideline lines pushed by this extension. */
	guidelines: Set<string>;
}

const injection: Injection = { sections: new Map(), guidelines: new Set() };

export function applyPlan(options: NormalizedBuildSystemPromptOptions, plan: Plan): void {
	for (const [tag, content] of injection.sections) {
		if (options.sections[tag] === content) delete options.sections[tag];
	}
	injection.sections.clear();

	if (injection.guidelines.size > 0) {
		for (let index = options.promptGuidelines.length - 1; index >= 0; index -= 1) {
			const line = options.promptGuidelines[index];
			if (line !== undefined && injection.guidelines.has(line)) options.promptGuidelines.splice(index, 1);
		}
		injection.guidelines.clear();
	}

	for (const section of plan.sections) {
		if (!section.content) continue;
		options.sections[section.tag] = section.content;
		injection.sections.set(section.tag, section.content);
	}

	for (const guideline of plan.guidelines) {
		options.promptGuidelines.push(guideline);
		injection.guidelines.add(guideline);
	}
}
