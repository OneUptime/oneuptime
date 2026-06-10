# Opsgenie 整合

每當建立 OneUptime 事件時，就建立一個 [Opsgenie](https://www.atlassian.com/software/opsgenie) 警報，並在 OneUptime 解決時將其關閉。

此整合屬於**對外（outbound）**：OneUptime 會呼叫 [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api)。它使用具備 **Incident → On Create** 觸發器與 **API component** 的 OneUptime **[Workflow](/docs/workflows/index)**。

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## 先決條件

- 來自 API 整合的 Opsgenie **API key**：**Settings → Integrations → Add → API**。複製該金鑰。
- 了解你的區域。預設的 API 主機為 `https://api.opsgenie.com`；歐盟（EU）帳號使用 `https://api.eu.opsgenie.com`。
- 一個你可以建立工作流程的 OneUptime 專案。

## 步驟 1 — 儲存 API key

1. 前往 **Workflows → Global Variables → Create**。
2. 將其命名為 `OPSGENIE_KEY`，貼上 API key，並開啟 **Is Secret**。

## 步驟 2 — 建立「create alert」工作流程

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Incidents → Opsgenie`，並開啟 **Builder**。
2. 新增一個設定為 **On Create** 的 **Incident** 觸發器。將其重新命名為 `Incident`。
3. 新增一個連接到該觸發器的 **API** 區塊：
   - **Method**：`POST`
   - **URL**：`https://api.opsgenie.com/v2/alerts`  *(歐盟請使用 `api.eu.opsgenie.com`)*
   - **Headers**：

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**：

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   **`alias`** 會將此 Opsgenie 警報與該 OneUptime 事件繫結，讓你之後可以依 alias 將其關閉。請注意，Opsgenie 的驗證機制是字面字串 `GenieKey`，後接一個空格與你的金鑰。
4. **Save**、啟用，並建立一個測試事件。工作流程記錄中出現 `202 Accepted` 回應即表示 Opsgenie 已將警報排入佇列。

## 步驟 3 — 在 OneUptime 解決時關閉（建議）

1. 建立**第二個**工作流程，命名為 `Close Opsgenie`，並使用 **Incident → On Update** 觸發器。
2. 新增一個 **Conditions** 區塊，檢查該事件現在是否已解決（依 `{{Incident.currentIncidentState.name}}` 分支）。
3. 從 **Yes** 新增一個 **API** 區塊：
   - **Method**：`POST`
   - **URL**：`https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**：相同的 `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**：`{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie 會依 alias 查找該警報並將其關閉。

## 優先順序對應（選用）

Opsgenie 的優先順序為 `P1`–`P5`。在 API 區塊之前，以 **Conditions** 分支依 `{{Incident.incidentSeverity.name}}` 從 OneUptime 的嚴重性對應。

## 疑難排解

- **`401`/`403`** — 金鑰錯誤、區域主機錯誤，或該整合缺乏建立警報的權限。確認你使用的是 **API** 整合金鑰，以及相符的 `api`/`api.eu` 主機。
- **關閉時回傳 `404`** — 關閉呼叫上的 `alias` 必須與建立呼叫完全相符，且查詢字串中必須包含 `identifierType=alias`。
- **沒有任何反應** — 確認該工作流程已 **Enabled**。

## 接下來該閱讀

- [Integrations Overview](/docs/integrations/index) — 各種模式與驗證速查表。
- [PagerDuty](/docs/integrations/pagerduty) — 對 PagerDuty 的相同做法。
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime 內建的升級機制。
