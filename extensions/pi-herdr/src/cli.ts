/**
 * Thin process layer around the `herdr` CLI.
 *
 * Every call is an argv array: no shell, no quoting, no bash→PowerShell
 * translation. The binary stays the authority for behavior; this module only
 * runs it and reports what came back.
 */

import { spawn } from "node:child_process";
import { parseErrorPayload, parseJson } from "./normalize.ts";

export interface HerdrCommand {
	args: string[];
	timeoutMs?: number;
	signal?: AbortSignal;
	cwd?: string;
}

export interface HerdrOutcome {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export class HerdrError extends Error {
	readonly code: string | null;
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;

	constructor(
		message: string,
		options: {
			code?: string | null;
			exitCode?: number | null;
			stdout?: string;
			stderr?: string;
			timedOut?: boolean;
		} = {},
	) {
		super(message);
		this.name = "HerdrError";
		this.code = options.code ?? null;
		this.exitCode = options.exitCode ?? null;
		this.stdout = options.stdout ?? "";
		this.stderr = options.stderr ?? "";
		this.timedOut = options.timedOut ?? false;
	}
}

/** Default cap for a single herdr call. Long waits pass their own budget. */
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Model-facing output cap; the caller is told when output was cut. */
export const MAX_RESULT_CHARS = 40_000;

/** `HERDR_BIN` overrides the binary; otherwise `herdr` from PATH. */
export function herdrBinary(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.HERDR_BIN?.trim();
	return override ? override : "herdr";
}

function missingBinary(error: unknown): HerdrError {
	const detail = error instanceof Error ? error.message : String(error);
	return new HerdrError(
		`Cannot start the herdr binary (${detail}). Install Herdr or set HERDR_BIN to its full path.`,
		{ code: "herdr_missing" },
	);
}

export function runHerdr(command: HerdrCommand): Promise<HerdrOutcome> {
	const timeoutMs = command.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		if (command.signal?.aborted) {
			reject(new HerdrError("herdr call aborted before it started", { code: "aborted" }));
			return;
		}

		let child;
		try {
			child = spawn(herdrBinary(), command.args, {
				cwd: command.cwd,
				shell: false,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			reject(missingBinary(error));
			return;
		}

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const cleanup = () => {
			clearTimeout(timer);
			command.signal?.removeEventListener("abort", onAbort);
		};
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			finish();
		};
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		const onAbort = () => {
			child.kill();
		};

		command.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.on("error", (error) => {
			settle(() => reject(missingBinary(error)));
		});

		child.on("close", (code) => {
			settle(() => {
				if (command.signal?.aborted) {
					reject(
						new HerdrError("herdr call aborted", {
							code: "aborted",
							exitCode: code,
							stdout,
							stderr,
						}),
					);
					return;
				}
				resolve({ exitCode: code, stdout, stderr, timedOut });
			});
		});
	});
}

function describeFailure(command: HerdrCommand, outcome: HerdrOutcome): HerdrError {
	const commandText = `herdr ${command.args.join(" ")}`;
	if (outcome.timedOut) {
		return new HerdrError(`${commandText} timed out after ${command.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`, {
			code: "timeout",
			exitCode: outcome.exitCode,
			stdout: outcome.stdout,
			stderr: outcome.stderr,
			timedOut: true,
		});
	}

	const payload = parseErrorPayload(outcome.stdout) ?? parseErrorPayload(outcome.stderr);
	const raw = (outcome.stderr.trim() || outcome.stdout.trim()).split(/\r?\n/)[0] ?? "";
	const message = payload?.message ?? (raw || `${commandText} failed with exit code ${outcome.exitCode}`);
	return new HerdrError(message, {
		code: payload?.code ?? (outcome.exitCode === 2 ? "usage" : null),
		exitCode: outcome.exitCode,
		stdout: outcome.stdout,
		stderr: outcome.stderr,
	});
}

/** Run a control command and parse its JSON envelope; throw on any failure. */
export async function callHerdr(command: HerdrCommand, timeoutMs = command.timeoutMs): Promise<unknown> {
	const outcome = await runHerdr({ ...command, timeoutMs });
	if (outcome.exitCode !== 0) throw describeFailure({ ...command, timeoutMs }, outcome);
	const parsed = parseJson(outcome.stdout);
	if (parsed === undefined) {
		throw new HerdrError(`herdr ${command.args.join(" ")} did not return JSON.`, {
			code: "unexpected_output",
			exitCode: outcome.exitCode,
			stdout: outcome.stdout,
			stderr: outcome.stderr,
		});
	}
	return parsed;
}

/** Abortable sleep used by the post-submission activity probe. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new HerdrError("aborted", { code: "aborted" }));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new HerdrError("aborted", { code: "aborted" }));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
