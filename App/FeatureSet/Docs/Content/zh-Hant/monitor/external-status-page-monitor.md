# 外部狀態頁面監控器

外部狀態頁面監控允許您監控第三方狀態頁面，並在您所依賴的服務出現中斷或性能下降時收到警報。OneUptime 定期檢查外部狀態頁面（如 AWS、GCP、Azure、GitHub 等）並評估其狀態。

## 概述

外部狀態頁面監控器通過查詢公共狀態頁面來檢查您所依賴的服務的健康狀況。這使您能夠：

- 監控您的應用程序所依賴的第三方服務的可用性
- 當上遊提供商發生中斷時收到警報
- 跟蹤各個組件的狀態（例如"AWS EC2 us-east-1"）
- 在性能下降影響您的用戶之前檢測到它
- 將您自己的事件與上游提供商的問題關聯起來

## 支持的提供商

OneUptime 支持通過以下方式監控狀態頁面：

| 提供商類型 | 描述 |
|---------|------|
| **自動**（默認） | 自動檢測狀態頁面格式 |
| **Atlassian Statuspage** | 由 Atlassian Statuspage 驅動的狀態頁面（JSON API） |
| **RSS** | 提供 RSS 訂閱源的狀態頁面 |
| **Atom** | 提供 Atom 訂閱源的狀態頁面 |

### 自動檢測

設置爲 **自動** 時，OneUptime 將嘗試自動檢測狀態頁面格式：

1. 首先，嘗試 Atlassian Statuspage JSON API（`/api/v2/status.json` 和 `/api/v2/components.json`）
2. 如果失敗，嘗試將頁面解析爲 RSS 或 Atom 訂閱源
3. 作爲最終備選，執行基本的 HTTP 可達性檢查

## 創建外部狀態頁面監控器

1. 在 OneUptime 控制台中轉到 **監控器**
2. 點擊 **創建監控器**
3. 選擇 **外部狀態頁面** 作爲監控器類型
4. 輸入您要監控的狀態頁面 URL
5. 可選地選擇特定的提供商類型（或保留爲自動）
6. 可選地輸入組件名稱以將監控過濾到特定組件
7. 根據需要配置監控標準

## 配置選項

### 狀態頁面 URL

輸入您要監控的外部狀態頁面的 URL。對於由 Atlassian Statuspage 驅動的站點，通常是根 URL（例如 `https://status.example.com`）。對於 RSS/Atom 訂閱源，直接輸入訂閱源 URL。

### 提供商類型

選擇狀態頁面的提供商類型。使用 **自動**（默認）讓 OneUptime 自動檢測格式，或者如果您知道具體類型，指定特定的提供商類型。

### 組件名稱過濾器

如果狀態頁面報告多個組件，您可以選擇指定組件名稱，以僅監控該特定組件。例如，要僅監控 us-east-1 中的 AWS EC2，您可以輸入 `EC2 us-east-1`（狀態頁面上顯示的確切組件名稱）。

當未指定組件名稱時，監控狀態頁面的整體狀態。

### 高級選項

#### 超時

等待狀態頁面響應的最長時間（毫秒）。默認爲 10000ms（10 秒）。

#### 重試次數

請求失敗時的重試次數。默認爲 3 次重試。

## 監控標準

您可以配置標準來判斷外部服務何時處於在線、降級或離線狀態，基於以下條件：

- **是否在線** – 狀態頁面是否可達並返回狀態數據
- **整體狀態** – 狀態頁面的整體狀態指示器（例如"operational"、"major_outage"）
- **組件狀態** – 特定組件的狀態（使用組件名稱過濾器時）
- **活躍事件** – 狀態頁面上當前報告的活躍事件數量
- **響應時間** – 獲取狀態頁面數據所需的時間

## 常用狀態頁面 URL

以下是您可以監控的常用服務狀態頁面 URL 的精選列表：

| 服務 | 狀態頁面 URL |
|------|------------|
| AWS | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform | `https://status.cloud.google.com` |
| Microsoft Azure | `https://status.azure.com` |
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Datadog | `https://status.datadoghq.com` |
| PagerDuty | `https://status.pagerduty.com` |
| Twilio | `https://status.twilio.com` |
| Stripe | `https://status.stripe.com` |
| Slack | `https://status.slack.com` |
| Atlassian（Jira、Confluence） | `https://status.atlassian.com` |
| Vercel | `https://www.vercel-status.com` |
| Netlify | `https://www.netlifystatus.com` |
| DigitalOcean | `https://status.digitalocean.com` |
| Heroku | `https://status.heroku.com` |
| MongoDB Atlas | `https://status.cloud.mongodb.com` |
| Fastly | `https://status.fastly.com` |
| New Relic | `https://status.newrelic.com` |
| Sentry | `https://status.sentry.io` |
| CircleCI | `https://status.circleci.com` |

> **注意：** 這些服務中有許多使用 Atlassian Statuspage，因此 **自動** 提供商類型會自動檢測它們。

## 事件和警報模板

從外部狀態頁面監控器創建事件或警報時，您可以使用以下模板變量：

| 變量 | 描述 |
|------|------|
| `{{isOnline}}` | 狀態頁面是否在線（true/false） |
| `{{responseTimeInMs}}` | 響應時間（毫秒） |
| `{{failureCause}}` | 失敗原因（如有） |
| `{{overallStatus}}` | 整體狀態指示器值 |
| `{{activeIncidentCount}}` | 活躍事件數量 |
| `{{componentStatuses}}` | 組件狀態的 JSON 數組 |

## 最佳實踐

- **使用自動提供商類型**，除非您知道確切格式——自動檢測對大多數狀態頁面都很有效
- **監控特定組件**，如果您只依賴某些服務（例如特定的 AWS 區域）
- **設置事件關聯** — 當您的監控器檢測到問題，而上游狀態頁面也顯示問題時，有助於更快地識別根本原因
- **與其他監控器結合** — 將外部狀態頁面監控器與您自己的 API/網站監控器配合使用，以獲得全面的可見性
