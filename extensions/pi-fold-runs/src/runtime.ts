import { DEFAULT_CONFIG, type FoldConfig } from "./config.ts";
import type { PiVersion } from "./version.ts";

/** What the prototype patches read at render time. */
export interface FoldRuntime {
	config: FoldConfig;
	/** Settings file the current config came from, if any. */
	source?: string;
	/** The pi that is running, checked when the session starts. */
	version?: PiVersion;
}

/**
 * Pi patches a component prototype once per process, but `/reload` builds a
 * fresh extension module: a config captured in the patch's closure would keep
 * the old values. The slot lives on `globalThis` so a reload reaches the
 * patches already installed.
 */
const RUNTIME_KEY = Symbol.for("pi-fold-runs:runtime");
const store = globalThis as unknown as Record<symbol, FoldRuntime | undefined>;

export function getRuntime(): FoldRuntime {
	return store[RUNTIME_KEY] ?? { config: DEFAULT_CONFIG };
}

export function setRuntime(runtime: FoldRuntime): void {
	store[RUNTIME_KEY] = runtime;
}

/**
 * Why the patches stopped trusting pi's components: the first shape probe that
 * failed. The slot lives next to the config so `/fold` can report it, and so a
 * `/reload` cannot talk the already-installed patches back into guessing.
 */
const PROBLEM_KEY = Symbol.for("pi-fold-runs:shape-problem");
const problems = globalThis as unknown as Record<symbol, string | undefined>;

export function reportShapeProblem(problem: string): void {
	if (problems[PROBLEM_KEY] === undefined) problems[PROBLEM_KEY] = problem;
}

export function getShapeProblem(): string | undefined {
	return problems[PROBLEM_KEY];
}
