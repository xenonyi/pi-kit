# pi-herdr

把 herdr-app 窗口与 herdr-core（`hc`）的常用操作固化成工具。启动终端、投递、等待、读屏、调整窗格和清理，都能用一次类型化调用完成，不必再拼 PowerShell，也不必记字段名和退出码。

## 使用

各工具默认返回一段可直接阅读的文本，`details` 里是同一份结构化结果。失败时返回 `isError`，正文首行是 `error.kind: message`，第二行是 `hint`。

`herdr_terminals`、`herdr_wait`、`herdr_read` 的 `exposure` 为 `deferred`，默认不声明给模型。用 `tool_search` 搜一次（如 `herdr terminal`）后，它们就在当前会话分支上常驻声明。不碰 herdr 的会话因此不为它们付提示词成本。会话既没有 `tool_search` 也没有 `codemode` 时，pi 会提示这三个工具不可达。

### `herdr_terminals`

合并 `hc ls --json`、`herdr-app ls` 和 `herdr-app status`。结果包含终端地址、agent、OSC 7501 状态、`turn`、`parent`、`where`、cwd，以及机器、聚焦 pane、本会话所在的 pane 与 space、tab。

| 参数 | 说明 |
| --- | --- |
| `include_finished` | 连同已结束的终端一起列出（`hc ls --all`），默认 `false` |

`me` 取自 `HC_TERMINAL_ID`。窗口读不到时 `windowOpen` 为 `false`，`windowProblem` 给出原因，终端仍会列出。

### `herdr_start`

| 参数 | 说明 |
| --- | --- |
| `argv` | 程序及其参数，例如 `["pi"]` 或 `["claude", "--no-daemon"]`。任务作为最后一个参数附上 |
| `task` | agent 的首条消息 |
| `name` | 终端名，必须唯一。含非法字符时清洗为 `a-z0-9-_` 并截到 32 字符，被占用时递增为 `agent-2` |
| `cwd` | 新终端的工作目录，默认本会话 cwd |
| `placement` | `pane`（默认，拆 pane 并给新终端一个 pane）、`tab`（新 tab，`name` 成为 tab 名）或 `background`（隐藏） |
| `direction` | `right`（默认）或 `down` |
| `focus` | `placement: pane` 时是否显示新终端，默认 `true` |
| `inline_task` | 任务含引号、`$`、反引号或换行，或超过 400 字符时，默认落盘改传路径。置 `true` 则原样传递 |

返回 `address`、`name`、`placement`、`cwd`、`pane`、`spaceName`、`tabName`、`parent`、`outliveParent`、`state`、`status`、`turn`、`taskFile`、`steps` 和 `warnings`。

### `herdr_send`

| 参数 | 说明 |
| --- | --- |
| `terminal` | 终端地址（`t7`、`vps/t7`）或唯一名字 |
| `text` | 粘贴后按 Enter 提交 |
| `wait` | 等待这次投递开启的那一轮 |
| `timeout` | 配合 `wait`，签到前的秒数 |
| `if_status` | 目标状态恰为 `idle` 或 `working` 时才输入 |

### `herdr_wait`

| 参数 | 说明 |
| --- | --- |
| `terminal` | 终端地址或唯一名字。等待子终端时可以省略 |
| `children` | `any` 或 `all`，改为等待本会话的子终端 |
| `output` | 程序（非 agent）打印出该文本即返回 |
| `timeout` | 签到前的秒数，默认沿用 hc 的 180 |

外部超时设成 `timeout + 30` 秒。返回 `status`、`turn`、`reason` 和 `exit_code`。

### `herdr_read`

| 参数 | 说明 |
| --- | --- |
| `terminal` | 终端地址或唯一名字 |
| `lines` | 屏幕上方再取多少行历史，默认 `0` |

正文上限 12,000 字符，超出部分截断并注明。`how: "screen"` 只给视口（程序仍在运行），`how: "history"` 是拼接后的历史（终端已结束）。

### `herdr_ui`

| 参数 | 说明 |
| --- | --- |
| `command` | 支持的 `herdr-app do` 命令。省略即列出全部 |
| `args` | 该命令的参数。省略即显示参数名与必填项 |

只驱动白名单内的命令：`space.*`、`tab.*`、`pane.*`、`agent.*`、`layout.*`，以及 `terminal.open`、`keep`、`park`、`show`、`peek`、`copy`、`paste`。参数以单个 JSON 对象传递。`app.*`、`window.*`、`mod.*` 与破坏性命令不在白名单内，`pane.close` 和 `terminal.kill` 只能经 `herdr_kill` 调用。

`pane.split` 未给 `direction` 时用 `right`，未给 `pane` 时用本会话所在的 pane。`terminal.keep` 未给 `place` 时用 `right`，`pane.focus` 未给目标时聚焦本会话。参数名写错时报错，并附上该命令的正确参数。

### `herdr_kill`

| 参数 | 说明 |
| --- | --- |
| `terminal` | 终端地址或唯一名字 |
| `scope` | `program`（`hc kill`，默认）、`terminal`（连子 agent，`terminal.kill`）或 `pane`（`pane.close`） |
| `confirm` | 必须为 `true`，否则直接拒绝 |

### `/herdr`

`/herdr`、`/herdr status`、`/herdr ls` 显示与 `herdr_terminals` 相同的概览。`/herdr focus [地址]`、`/herdr peek <地址>`、`/herdr kill [地址]` 省略地址时用选择器，`/herdr help` 列出子命令。
