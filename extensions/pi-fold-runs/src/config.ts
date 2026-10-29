import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** Settings file read from `<workspace>/.pi/` (trusted projects) and from the agent directory. */
export const CONFIG_FILE_NAME = "pi-fold-runs.json";

export interface FoldConfig {
	/** Master switch. `false` hands every card back to Pi. */
	enabled: boolean;
	/** Tools whose native cards are never folded. */
	pinned: string[];
}

export const DEFAULT_CONFIG: FoldConfig = {
	enabled: true,
	// Keep question answers visible without expanding the card.
	pinned: ["ask_user_question"],
};

export interface LoadedFoldConfig {
	config: FoldConfig;
	source?: string;
	warning?: string;
}

/** Project config wins over the agent config, and only while the project is trusted. */
export function loadFoldConfig(cwd: string, projectTrusted: boolean): LoadedFoldConfig {
	const candidates = [
		...(projectTrusted ? [path.join(cwd, CONFIG_DIR_NAME, CONFIG_FILE_NAME)] : []),
		path.join(getAgentDir(), CONFIG_FILE_NAME),
	];
	const source = candidates.find((file) => existsSync(file));
	if (!source) return { config: defaults() };

	try {
		return { config: normalizeConfig(JSON.parse(readFileSync(source, "utf8")), source), source };
	} catch (error) {
		return {
			config: defaults(),
			source,
			warning: `pi-fold-runs: ignoring ${source}: ${formatError(error)}`,
		};
	}
}

function defaults(): FoldConfig {
	return { ...DEFAULT_CONFIG, pinned: [...DEFAULT_CONFIG.pinned] };
}

/** Unknown keys are ignored, so settings written for an older version still load. */
function normalizeConfig(raw: unknown, source: string): FoldConfig {
	const root = asObject(raw, source);
	return {
		enabled: booleanField(root, "enabled", source, DEFAULT_CONFIG.enabled),
		pinned: root.pinned === undefined ? [...DEFAULT_CONFIG.pinned] : toolList(root.pinned, `${source}: pinned`),
	};
}

function asObject(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function booleanField(
	source: Record<string, unknown>,
	key: string,
	where: string,
	fallback: boolean,
): boolean {
	const value = source[key];
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") throw new Error(`${where}: ${key} must be a boolean`);
	return value;
}

function toolList(value: unknown, where: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
		throw new Error(`${where} must be an array of tool names`);
	}
	return [...new Set(value as string[])];
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
