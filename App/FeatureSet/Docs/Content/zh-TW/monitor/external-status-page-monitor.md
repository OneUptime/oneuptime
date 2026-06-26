# 外部狀態頁面監控

外部狀態頁面監控可讓您監控第三方狀態頁面,並在您所依賴的服務發生中斷或效能降級時收到警示。OneUptime 會定期檢查外部狀態頁面(例如 AWS、GCP、Azure、GitHub、OpenAI、Anthropic 等),並評估其狀態。

## 概觀

外部狀態頁面監控會透過查詢您所依賴服務的公開狀態頁面來檢查其健康狀況。這讓您能夠:

- 監控您的應用程式所依賴之第三方服務的可用性
- 在上游供應商發生中斷時收到警示
- 追蹤個別元件的狀態(例如「AWS EC2 us-east-1」)
- 將監控範圍限定於單一元件群組(例如僅 OpenAI 的「APIs」),如此一來頁面上其他不相關的事件就不會觸發您的監控
- 在效能降級影響您的使用者之前偵測到它
- 將您自己的事件與上游供應商的問題進行關聯

## 支援的供應商

OneUptime 支援透過下列方法監控狀態頁面:

| 供應商類型               | 說明                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| **Auto**(預設)           | 自動偵測狀態頁面格式                                            |
| **Atlassian Statuspage** | 由 Atlassian Statuspage 提供支援的狀態頁面(JSON API)            |
| **incident.io**          | 由 incident.io 提供支援的狀態頁面(例如 `https://status.openai.com`) |
| **RSS**                  | 提供 RSS 摘要的狀態頁面                                          |
| **Atom**                 | 提供 Atom 摘要的狀態頁面                                         |

### 自動偵測

當設定為 **Auto** 時,OneUptime 會依下列順序嘗試自動偵測狀態頁面格式:

1. 首先,它會嘗試 incident.io 狀態頁面 API(`/proxy/<host>`)
2. 接著,它會嘗試 Atlassian Statuspage JSON API(`/api/v2/status.json`、`/api/v2/components.json` 與 `/api/v2/incidents/unresolved.json`)
3. 如果上述方法失敗,它會嘗試將該頁面解析為 RSS 或 Atom 摘要
4. 作為最後的後備方案,它會執行基本的 HTTP 可達性檢查

> **注意:** 會先檢查 incident.io,因為某些 incident.io 狀態頁面(例如 `https://status.openai.com`)也會公開一個有限的 Atlassian 相容端點,但該端點省略了元件群組與進行中的事件。先檢查 incident.io 可確保使用更豐富、具備群組感知能力的資料。

## 建立外部狀態頁面監控

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **External Status Page** 作為監控類型
4. 輸入您想要監控的狀態頁面 URL
5. 視需要選擇特定的供應商類型(或保留為 **Auto**)
6. 視需要輸入**元件群組**,以將範圍限定於某個群組,例如「APIs」
7. 視需要輸入**元件名稱**,以篩選至單一元件(如果已設定群組,則於該群組內篩選)
8. 視需要設定監控條件

## 設定選項

### 狀態頁面 URL

輸入您想要監控的外部狀態頁面 URL。對於由 Atlassian Statuspage 及 incident.io 提供支援的網站,這通常是根 URL(例如 `https://status.example.com`)。對於 RSS/Atom 摘要,請直接輸入摘要 URL。

### 供應商類型

選擇狀態頁面的供應商類型。使用 **Auto**(預設)讓 OneUptime 自動偵測格式,或在您知道格式時指定 **Atlassian Statuspage**、**incident.io**、**RSS** 或 **Atom**。

### 元件群組篩選

如果狀態頁面將其元件組織成群組,您可以將監控範圍限定於單一群組。例如,在 `https://status.openai.com` 上,輸入 `APIs` 會將監控範圍限定於 OpenAI 的 API 服務。

當設定了元件群組時,**進行中的事件數量**與**整體狀態**僅會使用該群組中的元件來計算 — 影響不相關群組(例如 ChatGPT)的事件不會觸發範圍限定於「APIs」群組的監控。

元件群組篩選支援 **Atlassian Statuspage** 與 **incident.io** 供應商。(RSS/Atom 摘要不會公開元件群組。)

### 元件名稱篩選

如果狀態頁面回報多個元件,您可以選擇指定一個元件名稱,以僅監控該特定元件。例如,若要僅監控 us-east-1 中的 AWS EC2,您會輸入 `EC2 us-east-1`(狀態頁面上所顯示的確切元件名稱)。

當同時設定了元件群組時,元件名稱篩選會套用於**該群組內**,讓您能夠鎖定較大群組中的單一元件。當兩種篩選皆未指定時,則會監控範圍內的所有元件。

### 進階選項

#### 逾時

等待狀態頁面回應的最長時間(以毫秒為單位)。預設為 10000ms(10 秒)。

#### 重試

如果請求失敗時的重試次數。預設為 3 次重試。

## 監控條件

您可以根據下列項目設定條件,以判斷外部服務何時被視為上線或離線:

- **Is Online** – 狀態頁面是否可達並回傳狀態資料
- **Overall Status** – 狀態頁面的整體狀態指標(例如 `operational`、`degraded_performance`、`partial_outage`、`major_outage`)
- **Component Status** – 範圍內元件的狀態(會遵循元件群組/元件名稱篩選)
- **Active Incidents** – 狀態頁面上目前回報的進行中事件數量(設定篩選時會限定於該元件群組/元件)
- **Response Time** – 擷取狀態頁面資料所需的時間

### 預設條件

依照預設,OneUptime 會根據狀態頁面真正重要的項目來建立條件 — 即其進行中的事件與元件健康狀況,而非僅僅是可達性:

- 當範圍內沒有進行中的事件時,監控會標示為 **Operational**。
- 當範圍內至少有一個進行中的事件,或範圍內某個元件回報 `degraded_performance`、`partial_outage`、`major_outage` 或 `full_outage` 時,監控會標示為 **Down**(並建立一個事件)。

由於進行中的事件數量與元件狀態會遵循元件群組/元件名稱篩選,這些預設條件會自動僅鎖定您所關心的元件。

## 熱門狀態頁面 URL

以下是您可以監控的熱門服務狀態頁面 URL 精選清單:

| 服務                        | 狀態頁面 URL                                  |
| --------------------------- | --------------------------------------------- |
| AWS                         | `https://health.aws.amazon.com/health/status` |
| Google Cloud Platform       | `https://status.cloud.google.com`             |
| Microsoft Azure             | `https://status.azure.com`                    |
| GitHub                      | `https://www.githubstatus.com`                |
| OpenAI                      | `https://status.openai.com`                   |
| Anthropic                   | `https://status.anthropic.com`                |
| Cloudflare                  | `https://www.cloudflarestatus.com`            |
| Datadog                     | `https://status.datadoghq.com`                |
| PagerDuty                   | `https://status.pagerduty.com`                |
| Twilio                      | `https://status.twilio.com`                   |
| Stripe                      | `https://status.stripe.com`                   |
| Slack                       | `https://status.slack.com`                    |
| Atlassian(Jira、Confluence) | `https://status.atlassian.com`                |
| Vercel                      | `https://www.vercel-status.com`               |
| Netlify                     | `https://www.netlifystatus.com`               |
| DigitalOcean                | `https://status.digitalocean.com`             |
| Heroku                      | `https://status.heroku.com`                   |
| MongoDB Atlas               | `https://status.cloud.mongodb.com`            |
| Fastly                      | `https://status.fastly.com`                   |
| New Relic                   | `https://status.newrelic.com`                 |
| Sentry                      | `https://status.sentry.io`                    |
| CircleCI                    | `https://status.circleci.com`                 |

> **注意:** 其中許多服務使用 Atlassian Statuspage 或 incident.io,因此 **Auto** 供應商類型會自動偵測它們。

## 事件與警示範本

從外部狀態頁面監控建立事件或警示時,您可以使用下列範本變數:

| 變數                      | 說明                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `{{isOnline}}`            | 狀態頁面是否上線(true/false)                                  |
| `{{responseTimeInMs}}`    | 回應時間(以毫秒為單位)                                        |
| `{{failureCause}}`        | 失敗原因(如有)                                                |
| `{{overallStatus}}`       | 整體狀態指標值                                                |
| `{{activeIncidentCount}}` | 進行中的事件數量(如有設定,則限定於篩選範圍)                  |
| `{{componentStatuses}}`   | 元件狀態的 JSON 陣列(`name`、`status`、`description`、`groupName`) |
| `{{provider}}`            | 偵測到的供應商(Atlassian Statuspage、incident.io、RSS、Atom)  |
| `{{componentGroup}}`      | 監控所限定的元件群組(如有)                                    |
| `{{componentName}}`       | 監控所限定的元件(如有)                                        |

## 最佳實務

- **使用 Auto 供應商類型**,除非您知道確切的格式 — Auto 偵測對於大多數狀態頁面都運作良好
- **限定於某個元件群組**,如果您僅依賴供應商的一部分(例如僅 OpenAI 的「APIs」),如此一來不相關的事件就不會造成雜訊
- **監控特定元件**,如果您僅依賴某些服務(例如特定的 AWS 區域)
- **設定事件關聯** — 當您的監控偵測到問題,且上游狀態頁面也顯示問題時,有助於更快找出根本原因
- **與其他監控搭配使用** — 將外部狀態頁面監控與您自己的 API/網站監控配對,以獲得全面的可見性
