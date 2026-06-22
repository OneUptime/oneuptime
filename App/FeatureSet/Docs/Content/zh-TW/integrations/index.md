# 整合

OneUptime 透過 **[Workflows](/docs/workflows/index)**（內建的自動化引擎）連接你的團隊已在使用的工具——Zabbix、Jira、PagerDuty、Slack 以及更多。不需要另外安裝任何外掛。你在拖放式畫布上將整合串接起來，當有事件發生時它就會執行。

本頁說明每個整合所使用的兩種模式。一旦你理解了它們，幾乎任何東西都能連接到 OneUptime，甚至包括在這裡沒有自己專屬頁面的工具。

## 兩種模式

每個整合都會以兩個方向之一移動資料（許多整合兩者都會用到）。

### 入站（Inbound）—— 另一個工具將資料送進 OneUptime

當外部系統需要*在 OneUptime 中建立或更新某些東西*時使用這種模式——通常是在它偵測到問題時開立一個事件（incident）或一個警示（alert）。

1. 建立一個以 **[Webhook 觸發器](/docs/workflows/triggers#webhook)** 開始的工作流程。OneUptime 會給你一個唯一的 URL。
2. 在另一個工具中，設定一個 webhook／通知動作，使其在有事件發生時 POST 到該 URL。
3. 在工作流程中，讀取傳入的酬載（payload），並使用 **Create Incident**（或 Create Alert）元件來記錄它。

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### 出站（Outbound）—— OneUptime 將資料送到另一個工具

當*OneUptime 中的某些東西應該出現在另一個工具中*時使用這種模式——開立一張 Jira 工單、在 PagerDuty 中呼叫某人、或張貼到 Slack。

1. 建立一個以 **[OneUptime 事件觸發器](/docs/workflows/triggers#oneuptime-event-triggers)** 開始的工作流程——例如 **Incident → On Create**。
2. 加入一個 **[API 元件](/docs/workflows/components#api)**，以事件的詳細資訊呼叫另一個工具的 REST API。
3. 將任何 API 金鑰儲存為 **祕密 [全域變數](/docs/workflows/variables#global-variables)**，讓它們永遠不會出現在工作流程或其記錄檔中。

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## 目錄

| 工具                                                                  | 方向           | 功能說明                                                    |
| --------------------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | 入站           | 將 Zabbix 問題轉換為 OneUptime 事件（並在復原時解決它們）。 |
| [Jira](/docs/integrations/jira)                                       | 出站（＋入站） | 為每個事件開立一個 Jira issue；並將狀態同步回來。           |
| [PagerDuty](/docs/integrations/pagerduty)                             | 出站（＋入站） | 從 OneUptime 事件觸發並解決 PagerDuty 事件。                |
| [Opsgenie](/docs/integrations/opsgenie)                               | 出站（＋入站） | 建立並關閉 Opsgenie 警示。                                  |
| [ServiceNow](/docs/integrations/servicenow)                           | 出站（＋入站） | 從 OneUptime 開立 ServiceNow 事件。                         |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | 入站           | 將 Alertmanager 通知轉換為事件。                            |
| [Grafana](/docs/integrations/grafana)                                 | 入站           | 將 Grafana 警示轉換為事件。                                 |
| [Datadog](/docs/integrations/datadog)                                 | 入站           | 將 Datadog 監控警示轉換為事件。                             |
| [GitHub](/docs/integrations/github)                                   | 出站           | 為事件開立一個 GitHub issue。                               |
| [GitLab](/docs/integrations/gitlab)                                   | 出站           | 為事件開立一個 GitLab issue。                               |
| [Discord](/docs/integrations/discord)                                 | 出站           | 將事件更新張貼到 Discord 頻道。                             |
| [Telegram](/docs/integrations/telegram)                               | 出站           | 將事件更新傳送到 Telegram 聊天。                            |
| [Slack](/docs/workspace-connections/slack)                            | 雙向           | 原生的工作區連線——頻道、警示與待命（on-call）。             |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | 雙向           | 原生的工作區連線。                                          |

> **Slack 與 Microsoft Teams** 擁有更深入的原生連線，超越了工作流程的範圍——自動建立事件頻道、雙向動作以及待命通知。對於這些功能，請使用 [Slack](/docs/workspace-connections/slack) 與 [Microsoft Teams](/docs/workspace-connections/microsoft-teams) 工作區連線，而不是建立一個工作流程。

## 處理祕密資訊

絕對不要將 API 金鑰或權杖直接貼進區塊中。請改用以下方式：

1. 前往 **Workflows → Global Variables**。
2. 建立一個變數——例如 `JIRA_AUTH`——並開啟 **Is Secret**。
3. 在任何地方以 `{{variable.JIRA_AUTH}}` 引用它。

祕密變數在你儲存後會在 UI 中隱藏，並會從執行記錄檔中清除。請參閱 [Variables](/docs/workflows/variables#global-variables)。

## 驗證速查表

大多數出站整合在 API 區塊上都需要一個 `Authorization` 標頭。常見的形式如下：

| 機制               | 標頭值                                     | 使用者               |
| ------------------ | ------------------------------------------ | -------------------- |
| Bearer token       | `Bearer {{variable.TOKEN}}`                | GitHub、許多現代 API |
| Basic auth         | `Basic {{variable.BASE64_USER_PASS}}`      | Jira、ServiceNow     |
| API key 標頭       | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie             |
| Token 放在主體中   | JSON 主體中的 `routing_key` 欄位           | PagerDuty Events API |
| Private token 標頭 | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab               |

對於 Basic auth，請將 `username:password`（或 `email:api_token`）以 base64 編碼**一次**，然後將結果儲存為祕密。在 macOS/Linux 上：

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## 沒看到你的工具？

幾乎任何工具都符合上述兩種模式之一：

- 如果該工具能在有事件發生時**送出 webhook**，請使用**入站**模式——將它的 webhook 指向一個 OneUptime Webhook 觸發器。
- 如果該工具有 **REST API**，請使用**出站**模式——從一個 **API 元件**呼叫它。
- 如果你需要在兩者之間重新調整資料的形狀，請放入一個 **[Custom Code](/docs/workflows/components#custom-code)** 區塊。

這涵蓋了長尾的工具——Zendesk、AWS CloudWatch（透過 SNS）、New Relic、Splunk、StatusCake 等等。做法是相同的；只有 URL 和酬載會不同。

## 接下來閱讀什麼

- [Workflows Overview](/docs/workflows/index) —— 自動化引擎的運作方式。
- [Triggers](/docs/workflows/triggers) —— Webhook 與 OneUptime 事件觸發器的詳細說明。
- [Components](/docs/workflows/components) —— API、Webhook 與資料元件。
- [Variables](/docs/workflows/variables) —— 祕密資訊以及在區塊之間傳遞資料。
- [Zabbix](/docs/integrations/zabbix) 與 [Jira](/docs/integrations/jira) —— 完整的實作範例。
