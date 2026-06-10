# 驗證

OneUptime CLI 支援多種方式來與您的 OneUptime 執行個體進行驗證。您可以使用具名情境（context）、環境變數，或直接以旗標傳遞憑證。

## 登入

使用 API 金鑰來與您的 OneUptime 執行個體進行驗證：

```bash
oneuptime login <api-key> <instance-url>
```

**引數：**

| 引數 | 說明 |
|----------|-------------|
| `<api-key>` | 您的 OneUptime API 金鑰（例如 `sk-your-api-key`） |
| `<instance-url>` | 您的 OneUptime 執行個體 URL（例如 `https://oneuptime.com`） |

**選項：**

| 選項 | 說明 |
|--------|-------------|
| `--context-name <name>` | 此情境的名稱（預設值：`"default"`） |

**範例：**

```bash
# Login with default context
oneuptime login sk-abc123 https://oneuptime.com

# Login with a named context
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Set up multiple environments
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## 情境

情境讓您可以儲存並在多個 OneUptime 環境之間切換（例如 production、staging、development）。

### 列出情境

```bash
oneuptime context list
```

顯示所有已設定的情境。目前的情境會以 `*` 標示。

### 切換情境

```bash
oneuptime context use <name>
```

切換到不同的具名情境，以套用至所有後續的命令。

```bash
# Switch to staging
oneuptime context use staging

# Switch to production
oneuptime context use production
```

### 檢視目前情境

```bash
oneuptime context current
```

顯示目前作用中的情境，包括執行個體 URL 以及已遮罩的 API 金鑰。

### 刪除情境

```bash
oneuptime context delete <name>
```

移除具名情境。如果被刪除的情境正是目前的情境，CLI 會自動切換到第一個剩餘的情境。

## 憑證解析

憑證會依照下列優先順序解析：

1. **CLI 旗標**（`--api-key` 與 `--url`）
2. **環境變數**（`ONEUPTIME_API_KEY` 與 `ONEUPTIME_URL`）
3. **具名情境**（透過 `--context` 旗標）
4. **目前情境**（來自已儲存的設定）

您可以混用來源——例如，使用環境變數提供 API 金鑰，並使用已儲存的情境提供 URL。

### 使用 CLI 旗標

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### 使用環境變數

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### 使用特定情境

```bash
oneuptime --context production incident list
```

## 驗證身分

檢查您目前的驗證狀態：

```bash
oneuptime whoami
```

這會顯示：
- 執行個體 URL
- 已遮罩的 API 金鑰
- 目前情境名稱（僅在已儲存的情境作用中時顯示）

如果尚未驗證，命令會顯示一則有用的訊息，建議您執行 `oneuptime login`。

## 設定檔

憑證會儲存在 `~/.oneuptime/config.json`，並具有受限的權限（`0600`）。

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
