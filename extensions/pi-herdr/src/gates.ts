/**
 * Pure state gates and compatibility checks.
 *
 * These encode the handoff skill's hard-won rules so a model cannot skip them:
 * only an idle or done agent may be prompted, a `blocked` agent must be shown
 * to the user, and a protocol change is reported as a version problem instead
 * of looking like a missing field.
 */

import { asRecord, readNumber, readString, type AgentView } from "./normalize.ts";

/** `/herdr --skill` requires both markers: HERDR_ENV=1 and a non-empty pane id. */
export function isHerdrPane(env: NodeJS.ProcessEnv = process.env): boolean {
	const marker = env.HERDR_ENV;
	const paneId = env.HERDR_PANE_ID;
	return marker === "1" && typeof paneId === "string" && paneId.trim().length > 0;
}

export interface Decision {
	allow: boolean;
	reason?: string;
}

/** Herdr accepts a prompt on a working agent, but it lands in the running turn. */
export const PROMPT_ALLOWED_STATUSES = ["idle", "done"] as const;

export function gatePromptTarget(view: AgentView): Decision {
	if ((PROMPT_ALLOWED_STATUSES as readonly string[]).includes(view.status)) return { allow: true };
	const target = view.name ?? view.paneId;
	switch (view.status) {
		case "blocked":
			return {
				allow: false,
				reason: `${target} is blocked on an approval or question dialog. Read the pane and ask the user; never answer it on their behalf.`,
			};
		case "working":
			return {
				allow: false,
				reason: `${target} is still working. A prompt now is injected into its current turn and destroys that work; wait for idle or done first.`,
			};
		default:
			return {
				allow: false,
				reason: `${target} is in status "${view.status}", so its readiness is unknown. Read the pane before sending anything.`,
			};
	}
}

export interface SpawnReadiness {
	ready: boolean;
	reason?: string;
}

/** Applied to the `agent start` response, which is the only place `interactive_ready` appears reliably. */
export function spawnReadiness(view: AgentView): SpawnReadiness {
	if (view.interactiveReady === true) return { ready: true };
	if (view.interactiveReady === false) {
		return {
			ready: false,
			reason:
				"agent start reported interactive_ready=false: the agent has not reached an interactive prompt. Do not retry start; read the pane to see which dialog it stopped on.",
		};
	}
	if (view.launchPending === true) {
		return {
			ready: false,
			reason: "agent start reported launch_pending=true: the agent process is still starting. Read the pane before sending a prompt.",
		};
	}
	return {
		ready: false,
		reason:
			"agent start did not report interactive_ready. That is not the same as false: read the pane before sending a prompt, and do not retry start.",
	};
}

export const EXPECTED_PROTOCOL = 22;
export const EXPECTED_VERSION = "0.9.5";

export interface CompatibilityReport {
	compatible: boolean;
	clientVersion: string | null;
	serverVersion: string | null;
	clientProtocol: number | null;
	serverProtocol: number | null;
	reason?: string;
}

export function checkCompatibility(
	statusPayload: unknown,
	expected: { protocol: number; version: string } = { protocol: EXPECTED_PROTOCOL, version: EXPECTED_VERSION },
): CompatibilityReport {
	const payload = asRecord(statusPayload) ?? {};
	const client = asRecord(payload.client);
	const server = asRecord(payload.server);
	const report: CompatibilityReport = {
		compatible: true,
		clientVersion: readString(client, "version"),
		serverVersion: readString(server, "version"),
		clientProtocol: readNumber(client, "protocol"),
		serverProtocol: readNumber(server, "protocol"),
	};

	if (report.clientProtocol === null || report.serverProtocol === null) {
		return {
			...report,
			compatible: false,
			reason: "herdr status did not report a protocol version; the CLI shape may have changed.",
		};
	}

	const mismatched = [report.clientProtocol, report.serverProtocol].filter(
		(protocol) => protocol !== expected.protocol,
	);
	if (mismatched.length > 0) {
		return {
			...report,
			compatible: false,
			reason: `herdr protocol ${[...new Set(mismatched)].join("/")} is not protocol ${expected.protocol} (verified against ${expected.version}). Field-level failures may be version drift, not missing data: re-read the contract with \`herdr --skill\` and prefer herdr_cli.`,
		};
	}

	return report;
}

export interface AgentSequences {
	stateChangeSeq: number | null;
	completionSeq: number;
}

export function sequencesOf(view: AgentView): AgentSequences {
	return { stateChangeSeq: view.stateChangeSeq, completionSeq: view.completionSeq };
}

/**
 * `agent prompt` without `--wait` returns as soon as the text and Enter are
 * written, which does not prove the agent started a turn. Growth after a short
 * delay is the evidence; `null` means there was nothing comparable to read.
 */
export function startObserved(before: AgentSequences, after: AgentSequences | null): boolean | null {
	if (!after) return null;
	if (before.stateChangeSeq !== null && after.stateChangeSeq !== null) {
		return after.stateChangeSeq > before.stateChangeSeq;
	}
	return after.completionSeq > before.completionSeq;
}
