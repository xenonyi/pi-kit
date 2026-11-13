import { describe, expect, it, vi } from "vitest";
import { applyAcpProxyEnvironment } from "../src/acp/proxy.js";
import { applyDefaultTlsEnvironment } from "../src/acp/process.js";

const system = "HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897\nSOCKSEnable : 1\nSOCKSProxy : 127.0.0.1\nSOCKSPort : 7897";
describe("child-only ACP proxy environment", () => {
	it("uses macOS HTTP proxy settings instead of unsupported automatic SOCKS", () => {
		const source = { NO_PROXY: " example.com, ", no_proxy: "internal,example.com" };
		const result = applyAcpProxyEnvironment(source, "darwin", () => system);
		expect(result.HTTPS_PROXY).toBe("http://127.0.0.1:7897/");
		expect(result.ALL_PROXY).toBe(result.HTTPS_PROXY);
		expect(result.NO_PROXY).toBe("example.com,internal,localhost,127.0.0.1,::1");
		expect(result.no_proxy).toBe(result.NO_PROXY);
		expect(source).toEqual({ NO_PROXY: " example.com, ", no_proxy: "internal,example.com" });
	});

	it("preserves explicit mixed proxies, credentials and certificate overrides", () => {
		const probe = vi.fn(() => system);
		const source = { https_proxy: "http://proxy:8080", ALL_PROXY: "socks5://user:pass@proxy:1080", SSL_CERT_FILE: "/custom/ca", NODE: "/custom/node", GEMINI_API_KEY: "fixture" };
		const result = applyDefaultTlsEnvironment(applyAcpProxyEnvironment(source, "darwin", probe));
		expect(result).toMatchObject(source);
		expect(probe).not.toHaveBeenCalled();
	});

	it("accepts an explicit HTTP override without mutating its input", () => {
		const source = { PI_ANTIGRAVITY_ACP_PROXY: "http://user:pass@proxy:1234", ALL_PROXY: "socks5://old:1" };
		expect(applyAcpProxyEnvironment(source, "linux").ALL_PROXY).toBe(source.PI_ANTIGRAVITY_ACP_PROXY);
		expect(source.ALL_PROXY).toBe("socks5://old:1");
	});

	it.each(["socks5://secret:password@proxy:1234", "secret:password@broken"])("rejects unsupported overrides without exposing credentials", (proxy) => {
		let error: unknown;
		try { applyAcpProxyEnvironment({ PI_ANTIGRAVITY_ACP_PROXY: proxy }, "linux"); } catch (cause) { error = cause; }
		expect(error).toBeInstanceOf(Error);
		expect(String(error)).not.toContain("password");
		expect(String(error)).toContain("HTTP or HTTPS");
	});

	it("does not reinterpret a SOCKS-only system proxy", () => {
		const result = applyAcpProxyEnvironment({}, "darwin", () => "SOCKSEnable : 1\nSOCKSProxy : localhost\nSOCKSPort : 1234");
		expect(result.HTTP_PROXY).toBeUndefined();
		expect(result.NO_PROXY).toContain("127.0.0.1");
	});

	it("falls back to HTTP when enabled HTTPS settings are incomplete", () => {
		expect(applyAcpProxyEnvironment({}, "darwin", () => "HTTPSEnable : 1\nHTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 1234").HTTP_PROXY).toBe("http://localhost:1234/");
	});

	it("handles IPv6 system proxy hosts", () => {
		expect(applyAcpProxyEnvironment({}, "darwin", () => "HTTPEnable : 1\nHTTPProxy : ::1\nHTTPPort : 1234").HTTP_PROXY).toBe("http://[::1]:1234/");
	});

	it("survives probe failure and always exempts the local bridge", () => {
		expect(applyAcpProxyEnvironment({}, "darwin", () => { throw new Error("unavailable"); }).NO_PROXY).toBe("localhost,127.0.0.1,::1");
		expect(applyAcpProxyEnvironment({ NO_PROXY: "*" }, "linux").NO_PROXY).toContain("*");
	});
});
