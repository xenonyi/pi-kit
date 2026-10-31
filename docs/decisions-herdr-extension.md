# Herdr skills → pi extension：决策记录

主题：把 `~/.agents/skills/herdr` 与 `herdr-handoff` 改造为 `pi-kit` 内的 pi extension。
强度：拷打。记录方式：增量追加「结论 + 理由」。

## 已勘明的事实

- 本机 `herdr.exe` 在 `D:\Libs\scoop\shims\herdr.exe`；当前会话在 pane 内（`HERDR_ENV=1`, `HERDR_PANE_ID=wB:p1`）。
- `herdr status`：client/server 均 `0.9.5`，`protocol: 22`，`endpoint_compatible: yes`。
- `herdr api schema --json`：283 KB，约 117 个 `$defs`（`AgentPromptParams`、`AgentStartParams` …），带 `protocol: 22`、`schema_version: 1`。契约可机器读取，但不可能塞进上下文。
- `herdr --skill` 正文是 bash，其自身声明「二进制才是权威」。
- pi extension 能力：`registerTool`（含 `exposure` / `namespace` / `annotations` / `executionMode`）、`registerCommand`、`before_agent_start`、`session_start`、`resources_discover`。
- 仓库现状（当时）：7 个扩展，工具一律具名直连（`lsp_diagnostics` / `lsp_fix` / `ask_user_question`），无 namespace 分组；`pi-mcp` 用 `exposure: "codemode"`。
- 仓库零测试，仅 `pnpm tsc`；skills 目录只有 `grill`，两个 herdr skill 在仓库外 `C:\Users\x1any\.agents\skills\`。

## 已定的结论

| # | 结论 | 理由 |
| --- | --- | --- |
| 1 | 目标锁定「机械层」：消灭 shell 拼装与手工 JSON 解析 | 这是唯一「代码比模型做得更准」的部分；不改写 herdr 语义 |
| 2 | 分层：skill = 政策层（该不该做、选哪种拓扑），extension 工具 = 机械层（怎么安全地做） | 判断留在可读文本里，机械交给代码；避免两套指令互相稀释 |
| 3 | 白名单 6 个，按「模型易错」取舍：`pane_split`（自动定向）、`agent_spawn`（split+start+就绪检查合成一步）、`agent_get`（归一化）、`agent_prompt`（默认不 `--wait`）、`agent_read`、`herdr_cli`（透传兜底） | 未覆盖动作（neighbor / notification / close / worktree / pane_run）返回体简单，透传不易错；避免为永不使用的动作付常驻声明成本 |
| 4 | 状态门 fail-closed：门不过即 throw，错误信息写明缺哪个字段、建议怎么做 | 写操作误发比拒绝更贵；纯机械项（方向推导、`completion_seq` 缺失→0）自动处理 |
| 5 | 跨机：语义工具只作用于本机当前 session；`--machine` 只出现在透传工具 | 静默打到本机同名 agent 是最危险的失败；宁可让模型显式切到透传 |
| 6 | 漂移：`session_start` 跑一次 `herdr status`，`protocol`/`version` 不符则告警，把「版本变了」与「字段缺失」分开报；不拒绝调用 | fail-closed 会把漂移放大成彻底不可用；自检的作用是让人看懂失败原因 |
| 7 | 测试：纯函数层用 `node:test`（Node 22.19 自带，`--experimental-strip-types`，零新依赖）；真机行为在命名 test session 手工验收 | 仓库现无测试；风险集中在归一化与门控，而非进程调用。跑测试需另行授权 |
| 8 | 透传安全：短黑名单硬拦——空参调用（会启动/附加 TUI）、`server stop`、`update`、`workspace close --group`；其余放行并在错误里说明原因 | 黑名单越长越可能挡住合法场景；这四条是「不可恢复」或「会弄坏本扩展自身」 |
| 9 | skill 两个都改：`herdr` 删 bash→PowerShell 对照表、换工具表 + 优先级；`herdr-handoff` 把命令段落压缩成一句，保留拓扑选择 / 状态门语义 / blocked 不代答 / 交接文档骨架 / 回读三层 / 失败对照 / 硬规则 | 对照表是纯机械痛点，已被工具消灭；handoff 的价值在判断而非命令写法 |
| 14 | **`herdr_cli` 也加 `machine` 参数**（不改结论 3 的白名单）：`--machine` 写进 args 时必须前置，`herdr pane list --machine box` 报 `unknown option: --machine`，报错不提示位置；由 `passthroughArgs` 统一构造，并拒绝「写在后」与「两处同给」 | 这是真实踩过的坑（2026-10-28 在 gpuserver 上取 `pane list`）。改参数而不是加新工具：`pane run` 的机械步骤已进 skill，而「这 pane 空闲吗」只能看屏，编码成工具反而制造假保证 |
| 13 | **跨机：5 个语义工具加可选 `machine`**（推翻结论 5） | 用户明确要求 B。跨机 handoff 不再只能手工拼 cli；代价是要处理远端 `--current` 不成立，故 `pane_split` / `agent_spawn` 在 `machine` 下必须给 `pane`，cwd 从 `pane get` 取。`herdr_cli` 后来也补上了 `machine`（见结论 14） |
| 12 | `agent_prompt` 默认复查：提交后等 3s 取一次 `agent get`，返回 `{submitted, startObserved}`；不增长即 `startObserved=false` | 交接流程刻意不带 `--wait`，拿不到 5 秒活动门；这是 skill 里最反直觉的一条判据，正适合交给代码。代价是固定 +3s |
| 11 | 门控：`HERDR_ENV`/`HERDR_PANE_ID` 不满足时，6 个工具按 session 重新注册为 `hidden`；沿用 `pi-ask-user-question` 的每-session 重注册模式 | 在 paseo 等非 herdr 环境里，永不生效的工具不该占声明位；而 herdr 内门控不产生任何成本 |
| 10 | 不合并两个 skill | 触发条件不同（通用控制 vs 明确 handoff）；合并后为了看一眼隔壁 pane 要读 14 KB |

## 已定的实现细节（写码时敲定）

| 项 | 结论 | 依据 |
| --- | --- | --- |
| cwd 来源 | 取 `pane current --current` 返回的 `cwd`，`cwd` 参数可覆盖 | 实测返回体含 `cwd: D:\Workspace\pi-kit`，无需 `pane process-info` |
| 方向退化 | 每一半至少 40 列或 8 行，否则拒绝并说明 | 避免拆出不可用窄列 |
| 并发 | 6 个工具全部 `executionMode: "sequential"` | 同一批调用里两个 split 会互相破坏布局 |
| 读取默认值 | `agent_read` 默认 `recent-unwrapped` / 120 行 | 与 skill 的视口语义一致；要看全量再调大 |
| 命名 | 前缀 `herdr_`（`herdr_pane_split` …） | 与仓库单前缀风格（`hash_`、`lsp_`）一致 |
| 就绪判定的适用范围 | `interactive_ready` 只用于 `agent start` 的返回值 | 实测 `agent get` 不带该字段，据此做门控会让 prompt 永久不可用 |

## 验收结果（真实二进制，0.9.5 / protocol 22）

| 路径 | 结果 |
| --- | --- |
| `isHerdrPane` / `pane current --current` | 通过；cwd 取到 `D:\Workspace\pi-kit` |
| `agent get` → 归一化 | 通过；`interactive_ready` 缺失记为 `unknown`，`completion_seq` 缺失记为 0 |
| `agent read` | 通过（`recent-unwrapped`，739 字符） |
| `status --json` → 兼容检查 | 通过（protocol 22/22） |
| 错误映射 | 通过（`agent_not_found` + message） |
| 方向推导 → `pane split` | 通过；130x53 → `right`，新 pane `wB:pC`，`--no-focus` 生效 |
| `agent start` → 就绪判定 | 通过；真实返回含 `interactive_ready: true`、`name`、`state_change_seq`，`launch_pending` 缺失→`unknown` |
| `agent_prompt`（无 `--wait`）+ 3s 复查 | 通过；`startObserved=true`（`state_change_seq` 81→83，`completion_seq` 0→83） |
| 清理 | 通过；只关自己建的 pane，会话内始终只剩 `wB:p1` |

**reload 后复验（2026-10-27）**：`herdr_pane_split` 返回对象 `{paneId: wB:pJ, direction: "down", cwd, fromPaneId: wB:pH}`——新 pane 宽 73，半宽 36 < 40 列下限，按规则退到 `down`；`herdr_agent_get` 返回完整结构化字段；`herdr_agent_prompt` 对 `working` 目标按门拒绝；`herdr_cli pane close wB:pH` 被新护栏拦住；新建 pane 用 `paneId` 关闭并以 `agent_not_found` 验证。

**事故（2026-10-27，已修）**：验收时用正则从 `herdr_pane_split` 的**文本**里抓 pane id，抓到的是第一行里的调用方 pane（`Split wB:p1 …`），随后 `pane close wB:p1` 关掉了正在运行的 pi pane。`herdr pane close` 不继承 TUI 的确认，关了就真关；pi 进程随之结束，会话在新的 `wB:pH` 里恢复。

根因不是 pi 崩溃，而是工具只把 id 放在正文里。修复：6 个工具全部声明 `outputSchema` 并返回 `structuredContent`（`paneId` / `status` / `startObserved` 等），文本改为把新 pane id 放第一行，并在 `promptGuidelines` 里明确「不要从正文抓 id」。新增测试断言每个工具都有 `outputSchema`（共 52 例）。

**注册层缺陷（已修，2026-10-27）**：改 `tools.ts` 时把 `registerHerdrTools` 末尾循环里的 `pi.registerTool(tool)` 删成了 `return undefined;`，导致任何 session 都注册 0 个工具（pane 内外都没有 `herdr_*`）。`tsc` 抓不到（void 函数允许 `return undefined`），先前验收直接驱动模块、绕过了注册层，所以也没抓到。已修复，并新增 `src/registration.test.ts`（用 stub `ExtensionAPI` 加载真实工厂，断言 6 个工具、`sequential`、hidden→direct 门控），测试总数 51。

**验收发现的缺陷（已修）**：`pane split --cwd <dir>` 回显带尾部分隔符（`D:\Workspace\pi-kit\`），与调用 pane 的 cwd 不等。已在 `normalize.ts` 加 `normalizeCwd`（保留 `/` 与 `C:\` 根），并补两条测试（现共 46 例）。

## 实现状态

## 实现状态

- 已落地：`extensions/pi-herdr/`（`index.ts` + `src/{cli,args,normalize,gates,tools}.ts`）、扩展 README、根 README 表格行。
- 测试：`node --test` 跑 44 个纯函数用例全绿；`pnpm tsc` 干净。
- 只读冒烟：真实 `herdr agent get` / `status --json` 走通 `cli → normalize → gates`，错误路径返回 `code` + `message`。

## 待办

- **工具注册层**：已验证。修复后新起的 pi 会话（`2026-10-27T16-53-05`）系统提示里声明了全部 6 个 `herdr_*` 工具；修复前的会话（如 `wB:pG` / `2026-10-27T16-48-37`）仍为空，需 `/reload` 或重启。
- **skill 改写（已完成 2026-10-27）**：两个 skill 改写后移入仓库 `skills/herdr` 与 `skills/herdr-handoff`，原目录 `C:\Users\x1any\.agents\skills\{herdr,herdr-handoff}` 已删除（避免重名冲突，pi 遇到同名会保留先发现的那个并告警）。`herdr` 删掉 bash→PowerShell 对照表，改为「工具 / 透传 / 契约」三层 + 6 个工具表；`herdr-handoff` 12 KB → 9.3 KB，命令段落全部换成工具调用，判断内容（拓扑、状态门、文档骨架、回读三层、失败对照、硬规则）保留。三个 skill 的 frontmatter 均通过校验（name 与目录一致、description 单行、≤1024 字符）。
- **skill 改写**（仓库外 `C:\Users\x1any\.agents\skills\herdr` 与 `herdr-handoff`）：用户明确暂缓。改前先确认是否备份。
- **真机验收**：在命名 test session 里跑一次完整 handoff（split → spawn → prompt → probe → read），确认 `startObserved` 判据与 0.9.5 实际行为一致。涉及真实 pane，需单独确认。
- **`agent start` 返回体**：仍未实测（未在你的会话里起过 agent），`normalizeAgentView` 按 schema 的 `AgentInfo` 兼容读取，验收时顺带核对。
