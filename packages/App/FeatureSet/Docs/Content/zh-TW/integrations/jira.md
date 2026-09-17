# Jira 整合

每當 OneUptime 宣告一個事件時就開立一張 [Jira](https://www.atlassian.com/software/jira) issue，隨著事件的變動讓它保持同步，並讓 Jira 把狀態變更推回 OneUptime——這一切都用一個 [Workflow](/docs/workflows/index) 完成。沒有任何 Jira 專屬的區塊需要安裝：OneUptime 以 [API 元件](/docs/workflows/components#api) 呼叫 Jira 的 REST API，而 Jira 則回呼進一個 [Webhook 觸發器](/docs/workflows/triggers#webhook)。

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

本頁會把兩個方向都建起來。入站段落之前的所有內容都是針對 **Jira Cloud** 撰寫的；接近結尾處有一個段落列出在 **Jira Data Center** 上有哪些不同。

> Atlassian 一直在為 Jira Cloud 裡的東西改名：**project**（專案）在大部分 UI 中現在叫做 **space**，而 **issue** 則是 **work item**。各租戶使用的詞彙兩者都有，所以在下文中用詞會有影響的地方，兩種說法都會列出。

## 先決條件

- 一個 Jira Cloud 站台（`https://your-domain.atlassian.net`）以及一個用來建立 issue 的專案。記下它的**專案金鑰（project key）**——也就是 `OPS-1234` 裡的 `OPS`。
- 一個能在該專案中建立 issue 的 Jira 帳號，以及在 [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) 為它取得的 **API token**。請使用服務帳號而非個人帳號——以這種方式建立的 issue 會被歸屬到該 token 的擁有者名下。
- 在該專案中建立自動化規則的權限，這是入站那一半所需要的。
- 一個您可以建立工作流程與全域變數的 OneUptime 專案。

## 步驟 1 — 將 Jira 憑證儲存為祕密

Jira Cloud 的 REST API 採用 **Basic auth**，由您的 Atlassian 帳號電子郵件與 API token 一起以 base64 編碼而成。

1. 將 `email:api_token` 編碼一次：

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   請使用 `printf`，不要用 `echo`。`echo` 會附加一個換行字元，該換行字元會連同其他內容一起被編碼，於是 Jira 回應 `401`，而原因在您貼上的字串裡完全看不出來。

2. 在 OneUptime 中，前往 **工作流程 → 全域變數 → 建立**。把它命名為 `JIRA_AUTH`，將 base64 字串貼上作為 **Content**，並開啟 **Secret**。
3. 再加入第二個非祕密的變數 `JIRA_URL`，內容為 `https://your-domain.atlassian.net`，結尾不要有斜線。

現在任何區塊都可以用 `Basic {{global.variables.JIRA_AUTH}}` 作為它的 `Authorization` 標頭，而該 token 永遠不會出現在工作流程或其執行記錄檔中。請參閱 [Variables](/docs/workflows/variables)。

關於 Atlassian API token 的兩件事，遲早會反咬一個沒人在看的整合一口：

- **它們會過期。** Token 建立時的有效期從一天到一年不等，預設為一年，而且沒有更新機制——過期的 token 必須在同一個頁面上手動更換，並重新編碼進 `JIRA_AUTH`。請把到期日記到某個行事曆上。當一個已經運作好幾個月的工作流程開始回應 `401` 時，原因就在這裡。
- **帶範圍（scoped）的 token 需要不同的基底 URL。** Token 頁面除了傳統的 **Create API token** 之外，也提供 **Create API token with scopes**。帶範圍的 token 是比較安全的選擇，但它們並不是對您的站台發送的：它們要送到 `https://api.atlassian.com/ex/jira/<cloudId>`，所以 `JIRA_URL` 要改成那個位址，而下文中的每一個路徑都原封不動地掛在它後面。您的 `cloudId` 在 `https://your-domain.atlassian.net/_edge/tenant_info` 的 JSON 中。把帶範圍的 token 送到 `your-domain.atlassian.net` 只會失敗。

如果貴組織使用 Atlassian 的集中式使用者管理，還有第三個選項可以繞開過期的問題：[服務帳號的 OAuth 2.0 憑證](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/)。它給您的是 client id 與 secret，而不是一個 token，工作流程會在每次執行開始時用它們換取一個短效的存取權杖——這就是 [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) 頁面所用的同一種兩個區塊的形狀：一個 **API Post (JSON)** 區塊取得權杖，之後所有區塊都送出 `Bearer <token>`。一年後不需要手動更換任何東西。Atlassian 的頁面有確切的權杖請求內容；API 基底 URL 是 `https://api.atlassian.com`。

## 步驟 2 — 為每個事件開立一張 Jira issue

1. 開啟 **工作流程 → 建立工作流程**，把它命名為 `Incidents → Jira`，然後開啟 **建構器**。
2. 點擊虛線的預留位置區塊，加入 **On Create Incident** 觸發器。在它的 **Select Fields** 中，指定您想送出的欄位：

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   請將它的 **Identifier** 維持為 `incident-on-create-1`——後續的區塊就是用這個名稱來引用它的。

3. 點擊 **Add Component**，加入一個 **API Post (JSON)** 區塊，並從觸發器的 **Success** 圓點拉線到新區塊的輸入圓點。打開它，將它的 **Identifier** 設為 `create-issue`，然後填入：

   - **URL**：`{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**：

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**：

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   請將 `OPS` 替換為您的專案金鑰，並將 `Bug` 替換為該專案中確實存在的 issue 類型。這兩者也都可以用 id 給定——`{"id": "10000"}`——這正是 Atlassian 自家範例所使用的形式，而且如果您站台上有兩個 issue 類型同名，您就應該優先採用它。下文的 `createmeta` 呼叫會把那些 id 交給您。

description 看起來很笨重，是因為 Jira Cloud 的 v3 API 把富文字視為 **Atlassian Document Format**——一棵文件樹，而不是一個字串。上面的形狀是最小的有效文件：一個段落包著一個文字節點。同樣的規則適用於 `environment` 以及任何多行文字自訂欄位；單行文字自訂欄位仍然接受純字串。

現在從 **概覽 → 編輯工作流程 → 已啟用** 把工作流程打開，宣告一個測試事件，然後開啟 **執行與日誌**。`create-issue` 區塊應該顯示 `201`，以及一個包含新 issue 的 `id`、`key` 與 `self` 的主體。畫布上的變更會自行儲存——沒有儲存按鈕，而且停用的工作流程根本無法執行，連手動都不行。

新的 issue key 可供這個區塊之後的任何區塊使用：

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### 填入更多欄位

`fields` 裡幾個常見的追加項目：

- **Priority**——`"priority": { "id": "20000" }`，使用您站台上的某個 priority id。若要把 OneUptime 的嚴重程度對應到 Jira 的優先順序，請在觸發器與 API 區塊之間放一個 **If / Else** 區塊，並依 `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` 分支。
- **Assignee**——`"assignee": { "id": "<accountId>" }`。Jira Cloud 以 Atlassian account id 識別人員；`username` 與 `userKey` 多年前就已從 Cloud API 中移除。
- **Labels**——`"labels": ["oneuptime", "sev1"]`，一個扁平的字串陣列。標籤中不能含有空格。
- **Components**——`"components": [{ "id": "10000" }]`。
- **自訂欄位（Custom fields）**——`"customfield_10034": "..."`，使用該欄位自己的 id。值的形狀取決於欄位的型別：單選欄位接受 `{"value": "red"}`，多選欄位接受一個 id 陣列，多行文字欄位則接受一份 Atlassian Document Format 文件。

若要知道某個專案實際上要求些什麼，請去問 Jira，不要用猜的。先列出專案中的 issue 類型，再列出其中一個類型的欄位：

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

第二個呼叫會列出該 issue 類型接受的每一個欄位、其中哪些是必填的，以及確切的 `customfield_NNNNN` id。若要從一張您已經有的 issue 上讀出這些 id，請以 `?expand=names` 取得它。

## 步驟 3 — 把事件 id 帶進 Jira

雙向同步的兩半都需要其中一個系統持有另一個系統的識別碼，而 Jira 是比較適合存放它的地方：OneUptime 的 `customFields` 欄位是單一個 JSON 區塊，所以從工作流程寫入一個值，就會取代該事件上的每一個自訂欄位。

**有 Jira 管理員的話。** 在專案的建立畫面加上一個短文字自訂欄位——就叫它 *OneUptime Incident ID*——用 `createmeta` 找出它的 id，然後跟其他欄位一起設定：

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**沒有管理員的話。** 改把它放進一個標籤裡。標籤不能有空格，而 OneUptime 的 id 是一個單純的 UUID，所以 `oneuptime-<id>` 是有效的標籤：

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

入站的工作流程接著就得從清單中挑出那個標籤，這在一個 **Run Custom JavaScript** 區塊裡只需要幾行。如果能有自訂欄位，那還是比較整潔。

既然講到這裡，在 Jira issue 上加一條連回事件的連結也很值得。在 `create-issue` 之後放一個 **API Post (JSON)** 區塊，指向 `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`，並使用：

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

這就給了 Jira 裡的每個人一條一鍵返回的路徑。為此請把 `projectId` 加進觸發器的 **Select Fields**。`globalId` 是讓這個呼叫可以安全重複的關鍵：Jira 會更新已經帶有該 id 的連結，而不是再加一條。由於更新也會把您沒寫進去的東西清空，請一律送出完整的 `object`，而不是它的一部分。

## 步驟 4 — 隨著事件變動留言與轉換狀態

請把這一段建成**第二個**工作流程，這樣這裡的失敗就永遠不會擋住 issue 的開立。

1. **建立工作流程**，把它命名為 `Incident updates → Jira`，並加入 **On Update Incident** 觸發器。
2. 在 **Listen on** 中填入 `{"currentIncidentStateId": true}`。這樣觸發器就只會在狀態變更時觸發，而不是每次編輯都觸發。在 **Select Fields** 中，指定 `{"_id": true, "currentIncidentState": {"name": true}}`。
3. 加入一個 **If / Else** 區塊：**Input 1** 為 `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`，**Operator** 為 `==`，**Input 2** 為 `Resolved`——或您專案中已解決狀態實際的名稱。請參閱 [Incident States & Severities](/docs/incidents/states-and-severities)。

從 **Yes** 分支開始，您首先得找出您在步驟 2 開立的那張 issue。用您在步驟 3 儲存的 id 向 Jira 詢問它，使用一個 **Identifier** 為 `find-issue` 的 **API Post (JSON)** 區塊：

- **URL**：`{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**：

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  如果您用的是自訂欄位而不是標籤，該子句就變成 `cf[10050] ~ \"...\"`，並填入您自己的欄位 id。

接著 issue id 就是 `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`，而下文中的每一個端點接受 id 都和接受 key 一樣自在。

關於這個端點有三件事值得知道。**請用 POST 送出 JQL，不要把它放在 URL 裡**——值裡含有 `=` 的查詢字串在離開工作流程的路上會被截斷，而 JQL 除了 `=` 之外幾乎沒別的。**查詢必須有界**：光是一句 `order by key desc` 會被以 `400` 拒絕，這就是那個 `project =` 子句存在的原因。還有，`/rest/api/3/search/jql` 是目前的端點——較舊的 `/rest/api/3/search` 已被棄用且即將淘汰，所以請不要去用它。

**留下一則留言**只需要一個指向 `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment` 的 **API Post (JSON)** 區塊，主體使用 Atlassian Document Format，就跟 description 一樣：

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**移動 issue** 需要兩個呼叫，因為一個轉換是由一個 id 識別的，而該 id 在不同的 workflow 之間、以及在某些看板上不同的 issue 之間都不一樣。

1. 一個對 `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` 的 **API Get (JSON)** 區塊會回傳*從該 issue 目前狀態出發*可用的轉換，每一個都帶有一個 `id` 與一個 `name`，以及一個標明它會導向哪個狀態的 `to` 物件。
2. 一個指向同一個 URL 的 **API Post (JSON)** 區塊執行其中一個轉換：

   ```json
   { "transition": { "id": "31" } }
   ```

成功的轉換會以 `204` 回應且沒有主體。如果您不想在執行期讀取那份清單，可以手動針對一張處於正確狀態的 issue 呼叫一次，然後把 id 寫死——只是別忘了它是綁在那個 workflow 上的，所以管理員編輯 Jira workflow 就可能在無聲無息中把它弄壞。

## 入站 —— 從 Jira 到 OneUptime

現在換另一個方向：有人把 issue 移到 Done，而 OneUptime 的事件應該跟著走。

### 先建立接收端的工作流程

1. **建立工作流程**，把它命名為 `Jira → OneUptime`，並加入 **Webhook** 觸發器。
2. 開啟該工作流程的 **設定**，複製 **Webhook Secret Key**。您的 URL 是：

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   自架的安裝會使用自己的主機。請把這個 URL 當成密碼看待——任何拿到它的人都能啟動這個工作流程——而且如果外洩了，就從同一個頁面重設金鑰。

3. 加入一個 **If / Else** 區塊，在其他任何動作執行之前先檢查一組共用祕密。**Input 1** 是 `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`，**Operator** 為 `==`，**Input 2** 是 `{{global.variables.JIRA_WEBHOOK_SECRET}}`——一個由您自己想出來、並存成祕密全域變數的值。
4. 從 **Yes** 分支加入一個 **Update One Incident** 區塊：

   - **Query**：`{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**：這個 Jira 變更在這裡應該代表什麼意思——通常是一次狀態變更。

   移動一個事件需要目標狀態的 id，一個查詢為 `{"name": "Resolved"}` 的 **Find One Incident State** 區塊會以 `{{local.components.incident-state-find-one-1.returnValues.model._id}}` 給您。請把它寫進 `currentIncidentStateId`。

讓工作流程維持啟用。現在來給 Jira 一個可以呼叫的對象。

### 從 Jira 自動化規則送出事件

1. 在 Jira 中開啟專案的自動化規則：較新的租戶是 **Space settings → Automation**，較舊的則是 **Project settings → Automation**。若規則要橫跨多個專案，請使用 **Settings → System → Global automation**，這需要 *Administer Jira* 全域權限。
2. **Create rule**，並挑選 **Work item transitioned** 觸發器——在較舊的租戶上叫做 **Issue transitioned**。把它設定為當狀態移動*到* **Done** 時執行。

   請使用這個觸發器，而不是 *Work item updated*：更新觸發器刻意排除了狀態變更。

3. 加入 **Send web request**（送出網頁請求）動作並設定它：

   - **Web request URL**：上面那個 OneUptime webhook URL。
   - **HTTP method**：`POST`
   - **Headers**：`Content-Type` / `application/json`，以及 `X-OneUptime-Secret` / 您的共用祕密。請在祕密的值上使用 **Hide** 選項，讓其他規則編輯者無法讀到它——請注意，對該值而言隱藏是不可逆的，而且如果規則被匯出或複製，被隱藏的值會遺失。
   - **Web request body**：選 **Custom format**，這樣形狀由您掌控：

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     如果您在步驟 3 用的是標籤而不是自訂欄位，請送出 `"labels": "{{issue.labels}}"`，並在 OneUptime 這一側用一個 **Run Custom JavaScript** 區塊把 id 取出來。

4. 把規則打開，把一張測試 issue 移到 Done，然後檢查兩邊：Jira 中該規則自己的稽核日誌，以及 OneUptime 中的 **執行與日誌**。

在您依賴這套機制之前，有些事值得知道：

- **目的地連接埠受到限制。** Send web request 只能連到 80、8080、443、6017、8443、8444、7990、8090、8085、8060、8900 與 9900 這幾個連接埠。OneUptime Cloud 在 443 上；使用特殊連接埠的自架安裝無法用這種方式被呼叫。
- **沒有請求簽章。** 這個動作沒有 HMAC 選項，所以透過 HTTPS 在標頭中帶一組共用祕密就是 Atlassian 所記載的機制。接收端工作流程步驟 3 的 **If / Else** 檢查，正是讓這個做法值得採用的原因。
- **規則執行次數是計量的。** Jira Cloud 會把成功的規則執行次數計入每月額度，額度取決於您的方案——Free 為 100、Standard 為 1,700、Premium 為 1,000 × 使用者數、Enterprise 則不限。一條在繁忙專案中每次轉換都觸發的規則，累積起來很可觀。
- **值不會為您做 URL 編碼。** 這只有在您送出以表單編碼的主體時才有影響；上面的 JSON 沒問題。
- **Atlassian 有公布它的對外 IP 範圍**，位於 [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com)，如果您的 OneUptime 安裝位在允許清單後面就用得上。這些範圍會變動，所以請定期輪詢該來源，而不要把位址寫死。

### 或改用 Jira webhook

Jira 管理員可以直接在 **Settings → System → Advanced → WebHooks** 底下註冊一個 webhook，選擇要送出的事件，並可選擇性地用一段 JQL 查詢縮小哪些 issue 會觸發它。與自動化規則相比：

- 酬載是 Jira 自己的，不是您的：`webhookEvent`、`issue_event_type_name`、完整的 `issue`，以及一個 `changelog`，其 `items` 陣列裝著每個變更欄位的前後值。對於狀態變更，您要的是 `field` 為 `status` 的那一筆。要在工作流程裡讀取它，通常意味著要加一個 **Run Custom JavaScript** 區塊。
- Webhook **可以**被簽章——給 webhook 一組祕密，Jira 就會送出一個帶有請求主體 HMAC 的 `X-Hub-Signature` 標頭——但工作流程無法檢查它。簽章涵蓋的是 Jira 送出的確切位元組，而 Webhook 觸發器交給工作流程的主體已經被解析成 JSON，所以沒有東西可以拿去做雜湊了。如果您希望請求經過驗證，請改用帶有共用祕密標頭的自動化規則。
- URL 必須是 HTTPS，且連接埠要在 Jira 自己的清單中，而那份清單和自動化動作用的*並不*相同——這裡不允許連接埠 80。
- 傳遞最多會重試五次，退避間隔為五到十五分鐘，所以您的工作流程必須能容忍同一個事件送達兩次。

由應用程式透過 `/rest/api/3/webhook` 註冊的 webhook 又是另一回事：除非續期，否則它們會在註冊 30 天後過期。上述由管理員註冊的則不會過期。

## Jira Data Center

自行管理的 Jira 運作方式相同，只需要少數幾項替換。**Jira Server** 已於 2024 年 2 月終止支援且不再收到修補，所以請把 Data Center 當作自行管理的目標。

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...`——Data Center 上沒有 v3                                     |
| `description` 是一份 Atlassian Document Format 文件 | `description` 是一個以 wiki 標記撰寫的純字串                                  |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| 來自 id.atlassian.com 的 API token                | 在您自己的 Jira 帳號上 **Profile → Personal access tokens → Create token**    |
| 自動化動作 **Send web request**                    | 自動化動作 **Send outgoing web request**                                     |

所以建立 issue 的區塊會變成對 `/rest/api/2/issue` 的一個 `POST`，內容為：

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

這樣做樣板更簡單——沒有文件樹。

其他需要事先規劃的差異：

- **Personal access token** 自 Jira Core 與 Jira Software 8.14 以及 Jira Service Management 4.15 起提供。它們會過期——預設 365 天——而且 UI 會在到期前五天把它標示為 *Expires soon*。在 Data Center 上，使用者名稱加密碼的 Basic auth 仍然可用，但幾次登入失敗就會觸發 CAPTCHA，把該帳號完全鎖在 REST API 之外，直到有人在瀏覽器裡把它解掉為止——用這種方式發現自己打錯字實在很糟。請優先使用 token。
- **自動化功能自 Jira Data Center 10.0 起是內建的。** 在那之前它是需要另外安裝的 Automation for Jira 應用程式。它的對外請求預設逾時為 3000 毫秒，可用 `outgoing.webhook.timeout.ms` 屬性調整。
- **Webhook** 在 **Administration → System → Advanced → WebHooks** 註冊，並支援 JQL 範圍限定。請讓那些篩選條件保持精確：Jira 會在引發該事件的執行緒上評估每一個已註冊 webhook 的 JQL，所以十幾條寬鬆的篩選條件會拖慢觸發它們的使用者操作。
- **自 Data Center 10.0 起 webhook 傳遞是非同步的**，而且沒有同步選項，因此事件可能不按順序抵達。請讓接收端的工作流程具有冪等性。
- **Jira 10 拿掉了 webhook URL 變數中的 `$`**——`${issue.id}` 變成 `{issue.id}`——並把 webhook 的 REST 資源從 `/rest/webhooks/1.0/webhook` 移到 `/rest/jira-webhook/1.0/webhooks`。

## 為警示做同樣的事

以上所有內容都是圍繞事件撰寫的，因為那是常見情境，但警示的運作方式完全相同——換掉記錄類型，其他什麼都不必改：

| 事件（Incident）                          | 警示（Alert）                                |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident**（`incident-on-create-1`） | **On Create Alert**（`alert-on-create-1`）   |
| **On Update Incident**（`incident-on-update-1`） | **On Update Alert**（`alert-on-update-1`）   |
| `incidentNumber`、`currentIncidentState`、`incidentSeverity` | `alertNumber`、`currentAlertState`、`alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

一個工作流程恰好只有一個觸發器，所以事件與警示各需要一個工作流程。如果兩者要做的是同樣的工作，就把 Jira 那一半建一次，然後用 **Execute Workflow** 元件從兩邊呼叫它。

## 疑難排解

請先在 **執行與日誌** 中打開失敗的那個區塊。Jira 會回傳一個 JSON 主體，精確說明它拒絕了什麼，而 API 元件會把它保留在 `response-body` 中。

**`401 Unauthorized`。** 用 `printf` 重新編碼 `email:api_token` 並更新 `JIRA_AUTH`；`echo` 留下的結尾換行字元通常就是元兇。接著確認擁有該 token 的帳號能在該專案中建立 issue。在 Data Center 上，請檢查您送的是 `Bearer` 而不是 `Basic`。

**`400 Bad Request` 並指明某個欄位。** 該 issue 類型在專案中不存在，或該專案有一個您沒送出的必填欄位。請對那個專案與 issue 類型執行上面的 `createmeta` 呼叫並加以比對。

**`400` 抱怨 `description`。** 在 Cloud v3 上，description 必須是一份 Atlassian Document Format 文件，而不是一個字串。請送出上面所示的文件，或把該區塊改成 `/rest/api/2/issue` 並送出純文字。

**`404 Not Found`。** 請檢查基底 URL 與 API 版本——Cloud 是 `/rest/api/3/...`，Data Center 是 `/rest/api/2/...`。

**`429 Too Many Requests`。** Jira 正在限制速率。回應會帶有以秒為單位的 `Retry-After`，以及一個指明您撞上哪個限制的 `RateLimit-Reason`。針對單一 issue 的寫入被限制得很緊——大約是兩秒內二十次——所以一個接連留言又轉換狀態的工作流程，光在一張 issue 上就可能踩線。請在這些呼叫之間放一個 **Delay** 區塊，或把大量的工作移到排程工作流程。

**轉換呼叫回傳 `400`。** 該轉換 id 從這張 issue 的*目前*狀態出發並不有效。請為那張 issue 取得 `/transitions`，並使用回應中的某個 id。

**自動化規則顯示成功，但什麼都沒送到 OneUptime。** 請先檢查連接埠——參見上面那份受限清單。接著自己用 `curl` 對 webhook URL 送一個請求，看看它會不會出現在 **執行與日誌** 中；如果您的請求有到而 Jira 的沒有，問題就出在 Jira 那一側。

**工作流程有執行，但事件沒有變化。** 當 **Update One Incident** 區塊的查詢沒有比對到任何東西時，它會回報 `Items Updated: 0`，而那算成功，不算錯誤。請檢查酬載中的 id 真的是 OneUptime 的事件 id，而且您查詢的是 `_id`。

**Jira issue 中出現字面上的 `{{...}}` 參照。** 未解析的參照會被原樣當成文字傳遞，而不是被清空。執行記錄會指出任何沒有解析成功的參照——通常是打錯的區塊 identifier 或被改名的變數。

## 接下來閱讀什麼

- [Integrations Overview](/docs/integrations/index) —— 入站與出站模式，以及驗證速查表。
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) —— 針對 Dynamics 的同一套雙向做法。
- [Workflows Overview](/docs/workflows/index) 與 [Authoring a Workflow](/docs/workflows/authoring) —— 畫布、identifier，以及把工作流程打開。
- [Components](/docs/workflows/components) —— API 區塊、If / Else，以及 OneUptime 的資料元件。
- [Variables](/docs/workflows/variables) —— 祕密資訊，以及從下一個區塊讀取上一個區塊的輸出。
- [Configuration & Safety](/docs/workflows/configuration) —— webhook 安全性與對外網路存取。
- [ServiceNow](/docs/integrations/servicenow) 與 [PagerDuty](/docs/integrations/pagerduty) —— 適用於其他工具的相同出站模式。
