# 變數

工作流程講的就是搬資料——從觸發器搬到第一個區塊、從一個區塊搬到下一個，還有把共用的值搬到任何你需要的地方。變數就是資料移動的方式。

變數有兩種範圍，再加上執行期間由元件產生的輸出。

## 全域變數

存一次就能到處重複使用的專案層級值。像是 API 金鑰、網址、頻道名稱——任何你不想複製到十個工作流程裡的東西。

在 **工作流程 → 全域變數** 底下可以找到。每一個都有：

- **名稱**——你之後用來參照它的名字。至少兩個字元、不能有空格，而且只能用字母、數字、連字號和底線。習慣寫成 `UPPER_SNAKE_CASE` 是個好主意，因為它在區塊裡一眼就看得出來。
- **描述**——選填，用自由文字提醒自己這是拿來做什麼的。
- **密鑰**——打開之後，這個值會從執行日誌和步驟追蹤裡被清掉。
- **內容**——真正的值。這是長文字欄位，所以多行的值也沒問題。

在任何工作流程裡使用全域變數，寫法是：

```
{{global.variables.NAME}}
```

舉例來說，如果你把 PagerDuty 金鑰存成 `PAGERDUTY_KEY`，任何區塊都能用 `{{global.variables.PAGERDUTY_KEY}}` 取用——編輯器存的是那個參照，而工作流程的日誌會把解析出來的密鑰值清掉。

變數只能建立和刪除，不能編輯。表格上沒有編輯按鈕，所以要在介面上改一個值，就得先刪掉再重建——或是透過 API 更新，本頁最後會談到這個做法。全域變數和工作流程變數是 Growth 方案的功能。

## 工作流程內的區域變數

範圍只限單一工作流程的變數，在該工作流程左側選單的 **工作流程變數** 底下管理。參照方式：

```
{{local.variables.NAME}}
```

## 元件輸出（來自前面區塊的資料）

每個觸發器和元件都可能在一次執行中產出輸出。請用編輯器裡的元件值選擇器來產生參照，不要自己手打——它插入的是執行器真正認得的那些 id。

參照前一個區塊的輸出，寫法像這樣：

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` 是區塊的 **Identifier**——顯示在區塊上的那個短 id，不是它上面顯示的名稱。新區塊會拿到像 `api-get-1` 這樣的 id，你可以在區塊的 **ID** 區段裡改掉它。改掉之後，所有已經指向它的參照都會壞掉，跟改變數名稱是同一回事。`FIELD_ID` 則是你選的那個回傳值 id。

範例：

- ID 是 `lookup-user` 的 **API** 元件跑完之後，它的狀態碼是 `{{local.components.lookup-user.returnValues.response-status}}`，內文是 `{{local.components.lookup-user.returnValues.response-body}}`。
- ID 是 `transform` 的 **Run Custom JavaScript** 元件跑完之後，它回傳的值是 `{{local.components.transform.returnValues.returnValue}}`。
- 對應某種記錄類型的觸發器——**On Create Incident** 那一類——只回傳一個值 `model`，你再往裡面鑽。以 ID 為 `incident-on-create-1` 的觸發器來說，事件的標題就是 `{{local.components.incident-on-create-1.returnValues.model.title}}`。

區域變數只在當次執行期間存在。每一次新的執行都是重新開始。

## 變數可以用在哪裡

幾乎每個文字欄位都接受變數：

- API 區塊上的網址。
- Slack、Teams、Discord、Telegram、電子郵件的訊息文字。
- 電子郵件的主旨和內文。
- 標頭和內文欄位（在字串值裡面）。
- **If / Else** 區塊的左右兩邊（列在條件分類底下）。

在 JSON 欄位裡，變數可以放在字串值裡面，但不能當作鍵。如果一個參照自己就佔滿整個值，它會被原樣代進去，所以你可以用這個方式把一整個物件塞進 JSON 欄位。如果你需要動態組出一個結構，就用 **Run Custom JavaScript** 區塊組好，再把它的輸出傳給下一個區塊。

**Run Custom JavaScript** 區塊不會自動拿到變數——沙箱裡不會被注入任何東西。把 `{{global.variables.NAME}}`（或任何元件參照）放進區塊的 **Arguments** JSON 欄位；那些值會在腳本執行前先被代入，並以 `args` 的形式送進去。

## 迭代陣列

在文字欄位裡，你可以用 `{{#each path}}…{{/each}}` 迭代一個陣列。在這個區塊內，`{{property}}` 讀的是目前這個元素，`{{@index}}` 是從 0 開始算的位置，而 `{{this}}` 是元素本身，適用於純值組成的陣列。`{{#each}}` 區塊裡的名稱會被去掉前後空白，所以多餘的空格在那裡沒有影響——其他地方可就不是這樣。

## 範例

### 用 webhook 的資料組出酬載

一個 webhook 進來，內文長得像 `{ "service": "checkout", "status": "failed" }`。要把它變成一則 OneUptime 事件：

1. **Webhook** 觸發器，id 是 `ci-webhook`。
2. **If / Else** 區塊：選 webhook 的 Request Body 輸出，取它的 `status` 屬性，運算子用 `==`，右邊填 `failed`。
3. 從 **是** 分支接一個 **Create One Incident** 區塊，設定成：
   - 標題：`CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - 描述：`See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### 在 API 呼叫裡用一把密鑰

一個呼叫 PagerDuty 的工作流程：

1. 把 `PAGERDUTY_KEY` 存成密鑰全域變數。
2. 在 **API** 區塊上，把 `Authorization` 標頭設成 `Token token={{global.variables.PAGERDUTY_KEY}}`。

這把金鑰不會出現在工作流程裡，也不會出現在日誌裡。

### 串接兩個 API 呼叫

第一個呼叫會給你第二個呼叫需要的 ID：

1. **API** 元件 `lookup-order`：用選擇器把 Manual 觸發器 JSON 裡的 email 欄位插進 `GET /orders?email=...`。
2. **API** 元件 `cancel-order`：`POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`。

如果 `lookup-order` 失敗，走的會是它的 **錯誤** 輸出而不是 **成功**。把那條接到電子郵件或 Slack 區塊，失敗才不會沒人發現。

## 從工作流程更新變數

一個常見的做法是按排程輪替憑證：從第三方拿一把新的權杖，再把它存回變數裡，讓下一次執行就用得到。這件事用 **API** 區塊呼叫 OneUptime API 來做。

`PUT /api/workflow-variable/<variable-id>`，帶上 `ApiKey` 標頭，然後——這就是大家最常卡住的地方——你想改的欄位要 **包在一個 `data` 物件裡**：

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

沒有 `data` 這層外殼的扁平內文會被以 400 拒絕。只送你真正想改的欄位；`name` 和 `description` 可以完全不放進酬載。

這把 API 金鑰需要 **Edit Workflow Variables**。不需要讀取權限——這次更新不會把那一列讀回來。

有兩件事要留意：

- **不要改掉你正在參照的變數名稱。** `name` 是 `{{local.variables.NAME}}` 的一部分。改掉它會讓每一個既有的參照都解析不了，而解析不了的參照會被當成字面文字直接送出去——見下面的陷阱。
- **變數可以用這種方式寫進去，但永遠讀不回來。** 不論是不是密鑰，每個變數的 `content` 透過 API 都是唯寫的。這正是變數適合拿來擺輪替權杖的原因。額外把它標成密鑰，還能讓值不出現在執行日誌和步驟追蹤裡。

## 陷阱

- **善用選擇器。** 它們插入的是執行器真正認得的元件、回傳值和變數 id，也讓參照不受顯示標籤影響。
- **變數名稱區分大小寫。** `{{global.variables.MyKey}}` 和 `{{global.variables.mykey}}` 是兩回事。
- **解析不了的參照會原樣留著，不會被清空。** 指向不存在的東西不算錯誤，也不會給你一個空字串：那對大括號會被原封不動送過去，所以步驟 id 打錯的 `{{local.components.api-get-1.returnValues.body}}` 會一字不差地出現在你的 Slack 訊息、網址或請求內文裡，而那次執行仍然報 **Executed**。執行日誌裡會有一行警告，指名任何溜過去的參照。
- **建構器檢查不了變數名稱。** 它會在你儲存前標出比對不到的元件參照——不存在的步驟 id、不存在的回傳值、格式錯誤的根節點。但它無法判斷某個變數存不存在，所以改過名字的變數只能靠執行日誌抓出來。
- **大括號裡的空格不會被去掉。** `{{ local.variables.NAME }}` 和 `{{local.variables.NAME}}` 是兩個不同的查找，而且前者永遠解析不到。唯一的例外是在 `{{#each}}` 區塊裡，那裡的名稱會被去掉前後空白。

## 接下來可以閱讀

- [工作流程元件](/docs/workflows/components)——每個區塊會產出哪些輸出的完整清單。
- [工作流程執行與日誌](/docs/workflows/runs-and-logs)——執行過後查看每個變數的實際值。
- [工作流程設定與安全](/docs/workflows/configuration)——什麼東西適合放進全域變數。
