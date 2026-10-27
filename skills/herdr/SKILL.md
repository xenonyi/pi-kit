---
name: herdr
description: Herdr 操作入口：控制 pane、tab、workspace 与 pane 内的 agent。优先用 pi-herdr 扩展的 herdr_* 工具；工具未覆盖的走 herdr_cli 透传，flag 记不清就读 `herdr --skill` 契约。仅在 Herdr pane 内可用（工具缺失即不在 pane 内）。
---

# Herdr

## 前提

工具列表里有 `herdr_*` 才算在 Herdr pane 内——扩展按 `HERDR_ENV=1` + 非空 `HERDR_PANE_ID` 门控，不在 pane 内时这些工具根本不声明。

没有这些工具 → 停，告诉用户你不在 Herdr pane 内，不要从外部操控别人的会话。

## 分层：工具、透传、契约

| 要做的事 | 用什么 |
| --- | --- |
| 拆 pane、起 agent、读状态、投递 prompt、读输出 | `herdr_*` 工具 |
| 其余子命令（`neighbor` / `notification` / `pane close` / `worktree` / `pane run` / `api schema` …） | `herdr_cli` 透传，参数是 argv 数组 |
| 记不清的 flag 与返回体 | `herdr --skill`（二进制自带的权威契约），或 `herdr_cli ["<group>","--help"]` |

| 工具 | 用途 |
| --- | --- |
| `herdr_pane_split` | 拆调用方 pane，返回新 pane id；省略方向时按几何推导（宽→`right`，窄/高→`down`），默认 `--no-focus`、继承调用方 cwd |
| `herdr_agent_spawn` | 拆 pane + `agent start` + 就绪检查合成一步；启动不就绪也返回 pane id，从不重试 |
| `herdr_agent_get` | 归一化状态：name/kind/status/cwd/`completion_seq`/`state_change_seq`/session path。缺失字段是 `null` 或 `"unknown"`，**不是 false** |
| `herdr_agent_prompt` | 不带 `--wait` 投递，3 秒后返回 `startObserved`；只接受 `idle` / `done` |
| `herdr_agent_read` | 读 pane 输出，默认 `recent-unwrapped` 120 行 |
| `herdr_cli` | 其余子命令。空参、`server stop`、`update`、`workspace close --group`、关闭调用方自己的 pane 一律拒绝 |

所有语义工具都接受可选 `machine`（`herdr machine list` 里的 label 或 id）：带上它，整次调用都加 `--machine` 前缀，读写都在那台机器上。

- 远端 `--current` 不成立：`herdr_pane_split` / `herdr_agent_spawn` 必须同时传 `pane`（那台机器上的 pane id），cwd 默认取该 pane 的 `pane get` 结果。
- ID 与 agent 名是各机器自己的，两台都可能有 `w1:p1`；返回体里的 `machine` 字段说明这次落在哪。
- 工具只覆盖 pane / agent 动作。`worktree create`、`notification`、`pane close` 等仍走 `herdr_cli` 并自带 `--machine`。

## 硬规则

- **不要在 shell 里拼 herdr 命令**：工具已经是 argv，绕过只会引入引号与方言错误（Windows 上是 PowerShell）。
- **不裸跑 `herdr`**：它会启动或附加 TUI，不是查询。`herdr_cli` 会拦，别绕。
- **不靠省略参数探路**：`herdr workspace create`、`herdr worktree create` 这类「看起来像帮助」的裸调用会**真的执行**。
- **id 只从返回值取**：`structuredContent`（脚本调用时）或 `details`。不要从正文正则抓，也不要从 sidebar 顺序推测——本仓库曾因此关掉自己的 pane。
- **`blocked` 一律问用户**：Herdr 认出了审批或提问界面，不代答。
- 本文件只写判断；命令细节以 `herdr --skill` 和二进制为准。
