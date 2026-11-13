import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AntigravityAcpError } from "./errors.js";

export interface AntigravityLaunch {
	command: string;
	args: string[];
	source: "env" | "user-bin" | "path";
}

export interface ResolveLaunchOptions {
	dangerSkipPermissions?: boolean;
}

export function isAgyCli(command: string): boolean {
	return /^agy(?:\.(?:exe|cmd|bat))?$/iu.test(path.basename(command));
}

export function resolveAntigravityAcpLaunch(options: ResolveLaunchOptions = {}): AntigravityLaunch {
	const extra = options.dangerSkipPermissions ? ["--dangerously-skip-permissions"] : [];
	const env = process.env.AGY_ACP_BIN?.trim();
	if (env) {
		const command = expandHome(env);
		if (executable(command)) {
			return {
				command,
				args: isAgyCli(command) ? ["acp", ...extra] : [],
				source: "env",
			};
		}
	}

	const names = process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy.bat", "agy"] : ["agy"];
	for (const name of names) {
		const userBin = path.join(os.homedir(), ".local", "bin", name);
		if (executable(userBin)) {
			return { command: userBin, args: ["acp", ...extra], source: "user-bin" };
		}
	}

	for (const directory of (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter)) {
		if (!directory) continue;
		for (const name of names) {
			const candidate = path.join(directory, name);
			if (executable(candidate)) {
				return { command: candidate, args: ["acp", ...extra], source: "path" };
			}
		}
	}

	throw new AntigravityAcpError(
		"spawn",
		"Google Antigravity CLI (agy) is not installed. Install agy or set AGY_ACP_BIN.",
	);
}

export type AntigravityAuthStatus =
	| "api-key-env"
	| "oauth-refreshable"
	| "configured-not-authenticated"
	| "corrupt"
	| "missing";

export interface AntigravityAuthHealth {
	status: AntigravityAuthStatus;
	authType?: string;
	tokenFile: boolean;
	settingsFile: boolean;
}

export function resolveAntigravityAcpDirectory(env: NodeJS.ProcessEnv = process.env): string {
	const home = effectiveHome(env);
	const geminiHome = env.GEMINI_HOME?.trim();
	const base = geminiHome ? expandHome(geminiHome, home) : path.join(home, ".gemini");
	return path.join(base, "antigravity-cli");
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function removeConversation(sessionId: string, directory = resolveAntigravityAcpDirectory()): void {
	if (!SESSION_ID.test(sessionId)) return;
	for (const suffix of [".db", ".db-shm", ".db-wal", ".meta"]) {
		try {
			fs.rmSync(path.join(directory, "conversations", sessionId + suffix), { force: true });
		} catch {
			// Best effort.
		}
	}
}

export function inspectAntigravityAuth(
	directory = resolveAntigravityAcpDirectory(),
	env: NodeJS.ProcessEnv = process.env,
): AntigravityAuthHealth {
	const tokenPath = path.join(directory, "antigravity-oauth-token");
	const settingsPath = path.join(directory, "settings.json");
	const tokenFile = regularFile(tokenPath);
	const settingsFile = regularFile(settingsPath);
	let authType: string | undefined;
	if (settingsFile) {
		try {
			const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
				auth?: { type?: unknown };
			};
			if (typeof settings.auth?.type === "string") authType = settings.auth.type;
		} catch {
			return { status: "corrupt", tokenFile, settingsFile };
		}
	}
	if (env.GEMINI_API_KEY) return { status: "api-key-env", authType: "gemini-api-key", tokenFile, settingsFile };
	if (tokenFile) {
		try {
			const parsed = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
				refresh_token?: unknown;
				auth_method?: unknown;
				token?: { refresh_token?: unknown };
			};
			const refreshToken =
				typeof parsed.token?.refresh_token === "string"
					? parsed.token.refresh_token
					: typeof parsed.refresh_token === "string"
						? parsed.refresh_token
						: undefined;
			const method = typeof parsed.auth_method === "string" && parsed.auth_method ? parsed.auth_method : undefined;
			if (refreshToken && refreshToken.length > 0) {
				return { status: "oauth-refreshable", authType: authType ?? method ?? "oauth-personal", tokenFile, settingsFile };
			}
			return { status: "corrupt", ...(authType ? { authType } : {}), tokenFile, settingsFile };
		} catch {
			return { status: "corrupt", ...(authType ? { authType } : {}), tokenFile, settingsFile };
		}
	}
	if (authType) return { status: "configured-not-authenticated", authType, tokenFile, settingsFile };
	return { status: "missing", tokenFile, settingsFile };
}

export function hasAntigravityAuth(): boolean {
	const status = inspectAntigravityAuth().status;
	return status === "api-key-env" || status === "oauth-refreshable";
}

export function clearAntigravityCredentials(
	directory = resolveAntigravityAcpDirectory(),
): void {
	fs.rmSync(path.join(directory, "antigravity-oauth-token"), { force: true });
	fs.rmSync(path.join(directory, "acp_token.json"), { force: true });
	const settingsPath = path.join(directory, "settings.json");
	if (!regularFile(settingsPath)) return;
	try {
		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
		if (!settings || typeof settings !== "object" || !("auth" in settings)) return;
		delete settings.auth;
		const temporary = `${settingsPath}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temporary, settingsPath);
	} catch {
		fs.rmSync(settingsPath, { force: true });
	}
}

function executable(file: string): boolean {
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

function regularFile(file: string): boolean {
	try {
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

function effectiveHome(env: NodeJS.ProcessEnv): string {
	return env.HOME?.trim() || os.homedir();
}

function expandHome(file: string, home = os.homedir()): string {
	return file === "~" || file.startsWith("~/") ? path.join(home, file.slice(1)) : file;
}
