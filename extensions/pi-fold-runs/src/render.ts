import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { foldCallRow, type FoldRowOptions } from "./format.ts";
import { getRuntime } from "./runtime.ts";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;
type RenderResult = NonNullable<ToolRenderers["renderResult"]>;
/** The context Pi passes to a renderer; `ToolRenderContext` itself is not exported. */
type CallContext = Parameters<RenderCall>[2];
type ResultContext = Parameters<RenderResult>[3];

/** Marks a renderer this module already wrapped, so loading the extension twice cannot fold twice. */
const WRAPPED = Symbol.for("pi-fold-runs:wrapped");

/** Nothing is drawn for a collapsed result: the folded call row already carries the card. */
const NO_ROWS: Component = { render: () => [], invalidate: () => {} };

/** Per tool call. Pi hands the same `context.state` to the call and result renderers. */
interface RowState {
	/** The native call component, so its own `lastComponent` reuse keeps working. */
	call?: Component;
	/** The native result component, handed back when the card expands. */
	result?: Component;
	/** Collapsed summary of a codemode run, e.g. `read×2 powershell×1`. */
	info?: string;
	/** A redraw is already queued for a changed summary. */
	queued?: boolean;
}

/**
 * Fold every card Pi draws with a tool renderer, using only the documented
 * renderer API: the call keeps its first visible row, the collapsed result draws
 * no rows, and an expanded card hands both back to Pi unchanged.
 *
 * Tools without both renderers cannot be folded safely: Pi's own fallback rows
 * are not reachable from a renderer, so those cards stay native.
 */
export const foldToolRenderers: ToolRendererResolver = (toolName, next) => {
	const { config } = getRuntime();
	const base = next();
	if (!config.enabled || config.pinned.includes(toolName) || !base) return base;
	if (!base.renderCall || !base.renderResult) return base;
	if (isWrapped(base.renderCall)) return base;

	// A self-rendered shell pads inside its own component instead of Pi's box, so
	// its folded rows have to keep that padding.
	return {
		...base,
		renderCall: wrapCall(toolName, base.renderCall, base.renderShell === "self"),
		renderResult: wrapResult(toolName, base.renderResult),
	};
};

function wrapCall(toolName: string, renderCall: RenderCall, selfShell: boolean): RenderCall {
	const wrapped: RenderCall = (args, theme, context) => {
		const state = stateOf(context);
		const native = renderCall(args, theme, withNativeCall(context, state));
		state.call = native;
		if (context.expanded) return native;
		const info = toolName === "codemode" ? state.info : undefined;
		return new FoldedCall(native, { info, ownPadding: selfShell });
	};
	return mark(wrapped);
}

function wrapResult(toolName: string, renderResult: RenderResult): RenderResult {
	const wrapped: RenderResult = (result, options, theme, context) => {
		const state = stateOf(context);
		if (toolName === "codemode") noteCalls(state, result, context);
		// The native result is still built when the card is folded: a self-rendered
		// shell updates its own header from it (an edit turns its background red on
		// an error). Only the rows are dropped.
		const native = renderResult(result, options, theme, withNativeResult(context, state));
		state.result = native;
		return options.expanded ? native : NO_ROWS;
	};
	return mark(wrapped);
}

/**
 * Keep the native renderer's component behind `lastComponent`: Pi would hand it
 * our wrapper, and renderers that reuse it call `clear()` or `setText()` on it.
 */
function withNativeCall(context: CallContext, state: RowState): CallContext {
	return { ...context, lastComponent: state.call };
}

function withNativeResult(context: ResultContext, state: RowState): ResultContext {
	return { ...context, lastComponent: state.result };
}

/**
 * codemode's counts come from the result, but the folded row is drawn by the call
 * renderer. The redraw has to wait: `context.invalidate()` runs `updateDisplay`
 * again synchronously, and the interrupted pass would then append its children a
 * second time. A microtask runs after that pass finishes.
 */
function noteCalls(state: RowState, result: { details?: unknown }, context: ResultContext): void {
	const info = callsInfo(result.details);
	if (info === undefined || info === state.info) return;
	state.info = info;
	if (state.queued) return;
	state.queued = true;
	queueMicrotask(() => {
		state.queued = false;
		context.invalidate();
	});
}

/** Actual nested calls, counted per tool name in the order they were first made. */
function callsInfo(details: unknown): string | undefined {
	if (!isRecord(details) || !Array.isArray(details.calls)) return undefined;
	const counts = new Map<string, number>();
	for (const call of details.calls) {
		if (!isRecord(call) || typeof call.name !== "string" || !call.name.trim()) return undefined;
		const name = call.name.trim();
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return counts.size === 0
		? "0 calls"
		: [...counts].map(([name, count]) => `${name}×${count}`).join(" ");
}

function stateOf(context: CallContext | ResultContext): RowState {
	const state = context.state as RowState | undefined;
	// Pi always passes its renderer state object, which outlives every render of
	// the same tool call. A missing one means the caller is not Pi.
	if (state === undefined) return {};
	return state;
}

/** The native call's first visible row, and nothing when it cannot be folded. */
class FoldedCall implements Component {
	private readonly native: Component;
	private readonly options: FoldRowOptions;

	constructor(native: Component, options: FoldRowOptions) {
		this.native = native;
		this.options = options;
	}

	invalidate(): void {
		this.native.invalidate?.();
	}

	render(width: number): string[] {
		const lines = this.native.render(width);
		return foldCallRow(lines, width, this.options) ?? lines;
	}
}

function isWrapped(renderer: unknown): boolean {
	return (renderer as Record<PropertyKey, unknown>)[WRAPPED] === true;
}

function mark<T extends object>(renderer: T): T {
	(renderer as unknown as Record<PropertyKey, unknown>)[WRAPPED] = true;
	return renderer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
