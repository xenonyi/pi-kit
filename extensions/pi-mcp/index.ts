import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { prepareServers, readCatalog, registerServers } from "./src/servers.ts";

export default async function mcp(pi: ExtensionAPI) {
	registerServers(pi, prepareServers(await readCatalog(), process.env));
}
