import { CliError } from "./cli.ts";
import type { Snapshot, StartResult, TerminalInfo } from "./types.ts";

export function formatTerminal(terminal: TerminalInfo): string {
	const fields = [
		`${terminal.isMe ? "*" : " "}${terminal.address}`,
		terminal.agent || "?",
		terminal.status || "-",
		`turn ${terminal.turn}`,
		terminal.name ? `name ${terminal.name}` : "",
		terminal.parent ? `parent ${terminal.parent}` : "",
		terminal.where,
		`cwd ${terminal.cwd}`,
	];
	return fields.filter((field) => field !== "").join("  ");
}

export function formatSnapshot(snapshot: Snapshot): string {
	const lines: string[] = [];
	const location = snapshot.location;
	if (snapshot.me) {
		const where = [location.spaceName, location.tabName].filter((name) => name).join(" / ");
		const fields = [
			`me: ${snapshot.me}`,
			location.pane ? `pane ${location.pane}` : "no pane (hidden)",
			where ? `${where}` : "",
			location.app ? `app ${location.app}` : "",
		];
		lines.push(fields.filter((field) => field !== "").join("  "));
	} else {
		lines.push("me: not inside a herdr terminal (HC_TERMINAL_ID is empty)");
	}

	if (snapshot.windowOpen) {
		const focus = snapshot.focusedPane
			? `focused pane ${snapshot.focusedPane}${snapshot.focusedPane === location.pane ? " (this session)" : ""}`
			: "no focused pane";
		lines.push(`window: open  ${focus}`);
	} else {
		lines.push(`window: not reachable — ${snapshot.windowProblem ?? "no window"}`);
	}

	if (snapshot.machines.length > 0) {
		lines.push(`machines: ${snapshot.machines.map((machine) => `${machine.name}=${machine.state}`).join("  ")}`);
	}
	if (snapshot.hiddenFinished > 0) {
		lines.push(`hidden finished terminals: ${snapshot.hiddenFinished} (pass include_finished to list them)`);
	}
	if (snapshot.windowErrors.length > 0) {
		lines.push(`window errors: ${snapshot.windowErrors.join(" | ")}`);
	}

	lines.push("", `terminals (${snapshot.terminals.length}):`);
	for (const terminal of snapshot.terminals) lines.push(` ${formatTerminal(terminal)}`);
	if (snapshot.terminals.some((terminal) => terminal.status === "")) {
		lines.push("", 'Status "-" means the program reports nothing over OSC 7501; it is not idle.');
	}
	return lines.join("\n");
}

export function formatStart(result: StartResult): string {
	const where = [result.spaceName, result.tabName].filter((name) => name).join(" / ");
	const lines = [
		`started ${result.address} as "${result.name}" (${result.placement})`,
		[
			result.pane ? `pane ${result.pane}` : "hidden",
			where,
			`parent ${result.parent ?? "none"}`,
			`outlive_parent ${result.outliveParent}`,
			`state ${result.state || "?"}`,
			`status ${result.status || "-"}`,
			`turn ${result.turn}`,
		]
			.filter((field) => field !== "")
			.join("  "),
	];
	if (result.taskFile) lines.push(`task file: ${result.taskFile}`);
	if (result.warnings.length > 0) lines.push("", "warnings:", ...result.warnings.map((warning) => `- ${warning}`));
	if (result.steps.length > 0) lines.push("", "steps:", ...result.steps.map((step) => `- ${step}`));
	return lines.join("\n");
}

/** Keep model-facing output bounded; the terminal itself still has everything. */
export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return {
		text: `${text.slice(0, maxChars)}\n… truncated ${text.length - maxChars} characters; read again with a lower lines value or inspect the terminal yourself`,
		truncated: true,
	};
}

export function formatError(error: unknown): string {
	if (error instanceof CliError) {
		const hint = error.hint ? `\n${error.hint}` : "";
		return `${error.kind}: ${error.message}${hint}`;
	}
	if (error instanceof Error) return error.message;
	return String(error);
}

export function describeError(error: unknown): Record<string, unknown> {
	if (error instanceof CliError) {
		return { kind: error.kind, message: error.message, hint: error.hint, exitCode: error.exitCode, command: error.command };
	}
	return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}
