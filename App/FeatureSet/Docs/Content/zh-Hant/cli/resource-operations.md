# 資源操作

OneUptime CLI 爲所有支持的資源提供完整的 CRUD（創建、讀取、更新、刪除）操作。資源從您的 OneUptime 實例自動發現。

## 可用資源

運行以下命令查看所有可用的資源類型：

```bash
oneuptime resources
```

您可以按類型過濾：

```bash
# 僅顯示數據庫資源
oneuptime resources --type database

# 僅顯示分析資源
oneuptime resources --type analytics
```

常用資源包括：

| 資源 | 命令 |
|------|------|
| 事件 | `oneuptime incident` |
| 警報 | `oneuptime alert` |
| 監控器 | `oneuptime monitor` |
| 監控器狀態 | `oneuptime monitor-status` |
| 事件狀態 | `oneuptime incident-state` |
| 狀態頁面 | `oneuptime status-page` |
| 值班策略 | `oneuptime on-call-policy` |
| 團隊 | `oneuptime team` |
| 計劃維護事件 | `oneuptime scheduled-maintenance-event` |

## 列出資源

獲取資源列表，支持可選的過濾、分頁和排序。

```bash
oneuptime <resource> list [options]
```

**選項：**

| 選項 | 描述 | 默認值 |
|------|------|--------|
| `--query <json>` | JSON 格式的過濾條件 | 無 |
| `--limit <n>` | 最大結果數 | `10` |
| `--skip <n>` | 跳過的結果數 | `0` |
| `--sort <json>` | JSON 格式的排序順序 | 無 |
| `-o, --output <format>` | 輸出格式 | `table` |

**示例：**

```bash
# 列出最近 10 個事件
oneuptime incident list

# 按狀態 ID 過濾事件
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# 帶分頁的列表
oneuptime incident list --limit 20 --skip 40

# 按創建日期降序排序
oneuptime incident list --sort '{"createdAt":-1}'

# 以 JSON 格式輸出
oneuptime incident list -o json
```

## 獲取資源

通過 ID 獲取單個資源。

```bash
oneuptime <resource> get <id>
```

**參數：**

| 參數 | 描述 |
|------|------|
| `<id>` | 資源 ID（UUID） |

**示例：**

```bash
# 獲取特定事件
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# 以 JSON 格式獲取監控器
oneuptime monitor get abc-123 -o json
```

## 創建資源

從內聯 JSON 或文件創建新資源。

```bash
oneuptime <resource> create [options]
```

**選項：**

| 選項 | 描述 |
|------|------|
| `--data <json>` | JSON 對象格式的資源數據 |
| `--file <path>` | 包含資源數據的 JSON 文件路徑 |
| `-o, --output <format>` | 輸出格式 |

必須提供 `--data` 或 `--file` 之一。

**示例：**

```bash
# 使用內聯 JSON 創建事件
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# 從 JSON 文件創建
oneuptime incident create --file incident.json

# 創建並以 JSON 格式輸出以捕獲 ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## 更新資源

通過 ID 更新現有資源。

```bash
oneuptime <resource> update <id> [options]
```

**參數：**

| 參數 | 描述 |
|------|------|
| `<id>` | 資源 ID |

**選項：**

| 選項 | 描述 |
|------|------|
| `--data <json>` | JSON 格式的待更新字段（必填） |
| `-o, --output <format>` | 輸出格式 |

**示例：**

```bash
# 更改事件狀態（例如更改爲已解決）
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# 重命名監控器
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## 刪除資源

通過 ID 刪除資源。

```bash
oneuptime <resource> delete <id> [--force]
```

**參數：**

| 參數 | 描述 |
|------|------|
| `<id>` | 資源 ID |

**選項：**

| 選項 | 描述 |
|------|------|
| `--force` | 跳過確認提示 |

**示例：**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# 跳過確認
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## 統計資源數量

統計符合可選過濾條件的資源數量。

```bash
oneuptime <resource> count [options]
```

**選項：**

| 選項 | 描述 |
|------|------|
| `--query <json>` | JSON 格式的過濾條件 |

**示例：**

```bash
# 統計所有事件
oneuptime incident count

# 按狀態統計事件
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# 統計監控器數量
oneuptime monitor count
```

## 分析資源

分析資源與數據庫資源相比，支持的操作較爲有限：

| 操作 | 是否支持 |
|------|---------|
| `list` | 是 |
| `create` | 是 |
| `count` | 是 |
| `get` | 否 |
| `update` | 否 |
| `delete` | 否 |

使用 `oneuptime resources --type analytics` 查看您的實例上可用的分析資源。
