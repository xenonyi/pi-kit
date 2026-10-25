# pi-lsp 配置参考

[返回 README](../README.md)

- [配置来源](#配置来源)
- [内置服务器](#内置服务器)
- [自定义服务器](#自定义服务器)
- [服务器与全局选项](#服务器与全局选项)

## 配置来源

pi-lsp 按以下顺序解析配置，命中即停止：

1. `<workspace>/.pi/pi-lsp.json`，仅在 Pi 信任当前项目时读取
2. `~/.pi/agent/pi-lsp.json`
3. 内置服务器目录

`root` 参数只决定文件范围和服务器工作目录，不授权该目录的项目配置；项目配置始终来自被信任的会话工作区。旧文件名 `lsp.json` 不再读取。

pi-lsp 不下载任何语言服务器，只启动已安装并位于 `PATH` 上的命令。内置默认命令缺失时，诊断跳过该服务器并提示；通过 `server` 显式指定或写进自定义配置的命令缺失则直接报错。

## 内置服务器

| 语言或格式 | 服务器 | 启动命令 | 扩展名 | 前提 |
| --- | --- | --- | --- | --- |
| JS/TS/JSON/CSS/HTML/Vue/Astro/Svelte/GraphQL | `biome` | `biome lsp-proxy` | `.js .jsx .mjs .cjs .ts .tsx .mts .cts .json .jsonc .css .html .vue .astro .svelte .graphql .gql` | 安装 biome |
| Python 类型 | `ty` | `ty server` | `.py .pyi` | `uv tool install ty` |
| Python lint 与修复 | `ruff` | `ruff server` | `.py .pyi` | `uv tool install ruff` |
| C# | `csharp` | `roslyn-language-server --stdio --autoLoadProjects` | `.cs .csx` | `dotnet tool install --global roslyn-language-server`；工作区需有 `.sln`/`.csproj` 才能自动加载项目 |
| C/C++ | `clangd` | `clangd --background-index --clang-tidy` | `.c .cc .cpp .c++ .cxx .h .hh .hpp .h++ .hxx` | 建议提供 `compile_commands.json` 或 `compile_flags.txt`，否则头文件与宏会报噪音 |
| YAML | `yaml-language-server` | `yaml-language-server --stdio` | `.yaml .yml` | `npm i -g yaml-language-server` |
| Lua | `lua-language-server` | `lua-language-server` | `.lua` | 安装发行包 |
| Bash | `bash-language-server` | `bash-language-server start` | `.sh .bash` | `npm i -g bash-language-server` |

`.py`/`.pyi` 会同时命中 `ty` 与 `ruff`：诊断跑两条互补路由，`lsp_fix` 必须显式传 `server`（例如 `server: "ruff"`），否则报多服务器错误。

## 自定义服务器

自定义配置整体替换内置目录，不做合并；需要保留默认服务器时把它们一并列出。下面的例子在内置 8 项之外追加 protobuf（`protols`），并用 `servers` 包装形状设置全局超时：

```json
{
  "timeout": 30000,
  "servers": {
    "biome": {
      "command": ["biome", "lsp-proxy"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".css", ".html"]
    },
    "ty": { "command": ["ty", "server"], "extensions": [".py", ".pyi"] },
    "ruff": { "command": ["ruff", "server"], "extensions": [".py", ".pyi"] },
    "csharp": {
      "command": ["roslyn-language-server", "--stdio", "--autoLoadProjects"],
      "extensions": [".cs", ".csx"],
      "skipDirectories": ["bin", "obj"]
    },
    "clangd": {
      "command": ["clangd", "--background-index", "--clang-tidy"],
      "extensions": [".c", ".cc", ".cpp", ".h", ".hh", ".hpp"],
      "skipDirectories": ["build"]
    },
    "yaml-language-server": { "command": ["yaml-language-server", "--stdio"], "extensions": [".yaml", ".yml"] },
    "lua-language-server": {
      "command": ["lua-language-server"],
      "extensions": [".lua"],
      "pushDiagnosticsGraceMs": 3000
    },
    "bash-language-server": { "command": ["bash-language-server", "start"], "extensions": [".sh", ".bash"] },
    "protols": { "command": ["protols"], "extensions": [".proto"] }
  }
}
```

不带 `timeout` 等全局选项时也可以直接用扁平形状（服务器名到配置的对象）：

```json
{
  "ruff": {
    "command": ["uv", "run", "--no-sync", "ruff", "server"],
    "extensions": [".py", ".pyi"]
  }
}
```

`servers` 是保留的顶层键，不能用它当服务器名。

## 服务器与全局选项

服务器条目支持：

- `command`：启动服务器的 argv 数组，第一个元素是命令，其余是参数（不经 shell 解析）。
- `extensions`：路由到该服务器的文件扩展名，带不带前导点都接受。
- `env`：子进程环境变量覆盖；子进程先继承 Pi 的环境，再叠加这些值，`env.PATH` 同时用于解析 `command[0]`。
- `initialization`：LSP `initializationOptions`，同时作为 `workspace/configuration` 中对应 section 的返回值。
- `skipDirectories`：递归发现时额外跳过的目录名，只接受单级目录名（不含路径分隔符）；显式请求的路径不受影响。
- `diagnosticsSettleMs`：最后一次 push 诊断后的静默期（毫秒），默认 800。适合"先发空集、稍后发真实诊断"的服务器，例如自配 `intelephense` 时需要 4000。
- `pushDiagnosticsGraceMs`：只发 push 诊断的服务器在干净文档上可能一直不发通知，此值限定最长等待。内置 Lua 用 3000；自配 Dart/Terraform/Gleam/Tinymist 这类服务器建议 2000。
- `pullDiagnosticsGraceMs`：服务器返回空 pull 结果后，再等一次更新的 push 通知。自配 `rust-analyzer` 建议 5000，因为初始分析可能晚于第一次空结果。

全局选项：

- `timeout`：单次 JSON-RPC 请求超时（毫秒），默认 20000，同时约束上面三个等待时间的上限。

`languageId` 由扩展名推断，常见扩展有显式映射（`.py` → `python`、`.h` → `c`、`.sh` → `shellscript`、`.cs` → `csharp`），其余取扩展名去掉前导点（`.proto` → `proto`）。
