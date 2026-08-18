# 變數

工作流程的核心是移動資料——從觸發器流向第一個區塊、從一個區塊流向下一個區塊，以及將共用值帶到任何你需要的地方。變數就是資料流動的方式。

變數有兩種範圍，再加上執行期間產生的元件輸出。

## 全域變數

專案範圍的值，你只需儲存一次便能在任何地方重複使用。例如 API 金鑰、URL、頻道名稱——任何你不想複製到十個不同工作流程中的內容。

你可以在 **Workflows → Global Variables** 底下找到它們。每一個都有：

- **Name**——你將如何引用它。至少兩個字元，不含空格，只能使用字母、數字、連字號與底線。`UPPER_SNAKE_CASE` 是個好習慣，因為它在你的區塊中會很醒目。
- **Description**——選填，自由文字，用來提醒你這個變數的用途。
- **Secret**——開啟時，該值會從執行日誌與步驟追蹤中被清除。
- **Content**——實際的值。這是一個長文字欄位，因此多行值也可以使用。

在任何工作流程中使用全域變數的方式如下：

```
{{global.variables.NAME}}
```

舉例來說，如果你將 PagerDuty 金鑰儲存為 `PAGERDUTY_KEY`，任何區塊都可以用 `{{global.variables.PAGERDUTY_KEY}}` 來使用它——編輯器會儲存這個參照，而工作流程日誌會清除已解析的密鑰值。

變數只能建立與刪除，無法編輯。表格上沒有編輯按鈕，因此若要在 UI 中變更某個值，你需要先刪除該變數再重新建立——或透過 API 更新它，本頁最後會說明這一點。全域與工作流程變數是 Growth 方案的功能。

## 本機工作流程變數

範圍限定在單一工作流程內的變數，在該工作流程左側選單的 **Workflow Variables** 下管理。引用方式如下：

```
{{local.variables.NAME}}
```

## 元件輸出（來自先前區塊的資料）

每個觸發器與元件在一次執行期間都可能產生輸出。請使用編輯器中的元件值選取器來建立參照，而不是自行輸入——它會插入執行器所預期的確切 id。

引用先前區塊輸出的方式如下：

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` 是區塊的 **Identifier**——顯示在區塊上的短 id，而不是它上面顯示的名稱。新區塊會得到像 `api-get-1` 這樣的 id，你可以在該區塊的 **ID** 區段中重新命名它。重新命名會破壞所有已經指向它的參照，就像重新命名變數一樣。`FIELD_ID` 則是所選的回傳值 id。

範例：

- 在 ID 為 `lookup-user` 的 **API** 元件執行後，其狀態碼是 `{{local.components.lookup-user.returnValues.response-status}}`，其主體是 `{{local.components.lookup-user.returnValues.response-body}}`。
- 在 ID 為 `transform` 的 **Run Custom JavaScript** 元件執行後，其回傳值是 `{{local.components.transform.returnValues.returnValue}}`。
- 針對某種記錄類型的觸發器——**On Create Incident** 及其同類——只會回傳一個值 `model`，你需要深入其中讀取欄位。以 ID 為 `incident-on-create-1` 的觸發器為例，該事件的標題是 `{{local.components.incident-on-create-1.returnValues.model.title}}`。

本機變數只在目前的執行期間存在。每次新的執行都會重新開始。

## 變數可在哪裡使用

幾乎每個文字欄位都接受變數：

- API 區塊上的 URL。
- Slack、Teams、Discord、Telegram、Email 上的訊息文字。
- 電子郵件的主旨與內文。
- 標頭與內文欄位（在字串值內）。
- **If / Else** 區塊的兩側（列於 Conditions 類別下）。

在 JSON 欄位中，你可以在字串值內使用變數，但不能用作鍵（key）。若某個參照獨自佔據整個值，它會被原樣替換，因此你可以用這種方式把整個物件放進 JSON 欄位。如果你需要動態建構結構，請使用 **Run Custom JavaScript** 區塊來建構它，然後將其輸出傳遞給下一個區塊。

**Run Custom JavaScript** 區塊不會自動取得變數——沙箱中不會被注入任何內容。請將 `{{global.variables.NAME}}`（或任何元件參照）放入該區塊的 **Arguments** JSON 欄位；這些值會在指令碼執行前被替換，並以 `args` 的形式送達。

## 迭代陣列

在文字欄位中，你可以用 `{{#each path}}…{{/each}}` 來迭代一個陣列。在該區塊內，`{{property}}` 會讀取目前元素的內容，`{{@index}}` 是以 0 為起始的位置，而對於純值陣列，`{{this}}` 就是該元素本身。`{{#each}}` 區塊內的名稱會被去除空格，因此多餘的空格在這裡是無害的——這與其他地方不同。

## 範例

### 從 webhook 建構酬載

一個 webhook 帶著像 `{ "service": "checkout", "status": "failed" }` 這樣的主體抵達。若要將其轉換為 OneUptime 事件：

1. ID 為 `ci-webhook` 的 **Webhook** 觸發器。
2. **If / Else** 區塊：選取 webhook 的 Request Body 輸出，並使用其 `status` 屬性，運算子 `==`，右側值 `failed`。
3. 從 **Yes** 分支接一個 **Create One Incident** 區塊：
   - Title：`CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description：`See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### 在 API 呼叫中使用密鑰

一個呼叫 PagerDuty 的工作流程：

1. 將 `PAGERDUTY_KEY` 儲存為密鑰（secret）全域變數。
2. 在 **API** 區塊上，將 `Authorization` 標頭設定為 `Token token={{global.variables.PAGERDUTY_KEY}}`。

金鑰會保持在工作流程與日誌之外。

### 串接兩個 API 呼叫

第一個呼叫提供第二個呼叫所需的 ID：

1. **API** 元件 `lookup-order`：使用選取器將手動觸發器的 JSON email 欄位插入 `GET /orders?email=...`。
2. **API** 元件 `cancel-order`：`POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`。

如果 `lookup-order` 失敗，會觸發它的 **Error** 輸出，而非 **Success**。將其連接到 Email 或 Slack 區塊，這樣失敗就不會被忽略。

## 從工作流程更新變數

常見的模式是依排程輪替憑證：從第三方取得新的權杖，再將它存回變數，讓下一次執行能夠使用。可透過呼叫 OneUptime API 的 **API** 區塊來完成。

`PUT /api/workflow-variable/<variable-id>`，搭配 `ApiKey` 標頭，而且——這正是常讓人卡住的地方——你想變更的欄位必須**包在一個 `data` 物件裡**：

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

沒有 `data` 包裝的扁平主體會以 400 被拒絕。只要傳送你真正想變更的欄位；`name` 與 `description` 可以不放進酬載中。

該 API 金鑰需要 **Edit Workflow Variables** 權限。不需要讀取權限——更新動作不會把該列讀回來。

有兩件事要注意：

- **不要重新命名你正在引用的變數。**`name` 是 `{{local.variables.NAME}}` 的一部分。變更它會讓所有既有的參照都無法解析，而未能解析的參照會被原樣當成字面文字傳遞——見下方的陷阱說明。
- **變數可以用這種方式寫入，但永遠無法讀回。**無論是否標記為密鑰，`content` 在 API 上對每個變數都是只寫的。這正是讓變數成為存放輪替權杖之安全位置的原因。將其標記為密鑰，還能額外讓該值不出現在執行日誌與步驟追蹤中。

## 陷阱

- **請使用選取器。** 它們會插入執行器所預期的確切元件、回傳值與變數 id，並讓參照獨立於顯示標籤之外。
- **變數名稱區分大小寫。**`{{global.variables.MyKey}}` 與 `{{global.variables.mykey}}` 是不同的。
- **未能解析的參照會維持原樣，而不是變成空白。** 引用一個不存在的內容並不是錯誤，也不會給你空字串：大括號會被原樣傳遞，因此打錯步驟 id 的 `{{local.components.api-get-1.returnValues.body}}` 會逐字出現在你的 Slack 訊息、URL 或請求主體中，而該次執行仍會回報為 **Executed**。執行日誌會有一行警告，指名任何未能解析的參照。
- **建構器無法檢查變數名稱。** 它會在你儲存前標示出無法比對的元件參照——未知的步驟 id、未知的回傳值、格式錯誤的根節點。但它無法判斷變數是否存在，因此重新命名的變數只能靠執行日誌才能發現。
- **大括號內的空格不會被去除。**`{{ local.variables.NAME }}` 與 `{{local.variables.NAME}}` 是不同的查詢，且前者永遠無法解析。唯一的例外是在 `{{#each}}` 區塊內，其中的名稱會被去除空格。

## 接下來可以閱讀

- [元件](/docs/workflows/components)——每個區塊所產生輸出的完整清單。
- [執行與日誌](/docs/workflows/runs-and-logs)——在執行後查看每個變數的實際值。
- [設定與安全](/docs/workflows/configuration)——哪些內容適合放入全域變數。
