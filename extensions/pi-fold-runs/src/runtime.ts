import type { FoldConfig } from "./config.ts";

export interface FoldRuntime {
	config: FoldConfig;
	/** Settings file the current config came from, if any. */
	source?: string;
}

/**
 * The renderer resolver is registered once for the extension runtime and reads
 * this slot when it resolves, so a session start replaces the settings a previous
 * session loaded. Folding starts off: a process that never started a TUI session
 * must keep Pi's own rows.
 */
let runtime: FoldRuntime = { config: { enabled: false, pinned: [] } };

export function getRuntime(): FoldRuntime {
	return runtime;
}

export function setRuntime(next: FoldRuntime): void {
	runtime = next;
}
