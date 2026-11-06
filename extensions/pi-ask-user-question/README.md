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

## 终端状态

在 pi 1.5.0 及以上版本中，单选和多选面板通过宿主的 OSC 7501（Program Status Protocol）汇报等待状态。等待回答时上报 `blocked`，类型为 `question`，消息为问题标题。编辑 `Other` 自定义答案时仍保持 `blocked`。

提交或取消并关闭面板后，宿主恢复当前会话状态；agent 仍运行时为 `working`。整轮任务的 `done`、`idle` 和 `error` 继续由 pi 管理。自由文本沿用内置编辑器的状态上报。

默认只向回应能力探测的终端发送状态。设置环境变量 `PI_PROGRAM_STATUS=1` 可强制启用，设为 `0` 可关闭。

pi 1.4 仍可使用原有提问功能，但不支持单选和多选面板的状态上报。
