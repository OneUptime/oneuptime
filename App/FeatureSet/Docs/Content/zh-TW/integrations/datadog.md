# Datadog 整合

將 [Datadog](https://www.datadoghq.com) 監控警報轉換為 OneUptime 事件，讓 Datadog 的偵測結果能夠提供給 OneUptime 的事件回應與狀態頁面使用。

此整合為**入站（inbound）**：Datadog 的 [Webhooks 整合](https://docs.datadoghq.com/integrations/webhooks/) 會發送至以 **Webhook 觸發器** 起始的 OneUptime **[工作流程](/docs/workflows/index)**。

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 先決條件

- 一個可供你設定整合與監控的 Datadog 帳戶。
- 一個可供你建立工作流程的 OneUptime 專案。

## 步驟 1 — 建立 OneUptime 工作流程

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Datadog → Incidents`，然後開啟 **Builder**。
2. 新增一個 **Webhook** 觸發器並**複製其 URL**。將該區塊重新命名為 `Datadog`。
3. 新增一個連接至觸發器的 **Conditions** 區塊：
   - **Left**：`{{Datadog.Request Body.transition}}`
   - **Operator**：`==`
   - **Right**：`Triggered`
4. 從 **Yes** 新增一個 **Create Incident** 區塊：
   - **Title**：`{{Datadog.Request Body.title}}`
   - **Description**：`{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**：選擇其一。
5. **儲存**（在測試完成前保持停用狀態）。

## 步驟 2 — 建立 Datadog webhook

1. 在 Datadog 中，前往 **Integrations → Webhooks**（如果尚未安裝，請先安裝 **Webhooks** 整合）。
2. **新增一個 webhook**：
   - **Name**：`oneuptime`（這會成為 `@webhook-oneuptime`）。
   - **URL**：你的工作流程的 webhook URL。
   - **Payload** — Datadog 讓你能夠使用 [範本變數](https://docs.datadoghq.com/integrations/webhooks/#usage) 定義 JSON 主體：

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. 儲存該 webhook。

## 步驟 3 — 將監控的警報傳送至 webhook

將 webhook 控制代碼新增至你想要轉發的監控。在每個監控的**通知訊息**中，加入：

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

這會同時將警報與復原傳送至 OneUptime。（若要轉發所有內容，你也可以無條件地將 `@webhook-oneuptime` 新增至監控。）

## 步驟 4 — 測試

1. 啟用工作流程。
2. 從監控中使用 **Test Notifications → Alert**，或讓真實的監控觸發。
3. 檢查工作流程的 **Logs** 分頁以及你的 **Incidents** 清單。

## 在復原時解決（選用）

當監控解除時，`$ALERT_TRANSITION` 會是 `Recovered`。新增第二個 **Conditions** 分支（`transition == Recovered`），找出相符的事件（依你所傳送的 `id` 比對），並使用 **Update Incident** 將其移至你的已解決狀態。

## 疑難排解

- **沒有出現任何執行紀錄** — 確認監控的訊息包含 `@webhook-oneuptime` 且工作流程已**啟用**。
- **欄位為空** — Datadog 只會替換適用於該事件的範本變數。請在 **Logs** 分頁中檢查觸發器輸出，並調整你的 webhook payload。
- **重複的事件** — 重複發出警報（renotify）的監控會傳送多個 `Triggered` 事件；在建立之前，先以針對 `id` 的 **Find Incident** 檢查進行去重。

## 後續閱讀

- [整合總覽](/docs/integrations/index) — 入站模式。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 與 [Grafana](/docs/integrations/grafana) — 其他入站來源。
- [Webhook 觸發器](/docs/workflows/triggers#webhook) — 接收 URL 的運作方式。
