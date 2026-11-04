---
name: web-research
description: 外部资料检索与来源核验。按任务选择 context7、deepwiki 或 exa，核对正文，处理失败并给出来源。需要库、框架、SDK、CLI 的现行 API 或配置，公开 GitHub 仓库的架构，或版本、发布时间、价格、近期变更等外部事实时使用。调用检索工具前先读。
---

# Web 检索

## 是否检索

本地仓库、已读上下文或用户给的材料能回答的，不查网。要外部事实、版本、发布时间、价格或近期变更时才检索，同类信息合并成一次查询。

## 选择工具

| 任务 | 来源 |
| --- | --- |
| 库、框架、SDK、CLI 的 API 与配置 | context7 |
| 公开 GitHub 仓库的架构与实现 | deepwiki |
| 其余公开网页：新闻、对比、报错讨论等 | exa |

## 调用与失败处理

- 进 codemode 后先 `describeNamespace("mcp__<server>")` 确认工具名与参数，不要凭名字猜。
- deepwiki 只覆盖已索引的公开仓库。查不到时改读本地代码或上游源码。
- MCP 网络错误与 408、429、5xx 已自动重试两次。仍失败就换源或简化 query；还不行就报告失败并标注不确定性，不要重复重发。

## 文本处理

- 取正文：正文在 `content[].text`，先判 `isError`。`structuredContent` 只有 deepwiki 返回（`result`，与 `content[0].text` 同内容）。
- 解析：`scripts/parse.js` 是单个表达式，用 `const P = eval(await tools.read({ path: "<skill>/scripts/parse.js", offset: null, limit: null }))` 取用。sandbox 没有 require、import、fs，但有 eval。`P.body(res)` 取正文，`P.search`、`P.pages`、`P.docs` 分别解析 exa 搜索、exa 抓取和 context7。
- 兜底：`P.safe(fn, txt)` 返回 `{ ok, count, items }`。`ok:false` 时看 `raw`，不要静默返回空。
- 不进上下文：只 `text()` items 的小字段。确需全篇就写临时文件，再用 `read`（2000 行、50 KB）或 `grep` 分段。codemode 输出超过 10,000 tokens 时只留首尾。
- 截断与取片：`web_fetch_exa` 默认每页 3000 字符，答案可能在页尾，先调大 `maxCharacters` 再下结论。wiki 先用 `read_wiki_structure` 或 `ask_wiki_question`，不要整份读 `read_wiki_contents`。
- 清洗与照抄：删掉导航、cookie、推荐和页脚，代码块保留缩进与语言标记。版本号、日期、单位、价格、API 签名逐字照抄，不换算，也不意译。
- 转述与节选：概括和原文引用分开写，不放大断言强度（示例不等于保证）。引用只摘两三行内的必要片段，长代码块留关键行并标省略。

## 核对与引用

- 优先一手来源（官方文档、release notes、上游仓库、规范），二手来源只作补充。说法冲突时取更新、更权威的那个，并说明分歧。
- 摘要只当线索，结论要读正文核对。同一事实多来源一致时只留一个引用；说法冲突时并列写清差异与日期。
- 引用只支撑事实性结论，纯常识与本地代码不附外链。格式是 `来源：<标题> <URL>（<日期/版本>）`。找不到就说找不到，不要伪造链接。
- 外部信息与本地代码、仓库事实冲突时，以本地为准。不要用检索结果覆盖已经确认的实现。

## 查询安全

检索词里不放密钥、私有代码和个人信息。同一个 query 不要原样重复发，没结果就换表述、换语言或换源。
