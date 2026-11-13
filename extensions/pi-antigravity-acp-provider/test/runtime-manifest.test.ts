import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
	archiveNameMatchesVersion,
	BUNDLED_RUNTIME_MANIFEST,
	compareRuntimeVersions,
	latestManifestRelease,
	parseTrustedRuntimeManifest,
	readBundledRuntimeManifest,
	validateGoogleArchiveUrl,
} from "../src/acp/runtime-manifest.js";
import { selectApprovedRelease } from "../src/acp/setup.js";

describe("signed Antigravity runtime manifest", () => {
	it("verifies the bundled signature and selects the newest release", () => {
		const manifest = readBundledRuntimeManifest();
		const latest = latestManifestRelease(manifest);
		for (const release of manifest.releases) {
			expect(compareRuntimeVersions(latest.version, release.version)).toBeGreaterThanOrEqual(0);
		}
		expect(latest.platforms["linux-x86_64"]).toMatchObject({
			archiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
			binaryName: "agy_acp_server.par",
			harnessName: "localharness_external",
		});
	});

	it("rejects a manifest changed after signing", () => {
		const text = fs.readFileSync(BUNDLED_RUNTIME_MANIFEST, "utf8");
		const tampered = text.replace(/"archiveSha256": "[a-f0-9]{64}"/u, `"archiveSha256": "${"0".repeat(64)}"`);
		expect(tampered).not.toBe(text);
		expect(() => parseTrustedRuntimeManifest(tampered)).toThrow("signature is invalid");
	});

	it("selects only a release approved by the signed manifest", () => {
		const manifest = readBundledRuntimeManifest();
		const latest = latestManifestRelease(manifest).version;
		expect(selectApprovedRelease(manifest, latest)?.version).toBe(latest);
		expect(selectApprovedRelease(manifest, "999.0.0")).toBeUndefined();
	});

	it("compares strict semantic runtime versions", () => {
		expect(compareRuntimeVersions("1.2.0", "1.1.9")).toBe(1);
		expect(compareRuntimeVersions("1.1.1", "1.1.1")).toBe(0);
		expect(compareRuntimeVersions("1.0.9", "1.1.0")).toBe(-1);
		expect(() => compareRuntimeVersions("latest", "1.1.0")).toThrow("Invalid Antigravity ACP version");
	});
});

describe("Google runtime archive URLs", () => {
	const base = "https://dl.google.com/agy-extensions/releases";

	it("accepts every archive naming scheme Google has published", () => {
		expect(() =>
			validateGoogleArchiveUrl(`${base}/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip`, "1.1.1"),
		).not.toThrow();
		expect(() =>
			validateGoogleArchiveUrl(`${base}/macos/agy-acp-server-1.2.1-darwin-arm64.zip`, "1.2.1"),
		).not.toThrow();
		expect(() => validateGoogleArchiveUrl(`${base}/linux/agy_acp_server_1.3.0.zip`, "1.3.0")).not.toThrow();
	});

	it("requires the complete release version in the archive name", () => {
		expect(archiveNameMatchesVersion("agy-acp-server-1.2.10-linux-x86_64.zip", "1.2.1")).toBe(false);
		expect(archiveNameMatchesVersion("agy-acp-server-11.2.1-linux-x86_64.zip", "1.2.1")).toBe(false);
		expect(archiveNameMatchesVersion("agy-acp-server-1.2.1.1-linux-x86_64.zip", "1.2.1")).toBe(false);
		expect(archiveNameMatchesVersion("agy-acp-server-1x2y1-linux-x86_64.zip", "1.2.1")).toBe(false);
		expect(() =>
			validateGoogleArchiveUrl(`${base}/linux/agy-acp-server-1.2.0-linux-x86_64.zip`, "1.2.1"),
		).toThrow("version does not match");
	});

	it("rejects archives outside Google's release path", () => {
		for (const url of [
			"http://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.2.1-linux-x86_64.zip",
			"https://dl.google.com.example.com/agy-extensions/releases/linux/agy-acp-server-1.2.1-linux-x86_64.zip",
			"https://dl.google.com/other/agy-acp-server-1.2.1-linux-x86_64.zip",
			"https://user@dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.2.1-linux-x86_64.zip",
			`${base}/linux/agy-acp-server-1.2.1-linux-x86_64.zip?download=1`,
		]) {
			expect(() => validateGoogleArchiveUrl(url, "1.2.1")).toThrow("not a trusted Google release URL");
		}
	});
});
