import { describe, expect, it } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";

const enabled = process.env.PI_ANTIGRAVITY_ACP_LIVE === "1";

describe.skipIf(!enabled)("authenticated Google Antigravity ACP server", () => {
	it("creates a session and completes a harmless prompt", async () => {
		const updates: string[] = [];
		const connection = new AntigravityAcpConnection({
			cwd: process.cwd(),
			operationTimeoutMs: 120_000,
			handlers: {
				onUpdate: (notification) => {
					const update = notification.update;
					if (
						(update.sessionUpdate === "agent_message_chunk" ||
							update.sessionUpdate === "agent_thought_chunk") &&
						update.content.type === "text"
					) {
						updates.push(update.content.text);
					}
				},
				onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			},
		});
		try {
			const initialize = await connection.initialize();
			expect(initialize.agentInfo?.name).toBe("antigravity-acp");
			const session = await connection.newSession(process.cwd());
			expect(session.sessionId).toBeTruthy();
			const response = await connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "Reply with exactly: ANTIGRAVITY_ACP_LIVE_OK" }],
			});
			expect(response.stopReason).toBe("end_turn");
			expect(updates.join("")).toContain("ANTIGRAVITY_ACP_LIVE_OK");
		} finally {
			await connection.close();
		}
	}, 180_000);
});
