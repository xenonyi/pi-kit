# pi-herdr
把 herdr skill 里「拼命令、解 JSON、传 ID、判状态」的机械动作收进工具，判断仍留在 skill 里。

## 使用

工具只在 herdr pane 内声明（`HERDR_ENV=1` 且 `HERDR_PANE_ID` 非空），其余 session 一律注册为 `hidden`。

| 工具 | 作用 |
| --- | --- |
| `herdr_pane_split` | 拆当前 pane 并返回新 pane id；未给 `direction` 时按调用 pane 的宽高推导（宽→`right`，窄/高→`down`），默认 `--no-focus`、继承调用 pane 的 cwd |
| `herdr_agent_spawn` | `pane split` + `agent start` + 就绪检查合成一步；即使启动不就绪也返回 pane id，便于读屏或清理；从不重试 |
| `herdr_agent_get` | 归一化读取 name/kind/status/cwd/`completion_seq`/`state_change_seq` 与 agent session 路径 |
| `herdr_agent_prompt` | 不带 `--wait` 投递，3 秒后复查并返回 `startObserved`；只接受 `idle` 或 `done` |
| `herdr_agent_read` | 读 pane 输出，默认 `recent-unwrapped` 120 行 |
| `herdr_cli` | 其余子命令透传，参数是 argv 数组（不经 shell） |

`herdr_cli` 的 `json` 默认为 `true`：stdout 是 JSON 时一并返回解析结果；超过 40 000 字符截断并在 `details` 里给出原始长度。

## 配置

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `HERDR_BIN` | `herdr` | 覆盖二进制路径，例如指向 `herdr.exe` 的绝对路径 |
| `HERDR_ENV` + `HERDR_PANE_ID` | — | 两者同时满足才声明工具；这是 herdr 注入的 pane 上下文 |

## 行为

- **启动自检**：`session_start` 跑一次 `herdr status --json`，比对 `protocol`（当前实现针对 `0.9.5` / protocol `22`）。不匹配时在所有工具结果前加一行警示并 `notify`，但**不拒绝调用**——否则字段改名会把工具变成永久不可用，也分不清「字段缺失」和「版本变了」。
- **写操作 fail-closed**：`herdr_agent_prompt` 只允许 `idle` / `done`。`blocked` 直接拒绝并要求问用户，`working` 拒绝（投递会插进它当前那一轮），`unknown` 也拒绝（先读屏）。预检失败直接 `throw`，不产生任何副作用。
- **就绪判定用 tri-state**：`interactive_ready` / `launch_pending` 缺失记为 `unknown`，不是 `false`。`herdr_agent_spawn` 未拿到 `interactive_ready=true` 时返回 `isError` + 已创建的 `paneId`，并提示不要重试。
- **方向推导有下限**：每一半至少 40 列或 8 行，否则拒绝并说明，不产出不可用的窄列。
- **投递后复查**：`herdr_agent_prompt` 提交后固定等 3 秒重读，状态序列增长即 `startObserved=true`。`false` 只表示「没看到活动」，不代表文本没送到；要读屏再决定是否重发。
- **透传黑名单**：空参数（`herdr` 裸跑会启动/附加 TUI）、`server stop`、`update`、`workspace close --group` 一律拒绝并说明原因；其余放行。
- **作用域**：语义工具只操作本机当前 session。跨机请用 `herdr_cli` 并自带 `--machine`——ID 与 agent 名在每台服务器各自独立，静默打到本机同名 agent 是最危险的失败。
- **id 不进正文**：会返回标识符的工具都声明了 `outputSchema` 并返回 `structuredContent`，脚本（codemode）拿到的就是对象；**不要**从文本里正则抓 id——曾因此把调用方自己的 pane 关掉。
- **并发**：6 个工具都是 `executionMode: "sequential"`，避免同一批调用里的两个 split 互相破坏布局。
- **测试**：纯函数层（argv 构造、归一化、状态门）用 `node:test`：

```sh
node --test extensions/pi-herdr/src/args.test.ts extensions/pi-herdr/src/normalize.test.ts extensions/pi-herdr/src/gates.test.ts
```
