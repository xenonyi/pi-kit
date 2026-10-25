import type { CodemodeToolDetails, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { type Component, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { type CollapseRuntime, shouldCollapse } from "./config.ts";

const CODEMODE_TOOL = "codemode";
const INDICATOR_INTERVAL_MS = 350;
const CLOCK = Symbol("pi-collapse-tools.codemode-clock");
const SUMMARY = Symbol("pi-collapse-tools.codemode-summary");
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type CallArgs = Parameters<CallRenderer>[0];
type CallContext = Parameters<CallRenderer>[2];
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type ResultValue = Parameters<ResultRenderer>[0];
type ResultOptions = Parameters<ResultRenderer>[1];
type ResultContext = Parameters<ResultRenderer>[3];

/** Pi records the model context window next to the details, so later renders can show a share. */
type CodemodeDetails = CodemodeToolDetails & { collapseContextWindow?: number };

interface LiveRow {
	invalidate: () => void;
	timer?: ReturnType<typeof setInterval>;
}

/**
 * Codemode keeps its native nested tool rows, timings and costs, but the script
 * and its output are hidden. The collapsed header animates while the script
 * and its output are hidden. The collapsed header carries the duration and the
 * estimated output size; the native rows sit directly below it.
 */
export class CodemodeState {
	private readonly rows = new Map<string, LiveRow>();
	private readonly live = new Set<string>();

	/** Only calls started in this process animate; rows restored from history stay idle. */
	markLive(toolCallId: string): void {
		this.live.add(toolCallId);
	}

	finish(toolCallId: string): void {
		this.live.delete(toolCallId);
		const row = this.rows.get(toolCallId);
		if (!row) return;
		clearInterval(row.timer);
		this.rows.delete(toolCallId);
		// Drop the dots on the row that just finished.
		row.invalidate();
	}

	stopAll(): void {
		this.live.clear();
		for (const row of this.rows.values()) clearInterval(row.timer);
		this.rows.clear();
	}

	renderers(original: ToolRenderers, runtime: CollapseRuntime): ToolRenderers {
		return {
			...original,
			renderCall: (args, theme, context) =>
				this.renderCall(original.renderCall, runtime, args, theme, context),
			renderResult: (result, options, theme, context) =>
				this.renderResult(original.renderResult, runtime, result, options, theme, context),
		};
	}

	private renderCall(
		nativeCall: CallRenderer | undefined,
		runtime: CollapseRuntime,
		args: CallArgs,
		theme: Theme,
		context: CallContext,
	): Component {
		const title = theme.fg("toolTitle", theme.bold(CODEMODE_TOOL));
		const hideScript =
			runtime.config.codemode.hideScript && shouldCollapse(runtime.config, CODEMODE_TOOL);

		if (!hideScript || context.expanded) {
			this.stopTimer(context.toolCallId);
			return nativeCall ? nativeCall(args, theme, context) : new Text(title, 0, 0);
		}

		const running = runtime.config.codemode.indicator && this.animate(context);
		const parts = [title];
		if (running) {
			parts.push(dots(theme));
			const elapsed = this.elapsed(context);
			if (elapsed !== undefined) parts.push(theme.fg("dim", formatDuration(elapsed)));
		} else {
			const summary = context.state[SUMMARY] as string | undefined;
			if (summary) parts.push(theme.fg("muted", summary));
		}
		return new Text(parts.join(" "), 0, 0);
	}

	private renderResult(
		nativeResult: ResultRenderer | undefined,
		runtime: CollapseRuntime,
		result: ResultValue,
		options: ResultOptions,
		theme: Theme,
		context: ResultContext,
	): Component {
		if (!nativeResult) return new Text("", 0, 0);

		const collapsing = shouldCollapse(runtime.config, CODEMODE_TOOL);
		if (options.expanded || !collapsing) {
			return nativeResult(result, options, theme, context);
		}
		if (context.isError && runtime.config.showErrors) {
			return nativeResult(result, options, theme, context);
		}

		const component = nativeResult({ ...result, content: [] }, options, theme, context);
		if (!runtime.config.codemode.hideScript) return component;

		// The header carries the summary, so the native blank lines and timer move there.
		compactRows(component);
		if (options.isPartial) return component;

		const details = result.details as CodemodeDetails | undefined;
		const summary: string[] = [];
		if (typeof context.durationMs === "number") summary.push(formatDuration(context.durationMs));
		if (runtime.config.codemode.tokens) {
			// Estimate the content the model actually received, not the empty preview.
			const tokens = estimateTokens({
				role: "toolResult",
				toolCallId: context.toolCallId,
				toolName: CODEMODE_TOOL,
				content: result.content,
				isError: context.isError,
				timestamp: 0,
			});
			summary.push(formatTokens(tokens, details?.collapseContextWindow));
		}

		const line = summary.join(" · ");
		if (line.length > 0 && context.state[SUMMARY] !== line) {
			context.state[SUMMARY] = line;
			// One extra render lets the call header pick the summary up.
			queueMicrotask(() => context.invalidate());
		}
		return component;
	}

	/** Milliseconds since this row first rendered here, for the live header counter. */
	private elapsed(context: CallContext): number | undefined {
		if (!this.live.has(context.toolCallId)) return undefined;
		const state = context.state as Record<symbol, unknown>;
		const startedAt = state[CLOCK];
		if (typeof startedAt !== "number") {
			state[CLOCK] = Date.now();
			return 0;
		}
		return Math.max(0, Date.now() - startedAt);
	}

	/** Redraws the header while the script is live, so the dots keep marching. */
	private animate(context: CallContext): boolean {
		if (!this.live.has(context.toolCallId) || !context.isPartial) return false;
		const row = this.rows.get(context.toolCallId);
		if (row) {
			row.invalidate = context.invalidate;
			row.timer ??= startFrameTimer(context.invalidate);
			return true;
		}
		this.rows.set(context.toolCallId, {
			invalidate: context.invalidate,
			timer: startFrameTimer(context.invalidate),
		});
		return true;
	}

	private stopTimer(toolCallId: string): void {
		const row = this.rows.get(toolCallId);
		if (!row) return;
		clearInterval(row.timer);
		this.rows.delete(toolCallId);
	}
}

function startFrameTimer(invalidate: () => void): ReturnType<typeof setInterval> {
	const timer = setInterval(invalidate, INDICATOR_INTERVAL_MS);
	// An animation must never keep the process alive.
	(timer as { unref?: () => void }).unref?.();
	return timer;
}

function dots(theme: Theme): string {
	const frame = Math.floor(Date.now() / INDICATOR_INTERVAL_MS) % 3;
	return [0, 1, 2].map((dot) => theme.fg(dot === frame ? "warning" : "dim", "•")).join("");
}

/** Mirrors Pi's own `Took …` formatting, so the header matches the native row. */
function formatDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

/** Drops the native blank spacers and `Took …` line; both now live in the header. */
function compactRows(component: Component): void {
	if (!(component instanceof Container)) return;
	for (const child of [...component.children]) {
		if (child instanceof Spacer || isTimerLine(child)) component.removeChild(child);
	}
}

function isTimerLine(component: Component): boolean {
	const text = (component as { text?: unknown }).text;
	if (typeof text !== "string") return false;
	return /^(?:Took|Elapsed) /.test(text.replace(ANSI_PATTERN, ""));
}

function formatTokens(tokens: number, contextWindow?: number): string {
	const summary = `Tokens ~${tokens.toLocaleString("en-US")}`;
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return summary;
	}
	const percent = (tokens / contextWindow) * 100;
	const percentage = percent > 0 && percent < 0.001 ? "<0.001" : percent.toFixed(3);
	return `${summary} (${percentage}%)`;
}
