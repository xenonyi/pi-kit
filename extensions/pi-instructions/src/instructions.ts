import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

interface ContextFile {
	path: string;
	content: string;
}

const instructionsPath = fileURLToPath(new URL("../../../instructions/AGENTS.md", import.meta.url));

export async function readInstructions(): Promise<ContextFile> {
	return { path: instructionsPath, content: await readFile(instructionsPath, "utf8") };
}

function normalizeContent(content: string): string {
	return content.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function injectInstructions(contextFiles: ContextFile[], instructions: ContextFile): void {
	const content = normalizeContent(instructions.content);
	if (!content || contextFiles.some((file) => `\n${normalizeContent(file.content)}\n`.includes(`\n${content}\n`))) {
		return;
	}

	// Shared defaults precede, rather than replace, personal and project instructions.
	contextFiles.unshift(instructions);
}
