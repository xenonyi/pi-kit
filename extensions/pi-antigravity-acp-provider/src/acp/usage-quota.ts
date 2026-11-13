import { AntigravityAcpError } from "./errors.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface AntigravityQuotaSnapshot {
	at: number;
	groups: { displayName: string; buckets: { window: string; remainingFraction: number; resetTime?: string }[] }[];
}

const GROUP = /^- \*\*(.+)\*\*$/u;
const BUCKET = /^ {2}- \*\*(.+?):\*\* (\d+)% remaining(?: \(resets (.+)\))?$/u;
const RESET = new RegExp(`^(${MONTHS.join("|")}) (\\d{1,2}), (\\d{4}), (\\d{2}):(\\d{2}) UTC$`, "u");

export function parseUsageQuota(text: string, now = Date.now()): AntigravityQuotaSnapshot {
	const tsv = parseTsvUsage(text);
	if (tsv.length > 0) return { at: now, groups: tsv };

	const section = /^### Quota Limits$([\s\S]*?)(?=^### |(?![\s\S]))/mu.exec(text)?.[1] ?? "";
	const groups: AntigravityQuotaSnapshot["groups"] = [];
	let notice: string | undefined;
	for (const line of section.split("\n")) {
		const group = GROUP.exec(line);
		if (group) {
			groups.push({ displayName: group[1]!, buckets: [] });
			continue;
		}
		const bucket = BUCKET.exec(line);
		if (bucket && groups.length) {
			const [, label, percent, reset] = bucket;
			const resetTime = reset ? resetIso(reset) : undefined;
			groups.at(-1)!.buckets.push({
				window: normalizeWindow(label!),
				remainingFraction: Number(percent) / 100,
				...(resetTime ? { resetTime } : {}),
			});
			continue;
		}
		if (line.startsWith("- ")) notice ??= line.slice(2);
	}
	if (!groups.length) {
		const fallbackNotice = notice ?? text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
		throw new AntigravityAcpError("protocol", `Antigravity /usage reply had no quota groups: ${fallbackNotice ?? "empty"}`);
	}
	return { at: now, groups };
}

function parseTsvUsage(text: string): AntigravityQuotaSnapshot["groups"] {
	const groups = new Map<string, AntigravityQuotaSnapshot["groups"][number]>();
	for (const rawLine of text.split(/\r?\n/u)) {
		if (!rawLine.includes("\t")) continue;
		const [rawGroup, rawLabel, rawPercent, rawReset] = rawLine.split("\t");
		const displayName = rawGroup?.trim();
		const label = rawLabel?.trim();
		const percentMatch = /^(\d+(?:\.\d+)?)%$/u.exec(rawPercent?.trim() ?? "");
		if (!displayName || !label || !percentMatch) continue;
		let group = groups.get(displayName);
		if (!group) {
			group = { displayName, buckets: [] };
			groups.set(displayName, group);
		}
		const resetParsed = rawReset?.trim() ? Date.parse(rawReset.trim()) : Number.NaN;
		const resetTime = Number.isFinite(resetParsed) ? new Date(resetParsed).toISOString() : undefined;
		group.buckets.push({
			window: normalizeWindow(label),
			remainingFraction: Number(percentMatch[1]) / 100,
			...(resetTime ? { resetTime } : {}),
		});
	}
	return [...groups.values()];
}

function normalizeWindow(label: string): string {
	return /weekly/iu.test(label) ? "weekly" : /(?:five|\b5)[\s-]*hour/iu.test(label) ? "5h" : label;
}

function resetIso(text: string): string | undefined {
	const match = RESET.exec(text);
	if (!match) return undefined;
	const [, month, day, year, hours, minutes] = match;
	return new Date(Date.UTC(Number(year), MONTHS.indexOf(month!), Number(day), Number(hours), Number(minutes))).toISOString();
}
