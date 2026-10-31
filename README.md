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
| `pi-hashline-edit` | `hash_read` / `hash_edit`：行锚点 + sha256 revision 校验的读取与原子行编辑 | [README](./extensions/pi-hashline-edit/README.md) |
| `pi-lsp` | 按文件扩展名路由语言服务器，提供 `lsp_diagnostics` 与 `lsp_fix` | [README](./extensions/pi-lsp/README.md) |
| `pi-mcp` | 从 `servers.json` 注册 MCP 服务器，缺环境变量的条目自动跳过 | [README](./extensions/pi-mcp/README.md) |
| `pi-rules` | 按环境条件注入 `rules/` 下的短规则，详细流程由 skill 按需加载 | [README](./extensions/pi-rules/README.md) |

## 技能

- `skills/grill` — 分轮追问并压力测试计划、决定或想法，暴露重要未知后再执行。
- `skills/web-research` — 外部资料检索：选择 context7 / deepwiki / exa，核对正文、处理失败并标注来源。
- `skills/herdr-app` — herdr-app 窗口 + herdr-core（`hc`）操作入口：干活走 `hc`，改 space / tab / pane 与焦点走 `herdr-app do`，开终端默认拆 pane；命令与参数运行时查 CLI。
- `skills/herdr-app-handoff` — 把任务移交给 herdr-core 里的新终端 agent（或已有 idle agent），交完不等、不轮询；用 `--outlive-parent` + `terminal.keep` 保证用户能接管。

## 规则片段

`rules/` 存 Markdown 短规则，由 `pi-rules` 按 `os` / `host` / `cwd` / `tools` 条件注入系统提示词的 `<rules>` 段；详细流程放进 `skills/`，必要时由规则要求先读取对应 skill：

- `rules/shared/` — 所有机器通用的授权、偏好、提问约束与 Web 检索路由；提问通过普通聊天进行，一次一问并等待回答，不使用弹窗
- `rules/machines/` — 按机器条件生效的环境约束（`windows.md`）

## 开发

- 用 pnpm；依赖、脚本与唯一的 `package.json` 都在根目录，`pnpm-lock.yaml` 只由 pnpm 维护
- `extensions/<name>/`：`index.ts` 入口 + `src/*.ts`
- 文档写法见 [docs/readme-convention.md](./docs/readme-convention.md)，仓库约定见 [AGENTS.md](./AGENTS.md)
