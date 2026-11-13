# orchestrator

由主会话指挥单个 Pi、Codex CLI 或 Antigravity CLI 执行者完成有边界的开发任务，按证据验收并定向返工。执行流程见 [SKILL.md](./SKILL.md)。

## 选择执行者

不指定 CLI 时沿用 Pi。指定 `codex` 或 `agy` 可切换执行者，主会话仍沿用当前模型。

```text
/skill:orchestrator <任务>
/skill:orchestrator codex <任务>
/skill:orchestrator agy <任务>
```

| CLI | 配置文件 |
| --- | --- |
| Pi（默认） | [roles/worker.md](./roles/worker.md) |
| Codex CLI | [roles/worker-codex.md](./roles/worker-codex.md) |
| Antigravity CLI（`agy`） | [roles/worker-agy.md](./roles/worker-agy.md) |

在对应角色文件的 `command` 中调整模型和思考级别。各角色共用 [roles/instructions.md](./roles/instructions.md) 的授权、执行与回报约束；每次派工只加载选中角色和共享约定。

## 运行条件

- 需要 `hc` 和选中的 CLI。派工前核对本地版本、启动选项与模型目录，不会自动安装程序或换用其他模型。
- Codex 必须支持 `--no-daemon`。`agy` 使用 `-i` 传入首条消息；两者都保持交互式运行，每次派工新开会话。
- 非 Pi CLI 用当前会话的原生状态或运行时元数据核验身份，不依赖 `PI_*`。模型或显式思考级别无法核实时，执行者先报告阻塞。
- CLI 不上报 `hc` 状态时，不能把 `-` 当作空闲。任务仍由 `hc send` 回报推进；仅终端回报或通知不可达时，需要用户请求或会话恢复后收取结果，不轮询等待。
- CLI 的信任、权限与沙箱限制继续生效。授权任务不会自动关闭这些限制，弹窗和访问拒绝需要单独处理。

CLI 参数参考：[Codex CLI](https://developers.openai.com/codex/cli/reference/) 和 [Antigravity CLI](https://antigravity.google/docs/cli/reference/)。

## 来源

协作与交接约束改写自 [GPT with Taste](https://github.com/NB-Corp/gpt-with-taste/tree/079fb262b4d7932515ba4e6341fd57b6f2122f4a/prompts)（MIT）。许可证见 [LICENSE.gpt-with-taste](../../rules/LICENSE.gpt-with-taste)。
