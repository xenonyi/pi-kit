# pi-mcp

从 `servers.json` 注册 MCP 服务器：缺环境变量的服务器整条跳过，密钥只以 `${VAR}` 模板留在配置里。

## 使用

扩展加载时读取 `extensions/pi-mcp/servers.json`，把 `mcpServers` 下的每个条目注册给 pi（`registerMcpServer`）；当前会话已注册过的服务器（名称把 `-` 归一成 `_` 后比较）不会重复注册。

| 条目字段 | 说明 |
| --- | --- |
| `url` / `command` 等 | 透传给 pi 的 MCP 配置，由 pi 在注册时校验 |
| `requiredEnv` | 环境变量名数组；任一变量为空则整条跳过 |
| `headers` | 头名 → 字符串；值为 `${VAR}` 模板，引用的变量缺失则该头被丢弃 |
| `exposure` | 例如 `codemode`：只把该服务器的工具暴露给 codemode |
| `description` | 服务器用途说明 |

默认目录三条：

| 名称 | 依赖 |
| --- | --- |
| `exa` | 需要 `EXA_API_KEY` |
| `context7` | 需要 `CONTEXT7_API_KEY` |
| `deepwiki` | 无 |

## 行为

- `headers` 里的 `${VAR}` 在配置中保持模板，由 pi 在连接时展开；扩展不把密钥复制进注册项
- 目录结构不合法直接抛错：`mcpServers` 必须是对象、每个条目必须是对象、`requiredEnv` 必须是合法变量名数组、`headers` 必须是字符串映射
- 注册发生在扩展加载时，改完目录需要 `/reload` 或重开会话
