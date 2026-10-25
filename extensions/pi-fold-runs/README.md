# pi-fold-runs

把一段连续的工具调用折成一行摘要，thinking 只计数、不再单独占行：

```text
 帮我看看这个渲染补丁挂在哪
 行，我先读一遍组件
▸ 6 calls · powershell×3 read×1 grep×1 hash_edit×1 · ✻ 3 thoughts · 4.8s
```

点击摘要行**逐级展开**：组先展开成「每个调用一行」，点某个调用自己的行，它会展开成 Pi 的原生卡（首行是状态条：` ├ ▾` + 异常状态，卡内自带原生 call 行，命令只出现一次）；点状态条或卡内内容收起，变回紧凑行（组仍停在展开态）。要收回整组就点 `▾` 摘要行；`Ctrl+O` 一次性全开/全收。

```text
▾ 6 calls · powershell×3 read×1 grep×1 hash_edit×1 · ✻ 3 thoughts · 4.8s
 ├ ▸ read  extensions/pi-fold-runs/src/state.ts             0.2s
 ├ ▾                                     ← 卡的首行：状态条（卡底色）
 │    grep  toolName                      ← Pi 原生 call 行，文字与上面的调用名对齐
 │    …（卡内是 Pi 原生结果）
 ├ ▸ powershell  pnpm tsc                                ✗ 12.4s
 └ ▸ hash_edit  revision="…"                                0.1s
```

## 行为

- **level 0（默认）**：整段只剩一行摘要（无背景，靠上下空行分隔）：调用数、按工具名分组的计数、thinking 段数、失败数、总耗时或当前运行中的工具；失败时下面跟 `✗ <tool> failed · 1.8s`。
- **level 1（点摘要行）**：`▸` 变 `▾`，下面每个调用一行、相互紧贴：` ├ ▸ read  <参数预览>  0.2s`，最后一个用 `└`，失败在行尾标 `✗`。
- **level 2（点某个调用行）**：这一行会展开成 Pi 的原生卡，**卡的首行是状态条**（` ├ ▾`/` └ ▾` + 右对齐的异常状态：图片 `▦` 放在最前，后面是失败 `✗ <耗时>`/`running`；成功不显示耗时），由 Pi 的顶部 padding 行改成、整行涂卡片底色；卡其余部分完全原生（call 行、结果、底部 padding），**卡底色缩进 3 列、从树干右侧开始**，树干留在普通背景上；卡内文字比卡底色再多缩进 1 列，**与上面的调用行工具名对齐**。点状态条或卡内内容收起，变回紧凑行。图片：序列行按文字列偏移，图片占用的空行保持空白（TUI 靠它计高），图片前那一行改成 ` ▦ image W×H` 图注（零额外行）；**图片与图注都在卡外（普通背景），仍与卡内文字同列**。
- **图片标记**：结果里有终端能画的图片时，折叠行的状态列最前面多一个 `▦`（耗时/`✗` 仍在最右、与其他行对齐），展开后显示在状态条上；图片和一行 ` ▦ image W×H` 图注在卡外（普通背景），摘要行多一段 ` · ▦ N`（N = 整组图片张数）；终端不支持图片协议或 `showImages` 关闭时不显示（那时 Pi 只画文字占位）。
- **失败**：level 0 每个失败调用一行，**紧跟在摘要行下面**（不会散落到组里）；level ≥1 折叠行行尾标 `✗ <耗时>`，展开后卡片变红、状态条上也是 `✗ <耗时>`；`showErrors: false` 只保留摘要里的 `N failed`。
- **结果仍是 Pi 渲染**：展开后就是 Pi 的原生整块（含 call 行），diff 着色、`Ctrl+T` 的 thinking 设置都不变，只是卡底色缩进 3 列、卡内文字再多 1 列（图片行除外）；另外装了 `pi-collapse-tools` 也兼容——展开态它是 passthrough，不会被二次折叠。
- **折叠只改变渲染**；模型始终收到完整内容，工具集、权限、缓存都不变。
- 没有 `Thinking...` 残留：只思考（+ 调工具）的 assistant 消息在折叠态完全不绘制；只有组里一个工具都没有、且这条消息也没有文本时，才保留 Pi 的标签作为正在工作的信号。有文本的回复里 Pi 怎么画 thinking（标签或全文，看 `Ctrl+T`），这里就怎么画。
- **间距**：组上方留 `gap` 个空行（默认 `1`），下方留 `gap - 1` 个——Pi 在它之后画的组件（消息、pinned 行）开头本来就有 1 行空行，照着上方再画同样多会显得下面更宽；调用行之间不再插空行，`├`/`└` 直接连成树干；展开的卡首行是状态条（顶替 Pi 的顶部 padding，不额外占行），卡内文字比卡底色多缩进 1 列；**相邻的两张卡之间留 1 行带竖线的普通空白**（` │`，卡底色断开、树干不断）；pinned 行保持 Pi 自己的间距。

### 分组边界

一组 = 两个边界之间的全部工具调用。边界是：

- 用户消息
- 带可见文本的 assistant 消息（文本永远显示，所以你能看出回复有没有跑偏）
- compaction / branch summary、skill invocation、扩展自定义消息、`!` 执行的 bash

Pi 每个模型 step 都是独立的 assistant 消息，**只思考（+ 调工具）**的 step 不切断分组，包括回合末尾那条只有思考、既没文本也没工具调用的 step——所以一步一个工具的六个 step 仍然折成一行。

### 不折叠的工具

`pinned`（默认只有 `ask_user_question`）：保持 Pi 的原生行，并在它之前切断分组，保证顺序不乱。提问的答案必须直接可见，不能等展开；其它工具（包括 `edit`/`hash_edit`/`write` 的 diff）都折进摘要，`Ctrl+O` 或点摘要行再展开。

## 配置

读取顺序（命中即停）：

1. `<workspace>/.pi/pi-fold-runs.json`，仅在项目被信任时读取
2. `~/.pi/agent/pi-fold-runs.json`
3. 内置默认值

```json
{
  "enabled": true,
  "pinned": ["ask_user_question"],
  "showRunning": true,
  "showErrors": true,
  "gap": 1
}
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时完全交回 Pi 渲染 |
| `pinned` | `["ask_user_question"]` | 永不折叠的工具名；同时切断当前分组 |
| `showRunning` | `true` | 摘要行里显示 `running <tool>` |
| `showErrors` | `true` | 折叠态为每个失败调用保留一行 |
| `gap` | `1` | 组上方的空行数（0–4）；下方自动少 1 行（下一条消息自带 1 行间距），两侧看起来才一样宽 |

配置在会话开始时读取，改动后运行 `/reload` 或重开会话。`/fold` 显示当前生效范围和使用的配置文件。配置写错时整份配置被忽略并提示，回退到默认值。

## 实现方式

Pi 没有 assistant/消息级的渲染扩展点（`registerToolRenderer` 只管工具的 call/result，`registerMessageRenderer` 只对自定义消息生效）。所以这个扩展和 pi-tidy 一样，直接包了两个组件的 `prototype.render`：

- `ToolExecutionComponent` —— 每个工具调用一个实例。折叠态只由组内第一个成员画摘要行与失败行；组展开后，**未展开**的调用画自己的一行；某个调用展开后把 Pi 的原生 `render`（按内宽重排）接在下面，再把 Pi 的顶部 padding 行替换成状态条（` ├ ▾` + 异常状态，兼作收起热区）；卡底色缩进 3 列、树干在卡外，卡内文字额外缩进 1 列与调用名对齐；图片序列行与图注在卡外，按文字列偏移（图注尺寸读自 `imageComponents`）；相邻卡之间插一行普通树干分隔。
- `AssistantMessageComponent` —— 负责一段思考。carrier 消息折叠态返回 `[]`，并把 thinking 段数记进当前组；有文本时作为边界。
- `ToolExecutionComponent.prototype.handleMouse` —— 摘要行翻转整组，调用行翻转该调用的结果，结果块坐标平移后交回 Pi；转发期间开 pointer 作用域，让 `setExpanded` 补丁分清 `Ctrl+O` 和单行点击。
- `UserMessageComponent`、`CustomMessageComponent`、`BashExecutionComponent`、`SkillInvocationMessageComponent`、`CompactionSummaryMessageComponent`、`BranchSummaryMessageComponent` —— 只标记边界，输出原样透传。

两个组件类都是 `@earendil-works/pi-coding-agent` 的公开导出，且 Pi 的扩展加载器把这个包名别名到宿主自己的模块实例，所以打原型能作用到正在运行的 transcript。原型只补一次，配置存在 `Symbol.for("pi-fold-runs:runtime")` 的全局槽里，`/reload` 能作用到已经装好的补丁。

分组在渲染时从 transcript 顺序推导，不持久化：重开会话时组件按同样顺序重建，分组自然一致。

## 限制

- **点击需要全屏模式**：Pi 只在 `tuiMode: "fullscreen"` 下开启鼠标上报，否则只能用 `Ctrl+O`（一次性全开/全收）。
- **没有 hover 反馈**：摘要行是纯文本，鼠标移上去不会高亮。
- **展开的成功调用没有自绘耗时**：折叠行才有 `0.2s`；展开后状态条只标失败/运行中/图片，耗时看 shell 卡内的 `Took …`（read/grep 等没有耗时）。
- **折叠行是自绘的**：未展开的调用行由本扩展排版（`工具名 + key=value 预览`），看不到某些工具自定义的 call 细节；展开后就是 Pi 原生卡，细节都在。
- **图片行只做有限适配**：图注和图片都在卡外，按卡内文字列偏移（5 列），与文字对齐；但图片占用的行必须是空行（TUI 靠它们计算图片高度），所以树干在图片高度内断开、图片背后也不可能有卡底色（会盖住图）。图注尺寸读自 `imageComponents[].dimensions`（缺尺寸时只写 `image`，读不到组件时保留空白行）；识别图片行靠 `\x1b_G`（kitty）与 `\x1b]1337;File=`（iTerm2）前缀——`pi-tui` 没有公开 `isImageLine`，这里是本地镜像，上游换协议或改图片行前缀处理时会失效；如果结果确实含图片却整块没有一行命中，则退回「整块不缩进」（并 console.debug 一次）。
- **依赖内部字段**：`lastMessage`、`isStreaming`、`args`、`showImages`、`result.content`、`result.durationMs`、`imageComponents`、`hideComponent`、`expanded` 都不是公开 API。Pi 改内部结构时按「不认识就当边界、绝不隐藏」兜底，最坏退化成不折叠。
- **点击来源靠转发路径识别**：`handleMouse` 把原生行事件交给 Pi 时开一个 pointer 作用域，`setExpanded` 补丁据此区分 `Ctrl+O` 和单行点击。如果 Pi 改成像 `MouseRegion` 回调那样绕开 `ToolExecutionComponent.handleMouse`，标记不会置位，退化回「点调用行整组收起」的老行为（不崩溃）。
- **`Ctrl+O` 的全局标志是 Pi 自己的**：点行展开/收起不会同步它，所以点过之后第一次 `Ctrl+O` 可能表现为「全开」。
- 被 `pinned` 工具切断的那一步，它的 thinking 仍计入前一组（展开那一组能看到）。
- 如果别的扩展在之后又包了一层消息 `render` 且不调用前驱，边界会丢；工具渲染时会重新包一次，但只在有工具渲染时生效。

## 目录

```text
extensions/pi-fold-runs/
├── index.ts           # Pi 入口
├── src/
│   ├── extension.ts   # 事件接线、/fold
│   ├── config.ts      # 配置加载
│   ├── state.ts       # 分组状态机（边界、carrier、摘要数据）
│   ├── format.ts      # 摘要行、折叠行、状态条、图注、结果缩进、失败行
│   ├── patches.ts     # 组件原型补丁（render/handleMouse/setExpanded）与边界包装
│   ├── runtime.ts     # 全局配置槽（/reload 可见）
│   └── theme.ts       # 读取 Pi 的活动主题
└── README.md
```
