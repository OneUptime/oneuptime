# Zabbix 整合

[Zabbix](https://www.zabbix.com) 監看您的伺服器與網路；OneUptime 負責執行您的事件應變、待命排班與狀態頁。將兩者連接起來，每個 Zabbix 問題都會自動成為一個 OneUptime 事件——讓對的人收到呼叫，並讓您的狀態頁保持真實。

此整合為**入站（inbound）**：Zabbix 將問題傳送至 OneUptime。它一端使用 Zabbix 的 **webhook 媒體類型（media type）**，另一端使用 OneUptime 的 **[Workflow](/docs/workflows/index)**。不需要外掛、不需要額外服務。

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## 運作方式

1. 某個 Zabbix trigger 變更為 **PROBLEM**。
2. 一個 Zabbix **action** 告知 **OneUptime** 媒體類型傳送該事件。
3. 媒體類型的腳本將一個小型的 JSON 酬載 POST 至某個 OneUptime workflow URL。
4. 該 workflow 讀取酬載並建立一個事件（並可選擇性地在 Zabbix 復原時將其解決）。

## 先決條件

- 一台由您管理的 Zabbix 伺服器（本指南是針對 **Zabbix 6.0 LTS / 7.0 LTS** 撰寫；webhook 媒體類型在 5.0+ 上的運作方式相同）。
- 您的 Zabbix 伺服器必須能透過 HTTPS 連接到您的 OneUptime 執行個體。
- 一個您可以建立 workflow 的 OneUptime 專案。

## 第 1 部分 — 建置 OneUptime workflow

請先做這件事，因為您會需要它所產生的 webhook URL。

1. 開啟 **Workflows → Create Workflow**。將它命名為 `Zabbix → Incidents` 並開啟 **Builder** 分頁。
2. 將一個 **Webhook** trigger 拖曳至畫布上。點擊它並**複製它顯示的唯一 URL**。請妥善保管——任何擁有它的人都能啟動此 workflow。將該區塊重新命名為 `Zabbix`，這樣變數讀起來會比較順。
3. 將一個 **Conditions** 區塊拖曳至畫布上，並將 trigger 的輸出連接至它。進行設定：
   - **Left value**：`{{Zabbix.Request Body.status}}`
   - **Operator**：`==`
   - **Right value**：`1` _（Zabbix 在發生問題時傳送 `1`，復原時傳送 `0`）_
4. 將一個 **Create Incident** 區塊拖曳進來，並將它連接至 Conditions 區塊的 **Yes** 輸出。填入：
   - **Title**：`Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**：`Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**：挑選您想要的 OneUptime 事件嚴重性（您稍後可以透過更多 Conditions 分支來細化此設定，將 Zabbix 嚴重性對應過來）。
5. 儲存。目前先讓 **Enabled** _保持關閉_——您會在測試之後再將它開啟。

> **提示：** 將 Zabbix 的 `event_id` 放入描述（或事件標籤）中，可讓您稍後想要在復原時自動解決事件時，再次找到此事件。請參閱 [自動解決](#resolving-automatically-optional)。

## 第 2 部分 — 設定 Zabbix

### 步驟 1：建立 OneUptime 媒體類型

1. 在 Zabbix 中，前往 **Alerts → Media types**（在較舊版本中：**Administration → Media types**）。
2. 點擊 **Create media type** 並將 **Type** 設為 **Webhook**。
3. **Name**：`OneUptime`。
4. 新增這些 **Parameters**（每一項都點擊 _Add_）。這些會將 Zabbix [macros](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location) 對應成一個乾淨的酬載：

   | Name             | Value              |
   | ---------------- | ------------------ |
   | `url`            | `{ALERT.SENDTO}`   |
   | `event_id`       | `{EVENT.ID}`       |
   | `event_name`     | `{EVENT.NAME}`     |
   | `event_value`    | `{EVENT.VALUE}`    |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host`           | `{HOST.NAME}`      |
   | `event_date`     | `{EVENT.DATE}`     |
   | `event_time`     | `{EVENT.TIME}`     |

5. 將這段內容貼至 **Script** 欄位：

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader("Content-Type: application/json");

   var payload = {
     source: "zabbix",
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time,
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw (
       "OneUptime responded with HTTP " + request.getStatus() + ": " + response
     );
   }

   return "OK";
   ```

6. 點擊 **Message templates** 分頁，並為 **Problem** 與 **Problem recovery** 各新增一個範本（內文可以留空——酬載是在腳本中建構的）。這是讓 Zabbix 針對那些事件類型使用此媒體類型所必需的。
7. **Add** 以儲存此媒體類型。

### 步驟 2：建立一個承載此 webhook 的使用者

Zabbix 是將通知傳送*給某個使用者*。建立一個專用的使用者，這樣此整合會比較容易找到與停用。

1. 前往 **Users → Users → Create user**。將它命名為 `OneUptime Webhook`，給它一個可以接收通知的角色（例如 **User role**），並將它加入某個使用者群組。
2. 在 **Media** 分頁中，點擊 **Add**：
   - **Type**：`OneUptime`
   - **Send to**：貼上您在第 1 部分複製的 **workflow webhook URL**。
   - **When active** / 嚴重性：保留預設值（或限制為您所在意的那些嚴重性）。
3. **Add** 然後 **Update**。

### 步驟 3：透過 action 將問題傳送至 OneUptime

1. 前往 **Alerts → Actions → Trigger actions → Create action**。
2. **Name**：`Notify OneUptime`。
3. **Conditions**（選用）：縮小範圍——例如 _Trigger severity >= Warning_。留空則傳送所有內容。
4. 在 **Operations** 分頁中，新增一個透過 **OneUptime** 媒體類型傳送至 **User: OneUptime Webhook** 的 operation。
5. 若要在稍後於復原時解決事件，也請在 **Recovery operations** 中以相同的使用者／媒體填入。
6. **Add** 以儲存，並確認此 action 為 **Enabled**。

## 第 3 部分 — 測試它

1. 回到 OneUptime workflow，將 **Enabled** 開啟。
2. 在 Zabbix 中，觸發一個測試問題——例如，暫時調低某個 trigger 閾值，或使用一個會翻轉至問題狀態的測試項目。
3. 開啟您 workflow 的 **Logs** 分頁。您應該會看到一次執行，其中包含 Zabbix 酬載、Conditions 區塊走 **Yes** 路徑，以及該事件被建立。
4. 在 OneUptime 中查看 **Incidents**——您的 Zabbix 問題現在已成為一個事件。

如果什麼都沒收到，請參閱 [疑難排解](#troubleshooting)。

## 自動解決（選用）

上述的核心 workflow 會*開啟*事件。若要在 Zabbix 復原時也*關閉*它們：

1. 確認您的 Zabbix action 已設定 **Recovery operations**（上述步驟 3），這樣復原事件也會被傳送。在復原時，`status` 會以 `0` 抵達。
2. 在 workflow 中，新增第二個 **Conditions** 分支：左值 `{{Zabbix.Request Body.status}}`、運算子 `==`、右值 `0`。
3. 從它的 **Yes** 輸出，新增一個 **Find Incident** 區塊，用來查找您先前建立的那個開啟中的事件——以您儲存在描述或標籤中的 Zabbix `event_id` 進行比對。
4. 將它連接至一個 **Update Incident** 區塊，並將該事件移至您的*已解決*狀態。

由於解決方式取決於您在專案中如何建模事件狀態，請將 **create** 路徑保持為可靠的核心，並在您確認事件正確流動後，再疊上解決路徑。請參閱 [Components → OneUptime data components](/docs/workflows/components#oneuptime-data-components)。

## 對應 Zabbix 嚴重性（選用）

Zabbix 嚴重性（`Not classified`、`Information`、`Warning`、`Average`、`High`、`Disaster`）會以 `{{Zabbix.Request Body.severity}}` 抵達。若要將它們對應至 OneUptime 事件嚴重性，請在 **Create Incident** 之前新增 **Conditions** 分支——例如，將 `Disaster` 與 `High` 導向「Critical」事件，並將其餘所有內容導向「Major」。每個分支建置一個 **Create Incident** 區塊。

## 疑難排解

**Workflow 從未執行。**

- 確認 workflow 的 **Enabled** 開關已開啟。
- 從 Zabbix 伺服器，確認它可以連接到該 URL：`curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`。您應該會很快收到一個確認回應。
- 在 Zabbix 中查看 **Reports → Action log** 是否有傳遞錯誤。

**Zabbix 回報腳本錯誤。**

- 開啟該媒體類型並使用 **Test** 來傳送一個範例酬載。Zabbix 會顯示該腳本的輸出或所拋出的錯誤。
- 來自 OneUptime 的非 2xx 回應會由腳本中的 `throw` 呈現出來——請檢查 workflow URL 是否完全正確。

**事件已建立，但欄位是空的。**

- 開啟 workflow 的 **Logs** 分頁並檢查 trigger 輸出。確認 **Request Body** 下的欄位名稱與您所參照的相符（`name`、`host`、`severity`、`status`、`event_id`）。
- 缺漏的欄位會解析為空字串，而非錯誤——請參閱 [Variables → Gotchas](/docs/workflows/variables#gotchas)。

**所有事情都觸發了兩次。**

- 您可能同時有一個問題 operation 與一個升級步驟傳送至相同的媒體。請檢查該 action 的 **Operations** 步驟。

## 安全性注意事項

- 將 workflow webhook URL 視為密碼一般對待。如果它外洩，請刪除該 trigger 並建立一個新的，以輪換此 URL。
- 限制 Zabbix action 的條件，這樣您只會轉送值得建立事件的那些嚴重性。
- 如果您在防火牆後方自架運行 OneUptime，請允許您 Zabbix 伺服器的出口 IP 透過 HTTPS 連接到它。

## 接下來閱讀

- [Integrations Overview](/docs/integrations/index) — 入站／出站模式。
- [Webhook trigger](/docs/workflows/triggers#webhook) — 接收 URL 的運作方式。
- [Components](/docs/workflows/components) — Conditions、Create Incident 等等。
- [Variables](/docs/workflows/variables) — 在後續區塊中讀取 Zabbix 酬載。
