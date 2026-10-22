import { isUtf8 } from "node:buffer";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileRevision, formatLine, staleFile } from "./anchor.ts";

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_READ_LINES = 2000;
export const MAX_READ_BYTES = 50 * 1024;

export interface TextDocument {
	lines: string[];
	eol: "\n" | "\r\n";
	finalNewline: boolean;
	bom: boolean;
}

export interface FileSnapshot {
	path: string;
	bytes: Buffer;
	revision: string;
	document: TextDocument;
	state: BigIntStats;
}

export interface ReadOptions {
	offset?: number;
	limit?: number;
}

export interface ReadView {
	revision: string;
	text: string;
	totalLines: number;
	offset: number;
	returnedLines: number;
	truncated: boolean;
	nextOffset?: number;
	omittedLongLine?: number;
}

export function assertText(text: string): void {
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
		throw new Error("UNSUPPORTED_TEXT: Binary data and control characters are not supported.");
	}
	if (Buffer.from(text, "utf8").toString("utf8") !== text) {
		throw new Error("UNSUPPORTED_ENCODING: Text must be valid UTF-8 without unpaired surrogates.");
	}
}

export function decodeText(bytes: Buffer): TextDocument {
	if (bytes.length > MAX_FILE_BYTES) {
		throw new Error("FILE_TOO_LARGE: hashline files must not exceed 16 MiB.");
	}
	if (!isUtf8(bytes)) {
		throw new Error("UNSUPPORTED_ENCODING: Only UTF-8 (with or without BOM) is supported.");
	}
	let text = bytes.toString("utf8");
	const bom = text.startsWith("\uFEFF");
	if (bom) text = text.slice(1);
	assertText(text);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const unpaired = text.replaceAll("\r\n", "");
	if (unpaired.includes("\r") || (eol === "\r\n" && unpaired.includes("\n"))) {
		throw new Error("UNSUPPORTED_EOL: Mixed LF/CRLF and bare CR line endings are not supported.");
	}
	const finalNewline = text.endsWith("\n");
	const lines = text === "" ? [] : text.split(eol);
	if (finalNewline) lines.pop();
	return { lines, eol, finalNewline, bom };
}

export function encodeText(document: TextDocument): Buffer {
	const text = document.lines.join(document.eol) +
		(document.lines.length > 0 && document.finalNewline ? document.eol : "");
	const bytes = Buffer.from((document.bom ? "\uFEFF" : "") + text, "utf8");
	if (bytes.length > MAX_FILE_BYTES) {
		throw new Error("FILE_TOO_LARGE: hashline files must not exceed 16 MiB.");
	}
	return bytes;
}

// Refuse links at every path component, including Windows directory junctions.
// Do not silently follow a link or break hard-link relationships by renaming.
export async function inspectPath(path: string): Promise<BigIntStats> {
	let target: BigIntStats | undefined;
	for (let current = path; ; current = dirname(current)) {
		const state = await lstat(current, { bigint: true });
		if (state.isSymbolicLink()) {
			throw new Error(`UNSAFE_FILE: Symbolic links and directory junctions are not supported: ${current}`);
		}
		if (current === path) {
			if (!state.isFile() || state.nlink !== 1n) {
				throw new Error(`UNSAFE_FILE: Expected a regular file with exactly one hard link: ${path}`);
			}
			target = state;
		} else if (!state.isDirectory()) {
			throw new Error(`UNSAFE_FILE: Expected a directory: ${current}`);
		}
		if (dirname(current) === current) break;
	}
	return target!;
}

export function sameState(left: BigIntStats, right: BigIntStats): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
		left.mode === right.mode && left.nlink === right.nlink &&
		left.uid === right.uid && left.gid === right.gid &&
		left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

export async function readSnapshot(path: string, signal?: AbortSignal): Promise<FileSnapshot> {
	path = resolve(path);
	signal?.throwIfAborted();
	const before = await inspectPath(path);
	signal?.throwIfAborted();
	if (before.size > BigInt(MAX_FILE_BYTES)) {
		throw new Error("FILE_TOO_LARGE: hashline files must not exceed 16 MiB.");
	}
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
	try {
		signal?.throwIfAborted();
		const opened = await handle.stat({ bigint: true });
		if (!sameState(before, opened)) throw staleFile(path);
		const bytes = await handle.readFile();
		signal?.throwIfAborted();
		const after = await handle.stat({ bigint: true });
		const current = await inspectPath(path);
		signal?.throwIfAborted();
		if (!sameState(before, after) || !sameState(after, current) || BigInt(bytes.length) !== after.size) {
			throw staleFile(path);
		}
		return { path, bytes, revision: fileRevision(bytes), document: decodeText(bytes), state: after };
	} finally {
		await handle.close();
	}
}

export function formatRead(document: TextDocument, revision: string, options: ReadOptions = {}): ReadView {
	const offset = options.offset ?? 1;
	const limit = options.limit ?? MAX_READ_LINES;
	if (!Number.isSafeInteger(offset) || offset < 1 || offset > Math.max(1, document.lines.length)) {
		throw new Error("INVALID_RANGE: offset must be a 1-based line number within the file (1 for an empty file).");
	}
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new Error("INVALID_RANGE: limit must be a positive safe integer.");
	}
	const header = `revision: ${revision}\n` +
		`lines: ${document.lines.length}; eol: ${document.eol === "\r\n" ? "CRLF" : "LF"}; ` +
		`final newline: ${document.finalNewline ? "yes" : "no"}; UTF-8 BOM: ${document.bom ? "yes" : "no"}\n\n`;
	const rows: string[] = [];
	// Reserve enough room for notices so the complete response stays under 50 KiB.
	let usedBytes = Buffer.byteLength(header) + 512;
	let cursor = offset - 1;
	let omittedLongLine: number | undefined;
	const end = Math.min(document.lines.length, cursor + Math.min(limit, MAX_READ_LINES));
	while (cursor < end) {
		const row = formatLine(document.lines[cursor], cursor + 1);
		const size = Buffer.byteLength(row) + 1;
		if (usedBytes + size > MAX_READ_BYTES) {
			if (rows.length === 0) omittedLongLine = ++cursor;
			break;
		}
		rows.push(row);
		usedBytes += size;
		cursor++;
	}
	const nextOffset = cursor < document.lines.length ? cursor + 1 : undefined;
	let text = header + rows.join("\n");
	if (document.lines.length === 0) text += "(empty file; insert at BOF or EOF with deleteCount: 0)";
	if (omittedLongLine !== undefined) {
		text += `[Line ${omittedLongLine} exceeds the output limit. No partial Anchor was emitted; inspect it with the built-in read tool.]`;
	}
	if (nextOffset !== undefined) {
		text += `\n\n[More lines available. Call hash_read with offset: ${nextOffset}.]`;
	}
	return {
		revision, text, totalLines: document.lines.length, offset, returnedLines: rows.length,
		truncated: offset > 1 || nextOffset !== undefined || omittedLongLine !== undefined,
		...(nextOffset === undefined ? {} : { nextOffset }),
		...(omittedLongLine === undefined ? {} : { omittedLongLine }),
	};
}
