import { createHash } from "node:crypto";

export const LINE_HASH_LENGTH = 4;

export function fileRevision(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function lineHash(line: string): string {
	return createHash("sha256").update(line, "utf8").digest("hex").slice(0, LINE_HASH_LENGTH).toUpperCase();
}

export function formatLine(line: string, lineNumber: number): string {
	return `${lineNumber}#${lineHash(line)}:${line}`;
}

export type Anchor =
	| { kind: "bof" | "eof" }
	| { kind: "line"; lineNumber: number; hash: string };

export function parseAnchor(value: string): Anchor {
	if (value === "BOF") return { kind: "bof" };
	if (value === "EOF") return { kind: "eof" };
	const match = typeof value === "string" ? /^([1-9]\d*)#([0-9a-fA-F]{4})$/.exec(value) : null;
	if (!match || !Number.isSafeInteger(Number(match[1]))) {
		throw new Error("INVALID_ANCHOR: Expected LINE#HASH (four hex characters), BOF, or EOF.");
	}
	return { kind: "line", lineNumber: Number(match[1]), hash: match[2].toUpperCase() };
}

export function assertRevision(value: string): void {
	if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
		throw new Error("INVALID_REVISION: Copy the complete sha256: revision returned by hash_read.");
	}
}

export function staleFile(path: string): Error {
	return new Error(`STALE_FILE: ${path} has changed. Read the file again with hash_read before editing.`);
}
