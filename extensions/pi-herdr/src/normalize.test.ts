import assert from "node:assert/strict";
import { test } from "node:test";
import {
	describeAgentView,
	extractPaneId,
	extractPaneRect,
	normalizeCwd,
	normalizeAgentView,
	parseErrorPayload,
	parseJson,
	readTriState,
	truncateText,
} from "./normalize.ts";

/** Trimmed copy of a real `herdr agent get` response (0.9.5, protocol 22). */
const realAgentGet = {
	id: "cli:agent:get",
	result: {
		type: "agent_info",
		agent: {
			agent: "pi",
			agent_session: {
				agent: "pi",
				kind: "path",
				source: "herdr:pi",
				value: "C:\\Users\\x1any\\.pi\\agent\\sessions\\--D--Workspace-pi-kit--\\session.jsonl",
			},
			agent_status: "working",
			cwd: "D:\\Workspace\\pi-kit",
			focused: true,
			pane_id: "wB:p1",
			revision: 3,
			screen_detection_skipped: true,
			state_change_seq: 73,
			tab_id: "wB:t1",
			terminal_id: "term_65ed21a8ff09f2",
			terminal_title: "π - pi-kit",
			workspace_id: "wB",
		},
	},
};

test("normalizeAgentView reads a real response without inventing fields", () => {
	const view = normalizeAgentView(realAgentGet);
	assert.ok(view);
	assert.equal(view.paneId, "wB:p1");
	assert.equal(view.kind, "pi");
	assert.equal(view.status, "working");
	assert.equal(view.cwd, "D:\\Workspace\\pi-kit");
	assert.equal(view.stateChangeSeq, 73);
	assert.equal(view.sessionKind, "path");
	assert.match(view.sessionPath ?? "", /session\.jsonl$/);
});

test("absent optional fields become null/unknown, never false", () => {
	const view = normalizeAgentView(realAgentGet);
	assert.ok(view);
	assert.equal(view.name, null);
	assert.equal(view.interactiveReady, "unknown");
	assert.equal(view.launchPending, "unknown");
	assert.equal(view.completionSeq, 0);
});

test("interactive_ready=false stays a real false", () => {
	const payload = structuredClone(realAgentGet);
	Object.assign(payload.result.agent, { interactive_ready: false, launch_pending: true });
	const view = normalizeAgentView(payload);
	assert.equal(view?.interactiveReady, false);
	assert.equal(view?.launchPending, true);
});

test("completion_seq is reported when present", () => {
	const payload = structuredClone(realAgentGet);
	Object.assign(payload.result.agent, { completion_seq: 12 });
	assert.equal(normalizeAgentView(payload)?.completionSeq, 12);
});

test("unknown agent_status degrades to unknown", () => {
	const payload = structuredClone(realAgentGet);
	Object.assign(payload.result.agent, { agent_status: "hibernating" });
	assert.equal(normalizeAgentView(payload)?.status, "unknown");
});

test("a record without pane_id is not an agent", () => {
	assert.equal(normalizeAgentView({ result: { agent: { agent_status: "idle" } } }), null);
	assert.equal(normalizeAgentView(null), null);
});

test("extractPaneId reads the nested split response", () => {
	assert.equal(
		extractPaneId({ id: "cli:pane:split", result: { type: "pane_split", pane: { pane_id: "w1:p3" } } }),
		"w1:p3",
	);
	assert.equal(extractPaneId({ result: {} }), null);
});

test("extractPaneRect finds the caller pane inside a layout snapshot", () => {
	const layout = {
		result: {
			layout: {
				area: { width: 130, height: 53 },
				focused_pane_id: "wB:p1",
				panes: [
					{ pane_id: "wB:p1", rect: { x: 0, y: 0, width: 130, height: 53 } },
					{ pane_id: "wB:p2", rect: { x: 65, y: 0, width: 65, height: 53 } },
				],
			},
		},
	};
	assert.deepEqual(extractPaneRect(layout, "wB:p2"), { width: 65, height: 53 });
	assert.equal(extractPaneRect(layout, "wB:p9"), null);
});

test("parseErrorPayload understands server and syntax errors", () => {
	assert.deepEqual(parseErrorPayload('{"error":{"code":"agent_not_found","message":"agent target x not found"}}'), {
		code: "agent_not_found",
		message: "agent target x not found",
	});
	assert.equal(parseErrorPayload("invalid split direction: left"), null);
});

test("parseJson ignores non-JSON and tolerates broken JSON", () => {
	assert.equal(parseJson("invalid split direction: left"), undefined);
	assert.equal(parseJson("{oops"), undefined);
	assert.deepEqual(parseJson('{"ok":true}'), { ok: true });
});

test("readTriState maps absence to unknown", () => {
	assert.equal(readTriState({ a: true }, "a"), true);
	assert.equal(readTriState({ a: false }, "a"), false);
	assert.equal(readTriState({}, "a"), "unknown");
	assert.equal(readTriState(null, "a"), "unknown");
});

test("truncateText reports the full length when it cuts", () => {
	const short = truncateText("abc");
	assert.equal(short.truncated, false);
	assert.equal(short.fullLength, 3);

	const long = truncateText("x".repeat(100), 10);
	assert.equal(long.truncated, true);
	assert.equal(long.fullLength, 100);
	assert.match(long.text, /truncated: 90 more characters/);
});

test("normalizeCwd drops the trailing separator herdr echoes back", () => {
	assert.equal(normalizeCwd("D:\\Workspace\\pi-kit\\"), "D:\\Workspace\\pi-kit");
	assert.equal(normalizeCwd("D:\\Workspace\\pi-kit"), "D:\\Workspace\\pi-kit");
	assert.equal(normalizeCwd("/home/x/"), "/home/x");
	assert.equal(normalizeCwd("/"), "/");
	assert.equal(normalizeCwd("C:\\"), "C:\\");
	assert.equal(normalizeCwd(""), null);
	assert.equal(normalizeCwd(null), null);
});

test("normalizeAgentView normalizes the cwd", () => {
	const payload = structuredClone(realAgentGet);
	Object.assign(payload.result.agent, { cwd: "D:\\Workspace\\pi-kit\\" });
	assert.equal(normalizeAgentView(payload)?.cwd, "D:\\Workspace\\pi-kit");
});

test("describeAgentView states the unknown bits explicitly", () => {
	const view = normalizeAgentView(realAgentGet);
	assert.ok(view);
	const text = describeAgentView(view);
	assert.match(text, /pane wB:p1/);
	assert.match(text, /\(unnamed\)/);
	assert.match(text, /completion_seq 0/);
	assert.match(text, /state_change_seq 73/);
	assert.doesNotMatch(text, /interactive_ready/);
});
