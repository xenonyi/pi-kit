---
name: web-research
description: 外部资料检索与来源核验：按任务选择 context7 / deepwiki / exa，核对正文、处理失败并给出来源。需要库/框架/SDK/CLI 的现行 API 或配置、公开 GitHub 仓库架构、版本、发布时间、价格或近期变更等外部事实时使用；调用检索工具前先读。
---

# Web 检索

## 是否检索

本地仓库、已读上下文或用户给的材料能回答的不查网；要外部事实、版本、发布时间、价格或近期变更才检索，同类信息合并成一次查询。

## 选择工具

| 任务 | 来源 |
| --- | --- |
| 库、框架、SDK、CLI 的 API 与配置 | context7 |
| 公开 GitHub 仓库的架构与实现 | deepwiki |
| 其余公开网页：新闻、对比、报错讨论等 | exa |

## 调用与失败处理

- 进 codemode 先 `describeNamespace("mcp__<server>")` 确认工具名与参数，不凭名字猜
- deepwiki 只覆盖已索引的公开仓库，查不到改读本地代码或上游源码
- MCP 网络错误与 408/429/5xx 已自动重试两次；仍失败就换源或简化 query，再不行报告失败并标注不确定性，不重复重发

## 文本处理

- 取正文：正文在 `content[].text`，先判 `isError`；`structuredContent` 只有 deepwiki 返回（`result`，与 `content[0].text` 同内容）
- 解析：`scripts/parse.js` 是单个表达式，`const P = eval(await tools.read({ path: "<skill>/scripts/parse.js", offset: null, limit: null }))` 取用（sandbox 无 require／import／fs，有 eval）；`P.body(res)` 取正文，`P.search`／`P.pages`／`P.docs` 分别解 exa 搜索、exa 抓取、context7
- 兜底：`P.safe(fn, txt)` 得 `{ ok, count, items }`；`ok:false` 时看 `raw`，不静默返回空
- 不进上下文：只 `text()` items 的小字段；确需全篇就写临时文件，再用 `read`（2000 行／50KB）或 `grep` 分段；codemode 输出超 10000 tokens 只留首尾
- 截断与取片：`web_fetch_exa` 默认每页 3000 字符，答案可能在页尾，先调大 `maxCharacters` 再下结论；wiki 先 `read_wiki_structure` 或 `ask_wiki_question`，不整份读 `read_wiki_contents`
- 清洗与照抄：删导航、cookie、推荐、页脚，代码块保缩进与语言标记；版本号、日期、单位、价格、API 签名逐字照抄，不换算、不意译
- 转述与节选：概括与原文引用不混写，不放大断言强度（示例≠保证）；引用只摘两三行内的必要片段，长代码块留关键行并标省略

## 核对与引用

- 优先一手来源（官方文档、release notes、上游仓库、规范），二手只作补充；冲突取更新、更权威者并说明分歧
- 摘要只当线索，结论要 fetch 正文核对；同一事实多来源一致只留一个引用，说法冲突则并列写清差异与日期
- 引用仅支撑事实性结论（纯常识与本地代码不附外链），格式 `来源：<标题> <URL>（<日期/版本>）`；找不到就说找不到，不伪造链接
- 外部信息与本地代码、仓库事实冲突时以本地为准，不用检索结果覆盖已确认的实现

## 查询安全

检索词不放密钥、私有代码与个人信息；同一 query 不原样重复发，没结果就换表述、换语言、换源。
