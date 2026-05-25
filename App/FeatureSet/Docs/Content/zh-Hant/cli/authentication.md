# 認證

OneUptime CLI 支持多種方式與您的 OneUptime 實例進行認證。您可以使用命名上下文、環境變量，或直接通過標誌傳遞憑據。

## 登錄

使用 API 密鑰向您的 OneUptime 實例進行認證：

```bash
oneuptime login <api-key> <instance-url>
```

**參數：**

| 參數 | 描述 |
|------|------|
| `<api-key>` | 您的 OneUptime API 密鑰（例如 `sk-your-api-key`） |
| `<instance-url>` | 您的 OneUptime 實例 URL（例如 `https://oneuptime.com`） |

**選項：**

| 選項 | 描述 |
|------|------|
| `--context-name <name>` | 此上下文的名稱（默認：`"default"`） |

**示例：**

```bash
# 使用默認上下文登錄
oneuptime login sk-abc123 https://oneuptime.com

# 使用命名上下文登錄
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# 設置多個環境
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## 上下文

上下文允許您保存和切換多個 OneUptime 環境（例如生產、預發佈、開發）。

### 列出上下文

```bash
oneuptime context list
```

顯示所有已配置的上下文。當前上下文用 `*` 標記。

### 切換上下文

```bash
oneuptime context use <name>
```

切換到不同的命名上下文，用於所有後續命令。

```bash
# 切換到預發佈
oneuptime context use staging

# 切換到生產
oneuptime context use production
```

### 查看當前上下文

```bash
oneuptime context current
```

顯示當前活動的上下文，包括實例 URL 和掩碼後的 API 密鑰。

### 刪除上下文

```bash
oneuptime context delete <name>
```

刪除命名上下文。如果刪除的是當前上下文，CLI 會自動切換到第一個剩餘的上下文。

## 憑據解析

憑據按以下優先級順序解析：

1. **CLI 標誌**（`--api-key` 和 `--url`）
2. **環境變量**（`ONEUPTIME_API_KEY` 和 `ONEUPTIME_URL`）
3. **命名上下文**（通過 `--context` 標誌）
4. **當前上下文**（來自保存的配置）

您可以混合使用不同來源——例如，使用環境變量提供 API 密鑰，使用保存的上下文提供 URL。

### 使用 CLI 標誌

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### 使用環境變量

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### 使用特定上下文

```bash
oneuptime --context production incident list
```

## 驗證認證

檢查您當前的認證狀態：

```bash
oneuptime whoami
```

此命令顯示：
- 實例 URL
- 掩碼後的 API 密鑰
- 當前上下文名稱（僅在活動的已保存上下文時顯示）

如果未認證，該命令會顯示一條有幫助的消息，建議您運行 `oneuptime login`。

## 配置文件

憑據儲存在 `~/.oneuptime/config.json` 中，具有受限權限（`0600`）。

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
