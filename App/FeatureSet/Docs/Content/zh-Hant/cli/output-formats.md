# 輸出格式

OneUptime CLI 支持三種輸出格式：**表格**、**JSON** 和**寬表**。您可以在任意命令上使用 `-o` 或 `--output` 標誌設置格式。

## 表格（默認）

在交互式終端中運行時的默認格式。將結果顯示爲 ASCII 表格，並智能選擇顯示的列。

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

表格格式行爲：
- 最多選擇 6 列，優先顯示：`_id`、`name`、`title`、`createdAt`、`updatedAt`
- 超過 60 個字符的值將被截斷並顯示 `...`
- 使用帶顏色的列標題（使用 `--no-color` 禁用）

## JSON

原始 JSON 輸出，使用 2 個空格縮進進行格式化。這是腳本編寫和管道傳遞給其他工具的最佳格式。

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

當輸出被管道傳遞給另一個命令時（非 TTY 模式），會自動使用 JSON 格式：

```bash
# 在管道傳遞時自動使用 JSON
oneuptime incident list | jq '.[].title'
```

## 寬表

顯示所有列且不截斷。適合詳細檢查，但可能產生很寬的輸出。

```bash
oneuptime incident list -o wide
```

## 禁用顏色

可以通過多種方式禁用顏色輸出：

```bash
# 使用 --no-color 標誌
oneuptime --no-color incident list

# 使用 NO_COLOR 環境變量
NO_COLOR=1 oneuptime incident list
```

## 特殊輸出情況

| 場景 | 輸出 |
|------|------|
| 空結果集 | `"No results found."` |
| 未返回數據 | `"No data returned."` |
| 單個對象（例如 `get`） | 鍵值表格格式 |
| `count` 命令 | 純數字值 |
