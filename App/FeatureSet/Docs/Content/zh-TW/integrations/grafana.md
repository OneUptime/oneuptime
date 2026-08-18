# Grafana 整合

把 [Grafana](https://grafana.com) 的警示轉成 OneUptime 事件。Grafana 評估你儀表板上的警示規則；OneUptime 負責記錄、升級與追蹤。

這項整合是 **入站** 的：Grafana 的 **Webhook 聯絡點** 會對 OneUptime 送出 POST。接收方式有兩種。

| 做法                                                                 | 適用時機                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **[傳入請求監控器](/docs/monitor/incoming-request-monitor)**（建議） | 你希望警示變成帶待命升級的事件，每則警示一個事件，並在復原時自動解決。        |
| **[工作流程](/docs/workflows/index) 搭配 Webhook 觸發器**            | 你需要 OneUptime 原生不支援的路由邏輯——呼叫其他系統、重新塑形酬載、條件分支。 |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafana 的 webhook 酬載遵循 Alertmanager 的格式——`status`、一個 `alerts` 陣列、`commonLabels` 與 `commonAnnotations`，以及方便使用的頂層 `title` 與 `message` 欄位。

## 先決條件

- 啟用了 [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) 的 Grafana 9 以上（現代 Grafana 的預設值）。
- Grafana 必須能透過 HTTPS 連到你的 OneUptime 執行個體。
- 一個你可以建立監控器（或工作流程）的 OneUptime 專案。

## 選項 1 —— 傳入請求監控器

1. 前往 **監控器 → 建立監控器**，選擇 **傳入請求**。開啟它，點擊左側選單中的 **Documentation** 以複製 URL。
2. 開啟監控器的 **Criteria**，把 **Filter Type** 設為 `JavaScript Expression`，**Value** 設為 `"{{requestBody.status}}" === "firing"`。
3. 相符時建立事件，選擇要呼叫的 **On-Call Policies**，並在 **Advanced Options** 下開啟 **Auto Resolve Incident**。
4. 在 **Settings** 下開啟 **Group incidents and alerts by a payload field**，並設定：

   | 欄位                               | 值                                  |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. 把事件標題設為 `{{requestBody.commonLabels.alertname}}`，描述使用 `{{requestBody.message}}` 或 `{{requestBody.commonAnnotations.summary}}`。（`{{fingerprint}}` 存放的是分組鍵本身，但它是一個雜湊——不適合呈現給處理人員。）
6. 把 Grafana 聯絡點指向該監控器的 URL（請見下方的聯絡點設定步驟）。

每個 **不同的** 分組值都會成為各自的事件，並在 Grafana 回報它已解決時分別關閉。Grafana 每則警示的 `fingerprint` 對於警示的標籤集是唯一的，這正是上面把它當作分組路徑的原因。[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) 頁面對同樣的設定有更詳細的說明——酬載格式相同，因此那裡的每個步驟在這裡同樣適用。

> **Warning:** 不要以在整份通知中固定不變的標籤分組。Grafana 預設的通知政策以 `grafana_folder` 與 `alertname` 分組，因此同一個 webhook 中的每則警示都共用相同的 alertname——以 `requestBody.alerts[*].labels.alertname` 分組會把整份酬載塌縮成一個事件。此外，分組路徑必須以字面的 `requestBody.` 開頭，而且路徑中只有第一個 `[*]` 是萬用字元。以上這些錯誤全都會靜默失敗。

## 選項 2 —— 工作流程

當你需要超出「警示變成事件」的邏輯時，請使用這個做法。

### 步驟 1 —— 建立 OneUptime 工作流程

1. 開啟 **工作流程 → 建立工作流程**，將其命名為 `Grafana → Incidents`，然後開啟 **建構器**。
2. 新增一個 **Webhook** 觸發器並**複製其 URL**。將該區塊重新命名為 `Grafana`。
3. 新增一個連接到觸發器的 **Conditions** 區塊：
   - **Left**：`{{Grafana.Request Body.status}}`
   - **Operator**：`==`
   - **Right**：`firing`
4. 從 **Yes** 新增一個 **Create Incident** 區塊：
   - **標題**：`{{Grafana.Request Body.title}}`
   - **描述**：`{{Grafana.Request Body.message}}`
   - **嚴重程度**：選擇其中一個（或依 `{{Grafana.Request Body.commonLabels.severity}}` 進行分支）。
5. **儲存**（在測試之前保持停用狀態）。

## 設定 Grafana 聯絡點

1. 在 Grafana 中前往 **Alerting → Contact points → Add contact point**。
2. **Name**：`OneUptime`。**Integration**：**Webhook**。
3. **URL**：貼上選項 1 的監控器 URL，或選項 2 中工作流程的 webhook URL。**HTTP Method**：`POST`。
4. 儲存該聯絡點。
5. 前往 **Alerting → Notification policies**，把你想要的警示（或預設政策）路由到 **OneUptime** 聯絡點。

## 測試

1. 如果你建立了工作流程，請先啟用它。
2. 在聯絡點畫面用 **Test** 送出一則範例通知，或等待真實的警示規則觸發。
3. 查看你的 **事件** 清單——若你使用了選項 2，也可查看工作流程的 **記錄檔** 分頁。

## 復原時解決

當警示解除時，Grafana 會再送出一則帶有 `status: resolved` 的通知。

在 **選項 1** 中，上面設定的復原欄位與值會自動關閉對應的事件——前提是 **Auto Resolve Incident** 已開啟。

在 **選項 2** 中，請加入第二條 **Conditions** 分支（`status == resolved`），找出對應的事件，並用 **Update Incident** 將它移到你的已解決狀態。

## 說明

- **舊版警示（Grafana 8 以前）** 送出的酬載不同（`ruleName`、`state`、`evalMatches`）。如果你在使用舊版警示，請改為引用 `{{Grafana.Request Body.ruleName}}` 與 `{{Grafana.Request Body.state}}`，並依 `state == alerting` 分支。
- 你也可以完全略過 Grafana 的警示功能，讓 OneUptime 直接監控同樣的指標——請見 [指標監控](/docs/monitor/metrics-monitor)。

## 疑難排解

- **什麼都沒收到** —— 確認 Grafana 能連到該 URL（檢查 Grafana 的伺服器記錄檔），若使用選項 2 還要確認工作流程處於 **已啟用** 狀態。OneUptime 會在驗證之前就以空的 `200` 回應每個傳入請求，因此 Grafana 記錄檔中的 `200` 並不能確認酬載已被接受。
- **事件會開啟但從不關閉** —— 檢查條件中的復原欄位與值，以及事件 **Advanced Options** 下的 **Auto Resolve Incident** 是否開啟。比較區分大小寫。
- **一份滿是警示的酬載只產生一個事件** —— 你以一個在通知內部不會變化的標籤分組。請改以 `requestBody.alerts[*].fingerprint` 分組。
- **事件文字中出現原始的 `{{...}}` 佔位符** —— 路徑沒有解析成功，未解析的佔位符會被原樣保留而非清空。請引用你所用警示版本中確實存在的欄位；若使用了選項 2，可在 **記錄檔** 分頁檢視觸發器的輸出。

## 接下來閱讀什麼

- [傳入請求監控器](/docs/monitor/incoming-request-monitor) —— 這種監控器類型、它的條件，以及完整的事件分組說明。
- [整合總覽](/docs/integrations/index) —— 入站模式。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) —— 高度相關的酬載。
- [指標監控](/docs/monitor/metrics-monitor) —— 在 OneUptime 中直接監控指標。
