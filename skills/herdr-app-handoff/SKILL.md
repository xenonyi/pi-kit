---
name: herdr-app-handoff
description: 把当前任务连同上下文移交给 herdr-core 里的一个新终端 agent（或已有 idle agent），交完不等、不轮询。保证用户随时能接管；新终端的启动方式见 `skills/herdr-app`。仅在用户明确说 handoff / 交接 / 移交给 X / 换个人接着做 时使用；判断只读咨询与 handoff 的区别是所有权，不是并行。需要 herdr-core 的 `hc`。
---

# Herdr App Handoff

交出**所有权**，不是请人给意见：交完不等。区别在所有权，不在并行——那种委托结论回来就结束；handoff 是把任务交给一台用户看得见、能接管的终端，对方从零上下文开始。

## 0. 操作方式不在这里

命令、参数、状态门、返回码、远端规则都在 `skills/herdr-app`，并按它说的先读 `hc --skill`。新终端的起法与启动复验见它的[「开终端」](../herdr-app/SKILL.md#开终端默认拆-pane)，这里不重复。

`HC_TERMINAL_ID` 为空 → 停，告诉用户你不在 hc 终端里。窗口不在（`status` 失败）时交接仍可做，但「让用户看得见」失效——先问要不要现在开。

## 1. 拓扑：说在哪就只做到那一步

| 用户说的 | 用 |
| --- | --- |
| 「交给右边那个」/ 已有 agent | `herdr-app ls` → `hc get` → `hc send` |
| 「开个新 agent 做」 | 按 `skills/herdr-app` 的「新开兄弟终端」流程 |
| 「派个后台的」 | 同上，先不 keep / focus |
| 「在工作树里做」 | `git worktree add` → 按上述流程以 worktree 为 cwd 启动 |
| 「新目录 / 新项目」 | `herdr-app do space.new` |

默认可见兄弟 pane；位置、方向、cwd 与启动复验按 `skills/herdr-app`，不主动升级拓扑。worktree 自己用 git 建，汇报给绝对路径与分支。

### 已有的 agent

`herdr-app ls` 拿 terminal → `hc get` 看 `status.state` / `kind` / `parent`。

只有 `idle` / `done` 可投递；`blocked` 转述用户；`working` 会插进它当前一轮——等或问。

## 2. 交接文档

骨架照抄，缺哪节写「无」：

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

- 给路径不粘内容；验收判据必须可验证。
- 保留用户原意：调研写 `DO NOT edit files.`，修 bug 写「实现修复」，重构写「重构不是重写」。
- 结尾：`When done, report: what changed, what you ran, what you did not do.` 长结论写文件回路径，或 `hc send <我的地址>`。

## 3. 投递一次，不等

新终端文档已在 `hc run` 里，别重发。已有 agent：`hc send <t> "<全文>"`。

- 不加 `--wait`——那就是在等它干活。
- `started` 是 true / false / null 都不等于没送到；先 `hc read` 再判断，不盲目重发。
- 长文档落文件，prompt 里给路径。

## 4. 交回控制权

`herdr-app do agent.focus --terminal <t>`，然后说清四件事：交给谁（agent / 名字 / 地址）；它在窗口里随时能接管（`agent.focus`、`terminal.peek`、sidebar）；我不再等、不轮询；它是用户的终端，不是我藏起来的子 agent。

## 5. 用户回头问时

- 进度看 `turn`——刚启动也是 `idle`，只看 `state` 会误判。
- 追加指令这次可以等：`hc send --wait --timeout 300 <t> "<text>"`。
- 回读三层：让它写绝对路径只回路径 → 读它自己的产物文件 → 兜底 `hc read --lines 200`（只判断卡在哪，不搬长文本）。
- 卡住用 `hc interrupt`，只停这一轮。

## 6. 清理只在失败回滚

**成功后什么都不关**——关掉用户就接管不到。只在启动失败 / 投递失败 / 用户取消 / 用户说不要时清理，且只清自己起的。`terminal.keep` 的终端移除后 pane 自动消失、焦点回原位。`git worktree remove` 的 `--force` 要用户确认。

## 失败对照

| 现象 | 下一步 |
| --- | --- |
| 屏上没有文档、`turn` 一直 0 | 读屏解决就绪，再发一次；不要重起 |
| `status_mismatch`「is silent, not idle」 | 目标不报状态：去掉 `--if` |
| `blocked` | 读屏转述用户，不代答 |
| `reason: timeout` | 180 秒签到，不是失败 |

## 硬规则

- 默认可见兄弟 pane，不主动升级拓扑。
- 新终端按 `skills/herdr-app` 的流程启动并复验，必须活过交接方退出。
- 只认显式地址（`t7` / `vps/t7`）或唯一名字，不依赖别人的焦点。
- ID / 状态只从返回值取，不从正文或 sidebar 顺序推。
- `blocked` 一律问用户。
- 交完不等、不轮询。
