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
}

export function applyPatch(document: TextDocument, patch: SplicePatch): PatchResult {
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
	// Avoid spread/splice argument limits on files with many short lines.
	const lines = document.lines.slice(0, index)
		.concat(patch.lines, document.lines.slice(index + patch.deleteCount));
	return { bytes: encodeText({ ...document, lines }), firstChangedLine: index + 1 };
}
