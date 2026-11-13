import { describe, expect, it } from "vitest";

import { redact } from "../src/acp/errors.js";

describe("diagnostic redaction", () => {
	it("removes proxy URL credentials and Basic authorization values", () => {
		const output = redact("HTTPS_PROXY=http://user:proxy-password@proxy.test:8080\nProxy-Authorization: Basic dXNlcjpwYXNzd29yZA==");
		expect(output).toContain("http://<redacted>@proxy.test:8080");
		expect(output).not.toContain("proxy-password");
		expect(output).not.toContain("dXNlcjpwYXNzd29yZA==");
	});
	it("removes common API key, OAuth, header, and cookie secrets", () => {
		const input = [
			"AIza1234567890abcdef",
			"refresh_token=1//abcdefghijklmnopqrstuvwxyz",
			'\"access_token\":\"ya29.abcdefghijklmnopqrstuvwxyz\"',
			"Authorization: Bearer header-secret-value",
			"Cookie: session=secret-value",
		].join("\n");
		const output = redact(input);
		expect(output).not.toContain("1234567890abcdef");
		expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz");
		expect(output).not.toContain("header-secret-value");
		expect(output).not.toContain("session=secret-value");
		expect(output.match(/<redacted>/gu)?.length).toBeGreaterThanOrEqual(5);
	});
});
