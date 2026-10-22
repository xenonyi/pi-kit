import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { assertRevision, fileRevision, staleFile } from "./anchor.ts";
import { applyPatch, type SplicePatch } from "./patch.ts";
import { decodeText, readSnapshot, sameState, type FileSnapshot, type TextDocument } from "./reader.ts";

export interface EditInput extends SplicePatch {
	revision: string;
}

export interface EditResult {
	revision: string;
	document: TextDocument;
	changed: boolean;
	firstChangedLine: number;
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

export async function editFile(path: string, input: EditInput, signal?: AbortSignal): Promise<EditResult> {
	assertRevision(input.revision);
	return withFileMutationQueue(resolve(path), async () => {
		signal?.throwIfAborted();
		const snapshot = await readSnapshot(path, signal);
		if (snapshot.revision !== input.revision) throw staleFile(snapshot.path);
		const patch = applyPatch(snapshot.document, input);
		const document = decodeText(patch.bytes);
		const changed = !snapshot.bytes.equals(patch.bytes);
		if (changed) await writeSnapshot(snapshot, patch.bytes, signal);
		return { revision: fileRevision(patch.bytes), document, changed, firstChangedLine: patch.firstChangedLine };
	});
}
