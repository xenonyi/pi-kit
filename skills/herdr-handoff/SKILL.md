---
name: herdr-handoff
description: 把当前任务连同上下文移交给一个新的 Herdr agent pane（或已有 idle agent），交完不等、不轮询。仅在用户明确说 handoff / 交接 / 移交给 X / 换个人接着做 时使用；判断只读咨询与 handoff 的区别是所有权，不是并行。需要 pi-herdr 扩展（herdr_* 工具）。
---

# Herdr Handoff

交出**所有权**，不是请人给意见：交完我不再等它。

与「让人给个判断」的根本区别：那种委托结论回来就结束；handoff 是把任务交给一台真实终端，对方从零上下文开始。

## 0. 前提

`herdr_*` 工具存在才算在 Herdr pane 内。缺失 → 停，告诉用户。

## 1. 先定拓扑，别升级拓扑

Herdr 的 handoff = 选一个位置 + 给它一个身份 + 一次投递。用户说在哪，就只做到那一步。

| 用户说的 | 用 | 产出 |
| --- | --- | --- |
| 「交给右边那个」/ 已经有 agent 在跑 | `herdr_cli ["pane","neighbor", …]` 定位，再 `herdr_agent_prompt` | 不新建任何东西 |
| 「开个新 agent 做」 | `herdr_agent_spawn` | 同 tab、同 cwd 的兄弟 pane |
| 「在工作树里做」/「别碰我的分支」 | `herdr_cli ["worktree","create", …]` | 新 workspace + tab + root pane + worktree |
| 「在新目录/新项目做」 | `herdr_cli ["workspace","create", …]` | 新 workspace |

默认是**同 tab、同 cwd 的兄弟 pane**；不主动造 workspace / tab / worktree，也不换 cwd。

### 交给已有的 agent（最省）

```text
herdr_cli ["pane","neighbor","--current","--direction","right"]
  → .result.neighbor.neighbor_pane_id（null = 那个方向没有 pane）
herdr_agent_get { target: <pane_id> }        # 确认占用者与状态
```

**先过状态门**：只有 `idle` / `done` 才可投递。`blocked` 立刻转述给用户；`working` 时投递会插进它当前那一轮，毁掉手上的活——等或问。`herdr_agent_prompt` 已按此拒绝，别用 `herdr_cli` 绕过。

改名只在用户要求或确实需要稳定别名时做：`herdr_cli ["agent","rename", <pane>, "handoff-1"]`。已占用就递增到 `handoff-2`，不要试图覆盖。

### 新开兄弟 pane（默认）

```text
herdr_agent_spawn { name: "handoff-1", kind: "pi" }
  → { paneId, ready, status, direction }
```

- 名字规则 `[a-z][a-z0-9_-]{0,31}`，存活 agent 间必须唯一；名字跟着 pane 的当前占用者走，agent 退出即释放，别当永久标识。
- `kind` 用用户指定的；没指定就用当前 harness 的 kind。原生参数（模型等）只放在 `--` 之后，**绝不自己猜模型 id**。
- `ready: false` → **不要重试**：名字仍然可用，先 `herdr_agent_read` 看它卡在哪个对话框。
- 工具自己会推方向、带 `--no-focus`、继承 cwd；不要再用 `pane layout` 手动算。

### worktree 隔离（用户要求时）

```text
herdr_cli ["worktree","create","--cwd",<REPO>,"--branch",<SHORT>,"--base",<BASE>,"--label",<LABEL>,"--no-focus"]
```

返回 `.result.root_pane.pane_id` 用于放 agent，`.result.worktree.path` / `.branch` / `.label` 用于回话。`--trust-repository` **只在用户确认过这个仓库时**加，它不是失败后的重试手段。

## 2. 交接文档

接收方一无所知。按骨架写，缺哪节写「无」，不要删节：

```markdown
## Task
[祈使句描述。]

## Context
[为什么有这个任务，必要背景。]

## Relevant files
- `path/to/file.ts` — [它是什么、为什么重要]

## Current state
[已完成什么、什么能跑、什么不能跑。]

## What was tried
- [做法] — [为什么失败/放弃]

## Decisions
- [决定 — 理由]

## Acceptance criteria
- [ ] [可验证的判据]

## Constraints
- [不能做 / 必须保留]

## Working directory
<ABS_PATH>
```

- 文件**给路径不粘内容**。
- 验收判据必须可验证（能跑的命令、能看的输出），不写「质量好」。
- 保留用户原始意图：调研就写 `DO NOT edit files.`，修 bug 就写「实现修复」，重构就写「重构不是重写」。
- 结尾写清回报口径：`When done, report: what changed, what you ran, what you did not do.`

## 3. 投递：一次投递，不等

```text
herdr_agent_prompt { target: <name 或 pane>, text: <全文> }
  → { submitted, startObserved, status, stateChangeSeqBefore, stateChangeSeqAfter }
```

- **不加 `--wait`**：加了就变成「我在等它干活」，那是请人给意见，不是移交。工具本身就不带。
- 工具直接传参数、不经 shell，所以长文档没有引号与换行问题；上限 28000 字符，超了就把文档落文件、把**路径**写进 prompt。
- `startObserved: true` = 3 秒内观测到活动，说明它开跑了。
- `startObserved: false` **不等于没送到**：工具不做 `--wait`，拿不到那个 5 秒活动门，只是没观测到。先 `herdr_agent_read` 确认，不要盲目重发。
- 返回里的 `completionSeq` 仍是上一轮的旧值，不因这次投递而变。

## 4. 交回控制权

```text
herdr_cli ["agent","focus", <name>]                        # 同时标记为已看过
herdr_cli ["notification","show","Handoff ready","--body","<name> · <路径或分支>"]
```

然后按四件事说清：

1. 交给了谁：kind、名字、pane ID（或 worktree 路径 / workspace label）。
2. 它就在用户的 Herdr 里，**随时能接管**：点 sidebar，或 `agent focus`。
3. 我这边**不再等、不轮询**。
4. 它是用户的终端，不是我藏起来的子 agent——没有 detach 这回事。

## 5. 用户回头问时（我不主动做）

本节全部由用户触发。交接完成后我不查、不等、不轮询。

- **进度判据**：`herdr_agent_get` 的 `completionSeq`。该 key 缺失时工具已归零——刚启动也是 `idle`，只看 `status` 会误判；`completionSeq > 基线` 才算真干完一轮。每轮 `+2`（idle→working→idle），读它不会清零。
- **追加指令**：这次可以等 → `herdr_cli ["agent","prompt",<name>,<text>,"--wait","--timeout","300000"]`。
- **回读，三层从好到差**：
  1. 读它自己的 transcript（无损，无 TUI 噪声）：`herdr_agent_get` 的 `sessionPath`，仅当 `sessionKind` 是 `path` 且 `source: herdr:pi` 那种 jsonl 成立；换 kind 会静默得到空串，必须判空后降级。只拼 `type=text` 的块，跳过 `thinking`。
  2. 让它把结论写成 Markdown 到绝对路径，只回一行路径。任何 kind 都成立，多一轮成本，但产物可留存、可 diff。
  3. 兜底读屏：`herdr_agent_read { lines: 900 }`。只用来判断「它卡在哪 / 在跑什么」，**不要用来搬长文本**——小步长只覆盖视口，且混着边框与硬折行；`working` 状态下大步长会返回 `agent_not_idle`。

## 6. 清理：只在失败回滚时执行

**交接成功后什么都不关。** 目标 pane 一旦关掉，名字立即释放，用户再也接管不到——这是本流程最容易搞砸的一步。

只有这几种情况才清理：`agent start` 失败、投递失败、用户取消、用户明确说「不要了」。

- 只关**自己建的**：`herdr_cli ["pane","close", <structuredContent.paneId>]`。`herdr_cli` 会拒绝关闭调用方自己的 pane——那不是 bug，别绕过。
- 普通 close 不继承 TUI 的「最后一个 pane」确认，关了就真关。
- worktree：`herdr_cli ["worktree","remove","--workspace",<WS_ID>]`（无位置参数）；`--force` 只在用户确认丢弃未提交内容时加。
- 绝不 `herdr server stop`；绝不关别人的 pane / tab / workspace / session。

## 失败对照

| 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `agent_not_ready` | 启动即 blocked，或没到交互 prompt | 读屏 → 问用户；名字仍可用于 read / send-keys |
| `startObserved: false` | 没观测到活动（本流程没有 `--wait` 活动门） | 读屏确认；不要假设没投递，也别盲目重发 |
| `agent_blocked` | 它停在审批或提问界面 | 读屏 → 转述用户，别代答 |
| `not_promptable` / 状态门拒绝 | 目标是 `blocked` / `working` / `unknown` | 按提示处理；不要换 `herdr_cli` 硬投 |
| `agent_not_found` | 名字已释放（退出或被替换） | 用 pane ID 重新 `herdr_agent_get`，或重新 spawn |
| `agent_not_idle`（读） | 它还在跑 | `herdr_cli ["agent","wait",…]` 后重读，或只读 `visible` |
| 同名 agent 已存在 | 名字必须唯一 | 递增到 `handoff-2`，不要重启 server |
| worktree 报 trust | 仓库未确认 | 问用户，确认后才 `--trust-repository` |

## 硬规则

- 默认同 tab、同 cwd 的兄弟 pane；不主动升级拓扑。
- `--no-focus` 用于后台工作，除非用户明确要切过去。
- 目标一律用 `--current`、显式 pane ID 或唯一 agent 名；**不要依赖另一个 client 的焦点 pane**。
- ID 从 `structuredContent` / `.result.*` 解析，不从正文、sidebar 顺序或示例里推。
- 跨机时给每个语义工具传同一个 `machine`；拆 pane / spawn 还要传 `pane`（远端 `--current` 不成立），cwd 由工具从 `pane get` 取。ID 与名字都是那台机器各自的。
- 工具只覆盖 pane / agent：`worktree create`、`notification show`、`pane close` 走 `herdr_cli` 并自带 `--machine`；远端 worktree 路径必须绝对或 `~/` 开头。
- `blocked` 一律问用户，不代点同意。
