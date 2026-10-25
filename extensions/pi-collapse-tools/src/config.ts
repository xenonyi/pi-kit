import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** Settings file read from `<workspace>/.pi/` (trusted projects) and from the agent directory. */
export const CONFIG_FILE_NAME = "pi-collapse-tools.json";

export interface CodemodeDisplayConfig {
	/** Hide the script body until the row is expanded. */
	hideScript: boolean;
	/** Animate the collapsed header while the script is generating or running. */
	indicator: boolean;
	/** Add the estimated output tokens and their share of the context window. */
	tokens: boolean;
}

export interface CollapseConfig {
	/** Master switch. `false` restores Pi's own rendering. */
	enabled: boolean;
	/** Tool names to collapse, or `"all"`. */
	tools: "all" | string[];
	/** Tool names that are never collapsed. */
	except: string[];
	/** Show a dim `Running…` row while a collapsed call streams. */
	showRunning: boolean;
	/** Keep failed calls rendered by Pi, so the error text stays visible. */
	showErrors: boolean;
	codemode: CodemodeDisplayConfig;
}

/** Config shared by the renderers; replaced whenever a session starts. */
export interface CollapseRuntime {
	config: CollapseConfig;
	/** Settings file the current config came from, if any. */
	source?: string;
}

export const DEFAULT_CONFIG: CollapseConfig = {
	enabled: true,
	tools: "all",
	// The answer to a question must stay visible without expanding the row.
	except: ["ask_user_question"],
	showRunning: true,
	showErrors: true,
	codemode: { hideScript: true, indicator: true, tokens: true },
};

export interface LoadedCollapseConfig {
	config: CollapseConfig;
	source?: string;
	warning?: string;
}

/** Whether this tool's result is hidden while the row is collapsed. */
export function shouldCollapse(config: CollapseConfig, toolName: string): boolean {
	if (!config.enabled) return false;
	if (config.except.includes(toolName)) return false;
	return config.tools === "all" || config.tools.includes(toolName);
}

/** Project config wins over the agent config, and only while the project is trusted. */
export function loadCollapseConfig(cwd: string, projectTrusted: boolean): LoadedCollapseConfig {
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
			warning: `pi-collapse-tools: ignoring ${source}: ${formatError(error)}`,
		};
	}
}

function defaults(): CollapseConfig {
	return {
		...DEFAULT_CONFIG,
		except: [...DEFAULT_CONFIG.except],
		codemode: { ...DEFAULT_CONFIG.codemode },
	};
}

function normalizeConfig(raw: unknown, source: string): CollapseConfig {
	const root = asObject(raw, source);
	const codemode =
		root.codemode === undefined ? undefined : asObject(root.codemode, `${source}: codemode`);

	return {
		enabled: booleanField(root, "enabled", source, DEFAULT_CONFIG.enabled),
		tools: toolSelection(root.tools, source),
		except: root.except === undefined ? [...DEFAULT_CONFIG.except] : toolList(root.except, `${source}: except`),
		showRunning: booleanField(root, "showRunning", source, DEFAULT_CONFIG.showRunning),
		showErrors: booleanField(root, "showErrors", source, DEFAULT_CONFIG.showErrors),
		codemode: {
			hideScript: booleanField(codemode, "hideScript", `${source}: codemode`, DEFAULT_CONFIG.codemode.hideScript),
			indicator: booleanField(codemode, "indicator", `${source}: codemode`, DEFAULT_CONFIG.codemode.indicator),
			tokens: booleanField(codemode, "tokens", `${source}: codemode`, DEFAULT_CONFIG.codemode.tokens),
		},
	};
}

function asObject(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${where} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function booleanField(
	source: Record<string, unknown> | undefined,
	key: string,
	where: string,
	fallback: boolean,
): boolean {
	const value = source?.[key];
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

function toolSelection(value: unknown, source: string): "all" | string[] {
	if (value === undefined) return DEFAULT_CONFIG.tools;
	if (value === "all") return "all";
	return toolList(value, `${source}: tools`);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
