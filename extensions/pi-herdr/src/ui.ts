import { CliError, delay, firstLine, runCli } from "./cli.ts";

/** A terminal started by hc reaches the window a moment after hc run returns. */
const NOT_YET_KNOWN_ATTEMPTS = 10;
const NOT_YET_KNOWN_DELAY_MS = 300;

/**
 * The window commands this extension drives. Destructive commands
 * (space.close, tab.close, pane.close, terminal.kill) are deliberately absent:
 * cleanup goes through `herdr_kill`, which requires the user's request.
 */
export interface DoCommand {
	/** Argument names `herdr-app do` accepts, in the order its own list prints them. */
	args: readonly string[];
	required?: readonly string[];
	about: string;
}

export const DO_COMMANDS: Readonly<Record<string, DoCommand>> = {
	"space.new": {
		args: ["name", "folder", "tab", "argv", "task", "machine"],
		about: "Make a space with a first tab, optionally with an agent in it.",
	},
	"space.rename": { args: ["id", "name"], about: "Rename a space." },
	"space.move": { args: ["id", "index"], required: ["id", "index"], about: "Move a space to an index." },
	"space.select": { args: ["index", "id"], about: "Select a space by index or id." },
	"space.next": { args: [], about: "Select the next space." },
	"space.prev": { args: [], about: "Select the previous space." },
	"tab.new": {
		args: ["name", "space", "folder", "argv", "task", "mod", "props"],
		about: "Make a tab in a space and show it, with a terminal or a mod as its only pane.",
	},
	"tab.rename": { args: ["id", "name"], about: "Rename a tab." },
	"tab.move": { args: ["id", "index"], required: ["id", "index"], about: "Move a tab to an index." },
	"tab.select": { args: ["index", "id"], about: "Select a tab by index or id." },
	"tab.next": { args: [], about: "Select the next tab." },
	"tab.prev": { args: [], about: "Select the previous tab." },
	"tab.settle": { args: ["id"], about: "Settle a tab so the window stops animating it." },
	"tab.unsettle": { args: ["id"], about: "Unsettle a tab." },
	"pane.split": {
		args: ["direction", "pane", "argv", "mod", "props"],
		required: ["direction"],
		about: 'Split a pane "right" or "down" with a new terminal, or with a mod beside it.',
	},
	"pane.focus": { args: ["pane", "terminal"], about: "Focus a pane, or the pane showing a terminal." },
	"pane.zoom": { args: ["pane"], about: "Toggle a pane's zoom." },
	"pane.go": { args: ["direction"], required: ["direction"], about: "Move focus to a neighbouring pane." },
	"pane.swap": { args: ["direction"], required: ["direction"], about: "Swap the focused pane with a neighbour." },
	"terminal.open": {
		args: ["argv", "folder", "place", "name"],
		about: 'Start a terminal as a new tab (place "tab", the default) or "right"/"down" of the focused pane.',
	},
	"terminal.keep": {
		args: ["terminal", "place"],
		required: ["terminal"],
		about: 'Give a running terminal without a pane a pane: "tab", "right" or "down".',
	},
	"terminal.park": {
		args: ["terminal"],
		required: ["terminal"],
		about: "Remove a terminal's pane and keep it running.",
	},
	"terminal.show": {
		args: ["terminal", "pane"],
		about: "Show a terminal in a pane for now, in place of its own.",
	},
	"terminal.peek": { args: ["terminal"], required: ["terminal"], about: "Peek at a running terminal over the tab." },
	"terminal.copy": { args: [], about: "Copy the focused terminal's selection." },
	"terminal.paste": { args: [], about: "Paste into the focused terminal." },
	"agent.focus": { args: ["terminal"], required: ["terminal"], about: "Show an agent, sub-agents included." },
	"agent.next": { args: [], about: "Show the next agent." },
	"agent.prev": { args: [], about: "Show the previous agent." },
	"layout.switch": { args: ["name"], about: "Switch to a named layout." },
	"layout.show": { args: ["id"], required: ["id"], about: "Show a layout element." },
	"layout.hide": { args: ["id"], required: ["id"], about: "Hide a layout element." },
};

export function describeDoCommand(command: string): string {
	const spec = specFor(command);
	if (!spec) {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command} is not driven by this extension`, {
			hint: `Supported: ${Object.keys(DO_COMMANDS).join(", ")}. Run herdr-app do yourself for anything else, and read its output.`,
		});
	}
	const required = new Set(spec.required ?? []);
	const args = spec.args.length
		? spec.args.map((name) => (required.has(name) ? `${name} (required)` : name)).join(", ")
		: "none";
	return `${command}: ${spec.about}\narguments: ${args}`;
}

export function listDoCommands(): string {
	const lines = Object.keys(DO_COMMANDS).map((command) => describeDoCommand(command).split("\n")[0]);
	return [`herdr-app do commands herdr_ui drives (${lines.length}):`, ...lines].join("\n");
}

/** True for the commands herdr_ui may run; destructive ones stay behind herdr_kill. */
export function isPublicDoCommand(command: string): boolean {
	return command in DO_COMMANDS;
}

/** Destructive window commands, reached from herdr_kill instead of herdr_ui. */
const INTERNAL_DO_COMMANDS: Readonly<Record<string, DoCommand>> = {
	"pane.close": { args: ["pane"], about: "Close a pane and end its terminal." },
	"terminal.kill": { args: ["terminal"], required: ["terminal"], about: "End a terminal and its sub-agents." },
};

function specFor(command: string): DoCommand | undefined {
	return DO_COMMANDS[command] ?? INTERNAL_DO_COMMANDS[command];
}

/**
 * Run one window command. Arguments travel as a single JSON object, so arrays
 * and nested values survive without shell quoting and unknown names fail loudly.
 */
export async function runDo(
	command: string,
	args: Record<string, unknown> = {},
	options: { signal?: AbortSignal | undefined; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
	const spec = specFor(command);
	if (!spec) {
		describeDoCommand(command);
		throw new Error("unreachable");
	}

	const known = new Set(spec.args);
	const unknown = Object.keys(args).filter((key) => args[key] !== undefined && !known.has(key));
	if (unknown.length > 0) {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command} has no argument named ${unknown.join(", ")}`, {
			hint: describeDoCommand(command),
		});
	}
	const missing = (spec.required ?? []).filter((key) => args[key] === undefined);
	if (missing.length > 0) {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command} needs ${missing.join(", ")}`, {
			hint: describeDoCommand(command),
		});
	}

	const payload = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
	for (let attempt = 1; ; attempt += 1) {
		try {
			const stdout = await runCli("herdr-app", ["do", command, JSON.stringify(payload)], {
				timeoutMs: options.timeoutMs ?? 15_000,
				signal: options.signal,
			});
			return parseDoResult(command, stdout);
		} catch (error) {
			if (attempt >= NOT_YET_KNOWN_ATTEMPTS || !isNotYetKnown(error)) throw error;
			await delay(NOT_YET_KNOWN_DELAY_MS);
		}
	}
}

function isNotYetKnown(error: unknown): boolean {
	return error instanceof CliError && /no running terminal/i.test(error.message);
}

function parseDoResult(command: string, stdout: string): Record<string, unknown> {
	const text = stdout.trim();
	if (!text) {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command} printed nothing`, {
			hint: "Read herdr-app ls to see whether the window changed before retrying.",
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command} printed no JSON`, {
			hint: firstLine(text),
		});
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command} printed an unexpected result`, {
			hint: firstLine(text),
		});
	}
	const error = (parsed as { error?: unknown }).error;
	if (typeof error === "string") {
		throw new CliError("herdr-app", "failed", `herdr-app do ${command}: ${error}`);
	}
	return parsed as Record<string, unknown>;
}
