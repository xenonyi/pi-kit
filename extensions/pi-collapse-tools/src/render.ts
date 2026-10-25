import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type CollapseRuntime, shouldCollapse } from "./config.ts";

type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type ResultContent = Parameters<ResultRenderer>[0]["content"];

/**
 * Wrap a tool's renderers so its result stays hidden until the row is expanded.
 *
 * Native call and result renderers are reused as-is, so Pi keeps its own call
 * header and the expanded view matches Pi without this extension.
 */
export function createCollapsedRenderers(
	toolName: string,
	original: ToolRenderers | undefined,
	runtime: CollapseRuntime,
): ToolRenderers {
	const nativeResult = original?.renderResult;

	return {
		renderShell: original?.renderShell,
		renderCall: original?.renderCall,
		renderResult(result, options, theme, context) {
			// Expanded rows and failed calls keep Pi's own rendering.
			const passthrough =
				options.expanded ||
				!shouldCollapse(runtime.config, toolName) ||
				(context.isError && runtime.config.showErrors);
			if (passthrough) {
				return nativeResult
					? nativeResult(result, options, theme, context)
					: new Text(textOutput(result.content, theme), 0, 0);
			}

			if (options.isPartial && runtime.config.showRunning) {
				return new Text(theme.fg("dim", "Running…"), 0, 0);
			}

			return new Text("", 0, 0);
		},
	};
}

/** Text blocks of a result, styled like Pi's own fallback renderer. */
function textOutput(content: ResultContent, theme: Theme): string {
	const text = content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return text ? theme.fg("toolOutput", text) : "";
}
