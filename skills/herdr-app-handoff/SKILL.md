---
name: herdr-app-handoff
description: 把当前任务连同上下文移交给 herdr-core 中的新终端 agent（或已存在的 idle agent），交出后不等待、不轮询。保证用户随时可接管；终端操作全部走 `pi-herdr` 扩展的 `herdr_*` 工具。仅在用户明确说 handoff、交接、移交给 X、换人接手时使用。咨询与 handoff 的分界在所有权，不在并行。
---

# Herdr App Handoff

交接是交出所有权，交出后不再等待。咨询在结论返回后就结束，所有权留在本会话。handoff 把任务交给用户可见、可接管的终端，对方从零上下文开始。

## 0. 操作方式

命令与字段已由 `pi-herdr` 扩展固化：`herdr_terminals` 看现状（deferred，未声明时先 `tool_search`），`herdr_start` 开新终端，`herdr_send` 投递，`herdr_ui` 调整可见性。默认拓扑、起步细则和“工具不可用时的等价 CLI”见 `skills/herdr-app`，这里不重复，也不要读 `hc --skill`。

`HC_TERMINAL_ID` 为空就停止，告诉用户当前不在 hc 终端内。窗口不在时交接仍可执行，但用户看不到结果。先询问是否现在开窗。

## 1. 拓扑：用户说到哪一步，就只做到哪一步

| 用户说的 | 用 |
| --- | --- |
| “交给右边那个”或已经存在的 agent | `herdr_terminals` 取地址与状态 → `herdr_send` |
| “开个新 agent 做” | `herdr_start`，`placement: "pane"`、`focus: true`。落点看返回的 `spaceName`、`tabName` |
| “派个后台的” | `herdr_start`，`placement: "background"` |
| “在工作树里做” | `git worktree add` → `herdr_start` 以 worktree 为 `cwd` |
| “新目录”“新项目” | `herdr_ui space.new` |

默认使用可见的同级 pane，位置、方向和 `cwd` 按 `skills/herdr-app`，不要主动升级拓扑。worktree 自己用 git 创建，汇报时给出绝对路径与分支。远端机器上开不了新终端：`herdr_start` 不支持 `--on`，只能按等价 CLI 手写 `hc run --on <machine> …`。向已有远端终端投递仍用 `herdr_send vps/t7`。

目标已经存在时，先看 `herdr_terminals` 返回的 `address` 与 `status`。只有 `idle` 和 `done` 可以投递；`blocked` 读屏后转述用户；`working` 会插入它当前的一轮，等它结束，或先问用户。

## 2. 交接文档

文档共九节，缺哪节写“无”。前四节是 Task、Context、Relevant files、Current state。后五节是 What was tried、Decisions、Acceptance criteria、Constraints、Working directory。完整骨架（含每节说明）在 `references/handoff-template.md`，需要照抄时再读。轻量交接按这九个标题书写即可。

- 给路径，不粘内容。验收判据必须可验证。
- 保留用户原意。调研任务写 `DO NOT edit files.`，修 bug 写“实现修复”，重构写“重构，不要重写”。
- 结尾写 `When done, report: what changed, what you ran, what you did not do.`。长结论写入文件并回路径，或用 `herdr_send` 回到本会话地址。

## 3. 只投递一次，不等待

新终端的文档已经包含在 `herdr_start` 的 `task` 里，不要重发。超长时工具自动落盘，见返回体的 `taskFile`。已存在的 agent 用 `herdr_send`。

- 不要加 `wait: true`，那等于等待它完成。
- `started` 为 true、false 或 null，都不代表投递失败。先 `herdr_read` 再判断，不要盲目重发。
- 长文档写成文件，prompt 里给路径。

## 4. 交回控制权

用 `herdr_ui` 的 `agent.focus`（`{command: "agent.focus", args: {terminal: "<t>"}}`），或让用户敲 `/herdr focus <t>`。然后说明四件事：

- 交给了谁：agent、名字和地址。
- 用户可以随时在窗口内接管：`/herdr focus`、`/herdr peek`、sidebar。
- 本会话不再等待，也不轮询。
- 它是用户的终端，不是隐藏的子 agent。

## 5. 用户后续追问时

- 进度看 `turn`。刚启动时 `status` 也是 `idle`，只看状态会误判。
- 追加指令可以等待：`herdr_send` 配 `wait: true` 和 `timeout`。
- 回读分三层：要求它写绝对路径并只回路径，然后读它自己的产物文件，最后兜底用 `herdr_read`。`herdr_read` 只用来判断卡在哪里，不要搬运长文本；deferred 时先 `tool_search`。
- 卡住时回退 CLI，执行 `hc interrupt <t>`，只终止这一轮。

## 6. 清理仅限失败回滚

**成功后不要关闭任何东西**，关闭后用户无法接管。只在启动失败、投递失败、用户取消或用户明确不要时清理，并且只清理自己创建的终端。`herdr_kill` 的 `scope` 用 `program`（保留终端）或 `pane`（连 pane 一起收），`confirm: true` 只在用户同意后给。去掉 pane 后焦点会自动回到原位。`git worktree remove --force` 需要用户确认。

## 失败对照

| 现象 | 下一步 |
| --- | --- |
| 屏上没有文档，`turn` 一直为 0 | `herdr_read` 确认就绪状态，再发一次，不要重起 |
| `no running terminal`（新终端刚建） | 窗口还没看到它。等 1～2 秒，用 `herdr_ui` 的 `terminal.keep` 再试一次，不要重开终端 |
| `status_mismatch` 的“is silent, not idle” | 目标不上报状态，去掉 `if_status` |
| `blocked` | 读屏后转述用户，不代为回答 |
| `reason: timeout` | 180 秒签到，不是失败 |

## 硬规则

- 默认使用可见的同级 pane，不主动升级拓扑。
- 新终端必须在本会话退出后存活。`outliveParent` 不是 true 就重开。
- 只认显式地址（`t7`、`vps/t7`）或唯一名字，不依赖他人的焦点。
- 地址和状态只取自 `herdr_terminals` 或返回值，不要从正文或 sidebar 顺序推断。
- `blocked` 一律询问用户。
- 交出后不等待、不轮询。成功后不关闭任何东西。
