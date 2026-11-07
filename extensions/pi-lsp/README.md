# pi-lsp

LSP 扩展。按文件扩展名把请求路由到可配置的语言服务器，提供 `lsp_diagnostics`（诊断）和 `lsp_fix`（源码操作）。

## 使用

- `lsp_diagnostics`：参数有 `paths`（文件或目录，默认工作区根）、`root`（工作区根，默认会话 cwd）、`limit`（每个服务器最多打开的文件数，默认 50）、`server`（服务器名或名称数组）。
- `lsp_fix`：参数有 `path`、`root`、`kind`（源码操作，默认 `source.fixAll`）、`write`（默认 `false`，只返回预览）、`server`（多个服务器匹配同一扩展时必须显式指定）。
- `/lsp`：显示已配置服务器的启动命令，以及命令在 `PATH` 上是否可用。

先在仓库的 `AGENTS.md` 写清格式化、lint、类型检查、构建和测试命令。pi-lsp 只提供编辑时的定向反馈，不能替代这些校验。

## 内置服务器

不写配置时默认启用 8 个服务器。每个服务器都要提前安装，pi-lsp 不下载任何服务器：

| 服务器 | 覆盖 | 安装/前提 |
| --- | --- | --- |
| `biome` | TS、JS、JSON、CSS、HTML、Vue、Astro、Svelte、GraphQL | 安装 biome |
| `ty` | `.py .pyi`（类型） | `uv tool install ty` |
| `ruff` | `.py .pyi`（lint/修复） | `uv tool install ruff` |
| `csharp` | `.cs .csx` | `dotnet tool install --global roslyn-language-server`；工作区需有 `.sln` 或 `.csproj` |
| `clangd` | C 和 C++ 的源文件与头文件 | 建议提供 `compile_commands.json` 或 `compile_flags.txt` |
| `yaml-language-server` | `.yaml .yml` | `npm i -g yaml-language-server` |
| `lua-language-server` | `.lua` | 安装发行包 |
| `bash-language-server` | `.sh .bash` | `npm i -g bash-language-server` |

`.py` 和 `.pyi` 同时命中 `ty` 与 `ruff`。诊断会跑两条互补路由，`lsp_fix` 必须显式传 `server`（例如 `"ruff"`）。内置默认命令缺失时，诊断跳过该服务器并提示；显式指定的命令缺失时直接报错。

## 配置

配置顺序：`<workspace>/.pi/pi-lsp.json`（仅在项目被信任时）→ `~/.pi/agent/pi-lsp.json` → 内置服务器目录。自定义配置整体替换内置目录，不做合并。需要 protobuf 等额外服务器时，把要用的条目一并写入。

```json
{
  "ruff": {
    "command": ["ruff", "server"],
    "extensions": [".py", ".pyi"]
  }
}
```

需要全局选项（如 `timeout`）时，使用 `servers` 包装形状。服务器条目支持 `command`、`extensions`、`env`、`initialization`、`skipDirectories`、`diagnosticsSettleMs`、`pushDiagnosticsGraceMs` 和 `pullDiagnosticsGraceMs`。完整字段说明、8 项默认配置和追加 protobuf 的示例见 [docs/settings.md](./docs/settings.md)。

## 安全

- 服务器命令以 Pi 的权限运行，继承 Pi 环境，再叠加 `servers[].env`。项目配置只在项目被信任时使用。请审查每条配置的命令、参数、环境变量和初始化选项。

## 验证

在仓库根目录运行：

```sh
pnpm tsc
pnpm exec node --test extensions/pi-lsp/src/command.test.ts
```

回归测试覆盖命令解析，以及 Windows 批处理的参数转发和条件判断。检测到已安装的 Ruff 时，还会验证原生程序接收的参数。Windows 启动用例在其他平台跳过；测试文件只写入系统临时目录。

## 来源

合并自 [narumiruna/pi-extensions 的 packages/pi-lsp](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-lsp)（上游 `1d1f8fe`，MIT）。本仓库改为直接加载 TypeScript 源码，不需要构建，并按本机语言栈裁剪了内置服务器目录。许可证见 [LICENSE](./LICENSE)。
