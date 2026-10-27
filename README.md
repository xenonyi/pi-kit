# pi-kit

个人 [pi](https://pi.dev) 配置集合：以单个 package 分发扩展、技能与提示词规则，由 pi 直接加载 TypeScript 源码，无构建步骤。

## 快速开始

```sh
pnpm install     # 安装依赖
pnpm tsc         # 类型检查
```

`package.json` 的 `pi` 字段声明入口：`extensions/*/index.ts` 与 `skills/`。

## 扩展

| 扩展 | 说明 | 文档 |
| --- | --- | --- |
| `pi-ask-user-question` | `ask_user_question` 工具：向用户提一个阻塞问题（自由文本 / 单选 / 多选），仅在 TUI 会话声明 | [README](./extensions/pi-ask-user-question/README.md) |
| `pi-btw` | `/btw` 命令：不污染会话历史的旁支提问，答案只在临时面板，仅在 TUI 会话注册 | [README](./extensions/pi-btw/README.md) |
| `pi-fold-runs` | 把连续的工具调用折成一行摘要，点击逐级展开成 Pi 原生卡，仅 TUI 生效 | [README](./extensions/pi-fold-runs/README.md) |
| `pi-hashline-edit` | `hash_read` / `hash_edit`：行锚点 + sha256 revision 校验的读取与原子行编辑 | [README](./extensions/pi-hashline-edit/README.md) |
| `pi-lsp` | 按文件扩展名路由语言服务器，提供 `lsp_diagnostics` 与 `lsp_fix` | [README](./extensions/pi-lsp/README.md) |
| `pi-mcp` | 从 `servers.json` 注册 MCP 服务器，缺环境变量的条目自动跳过 | [README](./extensions/pi-mcp/README.md) |
| `pi-rules` | 把 `rules/` 下的 Markdown 片段按条件注入系统提示词 | [README](./extensions/pi-rules/README.md) |

## 技能

- `skills/grill` — 分轮追问并压力测试计划、决定或想法，暴露重要未知后再执行。

## 规则片段

`rules/` 存 Markdown 规则片段，由 `pi-rules` 按 `os` / `host` / `cwd` / `tools` 条件注入系统提示词：

- `rules/shared/` — 所有机器通用（`00-authorization.md`、`10-preferences.md`）
- `rules/machines/` — 按机器条件生效（`windows.md`）

## 开发

- 用 pnpm；依赖、脚本与唯一的 `package.json` 都在根目录，`pnpm-lock.yaml` 只由 pnpm 维护
- `extensions/<name>/`：`index.ts` 入口 + `src/*.ts`
- 文档写法见 [docs/readme-convention.md](./docs/readme-convention.md)，仓库约定见 [AGENTS.md](./AGENTS.md)
