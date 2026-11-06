# Fresh-Reader Test

The acceptance gate for human-facing docs: a zero-context subagent plays the doc's declared reader and answers questions from the docs alone. Self-review from the writing session is structurally blind — that session holds every piece of background the docs might omit, so it can simulate no one's ignorance. A verdict counts only when it comes from a reader who genuinely lacks the context.

## Setup

- Spawn a subagent that inherits nothing from the conversation, on a **weaker model** than the writing session (Haiku-class). A weaker model is a stricter exam: capability must not compensate for what the docs fail to say. If the spawn rate-limits (429), switch model or agent type and retry.
- Its reading set is exactly the doc corpus under test — real file paths, no summaries of them, no source code. The test measures whether the docs carry themselves.

## Write the exam

Cover four question types, at least one each, aimed where the corpus has been fuzzy — load-bearing terms, recently rewritten areas, spots earlier readers stumbled:

1. **Concept retell** —「依据文档，术语 X 指什么？找不到定义就明说。」
2. **Classification scenario** — a borderline case the corpus's own criteria must decide（五个 APK 算几个实现模块？内部分三块还算原子吗？）.
3. **Procedure scenario** — a task the docs claim to support; the reader lists the concrete steps and where each step's instruction lives.
4. **Friction report** — terms never explained; answers stitched across multiple files (and how many); places the corpus contradicts itself; for bilingual corpora, where switching languages cost them.

## Grade

Grade the answers in the writing session — you hold the ground truth the reader lacks. Every miss is a doc defect, never a reader defect — map each:

| The reader… | The doc defect |
| --- | --- |
| found no definition | missing operational definition |
| answered right but stitched N files | co-location / entry-point failure |
| answered wrong while citing real text | the cited text misleads |
| guessed without citing | the docs failed silently — the worst outcome |

Pass: every retell and scenario question answered correctly with citations, and no friction item you are unwilling to ship with.

## Prompt template

Write the exam in the corpus's own language; the template below is the Chinese form — keep its rules, translate its frame for other corpora.

```text
你将扮演一位读者来验收一套文档。你的背景：{READER_BASELINE，抄文档开头声明的读者基线，例如：懂 Android 基础，完全不了解本项目}。

只允许阅读以下文档，把它们当作你了解本项目的全部来源。不要读代码，不要用你自己的经验补文档的洞：
{DOC_PATHS}

回答下面的问题。规则：
- 每个答案注明依据的 file:line。
- 文档回答不了的问题，直接说「文档回答不了」，并列出你找过的位置。答不出来是最有价值的数据；猜出来的答案是最有害的。
- 最后提交一份卡点报告：哪些词从头到尾没解释过；哪个答案要跨几个文件拼出来（列出文件数）；文档自相矛盾的地方；{双语语料附加：中英对照让你付出代价的地方}。

问题：
{QUESTIONS — 概念复述 / 分类场景 / 流程场景，各至少一道}
```
