# Prometheus Alertmanager 整合

將 [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) 通知轉換為 OneUptime 事件。Prometheus 評估您的告警規則，Alertmanager 進行路由，而 OneUptime 則記錄並升級這些告警。

此整合屬於 **inbound（傳入）**：Alertmanager 會 POST 到一個以 **Webhook 觸發器**為起點的 OneUptime **[Workflow](/docs/workflows/index)**。

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 先決條件

- 一個可讓您編輯 `alertmanager.yml` 的 Prometheus + Alertmanager 環境。
- Alertmanager 必須能透過 HTTPS 連線到您的 OneUptime 執行個體。
- 一個可讓您建立工作流程的 OneUptime 專案。

## 步驟 1 — 建立 OneUptime 工作流程

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Alertmanager → Incidents`，然後開啟 **Builder**。
2. 加入一個 **Webhook** 觸發器並**複製其 URL**。將該區塊重新命名為 `Alertmanager`。
3. 加入一個連接至觸發器的 **Conditions** 區塊：
   - **Left**：`{{Alertmanager.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 從 **Yes** 分支加入一個 **Create Incident** 區塊：
   - **Title**：`{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**：`{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**：選擇其中一項（或先依 `{{Alertmanager.Request Body.commonLabels.severity}}` 進行分支）。
5. **儲存**（在測試完成前先保持停用）。

> **關於分組告警。** Alertmanager 會將告警分組並送出一個 `alerts` **陣列**。上述的 `commonLabels` 與 `commonAnnotations` 是該群組中共用的欄位，非常適合用於「每則通知對應一個事件」。如果您想要**每個告警對應一個事件**，請加入一個 [Custom Code](/docs/workflows/components#custom-code) 區塊，對 `Request Body.alerts` 進行迴圈處理，並為每個告警建立一個事件。可在路由中透過 `group_by` 調整分組方式。

## 步驟 2 — 設定 Alertmanager

加入一個指向工作流程 URL 的 webhook receiver，並將告警路由至該 receiver。在 `alertmanager.yml` 中：

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

重新載入 Alertmanager（`curl -X POST http://localhost:9093/-/reload`，或重新啟動）。

## 步驟 3 — 進行測試

1. 啟用工作流程。
2. 觸發一個測試告警 — 例如使用 `amtool`：

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. 檢查該工作流程的 **Logs** 分頁以及您的 **Incidents** 清單。

## 在恢復時解決事件（選用）

啟用 `send_resolved: true` 後，當告警解除時 Alertmanager 也會送出 POST，此時帶有 `status: resolved`。加入第二個 **Conditions** 分支（`status == resolved`），找出相符的事件（依 `commonLabels.alertname` 比對），並透過 **Update Incident** 將其移至您的已解決狀態。

## 疑難排解

- **沒有出現執行記錄** — 確認 Alertmanager 能連線到該 URL（檢查其記錄是否有傳送錯誤），並確認該工作流程已 **Enabled（啟用）**。
- **事件欄位為空** — 不同的規則會設定不同的 annotations。請檢查 **Logs** 分頁中的觸發器輸出，並參照實際存在的欄位（`commonAnnotations` 與每個告警各自的 `annotations`）。
- **事件過多** — 增加 `group_by`／`group_interval`，讓 Alertmanager 將相關告警批次處理。

## 後續閱讀

- [Integrations Overview](/docs/integrations/index) — 傳入（inbound）模式。
- [Grafana](/docs/integrations/grafana) — 相同概念，使用 Grafana 告警。
- [Webhook trigger](/docs/workflows/triggers#webhook) — 接收 URL 的運作方式。
