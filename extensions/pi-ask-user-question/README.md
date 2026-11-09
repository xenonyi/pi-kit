# pi-ask-user-question

`ask_user_question` 工具：向用户提一个阻塞问题并等待回答，支持自由文本、单选与多选。只在能显示提示的 TUI 会话中声明。

## 使用

| 参数 | 说明 |
| --- | --- |
| `question` | 必填。一次调用只问一个问题 |
| `details` | 显示在问题下方的补充上下文，支持 Markdown |
| `options` | `{ label, value?, description? }` 数组。省略或传空数组表示自由文本输入 |
| `multiSelect` | 允许多选，只在给了 `options` 时生效 |

- 给了 `options` 时，用户始终可以选 `Other` 自行输入。`value` 缺省时等于 `label`。
- 回答放在 `details` 里，字段有 `status`（`answered`、`cancelled`、`unavailable`）、`question`、`context`、`mode`（`text`、`single-select`、`multi-select`）、`answers` 和 `message`。
- `answers` 是 `text`、`option`、`other` 三类条目。`message` 说明取消与不可用的原因。
- 取消返回 `cancelled`，无法交互返回 `unavailable`。两者都表示没拿到答案，模型不应据此推断用户同意。

## 阅读与回答

问题和补充说明显示在原生工具卡片中，随对话滚动。等待回答时，卡片默认显示全文，无需展开。回答或取消后，卡片保留在历史中，可用 pi 原生的展开和折叠操作回看全文。

单选和多选的底部面板只显示选项、选项说明、`Other`、自定义输入和必要操作提示。多选还保留固定的 `Submit` 按钮。问题正文的长度不影响底部面板高度；选项多或选项说明长时，面板仍可能较高，选项列表会按可用空间滚动。

自由文本的底部显示 `Write your answer:` 和 pi 内置编辑器，保留换行、外部编辑和取消操作。

## 终端状态

在 pi 1.5.0 及以上版本中，单选和多选面板通过宿主的 OSC 7501（Program Status Protocol）汇报等待状态。等待回答时上报 `blocked`，类型为 `question`，消息为问题标题。编辑 `Other` 自定义答案时仍保持 `blocked`。

自由文本沿用内置编辑器的状态上报，等待时仍为 `blocked`、类型为 `question`，消息为 `Write your answer:`。

提交或取消并关闭面板后，宿主恢复当前会话状态；agent 仍运行时为 `working`。整轮任务的 `done`、`idle` 和 `error` 继续由 pi 管理。

默认只向回应能力探测的终端发送状态。设置环境变量 `PI_PROGRAM_STATUS=1` 可强制启用，设为 `0` 可关闭。

pi 1.4 仍可使用原有提问功能，但不支持单选和多选面板的状态上报。
