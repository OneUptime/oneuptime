# Prometheus Alertmanager 整合

把 [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) 的通知轉成 OneUptime 事件。Prometheus 評估你的警示規則，Alertmanager 負責路由，OneUptime 負責記錄與升級。

這項整合是 **入站** 的，而且有兩種建置方式：

| 做法                                                                 | 適用時機                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **[傳入請求監控器](/docs/monitor/incoming-request-monitor)**（建議） | 你希望警示變成帶待命升級的事件，每則警示一個事件，並在復原時自動解決。沒有自訂邏輯需要維護。 |
| **[工作流程](/docs/workflows/index) 搭配 Webhook 觸發器**            | 你需要 OneUptime 原生不支援的路由邏輯——呼叫其他系統、重新塑形酬載、條件分支。                |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## 先決條件

- 一套你可以編輯 `alertmanager.yml` 的 Prometheus + Alertmanager 環境。
- Alertmanager 必須能透過 HTTPS 連到你的 OneUptime 執行個體。
- 一個你可以建立監控器（或工作流程）的 OneUptime 專案。

## 選項 1 —— 傳入請求監控器

### 步驟 1 —— 建立監控器

1. 前往 **監控器 → 建立監控器**，選擇 **傳入請求**。
2. 開啟該監控器，點擊左側選單中的 **Documentation**。複製 URL：

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   自架時請使用你自己的主機。路徑中的密鑰是唯一的憑證。

### 步驟 2 —— 讓 Alertmanager 指向它

在 `alertmanager.yml` 中：

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` 是必要的——正是它告訴 OneUptime 某則警示已經復原。用 `curl -X POST http://localhost:9093/-/reload` 重新載入 Alertmanager，或重新啟動它。

Alertmanager 會送出 `Content-Type: application/json`，OneUptime 需要它才能從酬載中讀取欄位。

### 步驟 3 —— 設定條件

開啟監控器的 **Criteria**，編輯第一個條件。

**過濾器**

- **Filter Type**：`JavaScript Expression`
- **Filter Condition**：`Evaluates To True`
- **Value**：`"{{requestBody.status}}" === "firing"`

  佔位符兩側的引號是字串比較所必需的。如果你不想使用運算式，`Request Body` / `Contains` / `"status":"firing"` 的過濾器同樣可行。

**動作**

- 開啟 _When filters match, change monitor status_，並設為 **Offline**（或 Degraded）。
- 開啟 _When filters match, declare an incident_。設定 **Title**、**Severity** 以及要呼叫的 **On-Call Policies**。
- 在該事件的 **Advanced Options** 下開啟 **Auto Resolve Incident**。否則復原通知會被忽略，事件將永遠處於開啟狀態。

**Settings → Group incidents and alerts by a payload field**

開啟它，這樣同一個端點就能同時保有多個事件——每則警示一個——而不是每次通知只有一個事件。

| 欄位                               | 值                                  |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` 會在 Alertmanager 的 `alerts` 陣列上展開，為每個 **不同的** 擷取值開立一個事件。因為兩個路徑都用了 `[*]`，復原是逐則警示判定的：在一則已解決、兩則仍在觸發的酬載中，只有已解決的那則會被關閉。

> **Warning:** 請以每則警示真正唯一的東西來分組。Alertmanager 的 `fingerprint` 是警示完整標籤集的雜湊，因此它一定唯一。標籤只有在單次通知 **內部** 會變化時才可用——而任何列在路由 `group_by` 中的標籤永遠不會變化，因為正是它定義了聚合群組。在上面的 `group_by: ["alertname", "instance"]` 下，以 `requestBody.alerts[*].labels.alertname` 分組會從酬載中的每一則警示擷取到相同的值，於是全部塌縮成一個事件。更糟的是，重複的值只保留 **第一次** 出現，因此若酬載中第一則警示是 `resolved`，就會在其餘警示仍在觸發時把該事件關閉。

### 步驟 4 —— 撰寫事件的標題與描述

分組鍵會以路徑最後一段命名的變數提供，因此 `requestBody.alerts[*].fingerprint` 給你的是 `{{fingerprint}}`。它是一個雜湊，不適合呈現給處理人員——請改用整份通知共用的標籤來擬定事件標題。`commonLabels` 會帶有路由 `group_by` 中的每個標籤，因此在上述設定下 `alertname` 與 `instance` 都可用：

- **Title**：`{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**：

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` 與 `commonAnnotations` 存放整份通知共用的欄位。像 `requestBody.alerts[0].annotations.summary` 這種單則警示路徑一律讀取酬載中的 _第一_ 則警示，而不是這個事件所對應的那一則——因此若你希望每個事件帶上各自的註解文字，就要把 `group_by` 收得更緊。無法解析的路徑會連同大括號原樣輸出，而不是留白。完整變數清單見 [事件與警示動態範本](/docs/monitor/incident-alert-templating)。

### 步驟 5 —— 讓監控器回到 Operational（選用）

條件只在相符時才會動作，因此請加入第二個條件，避免一切平息後監控器仍停留在 Offline：

- **Filter Type**：`JavaScript Expression`，**Value**：`"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**，並且不建立任何事件。

### 步驟 6 —— 測試

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

你應該會得到兩個事件——每個 `fingerprint` 一個。把兩則警示的 `status` 都改為 `resolved` 再送一次，兩個事件都應該關閉。

你也可以用 `amtool` 觸發一則真實警示：

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## 選項 2 —— 工作流程

當你需要超出「警示變成事件」的邏輯時，請使用這個做法。

1. 開啟 **工作流程 → 建立工作流程**，將其命名為 `Alertmanager → Incidents`，然後開啟 **建構器**。
2. 加入一個 **Webhook** 觸發器並**複製其 URL**。將該區塊重新命名為 `Alertmanager`。
3. 加入一個連接至觸發器的 **Conditions** 區塊：
   - **Left**：`{{Alertmanager.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 從 **Yes** 分支加入一個 **Create Incident** 區塊：
   - **標題**：`{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **描述**：`{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **嚴重程度**：選擇其中一項（或先依 `{{Alertmanager.Request Body.commonLabels.severity}}` 進行分支）。
5. **儲存**，然後把上面步驟 2 中 `webhook_configs` 的 URL 改指向該工作流程的 URL。

若要每則警示一個事件，請加入一個 [Custom Code](/docs/workflows/components#custom-code) 區塊，對 `Request Body.alerts` 進行迴圈。搭配 `send_resolved: true`，再加入第二條以 `status == resolved` 為條件的 **Conditions** 分支，找出對應的事件並用 **Update Incident** 將它移到你的已解決狀態。

## 死人開關

兩個選項都無法告訴你 Prometheus 本身何時停止運作——沒有警示送達，看起來就跟一切正常一模一樣。常見的做法是設一則永遠觸發的警示，把它路由到一個依排程等待它的監控器。[kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) 內建了一則名為 `Watchdog` 的規則；在純 Prometheus 上，請加入一條運算式恆為真的警示規則（`vector(1)`）。

再建立 **第二個** 傳入請求監控器，以較短的 `repeat_interval` 把 `Watchdog` 路由到它，並為該監控器設定 **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** 條件。這是「請求遺失」條件唯一適合放在警示接收端的情況。

以下是步驟 2 的設定，並併入了 watchdog 的路由與接收器——子路由會在父路由自身的接收器之前被比對，因此 `Watchdog` 會走向第二個監控器，其餘仍然進入第一個：

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## 疑難排解

- **什麼都沒收到** —— 確認 Alertmanager 能連到該 URL；檢查它的記錄檔有無投遞錯誤。OneUptime 會在驗證任何內容之前就以空的 `200` 回應每個請求，因此 `200` 並不能確認酬載已被接受。請改看監控器的時間軸。
- **事件會開啟但從不關閉** —— 檢查 Alertmanager 中的 `send_resolved: true`、條件中的復原欄位與值（比較區分大小寫），以及事件 **Advanced Options** 下的 **Auto Resolve Incident**。還有兩個更隱微的原因：當酬載中不同鍵的數量超過 **Max incidents per request** 時，超出上限的鍵對復原同樣看不見；另外，如果被入口合併（見下）丟棄的正好是 `resolved` 通知，該事件就會被永久擱置，因為 Alertmanager 會重送觸發通知，卻不會重送已解決的通知。這些只能手動關閉。
- **完全沒有事件，監控器狀態也沒變** —— 分組路徑必須以字面的 `requestBody.` 開頭，而且路徑中只有第一個 `[*]` 是萬用字元。這兩個錯誤都會靜默失敗。
- **事件文字中出現原始的 `{{...}}` 佔位符** —— 路徑沒有解析成功，而 OneUptime 會原樣保留未解析的佔位符，而不是清空它們。不同規則設定的註解不同，因此請引用你的規則中確實存在的欄位（`commonAnnotations` 或每則警示各自的 `annotations`）。
- **一份滿是警示的酬載只產生一個事件** —— 你以一個在通知內部不會變化的標籤分組，最常見的是同時出現在路由 `group_by` 中的那個標籤。請改以 `requestBody.alerts[*].fingerprint` 分組。
- **事件太多** —— 放寬 `group_by` / `group_interval`，讓 Alertmanager 把相關警示併批。調低 **Max incidents per request** 可以限制數量，但也會讓超出上限的鍵對復原看不見。
- **在大量突發時似乎有些通知被略過** —— 送往同一個監控器的請求會在入口處合併，以免單一發送端壓垮監控器，因此當通知接連抵達時可能會丟掉中間的某份酬載。加大 `group_wait` 與 `group_interval` 可以把它們拉開。合併由應用程式容器的環境變數 `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` 控制，預設為開啟；需要每份酬載都被評估的自架維運人員，可以在該容器上將它設為 `false`。

## 接下來閱讀什麼

- [傳入請求監控器](/docs/monitor/incoming-request-monitor) —— 這種監控器類型、它的條件，以及完整的事件分組說明。
- [整合總覽](/docs/integrations/index) —— 入站與出站模式。
- [Grafana](/docs/integrations/grafana) —— 同樣的概念，用於 Grafana 警示。
- [Webhook 觸發器](/docs/workflows/triggers#webhook) —— 工作流程接收 URL 的運作方式。
