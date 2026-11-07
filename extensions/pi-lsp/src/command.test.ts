import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { commandPathValue, mergeEnvironment, resolveCommandPath, resolveSpawnCommand } from "./command.ts";

void test("native commands and non-Windows platforms keep their argv", () => {
	for (const [command, platform] of [
		["server.exe", "win32"],
		["server.com", "win32"],
		["server.cmd", "linux"],
		["server.bat", "darwin"],
	] as const) {
		const original = { command, args: ['quote"inside', "a&b", ""] };
		assert.equal(resolveSpawnCommand(original, platform), original);
	}
});

void test("batch launch uses ComSpec with verbatim arguments and delayed expansion disabled", () => {
	const command = { command: "C:\\tools\\server.CMD", args: [] };
	const result = resolveSpawnCommand(command, "win32", " C:\\Windows\\System32\\cmd.exe ");
	assert.equal(result.command, "C:\\Windows\\System32\\cmd.exe");
	assert.deepEqual(result.args.slice(0, -1), ["/d", "/s", "/v:off", "/c"]);
	assert.equal(result.windowsVerbatimArguments, true);
	assert.equal(resolveSpawnCommand(command, "win32", "").command, "cmd.exe");
});

void test("Windows command lookup preserves explicit suffixes, PATH, and child cwd", (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-lsp-lookup-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const bin = path.join(root, "bin (test) & 中文 spaces");
	mkdirSync(bin);
	for (const name of ["server", "server.exe", "server.cmd", "server.bat", "server.com", "server.cmd.exe", "tool.v1.cmd"]) {
		writeFileSync(path.join(bin, name), "");
	}
	assert.equal(resolveCommandPath("server", root, "win32", bin), path.join(bin, "server.exe"));
	for (const extension of ["exe", "com", "cmd", "bat"]) {
		const name = `server.${extension}`;
		assert.equal(resolveCommandPath(name, root, "win32", bin), path.join(bin, name));
	}
	rmSync(path.join(bin, "server.exe"));
	assert.equal(resolveCommandPath("server", root, "win32", bin), path.join(bin, "server.cmd"));
	assert.equal(resolveCommandPath("tool.v1", root, "win32", bin), path.join(bin, "tool.v1.cmd"));
	assert.equal(
		resolveCommandPath(path.relative(root, path.join(bin, "server.cmd")), root, "win32", ""),
		path.join(bin, "server.cmd"),
	);
	assert.equal(resolveCommandPath("missing", root, "win32", bin), undefined);
	assert.equal(commandPathValue({ Path: bin }, "win32"), bin);
	const environment = mergeEnvironment({ Path: bin }, "win32");
	assert.deepEqual(Object.keys(environment).filter((key) => key.toLowerCase() === "path"), ["Path"]);
});

void test("Windows batch files preserve literal argv through real processes", { skip: process.platform !== "win32" }, async (t) => {
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-lsp-argv-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const recorder = path.join(root, "argv.mjs");
	writeFileSync(recorder, "console.log(JSON.stringify(process.argv.slice(2)));\n");
	const node = `"${process.execPath}" "${recorder}"`;
	const fixtures = [
		["forward.cmd", `${node} %*`],
		["forward.bat", `${node} %*`],
		["node_modules/.bin/forward.cmd", `${node} %*`],
		["condition.cmd", `if not "%~1"=="--stdio" exit /b 51\r\n${node} %*`],
		["numbered.bat", `${node} %1 %2 %3`],
		["requote-ordinary.CMD", `${node} "%~1" "%~2" "%~3"`],
	];
	const ordinaryCases = [
		["plain", "hello world", "中文参数"],
		["empty", "", "中文 参数"],
		["environment-literals", "%PI_LSP_ARG_SENTINEL%", "!PI_LSP_ARG_SENTINEL!"],
		["caret-and-parentheses", "a^b", "(left right)"],
		["tab-and-punctuation", "a\tb", "[]{};,`*?"],
	];
	const quotedCases = [
		["quote-and-ampersand", 'quote"inside', "a&b"],
		["quote-and-pipe", 'quote"inside', "a|b"],
		["quoted-spaces", 'a" b', 'a"&b'],
		["consecutive-quotes", '"', '""'],
		["backslashes", 'slash\\"quote', "trailing\\"],
		["no-shell-command", 'quote"inside', "a&echo BAD>shell-expanded"],
	];
	for (const [name, body] of fixtures) {
		const shim = path.join(root, "bin (test) & 中文 spaces", name);
		mkdirSync(path.dirname(shim), { recursive: true });
		writeFileSync(shim, `@echo off\r\n${body}\r\n`);
		const cases = name === "requote-ordinary.CMD" ? ordinaryCases : [...ordinaryCases, ...quotedCases];
		for (const [label, first, second] of cases) {
			await t.test(`${name}: ${label}`, () => {
				const args = ["--stdio", first, second];
				const command = resolveSpawnCommand({ command: shim, args });
				const result = spawnSync(command.command, command.args, {
					cwd: root,
					env: { ...process.env, PI_LSP_ARG_SENTINEL: "must-not-expand" },
					encoding: "utf8",
					windowsVerbatimArguments: command.windowsVerbatimArguments,
					timeout: 5000,
				});
				assert.ifError(result.error);
				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(JSON.parse(result.stdout.trim()), args);
				assert.equal(existsSync(path.join(root, "shell-expanded")), false);
			});
		}
	}
});

void test("Windows batch files preserve native Ruff configuration argv", { skip: process.platform !== "win32" }, async (t) => {
	const ruff = resolveCommandPath("ruff");
	if (!ruff) {
		t.skip("Ruff is not installed");
		return;
	}
	const root = mkdtempSync(path.join(os.tmpdir(), "pi-lsp-native-argv-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const bin = path.join(root, "bin (test) & 中文 spaces");
	mkdirSync(bin);
	const file = path.join(root, "sample.py");
	writeFileSync(file, "import os\n");
	const args = [
		"check", "--isolated", "--output-format=json",
		"--config", 'lint.select = ["F401"]',
		"--exclude", "never&match.py",
		file,
	];
	for (const extension of ["cmd", "bat"]) {
		await t.test(extension, () => {
			const shim = path.join(bin, `ruff.${extension}`);
			writeFileSync(shim, `@echo off\r\n"${ruff}" %*\r\n`);
			const command = resolveSpawnCommand({ command: shim, args });
			const result = spawnSync(command.command, command.args, {
				cwd: root,
				encoding: "utf8",
				windowsVerbatimArguments: command.windowsVerbatimArguments,
				timeout: 5000,
			});
			assert.ifError(result.error);
			assert.equal(result.status, 1, result.stderr);
			const diagnostics = JSON.parse(result.stdout);
			assert.equal(diagnostics.length, 1);
			assert.equal(diagnostics[0].code, "F401");
		});
	}
});
