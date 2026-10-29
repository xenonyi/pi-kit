// Offline diagnostic: drive the real ToolExecutionComponent with pi-fold-runs'
// wrapped codemode renderers and print the collapsed rows.
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { foldToolRenderers } from "file:///D:/Workspace/pi-kit/extensions/pi-fold-runs/src/render.ts";
import { setRuntime } from "file:///D:/Workspace/pi-kit/extensions/pi-fold-runs/src/runtime.ts";

initTheme("dark", false);
setRuntime({ config: { enabled: true, pinned: ["ask_user_question"] }, source: "diagnostic" });

class Title {
	constructor(text) {
		this.text = text;
	}
	invalidate() {}
	render() {
		return [this.text];
	}
}

// Stand-in for pi's own codemode renderers: a call row and a result row.
const codemodeBase = {
	renderCall(args) {
		return new Title(`codemode ${String(args?.code ?? "").length} chars`);
	},
	renderResult(result) {
		return new Title(`result ${result.details?.calls?.length ?? 0} calls`);
	},
};

const wrapped = foldToolRenderers("codemode", () => codemodeBase);
const ui = { requestRender() {}, requestRenderSoon() {} };
const component = new ToolExecutionComponent(
	"codemode",
	"call-1",
	{ code: "const a = await tools.read({});" },
	{ outputPad: 1 },
	wrapped,
	ui,
	process.cwd(),
);

const show = (label) => {
	console.log(`--- ${label} ---`);
	component.render(80).forEach((line, i) => console.log(i, JSON.stringify(line)));
	console.log("state:", JSON.stringify(component.rendererState));
};

show("before result");

component.updateResult(
	{
		content: [{ type: "text", text: "Script completed\nWall time 1.2 seconds\nOutput:\ndone" }],
		details: {
			calls: [
				{ id: "c/1", name: "read", args: "{}", status: "ok" },
				{ id: "c/2", name: "read", args: "{}", status: "ok" },
				{ id: "c/3", name: "powershell", args: "{}", status: "error", error: "boom" },
			],
		},
		isError: false,
	},
	false,
);

show("after result (same task)");

await new Promise((resolve) => setImmediate(resolve));

show("after microtask flush");
