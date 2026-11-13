import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isAgyCli, resolveAntigravityAcpLaunch } from "../src/acp/antigravity.js";
import {
	ensureAntigravityAcpReady,
	inspectRuntimeSetup,
	readAgyVersionSync,
	updateAntigravityAcpRuntime,
} from "../src/acp/setup.js";

const directories: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function temporaryDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-setup-"));
	directories.push(directory);
	return directory;
}

function writeFakeAgy(directory: string, scriptBody: string, name = "agy"): string {
	const binary = path.join(directory, name);
	fs.writeFileSync(binary, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
	return binary;
}

describe("isAgyCli and launch resolution", () => {
	it("recognizes agy binaries across platforms", () => {
		expect(isAgyCli("agy")).toBe(true);
		expect(isAgyCli("/usr/local/bin/agy")).toBe(true);
		expect(isAgyCli("agy.exe")).toBe(true);
		expect(isAgyCli("/tmp/external-agent")).toBe(false);
	});

	it("passes acp subcommand and optional yolo flag only to agy binaries", () => {
		const dir = temporaryDirectory();
		const agyBin = writeFakeAgy(dir, "exit 0");
		vi.stubEnv("AGY_ACP_BIN", agyBin);
		expect(resolveAntigravityAcpLaunch()).toEqual({ command: agyBin, args: ["acp"], source: "env" });
		expect(resolveAntigravityAcpLaunch({ dangerSkipPermissions: true })).toEqual({
			command: agyBin,
			args: ["acp", "--dangerously-skip-permissions"],
			source: "env",
		});

		const wrapper = writeFakeAgy(dir, "exit 0", "custom-wrapper");
		vi.stubEnv("AGY_ACP_BIN", wrapper);
		expect(resolveAntigravityAcpLaunch({ dangerSkipPermissions: true })).toEqual({
			command: wrapper,
			args: [],
			source: "env",
		});
	});

	it("resolves ~/.local/bin/agy and PATH agy, failing cleanly when absent", () => {
		const fakeHome = temporaryDirectory();
		vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
		vi.stubEnv("AGY_ACP_BIN", "");
		vi.stubEnv("PATH", "");
		expect(() => resolveAntigravityAcpLaunch()).toThrow("Google Antigravity CLI (agy) is not installed");

		const pathDir = temporaryDirectory();
		const pathAgy = writeFakeAgy(pathDir, "exit 0");
		vi.stubEnv("PATH", pathDir);
		expect(resolveAntigravityAcpLaunch()).toEqual({ command: pathAgy, args: ["acp"], source: "path" });

		const localBin = path.join(fakeHome, ".local", "bin");
		fs.mkdirSync(localBin, { recursive: true });
		const userAgy = writeFakeAgy(localBin, "exit 0");
		expect(resolveAntigravityAcpLaunch()).toEqual({ command: userAgy, args: ["acp"], source: "user-bin" });
	});
});

describe("external runtime ownership and native agy updates", () => {
	it("refuses explicit updates for non-agy AGY_ACP_BIN wrappers", async () => {
		const binary = path.join(temporaryDirectory(), "external-agent");
		fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		vi.stubEnv("AGY_ACP_BIN", binary);
		await expect(updateAntigravityAcpRuntime()).rejects.toThrow("externally managed");
	});

	it.skipIf(process.platform === "win32")("inspects version, ensures ready, and updates via agy update", async () => {
		const dir = temporaryDirectory();
		const versionFile = path.join(dir, "version.txt");
		fs.writeFileSync(versionFile, "1.5.7");
		const agyBin = writeFakeAgy(
			dir,
			`if [ "$1" = "--version" ]; then echo "agy version $(cat "${versionFile}")"; exit 0; fi
if [ "$1" = "update" ]; then echo "1.5.8" > "${versionFile}"; echo "Updated to 1.5.8"; exit 0; fi
exit 1`,
		);
		vi.stubEnv("AGY_ACP_BIN", agyBin);

		expect(readAgyVersionSync(agyBin)).toBe("1.5.7");
		expect(inspectRuntimeSetup()).toMatchObject({
			installed: true,
			installedVersion: "1.5.7",
			launch: { command: agyBin, args: ["acp"], source: "env" },
		});

		const messages: string[] = [];
		await ensureAntigravityAcpReady((msg) => messages.push(msg));
		expect(messages[0]).toContain(agyBin);

		const updated = await updateAntigravityAcpRuntime();
		expect(updated).toEqual({ version: "1.5.8", changed: true, binary: agyBin });

		const agyAlready = writeFakeAgy(
			dir,
			`if [ "$1" = "--version" ]; then echo "1.5.8"; exit 0; fi
if [ "$1" = "update" ]; then echo "Already up to date"; exit 0; fi
exit 1`,
		);
		vi.stubEnv("AGY_ACP_BIN", agyAlready);
		expect(await updateAntigravityAcpRuntime()).toEqual({ version: "1.5.8", changed: false, binary: agyAlready });
	});
});
