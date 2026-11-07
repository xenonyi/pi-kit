# 结果处理

## 请求失败

先区分失败原因，再决定是否重试：

| 现象 | 处理 |
| --- | --- |
| 工具不可用、鉴权或权限失败 | 停止受影响的调用，报告缺失配置或权限。公开资料可继续使用其他已授权的来源 |
| 参数错误 | 重新读取工具声明，修正参数 |
| 网络超时、限流或服务端失败 | 检查客户端已做的重试及返回的恢复条件。已耗尽重试就换源或报告阻塞；原请求只在限流窗口结束等恢复条件改变后重试 |
| 搜索无结果 | 改用官方名称、原语言或其他来源，记录仍未覆盖的条件 |

## 正文与长结果

MCP 正文通常在 `content` 的文本块里；`structuredContent` 按当前工具声明读取。两者内容相同时选一份，保留来源字段。

在 `codemode` 内筛选后，只用 `text()` 输出待核验段落及其标题、URL、日期或版本。清理导航等无关文字，保留代码缩进与语言标记。

输出被截断时，沿工具提供的完整结果路径分段 `read` 或 `grep`。已获文件写入授权时，也可先把完整正文写入临时文件，再分段读取。远端正文被截断时，回到检索工具调整获取范围。

## 可选解析器

返回体符合 [parse.js](../scripts/parse.js) 约定的文本格式时，可用它整理结果。把 `<skill>` 替换为本 skill 目录的绝对路径，`result` 为原始 MCP 返回值：

```js
const P = eval(await tools.read({ path: "<skill>/scripts/parse.js", offset: null, limit: null }));
const body = P.body(result);
const parsed = P.safe(P.search, body);
text(parsed.ok
  ? parsed.items.map(({ title, url, published }) => ({ title, url, published }))
  : parsed);
```

exa 搜索用 `P.search`，网页抓取用 `P.pages`，context7 文档用 `P.docs`。

`P.body` 遇到 `isError` 或缺少文本会抛错；调用异常和正文提取异常需单独处理，`P.safe` 只包住传入的解析器。

`P.safe` 返回 `ok:false` 时，查看 `error` 与 `raw`，再回到原始响应。`raw` 只是开头片段，解析为空也可能是格式变化。

`ok:true` 只表示识别出条目。`P.docs` 只保留首个代码块，并截短说明；解析结果用于导航，核验仍以完整正文为准。
