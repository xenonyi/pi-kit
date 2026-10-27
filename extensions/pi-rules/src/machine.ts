/** Collects the values fragment conditions match against. */

import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import type { MachineEnv, ModelLike } from "./types.ts";

export interface CollectEnvInput {
	cwd: string;
	model?: ModelLike;
	tools: string[];
}

export function collectEnv(input: CollectEnvInput): MachineEnv {
	return {
		os: process.platform,
		host: hostname(),
		cwd: path.resolve(input.cwd).replace(/\\/g, "/"),
		model: input.model ? `${input.model.provider}/${input.model.id}` : undefined,
		tools: [...input.tools],
	};
}
