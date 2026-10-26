import { readFile } from "node:fs/promises";
import type { ExtensionAPI, McpServerConfig } from "@earendil-works/pi-coding-agent";

interface Registration {
	name: string;
	config: McpServerConfig;
}

type Environment = Record<string, string | undefined>;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readCatalog(): Promise<unknown> {
	return JSON.parse(await readFile(new URL("../servers.json", import.meta.url), "utf8"));
}

export function prepareServers(catalog: unknown, env: Environment): Registration[] {
	if (!isRecord(catalog) || !isRecord(catalog.mcpServers)) {
		throw new Error("pi-mcp: servers.json must contain a mcpServers object");
	}

	const servers: Registration[] = [];
	for (const [name, entry] of Object.entries(catalog.mcpServers)) {
		if (!isRecord(entry)) {
			throw new Error(`pi-mcp: server "${name}" must be an object`);
		}
		const { requiredEnv = [], headers, ...config } = entry;
		if (!Array.isArray(requiredEnv) || requiredEnv.some((key) => typeof key !== "string" || !ENV_NAME.test(key))) {
			throw new Error(`pi-mcp: server "${name}" requiredEnv must be an array of environment variable names`);
		}
		if (requiredEnv.some((key: string) => !env[key]?.trim())) {
			continue;
		}

		if (headers !== undefined) {
			if (!isRecord(headers) || Object.values(headers).some((value) => typeof value !== "string")) {
				throw new Error(`pi-mcp: server "${name}" headers must map names to strings`);
			}
			const availableHeaders = Object.fromEntries(Object.entries(headers).filter(([, value]) => {
				const template = value as string;
				return template.trim() && [...template.matchAll(ENV_REFERENCE)].every(([, key]) => env[key]?.trim());
			}));
			if (Object.keys(availableHeaders).length > 0) {
				// Pi expands these templates at connection time; never copy secrets into registrations.
				config.headers = availableHeaders;
			}
		}

		// Pi validates the remaining standard MCP configuration fields during registration.
		servers.push({ name, config: config as unknown as McpServerConfig });
	}
	return servers;
}

export function registerServers(pi: Pick<ExtensionAPI, "getMcpServers" | "registerMcpServer">, servers: Registration[]): void {
	const namespace = (name: string) => name.replace(/-/g, "_");
	const registered = new Set(pi.getMcpServers().map((server) => namespace(server.name)));
	for (const { name, config } of servers) {
		if (registered.has(namespace(name))) {
			continue;
		}
		pi.registerMcpServer(name, config);
		registered.add(namespace(name));
	}
}
