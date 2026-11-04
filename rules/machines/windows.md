---
id: machines/windows
title: Windows 本机约定
when:
  os: [windows]
  tools: [powershell]
---

- 本机是 Windows，`bash` 未启用，`powershell` 已启用。
- 命令、管道和环境变量按 PowerShell 语义书写（`$env:NAME`、`Get-ChildItem`、`Select-String`）。
- 引用含空格或中文的路径时始终加引号。`\` 和 `/` 都可以，但同一命令内保持一致。
- 优先 `pwsh`（PowerShell 7），不使用只有 `cmd` 支持的语法。
- 写文件默认用 UTF-8，不带 BOM。比较文本时注意 CRLF。
