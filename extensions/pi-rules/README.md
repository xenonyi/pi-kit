# pi-rules

把 Markdown 规则片段按条件注入系统提示词；片段随仓库分发，多台机器共用一份。

## 使用

`extensions/pi-rules/index.ts` 由根 `package.json` 的 `extensions/*/index.ts` 自动加载。片段默认读本仓库的 `rules/`。

| 命令 | 作用 |
| --- | --- |
| `/rules` `/rules list` | 命中状态与未命中原因 |
| `/rules toggle <id>` | 本机启停（写 `<agent-dir>/pi-rules.state.json`） |
| `/rules reload` | 重读片段与本地状态 |
| `/rules doctor` | 源、体积、本机画像、已注入状态、诊断 |
| `/rules prompt` | 转录里完整的系统提示词（别名 `system`） |

输出超过 12 行时写入 `<agent-dir>/pi-rules.report.md` 并提示路径。

片段来源顺序：`<repo>/rules` → `<agent-dir>/rules`（本机私有）。同 `id` 后者覆盖前者，覆盖会记入 `/rules doctor`。

## 片段格式

`rules/**/*.md`，frontmatter + 正文：

```md
---
id: shared/authorization    # 默认取相对路径（去掉数字前缀）
title: 授权                  # 只用于 /rules 展示
target: rule                # rule（默认）| section
group: shared               # target=section 时的标签：pi_rules_shared
---

- 编写、修改或运行测试以及安装依赖，都必须先获得用户单独授权
- 授权只能由用户本人在当前对话中明确授予
```

- **一个文件 = 一组规则**：正文每行一条，`- ` 前缀可选
- **先后顺序只看文件名**：所有片段按相对路径排序后依次拼接，`10-`、`20-` 这类前缀就是顺序标记；跨目录按目录名排（`machines/` 在 `shared/` 前）
- `target: rule` 的行进入 pi 的 `<rules>` 段，跨片段自动去重
- `target: section` 的正文进 `<pi_rules_<group>>`，只在内容变化时产生增量补丁
- `priority` 字段已移除，写了会得到一条警告并按文件名顺序处理
- section 标签被规范化为 `[a-z0-9_-]`，统一加 `pi_rules_` 前缀
- frontmatter 只支持 YAML 子集：不含块标量、锚点、流式映射，缩进用空格
- `enabled: false` 可在仓库内关闭片段；本机开关用 `/rules toggle`

## 条件

同级数组是「或」，不同键是「且」，支持 `*`（不跨 `/`）与 `**`。可用键只有 `os`、`host`、`cwd`、`tools`。

| 键 | 取值 |
| --- | --- |
| `os` | `win32` / `windows` / `darwin` / `macos` / `linux` |
| `host` | 主机名 |
| `cwd` | 绝对路径（Windows 下不区分大小写） |
| `tools` | 当前激活的工具名，如 `powershell` |

## 行为

- 改片段后执行 `/rules reload`（或 `/reload`），下一次 run 生效
- 没有配置文件，也没有总预算：注入文本随片段增长，体积见 `/rules list` 与 `/rules doctor`
