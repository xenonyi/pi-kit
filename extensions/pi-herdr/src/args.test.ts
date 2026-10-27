import assert from "node:assert/strict";
import { test } from "node:test";
import {
	agentGetArgs,
	agentPromptArgs,
	agentReadArgs,
	agentStartArgs,
	checkAgentName,
	checkPassthrough,
	checkPromptText,
	chooseSplitDirection,
	MAX_PROMPT_TEXT_CHARS,
	paneSplitArgs,
} from "./args.ts";

test("chooseSplitDirection prefers right for a wide pane", () => {
	const choice = chooseSplitDirection({ width: 130, height: 53 });
	assert.equal(choice.ok, true);
	assert.equal(choice.ok && choice.direction, "right");
});

test("chooseSplitDirection prefers down for a tall pane", () => {
	const choice = chooseSplitDirection({ width: 90, height: 120 });
	assert.equal(choice.ok, true);
	assert.equal(choice.ok && choice.direction, "down");
});

test("chooseSplitDirection falls back to down when sideways is too narrow", () => {
	const choice = chooseSplitDirection({ width: 70, height: 40 });
	assert.equal(choice.ok, true);
	assert.equal(choice.ok && choice.direction, "down");
});

test("chooseSplitDirection refuses a pane that is too small either way", () => {
	const choice = chooseSplitDirection({ width: 60, height: 12 });
	assert.equal(choice.ok, false);
	assert.match(choice.ok ? "" : choice.reason, /too small/);
});

test("chooseSplitDirection keeps equal square panes on the wide axis", () => {
	const choice = chooseSplitDirection({ width: 100, height: 100 });
	assert.equal(choice.ok && choice.direction, "right");
});

test("checkPassthrough refuses a bare invocation", () => {
	const denial = checkPassthrough([]);
	assert.equal(denial.denied, true);
	assert.match(denial.reason ?? "", /TUI/);
});

test("checkPassthrough refuses server stop", () => {
	assert.equal(checkPassthrough(["server", "stop"]).denied, true);
});

test("checkPassthrough refuses update", () => {
	assert.equal(checkPassthrough(["update"]).denied, true);
	assert.equal(checkPassthrough(["update", "--handoff"]).denied, true);
});

test("checkPassthrough refuses workspace close --group", () => {
	assert.equal(checkPassthrough(["workspace", "close", "w1", "--group"]).denied, true);
});

test("checkPassthrough allows ordinary queries and scoped closes", () => {
	assert.deepEqual(checkPassthrough(["pane", "list"]), { denied: false });
	assert.deepEqual(checkPassthrough(["workspace", "close", "w1"]), { denied: false });
	assert.deepEqual(checkPassthrough(["server", "reload-config"]), { denied: false });
	assert.deepEqual(checkPassthrough(["--machine", "box", "agent", "list"]), { denied: false });
});

test("checkPassthrough refuses to close the calling pane", () => {
	const denial = checkPassthrough(["pane", "close", "w1:p2"], "w1:p2");
	assert.equal(denial.denied, true);
	assert.match(denial.reason ?? "", /hosts this session/);
});

test("checkPassthrough allows closing another pane", () => {
	assert.deepEqual(checkPassthrough(["pane", "close", "w1:p3"], "w1:p2"), { denied: false });
	assert.deepEqual(checkPassthrough(["pane", "close", "w1:p2"], undefined), { denied: false });
});

test("paneSplitArgs defaults to --no-focus and carries cwd", () => {
	assert.deepEqual(paneSplitArgs({ direction: "right", cwd: "D:/w", focus: false }), [
		"pane",
		"split",
		"--current",
		"--direction",
		"right",
		"--cwd",
		"D:/w",
		"--no-focus",
	]);
});

test("paneSplitArgs omits cwd when unknown and honours focus", () => {
	assert.deepEqual(paneSplitArgs({ direction: "down", focus: true }), [
		"pane",
		"split",
		"--current",
		"--direction",
		"down",
		"--focus",
	]);
});

test("agentStartArgs passes the pane and optional timeout", () => {
	assert.deepEqual(agentStartArgs({ name: "handoff-1", kind: "pi", paneId: "w1:p2" }), [
		"agent",
		"start",
		"handoff-1",
		"--kind",
		"pi",
		"--pane",
		"w1:p2",
	]);
	assert.deepEqual(agentStartArgs({ name: "a", kind: "pi", paneId: "w1:p2", timeoutMs: 5000 }).slice(-2), [
		"--timeout",
		"5000",
	]);
});

test("agentPromptArgs never waits", () => {
	const args = agentPromptArgs("handoff-1", "hello");
	assert.deepEqual(args, ["agent", "prompt", "handoff-1", "hello"]);
	assert.equal(args.includes("--wait"), false);
	assert.equal(args.includes("--until"), false);
});

test("agentGetArgs and agentReadArgs keep the contract order", () => {
	assert.deepEqual(agentGetArgs("w1:p2"), ["agent", "get", "w1:p2"]);
	assert.deepEqual(agentReadArgs("w1:p2", "recent-unwrapped", 120), [
		"agent",
		"read",
		"w1:p2",
		"--source",
		"recent-unwrapped",
		"--lines",
		"120",
	]);
});

test("checkPromptText rejects empty and oversized text", () => {
	assert.equal(checkPromptText("   ").denied, true);
	assert.equal(checkPromptText("x".repeat(MAX_PROMPT_TEXT_CHARS + 1)).denied, true);
	assert.equal(checkPromptText("x".repeat(MAX_PROMPT_TEXT_CHARS)).denied, false);
});

test("checkAgentName enforces the documented pattern", () => {
	assert.equal(checkAgentName("handoff-1").denied, false);
	assert.equal(checkAgentName("Handoff").denied, true);
	assert.equal(checkAgentName("1handoff").denied, true);
	assert.equal(checkAgentName("handoff_agent-2").denied, false);
	assert.equal(checkAgentName("a".repeat(33)).denied, true);
});
