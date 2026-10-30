/**
 * pi-rules: injects synced prompt fragments into the system prompt.
 *
 * Fragments live in this repository's `rules/` directory (synced through git) or
 * in the machine-local `<agent-dir>/rules` overlay. Each fragment decides where
 * it applies with `when:` conditions and is injected as guideline bullets.
 * Detailed workflows live in skills; fragments can direct the model to read them.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { runRulesCommand } from "./commands.ts";
import { readState, resolveSources, writeState } from "./storage.ts";
import { applyPlan } from "./inject.ts";
import { collectEnv } from "./machine.ts";
import { buildPlan } from "./render.ts";
import { scanFragments } from "./scan.ts";
import type {
	Diagnostic,
	Fragment,
	FragmentSource,
	MachineEnv,
	Plan,
	RulesRuntime,
	RulesState,
} from "./types.ts";

const PREFIX = "pi-rules";

const SUBCOMMANDS: Array<{ name: string; description: string }> = [
	{ name: "list", description: "List fragments with match status" },
	{ name: "toggle", description: "Enable or disable a fragment on this machine" },
	{ name: "reload", description: "Re-read fragments and local state" },
	{ name: "doctor", description: "Sources, size, profile, injected state, diagnostics" },
	{ name: "prompt", description: "Print the full injected system prompt from the transcript" },
];

export default function piRules(pi: ExtensionAPI): void {
	const runtime = createRuntime();
	let warned = false;

	pi.on("session_start", (_event, ctx) => {
		refreshQuietly(runtime);
		const problems = runtime.diagnostics.filter((diagnostic) => diagnostic.level === "error");
		if (!warned && problems.length > 0 && ctx.hasUI) {
			warned = true;
			ctx.ui.notify(`${PREFIX}: ${problems.length} problem(s), run /rules doctor`, "warning");
		}
	});


	pi.on("before_agent_start", (event, ctx) => {
		try {
			const env = collectEnv({
				cwd: ctx.cwd,
				model: ctx.model,
				tools: event.systemPromptOptions.selectedTools,
			});
			applyPlan(event.systemPromptOptions, runtime.plan(env));
		} catch (error) {
			// Prompt injection must never block a run.
			console.error(`${PREFIX}: injection failed: ${errorMessage(error)}`);
		}
	});

	pi.registerCommand("rules", {
		description: "Inspect and manage injected prompt rule fragments",
		getArgumentCompletions: (prefix) => completions(prefix, runtime),
		handler: async (args, ctx) => {
			await runRulesCommand(args, ctx, runtime, pi.getActiveTools());
		},
	});
}

function createRuntime(): RulesRuntime {
	let sources: FragmentSource[] = [];
	let fragments: Fragment[] = [];
	let diagnostics: Diagnostic[] = [];
	let state: RulesState = { version: 1, disabled: [] };

	return {
		get sources() {
			return sources;
		},
		get fragments() {
			return fragments;
		},
		get diagnostics() {
			return diagnostics;
		},
		get state() {
			return state;
		},
		refresh() {
			const found: Diagnostic[] = [];
			const nextSources = resolveSources();
			const scanned = scanFragments(nextSources);
			sources = nextSources;
			fragments = scanned.fragments;
			state = readState(found);
			diagnostics = [...found, ...scanned.diagnostics];
		},
		plan(env: MachineEnv): Plan {
			return buildPlan(fragments, env, state);
		},
		setDisabled(id: string, disabled: boolean) {
			const next = new Set(state.disabled);
			if (disabled) next.add(id);
			else next.delete(id);
			state = { version: 1, disabled: [...next].sort() };
			writeState(state);
		},
	};
}

function refreshQuietly(runtime: RulesRuntime): void {
	try {
		runtime.refresh();
	} catch (error) {
		console.error(`${PREFIX}: refresh failed: ${errorMessage(error)}`);
	}
}


function completions(prefix: string, runtime: RulesRuntime): AutocompleteItem[] | null {
	const trimmed = prefix.trimStart();
	const hasTrailingSpace = /\s$/.test(prefix);
	const parts = trimmed.split(/\s+/).filter(Boolean);

	if (parts.length === 0 || (parts.length === 1 && !hasTrailingSpace)) {
		const head = parts[0] ?? "";
		const items = SUBCOMMANDS.filter((subcommand) => subcommand.name.startsWith(head)).map((subcommand) => ({
			value: subcommand.name,
			label: subcommand.name,
			description: subcommand.description,
		}));
		return items.length > 0 ? items : null;
	}

	if (parts[0] !== "toggle") return null;
	const query = hasTrailingSpace ? "" : (parts[1] ?? "");
	const items = runtime.fragments
		.filter((fragment) => fragment.meta.id.startsWith(query))
		.map((fragment) => ({
			value: fragment.meta.id,
			label: fragment.meta.id,
			description: fragment.meta.title,
		}));
	return items.length > 0 ? items : null;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "unknown error";
}
