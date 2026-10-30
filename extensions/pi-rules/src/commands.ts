/** `/rules` subcommands: listing, local toggles, diagnostics and the full prompt. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { collectEnv } from "./machine.ts";
import { report } from "./report.ts";
import type { Diagnostic, Fragment, MachineEnv, RulesRuntime } from "./types.ts";

const USAGE = [
	"`/rules` · `/rules list` — fragments and why they did or did not apply",
	"`/rules toggle <id>` — enable or disable a fragment on this machine",
	"`/rules reload` — re-read fragments and local state",
	"`/rules doctor` — sources, size, profile, injected state, diagnostics",
	"`/rules prompt` — the full injected system prompt from the transcript",
].join("\n");

export async function runRulesCommand(
	args: string,
	ctx: ExtensionCommandContext,
	runtime: RulesRuntime,
	activeTools: string[],
): Promise<void> {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const subcommand = parts[0] ?? "list";
	const env = collectEnv({ cwd: ctx.cwd, model: ctx.model, tools: activeTools });

	try {
		switch (subcommand) {
			case "list":
				showList(ctx, runtime, env);
				return;
			case "toggle":
				toggleFragment(ctx, runtime, parts[1]);
				return;
			case "reload":
				reload(ctx, runtime);
				return;
			case "doctor":
				showDoctor(ctx, runtime, env);
				return;
			case "prompt":
			case "system":
				showPrompt(ctx);
				return;
			default:
				ctx.ui.notify(`pi-rules: unknown subcommand "${subcommand}"`, "error");
				report(ctx, "pi-rules · usage", USAGE);
		}
	} catch (error) {
		ctx.ui.notify(`pi-rules: ${errorMessage(error)}`, "error");
	}
}

function showList(ctx: ExtensionCommandContext, runtime: RulesRuntime, env: MachineEnv): void {
	const plan = runtime.plan(env);
	const lines = [
		`${plan.active.length} / ${runtime.fragments.length} active · ${plan.chars} chars`,
		"",
	];

	for (const fragment of runtime.fragments) {
		const active = plan.active.find((item) => item.id === fragment.meta.id);
		const dropped = plan.dropped.find((item) => item.id === fragment.meta.id);
		const marker = active ? "✓" : "✗";
		const detail = active ? `${active.chars} chars` : (dropped?.reason ?? "not matched");
		lines.push(`- ${marker} ${fragment.meta.id} · ${fragment.source.kind} · ${detail}`);
	}
	if (runtime.fragments.length === 0) lines.push("- no fragments found; add Markdown files under rules/");

	const problems = runtime.diagnostics.filter((diagnostic) => diagnostic.level === "error");
	if (problems.length > 0) lines.push("", `${plural(problems.length, "problem")} found; run /rules doctor`);

	report(ctx, "pi-rules · fragments", lines.join("\n"));
}

function toggleFragment(ctx: ExtensionCommandContext, runtime: RulesRuntime, query: string | undefined): void {
	if (!query) {
		ctx.ui.notify("pi-rules: /rules toggle needs a fragment id", "error");
		return;
	}
	const fragment = findFragment(runtime, query);
	if (!fragment) {
		ctx.ui.notify(`pi-rules: no fragment matching "${query}"`, "error");
		return;
	}
	const disabled = !runtime.state.disabled.includes(fragment.meta.id);
	runtime.setDisabled(fragment.meta.id, disabled);
	ctx.ui.notify(`pi-rules: ${fragment.meta.id} ${disabled ? "disabled" : "enabled"} on this machine`, "info");
}

function reload(ctx: ExtensionCommandContext, runtime: RulesRuntime): void {
	runtime.refresh();
	const problems = runtime.diagnostics.filter((diagnostic) => diagnostic.level === "error").length;
	ctx.ui.notify(
		`pi-rules: ${plural(runtime.fragments.length, "fragment")} loaded${problems > 0 ? `, ${plural(problems, "problem")}` : ""}`,
		problems > 0 ? "warning" : "info",
	);
}

function showDoctor(ctx: ExtensionCommandContext, runtime: RulesRuntime, env: MachineEnv): void {
	const plan = runtime.plan(env);
	const recorded = replaySystemMessages(ctx).sections;
	const lines: string[] = ["## Sources"];

	for (const source of runtime.sources) {
		const count = runtime.fragments.filter((fragment) => fragment.source.dir === source.dir).length;
		lines.push(`- ${source.kind}: \`${source.dir}\` · ${plural(count, "fragment")}`);
	}

	lines.push(
		"",
		"## Size",
		`- ${plan.chars} chars · ${plural(plan.guidelines.length, "guideline")}`,
		"",
		"## Profile",
		`- os: \`${env.os}\` · host: \`${env.host}\``,
		`- cwd: \`${env.cwd}\``,
		`- model: ${env.model ? `\`${env.model}\`` : "(none)"}`,
		`- tools: ${env.tools.length > 0 ? env.tools.map((tool) => `\`${tool}\``).join(", ") : "none"}`,
		"",
		"## Injected in this session",
	);

	if (plan.guidelines.length === 0) {
		lines.push("- nothing planned");
	} else {
		const rules = recorded.rules;
		const found = typeof rules === "string" ? plan.guidelines.filter((line) => rules.includes(line)).length : 0;
		lines.push(`- guidelines in \`<rules>\`: ${found} / ${plan.guidelines.length}`);
		if (found === 0) {
			lines.push("", "Nothing injected yet: fragments are applied when a run starts, so send a prompt and check again.");
		}
	}

	if (plan.dropped.length > 0) {
		lines.push("", "## Not injected");
		for (const dropped of plan.dropped) lines.push(`- \`${dropped.id}\`: ${dropped.reason}`);
	}

	lines.push(
		"",
		"## Local state",
		runtime.state.disabled.length > 0
			? `- disabled on this machine: ${runtime.state.disabled.map((id) => `\`${id}\``).join(", ")}`
			: "- no fragments disabled on this machine",
		"",
		"## Diagnostics",
	);

	if (runtime.diagnostics.length === 0) {
		lines.push("- none");
	} else {
		for (const diagnostic of runtime.diagnostics) lines.push(diagnosticLine(diagnostic));
	}

	const overlay = runtime.fragments.filter((fragment) => fragment.source.kind === "local");
	if (overlay.length > 0) {
		lines.push(
			"",
			"## Notes",
			`- ${plural(overlay.length, "fragment")} live in the local overlay; move them to \`rules/\` and commit to sync them across machines`,
		);
	}

	report(ctx, "pi-rules · doctor", lines.join("\n"));
}

function showPrompt(ctx: ExtensionCommandContext): void {
	const replay = replaySystemMessages(ctx);
	const text = renderSystemPrompt(replay);
	if (text.length === 0) {
		ctx.ui.notify("pi-rules: the transcript has no system prompt yet; send a prompt first", "warning");
		return;
	}

	const tags = Object.keys(replay.sections);
	const fence = text.includes("````") ? "`````" : text.includes("```") ? "````" : "```";
	const lines = [
		"- source: transcript, what the model received",
		`- size: ${text.length} chars ≈ ${Math.round(text.length / 4)} tokens · ${plural(tags.length, "section")} · ${plural(replay.content.length, "content block")}`,
		"",
		`${fence}text`,
		text,
		fence,
	];
	report(ctx, "pi-rules · system prompt", lines.join("\n"));
}

interface SystemReplay {
	/** Instruction text from each system message, in transcript order. */
	content: string[];
	/** Named prompt sections after applying every patch; `null` removes one. */
	sections: Record<string, string | null>;
}

/**
 * Replay the system messages recorded in this session's transcript.
 *
 * `ctx.getSystemPrompt()` cannot be used for this: while idle pi falls back to
 * the base prompt options and clears the per-run options when a run ends, so it
 * never carries extension injections.
 */
function replaySystemMessages(ctx: ExtensionCommandContext): SystemReplay {
	const content: string[] = [];
	const sections: Record<string, string | null> = {};
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "system") continue;
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
					? message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n")
					: "";
		if (text.trim()) content.push(text);
		for (const [tag, value] of Object.entries(message.sections ?? {})) {
			if (value === null) delete sections[tag];
			else sections[tag] = value;
		}
	}
	return { content, sections };
}

/** Render a replay the way pi renders a system message: content first, then sections. */
function renderSystemPrompt(replay: SystemReplay): string {
	const parts = [
		...replay.content,
		...Object.values(replay.sections).filter((value): value is string => typeof value === "string" && value.length > 0),
	];
	return parts.join("\n\n");
}

function findFragment(runtime: RulesRuntime, query: string): Fragment | undefined {
	const exact = runtime.fragments.find((fragment) => fragment.meta.id === query);
	if (exact) return exact;
	const matches = runtime.fragments.filter((fragment) => fragment.meta.id.startsWith(query));
	return matches.length === 1 ? matches[0] : undefined;
}

function diagnosticLine(diagnostic: Diagnostic): string {
	const location = diagnostic.path ? ` (\`${diagnostic.path}\`)` : "";
	return `- ${diagnostic.level}: ${diagnostic.message}${location}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "unknown error";
}
