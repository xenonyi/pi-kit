import { VERSION } from "@earendil-works/pi-coding-agent";

/**
 * The pi line the prototype patches were written against.
 *
 * `ToolExecutionComponent` and `AssistantMessageComponent` internals are not a
 * public API: a minor bump can rename a field or reshape the card without any
 * type error, because every access here goes through a local interface. The
 * renderers therefore compare this line against `VERSION` when a session
 * starts, so an untested pi is reported instead of quietly drawing something
 * wrong.
 */
export const TESTED_MAJOR = 1;
export const TESTED_MINOR = 4;

/** `1.4.x`, for messages. */
export const TESTED_LINE = `${TESTED_MAJOR}.${TESTED_MINOR}.x`;

export interface PiVersion {
	/** The version string pi reports. */
	raw: string;
	/** Parsed parts, or undefined when `raw` is not a version string. */
	parts?: { major: number; minor: number; patch: number };
	/** Whether the tested line is this pi's major.minor. */
	supported: boolean;
}

export function checkPiVersion(): PiVersion {
	const raw = typeof VERSION === "string" && VERSION.length > 0 ? VERSION : "unknown";
	const parts = parseVersion(raw);
	return {
		raw,
		parts,
		supported: parts !== undefined && parts.major === TESTED_MAJOR && parts.minor === TESTED_MINOR,
	};
}

function parseVersion(raw: string): PiVersion["parts"] {
	const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
	if (!match) return undefined;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = match[3] === undefined ? 0 : Number(match[3]);
	if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return undefined;
	return { major, minor, patch };
}
