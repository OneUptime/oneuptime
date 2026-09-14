# Microsoft Dynamics 365 整合

每當 OneUptime 宣告一個事件時，就在 [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) 中開立一筆 **Case**，隨著事件的變動讓那筆 case 保持同步，並讓 Dynamics 把 case 的變更推回 OneUptime——這一切都用一個 [Workflow](/docs/workflows/index) 完成。沒有任何 Dynamics 專屬的區塊需要安裝：OneUptime 以 [API 元件](/docs/workflows/components#api) 與 **Dataverse Web API** 對話，而 Dynamics 則透過一個 [Webhook 觸發器](/docs/workflows/triggers#webhook) 回話。

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

本頁涵蓋兩個方向。請先建出站的那一半——它是需要 Microsoft Entra ID 設定的那一半，而一旦它能運作，入站那一半就只是一條 flow 的事。

## 先決條件

- 一個包含 **Case** 資料表的 **Dynamics 365** 環境。Case 來自 Dynamics 365 Customer Service；沒有它的 Dataverse 環境就沒有可寫入的 `incident` 資料表。
- 該環境的 **Web API endpoint**。您可以在 [Power Platform admin center](https://admin.powerplatform.microsoft.com/) 中您環境的 **Settings → Developer resources** 底下找到它，或在 **make.powerapps.com → Settings → Developer resources** 中找到。它看起來像 `https://yourorg.crm.dynamics.com/api/data/v9.2/`——區域片段會有所不同（北美是 `crm`、南美是 `crm2`、日本是 `crm7`，依此類推）。
- 在 **Microsoft Entra ID** 中註冊應用程式、以及在 Dynamics 環境中建立**應用程式使用者（application user）**的權限。這通常是兩位不同的管理員。
- 一個您可以建立工作流程與全域變數的 OneUptime 專案。

> 以下全部使用 Dataverse 的資料表名稱，而不是 Dynamics 表單上的標籤。一筆 case 就是 **`incident`** 資料表，它在 URL 中的集合名稱是 **`incidents`**，主索引鍵是 **`incidentid`**，而標題欄位是 **`title`**。您在 UI 中看到的 case 編號則是 **`ticketnumber`**。

## 步驟 1 — 在 Microsoft Entra ID 中註冊一個應用程式

OneUptime 是以應用程式而非個人的身分驗證，所以它使用 OAuth 2.0 的 **client credentials** 流程。

1. 以與您 Dynamics 環境同一租戶的管理員身分登入 [Azure portal](https://portal.azure.com)，並開啟 **Microsoft Entra ID**。
2. 前往 **App registrations → New registration**。給它一個名稱，例如 `OneUptime Integration`，讓 **Supported account types** 維持在 **Accounts in this organizational directory only**，然後選擇 **Register**。
3. 從該應用程式的 **Overview** 頁面複製 **Application (client) ID** 與 **Directory (tenant) ID**。
4. 前往 **Certificates & secrets → Client secrets → New client secret**。在離開頁面之前，複製該 secret 的 **Value**——不是它的 ID。它不會再顯示第二次。一組 client secret 最多只能存活 24 個月，所以請把到期時間記在您看得到的地方。

有兩件事是大家會在這裡加上、但您並不需要的：

- **不需要 API permissions。** 在 client credentials 流程中沒有登入中的使用者，所以委派權限（delegated permissions）什麼作用也沒有。**Dataverse** 底下的 `user_impersonation` 是委派權限，只適用於互動式應用程式。就算完全沒有設定任何權限，Microsoft Entra ID 一樣會為 Dataverse 發出權杖——存取權是在 Dynamics 那一側決定的，也就是步驟 2。
- **不需要管理員同意（admin consent）步驟。** 理由相同。

對於正式環境的應用程式，Microsoft 偏好憑證而非 client secret。那個選項需要呼叫端自行建構並簽署一個 JWT assertion，而工作流程做不到，所以 client secret 才是這裡實際可行的選擇——請據此對待它：把它放在祕密變數中，並在它到期之前輪替。

## 步驟 2 — 在 Dynamics 中建立應用程式使用者

這是最常被略過的一步，而略過它會造成整個整合中最令人困惑的失敗：權杖請求成功了，接著每一個 Dataverse 呼叫都以 `403 Forbidden` 和錯誤代碼 `0x80072560` 失敗——*「The user isn't a member of the organization.」*。Entra ID 在完全不知道 Dynamics 的情況下發出權杖；Dynamics 接著去找一列與該應用程式相符的使用者資料，卻找不到。

1. 開啟 [Power Platform admin center](https://admin.powerplatform.microsoft.com/)，選擇 **Manage → Environments**，然後選您的環境。
2. 選擇 **Settings → Users + permissions → Application users**。
3. 選擇 **+ New app user**，接著 **+ Add an app**，選擇步驟 1 的那個註冊，然後選擇 **Add**。
4. 挑一個 **Business unit**，輸入一個 **Email address**，然後使用 **Security roles** 旁邊的編輯圖示。
5. 指派一個對 **Case** 資料表具有建立、讀取與寫入權限的**自訂**安全性角色。應用程式使用者不能被指派內建角色——Microsoft 要求使用自訂角色。如果您沒有合適的角色，請複製一個現有角色再把它精簡。
6. 選擇 **Save**，然後 **Create**。

在一個環境中，每個已註冊的應用程式只能有一個應用程式使用者。應用程式使用者不需授權，也不受該環境安全性群組成員資格規則的約束。

## 步驟 3 — 將憑證儲存在 OneUptime 中

前往 **工作流程 → 全域變數 → 建立**，加入以下這些，並為標示的項目開啟 **Secret**：

| 名稱                     | 值                                                          | 祕密 |
| ------------------------ | ----------------------------------------------------------- | ------ |
| `DYNAMICS_TENANT_ID`     | 步驟 1 的 Directory (tenant) ID                             | 否     |
| `DYNAMICS_CLIENT_ID`     | 步驟 1 的 Application (client) ID                           | 否     |
| `DYNAMICS_CLIENT_SECRET` | 步驟 1 的 client secret **Value**                           | 是     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com`——結尾不要有斜線          | 否     |

請完全照 Entra ID 給您的樣子貼上 client secret。OneUptime 會為您編碼表單主體，所以不要自己動手做 URL 編碼。

在區塊中以 `{{global.variables.DYNAMICS_CLIENT_ID}}` 引用其中任何一個。關於祕密如何從執行記錄檔中被清除，請參閱 [Variables](/docs/workflows/variables)。

## 步驟 4 — 取得存取權杖

每一次執行都會自己取得權杖。權杖有效 60–90 分鐘，而 client credentials 流程從不發出更新權杖（refresh token），所以沒有東西要快取、也沒有東西要續期——每次執行多一個 HTTP 呼叫就是全部的成本。

1. 開啟 **工作流程 → 建立工作流程**，把它命名為 `Incidents → Dynamics 365`，然後開啟 **建構器**。
2. 點擊虛線的預留位置，加入 **On Create Incident** 觸發器，並在它的 **Select Fields** 中指定您想送出的欄位：

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   請將它的 **Identifier** 維持為 `incident-on-create-1`。

3. 點擊 **Add Component**，加入一個 **API Post (JSON)** 區塊，把觸發器的 **Success** 圓點連到它，然後打開它的設定。將它的 **Identifier** 設為 `get-token`，接著：

   - **URL**：`https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**：

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**：

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**請把標頭名稱打成 `Content-Type`，大小寫要完全一致。** 正是它告訴 OneUptime 要把主體以表單 POST 而非 JSON 的方式送出，而那是 Microsoft 權杖端點唯一接受的形狀。小寫的 `content-type` 不會相符，於是請求會以 JSON 送出，然後回來一個 `400`。

`scope` 必須是您的環境 URL 後面接 `/.default`——那是機密用戶端（confidential client）的形式。這裡填錯環境 URL，是造成 `AADSTS70011: The provided value for the input parameter 'scope' is not valid` 的常見原因。

該權杖現在可在下游以此方式取得：

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## 步驟 5 — 建立 case

加入第二個 **API Post (JSON)** 區塊，把 `get-token` 的 **Success** 圓點連到它，並把它的 **Identifier** 設為 `create-case`。

- **URL**：`{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**：

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**：

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

請把那個 account GUID 換成這些 case 所屬的 account。**`customerid` 在 case 上是真的必填**——它是 Dataverse 對任何程式化寫入都會強制要求的欄位之一，所以少了它的建立請求會被拒絕。因為它可以指向 account 或 contact，所以您永遠不會寫 `customerid@odata.bind`；您要寫 `customerid_account@odata.bind` 或 `customerid_contact@odata.bind`，而且這些名稱區分大小寫。`title` 則是另一種必填：Dynamics 的表單堅持要有它，API 不要求，但還是請把它送出去。

`Prefer: return=representation` 是讓這一切在工作流程中可用的關鍵。少了它，成功的建立請求會回應 `204 No Content`，並把新記錄的 URI 放在 `OData-EntityId` 回應標頭中，接著您就得從裡面挑出一個 GUID。有了它，回應是 `201 Created` 並帶著記錄本身，於是下一個區塊就能讀取：

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

現在把工作流程打開——**概覽 → 編輯工作流程 → 已啟用**——宣告一個測試事件，然後在 **執行與日誌** 底下閱讀那次執行。`create-case` 區塊應該顯示 `201`，以及一個包含新 `incidentid` 的主體。畫布上的變更會自行儲存；沒有儲存按鈕。

### 對應嚴重程度與狀態

Dynamics 出廠的 `severitycode` 只有一個選項「Default Value」，所以沒有現成的嚴重程度級距可以對應。請改用 **`prioritycode`**，如果您想依嚴重程度給不同優先順序，就用一個 **If / Else** 區塊依 `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` 分支。

| 欄位             | 值                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` 高、`2` 一般、`3` 低                                                                                                          |
| `caseorigincode` | `1` 電話、`2` 電子郵件、`3` 網頁、`2483` Facebook、`3986` Twitter、`700610000` IoT                                                |
| `casetypecode`   | `1` 問題詢問、`2` 問題、`3` 需求                                                                                                  |
| `statecode`      | `0` 進行中、`1` 已解決、`2` 已取消                                                                                                |
| `statuscode`     | `1` 處理中、`2` 暫停、`3` 等待詳細資訊、`4` 研究中、`5` 問題已解決、`6` 已取消、`1000` 已提供資訊、`2000` 已合併 |

`statuscode` 是可自訂的，所以某個租戶可能加入了自己的值。請送出整數，而不是標籤文字。

## 步驟 6 — 讓事件與 case 能互相找到對方

無論您之後要做什麼——留言、解決、同步回來——都需要兩個系統其中之一持有另一個系統的識別碼。請把它放在 Dynamics 那一側。

在 Case 資料表加上一個**單行文字**欄位，例如 `new_oneuptimeincidentid`，並在建立 case 時設定它：

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

之後任何工作流程都能用一個篩選條件找到該 case：

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

如果您把那個欄位定義成 Case 資料表上的**替代索引鍵（alternate key）**，就可以完全跳過查找，直接 `PATCH` 到 `incidents(new_oneuptimeincidentid='<id>')`——這是一個 upsert，case 不存在就建立，存在就更新。該索引鍵必須先建置完成（狀態變成 **Active**）才能使用，而且替代索引鍵的值不能包含 `/ < > * % & : \ ? + #`。OneUptime 的 id 是一個單純的 UUID，所以是安全的。

反過來的方向——把 Dynamics 的 case id 存在 OneUptime 事件上——也行得通，用一個寫入 `customFields` 的 **Update One Incident** 區塊即可。請小心：`customFields` 是單一個 JSON 欄位，所以寫入它會取代該事件上每一個自訂欄位的值，而不只是您的那一個。把關聯保留在 Dynamics 那一側就完全避開了這個問題。

## 步驟 7 — 事件解決時一併解決 case

請把這一段建成**第二個**工作流程，這樣這裡的失敗就不會擋住 case 的開立。

1. **建立工作流程**，把它命名為 `Incident resolved → Close Dynamics case`，並加入 **On Update Incident** 觸發器。
2. 在觸發器的 **Listen on** 中填入 `{"currentIncidentStateId": true}`，讓工作流程只在狀態變更時醒來，而不是每次編輯都醒來。在 **Select Fields** 中，指定 `{"_id": true, "currentIncidentState": {"name": true}}`。
3. 加入一個 **If / Else** 區塊。**Input 1** 是 `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`，**Operator** 是 `==`，**Input 2** 是 `Resolved`——或您專案中已解決狀態實際的名稱。請參閱 [Incident States & Severities](/docs/incidents/states-and-severities)。
4. 從 **Yes** 分支重複步驟 4 的 `get-token` 區塊。
5. 加入一個 **API Get (JSON)** 區塊，把它的 **Identifier** 設為 `find-case`，並給它步驟 6 的那個 `$filter` URL。Dataverse 查詢會以一個 `value` 陣列回應，而工作流程的參照可以用中括號索引陣列，所以 case id 就是 `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`。
6. 加入一個關閉該 case 的 **API Post (JSON)** 區塊：

   - **URL**：`{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**：與步驟 5 相同，但去掉 `Prefer`。
   - **Request Body**：

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` 是「已解決」狀態下的一個 `statuscode` 值——`5` 是 *Problem Solved*。

     **在您依賴這個主體之前，請先在您自己的環境上測試它。** `CloseIncident` 接受兩個參數，`IncidentResolution` 與 `Status`，但 Microsoft 沒有為它發布任何 HTTP 範例——每一份官方範例都是 C#。上面的形狀是慣例上的翻譯版本。如果您的環境拒絕它，請改用一個單純的 `"incidentid": "<the case id>"` 屬性來指明該 case，而不用 `@odata.bind` 的形式，那正是 Microsoft 其他動作範例引用既有記錄的做法。

**為什麼不乾脆把 case `PATCH` 成 `statecode: 1` 就好？** 您可以這麼做——Microsoft 把 `statecode` 與 `statuscode` 的 `PATCH` 記載為舊版 SetState 訊息在 Web API 中的對應做法，而且要在各個進行中狀態之間移動 case 時，它就是正確的工具。它做不到的是建立一筆 **Case Resolution** 活動，而在 Dynamics 365 Customer Service 中，一筆已解決的 case 被預期要有這樣的活動；而且在管理員設定了自訂狀態轉換的環境中，它會被直接拒絕。要解決就用 `CloseIncident`；其他一切都用 `PATCH`。另外，每當您要寫入 `statecode` 時，請在同一個請求中一併設定 `statuscode`——否則 Dynamics 會悄悄套用該狀態的預設狀態值。

`CloseIncident` 來自 Dynamics 365 Customer Service 而非基礎的 Dataverse，因此它不在 Dataverse 的動作參考文件中。如果它回傳 `404`，請取得 `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` 並搜尋 `CloseIncident`，以確認它在您的環境中存在。

至於任何還不到關閉 case 的操作——一則備註、調高優先順序、改個標題——請對 `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` 使用一個 **API Patch (JSON)** 區塊，並帶上 `If-Match: *` 標頭，這樣可以避免意外的 upsert 建立出一筆新的 case。只送出您要變更的欄位。

## 入站 —— 從 Dynamics 365 到 OneUptime

現在換另一個方向：有人在 Dynamics 中關閉了 case，或某位客服人員加了一則備註，而 OneUptime 應該要知道。

### 先建立接收端的工作流程

1. **建立工作流程**，把它命名為 `Dynamics 365 → OneUptime`，並加入 **Webhook** 觸發器。
2. 開啟該工作流程的 **設定**，複製 **Webhook Secret Key**。您的 URL 是：

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   在自架的安裝上，請換成您自己的主機。請把這個 URL 當成密碼看待——任何拿到它的人都能啟動這個工作流程。您可以從同一個頁面重設金鑰。

3. 加入一個 **If / Else** 區塊，在其他任何動作發生之前先檢查一組共用祕密。**Input 1** 是 `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`，**Operator** 為 `==`，**Input 2** 為 `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}`——一個由您自己想出來、並存成祕密全域變數的值。
4. 從 **Yes** 分支加入一個 **Update One Incident** 區塊：

   - **Query**：`{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**：這個 case 變更在 OneUptime 中應該代表的意義——一次狀態變更、一則備註、一個標籤。

   要把事件移到某個狀態，您會需要該狀態的 id：一個查詢為 `{"name": "Resolved"}` 的 **Find One Incident State** 區塊會給您 `{{local.components.incident-state-find-one-1.returnValues.model._id}}`，可以寫進 `currentIncidentStateId`。

讓它保持啟用、待命。現在來給 Dynamics 一個可以呼叫的對象。

### 選項 A —— Power Automate flow（建議）

這是大多數團隊應該走的路徑：酬載由您掌控，而且沒有東西要安裝。

1. 在 [Power Automate](https://make.powerautomate.com) 中建立一個 **Automated cloud flow**。
2. 觸發器：**Microsoft Dataverse → When a row is added, modified or deleted**。

   - **Change type**：`Modified`
   - **Table name**：`Cases`
   - **Scope**：`Organization`——任何比這更窄的範圍都只會對您本人或您業務單位所擁有的資料列觸發。
   - **Select columns**：`statecode,statuscode`。這是一個只作用於更新的篩選條件，值得把它設對。這裡不支援查閱（lookup）欄位，而且絕對不要列出每次更新都會出現的欄位（例如主索引鍵），否則每次儲存都會觸發這條 flow。

3. 加入 **Microsoft Dataverse → Get a row by ID**，資料表為 `Cases`，資料列 id 取自觸發器，**Select columns** 設為 `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`。

   這第二個呼叫值得它的成本。在更新時，觸發器只會帶著有變更的欄位，所以您用來比對的識別碼可能根本不在裡面。

4. 加入內建的 **HTTP** 動作：

   - **Method**：`POST`
   - **URI**：上面那個 OneUptime webhook URL
   - **Headers**：`Content-Type: application/json` 與 `X-OneUptime-Secret: <the same secret>`
   - **Body**：用 *Get a row by ID* 的輸出來組裝，例如

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. 儲存並把這條 flow 打開。

在您決定走這條路徑之前，有些事值得知道：

- **Microsoft Dataverse 連接器是進階（premium）功能。** 對於自動化 flow，只有 flow 的擁有者需要授權，而不是這筆 case 觸及的每一個人——但擁有者的授權若失效，flow 就會無聲無息地停止。
- Dataverse 觸發器是**推送而非輪詢**——Dynamics 會註冊一個回呼並觸發它。傳遞通常在數秒內完成；超過五分鐘就代表非同步服務有積壓，您可以在 admin center 的 **Settings → System Jobs** 底下看到。
- 自訂標頭會保留下來。Power Automate 會從 HTTP 動作中移除數個標準標頭家族（大部分的 `Accept-*` 與 `Content-*` 標頭、`Host`、`Origin`、`Cookie`），但像 `X-OneUptime-Secret` 這種您自己的標頭會被原樣傳遞。
- 這條 flow 必須與它所監看的資料表位於同一個環境中。
- 請求會計入貴租戶的 Power Platform 請求配額，而連接器的節流會在 flow 執行中以 `429` 的形式浮現。

### 選項 B —— 原生的 Dataverse webhook

如果無法使用 Power Automate，Dataverse 可以直接呼叫 OneUptime。請用 [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook) 註冊該端點：**Register New WebHook**，填入 OneUptime 的 URL，選擇 **HttpHeader** 驗證，並加上 `X-OneUptime-Secret` 與您的祕密。接著在 **incident** 資料表上為 **Update** 訊息註冊一個步驟，**Filtering Attributes** 限制在您在意的欄位，階段為 **PostOperation**，執行模式為 **Asynchronous**。

走這條路請睜大眼睛：

- **只支援連接埠 80 與 443。** 使用其他任何連接埠的自架 OneUptime 都無法註冊。
- **Dataverse 不會驗證您的祕密。** 它只負責送出那個標頭；拒絕沒有帶著它的請求完全是您工作流程的職責——這正是接收端工作流程裡那個 **If / Else** 區塊的用途。
- **酬載並不是一個友善的 JSON 物件。** 它是一個序列化的 `RemoteExecutionContext`，其中 `InputParameters` 是一個由 `{key, value}` 配對組成的*陣列*，而有變更的那一列位在 `Target` 這個鍵底下，其欄位又放在另一個 `Attributes` 陣列裡。請預期要加一個 **Run Custom JavaScript** 區塊把它攤平，其他東西才讀得懂。
- **更新時只會包含有變更的欄位**，所以如果您需要 `ticketnumber` 或您的 OneUptime id 欄位，請註冊一個 **Post Image**。
- **超過 256 KB 時，有趣的部分會被剝掉**——`InputParameters`、`PreEntityImages` 與 `PostEntityImages` 全都會消失，而請求會帶有一個 `x-ms-dynamics-msg-size-exceeded` 標頭。`PrimaryEntityId` 與 `PrimaryEntityName` 會保留下來，所以退路是透過 Web API 把那一列讀回來。
- **傳遞幾乎不留情面。** Dataverse 會等待 60 秒以取得 `2xx`，而且只重試一次，並且僅限於 `502`、`503` 與 `504`。其他任何情況——包括您這一側的 `500`——都不會重試；它會變成一筆失敗的 System Job。
- 請選擇 **Asynchronous**。同步的步驟會讓客服人員的儲存動作卡在您的端點上，而且如果交易之後回滾，請求早就送出去且無法收回。

傳統的 Dynamics 背景 workflow 根本沒有 HTTP 或 webhook 步驟，所以它們在這裡不算是第三個選項。

## 為警示做同樣的事

以上所有內容都是圍繞事件撰寫的，因為那是常見情境，但警示的運作方式完全相同——換掉記錄類型，其他什麼都不必改：

| 事件（Incident）                                              | 警示（Alert）                                        |
| ------------------------------------------------------------ | --------------------------------------------------- |
| **On Create Incident**（`incident-on-create-1`）              | **On Create Alert**（`alert-on-create-1`）           |
| **On Update Incident**（`incident-on-update-1`）              | **On Update Alert**（`alert-on-update-1`）           |
| `incidentNumber`、`currentIncidentState`、`incidentSeverity`  | `alertNumber`、`currentAlertState`、`alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

一個工作流程恰好只有一個觸發器，所以事件與警示各需要一個工作流程。如果兩者要做的是同樣的工作，就把 Dynamics 那一半建一次，然後用 **Execute Workflow** 元件從兩邊呼叫它。

## 疑難排解

請先在 **執行與日誌** 中讀取失敗的那個區塊——兩個 Microsoft 端點都會回傳說明性的 JSON 主體，而 API 元件會把它保留在 `response-body` 中。

**權杖請求以 `400` 加上 `invalid_request` 或不支援的 grant type 失敗。** `Content-Type` 標頭不是精確的 `Content-Type: application/x-www-form-urlencoded`，所以主體是以 JSON 送出去的。請檢查大小寫。

**`400` 並出現 `AADSTS70011: The provided value for the input parameter 'scope' is not valid`。** `scope` 不是您的環境 URL 加上 `/.default`。請從 **Developer resources** 複製那個 URL，並去掉結尾的斜線以及任何 `/api/data/...` 路徑。

**來自 Dynamics 的 `401 Unauthorized`。** `Authorization` 標頭缺漏、格式錯誤，或權杖在執行中途過期。它必須是 `Bearer <token>`，中間只有一個空格。

**`403 Forbidden` 並出現 `0x80072560`、「The user isn't a member of the organization」。** 步驟 2 被略過了，或該應用程式使用者綁定到另一個應用程式註冊。權杖沒問題；問題是 Dynamics 那一側的使用者不存在。

**`403 Forbidden` 並出現權限錯誤。** 應用程式使用者存在，但它的自訂安全性角色缺少對 **Case** 的 Create、Read 或 Write 權限。

**`400 Bad Request` 提到 customer。** `customerid` 是必填的。請設定 `customerid_account@odata.bind` 或 `customerid_contact@odata.bind`，拼寫要完全一致，並使用以斜線開頭的 URI，例如 `/accounts(<guid>)`。

**`/CloseIncident` 出現 `404 Not Found`。** 這個動作屬於 Dynamics 365 Customer Service。在假設它可用之前，請先在您環境的 `$metadata` 中搜尋它。

**`412 Precondition Failed` 並出現 `DuplicateRecord`。** 有一條重複偵測規則命中了。請縮小該規則的範圍，或不要再送出它用來比對的那個欄位。

**`429 Too Many Requests`。** 這是 Dataverse 的服務保護限制——大致上是每個使用者在任何五分鐘視窗內、於每一台網頁伺服器上約 6,000 個請求與 20 分鐘的執行時間。回應會帶有以秒為單位的 `Retry-After`。如果某個工作流程正在爆量，請在其中放一個 **Delay** 區塊，或把工作移到會分批處理的排程工作流程。

**OneUptime 這一側什麼都沒收到。** 自己用 `curl` 對 webhook URL 送一個請求，並檢查該工作流程的 **執行與日誌**。如果您自己的請求有出現而 Dynamics 的沒有，問題就出在上游：如果是 Power Automate，請查看該 flow 自己的執行歷史；如果是原生 webhook，請查看篩選為失敗的 **Settings → System Jobs**。

**工作流程有執行，但事件沒有變化。** 當查詢沒有比對到任何東西時，**Update One Incident** 區塊會回報 `Items Updated: 0`——那是成功，不是錯誤。請檢查酬載中的 id 是 OneUptime 的事件 id，而且您查詢的是 `_id`。

## 接下來閱讀什麼

- [Integrations Overview](/docs/integrations/index) —— 入站與出站模式，以及驗證速查表。
- [Jira](/docs/integrations/jira) —— 針對 Jira 的同一套雙向做法。
- [Workflows Overview](/docs/workflows/index) 與 [Authoring a Workflow](/docs/workflows/authoring) —— 畫布、identifier，以及把工作流程打開。
- [Components](/docs/workflows/components) —— API 區塊、If / Else，以及 OneUptime 的資料元件。
- [Variables](/docs/workflows/variables) —— 祕密資訊，以及從下一個區塊讀取上一個區塊的輸出。
- [Configuration & Safety](/docs/workflows/configuration) —— webhook 安全性與對外網路存取。
- [IP Addresses](/docs/configuration/ip-addresses) —— OneUptime 的對外 IP 範圍，如果 Dynamics 位在允許清單後面就用得上。
