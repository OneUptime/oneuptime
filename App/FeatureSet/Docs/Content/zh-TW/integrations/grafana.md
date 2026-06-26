# Grafana 整合

將 [Grafana](https://grafana.com) 警報轉換為 OneUptime 事件。Grafana 評估您儀表板上的警報規則；OneUptime 則負責記錄、升級並追蹤這些警報。

此整合為**入站 (inbound)**：Grafana 的警報透過 Grafana 的 **Webhook 聯絡點 (contact point)**，將資料張貼到以 **Webhook 觸發器**開頭的 OneUptime **[Workflow](/docs/workflows/index)**。

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 先決條件

- Grafana 9 以上版本，並啟用[統一警報 (unified alerting)](https://grafana.com/docs/grafana/latest/alerting/)（在現代 Grafana 中為預設值）。
- Grafana 必須能透過 HTTPS 連線到您的 OneUptime 執行個體。
- 一個可供您建立 Workflow 的 OneUptime 專案。

## 步驟 1 — 建立 OneUptime Workflow

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Grafana → Incidents`，然後開啟 **Builder**。
2. 新增一個 **Webhook** 觸發器並**複製其 URL**。將該區塊重新命名為 `Grafana`。
3. 新增一個連接到觸發器的 **Conditions** 區塊：
   - **Left**：`{{Grafana.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 從 **Yes** 新增一個 **Create Incident** 區塊：
   - **Title**：`{{Grafana.Request Body.title}}`
   - **Description**：`{{Grafana.Request Body.message}}`
   - **Severity**：選擇其中一個（或依 `{{Grafana.Request Body.commonLabels.severity}}` 進行分支）。
5. **儲存**（在測試之前保持停用狀態）。

Grafana 的 webhook 酬載遵循 Alertmanager 的格式——它包含 `status`、一個 `alerts` 陣列、`commonLabels` 與 `commonAnnotations`，以及方便使用的頂層 `title` 與 `message` 欄位。

## 步驟 2 — 設定 Grafana 聯絡點

1. 在 Grafana 中，前往 **Alerting → Contact points → Add contact point**。
2. **Name**：`OneUptime`。**Integration**：**Webhook**。
3. **URL**：貼上您 Workflow 的 webhook URL。**HTTP Method**：`POST`。
4. 儲存該聯絡點。
5. 前往 **Alerting → Notification policies**，將您想要的警報（或預設原則）路由到 **OneUptime** 聯絡點。

## 步驟 3 — 測試

1. 啟用 Workflow。
2. 在聯絡點畫面中，使用 **Test** 傳送範例通知，或讓真實的警報規則觸發。
3. 檢查 Workflow 的 **Logs** 分頁以及您的 **Incidents** 清單。

## 在復原時解除 (選用)

當警報解除時，Grafana 會傳送另一則狀態為 `status: resolved` 的通知。新增第二個 **Conditions** 分支（`status == resolved`），找出對應的事件，並使用 **Update Incident** 將其移至您的已解除狀態。

## 注意事項

- **舊版警報 (Grafana 8 及更早版本)** 會傳送不同的酬載（`ruleName`、`state`、`evalMatches`）。如果您使用的是舊版警報，請改為參照 `{{Grafana.Request Body.ruleName}}` 與 `{{Grafana.Request Body.state}}`，並依 `state == alerting` 進行分支。
- 您也可以完全略過 Grafana 的警報功能，改由 OneUptime 直接監控相同的指標——請參閱 [Metrics Monitor](/docs/monitor/metrics-monitor)。

## 疑難排解

- **沒有出現任何執行紀錄** — 確認 Grafana 能連線到該 URL（檢查 Grafana 的伺服器記錄），且該 Workflow 已**啟用**。
- **欄位為空** — 在 **Logs** 分頁中檢視觸發器的輸出；請參照您警報版本中實際存在的欄位。

## 接下來閱讀

- [Integrations Overview](/docs/integrations/index) — 入站模式。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — 密切相關的酬載。
- [Metrics Monitor](/docs/monitor/metrics-monitor) — 直接在 OneUptime 中監控指標。
