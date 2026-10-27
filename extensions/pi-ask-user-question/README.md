# pi-ask-user-question

`ask_user_question` 工具：向用户提一个阻塞问题并等待回答，支持自由文本、单选与多选。只在能显示提示的 TUI 会话中声明。

## 使用

| 参数 | 说明 |
| --- | --- |
| `question` | 必填。一次调用只问一个问题 |
| `details` | 显示在问题下方的补充上下文 |
| `options` | `{ label, value?, description? }` 数组；省略或传空数组 = 自由文本输入 |
| `multiSelect` | 允许多选；只在给了 `options` 时生效 |

- 给了 `options` 时用户始终可以选 `Other` 自行输入；`value` 缺省等于 `label`
- 回答放在 `details` 里：`status`（`answered` / `cancelled` / `unavailable`）、`question`、`context`、`mode`（`text` / `single-select` / `multi-select`）、`answers`（`text` / `option` / `other` 三类条目）
- 取消返回 `cancelled`，无法交互返回 `unavailable`：两者都表示没拿到答案，模型不应据此推断用户同意

## 行为

- 启动先以 `hidden` 声明；每次 `session_start` 按 `ctx.mode === "tui" && ctx.hasUI` 重新声明为 `model-only` 或 `hidden`。工具无法注销，所以按会话重声明，而不是切 active tools
- 重新注册（而非 `setActiveTools`）不会丢掉恢复会话里尚未注册的工具，例如仍在连接的 MCP 服务器
- `executionMode: "sequential"`：阻塞提问不与兄弟工具调用并发
- codemode 模式同样保留该工具：用户交互必须能直接发起，脚本不能间接触发阻塞提问
