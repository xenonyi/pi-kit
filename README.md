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
| `pi-btw` | `/btw` 命令：不污染会话历史的旁支提问，答案只在临时面板，仅在 TUI 会话注册 | [README](./extensions/pi-btw/README.md) |
| `pi-herdr` | Herdr 机械层：拆 pane、起 agent、归一化状态读取与透传；只在 herdr pane 内声明 | [README](./extensions/pi-herdr/README.md) |
| `pi-hashline-edit` | `hash_read` / `hash_edit`：行锚点 + sha256 revision 校验的读取与原子行编辑 | [README](./extensions/pi-hashline-edit/README.md) |
| `pi-lsp` | 按文件扩展名路由语言服务器，提供 `lsp_diagnostics` 与 `lsp_fix` | [README](./extensions/pi-lsp/README.md) |
| `pi-mcp` | 从 `servers.json` 注册 MCP 服务器，缺环境变量的条目自动跳过 | [README](./extensions/pi-mcp/README.md) |
| `pi-rules` | 把 `rules/` 下的 Markdown 片段按条件注入系统提示词 | [README](./extensions/pi-rules/README.md) |

## 技能

- `skills/grill` — 分轮追问并压力测试计划、决定或想法，暴露重要未知后再执行。
- `skills/herdr` — Herdr 操作入口：先查 `herdr_*` 工具，未覆盖的走 `herdr_cli` 透传，flag 以 `herdr --skill` 为准。
- `skills/herdr-handoff` — 把任务连同上下文移交给另一个 Herdr agent pane；交完不等、不轮询。

## 规则片段

`rules/` 存 Markdown 规则片段，由 `pi-rules` 按 `os` / `host` / `cwd` / `tools` 条件注入系统提示词：

- `rules/shared/` — 所有机器通用（`00-authorization.md`、`10-preferences.md`、`15-questions.md`、`20-web.md`）；提问通过普通聊天进行，一次一问并等待回答，不使用弹窗
- `rules/machines/` — 按机器条件生效（`windows.md`）

## 开发

- 用 pnpm；依赖、脚本与唯一的 `package.json` 都在根目录，`pnpm-lock.yaml` 只由 pnpm 维护
- `extensions/<name>/`：`index.ts` 入口 + `src/*.ts`
- 文档写法见 [docs/readme-convention.md](./docs/readme-convention.md)，仓库约定见 [AGENTS.md](./AGENTS.md)
