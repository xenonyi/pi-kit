# Corpus Rename Procedure

How a term decision lands everywhere at once: merging near-synonyms, retiring a metaphor coin, translating jargon into the corpus language. Find-replace across files is the last step, not the procedure.

## Before touching files

1. **Fix the target naming set first** — every old term mapped to its replacement, chosen by SKILL.md's naming rules (plain description outranks the coin; one concept one name, one name one job). A rename executed before the target set is settled produces split names by design.
2. **Pin protected tokens** — IDs, component/API/package/table names, enum values, normative keywords. List them explicitly. A replacement that would touch a protected token is a model change wearing a wording costume — stop and reconsider the rule, don't widen the match.
3. **Time it before the chain closes — and if it already closed, migrate deliberately.** Landing a rename before content merges into long-term docs or traceability chains (requirement IDs, cross-doc contracts) is the cheap moment. When the chain already holds the old term, the rename is still legal: enumerate every reference the old term reaches, migrate the editable ones in the same pass, leave protected identifiers untouched, and put immutable history (quoted decisions, frozen docs) itemized on the keep-list. AI-facing files follow the domain-modeling division as everywhere in this skill.

## Execute

4. Replace **longest-first, most-specific-first**（受控显式组件启动 before 受控入口）; where a shorter term is a prefix of a longer one, use lookahead or order so you never half-replace a compound.
5. Bracket at first occurrence **only what stays bilingual** — a translation keeps its original as the doc's first-use pair（接收命令（Reception Command））, per SKILL.md's naming rule, once per doc. A same-language retirement deletes the old name outright; the bracket is not a lifeboat that re-imports a ghost term（签名保护的显式入口（受控入口）✗）.
6. Expect the **compound failure modes**; check for each afterward:
   - **Nested brackets** — a first-occurrence bracket inserted, then a later rule matches inside it: 播放恢复上下文（播放恢复上下文（…））.
   - **Self-merge collisions** — two old terms collapsing onto one new term meet in the same sentence: 当前播放分组读取当前播放分组. No global rule fixes these; repair per sentence, splitting senses if the survivor now does two jobs.
   - **Glued morphology** — an English plural or suffix left welded to Chinese: 扫描暂存区s.
   - **Spacing debris** — spaces that flanked a deleted English term now sit between two CJK characters.

## Gate

The rename is done when all three hold:

7. **Zero residuals** — grep every retired term across scope; each hit is fixed or sits on a written keep-list of intentional survivors (protected tokens, quoted history, the bracketed original of a kept bilingual pair).
8. **Structural counts unchanged** — requirement/heading/keyword counts before and after match exactly. A rename that changes counts ate structure.
9. The fresh-reader test's friction question, re-aimed at the renamed terms, reports no unexplained survivors.
