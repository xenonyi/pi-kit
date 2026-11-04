# pi-mcp

从 `servers.json` 注册 MCP 服务器。缺少环境变量的服务器整条跳过，密钥只以 `${VAR}` 模板留在配置里。

## 使用

扩展加载时读取 `extensions/pi-mcp/servers.json`，把 `mcpServers` 下的每个条目注册给 pi。名称把 `-` 归一成 `_` 后比较，当前会话已注册过的服务器不会重复注册。条目字段与密钥写法见下一节。

## 配置

条目直接透传 pi 的 MCP 配置，另加 `requiredEnv`、`headers`、`exposure`、`description` 四个扩展字段：

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "exposure": "codemode",
      "description": "库文档检索：API 用法、配置和排错",
      "headers": { "Authorization": "Bearer ${CONTEXT7_API_KEY}" }
    }
  }
}
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `url`、`command` 等 | 无 | 透传给 pi 的 MCP 配置，由 pi 在注册时校验 |
| `requiredEnv` | `[]` | 环境变量名数组。任一变量缺失或只有空白，整条跳过 |
| `headers` | 无 | 头名到字符串的映射。值为 `${VAR}` 模板，引用的变量缺失时丢弃该头 |
| `exposure` | 无 | 例如 `codemode`：只把该服务器的工具暴露给 codemode |
| `description` | 无 | 服务器用途说明 |

默认提供三条配置：

| 名称 | 依赖 |
| --- | --- |
| `exa` | 需要 `EXA_API_KEY` |
| `context7` | 需要 `CONTEXT7_API_KEY` |
| `deepwiki` | 无 |
