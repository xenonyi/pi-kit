import { normalizeContext } from "@earendil-works/pi-ai";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";
import { FALLBACK_MODELS } from "../src/models.js";
import { createAntigravityProvider } from "../src/provider.js";
import { AntigravityRuntime } from "../src/runtime.js";

const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const model = FALLBACK_MODELS[0]!;

describe("native Pi provider", () => {
	it("passes transcript instructions through to the ACP prompt", async () => {
		const prompts: Array<Parameters<AntigravityAcpConnection["prompt"]>[0]> = [];
		const runtime = new AntigravityRuntime((options) => {
			const connection = new AntigravityAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] });
			const prompt = connection.prompt.bind(connection);
			connection.prompt = (request, signal) => {
				prompts.push(request);
				return prompt(request, signal);
			};
			return connection;
		});
		try {
			const { provider } = createAntigravityProvider(runtime);
			const stream = provider.streamSimple(model, normalizeContext({
				systemPrompt: "Follow native transcript instructions",
				messages: [{ role: "user", content: "hello", timestamp: 1 }],
			}), { apiKey: "test-key" });
			const result = await stream.result();
			expect(result.stopReason).toBe("stop");
			expect(prompts[0]?.prompt[0]).toMatchObject({
				type: "resource",
				resource: { text: expect.stringContaining("Follow native transcript instructions") },
			});
		} finally {
			await runtime.close();
		}
	});

	it("routes tools added by a transcript delta through the MCP bridge", async () => {
		const runtime = new AntigravityRuntime(
			(options) => new AntigravityAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const { provider } = createAntigravityProvider(runtime);
			const tools = [{ name: "echo", description: "Echo text", parameters: Type.Object({ text: Type.String() }) }];
			const context = normalizeContext({ messages: [
				{ role: "system", content: "Base instructions", timestamp: 0 },
				{ role: "system", content: "", toolsAdded: tools, timestamp: 1 },
				{ role: "user", content: "use bridge", timestamp: 2 },
			] });
			const first = await provider.streamSimple(model, context, { apiKey: "test-key" }).result();
			const call = first.content.find((block) => block.type === "toolCall");
			if (!call || call.type !== "toolCall") throw new Error("missing transcript tool call");
			expect(call).toMatchObject({ name: "echo", arguments: { text: "from gemini" } });
			const second = await provider.streamSimple(model, normalizeContext({ messages: [
				...context.messages,
				first,
				{ role: "toolResult", toolCallId: call.id, toolName: "echo", content: [{ type: "text", text: "native result" }], isError: false, timestamp: 3 },
			] }), { apiKey: "test-key" }).result();
			expect(second.content).toEqual([{ type: "text", text: "native result" }]);
		} finally {
			await runtime.close();
		}
	});
});
