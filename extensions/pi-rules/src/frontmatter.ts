/**
 * Minimal YAML subset parser for fragment frontmatter.
 *
 * Supported: nested mappings, block sequences, flow arrays, quoted strings,
 * numbers, booleans, null, full-line comments, and trailing comments outside
 * quotes. Anything else (block scalars, anchors, aliases, tags, multi-line flow
 * collections) is rejected with its line number instead of being guessed at.
 */

export class FrontmatterError extends Error {
	readonly line: number;

	constructor(message: string, line: number) {
		super(`${message} (frontmatter line ${line})`);
		this.name = "FrontmatterError";
		this.line = line;
	}
}

export interface ParsedDocument {
	data: Record<string, unknown>;
	body: string;
}

interface Entry {
	indent: number;
	text: string;
	line: number;
}

interface Cursor {
	index: number;
}

const KEY_PATTERN = /^([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parseDocument(text: string): ParsedDocument {
	const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
	if (lines[0]?.trim() !== "---") return { data: {}, body: lines.join("\n").trim() };

	let end = -1;
	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index]?.trim() === "---") {
			end = index;
			break;
		}
	}
	if (end === -1) throw new FrontmatterError("frontmatter opens with --- but never closes", 1);

	const entries = collectEntries(lines, 1, end);
	if (entries.length > 0 && isSequenceItem(entries[0]?.text ?? "")) {
		throw new FrontmatterError("frontmatter must be a mapping of keys", entries[0]?.line ?? 1);
	}
	const data = entries.length === 0 ? {} : parseMapping(entries, { index: 0 }, entries[0]?.indent ?? 0);
	return { data, body: lines.slice(end + 1).join("\n").trim() };
}

function collectEntries(lines: string[], from: number, to: number): Entry[] {
	const entries: Entry[] = [];
	for (let index = from; index < to; index += 1) {
		const raw = lines[index] ?? "";
		const text = raw.trim();
		if (!text || text.startsWith("#")) continue;
		const indentation = raw.slice(0, raw.length - raw.trimStart().length);
		if (indentation.includes("\t")) throw new FrontmatterError("tabs are not allowed for indentation", index + 1);
		entries.push({ indent: indentation.length, text, line: index + 1 });
	}
	return entries;
}

function parseBlock(entries: Entry[], cursor: Cursor, indent: number): unknown {
	const entry = entries[cursor.index];
	if (!entry) return null;
	return isSequenceItem(entry.text) ? parseSequence(entries, cursor, indent) : parseMapping(entries, cursor, indent);
}

function parseMapping(entries: Entry[], cursor: Cursor, indent: number): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	while (cursor.index < entries.length) {
		const entry = entries[cursor.index];
		if (!entry) break;
		if (entry.indent < indent) break;
		if (entry.indent > indent) throw new FrontmatterError(`unexpected indentation before "${entry.text}"`, entry.line);
		if (isSequenceItem(entry.text)) break;

		const match = KEY_PATTERN.exec(entry.text);
		const key = match?.[1];
		if (!match || key === undefined) {
			throw new FrontmatterError(`expected "key: value" but found "${entry.text}"`, entry.line);
		}
		cursor.index += 1;

		const inline = match[2];
		if (inline !== undefined && inline.trim() !== "") {
			result[key] = parseScalar(inline, entry.line);
			continue;
		}

		const next = entries[cursor.index];
		if (next && next.indent > indent) {
			result[key] = parseBlock(entries, cursor, next.indent);
			continue;
		}
		if (next && next.indent === indent && isSequenceItem(next.text)) {
			result[key] = parseSequence(entries, cursor, indent);
			continue;
		}
		result[key] = null;
	}
	return result;
}

function parseSequence(entries: Entry[], cursor: Cursor, indent: number): unknown[] {
	const result: unknown[] = [];
	while (cursor.index < entries.length) {
		const entry = entries[cursor.index];
		if (!entry) break;
		if (entry.indent < indent) break;
		if (entry.indent > indent) throw new FrontmatterError(`unexpected indentation before "${entry.text}"`, entry.line);
		if (!isSequenceItem(entry.text)) break;

		const rest = entry.text === "-" ? "" : entry.text.slice(2).trim();
		cursor.index += 1;
		if (rest === "") {
			const next = entries[cursor.index];
			result.push(next && next.indent > indent ? parseBlock(entries, cursor, next.indent) : null);
			continue;
		}
		result.push(parseScalar(rest, entry.line));
	}
	return result;
}

function isSequenceItem(text: string): boolean {
	return text === "-" || text.startsWith("- ");
}

function parseScalar(raw: string, line: number): unknown {
	const value = stripComment(raw).trim();
	if (value === "") return null;
	if (value.startsWith("[")) return parseFlowArray(value, line);
	if (value.startsWith("{")) {
		throw new FrontmatterError("flow mappings are not supported; use an indented block", line);
	}
	if (value.startsWith("|") || value.startsWith(">")) {
		throw new FrontmatterError("block scalars are not supported; use a single line", line);
	}
	if (value.startsWith("&") || value.startsWith("*") || value.startsWith("!")) {
		throw new FrontmatterError("anchors, aliases and tags are not supported", line);
	}
	if (isQuoted(value)) return unquote(value, line);
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null" || value === "~") return null;
	if (NUMBER_PATTERN.test(value)) return Number(value);
	return value;
}

function parseFlowArray(value: string, line: number): unknown[] {
	if (!value.endsWith("]")) throw new FrontmatterError("flow arrays must close on the same line", line);
	const inner = value.slice(1, -1).trim();
	if (inner === "") return [];
	return splitFlow(inner, line).map((part) => parseScalar(part, line));
}

function splitFlow(text: string, line: number): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: string | null = null;
	let depth = 0;
	for (const character of text) {
		if (quote) {
			current += character;
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			current += character;
			continue;
		}
		if (character === "[") depth += 1;
		if (character === "]") depth -= 1;
		if (character === "," && depth === 0) {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += character;
	}
	if (quote) throw new FrontmatterError("unterminated quoted string", line);
	parts.push(current.trim());
	return parts;
}

function stripComment(raw: string): string {
	let quote: string | null = null;
	for (let index = 0; index < raw.length; index += 1) {
		const character = raw[index];
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === "#" && (index === 0 || raw[index - 1] === " ")) return raw.slice(0, index);
	}
	return raw;
}

function isQuoted(value: string): boolean {
	return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
}

function unquote(value: string, line: number): string {
	if (!isQuoted(value)) throw new FrontmatterError(`unbalanced quotes in "${value}"`, line);
	const inner = value.slice(1, -1);
	if (value.startsWith("'")) return inner.replace(/''/g, "'");
	return inner.replace(/\\(["\\nt])/g, (_match, escape: string) => {
		if (escape === "n") return "\n";
		if (escape === "t") return "\t";
		return escape;
	});
}
