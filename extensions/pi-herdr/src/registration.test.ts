import assert from "node:assert/strict";
import { test } from "node:test";
import herdrExtension from "../index.ts";

interface Registered {
	name: string;
	exposure: string | undefined;
	executionMode: string | undefined;
	description: string;
	parameterKeys: string[];
	hasOutputSchema: boolean;
}

function load(env: Record<string, string | undefined>) {
	const saved = { HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	const tools: Registered[] = [];
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers.set(event, handler);
			return () => {};
		},
		registerTool(tool: {
			name: string;
			exposure?: string;
			executionMode?: string;
			description: string;
			parameters: { properties?: Record<string, unknown> };
			outputSchema?: unknown;
		}) {
			tools.push({
				name: tool.name,
				exposure: tool.exposure,
				executionMode: tool.executionMode,
				description: tool.description,
				parameterKeys: Object.keys(tool.parameters.properties ?? {}),
				hasOutputSchema: tool.outputSchema !== undefined,
			});
		},
		registerCommand() {},
	};

	herdrExtension(pi as never);

	const restore = () => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};

	return { tools, handlers, restore };
}

async function startSession(load_: ReturnType<typeof load>, hasUI = true) {
	const handler = load_.handlers.get("session_start");
	assert.ok(handler, "the extension must subscribe to session_start");
	await handler({ type: "session_start" }, {
		hasUI,
		mode: hasUI ? "tui" : "print",
		cwd: process.cwd(),
		ui: { notify: () => {} },
	});
}

const TOOL_NAMES = [
	"herdr_pane_split",
	"herdr_agent_spawn",
	"herdr_agent_get",
	"herdr_agent_prompt",
	"herdr_agent_read",
	"herdr_cli",
];

test("the factory registers all six herdr tools as hidden before any session", () => {
	const loaded = load({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" });
	try {
		assert.deepEqual(
			loaded.tools.map((tool) => tool.name).sort(),
			[...TOOL_NAMES].sort(),
		);
		assert.equal(loaded.tools.every((tool) => tool.exposure === "hidden"), true);
	} finally {
		loaded.restore();
	}
});

test("every tool declares an outputSchema so scripts get ids as data", () => {
	const loaded = load({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" });
	try {
		for (const tool of loaded.tools) assert.equal(tool.hasOutputSchema, true, tool.name);
	} finally {
		loaded.restore();
	}
});

test("every tool is sequential and documents its parameters", () => {
	const loaded = load({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" });
	try {
		for (const tool of loaded.tools) {
			assert.equal(tool.executionMode, "sequential", tool.name);
			assert.ok(tool.description.length > 40, `${tool.name} description too short`);
		}
		const byName = new Map(loaded.tools.map((tool) => [tool.name, tool]));
		assert.deepEqual(byName.get("herdr_agent_prompt")?.parameterKeys.sort(), ["machine", "target", "text"]);
		assert.deepEqual(byName.get("herdr_pane_split")?.parameterKeys.sort(), [
			"cwd",
			"direction",
			"focus",
			"machine",
			"pane",
		]);
		assert.deepEqual(byName.get("herdr_agent_spawn")?.parameterKeys.sort(), [
			"cwd",
			"direction",
			"kind",
			"machine",
			"name",
			"pane",
			"timeoutMs",
		]);
		assert.deepEqual(byName.get("herdr_cli")?.parameterKeys.sort(), ["args", "json", "machine", "timeoutMs"]);
	} finally {
		loaded.restore();
	}
});

test("a session inside a Herdr pane declares the tools directly", async () => {
	const loaded = load({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" });
	try {
		await startSession(loaded);
		const declared = loaded.tools.filter((tool) => tool.exposure === "direct");
		assert.deepEqual(declared.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
	} finally {
		loaded.restore();
	}
});

test("a session outside a Herdr pane keeps the tools hidden", async () => {
	const loaded = load({ HERDR_ENV: undefined, HERDR_PANE_ID: undefined });
	try {
		await startSession(loaded);
		assert.equal(loaded.tools.every((tool) => tool.exposure === "hidden"), true);
	} finally {
		loaded.restore();
	}
});

test("a half-set pane marker keeps the tools hidden", async () => {
	const loaded = load({ HERDR_ENV: "1", HERDR_PANE_ID: "" });
	try {
		await startSession(loaded);
		assert.equal(loaded.tools.every((tool) => tool.exposure === "hidden"), true);
	} finally {
		loaded.restore();
	}
});
