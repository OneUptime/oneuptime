# 命令參考

OneUptime CLI 所有命令的完整參考。

## 認證命令

### `oneuptime login`

向 OneUptime 實例進行認證。

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| 參數 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `<api-key>` | 參數 | 是 | 用於認證的 API 密鑰 |
| `<instance-url>` | 參數 | 是 | OneUptime 實例 URL |
| `--context-name` | 選項 | 否 | 上下文名稱（默認：`"default"`） |

---

### `oneuptime context list`

列出所有已保存的上下文。

```bash
oneuptime context list
```

---

### `oneuptime context use`

切換到命名上下文。

```bash
oneuptime context use <name>
```

| 參數 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `<name>` | 參數 | 是 | 要激活的上下文名稱 |

---

### `oneuptime context current`

顯示帶有掩碼 API 密鑰的活動上下文。

```bash
oneuptime context current
```

---

### `oneuptime context delete`

刪除已保存的上下文。

```bash
oneuptime context delete <name>
```

| 參數 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `<name>` | 參數 | 是 | 要刪除的上下文名稱 |

---

## 資源命令

所有資源命令遵循相同的模式。將 `<resource>` 替換爲任何支持的資源名稱（例如 `incident`、`monitor`、`alert`、`status-page`）。

### `oneuptime <resource> list`

列出資源，支持過濾和分頁。

```bash
oneuptime <resource> list [options]
```

| 選項 | 類型 | 默認值 | 描述 |
|------|------|--------|------|
| `--query <json>` | 字符串 | 無 | JSON 格式的過濾條件 |
| `--limit <n>` | 數字 | `10` | 最大結果數 |
| `--skip <n>` | 數字 | `0` | 跳過的結果數 |
| `--sort <json>` | 字符串 | 無 | JSON 格式的排序順序 |
| `-o, --output` | 字符串 | `table` | 輸出格式 |

---

### `oneuptime <resource> get`

通過 ID 獲取單個資源。

```bash
oneuptime <resource> get <id> [-o <format>]
```

| 參數 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `<id>` | 參數 | 是 | 資源 ID（UUID） |
| `-o, --output` | 選項 | 否 | 輸出格式 |

---

### `oneuptime <resource> create`

創建新資源。

```bash
oneuptime <resource> create [--data <json> | --file <path>] [-o <format>]
```

| 選項 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `--data <json>` | 字符串 | `--data` 或 `--file` 二選一 | JSON 格式的資源數據 |
| `--file <path>` | 字符串 | `--data` 或 `--file` 二選一 | JSON 文件的路徑 |
| `-o, --output` | 字符串 | 否 | 輸出格式 |

---

### `oneuptime <resource> update`

更新現有資源。

```bash
oneuptime <resource> update <id> --data <json> [-o <format>]
```

| 參數 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `<id>` | 參數 | 是 | 資源 ID |
| `--data <json>` | 選項 | 是 | JSON 格式的待更新字段 |
| `-o, --output` | 選項 | 否 | 輸出格式 |

---

### `oneuptime <resource> delete`

刪除資源。

```bash
oneuptime <resource> delete <id> [--force]
```

| 參數 | 類型 | 是否必填 | 描述 |
|------|------|---------|------|
| `<id>` | 參數 | 是 | 資源 ID |
| `--force` | 選項 | 否 | 跳過確認提示 |

---

### `oneuptime <resource> count`

統計符合過濾條件的資源數量。

```bash
oneuptime <resource> count [--query <json>]
```

| 選項 | 類型 | 默認值 | 描述 |
|------|------|--------|------|
| `--query <json>` | 字符串 | 無 | JSON 格式的過濾條件 |

---

## 實用命令

### `oneuptime version`

顯示 CLI 版本。

```bash
oneuptime version
```

---

### `oneuptime whoami`

顯示當前認證詳情。

```bash
oneuptime whoami
```

顯示實例 URL 和掩碼後的 API 密鑰。如果活動的已保存上下文處於活動狀態，還會顯示上下文名稱。

---

### `oneuptime resources`

列出所有可用的資源類型。

```bash
oneuptime resources [--type <type>]
```

| 選項 | 類型 | 默認值 | 描述 |
|------|------|--------|------|
| `--type <type>` | 字符串 | 無 | 按 `database` 或 `analytics` 過濾 |

---

## 全局選項

這些標誌可用於所有命令：

| 選項 | 描述 |
|------|------|
| `--api-key <key>` | 覆蓋 API 密鑰 |
| `--url <url>` | 覆蓋實例 URL |
| `--context <name>` | 使用特定上下文 |
| `-o, --output <format>` | 輸出格式：`json`、`table`、`wide` |
| `--no-color` | 禁用彩色輸出 |
| `--help` | 顯示幫助 |
| `--version` | 顯示版本 |

## API 路由

以下是 CLI 命令與 API 端點的映射關係，供參考：

| 命令 | 方法 | 端點 |
|------|------|------|
| `list` | POST | `/api/<resource>/get-list` |
| `get` | POST | `/api/<resource>/<id>/get-item` |
| `create` | POST | `/api/<resource>` |
| `update` | PUT | `/api/<resource>/<id>/` |
| `delete` | DELETE | `/api/<resource>/<id>/` |
| `count` | POST | `/api/<resource>/count` |

所有請求都包含用於認證的 `APIKey` 請求頭。
