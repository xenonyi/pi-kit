import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

import { loadConfig, type RuntimeUpdateMode } from "../config.js";
import { isAgyCli, resolveAntigravityAcpLaunch, type AntigravityLaunch } from "./antigravity.js";
import { AntigravityAcpError } from "./errors.js";

const execFileAsync = promisify(execFile);
const UPDATE_TIMEOUT_MS = 5 * 60_000;

export interface RuntimeSetupStatus {
	installed: boolean;
	launch?: AntigravityLaunch;
	installedVersion?: string;
	updateMode: RuntimeUpdateMode;
	platform: string;
}

export interface RuntimeUpdateResult {
	version?: string;
	changed: boolean;
	binary: string;
}

export function inspectRuntimeSetup(): RuntimeSetupStatus {
	let launch: AntigravityLaunch | undefined;
	try {
		launch = resolveAntigravityAcpLaunch();
	} catch {
		// Not installed.
	}
	const installedVersion = launch && isAgyCli(launch.command) ? readAgyVersionSync(launch.command) : undefined;
	return {
		installed: launch !== undefined,
		...(launch ? { launch } : {}),
		...(installedVersion ? { installedVersion } : {}),
		updateMode: loadConfig().runtimeUpdates,
		platform: `${process.platform}-${process.arch}`,
	};
}

export async function ensureAntigravityAcpReady(onProgress?: (message: string) => void): Promise<void> {
	const launch = resolveAntigravityAcpLaunch();
	onProgress?.(`Using Antigravity CLI at ${launch.command}.`);
}

export async function updateAntigravityAcpRuntime(
	onProgress?: (message: string) => void,
): Promise<RuntimeUpdateResult> {
	const launch = resolveAntigravityAcpLaunch();
	if (launch.source === "env" && !isAgyCli(launch.command)) {
		throw new AntigravityAcpError(
			"spawn",
			"The selected Antigravity ACP runtime is externally managed. Update it with its own installer.",
		);
	}
	const before = readAgyVersionSync(launch.command);
	onProgress?.("Updating Antigravity CLI via `agy update`…");
	const { stdout, stderr } = await execFileAsync(launch.command, ["update"], {
		timeout: UPDATE_TIMEOUT_MS,
		windowsHide: true,
	});
	const after = readAgyVersionSync(launch.command);
	const output = `${stdout}\n${stderr}`.trim();
	const changed =
		before !== undefined && after !== undefined
			? before !== after
			: !/already\s+up\s+to\s+date/iu.test(output);
	return {
		...(after ?? before ? { version: after ?? before } : {}),
		changed,
		binary: launch.command,
	};
}

export function readAgyVersionSync(command: string): string | undefined {
	try {
		const output = execFileSync(command, ["--version"], {
			timeout: 3_000,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
		}).trim();
		const match = /\b\d+\.\d+\.\d+(?:[-+][^\s]+)?\b/u.exec(output);
		return match?.[0] ?? (output || undefined);
	} catch {
		return undefined;
	}
}
