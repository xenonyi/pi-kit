/** Versioned handoff contract shared by generation, review, storage, and delivery. */
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";

const MAX_DATA_BYTES = 256 * 1024;
const text = (description: string, maxLength = 4096) =>
	Type.String({ description, minLength: 1, maxLength, pattern: "\\S" });
const items = (description: string, minItems = 0) =>
	Type.Array(text(description), { description, minItems, maxItems: 32 });

export const HandoffGoalSchema = text("用户传入的原始新会话目标，由程序填写，不得改写。", 8192);

/** Only these fields are model-owned. Metadata is supplied by the application. */
export const HandoffContentSchema = Type.Object({
	summary: text("与目标相关的背景、当前状态和关键发现；明确区分事实与推测。", 8192),
	completedWork: items("已实际完成的工作；不能把计划或建议写为已完成。"),
	decisions: items("已确认的决策及其理由。"),
	files: Type.Array(Type.Object({
		path: text("对话中明确出现的文件路径，保留原文。", 2048),
		purpose: text("文件的相关性，以及已知的查看或修改情况；不要推测未发生的修改。"),
	}, { additionalProperties: false }), { description: "相关文件；无记录时为空数组。", maxItems: 64 }),
	nextSteps: items("按执行顺序列出与用户目标相关、可操作的下一步；不虚构已确定的需求。", 1),
	constraints: items("必须继承的用户要求、项目规范、禁止事项和环境限制。"),
	openQuestions: items("尚未解决的问题和需要用户确认的决定；不要替用户作答。"),
	risks: items("已知风险、阻塞和未覆盖的边界；未知不等于不存在。"),
	verification: Type.Array(Type.Object({
		action: text("对话中提及的验证动作或命令，命令保留原文。"),
		status: StringEnum(["passed", "failed", "not_run", "unknown"] as const, {
			description: "仅有明确成功证据才能填 passed；未执行填 not_run；结果不明确填 unknown。",
		}),
		details: text("验证结果或未执行原因；禁止编造成功结果。"),
	}, { additionalProperties: false }), { description: "验证记录；无记录时为空数组。", maxItems: 32 }),
}, { additionalProperties: false });

export const HandoffDataSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	goal: HandoffGoalSchema,
	...HandoffContentSchema.properties,
}, { additionalProperties: false });

export type HandoffData = Static<typeof HandoffDataSchema>;

function checkStrings(value: unknown): void {
	if (typeof value === "string") {
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
			throw new Error("Handoff data contains unsupported control characters");
		}
	} else if (Array.isArray(value)) {
		for (const item of value) checkStrings(item);
	} else if (typeof value === "object" && value !== null) {
		for (const item of Object.values(value)) checkStrings(item);
	}
}

/** Deliberately no coercion, default filling, or removal of unknown fields. */
function validate<T extends TSchema>(schema: T, value: unknown): Static<T> {
	if (!Check(schema, value)) {
		const detail = Errors(schema, value).slice(0, 4)
			.map((error) => `${error.instancePath || "/"}: ${error.message}`).join("; ").slice(0, 600);
		throw new Error(`Invalid handoff data: ${detail}`);
	}
	checkStrings(value);
	if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_DATA_BYTES) {
		throw new Error("Handoff data exceeds 256 KiB");
	}
	return value;
}

export function validateHandoffGoal(goal: string): void {
	validate(HandoffGoalSchema, goal);
}

export function createHandoffData(goal: string, content: unknown): HandoffData {
	const fields = validate(HandoffContentSchema, content);
	return validateHandoffData({ schemaVersion: 1, goal, ...fields }, goal);
}

export function validateHandoffData(value: unknown, expectedGoal?: string): HandoffData {
	const data = validate(HandoffDataSchema, value);
	if (expectedGoal !== undefined && data.goal !== expectedGoal) {
		throw new Error("Handoff goal must match the original /handoff goal");
	}
	// Canonical key order and detached arrays keep persisted JSON predictable.
	return {
		schemaVersion: 1,
		goal: data.goal,
		summary: data.summary,
		completedWork: [...data.completedWork],
		decisions: [...data.decisions],
		files: data.files.map(({ path, purpose }) => ({ path, purpose })),
		nextSteps: [...data.nextSteps],
		constraints: [...data.constraints],
		openQuestions: [...data.openQuestions],
		risks: [...data.risks],
		verification: data.verification.map(({ action, status, details }) => ({ action, status, details })),
	};
}

/** Values are plain text, not additional Markdown sections or executable markup. */
function markdown(value: string): string {
	return value.replace(/\r\n?/g, "\n").replace(/[\\`*_{}\[\]<>()#!|~.+\-]/g, "\\$&");
}

function list(values: readonly string[], ordered = false): string {
	if (values.length === 0) return "（未记录）";
	return values.map((value, index) =>
		`${ordered ? `${index + 1}.` : "-"} ${markdown(value).replace(/\n/g, "\n  ")}`).join("\n");
}

const VERIFICATION_LABELS = {
	passed: "通过", failed: "失败", not_run: "未执行", unknown: "结果未知",
} as const;

/** The preview and target prompt are always derived from exactly the same data. */
export function renderHandoffPrompt(data: HandoffData): string {
	const sections = [
		["目标", markdown(data.goal)],
		["上下文", markdown(data.summary)],
		["已完成工作", list(data.completedWork)],
		["关键决策", list(data.decisions)],
		["相关文件", list(data.files.map((file) => `${file.path}：${file.purpose}`))],
		["下一步", list(data.nextSteps, true)],
		["约束与禁止事项", list(data.constraints)],
		["待确认问题", list(data.openQuestions)],
		["风险与阻塞", list(data.risks)],
		["验证记录", list(data.verification.map((item) =>
			`[${VERIFICATION_LABELS[item.status]}] ${item.action}：${item.details}`))],
	];
	return [
		"请基于以下交接继续工作，遵守约束；未记录或未验证的事项不代表已完成或没有风险。",
		...sections.map(([title, body]) => `## ${title}\n\n${body}`),
	].join("\n\n");
}

/** Both --here and cross-process delivery must reject text/data divergence. */
export function assertHandoffDraft(data: {
	prompt: string;
	goal: string;
	record: { goal: string; handoff?: unknown };
}): void {
	const handoff = validateHandoffData(data.record.handoff, data.goal);
	if (data.record.goal !== data.goal || data.prompt !== renderHandoffPrompt(handoff)) {
		throw new Error("Handoff prompt does not match its structured data");
	}
}
