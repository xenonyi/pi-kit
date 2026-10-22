import { lineHash, parseAnchor } from "./anchor.ts";
import { assertText, encodeText, type TextDocument } from "./reader.ts";

export interface SplicePatch {
	anchor: string;
	deleteCount: number;
	lines: string[];
}

export interface PatchResult {
	bytes: Buffer;
	firstChangedLine: number;
	editCount: number;
	deletedLines: number;
	insertedLines: number;
}

interface ResolvedPatch {
	index: number;
	deleteCount: number;
	lines: string[];
	inputIndex: number;
}

function resolvePatch(document: TextDocument, patch: SplicePatch, inputIndex: number): ResolvedPatch {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		throw new Error("INVALID_PATCH: Each edit must be an object.");
	}
	if (!Number.isSafeInteger(patch.deleteCount) || patch.deleteCount < 0) {
		throw new Error("INVALID_PATCH: deleteCount must be a non-negative safe integer.");
	}
	if (!Array.isArray(patch.lines)) throw new Error("INVALID_PATCH: lines must be an array of strings.");
	for (const line of patch.lines) {
		if (typeof line !== "string" || /[\r\n]/.test(line)) {
			throw new Error("INVALID_PATCH: Each lines entry must be one string without CR or LF.");
		}
		assertText(line);
	}
	const anchor = parseAnchor(patch.anchor);
	let index: number;
	if (anchor.kind === "line") {
		index = anchor.lineNumber - 1;
		if (index >= document.lines.length || lineHash(document.lines[index]) !== anchor.hash) {
			throw new Error("ANCHOR_MISMATCH: Line number or hash does not match. Read the file again with hash_read.");
		}
	} else {
		if (patch.deleteCount !== 0) {
			throw new Error("INVALID_PATCH: BOF and EOF are insertion-only (deleteCount must be 0).");
		}
		index = anchor.kind === "bof" ? 0 : document.lines.length;
	}
	if (patch.deleteCount > document.lines.length - index) {
		throw new Error("INVALID_PATCH: deleteCount extends past the end of the file.");
	}
	return { index, deleteCount: patch.deleteCount, lines: patch.lines, inputIndex };
}

export function applyPatches(document: TextDocument, patches: SplicePatch[]): PatchResult {
	if (!Array.isArray(patches) || patches.length === 0) {
		throw new Error("INVALID_PATCH: edits must be a non-empty array.");
	}
	// Resolve every anchor against the original snapshot, retaining caller indices for errors.
	const resolved = Array.from(patches, (patch, inputIndex) => {
		try {
			return resolvePatch(document, patch, inputIndex);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const separator = message.indexOf(":");
			const indexedMessage = separator < 0
				? `INVALID_PATCH: edits[${inputIndex}]: ${message}`
				: `${message.slice(0, separator + 1)} edits[${inputIndex}]:${message.slice(separator + 1)}`;
			throw new Error(indexedMessage, { cause: error });
		}
	});
	resolved.sort((left, right) => left.index - right.index);
	for (let i = 1; i < resolved.length; i++) {
		const previous = resolved[i - 1];
		const current = resolved[i];
		if (current.index === previous.index) {
			throw new Error(`CONFLICTING_EDITS: edits[${previous.inputIndex}] and edits[${current.inputIndex}] start at the same position. Merge them into one edit.`);
		}
		if (current.index < previous.index + previous.deleteCount) {
			throw new Error(`CONFLICTING_EDITS: edits[${current.inputIndex}] starts inside the deletion range of edits[${previous.inputIndex}]. Merge overlapping edits.`);
		}
	}

	// All edits are valid and disjoint. Build once without spread/splice argument limits.
	const lines: string[] = [];
	let cursor = 0;
	let deletedLines = 0;
	let insertedLines = 0;
	for (const patch of resolved) {
		while (cursor < patch.index) lines.push(document.lines[cursor++]);
		for (const line of patch.lines) lines.push(line);
		cursor = patch.index + patch.deleteCount;
		deletedLines += patch.deleteCount;
		insertedLines += patch.lines.length;
	}
	while (cursor < document.lines.length) lines.push(document.lines[cursor++]);
	return {
		bytes: encodeText({ ...document, lines }),
		firstChangedLine: resolved[0].index + 1,
		editCount: resolved.length,
		deletedLines,
		insertedLines,
	};
}

export function applyPatch(document: TextDocument, patch: SplicePatch): PatchResult {
	return applyPatches(document, [patch]);
}
