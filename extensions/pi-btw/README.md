# pi-btw

`/btw` 命令：问一个不污染会话历史的旁支问题。答案只出现在临时面板，不写进 transcript。

## 使用

```text
/btw 这个渲染补丁挂在哪
```

- 面板按键：`Esc`、`Ctrl+C`、空格或 `q` 关闭，`↑`、`↓` 或 `k`、`j` 滚动，`PageUp`、`PageDown` 翻页。底栏右侧显示滚动位置，标题显示模型 id 与用量。
- 等待期间显示 `Thinking (<model>)...`，可随时取消。
- 单次请求上限 5 分钟（`BTW_REQUEST_TIMEOUT_MS`）。provider 支持 abort 时，底层请求会随取消一起中止。
- 请求失败提示 `BTW query failed: …`，空回答提示 `No answer received`。

## 来源

改写自 [jayshah5696/pi-agent-extensions 的 extensions/btw](https://github.com/jayshah5696/pi-agent-extensions/tree/main/extensions/btw)。
