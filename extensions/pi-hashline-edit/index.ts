import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";
import { formatRead, readSnapshot } from "./src/reader.ts";
import { editFile } from "./src/writer.ts";

const Path = Type.String({ minLength: 1, description: "Existing file path, absolute or relative to the working directory." });
const PositiveInteger = { minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const ViewProperties = {
	path: Type.String(),
	revision: Type.String(),
	text: Type.String({ description: "Bounded LINE#HHHH:content rows and notices, with the full-file revision." }),
	totalLines: Type.Integer(),
	offset: Type.Integer(),
	returnedLines: Type.Integer(),
	truncated: Type.Boolean(),
	nextOffset: Type.Optional(Type.Integer()),
	omittedLongLine: Type.Optional(Type.Integer()),
};

export default function hashlineEdit(pi: ExtensionAPI) {
	pi.registerTool({
		name: "hash_read",
		label: "hash_read",
		description:
			"Read an existing UTF-8 file as LINE#HHHH:content (1-based line number, four hex hash digits). " +
			"Returns the full-file sha256: revision even for partial reads. Up to 2000 complete lines / 50 KiB; continue with nextOffset. " +
			"Oversized lines are omitted, never partially anchored. Files must be <=16 MiB with uniform LF or CRLF; binary data and links are refused. Use read for images.",
		promptSnippet: "Preferred reader for supported text: line anchors and a full-file revision",
		promptGuidelines: [
			"Prefer hash_read over read for supported existing UTF-8 text files. Use read for images and unsupported formats.",
			"Before hash_edit, inspect the affected range. Copy the full revision and any line anchor from hash_read or hash_edit output for that file version; never invent them.",
		],
		parameters: Type.Object({
			path: Path,
			offset: Type.Optional(Type.Integer({ ...PositiveInteger, description: "1-based first line; default 1, also for an empty file." })),
			limit: Type.Optional(Type.Integer({ ...PositiveInteger, description: "Maximum complete lines (default/cap: 2000); the byte limit may return fewer." })),
		}),
		outputSchema: Type.Object(ViewProperties),
		annotations: { readOnlyHint: true, openWorldHint: false },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolve(ctx.cwd, params.path);
			const snapshot = await readSnapshot(path, signal);
			const view = { path, ...formatRead(snapshot.document, snapshot.revision, params) };
			return { content: [{ type: "text", text: view.text }], details: view, structuredContent: view };
		},
	});

	pi.registerTool({
		name: "hash_edit",
		label: "hash_edit",
		description:
			"Apply one revision-checked line splice to an existing UTF-8 file. Replace/delete from LINE#HHHH, insert before it, or insert at BOF/EOF. " +
			"Requires the complete current sha256: revision copied from hash_read or a successful hash_edit result. " +
			"Preserves BOM and newline convention; returns a new revision and up to 20 current hashline rows. " +
			"Rejects stale revisions, mismatched anchors and invalid ranges without fuzzy matching.",
		promptSnippet: "Preferred editor for supported text: revision-checked line insert/replace/delete",
		promptGuidelines: [
			"Prefer hash_edit over edit or shell-based edits for supported existing UTF-8 text files. Use write only for new files or complete rewrites.",
			"Run edits to the same file sequentially. After a change, discard the old revision and anchors; use the new revision and preview anchors, or hash_read the next target if needed.",
			"On STALE_FILE or ANCHOR_MISMATCH, use hash_read and rebuild the edit from current contents; do not retry unchanged input or bypass validation with another editing tool.",
		],
		parameters: Type.Object({
			path: Path,
			revision: Type.String({ pattern: "^sha256:[0-9a-f]{64}$", description: "Complete current sha256: revision, copied verbatim from hash_read or the latest successful hash_edit for this file." }),
			anchor: Type.String({ pattern: "^(BOF|EOF|[1-9][0-9]*#[0-9a-fA-F]{4})$", description: "Copy LINE#HHHH, e.g. 12#A83F, without :content. Use BOF/EOF for start/end insertion, including empty files." }),
			deleteCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Count of lines to remove starting at the anchor, not an ending line number. 0 inserts before it; BOF/EOF require 0." }),
			lines: Type.Array(Type.String(), { description: "One literal string per line, preserving indentation. No embedded CR/LF or copied hashline prefixes; [] inserts nothing." }),
		}),
		outputSchema: Type.Object({
			...ViewProperties,
			changed: Type.Boolean(),
			firstChangedLine: Type.Integer(),
			deletedLines: Type.Integer(),
			insertedLines: Type.Integer(),
		}),
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const path = resolve(ctx.cwd, params.path);
			const result = await editFile(path, params, signal);
			const offset = Math.min(result.firstChangedLine, Math.max(1, result.document.lines.length));
			const view = {
				path,
				...formatRead(result.document, result.revision, { offset, limit: 20 }),
				changed: result.changed,
				firstChangedLine: result.firstChangedLine,
				deletedLines: params.deleteCount,
				insertedLines: params.lines.length,
			};
			const text = `${result.changed ? "Edited" : "Unchanged"}: ${params.path}\n${view.text}`;
			return { content: [{ type: "text", text }], details: view, structuredContent: { ...view, text } };
		},
	});
}
