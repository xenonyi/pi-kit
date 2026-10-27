/**
 * Condition matching: OS aliases, glob matching, and readable miss reasons.
 *
 * Supported keys: `os`, `host`, `cwd`, `tools`. Within a key the array is an
 * OR; different keys are an AND. `*` matches one path segment, `**` any.
 */

import type { MatchConditions, MachineEnv, MatchOutcome } from "./types.ts";

const CONDITION_KEYS = ["os", "host", "cwd", "tools"] as const;
type ConditionKey = (typeof CONDITION_KEYS)[number];

const OS_ALIASES: Record<string, string[]> = {
	win32: ["win32", "windows", "win"],
	darwin: ["darwin", "macos", "mac", "osx"],
	linux: ["linux"],
};

const GLOB_CACHE = new Map<string, RegExp>();

export function matchConditions(conditions: MatchConditions | undefined, env: MachineEnv): MatchOutcome {
	if (!conditions) return { matched: true };

	for (const key of CONDITION_KEYS) {
		const patterns = conditions[key];
		if (!patterns || patterns.length === 0) continue;
		const values = candidates(key, env);
		if (values.length === 0) return { matched: false, reason: `${key} is unknown here` };
		const caseInsensitive = key !== "cwd" || env.os === "win32";
		const hit = patterns.some((pattern) => values.some((value) => matchesGlob(pattern, value, caseInsensitive)));
		if (!hit) return { matched: false, reason: `${key}=${values[0]} misses ${patterns.join("|")}` };
	}

	return { matched: true };
}

export function matchesGlob(pattern: string, value: string, caseInsensitive: boolean): boolean {
	const key = `${caseInsensitive ? "i" : "s"}:${pattern}`;
	let regex = GLOB_CACHE.get(key);
	if (!regex) {
		regex = globToRegExp(pattern, caseInsensitive);
		GLOB_CACHE.set(key, regex);
	}
	return regex.test(value);
}

function globToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
	let source = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index] ?? "";
		if (character === "*") {
			if (pattern[index + 1] === "*") {
				source += ".*";
				index += 1;
			} else {
				source += "[^/]*";
			}
			continue;
		}
		source += character.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
	}
	return new RegExp(`^${source}$`, caseInsensitive ? "i" : "");
}

function candidates(key: ConditionKey, env: MachineEnv): string[] {
	switch (key) {
		case "os":
			return OS_ALIASES[env.os] ?? [env.os];
		case "host":
			return [env.host];
		case "cwd":
			return env.cwd.endsWith("/") ? [env.cwd] : [env.cwd, `${env.cwd}/`];
		case "tools":
			return env.tools;
	}
}
