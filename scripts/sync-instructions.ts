import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../instructions/AGENTS.md", import.meta.url));
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const target = join(agentDir, "AGENTS.md");
const override = join(agentDir, "AGENTS.override.md");
const checkOnly = process.argv.includes("--check");

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

async function readIfExists(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

const desired = normalize(await readFile(source, "utf8"));
const current = await readIfExists(target);

if (current !== undefined && normalize(current) === desired) {
	console.log(`instructions up to date: ${target}`);
	process.exit(0);
}

if (checkOnly) {
	console.error(`${current === undefined ? "missing" : "out of sync"}: ${target}`);
	console.error("run: pnpm sync:instructions");
	process.exit(1);
}

await mkdir(agentDir, { recursive: true });
await writeFile(target, desired, "utf8");
console.log(`${current === undefined ? "created" : "updated"}: ${target}`);

// An override file in the same directory replaces AGENTS.md instead of merging with it.
if ((await readIfExists(override)) !== undefined) {
	console.warn(`warning: ${override} exists and shadows the instructions just written`);
}
