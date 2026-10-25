import {
	AssistantMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	SkillInvocationMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	cardColor,
	cardIndent,
	formatCallRow,
	formatCardStrip,
	formatFailedRow,
	formatSummary,
	formatTrunkRow,
	type ImageRun,
	measurePadLeft,
	nestResult,
} from "./format.ts";
import { getRuntime, getShapeProblem, reportShapeProblem } from "./runtime.ts";
import {
	callRowOf,
	cardAbove,
	classifyAssistant,
	dropCarrier,
	imageCount,
	isLastMember,
	noteBoundary,
	noteExpanded,
	planCarrier,
	planTool,
	summaryFor,
	type ToolBox,
	takeLateJoin,
	thinkingRuns,
	toggleGroupLevel,
	withPointerClick,
} from "./state.ts";
import { getTheme } from "./theme.ts";

/**
 * Two prototype patches, because Pi renders these rows itself:
 *
 * - `ToolExecutionComponent` owns every tool call, whoever registered the tool.
 *   Folded, its row draws nothing (or the group summary, or a failure row);
 *   open, a folded call draws one line, while an expanded call is replaced by
 *   Pi's own card — its top padding row becomes a status strip — so a call is
 *   never drawn twice. Rows holding terminal graphics pass through whole so
 *   the image protocol is never corrupted.
 * - `AssistantMessageComponent` owns a step's thinking. A step that only thinks
 *   and calls tools draws nothing while folded, so the bare `Thinking...` line
 *   disappears instead of sitting next to the summary that counts it.
 *
 * The message components also mark group boundaries: a user message, an
 * assistant reply with visible text, or a notice starts a new group.
 *
 * Pi exports these classes and its extension loader aliases the package to the
 * host's own module instance, so patching the prototype reaches the live
 * transcript. Nothing is registered as a tool, so the model-facing tool set,
 * permissions and caching are untouched.
 *
 * None of those fields is a public API, and this file reads them through local
 * interfaces, so a rename would compile and quietly draw `undefined`. Every
 * render therefore probes the shape first: one mismatch stops all folding for
 * the rest of the process, and pi's own rows — always correct — take over.
 */

type Render = (this: unknown, width: number) => string[];

interface MouseEventLike {
	type?: string;
	button?: unknown;
	x: number;
	y: number;
	width: number;
	height: number;
}

type MouseHandler = (this: unknown, event: MouseEventLike) => unknown;

/**
 * Rows this patch drew itself. The summary rows flip the group, a collapsed
 * call's row or an expanded call's status strip opens or closes that one result,
 * and the card body below belongs to Pi.
 */
interface RowLayout {
	/** Rows this patch drew (gap, summary, failure rows, call rows). */
	ownRows: number;
	/** Leading rows that act as the group's switch: gap plus summary line. */
	toggleRows: number;
	/** Index of this call's row (or its card's strip), -1 when it draws none. */
	rowRow: number;
	/** Rows Pi's own renderer drew below them (an opened result's body). */
	nativeRows: number;
	/** Rows Pi still counts above that body (the spacer the card header replaced). */
	nativeSkip: number;
	/** Columns the result block is indented by. */
	indent: number;
	/** Width this component rendered at, for Pi's own hit testing. */
	width: number;
}

const layouts = new WeakMap<object, RowLayout>();

interface RenderProto {
	render: Render;
}

interface ToolInternals extends ToolBox {
	hideComponent?: boolean;
}

interface AssistantInternals {
	lastMessage?: unknown;
}

const TOOL_PATCHED = Symbol.for("pi-fold-runs:tool-patch");
const BOUNDARY_WRAPPER = Symbol.for("pi-fold-runs:boundary-wrapper");

/** Last renderer a tool handed us: carrier components have no `ui` of their own. */
let lastUi: ToolBox["ui"];

/** Components whose render starts a new group. */
const BOUNDARY_COMPONENTS: unknown[] = [
	UserMessageComponent,
	CustomMessageComponent,
	BashExecutionComponent,
	SkillInvocationMessageComponent,
	CompactionSummaryMessageComponent,
	BranchSummaryMessageComponent,
];

export function installPatches(): void {
	patchToolComponent();
	ensureBoundaries();
}

function enabled(): boolean {
	return getRuntime().config.enabled;
}

/** Everything this module patches, plus the probes, still look like pi's. */
function active(): boolean {
	return enabled() && getShapeProblem() === undefined;
}

/**
 * The fields these patches read. Pi declares them `private`, so a rename
 * reaches us as a silent `undefined` — worse than a throw, because the rows
 * would render with `undefined` in them. One mismatch turns folding off for
 * the rest of the process; pi's own rows are always correct.
 */
function probeTool(tool: ToolInternals): string | undefined {
	if (typeof tool.toolName !== "string") return "ToolExecutionComponent.toolName is not a string";
	if (typeof tool.isPartial !== "boolean") return "ToolExecutionComponent.isPartial is not a boolean";
	if (typeof tool.setExpanded !== "function") return "ToolExecutionComponent.setExpanded is missing";
	if (typeof tool.ui?.requestRender !== "function") return "ToolExecutionComponent.ui.requestRender is missing";
	return undefined;
}

/** `lastMessage` drives both the boundary test and the thinking count. */
function probeAssistant(message: AssistantInternals): string | undefined {
	const last = message.lastMessage;
	// A message that has not rendered yet has nothing to classify.
	if (last === undefined) return undefined;
	if (typeof last !== "object" || last === null || !Array.isArray((last as { content?: unknown }).content)) {
		return "AssistantMessageComponent.lastMessage is not a message";
	}
	return undefined;
}

/** One probe failure is enough: report it once and hand every row back to pi. */
function failShape(problem: string): void {
	reportShapeProblem(problem);
	console.debug(`[pi-fold-runs] unsupported pi component shape (${problem}); using pi's own rows`);
}

function patchToolComponent(): void {
	const proto = ToolExecutionComponent.prototype as unknown as RenderProto & Record<PropertyKey, unknown>;
	if (proto[TOOL_PATCHED] === true) return;
	proto[TOOL_PATCHED] = true;
	const render = proto.render;

	proto.render = function (width: number): string[] {
		const tool = this as unknown as ToolInternals;
		// Pi's own `hideComponent` (and our off switch) keep the native path.
		if (tool.hideComponent === true || !active()) {
			layouts.delete(this as object);
			return render.call(this, width);
		}
		try {
			const problem = probeTool(tool);
			if (problem) {
				failShape(problem);
				layouts.delete(this as object);
				return render.call(this, width);
			}
			// Another extension may have wrapped a boundary since; re-wrap so the
			// groups keep being cut in the right places.
			ensureBoundaries();
			if (tool.ui) lastUi = tool.ui;
			const config = getRuntime().config;
			const plan = planTool(tool, config);
			// A member joined after the summary rendered: one more frame catches up.
			if (takeLateJoin()) tool.ui?.requestRender?.();
			if (plan.native) {
				// Pinned tools keep Pi's own row, click handling included.
				const native = render.call(this, width);
				layouts.set(this as object, { ownRows: 0, toggleRows: 0, rowRow: -1, nativeRows: native.length, nativeSkip: 0, indent: 0, width });
				return native;
			}
			const theme = getTheme();
			if (!theme) {
				// No theme yet: draw Pi's own rows rather than hiding the call.
				const native = render.call(this, width);
				layouts.set(this as object, { ownRows: 0, toggleRows: 0, rowRow: -1, nativeRows: native.length, nativeSkip: 0, indent: 0, width });
				return native;
			}
			const lines: string[] = [];
			// Rows that act as the group's switch: the blank gap plus the summary
			// line itself. The failure rows below them are read-only.
			let toggleRows = 0;
			const last = isLastMember(tool);
			if (plan.header) {
				const summary = summaryFor(tool, config);
				// The summary keeps its own leading rows: Pi gives every tool row one
				// (`Spacer(1)`), and `gap` tunes how many separate the group from the
				// text above it.
				if (summary) {
					for (let i = 0; i < config.gap; i++) lines.push("");
					lines.push(formatSummary(summary, theme, width, plan.row));
					toggleRows = lines.length;
					// Folded, the failure rows are the only place a failed call shows.
					if (!plan.row && config.showErrors) {
						for (const failure of summary.failures) lines.push(formatFailedRow(failure, theme, width));
				}
			}
			}
			// Open, every folded call is its own line. An expanded call is replaced by
			// Pi's own card, whose first row carries the open arrow and the state, so
			// the call is never drawn twice.
			let rowRow = -1;
			if (plan.row && !plan.block) {
				// Calls sit right under each other: the `├`/`└` strokes already join
				// into one trunk, so a blank row between them was only extra air.
				rowRow = lines.length;
				lines.push(formatCallRow(callRowOf(tool), theme, width, last));
			}
			// Two cards in a row would read as one background block; keep one plain
			// row between them.
			if (plan.block && cardAbove(tool)) lines.push(formatTrunkRow(theme));
			// Everything above this index is ours; the block below belongs to Pi.
			const ownRows = lines.length;
			let nativeRows = 0;
			let nativeSkip = 0;
			let indent = 0;
			if (plan.block) {
				const row = callRowOf(tool);
				const card = cardColor(row);
				// How many columns pi pads inside its card. `outputPad` is private:
				// read it while it is there, otherwise measure it from pi's own rows
				// and re-render once at the corrected width.
				let padLeft =
					typeof tool.outputPad === "number" ? Math.min(2, Math.max(0, Math.trunc(tool.outputPad))) : 1;
				indent = cardIndent(padLeft);
				let innerWidth = Math.max(1, width - indent);
				let native = render.call(this, innerWidth);
				if (typeof tool.outputPad !== "number") {
					const measured = measurePadLeft(native);
					if (measured !== padLeft) {
						padLeft = measured;
						indent = cardIndent(padLeft);
						innerWidth = Math.max(1, width - indent);
						native = render.call(this, innerWidth);
					}
				}
				const nested = nestResult(native, theme, width, imageRuns(tool, innerWidth), last, card, padLeft);
				if (nested.passthrough) {
					// Pi's image rows are not where its components report them: give the
					// block the whole width, the one layout that cannot clip an image.
					warnImageFallback();
					const wide = render.call(this, width);
					const skip = wide[0] === "" ? 1 : 0;
					const body = skip === 1 ? wide.slice(1) : wide;
					lines.push(...body);
					nativeRows = body.length;
					nativeSkip = skip;
					// Full width and no gutter: the block is not indented after all.
					indent = 0;
				} else {
					// Pi's top padding row becomes the card's status strip: the open arrow
					// and the state, plus a click target that collapses this result.
					if (nested.blankTop) {
						nested.lines[0] = formatCardStrip(row, theme, width, last, card);
						rowRow = lines.length;
					}
					lines.push(...nested.lines);
					nativeRows = nested.lines.length;
					nativeSkip = nested.skip;
					indent = nested.indent;
				}
			}
			// The group closes with one blank row less than it opened with: every
			// component Pi draws after it (a message, a pinned row) starts with a
			// blank row of its own, and counting that one twice reads as extra air.
			if (plan.row ? last : plan.header) {
				for (let i = 0; i < Math.max(0, config.gap - 1); i++) lines.push("");
			}
			layouts.set(this as object, { ownRows, toggleRows, rowRow, nativeRows, nativeSkip, indent, width });
			return lines;
		} catch (error) {
			debug(error);
			layouts.delete(this as object);
			return render.call(this, width);
		}
	};

	// The card owns every row it draws: the summary rows flip the whole group, a
	// call's own row opens or closes that one result, and everything below them
	// belongs to Pi again.
	const previousMouse = (proto as unknown as { handleMouse?: MouseHandler }).handleMouse;
	if (typeof previousMouse === "function") {
		(proto as unknown as { handleMouse: MouseHandler }).handleMouse = function (event: MouseEventLike) {
			if (!active()) return previousMouse.call(this, event);
			const layout = layouts.get(this as object);
			if (!layout) return previousMouse.call(this, event);
			const click = event.type === "click" && (event.button === "left" || event.button === 0);
			if (layout.toggleRows > 0 && event.y >= 0 && event.y < layout.toggleRows) {
				if (!click) return undefined;
				toggleGroupLevel(this as object);
				(this as unknown as ToolInternals).ui?.requestRender?.();
				return { handled: true };
			}
			if (layout.rowRow >= 0 && event.y === layout.rowRow) {
				if (!click) return undefined;
				const tool = this as unknown as ToolInternals;
				// Pi's own result region ignores clicks until a result exists.
				if (!tool.result) return { handled: true };
				// Same source marker as Pi's own row click: closing one result never
				// folds the whole group.
				withPointerClick(() => tool.setExpanded(!tool.expanded));
				tool.ui?.requestRender?.();
				return { handled: true };
			}
			if (event.y < layout.ownRows || layout.nativeRows === 0) return undefined;
			// Below our rows: Pi's own card body, in Pi's coordinates. The pointer
			// scope tells the `setExpanded` patch that this call came from a click
			// on one row, so a collapse does not fold the whole group.
			return withPointerClick(() =>
				previousMouse.call(this, {
					...event,
					x: event.x - layout.indent,
					y: event.y - layout.ownRows + layout.nativeSkip,
					width: Math.max(1, layout.width - layout.indent),
					height: layout.nativeRows + layout.nativeSkip,
				}),
			);
		};
	}

	// ctrl+o and a click on a call's own row both arrive as `setExpanded`; the
	// pointer scope set by the mouse patch is what tells them apart.
	const previousExpand = (proto as unknown as { setExpanded: (expanded: boolean) => void }).setExpanded;
	(proto as unknown as { setExpanded: (expanded: boolean) => void }).setExpanded = function (expanded: boolean) {
		previousExpand.call(this, expanded);
		if (!active()) return;
		if (noteExpanded(this as object, expanded)) (this as unknown as ToolInternals).ui?.requestRender?.();
	};
}

/**
 * Boundary wrappers must stay outermost: another extension can install a render
 * patch that never calls its predecessor. Both the patch time and every tool
 * render re-check this.
 */
function ensureBoundaries(): void {
	wrapAssistant(AssistantMessageComponent);
	for (const component of BOUNDARY_COMPONENTS) wrapBoundary(component);
}

function wrapAssistant(component: unknown): void {
	const proto = prototypeOf(component);
	if (!proto) return;
	const render = proto.render;
	if (isWrapped(render)) return;

	const wrapped: Render = function (this: unknown, width: number): string[] {
		if (!active()) return render.call(this, width);
		const message = this as unknown as AssistantInternals;
		try {
			const problem = probeAssistant(message);
			if (problem) {
				failShape(problem);
				return render.call(this, width);
			}
			const role = classifyAssistant(message.lastMessage);
			if (role === "boundary") {
				// It grew text: its thinking is no longer a row of the old group.
				dropCarrier(this as object);
				noteBoundary(this as object);
				return render.call(this, width);
			}
			if (role === "carrier") return drawCarrier(message, render, width);
			return render.call(this, width);
		} catch (error) {
			debug(error);
			return render.call(this, width);
		}
	};
	mark(wrapped);
	proto.render = wrapped;
}

function drawCarrier(message: AssistantInternals, render: Render, width: number): string[] {
	const plan = planCarrier(message as object, thinkingRuns(message.lastMessage));
	if (takeLateJoin()) lastUi?.requestRender?.();
	return plan === "native" ? render.call(message, width) : [];
}

function wrapBoundary(component: unknown): void {
	const proto = prototypeOf(component);
	if (!proto) return;
	const render = proto.render;
	if (isWrapped(render)) return;

	const wrapped: Render = function (this: unknown, width: number): string[] {
		if (!active()) return render.call(this, width);
		noteBoundary(this as object);
		return render.call(this, width);
	};
	mark(wrapped);
	proto.render = wrapped;
}

/** Whether `render` already carries our boundary wrapper. */
function isWrapped(render: Render): boolean {
	return (render as unknown as Record<PropertyKey, unknown>)[BOUNDARY_WRAPPER] === true;
}

function mark(render: Render): void {
	(render as unknown as Record<PropertyKey, unknown>)[BOUNDARY_WRAPPER] = true;
}


function prototypeOf(component: unknown): (RenderProto & Record<PropertyKey, unknown>) | undefined {
	const proto = (component as { prototype?: unknown } | undefined)?.prototype;
	if (!proto || typeof (proto as RenderProto).render !== "function") return undefined;
	return proto as RenderProto & Record<PropertyKey, unknown>;
}

let imageFallbackWarned = false;

/** One line per run: a result whose images this module cannot place. */
function warnImageFallback(): void {
	if (imageFallbackWarned) return;
	imageFallbackWarned = true;
	console.debug("[pi-fold-runs] image result left at full width: pi's image rows could not be located");
}

/** Pi's own images, in result order: the caption and the rows each draws. */
function imageRuns(tool: ToolBox, width: number): ImageRun[] | null {
	const count = imageCount(tool);
	if (count === 0) return [];
	const components = tool.imageComponents;
	// Pi builds one component per image block: a different count means this
	// module and pi disagree about the result, so the block is left alone.
	if (!Array.isArray(components) || components.length !== count) return null;
	const runs: ImageRun[] = [];
	for (const component of components) {
		// Rendering at the width pi just used is a cache hit, and it is the only
		// way to learn how many rows the image covers without parsing its
		// escape sequence.
		const lines = typeof component.render === "function" ? component.render(width) : undefined;
		if (!Array.isArray(lines) || lines.length === 0) return null;
		runs.push({ label: imageLabel(component), rows: lines.length });
	}
	return runs;
}

/** `image 800×600`, or `image` when pi did not report a pixel size. */
function imageLabel(component: { dimensions?: { widthPx?: number; heightPx?: number } }): string {
	const widthPx = component.dimensions?.widthPx;
	const heightPx = component.dimensions?.heightPx;
	return typeof widthPx === "number" && typeof heightPx === "number" ? `image ${widthPx}×${heightPx}` : "image";
}

function debug(error: unknown): void {
	console.debug("[pi-fold-runs]", error);
}
