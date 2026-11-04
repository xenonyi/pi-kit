import process from "node:process";
import { CliError, delay, runCliJson } from "./cli.ts";
import type { MachineInfo, Snapshot, TerminalInfo, WindowInfo, WindowLocation, WindowSpace } from "./types.ts";

const HC_TIMEOUT_MS = 15_000;
const WINDOW_TIMEOUT_MS = 10_000;

interface HcLs {
	hidden_finished?: number;
	machines?: Array<{ name?: string; state?: string }>;
	terminals?: Array<{
		address: string;
		agent?: string;
		cwd?: string;
		name?: string;
		parent?: string | null;
		state?: string;
		status?: string;
		turn?: number;
		where?: string;
	}>;
}

interface WindowLs {
	spaces?: WindowSpace[];
}

interface WindowStatus {
	focused_pane?: string | null;
	errors?: unknown[];
}

export const NO_LOCATION: WindowLocation = {
	pane: null,
	space: null,
	spaceName: null,
	tab: null,
	tabName: null,
	app: null,
	name: null,
	status: null,
};

/** This session's terminal address; herdr exports it into the terminal it runs. */
export function myAddress(): string | null {
	return process.env.HC_TERMINAL_ID?.trim() || null;
}

export async function listTerminals(
	options: { signal?: AbortSignal | undefined; all?: boolean } = {},
): Promise<{ terminals: TerminalInfo[]; machines: MachineInfo[]; hiddenFinished: number }> {
	const args = ["ls", "--json"];
	if (options.all) args.push("--all");
	const listed = await runCliJson<HcLs>("hc", args, { timeoutMs: HC_TIMEOUT_MS, signal: options.signal });
	const me = myAddress();
	return {
		terminals: (listed.terminals ?? []).map((terminal) => toTerminalInfo(terminal, me)),
		machines: (listed.machines ?? []).map((machine) => ({
			name: machine.name ?? "",
			state: machine.state ?? "",
		})),
		hiddenFinished: listed.hidden_finished ?? 0,
	};
}

export async function readWindow(options: { signal?: AbortSignal | undefined } = {}): Promise<WindowInfo> {
	try {
		const [listed, status] = await Promise.all([
			runCliJson<WindowLs>("herdr-app", ["ls"], { timeoutMs: WINDOW_TIMEOUT_MS, signal: options.signal }),
			runCliJson<WindowStatus>("herdr-app", ["status"], { timeoutMs: WINDOW_TIMEOUT_MS, signal: options.signal }),
		]);
		return {
			open: true,
			problem: null,
			errors: (status.errors ?? []).map((error) => (typeof error === "string" ? error : JSON.stringify(error))),
			focusedPane: status.focused_pane ?? null,
			spaces: listed.spaces ?? [],
		};
	} catch (error) {
		if (error instanceof CliError && error.kind === "missing") throw error;
		if (error instanceof Error && /aborted/.test(error.message)) throw error;
		return {
			open: false,
			problem: error instanceof Error ? error.message : String(error),
			errors: [],
			focusedPane: null,
			spaces: [],
		};
	}
}

/** The pane, space and tab showing a terminal; mirrors what the window lists. */
export function findTerminal(spaces: WindowSpace[], address: string | null): WindowLocation {
	if (!address) return NO_LOCATION;
	for (const space of spaces) {
		for (const tab of space.tabs ?? []) {
			for (const terminal of tab.terminals ?? []) {
				if (terminal.terminal !== address) continue;
				return {
					pane: terminal.pane ?? null,
					space: space.id,
					spaceName: space.name ?? null,
					tab: tab.id,
					tabName: tab.name ?? null,
					app: terminal.app ?? null,
					name: terminal.name ?? null,
					status: terminal.status ?? null,
				};
			}
		}
	}
	return NO_LOCATION;
}

export async function locateTerminal(
	address: string | null,
	options: { signal?: AbortSignal | undefined } = {},
): Promise<WindowLocation> {
	const window = await readWindow(options);
	return findTerminal(window.spaces, address);
}

/** The window learns about a terminal a moment after hc created it. */
export async function locateTerminalWhenShown(
	address: string | null,
	options: { signal?: AbortSignal | undefined; attempts?: number; delayMs?: number } = {},
): Promise<WindowLocation> {
	const attempts = options.attempts ?? 6;
	const delayMs = options.delayMs ?? 200;
	let located = NO_LOCATION;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		located = await locateTerminal(address, { signal: options.signal });
		if (located.pane) return located;
		if (attempt < attempts) await delay(delayMs);
	}
	return located;
}

export async function readSnapshot(
	options: { signal?: AbortSignal | undefined; all?: boolean } = {},
): Promise<Snapshot> {
	const me = myAddress();
	const [listed, window] = await Promise.all([listTerminals(options), readWindow(options)]);
	return {
		me,
		location: findTerminal(window.spaces, me),
		focusedPane: window.focusedPane,
		windowOpen: window.open,
		windowProblem: window.problem,
		windowErrors: window.errors,
		machines: listed.machines,
		terminals: listed.terminals,
		hiddenFinished: listed.hiddenFinished,
	};
}

function toTerminalInfo(terminal: NonNullable<HcLs["terminals"]>[number], me: string | null): TerminalInfo {
	return {
		address: terminal.address,
		name: terminal.name ?? "",
		agent: terminal.agent ?? "",
		cwd: terminal.cwd ?? "",
		parent: terminal.parent ?? null,
		state: terminal.state ?? "",
		status: terminal.status ?? "",
		turn: terminal.turn ?? 0,
		where: terminal.where ?? "",
		isMe: me !== null && terminal.address === me,
	};
}
