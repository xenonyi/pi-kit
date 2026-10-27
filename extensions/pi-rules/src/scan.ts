/**
 * Discovers fragment files, parses their frontmatter and normalizes metadata.
 *
 * Fragments are ordered by their path relative to the source root, so the file
 * name decides where a fragment's text ends up; no priority field is involved.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "./frontmatter.ts";
import type { Diagnostic, Fragment, FragmentSource, MatchConditions } from "./types.ts";

const FRAGMENT_EXTENSION = ".md";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const GROUP_PATTERN = /^[A-Za-z0-9_-]+$/;
const FILE_PREFIX = /(^|\/)\d+[-_]/g;
const META_KEYS = new Set(["id", "title", "target", "group", "enabled", "when"]);

export function scanFragments(sources: FragmentSource[]): { fragments: Fragment[]; diagnostics: Diagnostic[] } {
	const diagnostics: Diagnostic[] = [];
	const collected = new Map<string, { fragment: Fragment; order: string }>();

	for (const source of sources) {
		for (const file of listMarkdownFiles(source.dir)) {
			let document;
			try {
				document = parseDocument(readFileSync(file, "utf8"));
			} catch (error) {
				diagnostics.push({ level: "error", message: errorMessage(error), path: file });
				continue;
			}

			const fragment = normalizeFragment(document, defaultId(source.dir, file), file, source, diagnostics);
			if (!fragment) continue;

			const existing = collected.get(fragment.meta.id);
			if (existing) {
				const sameSource = existing.fragment.source.kind === source.kind;
				diagnostics.push({
					level: sameSource ? "error" : "warning",
					message: sameSource
						? `duplicate fragment id "${fragment.meta.id}" in ${source.kind}; keeping the first file`
						: `fragment "${fragment.meta.id}" from ${source.kind} overrides ${existing.fragment.source.kind}`,
					path: file,
				});
				if (sameSource) continue;
			}
			collected.set(fragment.meta.id, { fragment, order: relativePath(source.dir, file) });
		}
	}

	const fragments = [...collected.values()]
		.sort((a, b) => compareText(a.order, b.order) || compareText(a.fragment.meta.id, b.fragment.meta.id))
		.map((entry) => entry.fragment);
	return { fragments, diagnostics };
}

function normalizeFragment(
	document: { data: Record<string, unknown>; body: string },
	fallbackId: string,
	file: string,
	source: FragmentSource,
	diagnostics: Diagnostic[],
): Fragment | undefined {
	const data = document.data;
	const fail = (reason: string): undefined => {
		diagnostics.push({ level: "error", message: reason, path: file });
		return undefined;
	};
	for (const key of Object.keys(data)) {
		if (META_KEYS.has(key)) continue;
		diagnostics.push({
			level: "warning",
			message:
				key === "priority"
					? "`priority` is not supported; fragments are concatenated in filename order"
					: `unknown frontmatter key "${key}"`,
			path: file,
		});
	}

	const id = typeof data.id === "string" ? data.id.trim() : fallbackId;
	if (!ID_PATTERN.test(id)) return fail(`invalid id "${id}"; use letters, digits, ".", "_", "-" and "/"`);
	if (!document.body) return fail("fragment body is empty");

	let target: Fragment["meta"]["target"] = "section";
	if (data.target !== undefined) {
		if (data.target !== "section" && data.target !== "rule") return fail('`target` must be "section" or "rule"');
		target = data.target;
	}

	const group = typeof data.group === "string" ? data.group.trim() : "shared";
	if (!GROUP_PATTERN.test(group)) return fail(`invalid group "${group}"; use letters, digits, "_" or "-"`);

	let enabled = true;
	if (data.enabled !== undefined) {
		if (typeof data.enabled !== "boolean") return fail("`enabled` must be true or false");
		enabled = data.enabled;
	}

	let conditions: MatchConditions | undefined;
	try {
		conditions = normalizeConditions(data.when);
	} catch (error) {
		return fail(`invalid when: ${errorMessage(error)}`);
	}

	const title = typeof data.title === "string" && data.title.trim() !== "" ? data.title.trim() : undefined;
	return {
		meta: { id, title, target, group, enabled, conditions },
		body: document.body,
		path: file,
		source,
	};
}

function normalizeConditions(value: unknown): MatchConditions | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error("`when` must be a mapping");

	const conditions: MatchConditions = {};
	for (const [key, entry] of Object.entries(value)) {
		switch (key) {
			case "os":
			case "host":
			case "cwd":
			case "tools":
				conditions[key] = stringList(entry, key);
				break;
			default:
				throw new Error(`unknown condition "${key}"`);
		}
	}
	return Object.keys(conditions).length > 0 ? conditions : undefined;
}

function stringList(value: unknown, key: string): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...(value as string[])];
	throw new Error(`\`${key}\` must be a string or a list of strings`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listMarkdownFiles(root: string): string[] {
	const files: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (current === undefined) break;
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules") stack.push(full);
				continue;
			}
			if (entry.isFile() && entry.name.toLowerCase().endsWith(FRAGMENT_EXTENSION)) files.push(full);
		}
	}
	return files.sort();
}

function relativePath(root: string, file: string): string {
	return path.relative(root, file).replace(/\\/g, "/");
}

/** Default id from the path, without the numeric ordering prefix. */
function defaultId(root: string, file: string): string {
	const relative = relativePath(root, file);
	const withoutExtension = relative.toLowerCase().endsWith(FRAGMENT_EXTENSION)
		? relative.slice(0, -FRAGMENT_EXTENSION.length)
		: relative;
	return withoutExtension.replace(FILE_PREFIX, "$1");
}

function compareText(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "unknown error";
}
