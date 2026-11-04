import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** The two executables this extension drives. */
export type CliName = "hc" | "herdr-app";

/**
 * Failure kinds: the ones both tools report, plus the ones this extension
 * raises itself. `missing` means the executable is not on PATH.
 */
export type CliErrorKind =
	| "not_found"
	| "needs_target"
	| "blocked"
	| "status_mismatch"
	| "finished"
	| "timeout"
	| "missing"
	| "failed";

export const DEFAULT_TIMEOUT_MS = 20_000;

const KINDS = new Set<string>([
	"not_found",
	"needs_target",
	"blocked",
	"status_mismatch",
	"finished",
	"timeout",
	"missing",
	"failed",
]);

/** Documented exit codes, used when stderr carries no JSON error body. */
const EXIT_KINDS: Readonly<Record<number, CliErrorKind>> = {
	3: "not_found",
	7: "needs_target",
	9: "blocked",
	10: "status_mismatch",
	11: "finished",
};

export class CliError extends Error {
	readonly command: CliName;
	readonly kind: CliErrorKind;
	readonly hint: string | undefined;
	readonly exitCode: number | undefined;

	constructor(
		command: CliName,
		kind: CliErrorKind,
		message: string,
		options: { hint?: string; exitCode?: number } = {},
	) {
		super(message);
		this.name = "CliError";
		this.command = command;
		this.kind = kind;
		this.hint = options.hint;
		this.exitCode = options.exitCode;
	}
}

export interface CliOptions {
	cwd?: string | undefined;
	timeoutMs?: number | undefined;
	signal?: AbortSignal | undefined;
}

const executables = new Map<CliName, string>();

/** Resolve a CLI to an absolute path once; hc and herdr-app are native binaries. */
export function requireExecutable(name: CliName): string {
	const cached = executables.get(name);
	if (cached) return cached;
	const found = resolveExecutable(name);
	if (!found) {
		throw new CliError(name, "missing", `${name} was not found on PATH`, {
			hint: `Install herdr (herdr-core provides hc, herdr-app the window) or fix PATH. Do not substitute another command.`,
		});
	}
	executables.set(name, found);
	return found;
}

/** Run a CLI and return stdout; throws CliError on a non-zero exit. */
export async function runCli(name: CliName, args: string[], options: CliOptions = {}): Promise<string> {
	const file = requireExecutable(name);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return await new Promise<string>((resolve, reject) => {
		const child = spawn(file, args, {
			cwd: options.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		let stdout = "";
		let stderr = "";
		let interrupted: "caller" | "timeout" | undefined;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const finish = (error: Error | undefined, value?: string) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve(value ?? "");
		};

		function onAbort() {
			interrupted = "caller";
			child.kill();
		}

		timer = setTimeout(() => {
			interrupted = "timeout";
			child.kill();
		}, timeoutMs);

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			const code = (error as NodeJS.ErrnoException).code;
			finish(code === "ENOENT" ? missingExecutable(name) : error);
		});
		child.on("close", (code) => {
			const subcommand = args[0] ?? "";
			if (interrupted === "caller") return finish(new Error(`${name} ${subcommand} aborted`));
			if (interrupted === "timeout") {
				return finish(
					new CliError(name, "timeout", `${name} ${subcommand} did not finish within ${Math.round(timeoutMs / 1000)}s`, {
						hint: "Use herdr_wait to check in on the terminal instead of blocking, or raise the timeout when the command is expected to run long.",
					}),
				);
			}
			if (code === 0) return finish(undefined, stdout);
			finish(failure(name, code ?? -1, stdout, stderr));
		});

		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** Run a CLI whose stdout is a JSON document. */
export async function runCliJson<T>(name: CliName, args: string[], options: CliOptions = {}): Promise<T> {
	const stdout = await runCli(name, args, options);
	const payload = parseJson(stdout.trim());
	if (payload === undefined) {
		throw new CliError(name, "failed", `${name} ${args.slice(0, 2).join(" ")} printed no JSON`, {
			hint: firstLine(stdout),
		});
	}
	return payload as T;
}

export function parseJson(text: string): unknown {	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Pause without pulling in timers elsewhere. */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function firstLine(text: string): string | undefined {
	const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== "");
	return line?.trim();
}

function missingExecutable(name: CliName): CliError {
	return new CliError(name, "missing", `${name} could not be started`, {
		hint: "Install herdr or fix PATH, then retry. Do not report a terminal state you could not read.",
	});
}

function failure(name: CliName, exitCode: number, stdout: string, stderr: string): CliError {
	const reported = readError(parseJson(stderr.trim()) ?? parseJson(stdout.trim()));
	const kind: CliErrorKind =
		reported && KINDS.has(reported.kind) ? (reported.kind as CliErrorKind) : (EXIT_KINDS[exitCode] ?? "failed");
	const message =
		reported?.message ?? firstLine(stderr) ?? firstLine(stdout) ?? `${name} exited with code ${exitCode}`;
	return new CliError(name, kind, message, { hint: reported?.hint, exitCode });
}

/** Both tools print `{error: {kind, message, hint}}`; `do` also prints `{error: "text"}`. */
function readError(payload: unknown): { kind: string; message: string; hint?: string } | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const error = (payload as { error?: unknown }).error;
	if (typeof error === "string") return { kind: "failed", message: error };
	if (!error || typeof error !== "object") return undefined;
	const { kind, message, hint } = error as { kind?: unknown; message?: unknown; hint?: unknown };
	return {
		kind: typeof kind === "string" ? kind : "failed",
		message: typeof message === "string" ? message : JSON.stringify(error),
		hint: typeof hint === "string" ? hint : undefined,
	};
}

function resolveExecutable(name: CliName): string | undefined {
	// Windows needs the `.exe` suffix: spawn without a shell cannot run a bare name.
	const extensions = process.platform === "win32" ? [".exe", ""] : [""];
	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		for (const extension of extensions) {
			const candidate = path.resolve(directory || ".", `${name}${extension}`);
			if (isExecutableFile(candidate)) return candidate;
		}
	}
	return undefined;
}

function isExecutableFile(file: string): boolean {
	try {
		if (!statSync(file).isFile()) return false;
		if (process.platform !== "win32") accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
