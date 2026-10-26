import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, type FileHandle, open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { assertRevision, fileRevision, staleFile } from "./anchor.ts";
import { applyPatches, type PatchResult, type SplicePatch } from "./patch.ts";
import { decodeText, type FileSnapshot, readSnapshot, sameState, type TextDocument } from "./reader.ts";

export interface EditInput {
	revision: string;
	edits: SplicePatch[];
}

export interface EditResult extends Omit<PatchResult, "bytes"> {
	revision: string;
	document: TextDocument;
	changed: boolean;
}

// A small filesystem boundary also permits deterministic write-failure tests.
export interface WriterOperations {
	open(path: string, flags: string, mode: number): Promise<FileHandle>;
	rename(from: string, to: string): Promise<void>;
	unlink(path: string): Promise<void>;
}

export async function writeSnapshot(
	snapshot: FileSnapshot,
	bytes: Buffer,
	signal?: AbortSignal,
	operations: Partial<WriterOperations> = {},
): Promise<void> {
	const fs = { open, rename, unlink, ...operations };
	signal?.throwIfAborted();
	// Renaming must not be used to bypass an explicitly read-only target.
	await access(snapshot.path, constants.R_OK | constants.W_OK);
	signal?.throwIfAborted();
	const temp = join(dirname(snapshot.path), `.pi-hashline-${randomUUID()}.tmp`);
	let ownedTemp = false;
	let handle: FileHandle | undefined;
	try {
		handle = await fs.open(temp, "wx", 0o600);
		ownedTemp = true;
		signal?.throwIfAborted();
		await handle.writeFile(bytes);
		signal?.throwIfAborted();
		// Keep ordinary permission/executable bits; do not propagate setuid/setgid.
		await handle.chmod(Number(snapshot.state.mode & 0o777n));
		await handle.sync();
		await handle.close();
		handle = undefined;
		signal?.throwIfAborted();
		const current = await readSnapshot(snapshot.path, signal);
		if (!sameState(snapshot.state, current.state) || current.revision !== snapshot.revision) {
			throw staleFile(snapshot.path);
		}
		signal?.throwIfAborted();
		// This is the commit point. Never unlink the original or fall back to an in-place write.
		await fs.rename(temp, snapshot.path);
		ownedTemp = false;
		// Do not turn a completed commit into a reported cancellation.
	} finally {
		try {
			await handle?.close();
		} finally {
			if (ownedTemp) await fs.unlink(temp);
		}
	}
}

function validateEdits(input: EditInput): SplicePatch[] {
	if ("anchor" in input || "deleteCount" in input || "lines" in input) {
		throw new Error("INVALID_PATCH: Top-level anchor/deleteCount/lines are not supported. Put each edit in edits[].");
	}
	if (!Array.isArray(input.edits) || input.edits.length === 0) {
		throw new Error("INVALID_PATCH: edits must be a non-empty array.");
	}
	return input.edits;
}

export async function editFile(path: string, input: EditInput, signal?: AbortSignal): Promise<EditResult> {
	return withFileMutationQueue(resolve(path), async () => {
		signal?.throwIfAborted();
		assertRevision(input.revision);
		const edits = validateEdits(input);
		const snapshot = await readSnapshot(path, signal);
		if (snapshot.revision !== input.revision) throw staleFile(snapshot.path);
		const { bytes, ...summary } = applyPatches(snapshot.document, edits);
		const document = decodeText(bytes);
		const changed = !snapshot.bytes.equals(bytes);
		signal?.throwIfAborted();
		if (changed) await writeSnapshot(snapshot, bytes, signal);
		return { revision: fileRevision(bytes), document, changed, ...summary };
	});
}
