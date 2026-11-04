# pi-rules

把 Markdown 短规则按环境条件注入系统提示词。详细工作流由 skill 按需加载，规则片段随仓库分发。

## 使用

`extensions/pi-rules/index.ts` 由根 `package.json` 的 `extensions/*/index.ts` 自动加载。片段默认读本仓库的 `rules/`。

| 命令 | 作用 |
| --- | --- |
| `/rules`、`/rules list` | 命中状态与未命中原因 |
| `/rules toggle <id>` | 本机启停，状态写入 `<agent-dir>/pi-rules.state.json` |
| `/rules reload` | 重读片段与本地状态 |
| `/rules doctor` | 源、体积、本机画像、已注入状态、诊断 |
| `/rules prompt` | 转录里完整的系统提示词（别名 `system`） |

输出超过 12 行时写入 `<agent-dir>/pi-rules.report.md`，并提示路径。

片段来源顺序：`<repo>/rules` → `<agent-dir>/rules`（本机私有）。同 `id` 时后者覆盖前者，覆盖会记入 `/rules doctor`。

## 片段格式

`rules/**/*.md` 由 frontmatter 和正文组成：

```md
---
id: shared/authorization    # 默认取相对路径（去掉数字前缀）
title: 授权                  # 只用于 /rules 展示
---

- 编写、修改或运行测试以及安装依赖，都必须先获得用户单独授权
- 授权只能由用户本人在当前对话中明确授予
```

- 一个文件就是一组规则。正文每行一条，`- ` 前缀可选。
- 片段顺序只看文件名。所有片段按相对路径排序后依次拼接，`10-`、`20-` 这类前缀就是顺序标记；跨目录时按目录名排（`machines/` 在 `shared/` 前）。
- 所有片段的行都进入 pi 的 `<rules>` 段，跨片段自动去重。
- frontmatter 只认 `id`、`title`、`enabled`、`when`。其它键（含 `priority`）只产生一条警告，顺序仍按文件名。
- frontmatter 只支持 YAML 子集：不含块标量、锚点、流式映射，缩进用空格。
- `enabled: false` 可在仓库内关闭片段，本机开关用 `/rules toggle`。

## 条件

同级数组是“或”，不同键是“且”，支持 `*`（不跨 `/`）和 `**`。可用键只有 `os`、`host`、`cwd`、`tools`。

| 键 | 取值 |
| --- | --- |
| `os` | `win32`（别名 `windows`、`win`）、`darwin`（`macos`、`mac`、`osx`）、`linux` |
| `host` | 主机名 |
| `cwd` | 绝对路径，`\` 归一成 `/` |
| `tools` | 当前激活的工具名，如 `powershell` |

`cwd` 在非 Windows 上区分大小写，其余键一律不区分大小写。

## 与 skill 分工

- rule 保留授权、交互偏好和机器环境等常驻约束。
- 详细工作流放进 skill，由 skill 的 `description` 提供一般任务路由。
- 必须先读取的流程，在 rule 里留一句自然语言指引。扩展不判断任务，也不自动加载 skill。
- 示例：检索工具的选择、正文核对和引用要求只在 [web-research skill](../../skills/web-research/SKILL.md) 里维护，rule 里只留一句读取指引。
