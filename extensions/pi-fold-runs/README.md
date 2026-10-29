# pi-fold-runs

每次工具调用都是一张独立的 Pi 原生卡片，默认折叠成 **1 行**。只通过 Pi 公开的 `pi.registerToolRenderer` 接入，不修改任何 Pi 类、不读取私有字段。

## 展示与操作

- **折叠**：保留 Pi 原生 `renderCall` 的第一行可见内容。默认外壳下的背景、横向 padding、上下留白和卡片间距由 Pi 提供；`renderShell: "self"` 的工具（如 `edit`）自绘外壳，折叠行自带背景与 padding，并保留它自己的上下留白行，看起来仍是「空行 / 内容 / 空行」。
- **展开**：点击折叠行的任意位置，或按 `Ctrl+O` 全部展开。展开后 call 与 result 都直接交回 Pi 原生 renderer，宽度、padding、diff、图片均不改动。
- **收起**：再次点击或 `Ctrl+O`，卡片回到一行。
- **`/fold`**：显示折叠开关、pinned 工具、Pi 版本、配置来源，以及哪些卡片不折叠。

`codemode` 在原生标题后追加实际发起的嵌套调用，例如 `codemode · read×2 powershell×1`：

- 从 `result.details.calls` 统计，按首次发起顺序列出每种调用的次数；循环和动态调用按实际次数计数，不从脚本文本猜测。
- 包括已发起但失败或取消的调用，以及 `models.*`；尚无调用时显示 `0 calls`。
- 结果到达后触发一次重绘，因此这一行会从 `codemode` 变成 `codemode · read×N`。仍只占一行，放不下时按宽度截断。

## 不折叠的情况

| 情况 | 原因 |
| --- | --- |
| 同时缺少 `renderCall` 或 `renderResult` 的工具 | 公开 API 拿不到 Pi 的原生回退行，折叠后无法正确隐藏结果，因此整张卡交给 Pi |
| `renderCall` 输出里含图片协议（`\x1b_G`、`\x1b]1337;File=`） | 图片需要它覆盖的空白行，不能只留一行 |
| `pinned` 里的工具 | 例如 `ask_user_question`：提问答案无需展开即可见 |
| 结果里的图片 | Pi 在 renderer 之外追加图片，折叠卡下方仍会显示图片 |

## 配置

读取顺序（命中即停）：

1. `<workspace>/.pi/pi-fold-runs.json`，仅在项目被信任时读取
2. `~/.pi/agent/pi-fold-runs.json`
3. 内置默认值

```json
{
  "enabled": true,
  "pinned": ["ask_user_question"]
}
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时完全交回 Pi 渲染 |
| `pinned` | `["ask_user_question"]` | 不折叠这些工具的原生卡片 |

配置在会话开始时读取，修改后 `/reload` 或重开会话即可生效，无需重启。未知键一律忽略，旧配置里的 `autoDisableOnUnknownVersion`、`showRunning`、`showErrors`、`gap` 都已失效。配置错误时提示并回退默认值。

## 从原型补丁迁移

此前版本补丁 `ToolExecutionComponent.prototype.render`，因此能折叠 Pi 最终组装出的整张卡片，也包括 thinking 与调用段的联动。改用公开 API 后，以下能力被放弃：

| 放弃 | 现在的行为 |
| --- | --- |
| thinking 随所属调用段隐藏、全部展开后恢复 | thinking 完全按 Pi 原生规则显示，可见性由 `Ctrl+T` 控制 |
| 折叠时隐藏结果图片 | 图片仍在折叠行下方显示 |
| 版本闸门与结构探针 | 不再依赖私有字段，因此不再需要锁定 `1.4.x` |

换来的好处：不碰 `ToolExecutionComponent` / `AssistantMessageComponent`，不再有 `as unknown as` 的私有字段读取，也不需要在别的扩展改写原型时重新抢回最外层。

## 其它行为

- 仅 TUI 激活；RPC、JSON、print 模式不读取配置，`enabled` 保持关闭，卡片与 HTML 导出沿用原生 renderer。
- 只改变展示，工具执行、权限、模型收到的完整结果与缓存均不变。
- `src/render.ts` 把原生组件通过 `lastComponent` 原样交回原生 renderer（Pi 会把我们的包装器传进去，而原生 renderer 会对其调用 `clear()`）。
- 折叠时仍会调用原生 `renderResult`，只是丢弃它返回的行：`renderShell: "self"` 的工具靠它更新自己的标题背景（`edit` 出错时变红）。
- `codemode` 的计数在 `renderResult` 里写入共享 `state`，并用 `queueMicrotask` 触发 `context.invalidate()`：渲染过程中同步 invalidate 会重入 `updateDisplay`，被打断的那一趟随后会重复插入子组件。
