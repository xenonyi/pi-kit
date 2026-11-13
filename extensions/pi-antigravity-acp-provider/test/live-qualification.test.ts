import type { Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";
import { PiMcpBridge } from "../src/mcp/bridge.js";

const enabled = process.env.PI_ANTIGRAVITY_ACP_QUALIFY === "1";

function connection(overrides: Partial<ConstructorParameters<typeof AntigravityAcpConnection>[0]> = {}) {
	return new AntigravityAcpConnection({ ...overrides, cwd: overrides.cwd ?? process.cwd(), operationTimeoutMs: 120_000 });
}

describe.skipIf(!enabled)("live Antigravity ACP qualification", () => {
	it("switches model effort and remains usable after cancellation", async () => {
		const acp = connection();
		try {
			await acp.initialize();
			const session = await acp.newSession(process.cwd());
			await acp.setMode(session.sessionId, "yolo");
			await acp.setModel(session.sessionId, "gemini-3.8-flash-low");
			const controller = new AbortController();
			const pending = acp.prompt(
				{
					sessionId: session.sessionId,
					prompt: [{ type: "text", text: "Write a very long numbered explanation with at least 200 sections." }],
				},
				controller.signal,
			);
			setTimeout(() => controller.abort(), 150);
			await expect(pending).rejects.toMatchObject({ code: "aborted" });
			expect(acp.process.alive).toBe(true);
			const followup = await acp.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "Reply with exactly: CANCEL_RECOVERY_OK" }],
			});
			expect(followup.stopReason).toBe("end_turn");
		} finally {
			await acp.close();
		}
	}, 180_000);

	it("restores an ACP session after the server process restarts", async () => {
		let sessionId: string;
		const first = connection();
		try {
			const initialize = await first.initialize();
			expect(initialize.agentCapabilities?.sessionCapabilities?.resume).toBeDefined();
			const session = await first.newSession(process.cwd());
			sessionId = session.sessionId;
			await first.setMode(sessionId, "yolo");
			await first.prompt({
				sessionId,
				prompt: [{ type: "text", text: "Remember this exact private test marker: RESTORE_LIVE_48291. Reply only SAVED." }],
			});
		} finally {
			await first.close();
		}

		const updates: string[] = [];
		const second = connection({
			handlers: {
				onUpdate: (notification) => {
					const update = notification.update;
					if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
						updates.push(update.content.text);
					}
				},
			},
		});
		try {
			await second.initialize();
			await second.resumeSession(sessionId!, process.cwd());
			await second.prompt({
				sessionId: sessionId!,
				prompt: [{ type: "text", text: "What was the exact private test marker? Reply with only the marker." }],
			});
			expect(updates.join("")).toContain("RESTORE_LIVE_48291");
		} finally {
			await second.close();
		}
	}, 180_000);

	it("registers and executes the authenticated loopback Pi MCP tool", async () => {
		let value: string | undefined;
		const bridge = new PiMcpBridge({
			tools: [
				{
					name: "qualification_echo",
					label: "Qualification Echo",
					description: "Required qualification tool. Echoes a value through Pi.",
					parameters: Type.Object({ value: Type.String() }),
				} as unknown as Tool,
			],
			onCall: async (invocation) => {
				value = String(invocation.arguments.value ?? "");
				return { content: [{ type: "text", text: `echo:${value}` }] };
			},
		});
		const server = await bridge.start();
		expect(server).toBeDefined();
		const acp = connection();
		try {
			await acp.initialize();
			const session = await acp.newSession(process.cwd(), undefined, [server!]);
			await acp.setMode(session.sessionId, "yolo");
			await acp.setModel(session.sessionId, "gemini-3.8-flash-low");
			const response = await acp.prompt({
				sessionId: session.sessionId,
				prompt: [
					{
						type: "text",
						text: "You must call the pi-bridge MCP tool named pi_qualification_echo once with value MCP_LIVE_OK, then report its result.",
					},
				],
			});
			expect(response.stopReason).toBe("end_turn");
			expect(value).toBe("MCP_LIVE_OK");
		} finally {
			await Promise.all([acp.close(), bridge.close()]);
		}
	}, 180_000);

	it("receives a native-command permission request in default mode", async () => {
		let permissionRequests = 0;
		const acp = connection({
			cwd: process.cwd(),
			handlers: {
				onPermission: async () => {
					permissionRequests += 1;
					return { outcome: { outcome: "cancelled" } };
				},
			},
		});
		try {
			await acp.initialize();
			const session = await acp.newSession(process.cwd());
			await acp.setMode(session.sessionId, "default");
			await acp.setModel(session.sessionId, "gemini-3.8-flash-low");
			await acp.prompt({
				sessionId: session.sessionId,
				prompt: [
					{
						type: "text",
						text: "Use a native terminal command to run printf ACP_PERMISSION_TEST. Do not answer without attempting the command.",
					},
				],
			});
			expect(permissionRequests).toBeGreaterThan(0);
		} finally {
			await acp.close();
		}
	}, 180_000);
});
