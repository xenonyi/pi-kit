import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_PROMPT_TEXT_CHARS, MIN_SPLIT_COLUMNS, MIN_SPLIT_ROWS } from "./args.ts";
import { SUBMISSION_PROBE_MS } from "./tools.ts";

/**
 * The prose that documents these thresholds states them as literal numbers.
 * Changing a constant cannot update the prose, so these tests bind the two:
 * the number is read from the exported constant and then required to appear
 * in the document. A rename or rewrite that drops the number fails loudly
 * instead of silently passing — drift in the other direction is the same bug.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);

const HERDR_SKILL = "skills/herdr/SKILL.md";
const HANDOFF_SKILL = "skills/herdr-handoff/SKILL.md";
const DECISIONS = "docs/decisions-herdr-extension.md";

interface DocNumber {
	/** Document that must state the number. */
	doc: string;
	/** What the number means, quoted in the failure message. */
	what: string;
	/** The exported value the document is pinned to. */
	value: number;
	/** Name of the exported constant, quoted in the failure message. */
	constant: string;
	/** Accepted unit words directly after the number. */
	units: readonly string[];
}

const DOC_NUMBERS: readonly DocNumber[] = [
	{
		doc: DECISIONS,
		what: "拆分后每一半的最小宽度",
		value: MIN_SPLIT_COLUMNS,
		constant: "MIN_SPLIT_COLUMNS",
		units: ["列"],
	},
	{
		doc: DECISIONS,
		what: "拆分后每一半的最小高度",
		value: MIN_SPLIT_ROWS,
		constant: "MIN_SPLIT_ROWS",
		units: ["行"],
	},
	{
		doc: HANDOFF_SKILL,
		what: "单次 prompt 的文本上限",
		value: MAX_PROMPT_TEXT_CHARS,
		constant: "MAX_PROMPT_TEXT_CHARS",
		units: ["字符"],
	},
	{
		doc: HERDR_SKILL,
		what: "投递后回读等待",
		value: SUBMISSION_PROBE_MS / 1_000,
		constant: "SUBMISSION_PROBE_MS",
		units: ["秒"],
	},
	{
		doc: HANDOFF_SKILL,
		what: "投递后回读等待",
		value: SUBMISSION_PROBE_MS / 1_000,
		constant: "SUBMISSION_PROBE_MS",
		units: ["秒"],
	},
];

/** Render a number the way prose does: no thousands separator. */
function asProse(value: number): string {
	return String(value);
}

/**
 * Require `<number> <unit>` in the document. The lookbehind keeps `8` from
 * matching the tail of `18`, and `\s*` tolerates prose that drops the space.
 */
function findStatedNumber(doc: string, entry: DocNumber): string | null {
	const text = readFileSync(new URL(doc, REPO_ROOT), "utf8");
	const number = asProse(entry.value);
	const pattern = new RegExp(`(?<!\\d)${number}\\s*(?:${entry.units.join("|")})`);
	const match = pattern.exec(text);
	if (!match) return null;

	const lineStart = text.lastIndexOf("\n", match.index) + 1;
	const lineEnd = text.indexOf("\n", match.index);
	const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
	return line;
}

for (const entry of DOC_NUMBERS) {
	test(`${entry.doc} still states ${entry.constant} as ${asProse(entry.value)} ${entry.units[0]}`, () => {
		const line = findStatedNumber(entry.doc, entry);
		assert.ok(
			line !== null,
			`${entry.doc}: 文档措辞变了——找不到「${asProse(entry.value)} ${entry.units[0]}」（期望值来自 ${entry.constant}，含义：${entry.what}）。` +
				`要么文档改写后不再写这个数字，要么常量已改而文档未同步；请让两者重新一致。`,
		);
	});
}
