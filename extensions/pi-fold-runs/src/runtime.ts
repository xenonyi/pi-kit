import { DEFAULT_CONFIG, type FoldConfig } from "./config.ts";

/** What the prototype patches read at render time. */
export interface FoldRuntime {
	config: FoldConfig;
	/** Settings file the current config came from, if any. */
	source?: string;
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
