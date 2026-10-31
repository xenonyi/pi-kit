# pi-btw

`/btw` 命令：问一个不污染会话历史的旁支问题，答案只出现在临时面板，不写进 transcript。

## 使用

```text
/btw 这个渲染补丁挂在哪
```

- 面板按键：`Esc` / `Ctrl+C` / 空格 / `q` 关闭，`↑↓` 或 `k`/`j` 滚动，`PageUp`/`PageDown` 翻页；右上角显示滚动位置，标题显示模型 id 与用量
- 等待期间显示 `Thinking (<model>)...`，可随时取消
- 单次请求上限 5 分钟（`BTW_REQUEST_TIMEOUT_MS`）；provider 支持 abort 时会一并中止底层请求
- 请求失败提示 `BTW query failed: …`，空回答提示 `No answer received`

## 行为

- 只在 TUI 会话注册：`session_start` 时 `ctx.mode === "tui"` 才 `registerCommand("btw")`，print / JSON / RPC 会话看不到该命令
- 走 `ctx.modelRegistry.complete()`，与普通会话共用鉴权（apiKey / headers / baseUrl / env）与 provider 请求转换
- 上下文由 `serializeBtwConversation` 压成文本：单个工具结果最多保留 20000 字符，被截断内容与图片标记为不可用
- 系统提示词（`BTW_SYSTEM_PROMPT`）禁止使用工具，只能依据对话里已出现的信息作答
- 完全 ephemeral：面板关闭后不留痕，也不进会话历史

## 来源

改写自 [jayshah5696/pi-agent-extensions 的 extensions/btw](https://github.com/jayshah5696/pi-agent-extensions/tree/main/extensions/btw)。
