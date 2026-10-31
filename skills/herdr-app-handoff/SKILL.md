---
name: herdr-app-handoff
description: 把当前任务连同上下文移交给 herdr-core 中的新终端 agent（或已存在的 idle agent），交出后不等待、不轮询。保证用户随时可接管；新终端的启动方式见 `skills/herdr-app`。仅在用户明确说 handoff / 交接 / 移交给 X / 换人接手时使用；咨询与 handoff 的分界在所有权，不在并行。需要 herdr-core 的 `hc`。
---

# Herdr App Handoff

交出**所有权**，而非征求判断：交出后不再等待。与咨询的分界在所有权而非并行——咨询在结论返回后即结束；handoff 是把任务交给用户可见、可接管的终端，对方从零上下文开始。

## 0. 操作方式不在本文件

命令、字段速查、状态判定、返回码与远端规则都在 `skills/herdr-app`——字段查该速查表即可，**不要读 `hc --skill`**。新终端的启动与启动复验见其[「开终端」](../herdr-app/SKILL.md#开终端默认拆-pane)一节，此处不重复。

`HC_TERMINAL_ID` 为空即停止，告知用户当前不在 hc 终端内。窗口不在（`status` 失败）时交接仍可执行，但「用户可见」这一前提失效——先询问是否现在开窗。

## 1. 拓扑：用户说到哪一步，就只做到哪一步

| 用户说的 | 用 |
| --- | --- |
| 「交给右边那个」/ 已存在的 agent | `herdr-app ls` → `hc get` → `hc send` |
| 「开个新 agent 做」 | 按 `skills/herdr-app` 的「新开同级终端」流程 |
| 「派个后台的」 | 同上，先不 `terminal.keep` / `agent.focus` |
| 「在工作树里做」 | `git worktree add` → 以上述流程以 worktree 为 cwd 启动 |
| 「新目录 / 新项目」 | `herdr-app do space.new` |

默认使用可见的同级 pane；位置、方向、cwd 与启动复验按 `skills/herdr-app`，不要主动升级拓扑。worktree 自行用 git 创建，汇报时给出绝对路径与分支。

### 已存在的 agent

用 `herdr-app ls` 取 terminal，再用 `hc get` 读 `status.state` / `status.kind` / `parent`。

仅 `idle` / `done` 可投递；`blocked` 转述用户；`working` 会插入其当前一轮——等待或询问。

## 2. 交接文档

共九节，缺哪节写「无」：Task / Context / Relevant files / Current state / What was tried / Decisions / Acceptance criteria / Constraints / Working directory。完整骨架（含每节说明）在 `references/handoff-template.md`，需要照抄时再读；轻量交接按上述九个标题书写即可。

- 给路径，不粘内容；验收判据必须可验证。
- 保留用户原意：调研写 `DO NOT edit files.`，修 bug 写「实现修复」，重构写「重构而非重写」。
- 结尾：`When done, report: what changed, what you ran, what you did not do.` 长结论写入文件并回路径，或 `hc send <本会话地址>`。

## 3. 只投递一次，不等待

新终端的文档已包含在 `hc run` 中，不要重发。已存在的 agent：`hc send <t> "<全文>"`。

- 不要加 `--wait`——那等同于等待其完成。
- `started` 为 true / false / null 都不表示未送达；先 `hc read` 再判断，不要盲目重发。
- 长文档写成文件，prompt 中给路径。

## 4. 交回控制权

执行 `herdr-app do agent.focus --terminal <t>`，随后说明四件事：交给谁（agent / 名字 / 地址）；它在窗口内可随时接管（`agent.focus`、`terminal.peek`、sidebar）；本会话不再等待、不轮询；它是用户的终端，不是隐藏的子 agent。

## 5. 用户后续追问时

- 进度看 `turn`——刚启动时 `status.state` 也是 `idle`，只看状态会误判（`state` 是生命周期，不是进度）。
- 追加指令可以等待：`hc send --wait --timeout 300 <t> "<text>"`。
- 回读分三层：要求它写绝对路径并只回路径 → 读它自己的产物文件 → 兜底 `hc read --lines 200`（仅判断卡在哪里，不要搬运长文本）。
- 卡住时用 `hc interrupt`，只终止这一轮。

## 6. 清理仅限失败回滚

**成功后不要关闭任何东西**——关闭后用户无法接管。仅在启动失败 / 投递失败 / 用户取消 / 用户明确不要时清理，且只清理自己创建的。`terminal.keep` 的终端移除后 pane 自动消失、焦点回到原位。`git worktree remove` 的 `--force` 需用户确认。

## 失败对照

| 现象 | 下一步 |
| --- | --- |
| 屏上没有文档、`turn` 一直为 0 | 读屏确认就绪状态，再发一次；不要重起 |
| `status_mismatch`「is silent, not idle」 | 目标不上报状态：去掉 `--if` |
| `blocked` | 读屏后转述用户，不代为回答 |
| `reason: timeout` | 180 秒签到，不是失败 |

## 硬规则

- 默认使用可见的同级 pane，不主动升级拓扑。
- 新终端按 `skills/herdr-app` 的流程启动并复验，必须在本会话退出后存活。
- 只认显式地址（`t7` / `vps/t7`）或唯一名字，不依赖他人的焦点。
- ID 与状态只取自返回值，不从正文或 sidebar 顺序推断。
- `blocked` 一律询问用户。
- 交出后不等待、不轮询。
