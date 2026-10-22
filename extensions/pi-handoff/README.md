# pi-handoff

通过 `/handoff` 将当前活动分支的上下文交接给新会话。内容遵循固定 JSON Schema，审核时显示 Markdown 预览；确认后仅填入草稿，**不会自动发送**。

## 使用

```text
/handoff <新会话目标>
/handoff --split right <新会话目标>
/handoff --split down <新会话目标>
/handoff --here <新会话目标>
```

默认打开新的 herdr 标签页；`--split` 打开分栏，二者均需 herdr 管理的窗格；`--here` 在当前窗格新建会话。仅支持交互模式。

## 审核

- 确认键（默认 `enter`）：接受预览并创建目标会话；取消键（默认 `escape`，也可 `ctrl+c`）：取消整次交接。
- `ctrl+e`：编辑完整 JSON；提交校验后返回预览，仍需再次确认。编辑器内取消仅放弃本轮编辑。
- `j/k`、`up/down`、`pageup/pagedown`、`home/end`：滚动只读预览，不影响 JSON 编辑器输入。
- 确认、取消和方向键遵循 Pi 自定义键绑定；预览按终端高度收起标题或提示，优先保留边框与正文。
- 非法 JSON、缺字段、未知字段或无效值不能交接；编辑内容保留以便修正。外部编辑器禁用，避免折叠粘贴丢失。
- `goal`、`schemaVersion` 不可编辑；改变目标须取消后重新运行命令。

## 数据契约

`src/data.ts` 导出 `HandoffDataSchema` 和 `HandoffData`；所有字段必填，拒绝额外字段，不做类型强转或自动补齐。

- `schemaVersion` 固定为 `1`；`goal` 必须与命令目标完全一致，二者由程序填写而非模型生成。
- `summary`：非空背景摘要；`nextSteps`：至少一项的有序待办。
- `completedWork`、`decisions`、`constraints`、`openQuestions`、`risks`：字符串数组。
- `files`：`{ path, purpose }` 数组；`verification`：`{ action, status, details }` 数组。
- `verification.status`：仅 `passed`、`failed`、`not_run`、`unknown`，明确区分通过、失败、未执行和结果未知。
- 除 `nextSteps` 外数组可为空，预览显示“未记录”，不代表已确认没有问题。
- 所有文本须含非空白字符；除换行、回车和制表符外，禁止 ASCII 控制字符。
- `goal`、`summary` 各最多 8192 字符，文件路径最多 2048 字符，其余文本最多 4096 字符。
- `files` 最多 64 项，其余数组最多 32 项；结构化数据序列化后最多 256 KiB。

## 稳定性与存储

1. 模型仅通过 `submit_handoff` 提交数据；不从自由文本提取 JSON，也不执行交接内容中的工具或命令。
2. 提供商支持时优先严格 JSON Schema 采样；所有结果均需本地校验。
3. 仅接受正常结束且恰有一次正确工具调用的完整响应；拒绝截断输出。格式错误最多重试一次，共用 120 秒时限，每次最多 8192 tokens；不主动重试提供商或认证错误。
4. 预览与目标草稿由同一份审核通过的数据确定性生成，避免文本与 JSON 分叉。
5. `customType: "pi-handoff"` 自定义记录以 `data.handoff` 保存结构化内容，并保留来源、目标、时间与交接链；记录不进入模型上下文，草稿须用户主动发送。
6. 临时包写入、读取及 `--here` 切换前均校验 Schema、目标与草稿一致性；保留私有目录、一次性认领、取消、超时、回执及草稿备份机制。

旧会话仅含来源的记录仍可显示；缺少结构化内容的旧版临时包会被拒绝，须重新发起交接。

Schema 仅保证数据形状，不保证总结事实正确或信息完整；关键决策、约束与验证证据仍须人工审核。提供商不遵循工具协议时明确失败，不降级为纯文本。
