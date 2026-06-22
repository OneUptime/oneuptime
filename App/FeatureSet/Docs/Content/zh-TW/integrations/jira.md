# Jira 整合

每當 OneUptime 建立事件時，自動開啟一張 [Jira](https://www.atlassian.com/software/jira) issue — 讓工程工作得以在您的開發人員已習慣使用的地方被追蹤，並附帶一個連回該事件的連結。

此整合屬於**對外（outbound）**：由 OneUptime 呼叫 Jira 的 REST API。它使用一個 OneUptime **[Workflow](/docs/workflows/index)**，搭配 **Incident → On Create** 觸發器與一個 **API component**。您也可以選擇性地加入一條**對內（inbound）**路徑，讓關閉 Jira issue 時一併解決 OneUptime 事件。

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## 先決條件

- 一個 Jira Cloud 站台（`https://your-domain.atlassian.net`）以及一個用來建立 issue 的專案 — 記下它的**專案金鑰（project key）**（例如 `OPS`）。
- 一個能夠建立 issue 的 Jira 帳號，以及該帳號於 [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) 取得的 **API token**。
- 一個您可以在其中建立 workflow 的 OneUptime 專案。

> 使用 **Jira Data Center / Server**（自行管理）嗎？流程完全相同 — 改用您自己的基底 URL，並以 `Bearer` 認證標頭搭配 [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) 來取代 Basic auth。`/rest/api/2/issue` 端點接受純文字描述，使得樣板化更為簡單。

## 步驟 1 — 將您的 Jira 憑證儲存為密鑰

Jira Cloud 使用 **Basic auth**，以您的電子郵件與 API token 進行 base64 編碼。

1. 將 `email:api_token` 進行一次 base64 編碼。在 macOS/Linux 上：

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. 在 OneUptime 中，前往 **Workflows → Global Variables → Create**。
3. 將它命名為 `JIRA_AUTH`，把 base64 字串貼上作為其值，並開啟 **Is Secret**。

現在您可以將 `Basic {{variable.JIRA_AUTH}}` 用作認證標頭，而 token 永遠不會出現在 workflow 或其日誌中。

## 步驟 2 — 建立 workflow

1. 開啟 **Workflows → Create Workflow**，將它命名為 `Incidents → Jira`，並開啟 **Builder**。
2. 將一個 **Incident** 觸發器拖曳到畫布上，並選擇 **On Create** 事件。將它重新命名為 `Incident`。
3. 拖曳一個 **API** 區塊並將觸發器連接到它。進行如下設定：

   - **Method**：`POST`
   - **URL**：`https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**：

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body**（Jira Cloud v3 的描述使用 Atlassian Document Format）：

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   將 `OPS` 替換為您的專案金鑰，並將 `Bug` 替換為該專案中存在的 issue 類型。

4. **儲存。** 在您測試完成之前，請讓 workflow 維持停用狀態。

## 步驟 3 — 測試

1. 將 workflow 開啟為 **Enabled**。
2. 在 OneUptime 中建立一個測試事件（或從某個 monitor 觸發一個）。
3. 開啟 workflow 的 **Logs** 分頁。**API** 區塊應顯示 `201` 狀態，以及一個包含新 issue 之 `key`（例如 `OPS-1234`）的回應主體。
4. 檢查 Jira — issue 就在那裡。

如果 API 區塊回傳錯誤，請在日誌中將它展開 — Jira 的回應會精確說明它拒絕了哪個欄位。請參閱 [疑難排解](#troubleshooting)。

## 步驟 4 — 將事件連回該 issue（建議）

將 Jira issue key 儲存在事件上會很有用，這樣人員就能在兩者之間來回跳轉。

- API 區塊的回應可透過 `{{CreateIssue.response-body.key}}` 取得（前提是您將該區塊命名為 `CreateIssue`）。
- 在其後加入一個 **Update Incident** 區塊，並將該 key 寫入事件的標籤、自訂欄位或備註中。

這也讓下方的選用雙向同步成為可能。

## 雙向同步（選用）

若要在有人關閉 Jira issue 時解決 OneUptime 事件，請加入一條**對內（inbound）** workflow：

1. 建立第二個 workflow，以 **Webhook** 觸發器開始，並複製其 URL。
2. 在 Jira 中，前往 **Project settings → Automation → Create rule**：

   - **Trigger**：_Issue transitioned_ 至 **Done**（或 _Issue resolved_）。
   - **Action**：_Send web request_ → method `POST`、URL = 您的 workflow webhook URL、主體包含 issue key 與 OneUptime 事件 id，例如：

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. 在 workflow 中，使用一個 **Find Incident** 區塊以儲存的 key 找出該事件，接著使用一個 **Update Incident** 區塊將它移至您的已解決狀態。

如果您在步驟 4 中已將 Jira key 儲存在事件上，比對就很直接。請參閱 [Components → OneUptime data components](/docs/workflows/components#oneuptime-data-components)。

## 自訂 issue

針對 API 區塊主體的幾項常見調整：

- **Priority** — 在 `fields` 內加入 `"priority": { "name": "High" }`。您可以使用 **Conditions** 針對 `{{Incident.incidentSeverity.name}}` 進行分支，以將 OneUptime 的嚴重程度對應到 Jira 的優先順序。
- **Labels** — 加入 `"labels": ["oneuptime", "incident"]`。
- **Assignee** — 加入 `"assignee": { "id": "<accountId>" }`（Jira Cloud 使用 account ID，而非使用者名稱）。
- **自訂欄位（Custom fields）** — 使用來自您 Jira 管理員的欄位 ID，加入 `"customfield_XXXXX": "..."`。

若要探查某個專案所預期的確切欄位名稱，請從您的瀏覽器或 `curl` 呼叫一次 Jira 的 `GET /rest/api/3/issue/createmeta` 端點。

## 疑難排解

**`401 Unauthorized`。**

- 重新編碼 `email:api_token` 並更新 `JIRA_AUTH` 變數。結尾的換行字元通常是元兇 — 編碼時請使用 `printf`（而非 `echo`）。
- 確認擁有該 API token 的帳號能夠在該專案中建立 issue。

**`400 Bad Request` 並提及某個欄位。**

- issue 類型或某個必填欄位有誤。請檢查該專案的 **issue type** 名稱，以及它是否有必填的自訂欄位。使用 `createmeta`（如上）查看哪些是必填的。

**`404 Not Found`。**

- 再次確認基底 URL，以及您是否打到 `/rest/api/3/issue`（Cloud）或 `/rest/api/2/issue`（Server/Data Center）。

**描述顯示為單一行／看起來怪怪的。**

- v3 需要上方所示的 Atlassian Document Format。如果您寧可傳送純文字，請使用 `/rest/api/2/issue` 端點，並以 `"description": "{{Incident.description}}"` 作為純字串。

## 接下來閱讀的內容

- [Integrations Overview](/docs/integrations/index) — 對內／對外模式與認證速查表。
- [API component](/docs/workflows/components#api) — method、headers，以及讀取回應。
- [Variables](/docs/workflows/variables) — 密鑰與事件欄位。
- [PagerDuty](/docs/integrations/pagerduty) 與 [ServiceNow](/docs/integrations/servicenow) — 用於其他工具的相同對外模式。
