import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CodemodeState } from "./codemode.ts";
import {
	type CollapseRuntime,
	DEFAULT_CONFIG,
	loadCollapseConfig,
	shouldCollapse,
} from "./config.ts";
import { createCollapsedRenderers } from "./render.ts";

const CODEMODE_TOOL = "codemode";

/**
 * Collapse tool output by default. Tool calls keep their native header, tool
 * results render nothing until the row is expanded, and codemode keeps its
 * nested tool rows while hiding the script and its output.
 *
 * Adapted from https://github.com/xRyul/pi-collapse-tools (MIT). Unlike the
 * upstream extension this does not override Pi's built-in tools: one
 * `registerToolRenderer` resolver covers built-ins, extension tools and MCP
 * tools, so the model-facing tool set is untouched.
 */
export default function collapseTools(pi: ExtensionAPI) {
	const runtime: CollapseRuntime = { config: DEFAULT_CONFIG };
	const codemode = new CodemodeState();

	const applyConfig = (ctx: ExtensionContext) => {
		const loaded = loadCollapseConfig(ctx.cwd, ctx.isProjectTrusted());
		runtime.config = loaded.config;
		runtime.source = loaded.source;
		if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
	};

	pi.on("session_start", (_event, ctx) => {
		codemode.stopAll();
		applyConfig(ctx);
	});

	// A live call is one this process watched stream; restored rows stay idle.
	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		for (const part of event.message.content) {
			if (part.type === "toolCall" && part.name === CODEMODE_TOOL) codemode.markLive(part.id);
		}
	});
	pi.on("tool_execution_start", (event) => {
		if (event.toolName === CODEMODE_TOOL) codemode.markLive(event.toolCallId);
	});
	pi.on("tool_execution_end", (event) => {
		if (event.toolName === CODEMODE_TOOL) codemode.finish(event.toolCallId);
	});
	pi.on("agent_end", () => codemode.stopAll());
	pi.on("session_shutdown", () => codemode.stopAll());
	pi.on("session_tree", () => codemode.stopAll());

	// Persist the context capacity for the collapsed footer without changing
	// anything the model sees.
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== CODEMODE_TOOL || !runtime.config.enabled) return;
		const contextWindow = ctx.getContextUsage()?.contextWindow;
		if (!contextWindow) return;
		return { details: withContextWindow(event.details, contextWindow) };
	});

	pi.registerToolRenderer((toolName, next) => {
		const original = next();
		if (toolName === CODEMODE_TOOL) {
			return original ? codemode.renderers(original, runtime) : original;
		}
		if (!shouldCollapse(runtime.config, toolName)) return original;
		return createCollapsedRenderers(toolName, original, runtime);
	});

	pi.registerCommand("collapse", {
		description: "Show tool-output collapse settings",
		handler: async (_args, ctx) => {
			ctx.ui.notify(describe(runtime), runtime.config.enabled ? "info" : "warning");
		},
	});
}

function withContextWindow(details: unknown, contextWindow: number): Record<string, unknown> {
	const base =
		typeof details === "object" && details !== null && !Array.isArray(details)
			? (details as Record<string, unknown>)
			: {};
	return { ...base, collapseContextWindow: contextWindow };
}

function describe(runtime: CollapseRuntime): string {
	const { config } = runtime;
	const scope = config.tools === "all" ? "all tools" : config.tools.join(", ");
	const except = config.except.length > 0 ? `, except ${config.except.join(", ")}` : "";
	const state = config.enabled ? `on: ${scope}${except}` : "off";
	return `Collapse Tools ${state} · settings: ${runtime.source ?? "built-in defaults"} · expand with Ctrl+O`;
}
