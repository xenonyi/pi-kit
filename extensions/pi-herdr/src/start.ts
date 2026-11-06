import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { CliError, runCliJson } from "./cli.ts";
import { formatError } from "./format.ts";
import { findTerminal, listTerminals, locateTerminalWhenShown, myAddress, readWindow } from "./terminals.ts";
import type { Direction, Placement, StartResult, TerminalInfo } from "./types.ts";
import { runDo } from "./ui.ts";

const RUN_TIMEOUT_MS = 60_000;
const GET_TIMEOUT_MS = 15_000;
/** Above this, a task is written to a file instead of being passed as an argument. */
const INLINE_TASK_LIMIT = 400;
const TASK_DIRECTORY = path.join(os.tmpdir(), "pi-herdr");

export interface StartParams {
	argv: string[];
	task?: string | undefined;
	name?: string | undefined;
	cwd?: string | undefined;
	placement: Placement;
	direction: Direction;
	focus: boolean;
	inlineTask: boolean;
}

interface TerminalDetail {
	address: string;
	name?: string | null;
	parent?: string | null;
	die_with_parent?: boolean | null;
	state?: string;
	status?: { state?: string; app?: string } | null;
	turn?: number;
	exit_code?: number | null;
}

/**
 * Start a program in a herdr terminal and, when asked, show it in the window.
 *
 * Always passes `--outlive-parent`: a terminal started without it ends with
 * this session. A task too long or too quote-heavy to survive hc's command-line
 * assembly is written to a file and passed as a path instead.
 */
export async function startTerminal(
	params: StartParams,
	options: { cwd: string; signal?: AbortSignal | undefined },
): Promise<StartResult> {
	if (params.argv.length === 0) {
		throw new CliError("hc", "failed", "herdr_start needs a program in argv", {
			hint: 'Pass the agent or program as an array, for example ["pi"] or ["claude"]. An empty argv starts a bare shell.',
		});
	}

	const steps: string[] = [];
	const warnings: string[] = [];
	const argv = [...params.argv];
	if (process.platform !== "win32" && process.env.PATH !== undefined) {
		argv.unshift("/usr/bin/env", `PATH=${process.env.PATH}`);
		steps.push("forward the calling session's PATH to the new program");
	}
	const listed = await listTerminals({ signal: options.signal });
	const name = uniqueName(params.name, listed.terminals);
	const cwd = path.resolve(options.cwd, params.cwd ?? ".");
	const task = prepareTask(params.task, params.inlineTask, name);
	if (task.file) steps.push(`task written to ${task.file}`);

	const window = await readWindow({ signal: options.signal });
	if (params.placement !== "background" && !window.open) {
		warnings.push(
			`the window is not reachable (${window.problem ?? "no window"}), so the terminal stays hidden; start herdr-app yourself if it should be visible`,
		);
	}
	// Without a window, "show it somewhere" degrades to a hidden terminal.
	const placement: Placement = params.placement !== "background" && !window.open ? "background" : params.placement;

	let address = "";
	if (placement === "tab") {
		const created = await runDo(
			"tab.new",
			{ name, folder: cwd, argv, task: task.passed },
			{ signal: options.signal },
		);
		address = typeof created.terminal === "string" ? created.terminal : "";
		steps.push("herdr-app do tab.new");
	} else {
		const run = await runCliJson<{ address: string }>(
			"hc",
			[
				"run",
				"--json",
				"--bg",
				"--outlive-parent",
				"--name",
				name,
				"--cwd",
				cwd,
				...argv,
				...(task.passed ? [task.passed] : []),
			],
			{ timeoutMs: RUN_TIMEOUT_MS, signal: options.signal },
		);
		address = run.address;
		steps.push(`hc run --bg --outlive-parent --name ${name} → ${address}`);

		if (placement === "pane" && window.open) {
			try {
				// terminal.keep splits the focused pane, so split beside this session
				// instead of wherever the window happens to point.
				const myPane = findTerminal(window.spaces, myAddress()).pane;
				if (myPane && window.focusedPane !== myPane) {
					await runDo("pane.focus", { pane: myPane }, { signal: options.signal });
					steps.push(`herdr-app do pane.focus --pane ${myPane}`);
				}
				await runDo(
					"terminal.keep",
					{ terminal: address, place: params.direction },
					{ signal: options.signal },
				);
				steps.push(`herdr-app do terminal.keep --place ${params.direction}`);
				if (params.focus) {
					await runDo("agent.focus", { terminal: address }, { signal: options.signal });
					steps.push("herdr-app do agent.focus");
				}
			} catch (error) {
				if (error instanceof Error && /aborted/.test(error.message)) throw error;
				warnings.push(`the terminal is running but is not shown in a pane: ${formatError(error)}`);
			}
		}
	}

	const detail = await readDetail(address, options.signal);
	steps.push(`hc get ${address}: state=${detail.state ?? "?"} status=${detail.status?.state ?? "-"}`);

	// Survives this session when it has no parent to die with, or explicitly outlives it.
	const parent = detail.parent ?? null;
	const outliveParent = detail.die_with_parent === false || parent === null;
	if (!outliveParent) {
		warnings.push("die_with_parent is not false: this terminal ends with the session, restart it with herdr_start");
	}
	if (detail.exit_code !== null && detail.exit_code !== undefined) {
		warnings.push(`the program already exited with code ${detail.exit_code}; read the terminal before assuming it started`);
	}

	const located = await locateTerminalWhenShown(address, { signal: options.signal });
	return {
		address,
		name,
		placement,
		cwd,
		parent,
		outliveParent,
		state: detail.state ?? "",
		status: detail.status?.state ?? "",
		turn: detail.turn ?? 0,
		pane: located.pane,
		spaceName: located.spaceName,
		tabName: located.tabName,
		taskFile: task.file ?? null,
		steps,
		warnings,
	};
}

/** Task text that survives hc's shell assembly, or a file to pass by path. */
function prepareTask(task: string | undefined, inline: boolean, name: string): { passed?: string; file?: string } {
	if (!task || task.trim() === "") return {};
	if (inline || !taskNeedsFile(task)) return { passed: task };
	const file = writeTaskFile(task, name);
	return { passed: `Read the task file at ${file} and follow it.`, file };
}

/**
 * hc turns a task into `pwsh -NoExit -Command & '<program>' '<task>'`, which
 * eats quotes, `$`, backticks and newlines, so long or punctuated text goes
 * through a file.
 */
export function taskNeedsFile(task: string): boolean {
	return task.length > INLINE_TASK_LIMIT || /[\r\n\t]/.test(task) || /["'`$]/.test(task);
}

export function writeTaskFile(task: string, name: string): string {
	mkdirSync(TASK_DIRECTORY, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const slug = name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "task";
	const file = path.join(TASK_DIRECTORY, `${stamp}-${slug}.md`);
	writeFileSync(file, task.endsWith("\n") ? task : `${task}\n`, "utf8");
	return file;
}

export function uniqueName(desired: string | undefined, terminals: TerminalInfo[]): string {
	const taken = new Set(terminals.map((terminal) => terminal.name).filter((name) => name !== ""));
	const base = sanitizeName(desired) ?? "agent";
	if (!taken.has(base)) return base;
	for (let index = 2; index < 100; index += 1) {
		const candidate = `${base}-${index}`;
		if (!taken.has(candidate)) return candidate;
	}
	return `${base}-${Date.now().toString(36)}`;
}

/** hc accepts 1-32 of a-z 0-9 - _ for a name. */
export function sanitizeName(desired: string | undefined): string | undefined {
	if (!desired) return undefined;
	const cleaned = desired
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	return cleaned === "" ? undefined : cleaned;
}

async function readDetail(address: string, signal: AbortSignal | undefined): Promise<TerminalDetail> {
	return await runCliJson<TerminalDetail>("hc", ["get", address, "--json"], {
		timeoutMs: GET_TIMEOUT_MS,
		signal,
	});
}
