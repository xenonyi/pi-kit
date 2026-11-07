# 检索工具

## context7

先用 `resolve_library_id` 确认库，再用 `query_docs` 查文档。用户已明确提供 `/org/project` 或 `/org/project/version` 格式的库 ID 时，可直接查询。

按包名、官方归属和目标版本选库，版本标识取自返回结果。目标版本未收录时，转查对应版本的官方文档。

每次文档查询只覆盖一个概念；问题本身涉及概念间关系时才合并。已知编程语言时传入 `language`，调用次数遵守当前工具声明。

返回的原文片段足以核验时直接使用；缺少定义、前置条件或异常行为时，沿 `Source` URL 补读原文。

## deepwiki

确认 `owner/repo`。问题明确时用 `ask_wiki_question`；需要定位模块时先用 `read_wiki_structure`，再定向提问。`read_wiki_contents` 留给确需整库文档的任务。

核验实现时，沿回答中的文件路径和符号读源码，并确认分支、tag 或 commit 是否匹配。仓库未索引或缺少目标版本时，转本地仓库或对应版本的上游源码。

## exa

单次查找用 `web_search_exa`。查询描述希望找到的页面，`objective` 指定优先来源、排除项和待提取事实。

已有 URL 就用 `web_fetch_exa`，多个 URL 合批读取。`maxCharacters` 限制每页正文长度；关键段落可能被截断时提高上限，或改读更具体的页面。

需要多轮检索、补齐名单或结构化对比时，用 `agent_run`，写清范围、产出数量和来源字段。按用户预算与当前工具声明选择工作量档位；显著增加费用前先确认。

保留任务返回的 `id`。仍在运行时，以 `runId` 续查同一任务；调用中断后也先续查已有任务。结合 `success`、`status`、`outputReady` 和 `error` 判断进度，结果就绪后再进入核验。
