# pi-collapse-tools

工具调用保留一行调用头，工具结果默认不渲染；按 `Cmd+O`（macOS）/ `Ctrl+O`（其他终端），或点击结果区域展开。

移植自 [xRyul/pi-collapse-tools](https://github.com/xRyul/pi-collapse-tools)（MIT，Copyright (c) 2026 xryul），按本仓库的工具集和 Pi 1.4 的渲染 API 重写。

## 与上游的差异

| 方面 | 上游 | 本仓库 |
| --- | --- | --- |
| 生效方式 | 用同名工具覆盖 `read,bash,edit,write` 等内置工具 | 用 `pi.registerToolRenderer` 包装渲染，不改动工具注册 |
| 覆盖范围 | 只覆盖 `--tools` 选中的内置工具 | 全部工具：`powershell`、`hash_read`、`hash_edit`、`lsp_*`、MCP 工具等 |
| 调用头 | 逐工具手写参数摘要 | 直接复用 Pi 自带 renderer（无 renderer 的工具用 Pi 的兜底格式） |
| 失败结果 | 与成功结果一样隐藏 | 默认保持可见 |
| codemode | 自建嵌套工具行、计时与 token 尾部（多行） | 保留 Pi 原生嵌套行，把耗时与 token 收进第一行摘要，去掉折叠态的空行与 `Took` 行 |
| 配置 | 无 | `pi-collapse-tools.json` |

不覆盖内置工具，因此没有工具覆盖启动警告，模型可见的工具集、权限和缓存行为都不变。

## 行为

- 折叠时：调用头照常显示，结果区为空；流式调用显示一行 `Running…`；失败调用保持 Pi 的原始渲染。
- 展开时：完全使用 Pi 原生 renderer，包括 `edit` 的 diff、`hash_edit` 的 revision 预览和图片。
- `ask_user_question` 默认不折叠，答案必须直接可见。
- 折叠只改变渲染；模型始终收到完整结果。

### codemode

- 折叠后只剩**第一行摘要**和原生嵌套工具行，脚本与输出隐藏；原生结果里的空行和单独的 `Took …` 行会一并移除（仅限折叠态）。
- 运行中：`codemode ••• 0.4s`（`•••` 与实时耗时一起刷新；`/tree` 或历史恢复的行不显示）。
- 完成后：`codemode 0.2s · Tokens ~426 (0.043%)`，嵌套行紧贴其下。
  - 耗时取结果里的 `durationMs`，格式与原生 `Took …` 完全一致；没有记录时只显示 token。
  - token 是返回给模型的最终内容的 `chars/4` 估算，不是计费 token。
  - 百分比按调用当时记录的模型上下文容量计算；容量未知（例如旧会话导出）时只显示 token 数。
  - 折叠态不再重复原生耗时行；展开后仍使用完全原生的布局。

## 配置

读取顺序（命中即停）：

1. `<workspace>/.pi/pi-collapse-tools.json`，仅在项目被信任时读取
2. `~/.pi/agent/pi-collapse-tools.json`
3. 内置默认值

```json
{
  "enabled": true,
  "tools": "all",
  "except": ["ask_user_question"],
  "showRunning": true,
  "showErrors": true,
  "codemode": {
    "hideScript": true,
    "indicator": true,
    "tokens": true
  }
}
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时完全交回 Pi 渲染 |
| `tools` | `"all"` | 折叠的工具名数组，或 `"all"` |
| `except` | `["ask_user_question"]` | 永不折叠的工具名 |
| `showRunning` | `true` | 折叠中的流式调用显示 `Running…` |
| `showErrors` | `true` | 失败调用保持 Pi 的原始渲染 |
| `codemode.hideScript` | `true` | 折叠时隐藏脚本正文 |
| `codemode.indicator` | `true` | 运行期间显示 `•••` |
| `codemode.tokens` | `true` | 完成后显示 token 估算 |

配置在会话开始时读取，改动后运行 `/reload` 或重开会话。`/collapse` 显示当前生效范围和使用的配置文件。配置写错时整份配置被忽略并提示，回退到默认值。

## 限制

- 结果被完全隐藏，不像 Pi 自带折叠那样保留 5~10 行预览。
- codemode 的摘要行依赖结果里的 `durationMs` 与 details 里的容量字段，缺少时自动省略对应部分。
- 上下文百分比依赖调用当时写入 details 的容量字段，旧会话没有该字段。
- 未移植上游按 `--tools` / `--no-tools` 反推覆盖列表的逻辑，因为这里不再覆盖工具注册。

## 目录

```text
extensions/pi-collapse-tools/
├── index.ts           # Pi 入口
├── src/
│   ├── extension.ts   # 事件接线、renderer 注册、/collapse
│   ├── config.ts      # 配置加载与折叠判定
│   ├── render.ts      # 普通工具的结果折叠
│   └── codemode.ts    # codemode 折叠、••• 动画与 token 尾注
├── README.md
└── LICENSE            # MIT, Copyright (c) 2026 xryul
```
