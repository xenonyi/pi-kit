# pi-lsp

按文件扩展名把请求路由到可配置语言服务器的 LSP 扩展，提供 `lsp_diagnostics`（诊断）与 `lsp_fix`（源码操作）。

## 使用

- `lsp_diagnostics`：`paths`（文件或目录，默认工作区根）、`root`（工作区根，默认会话 cwd）、`limit`（每个服务器最多打开的文件数，默认 50）、`server`（服务器名或名称数组）。
- `lsp_fix`：`path`、`root`、`kind`（源码操作，默认 `source.fixAll`）、`write`（默认 `false`，仅返回预览）、`server`（同一扩展被多个服务器匹配时必须显式指定）。
- `/lsp`：显示已配置服务器的启动命令及其在 `PATH` 上的可用性。

先在建仓的 `AGENTS.md` 记录权威的格式化、lint、类型检查、构建和测试命令；pi-lsp 只提供编辑过程中的定向反馈，不能替代这些校验。

## 内置服务器

不写配置时默认启用 8 个服务器，各自需要提前安装命令（pi-lsp 不下载任何服务器）：

| 服务器 | 覆盖 | 安装/前提 |
| --- | --- | --- |
| `biome` | TS/JS/JSON/CSS/HTML/Vue/Astro/Svelte/GraphQL | 安装 biome |
| `ty` | `.py .pyi`（类型） | `uv tool install ty` |
| `ruff` | `.py .pyi`（lint/修复） | `uv tool install ruff` |
| `csharp` | `.cs .csx` | `dotnet tool install --global roslyn-language-server`；工作区需有 `.sln`/`.csproj` |
| `clangd` | C/C++ 源与头文件 | 建议提供 `compile_commands.json` 或 `compile_flags.txt` |
| `yaml-language-server` | `.yaml .yml` | `npm i -g yaml-language-server` |
| `lua-language-server` | `.lua` | 安装发行包 |
| `bash-language-server` | `.sh .bash` | `npm i -g bash-language-server` |

`.py`/`.pyi` 同时命中 `ty` 与 `ruff`：诊断会跑两条互补路由，`lsp_fix` 必须显式传 `server`（例如 `"ruff"`）。内置默认命令缺失时诊断跳过并提示；显式指定的命令缺失则报错。

## 配置

配置顺序：`<workspace>/.pi/pi-lsp.json`（仅在项目被信任时）→ `~/.pi/agent/pi-lsp.json` → 内置服务器目录。自定义配置整体替换内置目录，不做合并；需要 protobuf 等额外服务器时把要用的条目一并写入。旧文件名 `lsp.json` 不再读取。

```json
{
  "ruff": {
    "command": ["ruff", "server"],
    "extensions": [".py", ".pyi"]
  }
}
```

需要全局选项（如 `timeout`）时使用 `servers` 包装形状。服务器条目支持 `command`、`extensions`、`env`、`initialization`、`skipDirectories`、`diagnosticsSettleMs`、`pushDiagnosticsGraceMs`、`pullDiagnosticsGraceMs`；完整字段说明、8 项默认配置和追加 protobuf 的示例见 [docs/settings.md](./docs/settings.md)。

## 行为

- 每次工具调用启动服务器，调用结束即关闭，不保留编辑器式增量会话。
- 取消会停止当前服务器；会话关闭或切换会中止并等待该会话的全部调用。写入完成后不会因后续取消而回滚。
- Windows 下无扩展名的命令按生效的 `PATH` 与子进程 cwd 解析，`.cmd`/`.bat` 通过 `%ComSpec%` 启动。

## 安全

- 服务器命令以 Pi 的权限运行并继承 Pi 环境，再叠加 `servers[].env`；项目配置只在项目被信任时使用。请审查每条配置的命令、参数、环境变量和初始化选项。

## 来源

合并自 [narumiruna/pi-extensions 的 packages/pi-lsp](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-lsp)（上游 `1d1f8fe`，MIT），改为本仓库直载 TypeScript 源码、无需构建步骤，并按本机语言栈裁剪了内置服务器目录。许可证见 [LICENSE](./LICENSE)。
