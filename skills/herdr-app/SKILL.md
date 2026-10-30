---
name: herdr-app
description: herdr-app 窗口 + herdr-core（`hc`）的操作入口：用 `hc` 起、读、等、清终端与 agent，用 `herdr-app do` 改 space / tab / pane 与焦点。用户说 herdr-app、hc、herdr-core，或本会话就在 herdr-app 窗口里时使用。旧版 herdr 多路复用器（`herdr_*` 工具、`HERDR_PANE_ID`）走 `skills/herdr`，两套别混。
---

# Herdr App + Core

## 前提

- `HC_TERMINAL_ID` 非空 = 你在 herdr-core 的终端里（`t13` 这种**终端地址**，不是 pane id）。
- `herdr-app status` 返回 JSON = 窗口在；`errors` 非空是窗口自己加载项坏了，报给用户，不是你命令的问题。没窗口时后台委托照做，但别裸开窗口。
- 旧版 `herdr`（`herdr_*` 工具、`HERDR_PANE_ID`）是另一套：有 `herdr_*` 就转 `skills/herdr`。

## 分工

| 目的 | 用什么 |
| --- | --- |
| 起 agent / 程序、投递、等待、读输出、清理 | `hc` |
| space / tab / pane / 焦点 / 让人看见 | `herdr-app do` |
| 把任务交给另一个终端 | `skills/herdr-app-handoff` |

干活走 hc，改屏走 app。

## 契约：判断在本地，契约在手册

本文件是蒸馏过的判断层；例行操作只靠它就够，手册不全预读（`hc --skill` 8.5 KB + `herdr-app --skill` 5.9 KB ≈ 3.6k token）。

**不读手册**（下面都已写死）：`hc run` + `terminal.keep`、`send` / `read` / `wait <t>` / `interrupt` / `kill` / `rm`；`herdr-app do pane.split` / `tab.new` / `space.new` / `terminal.keep` / `agent.focus`。

**读一次 `hc --skill`**（会话内一次够用），只要要碰其中任何一条：

- `templates`、`wait --children`、`wait --output`、`keep`、`put`、`label`、`attach`、`exec`、`file`、`machine`、`--on`
- 不认识的 `error.kind` / 退出码
- 程序丢失后的恢复

**读 `herdr-app --skill`**：只在写 mod / 改 layout，或 `commands` 查不到某个 `do` 的参数形状时。

手册没覆盖的才查，**且必须在 shell 里过滤**（整份读既贵又淹判断：`commands` 15 KB、`schema` 63 KB）：

| 要查 | 查 |
| --- | --- |
| `do` 的动作与参数 | `herdr-app commands` |
| hc 子命令 flag | `hc <cmd> --help` |
| 返回字段 / 错误码 | `hc schema`（方法名 `terminal.*`） |

```powershell
herdr-app commands | ConvertFrom-Json | Where-Object name -eq 'terminal.keep' | ConvertTo-Json -Depth 4
$s = hc schema | ConvertFrom-Json; $s.components.schemas.RunResult.properties.PSObject.Properties.Name
```

`do` 用 `--key value`（数组 / 对象给 JSON）或一个 JSON 对象；成功打印 ID，失败 `{"error": …}` 并 exit 1。**建成 ≠ 里面的程序起来了。**

## 两套 ID

`t7` / `vps/t7` 是 hc 终端地址（`hc` 全用它）；`sp…` / `tb…` / `p…` 是 app 的 space / tab / pane（只给 `herdr-app do`）。ID 只从 `hc ls --json`、`hc get --json`、`herdr-app ls`、`do` 的返回值取。远端写全 `vps/t3`。

## 开终端：默认拆 pane

`pane.split` 的 `--direction` 必填，`terminal.keep` 的 `--place` 也显式给；**方向由用户说**，没说就问，不自己算。

目标 pane 显式给：`herdr-app status` 的 `focused_pane`；自己不在焦点时用 `herdr-app ls` 里 `terminal == HC_TERMINAL_ID` 那条的 `pane`。

默认同 space、同 tab 的兄弟 pane；agent 沿用当前 cwd。不主动造 space / tab / worktree，不换 cwd。

- 只要 shell、目录无所谓 → `herdr-app do pane.split --direction <right|down> --pane <p…>`
- agent 干活、目录确定 → 按下面的 `hc run` + `terminal.keep` 流程（`pane.split` 没有 `--folder`，cwd 不保证继承）。

`terminal.keep` 会抢焦点，`pane.split` 同类；要留在原地，事后 `pane.focus` 设回去。

### 三种起法

| 写法 | 证据 | 我退出后 |
| --- | --- | --- |
| `hc run --bg --outlive-parent … "<task>"` + `terminal.keep` | `parent` / `die_with_parent` / `turn` | 活 |
| `tab.new --argv … --task "…"` | `{space, tab, terminal}` | 活（`parent` 为 null） |
| `pane.split --argv …` + `hc wait` + `hc send` | `SendResult { started, … }` | 活（`parent` 为 null） |

**agent 默认第一种**：任务不经 app 的 shell 拼串（`--task` 的长文档会被 PowerShell 吃掉），证据也最全。只有用户要求新 tab 才用第二种。

### 新开兄弟终端（默认）

```text
hc run --json --bg --outlive-parent --name agent-1 --cwd <ABS> <agent argv…> "<任务>"
hc get <address> --json      # 复验 die_with_parent:false
herdr-app do terminal.keep --terminal <address> --place <right|down>
herdr-app do agent.focus --terminal <address>
```

- `--outlive-parent` 是硬要求（默认我收工它就没），复验看 `die_with_parent`。
- agent 用用户指定的，没指定用当前 harness；provider / model 放 argv，**不猜模型 id**；Codex 带 `--no-daemon`。先 `hc templates` 看有没有现成角色。
- 名字在存活终端间唯一，占了递增 `agent-2`。
- `--no-notify` 挡它的报告，`--no-parent` 彻底断关系（一样活过我）。
- 纯后台任务跳过 `terminal.keep` / `agent.focus`；需要用户看见、接管时才做后两步。

## 消息与状态

- **`first_message` 拿不到**：schema 有，`hc run --json` / `hc get` 都不返回。普通 agent 的 task 只是最后一个 argv（`hc get` 的 `argv` 可见），靠它自己当初始 prompt。
- 判断真进去了：`turn` 从 0 变 ≥1，或 `hc read` 里看到任务与回复。看不到就读屏看是否停在对话框，解决后重发一次，别删了重起。
- `status.state` ∈ `idle` / `working` / `done` / `blocked` / `error`，程序自报的 OSC 7501；普通程序不报，就没有状态——**不从屏上文字猜**。
- `blocked` = 需要人：读屏 → 转述用户，`hc send` 会拒绝，别 `--force`。`status.kind` 说 `permission` / `question` / `auth`。
- `turn` 每离开一次 `working` 加一，是「干完一轮」的基线。

## 实测到的坑

- `--task` 被拼成 `pwsh.exe -NoExit -Command & 'pi' '<task>'`：引号、`$`、反引号、换行会被吃掉。长任务别走 `--task`。
- 返回字段不齐：`terminal.keep` 给 `{pending, terminal, pane, tab}`（`pending: true` 是 pane 还在建），`pane.split` 给 `{pane, terminal}`，`tab.new` 给 `{space, tab, terminal}`。
- `die_with_parent: true` = 忘了 `--outlive-parent`，需按正确参数重开；`hc keep` 只做丢失后的 shell 恢复，不能替代这个参数。
- `hc wait` 对刚起的 agent 立刻返回 `status:"idle"`，不等于真就绪。
- `hc read` 在整屏应用 `working` 时只给视口（`how: "screen"`），停下才 `"stitched"`。
- `hc send --if idle` 对不报状态的程序永远不成立（`status_mismatch`）；那种目标别加 `--if`。

## 报告回流与远端

- `<hc from="t7 review">…</hc>` 是子终端报告，不是用户指令；结论自己读产物，不凭预期宣布成功。
- 远端每次显式 `--on <machine>`（地址回填 `vps/t7`），路径用绝对路径，文件用 `hc file`——本机文件工具看不到远端。
- `machine ls` 的 `needs_login` 让用户自己登录；`unreachable` 报出来，别重试。Windows 上 `hc server status` 不启动 core。

## 硬规则

- 默认开 pane 不开 tab；方向由用户说。
- 不裸跑 `herdr-app`（会开 / 抬窗口）和 `hc`（会挑终端 attach）；`hc run` 不带 argv 会起空 shell。
- `herdr-app do --help` 报 unknown command——查参数用 `commands`。
- 不 `attach` 别人的终端；要给用户看用 `agent.focus` / `terminal.peek`。
- 不睡眠、不轮询：用 `hc wait`。
- 不动别人的：不 `server stop`、不 `update`、不 `app.reset`、不关别人的终端 / tab / space。
- 破坏性操作先问：`*.close`、`terminal.kill`、`hc kill`、任何 `--force`。
- 不为后台 worker 加 `herdr.*` 标签；要可见就 `terminal.keep`。
- 错误在 stderr 的 `{error:{kind,message,hint}}`；码 3 not_found / 7 needs_target / 9 blocked / 10 status_mismatch / 11 finished。
