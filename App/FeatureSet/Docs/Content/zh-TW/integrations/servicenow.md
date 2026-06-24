# ServiceNow 整合

每當建立 OneUptime 事件時，自動開啟一則 [ServiceNow](https://www.servicenow.com) 事件——讓 ITSM 與監控保持同步。

此整合為**對外（outbound）**：OneUptime 會呼叫 ServiceNow 的 [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html)。它使用一個帶有 **Incident → On Create** 觸發器與 **API 元件**的 OneUptime **[Workflow](/docs/workflows/index)**。

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## 先決條件

- 一個 ServiceNow 執行個體（`https://your-instance.service-now.com`）。
- 一個具有 `rest_api_explorer` / `itil` 角色（或足以建立 `incident` 記錄之權限）的 ServiceNow 使用者。使用此使用者憑證的基本驗證（Basic auth）是最簡單的起步方式；正式環境建議使用 OAuth。
- 一個你可以建立 workflow 的 OneUptime 專案。

## 步驟 1 — 將憑證儲存為密鑰

ServiceNow 的 Table API 接受**基本驗證（Basic auth）**。

1. 將 `username:password` 進行一次 Base64 編碼：

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**，將其命名為 `SERVICENOW_AUTH`，貼上該 base64 字串，並開啟 **Is Secret**。

## 步驟 2 — 建立 workflow

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Incidents → ServiceNow`，然後開啟 **Builder**。
2. 加入一個設定為 **On Create** 的 **Incident** 觸發器。將其重新命名為 `Incident`。
3. 加入一個連接至觸發器的 **API** 區塊：

   - **Method**：`POST`
   - **URL**：`https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**：

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**：

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` 會保留回連至 OneUptime 事件的連結——如果你之後要加入解決步驟會很方便。ServiceNow 的 `urgency`/`impact` 使用 `1`（高）、`2`（中）、`3`（低）。

4. **Save**、啟用，並建立一則測試事件。workflow 記錄中的 `201 Created` 回應會傳回新記錄的 `sys_id` 與 `number`（例如 `INC0012345`）。

## 步驟 3 — 在 OneUptime 解決時一併解決（選用）

1. 建立**第二個** workflow，帶有 **Incident → On Update** 觸發器，以及一個檢查事件是否已解決的 **Conditions** 區塊。
2. 若要更新正確的 ServiceNow 記錄，你需要其 `sys_id`。你可以在步驟 2 中將其儲存於 OneUptime 事件上（讀取 `{{CreateRecord.response-body.result.sys_id}}` 並透過 **Update Incident** 將其寫入標籤），或先以對 `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}` 的 `GET` 查詢來尋找該記錄。
3. 加入一個 **API** 區塊：**Method** `PATCH`、**URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`、body `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }`（`state` `6` = 在預設 ITIL workflow 中代表 Resolved）。

## 疑難排解

- **`401`** — 使用 `printf`（而非會加上換行字元的 `echo`）重新編碼 `username:password`，並更新 `SERVICENOW_AUTH`。
- **`403`** — 該使用者缺少寫入 `incident` 表的權限；加上 `itil` 角色。
- **`400`** — 針對你執行個體的自訂設定，某個欄位名稱或值有誤。請於 **System Definition → Tables → incident** 中檢查欄位名稱。
- **執行個體拒絕該呼叫** — 有些執行個體會限制 Table API；請確認 REST 已啟用，且你的 IP 未被 ACL 封鎖。

## 接下來閱讀

- [Integrations Overview](/docs/integrations/index) — 模式與驗證速查表。
- [Jira](/docs/integrations/jira) — 適用於 Jira 的相同對外模式。
- [API component](/docs/workflows/components#api) — 讀取回應主體。
