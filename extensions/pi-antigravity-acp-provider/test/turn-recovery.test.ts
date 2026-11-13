import { normalizeContext, type Context, type Model } from "@earendil-works/pi-ai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAntigravityAcpLaunch } from "../src/acp/antigravity.js";
import { AntigravityAcpConnection } from "../src/acp/connection.js";
import { AntigravityAcpError } from "../src/acp/errors.js";
import { AcpSessionStore } from "../src/acp/session-store.js";
import { ensureAntigravityAcpReady } from "../src/acp/setup.js";
import {
	classifyEndTurnError,
	couldBeErrorPrefix,
	TurnOutputBuffer,
} from "../src/acp/turn-recovery.js";
import { AntigravityRuntime, type AntigravityConnectionFactory, type AntigravityRuntimeOptions } from "../src/runtime.js";
import { PiEventWriter } from "../src/stream/pi-events.js";

const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const model: Model<"antigravity-acp"> = {
	id: "gemini-test",
	name: "Test",
	api: "antigravity-acp",
	provider: "antigravity-acp",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 8192,
};

const user = (content: string, timestamp = 1): Context["messages"][number] => ({
	role: "user",
	content,
	timestamp,
});

const tempRoots: string[] = [];
const runtimes: AntigravityRuntime[] = [];

afterEach(async () => {
	while (runtimes.length > 0) {
		await runtimes.pop()!.close();
	}
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	while (tempRoots.length > 0) {
		fs.rmSync(tempRoots.pop()!, { recursive: true, force: true });
	}
});

function setup(
	scenario?: string,
	options: { runtimeOptions?: AntigravityRuntimeOptions; withStore?: boolean; perConnectionEnv?: (index: number) => NodeJS.ProcessEnv } = {},
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-recovery-"));
	tempRoots.push(root);
	const log = path.join(root, "calls.jsonl");
	fs.writeFileSync(log, "");
	const connections: AntigravityAcpConnection[] = [];
	const factory: AntigravityConnectionFactory = (connOptions) => {
		const index = connections.length;
		const extraEnv = options.perConnectionEnv?.(index) ?? {};
		const connection = new AntigravityAcpConnection({
			...connOptions,
			command: process.execPath,
			args: [fakeAgent, ...(scenario ? [scenario] : [])],
			env: { ...process.env, ...connOptions.env, FAKE_AGENT_LOG_FILE: log, ...extraEnv },
		});
		connections.push(connection);
		return connection;
	};
	const store = options.withStore ? new AcpSessionStore(path.join(root, "sessions.json")) : undefined;
	const runtime = new AntigravityRuntime(factory, "yolo", store, {
		retryDelaysMs: [5, 5],
		...options.runtimeOptions,
	});
	runtimes.push(runtime);
	const entries = () =>
		fs
			.readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	return { root, runtime, connections, store, entries };
}

function streamTurn(
	runtime: AntigravityRuntime,
	messages: Context["messages"],
	sessionId?: string,
) {
	return runtime
		.stream(model, normalizeContext({ messages }), {
			apiKey: "test-key",
			...(sessionId ? { sessionId } : {}),
		})
		.stream;
}

describe("turn-recovery classification & buffering", () => {
	it("holds ambiguous error prefixes until prose diverges or flushes explicitly", () => {
		const writer = new PiEventWriter(model);
		const buffer = new TurnOutputBuffer(writer);
		buffer.text("5");
		buffer.text("0");
		expect(writer.message.content).toEqual([]);
		expect(buffer.hasCommittedOutput).toBe(false);

		buffer.text("1 status code explanation");
		expect(writer.message.content).toEqual([{ type: "text", text: "501 status code explanation" }]);
		expect(buffer.hasCommittedOutput).toBe(true);
		expect(buffer.rawText).toBe("501 status code explanation");
		writer.done("stop");
	});

	it("streams unambiguous normal prose immediately without waiting for end_turn", () => {
		const writer = new PiEventWriter(model);
		const buffer = new TurnOutputBuffer(writer);
		buffer.text("Sure! Let me inspect that file.");
		expect(buffer.hasCommittedOutput).toBe(true);
		expect(writer.message.content).toEqual([{ type: "text", text: "Sure! Let me inspect that file." }]);
		writer.done("stop");
	});

	it("deduplicates repeated plans and falls back to synthetic progress when native thoughts are absent", () => {
		const writer = new PiEventWriter(model);
		const buffer = new TurnOutputBuffer(writer);
		buffer.plan("\n[Plan 1/2] Apply fix\n", "full plan dump");
		buffer.plan("\n[Plan 1/2] Apply fix\n", "full plan dump");
		buffer.toolActivity("\n[Tool] Preparing Read file — in_progress\n", "tool detail 1");
		buffer.toolActivity("\n[Tool] Read file — completed\n", "tool detail 2");
		writer.done("stop");

		const thinking = writer.message.content
			.filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking")
			.map((block) => block.thinking)
			.join("");
		expect(thinking).toBe(
			"\n[Plan 1/2] Apply fix\n\n[Tool] Preparing Read file — in_progress\n\n[Tool] Read file — completed\n",
		);
	});

	it("uses full detail instead of synthetic summaries once native thoughts arrive", () => {
		const writer = new PiEventWriter(model);
		const buffer = new TurnOutputBuffer(writer);
		buffer.thinking("Real thought");
		buffer.plan("\n[Plan 1/2] Apply fix\n", "\n[Antigravity plan]\n- [completed] Inspect\n");
		buffer.toolActivity("\n[Tool] Read file — completed\n", "\n[Antigravity tool update: Read file — completed]\n");
		writer.done("stop");

		const thinking = writer.message.content
			.filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking")
			.map((block) => block.thinking)
			.join("");
		expect(thinking).toBe(
			"Real thought\n[Antigravity plan]\n- [completed] Inspect\n\n[Antigravity tool update: Read file — completed]\n",
		);
	});

	it("classifies transient gateways, wedged sessions, and leaves quoted prose alone", () => {
		expect(couldBeErrorPrefix("50")).toBe(true);
		expect(classifyEndTurnError("502", 0, "end_turn", 0, "gemini-test")?.kind).toBe("transient");
		expect(classifyEndTurnError("The model is currently unreachable.", 0, "end_turn", 0, "gemini-test")?.kind).toBe(
			"transient",
		);
		expect(classifyEndTurnError("ACP Internal Error: conversation corrupt", 0, "end_turn", 0, "gemini-test")?.kind).toBe(
			"wedged",
		);
		expect(
			classifyEndTurnError(
				'The log showed "The model is currently unreachable." when we restarted the proxy.',
				120,
				"end_turn",
				0,
				"gemini-test",
			),
		).toBeUndefined();
	});
});

describe("protocol retry & session rollover", () => {
	it("retries transient end_turn 502 banners cleanly without leaking error text to Pi", async () => {
		const { runtime, connections, entries } = setup("recovery-transient-endturn");
		const message = await streamTurn(runtime, [user("hello")], "retry-502").result();

		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([
			{ type: "thinking", thinking: "Checking" },
			{ type: "text", text: "Hello" },
		]);
		expect(connections).toHaveLength(1);
		const prompts = entries().filter((entry) => entry.method === "session/prompt");
		expect(prompts).toHaveLength(2);
	});

	it("fails cleanly without committing error banner text when retries are exhausted", async () => {
		const { runtime } = setup("recovery-persistent-502");
		const message = await streamTurn(runtime, [user("hello")], "persistent-502").result();

		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toMatch(/502|unreachable/iu);
		expect(message.content.filter((block) => block.type === "text")).toEqual([]);
	});

	it("rolls over a wedged ACP session on the same live process via session/new", async () => {
		const { runtime, connections, entries } = setup("recovery-wedged-session");
		const message = await streamTurn(runtime, [user("hello")], "wedged").result();

		expect(message.stopReason).toBe("stop");
		expect(message.content).toEqual([
			{ type: "thinking", thinking: "Checking" },
			{ type: "text", text: "Hello" },
		]);
		expect(connections).toHaveLength(1);
		expect(entries().filter((entry) => entry.method === "session/new")).toHaveLength(2);
	});

	it("recovers from unexpected mid-turn process exit by spawning a replacement process", async () => {
		const { runtime, connections } = setup("recovery-exit-midturn", {
			perConnectionEnv: (index) => (index > 0 ? { FAKE_SECOND_PROCESS: "1" } : {}),
		});
		const message = await streamTurn(runtime, [user("hello")], "crash-retry").result();

		expect(message.stopReason).toBe("stop");
		expect(message.content).toContainEqual({ type: "text", text: "Hello" });
		expect(connections).toHaveLength(2);
	});

	it("proactively rolls over long sessions after proactiveRolloverTurns and rehydrates history", async () => {
		const { runtime, connections, store, entries } = setup("recovery-long", {
			withStore: true,
			runtimeOptions: { proactiveRolloverTurns: 2 },
		});

		const first = await streamTurn(runtime, [user("turn 1", 1)], "long-s").result();
		const second = await streamTurn(runtime, [user("turn 1", 1), first, user("turn 2", 2)], "long-s").result();
		expect(store!.get("long-s")?.acpSessionId).toBe("fake-session-1");

		const third = await streamTurn(
			runtime,
			[user("turn 1", 1), first, user("turn 2", 2), second, user("turn 3", 3)],
			"long-s",
		).result();

		expect(third.stopReason).toBe("stop");
		expect(connections).toHaveLength(1);
		expect(store!.get("long-s")?.acpSessionId).toBe("fake-session-2");
		const prompts = entries().filter((entry) => entry.method === "session/prompt");
		expect(prompts).toHaveLength(3);
		const rolledPromptText = ((prompts[2]!.prompt as Array<{ text?: string; resource?: { text?: string } }>) ?? [])
			.map((block) => block.text ?? block.resource?.text ?? "")
			.join("\n");
		expect(rolledPromptText).toContain("turn 1");
		expect(rolledPromptText).toContain("turn 3");
	});
});

describe("prewarm, single-pipeline quota reuse & synthetic progress", () => {
	it("reuses a prewarmed standby connection for the first session and reuses idle binding for /usage", async () => {
		const { root, runtime, connections, entries } = setup("recovery-warm", {
			withStore: true,
		});
		const geminiHome = path.join(root, "gemini");
		vi.stubEnv("GEMINI_HOME", geminiHome);
		vi.stubEnv("FAKE_AGENT_CONVERSATIONS", "uuid");

		await runtime.prewarm("test-key");
		expect(connections).toHaveLength(1);
		expect(connections[0]!.process.alive).toBe(true);

		const turnResult = await streamTurn(runtime, [user("hello warm")], "warm-sid").result();
		expect(turnResult.stopReason).toBe("stop");
		expect(connections).toHaveLength(1);

		const quota = await runtime.quota("test-key");
		expect(quota.groups.length).toBeGreaterThan(0);
		expect(connections).toHaveLength(1);

		const conversationsDir = path.join(geminiHome, "antigravity-acp", "conversations");
		const files = fs.readdirSync(conversationsDir);
		const dbFiles = files.filter((file) => file.endsWith(".db"));
		expect(dbFiles).toHaveLength(1);
		expect(entries().filter((entry) => entry.method === "session/prompt")).toHaveLength(2);
	});

	it("emits concise deduplicated synthetic thoughts when agent sends plan/tools without agent_thought_chunk", async () => {
		const { runtime } = setup("recovery-plan-only");
		const message = await streamTurn(runtime, [user("work")], "plan-sid").result();

		expect(message.stopReason).toBe("stop");
		const thinking = message.content
			.filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking")
			.map((block) => block.thinking)
			.join("");
		expect(thinking).toContain("[Plan 2/2] Apply fix");
		expect(thinking.match(/\[Plan 2\/2\] Apply fix/g)).toHaveLength(1);
		expect(thinking).toContain("[Tool] Preparing Read file — in_progress");
		expect(thinking).toContain("[Tool] Read file — completed");
		expect(message.content).toContainEqual({ type: "text", text: "Done" });
	});
});

describe("managed runtime pre-launch permission repair", () => {
	it("repairs lost +x permissions under ~/.local/opt/agy-acp/current before resolution", async () => {
		if (process.platform === "win32") return;
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-perm-repair-"));
		tempRoots.push(root);
		const fakeHome = path.join(root, "home");
		const scopedGemini = path.join(root, "gemini");
		const currentDir = path.join(fakeHome, ".local", "opt", "agy-acp", "current");
		fs.mkdirSync(currentDir, { recursive: true });
		const serverBin = path.join(currentDir, "agy_acp_server.par");
		const helperBin = path.join(currentDir, "localharness_external");
		fs.writeFileSync(serverBin, "#!/bin/sh\necho ok\n", { mode: 0o644 });
		fs.writeFileSync(helperBin, "#!/bin/sh\necho ok\n", { mode: 0o644 });

		vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
		vi.stubEnv("HOME", fakeHome);
		vi.stubEnv("GEMINI_HOME", scopedGemini);
		vi.stubEnv("AGY_ACP_BIN", "");
		vi.stubEnv("AGY_ACP_NO_UPDATE", "1");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new AntigravityAcpError("protocol", "network disabled in test")),
		);

		await ensureAntigravityAcpReady();
		const ready = resolveAntigravityAcpLaunch();
		expect(ready.command).toBe(serverBin);
		expect(fs.statSync(serverBin).mode & 0o111).not.toBe(0);
		expect(fs.statSync(helperBin).mode & 0o111).not.toBe(0);
	});
});
