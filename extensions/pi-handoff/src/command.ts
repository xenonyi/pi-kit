/**
 * Handoff extension - transfer context to a new focused session.
 *
 * Adapted from:
 * https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/handoff.ts
 *
 * Upstream copyright and MIT license are preserved in ../LICENSE.
 * The generated prompt is reviewed before opening a new session, and remains
 * a draft until the user submits it. New sessions receive a goal-derived name
 * and a compact provenance card (a custom entry outside LLM context).
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BorderedLoader,
	buildSessionContext,
	convertToLlm,
	type ExtensionAPI,
	getAgentDir,
	serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { HandoffStore } from "./bundle.ts";
import { type HandoffData, renderHandoffPrompt } from "./data.ts";
import { deliverHandoff } from "./delivery.ts";
import { generateHandoff } from "./generate.ts";
import { HerdrClient, herdrEnvironment } from "./herdr.ts";
import { registerHandoffInitialization } from "./init.ts";
import { parseHandoffArgs } from "./options.ts";
import {
	buildHandoffRecord,
	HANDOFF_ENTRY_TYPE,
	type HandoffRecordData,
	readHandoffChain,
	renderHandoffCard,
} from "./record.ts";
import { reviewHandoff } from "./review.ts";
import { openHandoffSession } from "./session.ts";

type HandoffResult =
	| { status: "ok"; handoff: HandoffData }
	| { status: "cancelled" }
	| { status: "error"; message: string };

type HandoffOperation = {
	controller: AbortController;
	cancelUI?: () => void;
	allowReplacement: boolean;
};

export default function handoffExtension(pi: ExtensionAPI) {
	let activeOperation: HandoffOperation | undefined;
	registerHandoffInitialization(pi);

	// Provenance cards stay out of LLM context; they only render in the TUI.
	pi.registerEntryRenderer<HandoffRecordData>(HANDOFF_ENTRY_TYPE, renderHandoffCard);

	pi.on("session_shutdown", (event) => {
		const operation = activeOperation;
		if (!operation) return;

		// Shutdown runs before Pi invalidates the old context. Close our UI now,
		// not from a late provider response after another session/UI has taken over.
		operation.allowReplacement &&= event.reason === "new";
		operation.controller.abort();
		operation.cancelUI?.();
		if (!operation.allowReplacement && activeOperation === operation) activeOperation = undefined;
	});

	pi.registerCommand("handoff", {
		description: "Hand off reviewed structured context to a new herdr tab (--split right|down, --here)",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				const message = "handoff requires interactive mode";
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else console.error(message);
				return;
			}

			if (activeOperation) {
				ctx.ui.notify("A handoff is already in progress. Finish or cancel it before starting another.", "info");
				return;
			}

			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			let parsed: ReturnType<typeof parseHandoffArgs>;
			let herdr: HerdrClient | undefined;
			try {
				parsed = parseHandoffArgs(args);
				if (parsed.destination !== "here") herdr = new HerdrClient(herdrEnvironment());
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}
			const { goal, destination } = parsed;

			// Acquire before the first await; Pi can invoke commands concurrently while busy.
			const operation: HandoffOperation = { controller: new AbortController(), allowReplacement: false };
			activeOperation = operation;
			const isValid = () => activeOperation === operation && !operation.controller.signal.aborted;

			try {
				// Wait for finalized messages and tool results before taking the snapshot.
				try {
					if (!ctx.isIdle()) {
						ctx.ui.notify("Waiting for the current task to finish. Handoff will not interrupt it.", "info");
					}
					await ctx.waitForIdle();
				} catch (error: unknown) {
					if (!isValid()) return;
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Handoff preparation failed: ${message}`, "error");
					return;
				}
				if (!isValid()) return;

				// Reuse Pi's active-branch projection, including compaction summaries
				// and retained messages, rather than copying session traversal logic.
				const { messages } = buildSessionContext(
					ctx.sessionManager.getEntries(),
					ctx.sessionManager.getLeafId(),
				);
				const conversationText = serializeConversation(convertToLlm(messages));

				if (!conversationText.trim()) {
					ctx.ui.notify("No conversation to hand off", "error");
					return;
				}

				const currentSessionFile = ctx.sessionManager.getSessionFile();

				const result = await ctx.ui.custom<HandoffResult>((tui, theme, _kb, done) => {
					const loader = new BorderedLoader(tui, theme, "Generating handoff draft...");
					const signal = AbortSignal.any([operation.controller.signal, loader.signal]);
					const finish = (value: HandoffResult) => {
						if (operation.cancelUI !== cancelUI) return;
						operation.cancelUI = undefined;
						// Also covers shutdown before Pi has mounted the returned component.
						loader.dispose();
						done(value);
					};
					const cancelUI = () => finish({ status: "cancelled" });
					operation.cancelUI = cancelUI;
					loader.onAbort = cancelUI;

					generateHandoff({
						registry: ctx.modelRegistry, model, conversation: conversationText, goal, signal,
					})
						.then((handoff) => { if (isValid()) finish({ status: "ok", handoff }); })
						.catch((error: unknown) => {
							if (!isValid()) return;
							finish(signal.aborted
								? { status: "cancelled" }
								: { status: "error", message: error instanceof Error ? error.message : String(error) });
						});

					return loader;
				});
				if (!isValid()) return;

				if (result.status === "cancelled") {
					ctx.ui.notify("Handoff generation cancelled. No new session was created.", "info");
					return;
				}
				if (result.status === "error") {
					ctx.ui.notify(`Handoff generation failed: ${result.message}`, "error");
					return;
				}

				const handoff = await reviewHandoff(ctx, result.handoff, { destination, operation, isValid });
				if (!isValid()) return;
				if (!handoff) {
					ctx.ui.notify("Handoff review cancelled. No new session was created.", "info");
					return;
				}
				const editedPrompt = renderHandoffPrompt(handoff);

				// Store the approved data alongside provenance, never the old transcript.
				// Lineage follows the active branch, not a sibling's history.
				const record = buildHandoffRecord({
					goal, handoff,
					source: {
						id: ctx.sessionManager.getSessionId(),
						name: ctx.sessionManager.getSessionName(),
						file: currentSessionFile,
					},
					inheritedChain: readHandoffChain(ctx.sessionManager.getBranch()),
				});
				const data = { prompt: editedPrompt, goal, record };
				const previousDraft = ctx.ui.getEditorText();
				// Never preload the reviewed draft into this editor: an Enter while
				// herdr starts the target must not submit it to this session.
				if (destination !== "here") {
					if (!herdr) throw new Error("Herdr client is unavailable for this destination");
					ctx.ui.setStatus("pi-handoff", "Opening handoff in herdr…");
					try {
						const target = await deliverHandoff({
							payload: { ...data, cwd: ctx.cwd, configuration: "target-defaults" },
							destination,
							store: new HandoffStore(join(getAgentDir(), "handoffs")),
							herdr,
							extension: fileURLToPath(new URL("../index.ts", import.meta.url)),
							signal: operation.controller.signal,
							// The draft stays in memory here. Keep the private package
							// when the editor changed and the catch cannot restore it.
							canRestoreDraft: () => isValid() && ctx.ui.getEditorText() === previousDraft,
						});
						if (!isValid()) return;
						ctx.ui.notify(`Handoff draft ready in ${target.paneId}. Nothing sent; source session unchanged.`, "info");
					} catch (error) {
						// Restore the draft for a retry only if the user has not changed
						// this editor since the command started.
						if (isValid() && ctx.ui.getEditorText() === previousDraft) ctx.ui.setEditorText(editedPrompt);
						throw error;
					} finally {
						if (isValid()) ctx.ui.setStatus("pi-handoff", undefined);
					}
					return;
				}

				// Only an explicit --here replaces the source session. Use a fresh
				// withSession context after the old runtime has shut down. The
				// replacement fills its own editor; restore here only on cancel/error.
				try {
					const newSessionResult = await openHandoffSession(ctx, data, {
						beforeSwitch: () => { operation.allowReplacement = true; },
						canPopulate: () => operation.allowReplacement,
					});
					if (isValid() && newSessionResult.cancelled) {
						ctx.ui.setEditorText(editedPrompt);
						ctx.ui.notify("Handoff session switch cancelled. Reviewed draft retained in the current editor.", "info");
					}
				} catch (error) {
					if (isValid()) ctx.ui.setEditorText(editedPrompt);
					throw error;
				}
			} catch (error: unknown) {
				// Before replacement we can report via the original UI. After shutdown
				// the host owns fatal switch errors; never touch the stale ctx/pi.
				if (!isValid()) throw error;
				ctx.ui.notify(`Handoff failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			} finally {
				operation.controller.abort();
				operation.cancelUI?.();
				// A late old waiter must not release a newer operation's lock.
				if (activeOperation === operation) activeOperation = undefined;
			}
		},
	});
}
