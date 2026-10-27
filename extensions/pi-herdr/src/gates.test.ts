import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkCompatibility,
	gatePromptTarget,
	isHerdrPane,
	spawnReadiness,
	startObserved,
	EXPECTED_PROTOCOL,
	EXPECTED_VERSION,
} from "./gates.ts";
import { normalizeAgentView } from "./normalize.ts";

function view(overrides: Record<string, unknown> = {}) {
	const normalized = normalizeAgentView({
		result: {
			agent: {
				agent: "pi",
				agent_status: "idle",
				cwd: "D:\\w",
				focused: false,
				pane_id: "w1:p2",
				state_change_seq: 10,
				...overrides,
			},
		},
	});
	if (!normalized) throw new Error("fixture did not normalize");
	return normalized;
}

test("isHerdrPane needs both markers", () => {
	assert.equal(isHerdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" }), true);
	assert.equal(isHerdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "" }), false);
	assert.equal(isHerdrPane({ HERDR_ENV: "1", HERDR_PANE_ID: "   " }), false);
	assert.equal(isHerdrPane({ HERDR_PANE_ID: "w1:p2" }), false);
	assert.equal(isHerdrPane({ HERDR_ENV: "0", HERDR_PANE_ID: "w1:p2" }), false);
	assert.equal(isHerdrPane({}), false);
});

test("gatePromptTarget allows idle and done only", () => {
	assert.deepEqual(gatePromptTarget(view()), { allow: true });
	assert.deepEqual(gatePromptTarget(view({ agent_status: "done" })), { allow: true });
});

test("gatePromptTarget refuses blocked with an ask-the-user reason", () => {
	const decision = gatePromptTarget(view({ agent_status: "blocked" }));
	assert.equal(decision.allow, false);
	assert.match(decision.reason ?? "", /ask the user/);
});

test("gatePromptTarget refuses working because the prompt lands in its turn", () => {
	const decision = gatePromptTarget(view({ agent_status: "working" }));
	assert.equal(decision.allow, false);
	assert.match(decision.reason ?? "", /current turn/);
});

test("gatePromptTarget refuses unknown statuses", () => {
	const decision = gatePromptTarget(view({ agent_status: "hibernating" }));
	assert.equal(decision.allow, false);
	assert.match(decision.reason ?? "", /unknown/);
});

test("spawnReadiness accepts only interactive_ready=true", () => {
	assert.deepEqual(spawnReadiness(view({ interactive_ready: true })), { ready: true });
	const missing = spawnReadiness(view());
	assert.equal(missing.ready, false);
	assert.match(missing.reason ?? "", /not the same as false/);
});

test("spawnReadiness explains false and launch_pending", () => {
	assert.match(spawnReadiness(view({ interactive_ready: false })).reason ?? "", /interactive_ready=false/);
	assert.match(spawnReadiness(view({ launch_pending: true })).reason ?? "", /launch_pending=true/);
});

/** Trimmed copy of a real `herdr status --json` response. */
const realStatus = {
	client: { version: "0.9.5", channel: "stable", protocol: 22 },
	server: { status: "running", version: "0.9.5", protocol: 22, compatible: true, endpoint_compatible: true },
	update: { restart_needed: false, server_binary_stale: false },
};

test("checkCompatibility accepts the verified protocol", () => {
	const report = checkCompatibility(realStatus);
	assert.equal(report.compatible, true);
	assert.equal(report.clientProtocol, EXPECTED_PROTOCOL);
	assert.equal(report.serverProtocol, EXPECTED_PROTOCOL);
	assert.equal(report.clientVersion, "0.9.5");
});

test("checkCompatibility names version drift instead of missing fields", () => {
	const report = checkCompatibility({
		client: { version: "0.9.6", protocol: 23 },
		server: { version: "0.9.6", protocol: 23 },
	});
	assert.equal(report.compatible, false);
	assert.match(report.reason ?? "", /protocol 23 is not protocol 22/);
	assert.match(report.reason ?? "", /version drift/);
});

test("checkCompatibility flags a missing protocol", () => {
	const report = checkCompatibility({ client: {}, server: {} });
	assert.equal(report.compatible, false);
	assert.match(report.reason ?? "", /did not report a protocol/);
});

test("checkCompatibility reports the expected version in the message", () => {
	const report = checkCompatibility({ client: { protocol: 1 }, server: { protocol: 1 } });
	assert.match(report.reason ?? "", new RegExp(EXPECTED_VERSION.replaceAll(".", "\\.")));
});

test("startObserved compares state_change_seq first", () => {
	assert.equal(startObserved({ stateChangeSeq: 10, completionSeq: 0 }, { stateChangeSeq: 12, completionSeq: 0 }), true);
	assert.equal(startObserved({ stateChangeSeq: 10, completionSeq: 0 }, { stateChangeSeq: 10, completionSeq: 0 }), false);
});

test("startObserved falls back to completion_seq when state is missing", () => {
	assert.equal(startObserved({ stateChangeSeq: null, completionSeq: 1 }, { stateChangeSeq: null, completionSeq: 2 }), true);
	assert.equal(startObserved({ stateChangeSeq: null, completionSeq: 2 }, { stateChangeSeq: null, completionSeq: 2 }), false);
});

test("startObserved is inconclusive without a second read", () => {
	assert.equal(startObserved({ stateChangeSeq: 10, completionSeq: 0 }, null), null);
});
