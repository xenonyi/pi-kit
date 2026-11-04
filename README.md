# pi-kit

个人 [pi](https://pi.dev) 配置集合。仓库以单个 package 分发扩展、技能与提示词规则，pi 直接加载 TypeScript 源码，不需要构建。

## 快速开始

```sh
pnpm install     # 安装依赖
pnpm tsc         # 类型检查
```

`package.json` 的 `pi` 字段声明入口：`extensions/*/index.ts` 和 `skills/`。

## 扩展

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| `pi-ask-user-question` | `ask_user_question` 工具：向用户提一个阻塞问题（自由文本、单选、多选），只在 TUI 会话里声明 | [README](./extensions/pi-ask-user-question/README.md) |
| `pi-btw` | `/btw` 命令：旁支提问不污染会话历史，答案只出现在临时面板，只在 TUI 会话里注册 | [README](./extensions/pi-btw/README.md) |
| `pi-herdr` | 把 herdr-app 窗口与 `hc` 的常用操作固化成 `herdr_*` 工具和 `/herdr` 命令 | [README](./extensions/pi-herdr/README.md) |
| `pi-lsp` | 按文件扩展名路由语言服务器，提供 `lsp_diagnostics` 和 `lsp_fix` | [README](./extensions/pi-lsp/README.md) · [配置](./extensions/pi-lsp/docs/settings.md) |
| `pi-mcp` | 从 `servers.json` 注册 MCP 服务器，缺少环境变量的条目自动跳过 | [README](./extensions/pi-mcp/README.md) |
| `pi-rules` | 按环境条件注入 `rules/` 下的短规则，详细流程由 skill 按需加载 | [README](./extensions/pi-rules/README.md) |

## 技能

- `skills/grill`：分轮追问并压力测试计划、决定或想法，暴露重要未知后再执行。
- `skills/web-research`：检索外部资料。按任务选择 context7、deepwiki 或 exa，核对正文并标注来源。
- `skills/herdr-app`：herdr-app 窗口与 herdr-core（`hc`）的操作入口。启动、读取、等待终端与 agent 用 `herdr_*` 工具，调整 space、tab、pane 与焦点用 `herdr_ui`。新建终端默认拆出一个 pane。
- `skills/herdr-app-handoff`：把任务连同上下文移交给 herdr-core 里的新终端 agent，或已有的 idle agent，交完不等待、不轮询。`herdr_start` 返回的 `outliveParent` 必须为 true，新终端才能在本会话退出后存活，用户可以随时接管。

## 规则片段

`rules/` 存放 Markdown 短规则。`pi-rules` 按 `os`、`host`、`cwd`、`tools` 条件，把命中的规则注入系统提示词的 `<rules>` 段。详细流程放在 `skills/` 里，规则只保留常驻约束。

- `rules/shared/`：所有机器通用的授权、偏好、判断、交付与文档维护约定。
- `rules/machines/`：按机器条件生效的环境约束（`windows.md`）。

### 跨模型规则

以下片段合并了 GPT with Taste 中主代理、子代理和事件提醒的共同行为，去掉固定人设与宿主工具细节。正文不依赖具体模型或工具名称，默认由 `pi-rules` 加载。

| 片段 | 约束 |
| --- | --- |
| [目标与判断](./rules/shared/03-judgment.md) | 明确目标和完成条件，给出推荐，处理阻塞并恢复任务上下文 |
| [实施与验收](./rules/shared/04-delivery.md) | 复用现有能力，保留兼容契约，按证据修复并验收实际产物 |
| [协作与交接](./rules/shared/05-collaboration.md) | 明确负责人和授权边界，整合结果，只传递影响行动的信息 |
| [表达与证据](./rules/shared/06-communication.md) | 先给结论，按证据强度表述，删去空话并说明真实缺口 |

这些质量要求不扩大操作权限。[默认偏好](./rules/shared/01-preferences.md) 中的授权、测试和依赖安装限制仍然适用。

来源：[GPT with Taste 的 `prompts/`](https://github.com/NB-Corp/gpt-with-taste/tree/079fb262b4d7932515ba4e6341fd57b6f2122f4a/prompts)（提交 `079fb26`，2026-10-17）。上游使用 MIT License，许可原文见 [LICENSE.gpt-with-taste](./rules/LICENSE.gpt-with-taste)。
