import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CliError, runCliJson } from "./cli.ts";
import { describeError, formatError, formatSnapshot, formatStart, truncateText } from "./format.ts";
import { startTerminal } from "./start.ts";
import { locateTerminal, myAddress, readSnapshot } from "./terminals.ts";
import type { Direction, Placement } from "./types.ts";
import { describeDoCommand, DO_COMMANDS, isPublicDoCommand, listDoCommands, runDo } from "./ui.ts";

/** Upper bound for text a tool shows the model; the terminal keeps the rest. */
const READ_CHAR_LIMIT = 12_000;

const includeFinished = Type.Optional(
	Type.Boolean({ description: "Also list finished terminals (hc ls --all). Defaults to false." }),
);

const terminalAddress = (description: string) => Type.String({ description });

const terminalsTool = defineTool({
	name: "herdr_terminals",
	label: "Herdr: Terminals",
	description:
		"List herdr terminals, machines, and the window's focused pane, and say which pane shows this session. Addresses, OSC 7501 status and turn come from herdr, not from the transcript.",
	promptSnippet: "List herdr terminals, machines, and which pane shows this session",
	promptGuidelines: [
		"Use herdr_terminals before sending to, waiting on, or cleaning up a terminal: read addresses and states from it instead of transcript text or the order in the window.",
		'A terminal with status "-" reports nothing over OSC 7501; it is not idle and no status may be inferred from its screen.',
	],
	parameters: Type.Object({ include_finished: includeFinished }),
	annotations: { readOnlyHint: true },
	/** Deferred: loaded on demand, so a session that never touches herdr pays nothing. */
	exposure: "deferred",
	async execute(_id, params, signal) {
		try {
			const snapshot = await readSnapshot({ signal, all: params.include_finished });
			return textResult(formatSnapshot(snapshot), snapshot);
		} catch (error) {
			return errorResult(error);
		}
	},
});

const startTool = defineTool({
	name: "herdr_start",
	label: "Herdr: Start",
	description:
		"Start an agent or program in a herdr terminal and, by default, show it in a new pane beside this session. Always runs with --outlive-parent and verifies the terminal survives this session.",
	promptSnippet: "Start an agent or program in a herdr terminal that outlives this session",
	promptGuidelines: [
		"Start agents and long-running programs with herdr_start; do not run hc run or pwsh through the shell tool.",
		"herdr_terminals, herdr_read and herdr_wait are deferred: when they are not declared, load them with tool_search (query \"herdr\").",
		"Pass the program as argv (for example [\"pi\"] or [\"claude\", \"--no-daemon\"]). Put provider and model flags in argv; never guess a model id, and ask the user when the agent or model is unclear.",
		"Task text longer than a line, or containing quotes, $ or backticks, is written to a file and passed by path; the result names that file.",
		"herdr_start proves the terminal exists, not that its program is ready: read the terminal or check turn before assuming it is working.",
	],
	parameters: Type.Object({
		argv: Type.Array(Type.String(), {
			description: 'Program and its arguments, for example ["pi"] or ["claude", "--no-daemon"]. The task is appended as the last argument.',
		}),
		task: Type.Optional(
			Type.String({
				description: "The agent's first message. Long, multi-line or quote-heavy text is written to a file and passed as a path.",
			}),
		),
		name: Type.Optional(
			Type.String({
				description: "Terminal name, unique among live terminals; sanitized to a-z 0-9 - _ and incremented when taken.",
			}),
		),
		cwd: Type.Optional(
			Type.String({ description: "Working directory for the new terminal. Defaults to this session's cwd." }),
		),
		placement: Type.Optional(
			Type.Union([Type.Literal("pane"), Type.Literal("tab"), Type.Literal("background")], {
				description:
					"pane: split beside this session and give the terminal a pane (default). tab: open a new tab. background: stay hidden and out of the window.",
			}),
		),
		direction: Type.Optional(
			Type.Union([Type.Literal("right"), Type.Literal("down")], {
				description: "Split direction for placement pane. Defaults to right.",
			}),
		),
		focus: Type.Optional(
			Type.Boolean({ description: "Show the new terminal after splitting (placement pane only). Defaults to true." }),
		),
		inline_task: Type.Optional(
			Type.Boolean({
				description: "Pass the task verbatim even when it looks unsafe for hc's command line. Defaults to false.",
			}),
		),
	}),
	async execute(_id, params, signal, _onUpdate, ctx) {
		try {
			const result = await startTerminal(
				{
					argv: params.argv,
					task: params.task,
					name: params.name,
					cwd: params.cwd,
					placement: (params.placement ?? "pane") as Placement,
					direction: (params.direction ?? "right") as Direction,
					focus: params.focus ?? true,
					inlineTask: params.inline_task ?? false,
				},
				{ cwd: ctx.cwd, signal },
			);
			return textResult(formatStart(result), result);
		} catch (error) {
			return errorResult(error);
		}
	},
});

const sendTool = defineTool({
	name: "herdr_send",
	label: "Herdr: Send",
	description: "Paste text into a herdr terminal and press Enter, optionally waiting for the turn it starts.",
	promptSnippet: "Send text to a herdr terminal and press Enter",
	promptGuidelines: [
		"Never force a blocked terminal: herdr_send refuses it, so read the terminal and report the blocker to the user instead.",
		"started false or null does not mean undelivered; read the terminal once instead of resending.",
		"Use if_status only for programs that report a status; silent programs never match it.",
	],
	parameters: Type.Object({
		terminal: terminalAddress("Terminal address (t7, vps/t7) or a unique name."),
		text: Type.String({ description: "Text pasted into the terminal, then submitted with Enter." }),
		wait: Type.Optional(Type.Boolean({ description: "Wait for the turn this send starts." })),
		timeout: Type.Optional(
			Type.Number({ description: "With wait: seconds before it checks in, leaving the terminal running." }),
		),
		if_status: Type.Optional(
			Type.Union([Type.Literal("idle"), Type.Literal("working")], {
				description: "Only type when the program reports exactly this status. Omit for silent programs.",
			}),
		),
	}),
	async execute(_id, params, signal) {
		try {
			const args = ["send", "--json", params.terminal, params.text];
			if (params.wait) args.push("--wait");
			if (params.timeout !== undefined) {
				if (!params.wait) {
					throw new CliError("hc", "failed", "timeout only applies with wait", { hint: "Set wait: true, or drop timeout." });
				}
				args.push("--timeout", String(params.timeout));
			}
			if (params.if_status) args.push("--if", params.if_status);
			const seconds = params.timeout ?? 180;
			const result = await runCliJson<Record<string, unknown>>("hc", args, {
				timeoutMs: params.wait ? (seconds + 30) * 1000 : 60_000,
				signal,
			});
			const lines = [`sent to ${params.terminal} (started: ${String(result.started)})`];
			if (result.status !== undefined || result.reason !== undefined) {
				lines.push(
					`wait: status ${String(result.status ?? "?")}  turn ${String(result.turn ?? "?")}  reason ${String(result.reason ?? "?")}`,
				);
			}
			if (result.started === false || result.started === null) {
				lines.push("started is not proof of delivery: read the terminal before sending again.");
			}
			return textResult(lines.join("\n"), result);
		} catch (error) {
			if (error instanceof CliError && error.kind === "status_mismatch" && params.if_status) {
				return errorResult(
					new CliError("hc", "status_mismatch", error.message, {
						hint: "The target reports no matching status, so if_status can never hold. Retry without if_status.",
					}),
				);
			}
			return errorResult(error);
		}
	},
});

const waitTool = defineTool({
	name: "herdr_wait",
	label: "Herdr: Wait",
	description: "Wait for a herdr terminal to stop working, or for this session's child terminals.",
	promptSnippet: "Wait for a herdr terminal or its children instead of sleeping",
	promptGuidelines: [
		"Use herdr_wait instead of sleeping or polling.",
		'Reason "timeout" is a check-in, not a failure: the terminal is still working when the wait returns.',
	],
	parameters: Type.Object({
		terminal: Type.Optional(terminalAddress("Terminal address or unique name. Omit to wait on children or on this session.")),
		children: Type.Optional(
			Type.Union([Type.Literal("any"), Type.Literal("all")], {
				description:
					"Wait on child terminals instead of one terminal: any waits for the next news or the next child to stop, all waits until none is working.",
			}),
		),
		output: Type.Optional(
			Type.String({
				description: "For programs, not agents: end once output printed after the wait started contains this text.",
			}),
		),
		timeout: Type.Optional(
			Type.Number({ description: "Seconds before the wait checks in. Defaults to hc's own 180." }),
		),
	}),
	annotations: { readOnlyHint: true },
	/** Deferred: the skill names it, and one tool_search loads it for the branch. */
	exposure: "deferred",
	async execute(_id, params, signal) {
		try {
			const seconds = params.timeout ?? 180;
			const args = ["wait", "--json"];
			if (params.terminal) args.push(params.terminal);
			if (params.children) args.push("--children", params.children);
			if (params.output) args.push("--output", params.output);
			if (params.timeout !== undefined) args.push("--timeout", String(params.timeout));
			const result = await runCliJson<Record<string, unknown>>("hc", args, {
				timeoutMs: (seconds + 30) * 1000,
				signal,
			});
			const target = String(result.terminal ?? params.terminal ?? "children");
			const lines = [
				`wait ${target} → status ${String(result.status ?? "?")}  turn ${String(result.turn ?? "?")}  reason ${String(result.reason ?? "?")}`,
			];
			if (result.exit_code !== null && result.exit_code !== undefined) lines.push(`exit code ${String(result.exit_code)}`);
			if (result.reason === "timeout") lines.push("This is a check-in, not a failure: the terminal keeps working.");
			return textResult(lines.join("\n"), result);
		} catch (error) {
			return errorResult(error);
		}
	},
});

const readTool = defineTool({
	name: "herdr_read",
	label: "Herdr: Read",
	description: "Read a herdr terminal's screen and recent output.",
	promptSnippet: "Read a herdr terminal's screen",
	promptGuidelines: [
		'Read a terminal to decide the next step; do not copy long output into the reply.',
		'how "screen" returns the viewport of a running program; "history" returns the stitched history of a finished terminal.',
	],
	parameters: Type.Object({
		terminal: terminalAddress("Terminal address (t7, vps/t7) or a unique name."),
		lines: Type.Optional(Type.Number({ description: "Lines of history above the screen. Defaults to 0." })),
	}),
	annotations: { readOnlyHint: true },
	/** Deferred: reading is on demand, and one tool_search loads it for the branch. */
	exposure: "deferred",
	async execute(_id, params, signal) {
		try {
			const args = ["read", "--json", params.terminal];
			if (params.lines !== undefined) args.push("--lines", String(params.lines));
			const result = await runCliJson<{ complete?: boolean; how?: string; text?: string; why?: string }>("hc", args, {
				timeoutMs: 30_000,
				signal,
			});
			const body = truncateText(result.text ?? "", READ_CHAR_LIMIT);
			const header = [
				`${params.terminal} · how ${result.how ?? "?"}`,
				result.complete === false ? "incomplete" : "",
				result.why ? `why ${result.why}` : "",
			]
				.filter((field) => field !== "")
				.join("  ");
			return textResult(`${header}\n\n${body.text}`, {
				terminal: params.terminal,
				how: result.how,
				complete: result.complete,
				why: result.why,
				truncated: body.truncated,
			});
		} catch (error) {
			return errorResult(error);
		}
	},
});

const uiTool = defineTool({
	name: "herdr_ui",
	label: "Herdr: Window",
	description:
		"Run a herdr-app window command (split, focus, peek, show, open, layouts) with validated arguments. Omit command to list what is supported, omit args to see one command's arguments.",
	promptSnippet: "Drive the herdr window: split, focus, peek, show",
	promptGuidelines: [
		"Use herdr_ui for what the user sees; use the hc tools for starting, messaging, waiting on and cleaning up terminals.",
		"Do not create spaces or tabs the user did not ask for, and pass pane, space and tab ids you read from herdr_terminals.",
		"Ask herdr_ui for a command's arguments instead of guessing argument names.",
	],
	parameters: Type.Object({
		command: Type.Optional(
			Type.String({ description: "herdr-app do command, for example pane.split or agent.focus. Omit to list supported commands." }),
		),
		args: Type.Optional(
			Type.Record(Type.String(), Type.Unknown(), {
				description: "Command arguments, named as herdr-app names them. Omit to see a command's arguments.",
			}),
		),
	}),
	async execute(_id, params, signal) {
		try {
			if (!params.command) return textResult(listDoCommands(), { commands: Object.keys(DO_COMMANDS) });
			if (!isPublicDoCommand(params.command)) {
				throw new CliError("herdr-app", "failed", `herdr-app do ${params.command} is not driven by herdr_ui`, {
					hint: `Use herdr_kill for pane.close and terminal.kill. herdr_ui drives: ${Object.keys(DO_COMMANDS).join(", ")}.`,
				});
			}
			const requested = (params.args ?? {}) as Record<string, unknown>;
			if (Object.keys(requested).length === 0) {
				return textResult(describeDoCommand(params.command), { command: params.command, spec: DO_COMMANDS[params.command] });
			}
			const args = await withWindowDefaults(params.command, requested, signal);
			const result = await runDo(params.command, args, { signal });
			return textResult(`${params.command} → ${JSON.stringify(result)}`, result);
		} catch (error) {
			return errorResult(error);
		}
	},
});

const killTool = defineTool({
	name: "herdr_kill",
	label: "Herdr: Kill",
	description:
		"End a herdr terminal's program, the terminal itself, or the pane showing it. Destructive: it refuses unless the user asked for it.",
	promptSnippet: "End a herdr program, terminal or pane after the user confirms",
	promptGuidelines: [
		"Ask the user before calling herdr_kill; pass confirm: true only after they agreed.",
		"After a successful handoff or task, leave everything running: a closed terminal cannot be taken over.",
		"Clean up only terminals this session started, and only after a failure or when the user says so.",
	],
	parameters: Type.Object({
		terminal: terminalAddress("Terminal address (t7, vps/t7) or a unique name."),
		scope: Type.Optional(
			Type.Union([Type.Literal("program"), Type.Literal("terminal"), Type.Literal("pane")], {
				description:
					"program ends the program and keeps the terminal; terminal ends it and its sub-agents; pane closes the pane showing it. Defaults to program.",
			}),
		),
		confirm: Type.Boolean({ description: "True only after the user asked for this. The tool refuses without it." }),
	}),
	annotations: { destructiveHint: true },
	async execute(_id, params, signal) {
		try {
			if (params.confirm !== true) {
				throw new CliError("hc", "failed", `herdr_kill ${params.terminal} needs the user's explicit request`, {
					hint: "Ask the user first; only then retry with confirm: true.",
				});
			}
			const scope = params.scope ?? "program";
			if (scope === "program") {
				await runCliJson("hc", ["kill", params.terminal, "--json"], { timeoutMs: 30_000, signal });
			} else if (scope === "terminal") {
				await runDo("terminal.kill", { terminal: params.terminal }, { signal });
			} else {
				const location = await locateTerminal(params.terminal, { signal });
				if (!location.pane) {
					throw new CliError("herdr-app", "failed", `${params.terminal} has no pane in the window`, {
						hint: "Use scope program or terminal, and pass the address herdr_terminals lists rather than a name.",
					});
				}
				await runDo("pane.close", { pane: location.pane }, { signal });
			}
			return textResult(`ended ${params.terminal} (${scope})`, { terminal: params.terminal, scope });
		} catch (error) {
			return errorResult(error);
		}
	},
});

/** Fill in the ids and directions the window would otherwise take from the wrong place. */
async function withWindowDefaults(
	command: string,
	args: Record<string, unknown>,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const next: Record<string, unknown> = { ...args };
	if (command === "pane.split") {
		next.direction ??= "right";
		next.pane ??= (await locateTerminal(myAddress(), { signal })).pane ?? undefined;
	} else if (command === "pane.focus" && next.pane === undefined && next.terminal === undefined) {
		next.pane = (await locateTerminal(myAddress(), { signal })).pane ?? undefined;
	} else if (command === "terminal.keep") {
		next.place ??= "right";
	}
	return next;
}

export default function herdrExtension(pi: ExtensionAPI) {
	pi.registerTool(terminalsTool);
	pi.registerTool(startTool);
	pi.registerTool(sendTool);
	pi.registerTool(waitTool);
	pi.registerTool(readTool);
	pi.registerTool(uiTool);
	pi.registerTool(killTool);

	pi.registerCommand("herdr", {
		description: "Show herdr terminals, focus or peek at one, or end one",
		handler: async (rawArgs, ctx) => {
			const [subcommand, ...rest] = (rawArgs ?? "").trim().split(/\s+/).filter((word) => word !== "");
			try {
				switch (subcommand) {
					case undefined:
					case "status":
					case "ls": {
						const snapshot = await readSnapshot({ all: false });
						report(
							ctx,
							formatSnapshot(snapshot),
							snapshot.windowOpen && snapshot.windowErrors.length === 0 ? "info" : "warning",
						);
						return;
					}
					case "focus":
					case "peek": {
						const terminal = rest[0] ?? (await pickTerminal(ctx, `${subcommand === "focus" ? "Focus" : "Peek at"} which terminal?`));
						if (!terminal) return;
						await runDo(subcommand === "focus" ? "agent.focus" : "terminal.peek", { terminal });
						report(ctx, `${subcommand === "focus" ? "focused" : "peeking at"} ${terminal}`);
						return;
					}
					case "kill": {
						const terminal = rest[0] ?? (await pickTerminal(ctx, "End which terminal?"));
						if (!terminal) return;
						const agreed = await confirmKill(ctx, terminal);
						if (!agreed) return;
						await runCliJson("hc", ["kill", terminal, "--json"], { timeoutMs: 30_000 });
						report(ctx, `ended ${terminal}`, "warning");
						return;
					}
					case "help":
						report(ctx, "usage: /herdr [status | focus [terminal] | peek <terminal> | kill [terminal]]");
						return;
					default:
						report(ctx, `/herdr ${subcommand} is not a subcommand; try /herdr help`, "warning");
						return;
				}
			} catch (error) {
				report(ctx, `herdr: ${formatError(error)}`, "error");
			}
		},
	});
}

interface Reporter {
	hasUI: boolean;
	ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		select(title: string, options: string[]): Promise<string | undefined>;
		confirm(title: string, message: string): Promise<boolean>;
	};
}

function report(ctx: Reporter, message: string, level: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	if (level === "info") console.log(message);
	else console.error(message);
}

async function pickTerminal(ctx: Reporter, title: string): Promise<string | undefined> {
	if (!ctx.hasUI) return undefined;
	const snapshot = await readSnapshot({});
	if (snapshot.terminals.length === 0) {
		report(ctx, "no live terminals", "warning");
		return undefined;
	}
	const labels = snapshot.terminals.map(
		(terminal) =>
			`${terminal.address}  ${terminal.agent || "?"}  ${terminal.status || "-"}  ${terminal.name || terminal.cwd}`,
	);
	const picked = await ctx.ui.select(title, labels);
	return picked?.split(/\s+/)[0];
}

async function confirmKill(ctx: Reporter, terminal: string): Promise<boolean> {
	if (!ctx.hasUI) return false;
	return await ctx.ui.confirm(
		"End terminal?",
		`hc kill ${terminal} ends its program and keeps the terminal. Cleanup is for failed starts and cancelled handoffs only.`,
	);
}

function textResult(text: string, details: unknown) {
	return { content: [{ type: "text" as const, text }], details };
}

function errorResult(error: unknown) {
	return {
		content: [{ type: "text" as const, text: formatError(error) }],
		details: { error: describeError(error) },
		isError: true,
	};
}
