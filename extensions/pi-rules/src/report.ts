/**
 * Command output: short results become a notification, long ones a Markdown
 * report file, so no terminal component has to be maintained.
 */

import { writeFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reportFilePath } from "./storage.ts";

const INLINE_LINE_LIMIT = 12;

export function report(ctx: ExtensionContext, title: string, body: string): void {
	const lines = body.split("\n").length;
	if (ctx.hasUI && lines <= INLINE_LINE_LIMIT) {
		ctx.ui.notify(body, "info");
		return;
	}

	let file = "";
	try {
		file = reportFilePath();
		writeFileSync(file, `# ${title}\n\n${body}\n`, "utf8");
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(`${title}: cannot write report: ${reason}`);
	}

	if (ctx.hasUI) {
		if (file) ctx.ui.notify(`${title}: ${lines} lines → ${file}`, "info");
		return;
	}
	console.error(`${title}\n\n${body}\n`);
}
