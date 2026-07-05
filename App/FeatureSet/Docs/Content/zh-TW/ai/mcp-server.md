# MCP Server

OneUptime Model Context Protocol (MCP) Server 讓 LLM 能直接存取您的 OneUptime 執行個體，實現由 AI 驅動的監控、事件管理與可觀測性操作。

## 什麼是 OneUptime MCP Server？

OneUptime MCP Server 是大型語言模型（LLM）與您的 OneUptime 執行個體之間的橋樑。它實作了 Model Context Protocol (MCP)，讓像 Claude 這樣的 AI 助理能直接與您的監控基礎架構互動。

## 運作方式

MCP server 與您的 OneUptime 執行個體一同託管，並透過 Streamable HTTP 傳輸方式存取。無需在本機安裝任何東西。

**雲端使用者**：`https://oneuptime.com/mcp`
**自我託管使用者**：`https://your-oneuptime-domain.com/mcp`

## 主要功能

- **約 155 個工具**：涵蓋 22 種資源類型（incident、警示、monitor、狀態頁面、待命等）的完整 CRUD 工具、唯讀的遙測工具，以及工作流程與輔助工具
- **即時操作**：即時建立、讀取、更新與刪除資源
- **型別安全的介面**：完整型別化，並具備全面的輸入驗證
- **安全的驗證機制**：以每個請求為單位的 API 金鑰驗證，並具備妥善的錯誤處理
- **安全性註記**：唯讀工具帶有 `readOnlyHint`，刪除工具帶有 `destructiveHint`，讓 MCP 用戶端能自動核准安全的呼叫，並在破壞性操作前先行詢問
- **輕鬆整合**：可與 Claude Desktop 及其他相容於 MCP 的用戶端搭配使用
- **無狀態設計**：沒有工作階段 ID——每個請求都是自足的，因此伺服器可在負載平衡器與多副本部署之後正常運作

## 您可以做什麼

透過 OneUptime MCP Server，AI 助理可以協助您：

- **Monitor 管理**：建立與設定 monitor、檢查其狀態，以及檢視狀態歷史記錄
- **事件回應**：建立、確認與解決 incident、新增內部或公開備註，以及追蹤解決進度
- **團隊操作**：管理團隊與待命政策
- **狀態頁面**：管理狀態頁面與建立公告
- **警示**：確認與解決警示、新增警示備註，以及管理警示狀態與嚴重性
- **排程維護**：建立與管理排程維護事件
- **遙測**：查詢日誌、指標、追蹤、例外與 monitor 日誌（唯讀）

## 需求

- OneUptime 執行個體（雲端或自我託管）
- 相容於 MCP 的用戶端（Claude Desktop、搭配 GitHub Copilot 的 VS Code 等）
- 有效的 OneUptime API 金鑰（僅需驗證的操作才需要——公開工具無需金鑰即可使用）

## 取得您的 API 金鑰

1. 登入您的 OneUptime 執行個體
2. 前往 **Settings** → **API Keys**
3. 點選 **Create API Key**
4. 提供一個名稱（例如「MCP Server」）
5. 為您的使用情境選擇適當的權限
6. 複製產生的 API 金鑰

API 金鑰以專案為範圍：MCP server 會從金鑰推斷出您的專案，因此建立類工具永遠不需要 `projectId` 引數。

> **警告——切勿將 master 金鑰交給 AI 代理程式。** OneUptime 的 *master* API 金鑰同樣會被此標頭接受，並授予整個執行個體的管理員存取權。請務必使用具備代理程式所需最低權限的專案 API 金鑰（唯讀金鑰即足以使用所有 `get_`／`list_`／`count_` 工具）。

## 設定

### Claude Desktop 設定

找到您的 Claude Desktop 設定檔：

**macOS**：`~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**：`%APPDATA%\Claude\claude_desktop_config.json`
**Linux**：`~/.config/Claude/claude_desktop_config.json`

### 適用於 OneUptime Cloud

加入以下設定：

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 適用於自我託管的 OneUptime

將 `oneuptime.com` 替換為您的 OneUptime 網域：

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### 公開存取（無 API 金鑰）

若只想使用公開工具（狀態頁面資訊、說明），您可以在沒有 API 金鑰的情況下連線：

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

此設定可讓您在不需驗證的情況下，存取公開的狀態頁面工具與說明資源。

### 搭配 GitHub Copilot 的 VS Code

VS Code 原生支援搭配 GitHub Copilot（版本 1.99 以上）使用 MCP server。這可讓 Copilot 直接存取 OneUptime 資料。

#### 步驟 1：需求

- VS Code 版本 1.99 或更新版本
- 已安裝並啟用 GitHub Copilot 擴充功能
- 已啟用 GitHub Copilot Chat

#### 步驟 2：開啟 MCP 設定

1. 按下 `Ctrl+Shift+P`（Windows/Linux）或 `Cmd+Shift+P`（macOS）
2. 輸入「MCP: Open User Configuration」並按下 Enter
3. 這會開啟或建立 `mcp.json` 設定檔

或者，在您的工作區中建立 `.vscode/mcp.json` 以進行專案專屬的設定。

#### 適用於 OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### 適用於自我託管的 OneUptime

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### 步驟 3：啟動 MCP Server

1. 按下 `Ctrl+Shift+P` / `Cmd+Shift+P`
2. 輸入「MCP: List Servers」以檢視可用的伺服器
3. 點選「oneuptime」以啟動伺服器
4. 出現提示時，輸入您的 OneUptime API 金鑰

#### 步驟 4：搭配 Copilot Chat 使用

開啟 GitHub Copilot Chat 並使用 Agent 模式（`@workspace` 或直接詢問）：

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### 安全性注意事項

上述設定使用了帶有 `"password": true` 的輸入變數，以安全地提示您輸入 API 金鑰，而非以純文字形式儲存。當您首次啟動 MCP server 時，VS Code 會提示您確認信任。

## 可用端點

| 端點          | 方法   | 說明                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | 用於工具呼叫及其他操作的 JSON-RPC 請求                                                                            |
| `/mcp`        | GET    | 未帶 SSE `Accept` 標頭時：回傳友善的 JSON 探索資訊。帶有該標頭時：回傳 `405`——無狀態伺服器不提供獨立的 SSE 串流（符合規範的用戶端可在沒有它的情況下繼續運作） |
| `/mcp`        | DELETE | 不執行任何動作（伺服器為無狀態設計，因此沒有可終止的工作階段）                                                             |
| `/mcp/health` | GET    | 健康狀態檢查端點                                                                                                            |
| `/mcp/tools`  | GET    | 用於列出可用工具的 REST API                                                                                                 |

## 驗證

MCP server 支援兩種運作模式：

### 公開工具（無需驗證）

您可以在沒有 API 金鑰的情況下連線至 MCP server，以存取公開工具：

- **`oneuptime_help`**：取得關於 OneUptime MCP 功能的說明與指引
- **`oneuptime_list_resources`**：列出可用的資源及其操作
- **`get_public_status_page_overview`**：取得某個公開狀態頁面的總覽
- **`get_public_status_page_incidents`**：取得某個公開狀態頁面的 incident
- **`get_public_status_page_scheduled_maintenance`**：取得排程維護事件
- **`get_public_status_page_announcements`**：取得某個公開狀態頁面的公告

公開狀態頁面工具可接受狀態頁面 ID（UUID）或狀態頁面網域名稱。

### 需驗證的工具（需要 API 金鑰）

對於所有其他操作（管理 monitor、incident、team 等），需透過以下其中一個標頭進行驗證：

- `x-api-key`：您的 OneUptime API 金鑰
- `Authorization`：帶有您 API 金鑰的 Bearer token（例如 `Bearer your-api-key-here`）

`Bearer` 配置不區分大小寫。工具錯誤會以帶內工具結果的形式回傳（`isError: true`），並附上 `statusCode`、詳細資訊與建議——而非以 MCP 協定錯誤回傳——因此代理程式可以讀取失敗內容並自行修正。

## 工作流程工具

除了各資源的 CRUD 工具外，伺服器還提供專為事件與警示回應打造的工作流程工具：

- **`acknowledge_incident`**／**`resolve_incident`**：將 incident 移至專案的「已確認」或「已解決」狀態——等同於在儀表板中按下按鈕
- **`acknowledge_alert`**／**`resolve_alert`**：對警示執行相同操作
- **`add_incident_note`**：為 incident 新增備註，可使用 `visibility: "internal"`（僅限團隊，為預設值）或 `visibility: "public"`（發布至狀態頁面）。支援 Markdown
- **`add_alert_note`**：為警示新增內部備註

典型流程：`list_incidents` → `acknowledge_incident` → 使用 `list_logs` 進行調查 → `add_incident_note`（公開）→ `resolve_incident`。

## 我是誰

**`oneuptime_whoami`** 工具會回傳您的 API 金鑰所屬的專案（ID 與名稱）。這是代理程式用來確認自身環境的實用首次呼叫——而且由於建立類工具會從 API 金鑰推斷 `projectId`，代理程式永遠不需要傳入專案 ID。

## 查詢遙測資料

日誌、指標、追蹤（span）、例外與 monitor 日誌以唯讀的 `list_` 與 `count_` 工具形式提供（`list_logs`、`list_metrics`、`list_spans`、`list_exception_instances`、`list_monitor_logs`，以及對應的 `count_` 工具）。遙測資料透過 OpenTelemetry 擷取，因此沒有建立類工具。

查詢遙測資料時請務必加上時間範圍篩選條件。查詢欄位可接受直接值或運算子物件：

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

支援的運算子：`EqualTo`、`NotEqual`、`IsNull`、`NotNull`、`EqualToOrNull`、`GreaterThan`、`LessThan`、`GreaterThanOrEqual`、`LessThanOrEqual`、`InBetween`、`Search`、`Includes`。排序值為 `"ASC"` 或 `"DESC"`。

## 欄位選取與分頁

`get_` 與 `list_` 工具可接受選用的 `select` 欄位名稱陣列。預設會回傳所有可讀取的欄位，但不包含較重的欄位（JSON、超長文字與 HTML 欄位），這些欄位必須在 `select` 中明確指定。

列表工具以 `limit`（預設 10，最大 100）與 `skip` 進行分頁，且每個列表回應都會確切回報其回傳的內容：

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## 驗證確認

確認 MCP server 正在執行：

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

列出可用工具：

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## 使用範例

### 基本資訊查詢

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitor 管理

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### 事件管理

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### 團隊與待命

```
"List the teams in this project"
"Show me our on-call policies"
```

### 狀態頁面管理

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### 公開狀態頁面查詢（無需 API 金鑰）

這些查詢無需驗證即可運作，僅使用公開的狀態頁面工具：

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### 進階操作

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API 金鑰權限

### 唯讀存取

若僅供檢視資料，請為您的 API 金鑰加入讀取權限。

### 完整存取

若要完整存取以建立、更新與刪除資源，請確保您的 API 金鑰具備 Project Admin 權限。

### 最佳實務

- 使用特定權限：僅授予所需的最低權限
- 輪替 API 金鑰：定期輪替您的 API 金鑰
- 監控使用情況：在 OneUptime 中持續追蹤 API 金鑰的使用情況
- 區分金鑰：為不同的環境使用不同的 API 金鑰

## 疑難排解

### 權限錯誤

請確保您的 API 金鑰具備必要的權限：

- 列出資源所需的讀取存取權
- 建立／更新資源所需的寫入存取權
- 若想移除資源，則需刪除存取權

### 連線問題

1. 確認您的 OneUptime URL 是否正確
2. 檢查您的 API 金鑰是否有效
3. 確保您的 OneUptime 執行個體可供存取
4. 測試健康狀態檢查端點

### 無效的 API 金鑰

- 在您的 OneUptime 設定中確認 API 金鑰
- 檢查是否有多餘的空格或字元
- 確保金鑰尚未過期

### 工作階段錯誤

若您收到與工作階段相關的錯誤：

- MCP server 為無狀態設計——它不會發放或追蹤工作階段 ID，因此每個請求都能在任何伺服器副本上運作
- 若用戶端仍送出來自先前伺服器版本的 `mcp-session-id` 標頭，直接省略即可；該標頭會被忽略
- 請更新那些預期伺服器會回傳工作階段 ID 的舊版 MCP 用戶端設定

## 可用資源

MCP server 為以下資源提供工具：

**監控**：Monitor、Monitor Status、Monitor Status Event
**事件**：Incident、Incident State、Incident Severity、Incident State Timeline、Incident Public Note、Incident Internal Note
**警示**：Alert、Alert State、Alert Severity、Alert State Timeline、Alert Internal Note
**狀態頁面**：Status Page、Status Page Announcement
**排程維護**：Scheduled Maintenance Event、Scheduled Maintenance State、Scheduled Maintenance State Timeline
**團隊與待命**：Team、On-Call Policy
**標籤**：Label
**遙測（唯讀）**：Log、Metric、Span、Exception Instance、Monitor Log

每種資料庫資源都支援以 snake_case 工具進行 Create、Get、List、Update、Delete 與 Count——例如 `create_incident`、`get_incident`、`list_incidents`、`update_incident`、`delete_incident`、`count_incidents`。遙測資源僅提供 `list_` 與 `count_` 工具（例如 `list_logs`、`count_spans`）。
