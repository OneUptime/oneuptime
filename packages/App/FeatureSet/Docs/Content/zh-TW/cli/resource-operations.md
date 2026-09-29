# 資源操作

OneUptime CLI 為所有支援的資源提供完整的 CRUD（建立、讀取、更新、刪除）操作。資源會自動從您的 OneUptime 實例中探索取得。

## 可用資源

執行以下命令以查看所有可用的資源類型：

```bash
oneuptime resources
```

您可以依類型篩選：

```bash
# Show only database resources
oneuptime resources --type database

# Show only analytics resources
oneuptime resources --type analytics
```

常見資源包括：

| 資源                        | 命令                                    |
| --------------------------- | --------------------------------------- |
| Incident                    | `oneuptime incident`                    |
| Alert                       | `oneuptime alert`                       |
| Monitor                     | `oneuptime monitor`                     |
| Monitor Status              | `oneuptime monitor-status`              |
| Incident State              | `oneuptime incident-state`              |
| Status Page                 | `oneuptime status-page`                 |
| On-Call Policy              | `oneuptime on-call-policy`              |
| Team                        | `oneuptime team`                        |
| Scheduled Maintenance Event | `oneuptime scheduled-maintenance-event` |

## 列出資源

擷取資源清單，並可選擇性地進行篩選、分頁與排序。

```bash
oneuptime <resource> list [options]
```

**選項：**

| 選項                    | 說明                   | 預設值  |
| ----------------------- | ---------------------- | ------- |
| `--query <json>`        | 以 JSON 表示的篩選條件 | None    |
| `--limit <n>`           | 結果的最大數量         | `10`    |
| `--skip <n>`            | 要略過的結果數量       | `0`     |
| `--sort <json>`         | 以 JSON 表示的排序順序 | None    |
| `-o, --output <format>` | 輸出格式               | `table` |

**範例：**

```bash
# List the 10 most recent incidents
oneuptime incident list

# Filter incidents by state ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# List with pagination
oneuptime incident list --limit 20 --skip 40

# Sort by creation date (descending)
oneuptime incident list --sort '{"createdAt":-1}'

# Output as JSON
oneuptime incident list -o json
```

## 取得資源

依資源 ID 擷取單一資源。

```bash
oneuptime <resource> get <id>
```

**引數：**

| 引數   | 說明            |
| ------ | --------------- |
| `<id>` | 資源 ID（UUID） |

**範例：**

```bash
# Get a specific incident
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Get a monitor as JSON
oneuptime monitor get abc-123 -o json
```

## 建立資源

從內嵌 JSON 或檔案建立新資源。

```bash
oneuptime <resource> create [options]
```

**選項：**

| 選項                    | 說明                         |
| ----------------------- | ---------------------------- |
| `--data <json>`         | 以 JSON 物件表示的資源資料   |
| `--file <path>`         | 包含資源資料的 JSON 檔案路徑 |
| `-o, --output <format>` | 輸出格式                     |

您必須提供 `--data` 或 `--file` 其中之一。

**範例：**

```bash
# Create an incident with inline JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Create from a JSON file
oneuptime incident create --file incident.json

# Create and output as JSON to capture the ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## 更新資源

依 ID 更新現有資源。

```bash
oneuptime <resource> update <id> [options]
```

**引數：**

| 引數   | 說明    |
| ------ | ------- |
| `<id>` | 資源 ID |

**選項：**

| 選項                    | 說明                             |
| ----------------------- | -------------------------------- |
| `--data <json>`         | 以 JSON 表示要更新的欄位（必填） |
| `-o, --output <format>` | 輸出格式                         |

**範例：**

```bash
# Change incident state (e.g., to resolved)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Rename a monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## 刪除資源

依 ID 刪除資源。

```bash
oneuptime <resource> delete <id> [--force]
```

**引數：**

| 引數   | 說明    |
| ------ | ------- |
| `<id>` | 資源 ID |

**選項：**

| 選項      | 說明         |
| --------- | ------------ |
| `--force` | 略過確認提示 |

**範例：**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Skip confirmation
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## 計算資源數量

計算符合選用篩選條件的資源數量。

```bash
oneuptime <resource> count [options]
```

**選項：**

| 選項             | 說明                   |
| ---------------- | ---------------------- |
| `--query <json>` | 以 JSON 表示的篩選條件 |

**範例：**

```bash
# Count all incidents
oneuptime incident count

# Count incidents by state
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Count monitors
oneuptime monitor count
```

## 分析資源

相較於資料庫資源，分析資源支援的操作較為有限：

| 操作     | 是否支援 |
| -------- | -------- |
| `list`   | 是       |
| `create` | 是       |
| `count`  | 是       |
| `get`    | 否       |
| `update` | 否       |
| `delete` | 否       |

使用 `oneuptime resources --type analytics` 可查看您的實例上有哪些分析資源可供使用。
