# pi-kit

个人 [pi](https://pi.dev) 配置集合。仓库以单个 package 分发扩展、技能与提示词规则，pi 直接加载 TypeScript 源码，不需要构建。

## 快速开始

```sh
pnpm install     # 安装依赖
pnpm tsc         # 类型检查
```

`package.json` 的 `pi` 字段显式列出默认加载的扩展入口，并加载 `skills/` 下的技能。

## 扩展

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| `pi-antigravity-acp-provider` | Google Antigravity ACP provider（含错误恢复、预热、长会话滚动与配额复用优化） | [README](./extensions/pi-antigravity-acp-provider/README.md) |
| `pi-ask-user-question` | `ask_user_question` 工具：向用户提一个阻塞问题（自由文本、单选、多选），只在 TUI 会话里声明 | [README](./extensions/pi-ask-user-question/README.md) |
| `pi-btw` | `/btw` 命令：旁支提问不污染会话历史，答案只出现在临时面板，只在 TUI 会话里注册 | [README](./extensions/pi-btw/README.md) |
| `pi-herdr` | 把 herdr-app 窗口与 `hc` 的常用操作固化成 `herdr_*` 工具和 `/herdr` 命令，默认不加载 | [README](./extensions/pi-herdr/README.md) |
| `pi-lsp` | 按文件扩展名路由语言服务器，提供 `lsp_diagnostics` 和 `lsp_fix` | [README](./extensions/pi-lsp/README.md) · [配置](./extensions/pi-lsp/docs/settings.md) |
| `pi-mcp` | 从 `servers.json` 注册 MCP 服务器，缺少环境变量的条目自动跳过 | [README](./extensions/pi-mcp/README.md) |
| `pi-rules` | 按环境条件注入 `rules/` 下的短规则，详细流程由 skill 按需加载 | [README](./extensions/pi-rules/README.md) |

## 技能

| 技能 | 用途 |
| --- | --- |
| [handoff](./skills/handoff/SKILL.md) | 把当前会话整理成交接文档，保存到系统临时目录 |
| [orchestrator](./skills/orchestrator/SKILL.md) | 手动调用，由主会话指挥单个执行者完成开发任务；执行者模型与职责由角色文件定义 |
| [code-review](./skills/code-review/SKILL.md) | 从需求、规范与设计、安全与可靠性三个方向审查提交或工作区变更 |
| [codebase-design](./skills/codebase-design/SKILL.md) | 设计深模块，评估接口、接缝和可测试性 |
| [domain-modeling](./skills/domain-modeling/SKILL.md) | 明确领域术语，维护词汇表，并按需记录架构决策 |
| [research](./skills/research/SKILL.md) | 委派后台 agent 查证一手资料，将结论写入仓库 |
| [grilling](./skills/grilling/SKILL.md) | 按决策依赖分轮追问，压力测试计划或想法 |
| [grill-me](./skills/grill-me/SKILL.md) | 调用 `grilling` 的快捷入口 |
| [grill-with-docs](./skills/grill-with-docs/SKILL.md) | 调用 `grilling` 和 `domain-modeling`，边追问边记录设计 |
| [herdr-core](./skills/herdr-core/SKILL.md) | 使用 `hc` 协调 agent、管理终端和后台任务，并查阅 Herdr 窗口操作说明 |
| [writing-great-skills](./skills/writing-great-skills/SKILL.md) | 编写和编辑 skill 的术语与原则 |
| [humanize-tech-docs](./skills/humanize-tech-docs/SKILL.md) | 面向读者改写技术文档，补足实例和术语说明 |
| [web-research](./skills/web-research/SKILL.md) | 使用 context7、deepwiki 或 exa 检索资料，核对正文并标注来源 |
| [zh-tech-writing](./skills/zh-tech-writing/SKILL.md) | 中文技术文档的措辞、结构和排版规范 |

## 规则片段

`rules/` 存放 Markdown 短规则。`pi-rules` 按 `os`、`host`、`cwd`、`tools` 条件，把命中的规则注入系统提示词的 `<rules>` 段。详细流程放在 `skills/` 里，规则只保留常驻约束。

- `rules/shared/`：所有机器通用的授权、偏好、判断、交付与文档维护约定。
- `rules/machines/`：按机器条件生效的环境约束（`windows.md`）。
