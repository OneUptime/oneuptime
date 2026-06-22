# 輸出格式

OneUptime CLI 支援三種輸出格式：**table**、**JSON** 與 **wide**。您可以在任何指令上使用 `-o` 或 `--output` 旗標來設定格式。

## Table（預設）

在互動式終端機中執行時的預設格式。會以 ASCII 表格的形式顯示結果，並智慧地選取欄位。

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

Table 格式的行為：

- 最多選取 6 個欄位，並優先採用：`_id`、`name`、`title`、`createdAt`、`updatedAt`
- 將超過 60 個字元的值以 `...` 截斷
- 使用以顏色標示的標頭（可透過 `--no-color` 停用）

## JSON

原始 JSON 輸出，以 2 個空格縮排美化排版。這是用於指令稿撰寫以及導向其他工具時的最佳格式。

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

當輸出透過管線導向另一個指令時（非 TTY 模式），會自動使用 JSON 格式：

```bash
# JSON is used automatically when piping
oneuptime incident list | jq '.[].title'
```

## Wide

顯示所有欄位且不截斷。適合用於詳細檢視，但可能產生非常寬的輸出。

```bash
oneuptime incident list -o wide
```

## 停用顏色

可透過下列幾種方式停用顏色輸出：

```bash
# Using the --no-color flag
oneuptime --no-color incident list

# Using the NO_COLOR environment variable
NO_COLOR=1 oneuptime incident list
```

## 特殊輸出情況

| 情境                   | 輸出                  |
| ---------------------- | --------------------- |
| 結果集為空             | `"No results found."` |
| 未傳回任何資料         | `"No data returned."` |
| 單一物件（例如 `get`） | 鍵值表格格式          |
| `count` 指令           | 純數值                |
