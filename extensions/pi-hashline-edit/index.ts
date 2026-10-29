import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatRead, readSnapshot } from "./src/reader.ts";
import { hashEditRenderers, hashReadRenderers } from "./src/renderers.ts";
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

		...hashReadRenderers,
	});

	const spliceProperties = {
		anchor: Type.String({ pattern: "^(BOF|EOF|[1-9][0-9]*#[0-9a-fA-F]{4})$", description: "Copy LINE#HHHH, e.g. 12#A83F, without :content, from the original revision. Use BOF/EOF for start/end insertion, including empty files." }),
		deleteCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Count of original lines to remove starting at the anchor, not an ending line number. 0 inserts before it; BOF/EOF require 0." }),
		lines: Type.Array(Type.String(), { description: "One literal string per line, preserving indentation. No embedded CR/LF or copied hashline prefixes; [] inserts nothing." }),
	};
	pi.registerTool({
		name: "hash_edit",
		label: "hash_edit",
		description:
			"Apply revision-checked line splices atomically to one existing UTF-8 file. Provide a non-empty edits[] array, including for a single edit. " +
			"All anchors and ranges refer to the same original revision; input order does not matter. Replace/delete from LINE#HHHH, insert before it, or insert at BOF/EOF. " +
			"Requires the complete current sha256: revision copied from hash_read or a successful hash_edit result. " +
			"Rejects stale revisions, mismatched anchors, invalid ranges, overlaps and equal start positions before writing, without fuzzy matching. " +
			"Preserves BOM and newline convention; returns only the final revision, edit/line totals and up to 20 current hashline rows near the earliest edit.",
		promptSnippet: "Preferred editor for supported text: revision-checked atomic single-file line edits",
		promptGuidelines: [
			"Prefer hash_edit over edit or shell-based edits for supported existing UTF-8 text files. Use write only for new files or complete rewrites.",
			"When editing multiple locations in one file, use one edits[] batch. Copy every anchor from the same original revision; do not adjust later line numbers for earlier edits.",
			"Do not include overlapping deletions, insertion points inside deletions, or edits with the same start position (including BOF and line 1). Adjacent non-overlapping edits are allowed.",
			"Run separate hash_edit calls to the same file sequentially. After a change, discard old revisions and anchors; use the new revision and preview anchors, or hash_read for ranges not shown in the preview.",
			"On STALE_FILE or ANCHOR_MISMATCH, use hash_read and rebuild the edit from current contents; do not retry unchanged input or bypass validation with another editing tool.",
		],
		parameters: Type.Object({
			path: Path,
			revision: Type.String({ pattern: "^sha256:[0-9a-f]{64}$", description: "Complete current sha256: revision for all edits, copied verbatim from hash_read or the latest successful hash_edit for this file." }),
			edits: Type.Array(Type.Object(spliceProperties), { minItems: 1, description: "Atomic single-file batch; use one entry for a single edit. Every edit uses the original revision's anchors and ranges, in any order. Any invalid or conflicting edit rejects the entire batch without writing." }),
		}, { additionalProperties: false, description: "Requires path, revision and non-empty edits[]." }),
		outputSchema: Type.Object({
			...ViewProperties,
			changed: Type.Boolean(),
			firstChangedLine: Type.Integer({ description: "Earliest splice start in the original snapshot (1-based). The final preview offset is clamped to the resulting file." }),
			editCount: Type.Integer({ minimum: 1, description: "Number of validated entries in edits[]." }),
			deletedLines: Type.Integer({ description: "Sum of requested deleteCount values, including unchanged replacements." }),
			insertedLines: Type.Integer({ description: "Sum of supplied lines lengths, including unchanged replacements." }),
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
				editCount: result.editCount,
				deletedLines: result.deletedLines,
				insertedLines: result.insertedLines,
			};
			const text = `${result.changed ? "Edited" : "Unchanged"}: ${params.path}\n` +
				`Edits: ${view.editCount}; deleted lines: ${view.deletedLines}; inserted lines: ${view.insertedLines}\n${view.text}`;
			return { content: [{ type: "text", text }], details: view, structuredContent: { ...view, text } };
		},

		...hashEditRenderers,
	});
}
