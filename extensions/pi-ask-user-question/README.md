# pi-ask-user-question

`ask_user_question` 工具：向用户提一个阻塞问题并等待回答，支持自由文本、单选与多选。只在能显示提示的 TUI 会话中声明。

## 使用

| 参数 | 说明 |
| --- | --- |
| `question` | 必填。一次调用只问一个问题 |
| `details` | 显示在问题下方的补充上下文 |
| `options` | `{ label, value?, description? }` 数组。省略或传空数组表示自由文本输入 |
| `multiSelect` | 允许多选，只在给了 `options` 时生效 |

- 给了 `options` 时，用户始终可以选 `Other` 自行输入。`value` 缺省时等于 `label`。
- 回答放在 `details` 里，字段有 `status`（`answered`、`cancelled`、`unavailable`）、`question`、`context`、`mode`（`text`、`single-select`、`multi-select`）、`answers` 和 `message`。
- `answers` 是 `text`、`option`、`other` 三类条目。`message` 说明取消与不可用的原因。
- 取消返回 `cancelled`，无法交互返回 `unavailable`。两者都表示没拿到答案，模型不应据此推断用户同意。
