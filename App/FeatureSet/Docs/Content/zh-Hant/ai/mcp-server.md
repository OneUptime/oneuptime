# MCP 服務器

OneUptime 模型上下文協議（MCP）服務器爲 LLM 提供對您 OneUptime 實例的直接訪問，從而實現 AI 驅動的監控、事件管理和可觀測性操作。

## 什麼是 OneUptime MCP 服務器？

OneUptime MCP 服務器是大型語言模型（LLM）與您的 OneUptime 實例之間的橋樑。它實現了模型上下文協議（MCP），使 Claude 等 AI 助手能夠直接與您的監控基礎設施進行交互。

## 工作原理

MCP 服務器與您的 OneUptime 實例一起託管，可通過 Streamable HTTP 傳輸協議訪問。無需本地安裝。

**雲端用戶**：`https://oneuptime.com/mcp`
**自託管用戶**：`https://your-oneuptime-domain.com/mcp`

## 主要功能

- **完整 API 覆蓋**：訪問 711 個 OneUptime API 端點
- **126 種資源類型**：管理所有 OneUptime 資源，包括監控器、事件、團隊、探針等
- **實時操作**：實時創建、讀取、更新和刪除資源
- **類型安全接口**：完整類型定義，具有全面的輸入驗證
- **安全認證**：基於 API 密鑰的認證，具有適當的錯誤處理
- **易於集成**：適用於 Claude Desktop 和其他兼容 MCP 的客戶端
- **會話管理**：內置會話處理，支持自動重連

## 您可以做什麼

藉助 OneUptime MCP 服務器，AI 助手可以幫助您：

- **監控器管理**：創建和配置監控器，檢查其狀態，管理監控器組
- **事件響應**：創建事件、添加備註、分配團隊成員、跟蹤解決進度
- **團隊操作**：管理團隊、權限和值班排班
- **狀態頁面**：更新狀態頁面、創建公告、管理訂閱者
- **警報**：配置警報規則、管理升級策略、檢查通知日誌
- **探針**：在不同地點部署和管理監控探針
- **報告和分析**：生成報告並分析監控數據

## 要求

- OneUptime 實例（雲端或自託管）
- 兼容 MCP 的客戶端（Claude Desktop、VS Code with GitHub Copilot 等）
- 有效的 OneUptime API 密鑰（僅認證操作需要 - 公共工具無需認證）

## 獲取您的 API 密鑰

1. 登錄您的 OneUptime 實例
2. 導航至 **設置** → **API 密鑰**
3. 點擊 **創建 API 密鑰**
4. 提供名稱（例如"MCP Server"）
5. 選擇適合您使用場景的權限
6. 複製生成的 API 密鑰

## 配置

### Claude Desktop 配置

找到您的 Claude Desktop 配置文件：

**macOS**：`~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**：`%APPDATA%\Claude\claude_desktop_config.json`
**Linux**：`~/.config/Claude/claude_desktop_config.json`

### 適用於 OneUptime 雲端

添加以下配置：

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

### 適用於自託管 OneUptime

將 `oneuptime.com` 替換爲您的 OneUptime 域名：

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

### 公共訪問（無需 API 密鑰）

要僅使用公共工具（狀態頁面信息、幫助），可以不使用 API 密鑰進行連接：

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

此配置允許訪問公共狀態頁面工具和幫助資源，無需認證。

### VS Code with GitHub Copilot

VS Code 原生支持 MCP 服務器與 GitHub Copilot（1.99+ 版本）配合使用。這允許 Copilot 直接訪問 OneUptime 數據。

#### 第一步：要求

- VS Code 1.99 或更高版本
- 已安裝並激活 GitHub Copilot 擴展
- 已啓用 GitHub Copilot Chat

#### 第二步：打開 MCP 配置

1. 按 `Ctrl+Shift+P`（Windows/Linux）或 `Cmd+Shift+P`（macOS）
2. 輸入"MCP: Open User Configuration"並按 Enter
3. 這將打開或創建 `mcp.json` 配置文件

或者，在您的工作區中創建 `.vscode/mcp.json` 以進行項目特定配置。

#### 適用於 OneUptime 雲端

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

#### 適用於自託管 OneUptime

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

#### 第三步：啓動 MCP 服務器

1. 按 `Ctrl+Shift+P` / `Cmd+Shift+P`
2. 輸入"MCP: List Servers"以查看可用服務器
3. 點擊"oneuptime"以啓動服務器
4. 在提示時輸入您的 OneUptime API 密鑰

#### 第四步：與 Copilot Chat 配合使用

打開 GitHub Copilot Chat 並使用 Agent 模式（`@workspace` 或直接提問）：

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### 安全說明

上述配置使用帶有 `"password": true` 的輸入變量，以安全地提示輸入您的 API 密鑰，而不是以明文形式儲存。VS Code 在首次啓動 MCP 服務器時會提示您確認信任。

## 可用端點

| 端點 | 方法 | 描述 |
|------|------|------|
| `/mcp` | GET | 用於服務器到客戶端通知的服務器發送事件流 |
| `/mcp` | POST | 用於工具調用和其他操作的 JSON-RPC 請求 |
| `/mcp` | DELETE | 會話清理和終止 |
| `/mcp/health` | GET | 健康檢查端點 |
| `/mcp/tools` | GET | 列出可用工具的 REST API |

## 認證

MCP 服務器支持兩種操作模式：

### 公共工具（無需認證）

您可以無需 API 密鑰連接到 MCP 服務器來訪問公共工具：

- **`oneuptime_help`**：獲取有關 OneUptime MCP 功能的幫助和指導
- **`oneuptime_list_resources`**：列出可用資源及其操作
- **`get_public_status_page_overview`**：獲取公共狀態頁面的概覽
- **`get_public_status_page_incidents`**：獲取公共狀態頁面的事件
- **`get_public_status_page_scheduled_maintenance`**：獲取計劃維護事件
- **`get_public_status_page_announcements`**：獲取公共狀態頁面的公告

公共狀態頁面工具接受狀態頁面 ID（UUID）或狀態頁面域名。

### 認證工具（需要 API 密鑰）

對於所有其他操作（管理監控器、事件、團隊等），需要通過以下請求頭之一進行認證：

- `x-api-key`：您的 OneUptime API 密鑰
- `Authorization`：攜帶您的 API 密鑰的 Bearer 令牌（例如 `Bearer your-api-key-here`）

## 驗證

驗證 MCP 服務器是否正在運行：

```bash
# 適用於 OneUptime 雲端
curl https://oneuptime.com/mcp/health

# 適用於自託管
curl https://your-oneuptime-domain.com/mcp/health
```

列出可用工具：

```bash
# 適用於 OneUptime 雲端
curl https://oneuptime.com/mcp/tools

# 適用於自託管
curl https://your-oneuptime-domain.com/mcp/tools
```

## 使用示例

### 基本信息查詢

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### 監控器管理

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

### 團隊和值班

```
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
```

### 狀態頁面管理

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### 公共狀態頁面查詢（無需 API 密鑰）

這些查詢無需認證，僅使用公共狀態頁面工具：

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### 高級操作

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API 密鑰權限

### 只讀訪問
對於僅查看數據，請爲您的 API 密鑰添加讀取權限。

### 完全訪問
對於創建、更新和刪除資源的完全訪問權限，請確保您的 API 密鑰具有項目管理員權限。

### 最佳實踐
- 使用特定權限：僅授予所需的最低權限
- 輪換 API 密鑰：定期輪換您的 API 密鑰
- 監控使用情況：在 OneUptime 中跟蹤 API 密鑰使用情況
- 分離密鑰：對不同環境使用不同的 API 密鑰

## 故障排查

### 權限錯誤
確保您的 API 密鑰具有必要的權限：
- 列出資源的讀取訪問權限
- 創建/更新資源的寫入訪問權限
- 如果您想刪除資源，需要刪除訪問權限

### 連接問題
1. 驗證您的 OneUptime URL 是否正確
2. 檢查您的 API 密鑰是否有效
3. 確保您的 OneUptime 實例可訪問
4. 測試健康端點

### API 密鑰無效
- 在您的 OneUptime 設置中驗證 API 密鑰
- 檢查是否有多餘的空格或字符
- 確保密鑰尚未過期

### 會話錯誤
如果您收到與會話相關的錯誤：
- MCP 服務器使用 `mcp-session-id` 請求頭來跟蹤會話
- 確保您的客戶端正確處理服務器返回的會話 ID
- 連接關閉時會話會自動清理

## 可用資源

MCP 服務器提供對 126 種資源類型的訪問，包括：

**監控**：Monitor、MonitorStatus、MonitorGroup、Probe
**事件**：Incident、IncidentState、IncidentNote、IncidentTemplate
**警報**：Alert、AlertState、AlertSeverity
**狀態頁面**：StatusPage、StatusPageAnnouncement、StatusPageSubscriber
**值班**：On-CallPolicy、EscalationRule、On-CallSchedule
**團隊**：Team、TeamMember、TeamPermission
**遙測**：TelemetryService、Log、Span、Metric
**工作流**：Workflow、WorkflowVariable、WorkflowLog

每種資源支持標準操作：列表、計數、獲取、創建、更新和刪除。
