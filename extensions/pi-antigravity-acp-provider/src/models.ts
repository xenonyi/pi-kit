import type { AcpModelInfo } from "./acp/session-state.js";
import type {
	Model,
	ThinkingLevel,
	ThinkingLevelMap,
} from "@earendil-works/pi-ai";

export const PROVIDER_ID = "antigravity-acp";
export const API_ID = "antigravity-acp";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
type Effort = "low" | "medium" | "high" | "xhigh";
type Variants = Partial<Record<Effort, string>>;

// Keep the broadly available Flash model first for offline/default selection.
export const FALLBACK_MODELS: readonly Model<typeof API_ID>[] = [
	reasoningModel("gemini-3.8-flash", "Gemini 3.8 Flash", {
		low: "gemini-3.8-flash-low",
		medium: "gemini-3.8-flash-medium",
		high: "gemini-3.8-flash-high",
	}),
	reasoningModel("gemini-4-argon", "Gemini 4 Argon", {
		low: "gemini-4-argon-low",
		medium: "gemini-4-argon-medium",
		high: "gemini-4-argon-high",
	}),
	reasoningModel("gemini-4-hydrogen", "Gemini 4 Hydrogen", {
		low: "gemini-4-hydrogen-low",
		medium: "gemini-4-hydrogen-medium",
		high: "gemini-4-hydrogen-high",
		xhigh: "gemini-4-hydrogen-xhigh",
	}),
	fixedModel("gemini-pro-orchestrator-g1-pro", "Gemini Pro Orchestrator G1 Pro"),
	reasoningModel("claude-opus-5-5", "Claude Opus 5.5", {
		low: "claude-opus-5-5-low",
		medium: "claude-opus-5-5-medium",
		high: "claude-opus-5-5-high",
	}),
	reasoningModel("claude-sonnet-5-5", "Claude Sonnet 5.5", {
		low: "claude-sonnet-5-5-low",
		medium: "claude-sonnet-5-5-medium",
		high: "claude-sonnet-5-5-high",
	}),
	reasoningModel("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)", {
		medium: "gpt-oss-120b-medium",
	}),
];

export function projectModels(models: readonly AcpModelInfo[]): Model<typeof API_ID>[] {
	const safe = models.filter((candidate) => validModelId(candidate.modelId.trim()));
	const groups = new Map<
		string,
		{ name: string; variants: Variants; members: AcpModelInfo[] }
	>();

	for (const candidate of safe) {
		const id = candidate.modelId.trim();
		const parsed = effortFromName(candidate.name) ?? effortFromId(id);
		if (!parsed) continue;
		const key = parsed.baseName.toLowerCase();
		const group = groups.get(key) ?? { name: parsed.baseName, variants: {}, members: [] };
		group.variants[parsed.effort] = id;
		group.members.push(candidate);
		groups.set(key, group);
	}

	const emittedGroups = new Set<string>();
	const emittedIds = new Set<string>();
	const projected: Model<typeof API_ID>[] = [];
	for (const candidate of safe) {
		const id = candidate.modelId.trim();
		if (emittedIds.has(id)) continue;
		const parsed = effortFromName(candidate.name) ?? effortFromId(id);
		const key = parsed?.baseName.toLowerCase();
		const group = key ? groups.get(key) : undefined;
		if (group && Object.keys(group.variants).length >= 2) {
			if (emittedGroups.has(key!)) continue;
			emittedGroups.add(key!);
			for (const member of group.members) emittedIds.add(member.modelId.trim());
			projected.push(
				reasoningModel(canonicalId(group.name, group.variants), group.name, group.variants),
			);
			continue;
		}
		emittedIds.add(id);
		projected.push(
			parsed
				? reasoningModel(id, candidate.name.trim() || id, { [parsed.effort]: id })
				: fixedModel(id, candidate.name.trim() || id),
		);
	}
	return projected;
}

export type ModelEffort = Effort;

export function splitEffortSuffix(modelId: string): { base: string; effort: ModelEffort } | undefined {
	const match = /^(.*)-(low|medium|high|xhigh)$/u.exec(modelId);
	if (!match?.[1]) return undefined;
	return { base: match[1], effort: match[2] as ModelEffort };
}

export function resolveAcpModelId(
	model: Model<typeof API_ID>,
	reasoning: ThinkingLevel | undefined,
): string {
	const map = model.thinkingLevelMap;
	if (!model.reasoning || !map) return model.id;
	const preferred: Effort =
		reasoning === "minimal" || reasoning === "low"
			? "low"
			: reasoning === "xhigh" || reasoning === "max"
				? "xhigh"
				: reasoning === "high"
					? "high"
					: "medium";
	const order: Effort[] =
		preferred === "low"
			? ["low", "medium", "high", "xhigh"]
			: preferred === "xhigh"
				? ["xhigh", "high", "medium", "low"]
				: preferred === "high"
					? ["high", "xhigh", "medium", "low"]
					: ["medium", "high", "low", "xhigh"];
	for (const effort of order) {
		const value = map[effort];
		if (typeof value === "string" && value) return value;
	}
	return model.id;
}

function reasoningModel(
	id: string,
	name: string,
	variants: Variants,
): Model<typeof API_ID> {
	const thinkingLevelMap: ThinkingLevelMap = {
		off: null,
		minimal: null,
		low: variants.low ?? null,
		medium: variants.medium ?? null,
		high: variants.high ?? null,
		xhigh: variants.xhigh ?? null,
		max: null,
	};
	return baseModel(id, name, true, thinkingLevelMap);
}

function fixedModel(id: string, name: string): Model<typeof API_ID> {
	return baseModel(id, name, false);
}

function baseModel(
	id: string,
	name: string,
	reasoning: boolean,
	thinkingLevelMap?: ThinkingLevelMap,
): Model<typeof API_ID> {
	return {
		id,
		name,
		api: API_ID,
		provider: PROVIDER_ID,
		baseUrl: "",
		reasoning,
		...(thinkingLevelMap ? { thinkingLevelMap } : {}),
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	};
}

function effortFromName(name: string): { baseName: string; effort: Effort } | undefined {
	const match = name.trim().match(/^(.+?)\s*\((low|medium|high|xhigh)\)$/iu);
	if (!match?.[1] || !match[2]) return undefined;
	return { baseName: match[1].trim(), effort: match[2].toLowerCase() as Effort };
}

function effortFromId(id: string): { baseName: string; effort: Effort } | undefined {
	const split = splitEffortSuffix(id);
	return split ? { baseName: titleFromId(split.base), effort: split.effort } : undefined;
}

function canonicalId(name: string, variants: Variants): string {
	const bases = Object.values(variants)
		.filter((value): value is string => typeof value === "string")
		.map((value) => splitEffortSuffix(value)?.base ?? value);
	if (bases.length > 0 && bases.every((value) => value === bases[0])) return bases[0]!;
	return name
		.toLowerCase()
		.replace(/[^a-z0-9.]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

function titleFromId(id: string): string {
	return id
		.split("-")
		.map((part) => (part === "gemini" ? "Gemini" : part.charAt(0).toUpperCase() + part.slice(1)))
		.join(" ");
}

function validModelId(id: string): boolean {
	return id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(id);
}
