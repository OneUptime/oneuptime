# PagerDuty 整合

每當建立 OneUptime 事件時觸發一個 [PagerDuty](https://www.pagerduty.com) 事件，並在 OneUptime 解決時一併解決。當 PagerDuty 掌管你的升級流程與待命排程，而你希望讓 OneUptime 的監控資料餵入其中時，這項整合非常實用。

這項整合是**對外（outbound）**的：OneUptime 呼叫 PagerDuty 的 [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/)。它使用一個 OneUptime **[Workflow](/docs/workflows/index)**，搭配 **Incident → On Create** 觸發器與 **API 元件**。

> OneUptime 內建自己的待命與升級功能 — 請參閱 [On Call](/docs/on-call/incoming-call-policy)。只有在你特別希望事件也送入 PagerDuty 時，才使用這項整合。

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## 先決條件

- 一個具有 **Events API v2** 整合的 PagerDuty 服務。在 PagerDuty 中：**Service → Integrations → Add integration → Events API v2**。複製 **Integration Key**（也稱為 *routing key*）。
- 一個你可以建立工作流程的 OneUptime 專案。

## 步驟 1 — 儲存 routing key

1. 前往 **Workflows → Global Variables → Create**。
2. 將它命名為 `PAGERDUTY_ROUTING_KEY`，貼上 integration key，並開啟 **Is Secret**。

## 步驟 2 — 建立「觸發」工作流程

1. 開啟 **Workflows → Create Workflow**，命名為 `Incidents → PagerDuty`，然後開啟 **Builder**。
2. 新增一個設定為 **On Create** 的 **Incident** 觸發器。將它重新命名為 `Incident`。
3. 新增一個連接到觸發器的 **API** 區塊：
   - **Method**：`POST`
   - **URL**：`https://events.pagerduty.com/v2/enqueue`
   - **Headers**：`Content-Type: application/json`
   - **Body**：

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** 將這個 PagerDuty 事件與 OneUptime 事件綁定在一起，讓你之後可以解決它。使用 OneUptime 事件 id 可以讓它保持唯一且可預測。
4. **Save**、啟用，並建立一個測試事件。工作流程記錄中出現 `202` 回應，代表 PagerDuty 已接受該事件。

## 步驟 3 — 在 OneUptime 解決時一併解決（建議）

1. 在**同一個**工作流程中，新增第二個 **Incident** 觸發器？不行 — 一個工作流程只能有一個觸發器。請改為建立**第二個**工作流程，命名為 `Resolve PagerDuty`，並使用 **Incident → On Update** 觸發器。
2. 新增一個 **Conditions** 區塊，檢查該事件現在是否已解決（依事件的 state／`{{Incident.currentIncidentState.name}}` 是否等於你的已解決狀態名稱來分支）。
3. 從 **Yes** 分支新增一個指向 PagerDuty 的 **API** 區塊，使用**相同的 `dedup_key`**，並將 `event_action` 設為 `resolve`：

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty 會比對 `dedup_key` 並關閉原本的事件。

## 嚴重性對應（選用）

PagerDuty 的 `severity` 接受 `critical`、`error`、`warning` 或 `info`。若要從 OneUptime 的嚴重性進行對應，請在 API 區塊之前依 `{{Incident.incidentSeverity.name}}` 新增 **Conditions** 分支，並從每個分支送出不同的 body。

## 對內（選用）

若要反向操作 — 從 PagerDuty 事件開啟一個 OneUptime 事件 — 請新增一個 **Webhook** 觸發器工作流程，並將 PagerDuty 的 [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/)（或 Events Orchestration）指向其 URL，然後使用 **Create Incident**。請參閱[對內模式](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime)。

## 疑難排解

- **`400` 且出現 `"invalid routing key"`** — 該整合必須是 **Events API v2**，而非較舊的 Events API v1 或其他整合類型。請重新複製金鑰。
- **解決時沒有關閉任何東西** — 解決呼叫上的 `dedup_key` 必須與觸發呼叫完全相符。
- **記錄中沒有任何內容** — 請確認工作流程已 **Enabled**，且觸發器設為 **On Create**。

## 接下來閱讀

- [Integrations Overview](/docs/integrations/index) — 各種模式與驗證速查表。
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime 內建的升級功能。
- [Opsgenie](/docs/integrations/opsgenie) — 適用於 Opsgenie 的相同概念。
