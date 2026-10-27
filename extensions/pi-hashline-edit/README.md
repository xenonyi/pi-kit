# pi-hashline-edit

提供 `hash_read` 与 `hash_edit`：读取时给每行一个短哈希锚点，编辑时用文件级 sha256 revision 校验，替代容易漂移的整段文本替换。

## 使用

`hash_read`：

| 参数 | 说明 |
| --- | --- |
| `path` | 必填；相对会话 cwd 或绝对路径 |
| `offset` | 起始行（1 起，默认 1） |
| `limit` | 最多返回的完整行数（默认与上限 2000；50 KiB 字节上限可能更早截断） |

- 输出 `LINE#HHHH:content` 行与整文件 `sha256:` revision（部分读取也返回全量 revision），用 `nextOffset` 续读
- 超长行整行省略，不做部分锚定；只接受 ≤16 MiB、EOL 统一（LF 或 CRLF）的 UTF-8 文本；二进制与符号链接被拒绝；图片用 `read`

`hash_edit`：

| 参数 | 说明 |
| --- | --- |
| `path` | 必填；已存在的文件 |
| `revision` | 必填；当前完整 `sha256:…` |
| `edits` | 非空数组，每项为 `anchor` / `deleteCount` / `lines` |

- `anchor`：`LINE#HHHH`（如 `12#A83F`）或 `BOF` / `EOF`（只用于插入）
- `deleteCount`：从 anchor 起删除的原文件行数；`0` 表示在 anchor 前插入
- `lines`：逐行字面量，保留缩进，不含 CR/LF 与锚点前缀；`[]` 表示不插入

## 行为

- 整批原子校验：`edits` 可乱序，锚点与区间一律按原 revision 计算；任一项无效、冲突或重叠则整批不写
- 校验项：revision 必须是最新（`STALE_FILE`）、行号在范围内且行哈希匹配（`ANCHOR_MISMATCH`）、区间不重叠、起点不重复（含 `BOF` 与第 1 行）；不做模糊匹配
- 保留 BOM 与换行约定；返回最终 revision、`changed`、`firstChangedLine`、`editCount`、`deletedLines`、`insertedLines`，以及最早改动处附近最多 20 行
- 成功后旧 revision 与旧锚点立即失效：同一文件的下一次编辑要用新 revision
