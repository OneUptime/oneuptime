# 输出格式

OneUptime CLI 支持三种输出格式：**表格**、**JSON** 和**宽表**。您可以在任意命令上使用 `-o` 或 `--output` 标志设置格式。

## 表格（默认）

在交互式终端中运行时的默认格式。将结果显示为 ASCII 表格，并智能选择显示的列。

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬─────────────────────┬─────────────────────┐
│ _id              │ title                 │ createdAt           │ updatedAt           │
├──────────────────┼───────────────────────┼─────────────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ 2025-01-15T10:30:00 │ 2025-01-15T12:00:00 │
│ def-456          │ Database Slowdown     │ 2025-01-14T08:15:00 │ 2025-01-14T09:30:00 │
└──────────────────┴───────────────────────┴─────────────────────┴─────────────────────┘
```

表格格式行为：
- 最多选择 6 列，优先显示：`_id`、`name`、`title`、`createdAt`、`updatedAt`
- 超过 60 个字符的值将被截断并显示 `...`
- 使用带颜色的列标题（使用 `--no-color` 禁用）

## JSON

原始 JSON 输出，使用 2 个空格缩进进行格式化。这是脚本编写和管道传递给其他工具的最佳格式。

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "currentIncidentStateId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

当输出被管道传递给另一个命令时（非 TTY 模式），会自动使用 JSON 格式：

```bash
# 在管道传递时自动使用 JSON
oneuptime incident list | jq '.[].title'
```

## 宽表

显示所有列且不截断。适合详细检查，但可能产生很宽的输出。

```bash
oneuptime incident list -o wide
```

## 禁用颜色

可以通过多种方式禁用颜色输出：

```bash
# 使用 --no-color 标志
oneuptime --no-color incident list

# 使用 NO_COLOR 环境变量
NO_COLOR=1 oneuptime incident list
```

## 特殊输出情况

| 场景 | 输出 |
|------|------|
| 空结果集 | `"No results found."` |
| 未返回数据 | `"No data returned."` |
| 单个对象（例如 `get`） | 键值表格格式 |
| `count` 命令 | 纯数字值 |
