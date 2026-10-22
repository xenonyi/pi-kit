import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { injectInstructions, readInstructions } from "./src/instructions.ts";

export default function instructions(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		injectInstructions(event.systemPromptOptions.contextFiles, await readInstructions());
	});
}
