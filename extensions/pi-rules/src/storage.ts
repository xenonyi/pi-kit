/**
 * Fragment sources, the machine-local toggle state and the report file path.
 *
 * There is no configuration file: fragments come from the repository and the
 * local overlay, and toggles never touch the repository.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Diagnostic, FragmentSource, RulesState } from "./types.ts";

/** `<package root>/rules` — the synced fragment directory of this repository. */
export const PACKAGE_RULES_DIR = fileURLToPath(new URL("../../../rules/", import.meta.url));
export const STATE_FILE_NAME = "pi-rules.state.json";
export const REPORT_FILE_NAME = "pi-rules.report.md";

/** Fragment roots in override order: the local overlay wins on duplicate ids. */
export function resolveSources(): FragmentSource[] {
	return [
		{ kind: "package", dir: PACKAGE_RULES_DIR },
		{ kind: "local", dir: path.join(getAgentDir(), "rules") },
	];
}

export function readState(diagnostics: Diagnostic[]): RulesState {
	const file = path.join(getAgentDir(), STATE_FILE_NAME);
	if (!existsSync(file)) return { version: 1, disabled: [] };
	try {
		const value: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!isRecord(value)) throw new Error("state must be an object");
		const disabled = Array.isArray(value.disabled)
			? value.disabled.filter((id): id is string => typeof id === "string")
			: [];
		return { version: 1, disabled };
	} catch (error) {
		diagnostics.push({ level: "warning", message: `cannot read local state: ${errorMessage(error)}`, path: file });
		return { version: 1, disabled: [] };
	}
}

export function writeState(state: RulesState): void {
	writeFileSync(path.join(getAgentDir(), STATE_FILE_NAME), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function reportFilePath(): string {
	return path.join(getAgentDir(), REPORT_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "unknown error";
}
