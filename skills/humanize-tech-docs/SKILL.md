---
name: humanize-tech-docs
description: Write and repair technical docs so a zero-context fresh reader can use them — anchored claims, plain-coin naming with a corpus-rename procedure, and a fresh-reader subagent as the acceptance gate.
disable-model-invocation: true
---

# Humanize Tech Docs

Write and repair technical docs so a **fresh reader** — someone at the doc's declared baseline, holding none of the context in your head right now — can act on them. Every pass ends on the same gate, the [fresh-reader test](FRESH-READER-TEST.md).

Examples throughout these files（演进闭环、Tombstone、八件套…）are lifted from one real AOSP doc-corpus overhaul — read them for shape; the terms bind nothing in your project.

## Scope

These rules bind the layers a fresh reader enters through: READMEs, tutorials, how-tos, architecture and design explanations, worked examples, proposals. Reference layers (specs, schemas, glossaries) may legally stay dense and definition-first; when the two disagree, reference wins and the entry layer says so.

Every human-facing doc opens by naming its reader in one sentence — e.g. 「懂 Android 基础，不了解本项目」. Every later "does this need explaining?" resolves against that baseline, not against zero, in three bands: industry terms the baseline reads fluently (HAL, AIDL) come free; rare industry terms it would have to leave the doc to look up (VINTF, CTS/VTS) get a half-sentence inline gloss at first occurrence — inline, not a glossary entry; project-coined terms never come free.

Docs that declare an AI reader — `CONTEXT.md` and ADR prose, maintained through the **domain-modeling** skill — keep their dense style: repair broken structure if asked, and leave wording, density, and new entries to that skill. Any skill named in these files loads through the host's native skill-loading mechanism; if one is unavailable, tell the user which one is missing rather than standing in for it.

## Shrink the model before styling the prose

Style cannot save an oversized model. Before rewording anything, ask: **are these concepts oversized for the system they describe?** Mechanisms nobody exercises, relations nobody queries, history a VCS already keeps — delete them from the model and let Git hold the past. Half of a rewrite's value routinely comes from this deletion, and no wording delivers it.

## Diagnose before treating

Unreadable docs come in three kinds, and the first two take opposite cures — decide which you're holding before editing:

1. **Hollow abstraction.** Verdict words — 解耦、闭环、赋能, "flexible", "robust" — that no reader could prove wrong from the code. A claim that can't lose is what gets written when the writer hasn't traced the calls: it is a comprehension gap wearing a suit. Cure: trace the code and anchor the claim (below). Rewording is not a cure.
2. **Precise but unanchored ontology.** Project-coined terms with rigorous definitions, zero examples, zero motivation — findable nowhere on earth outside this corpus. The terms are **load-bearing**; cure by adding what's missing — operational definitions, a worked example, a task-shaped entry — keeping every term that survives the shrink above.
3. **Drift.** A long-lived corpus AI co-writes slides toward an implied reader of "the AI plus its validator": an inline patch at every misunderstanding site, disclaimers multiplying, one concept under three names. Cure: the corpus-wide sweep — re-run these rules as a checklist over every file; an inline patch at the misunderstanding site is how the drift happened.

When a naming decision must land across the whole corpus at once — merging near-synonyms, retiring a metaphor coin, translating jargon into the corpus language — run the procedure in [RENAME.md](RENAME.md). Editing site by site is how split names happen.

## Writing rules

**Anchor every architectural claim** to code coordinates — file, class, function, a real call chain — so the reader could falsify it:

> ✗ 本模块通过引入抽象层实现了扫描控制与上层业务的解耦，提升了可维护性与可扩展性。
>
> ✓ TIF 会话只通过 `ScanControlClient`（`dvb-input-app/src/session/ScanControlClient.kt`）触发扫描，不直接绑定 `dvb-scan-engine` 的 AIDL 服务；换扫描引擎时只改 `ScanControlClient` 的实现，会话代码不动。

A claim you cannot anchor is a comprehension gap: go read the code, then write.

- **One worked example beats rewriting the rules.** When a corpus fails its readers, build or repair one complete worked example before touching the rule text: filled in end to end, passing the project's own validation where one exists, entered by task（「我要做 X → 看这几个文件」）, with known traps flagged at the spot readers hit them.
- **Rule, why, instance.** Beside each stated rule, a quote block gives the reason and links one real instance — the shape of「**它为什么是原子**：内部确实分三块，但没有一块有独立消费者或兼容周期——只能一起交付」.
- **Concrete first, name last.** Give the problem and the calls, then let the term arrive as a name for what the reader already understands.
- **Motivation in human terms.** Open with the problem as someone outside the team meets it —「客服无法区分是天线问题、线路衰减还是运营商侧问题」outranks any capability statement.
- **One concept, one name — and one name, one job.** Pin it; in bilingual corpora annotate the pair on first occurrence — 接缝 (seam) — write one language thereafter, and record the pair in the corpus's term table (created at the first pair if none exists). A synonym merge runs both directions: collapsing 播放导航偏好 + 当前播放组 into 当前播放分组 is half done until you check the survivor wasn't already carrying a second sense — the stored preference had to split off as 当前播放分组偏好. The human-facing glossary holds only coins that survive; domain vocabulary lives in the AI-facing term table, not copied.
- **The plain description outranks the coin.** Before coining, try saying what the thing does: 乐观并发控制 → 「提交时校验版本号，过期整体拒绝」; 受控入口 → 签名保护的显式入口; no-playable state → 无可播放频道状态. A coin earns its place only when its plain expansion is too long to repeat. Metaphor coins (投影、权威、受控) die first — they say what a thing is like, not what it does; replace with the mechanism or the observation.
- **The language boundary follows the machine surface.** In bilingual corpora, whatever a validator or a grep must match keeps its original language — IDs, component/API/package/table names, enum values, normative keywords (SHALL, GIVEN/WHEN/THEN, handled/unhandled). Narration follows the reader's language, and each translated term brackets its original at the doc's first use: 接收命令（Reception Command）.
- **A recurring abstract word is either hollow or load-bearing — test it before touching it.** Strike the word and see what breaks: if a decision procedure elsewhere depends on it（演进闭环 deciding 交付单元 vs 实现模块）, it is load-bearing — keep it, and beside its first use give an **operational definition** (the observable facts that decide a case:「有自己的消费者、自己的兼容周期」decides membership where restating the abstraction cannot) plus one worked instance. If striking it only shortens the sentence, it was hollow — anchor the claim or drop the sentence.
- **Short sentences carry rules.** A sentence the reader must re-parse is a bug: split anything past ~60 characters over three-plus clauses (Chinese tech prose), never chain three negations（不 X、不 Y、不 Z）— state the positive rule instead — and treat a table cell as a reading unit, not a clause warehouse.

## Before you ship

A writing pass is done when, for every doc touched: the reader baseline stands in the opening lines; every architectural claim is anchored; every load-bearing term has an operational definition and a linked instance; the entry point is organized by the reader's task. After an overhaul of corpus scale, run [FRESH-READER-TEST.md](FRESH-READER-TEST.md): the session that wrote the docs knows too much to judge them.
