/**
 * Shared types for pi-rules.
 *
 * A fragment is a Markdown file with a small frontmatter block. Its body is a
 * list of rules; files are concatenated in path order, so the filename decides
 * where a fragment sits in the prompt.
 */

/** Conditions that decide whether a fragment applies. Arrays hold alternatives. */
export interface MatchConditions {
	os?: string[];
	host?: string[];
	cwd?: string[];
	tools?: string[];
}

export interface FragmentMeta {
	id: string;
	title?: string;
	enabled: boolean;
	conditions?: MatchConditions;
}

/** Where a fragment file was discovered; local overrides package. */
export type FragmentSourceKind = "package" | "local";

export interface FragmentSource {
	kind: FragmentSourceKind;
	dir: string;
}

export interface Fragment {
	meta: FragmentMeta;
	body: string;
	path: string;
	source: FragmentSource;
}

export interface ModelLike {
	provider: string;
	id: string;
}

/** Values a fragment can match against on the current machine. */
export interface MachineEnv {
	os: string;
	host: string;
	cwd: string;
	model?: string;
	tools: string[];
}

export interface MatchOutcome {
	matched: boolean;
	reason?: string;
}

export interface RulesState {
	version: 1;
	disabled: string[];
}

export interface ActiveFragment {
	id: string;
	chars: number;
}

export interface DroppedFragment {
	id: string;
	reason: string;
}

export interface Plan {
	guidelines: string[];
	active: ActiveFragment[];
	dropped: DroppedFragment[];
	chars: number;
}

export interface Diagnostic {
	level: "error" | "warning";
	message: string;
	path?: string;
}

export interface RulesRuntime {
	readonly sources: FragmentSource[];
	readonly fragments: Fragment[];
	readonly diagnostics: Diagnostic[];
	readonly state: RulesState;
	refresh(): void;
	plan(env: MachineEnv): Plan;
	setDisabled(id: string, disabled: boolean): void;
}
