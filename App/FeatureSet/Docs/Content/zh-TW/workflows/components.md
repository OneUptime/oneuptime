# 元件

元件是你在觸發器之後加上去的積木。每一個只做一件事——送一則訊息、呼叫一支 API、檢查一個條件——然後接到後面的東西。

這一頁是型錄。想知道怎麼在畫布上加入和連接它們，請見[建立工作流程](/docs/workflows/authoring)。

## API

對任何網址發出一個 HTTP 請求。

**設定**：

- **Method**——`GET`、`POST`、`PUT`、`PATCH` 或 `DELETE`。
- **URL**——要呼叫的位址。
- **Headers**——要送出去的標頭。
- **Body**——`POST` / `PUT` / `PATCH` 的請求內文。

**輸出**：

- **成功**——呼叫成功（2xx 回應）時觸發。會把狀態、標頭和內文一併傳下去。
- **錯誤**——網路失敗或非 2xx 回應時觸發。會把錯誤訊息傳下去。

適合用在：任何外部 API、你自己的管理端點，或任何還沒有專屬元件的整合。

## AI

### Generate Text with AI

依一段提示和選填的 JSON 情境，產生一則文字回應。這個元件使用專案設定的預設 LLM 提供者，若安裝層級有全域提供者可用，就退回用那一個。提供者的憑證和端點是集中設定的，不是工作流程的參數。

**設定**：

- **System Instructions**——選填，用來指引模型的角色、語氣和限制。
- **Prompt**——必填的任務內容。裡面可以放工作流程變數和前面元件的輸出。
- **Context**——選填的 JSON，是你刻意隨請求一起帶上的。它會被接在一個明確的訊息結束信任標記之後，在訊息剩下的部分裡一律當成不可信的資料看待。
- **Temperature**——變化程度，從 `0` 到 `1`。預設是 `0.2`，讓自動化的結果好預期。
- **Maximum Output Tokens**——從 `1` 到 `4096`。預設是 `1024`。

System Instructions、Prompt 和序列化後的 Context 合計上限是 50,000 個字元。對提供者的請求最長 60 秒，而且只嘗試一次。每個專案最多同時跑三個工作流程 AI 請求。

**輸出**：

- **Response**——產生出來的文字。
- **提供者** 和 **Model**——這次呼叫用到的設定。
- **Total Tokens** 和 **Completion Tokens**——提供者回報的用量。
- **LLM Log ID**——這次呼叫在計量 AI 日誌裡的那筆紀錄。
- **錯誤**——驗證、存取、提供者、預算、計費或逾時的錯誤，有的話才會出現。

把 **成功** 接到應該使用這則回應的元件。把 **錯誤** 接到明確的備援、警示或記錄路徑。這個元件只發出一次模型請求，不帶任何工具定義或提供者原生的能力欄位：它自己沒辦法查詢 OneUptime、呼叫 API，也不能更動專案資料。除了 OneUptime 固定的元件安全指示之外，送到提供者那邊的只有你設定的 System Instructions、Prompt 和 Context，而且是在這些欄位裡的工作流程變數解析之後才送出。設定好的提供者／模型仍然是一道信任邊界，因為模型可能帶有提供者自行管理的內建能力。

模型的輸出是不可信的文字。拿去發送面向客戶的訊息之前先看過，也不要只憑一段自由格式的 AI 文字就授權會造成破壞的工作流程動作。提供者、對外流量、日誌與成本的細節請見[工作流程設定與安全](/docs/workflows/configuration)。

## Webhook（出站）

API 元件的簡化版，適合「送出去就不管」的情況。把一段 JSON 內文 POST 到某個網址。

需要讀回應就用 **API**。只是想送一則通知然後繼續往下走，就用 **Webhook**。

## Slack

把訊息貼到某個 Slack 頻道。

**設定**：

- **頻道**——頻道名稱。機器人必須已經在那個頻道裡。
- **訊息**——要送出的文字。支援 Slack 的格式語法。

請先在 **專案設定 → 工作區 → Slack** 底下把 Slack 連到你的專案。請見 [Slack 工作區連線](/docs/workspace-connections/slack)。

## Microsoft Teams

把訊息貼到某個 Microsoft Teams 頻道。

**設定**：

- **團隊與頻道**——要貼到哪裡。
- **訊息**——要送出的文字。

設定方式請見 [Microsoft Teams 工作區連線](/docs/workspace-connections/microsoft-teams)。

## Discord

透過傳入 webhook 網址，把訊息貼到某個 Discord 頻道。

## Telegram

用機器人權杖和聊天 ID，送一則訊息到 Telegram 的聊天室。

## Email

透過 OneUptime 寄出一封電子郵件。

**設定**：

- **收件者**——收件人的電子郵件地址。
- **主旨**——主旨列。
- **Body**——用 Markdown 或 HTML 寫的郵件內容。

郵件會從你專案設定好的寄件者送出——請見 [SMTP](/docs/emails/smtp)。

## Custom Code

當你需要其他區塊做不到的事情時，跑一小段 JavaScript。

**設定**：

- **代碼**——你的 JavaScript。最後一個值（或你從 async 函式回傳的東西）就是這個區塊的輸出。
- **Arguments**——你可以傳進去的具名值。

**輸出**：成功（你的回傳值）和錯誤（任何例外）。

適合用在：在兩套系統之間重塑資料、做個小計算，或任何不值得擁有專屬區塊的事。比較繁重的腳本工作，請改用 [Runbook](/docs/runbooks/index)。

## JSON

在文字和 JSON 之間轉換。

- **JSON → Text**——把 JSON 物件變成字串。當下一個區塊需要的是文字時很好用。
- **Text → JSON**——把字串解析成 JSON 物件。當某個東西是以文字送來、而你需要讀其中一個欄位時很好用。

## Conditions

依比較的結果分支。在 **新增元件** 面板裡，這個區塊叫做 **If / Else**，歸在條件分類底下。

**設定**：

- **Left value**——通常是前面某個區塊來的值。
- **Operator**——`==`、`!=`、`>`、`>=`、`<`、`<=`、`contains`、`starts with`、`ends with`。
- **Right value**——要拿來比對的東西。

**輸出**：**是** 和 **否**。把後面的區塊接到你想要的那個分支上。

## Delay

在繼續之前，讓工作流程暫停一段設定好的時間。當你需要給另一套系統一點時間跟上時很有用。

## Log

在執行日誌裡寫一行。沒有任何對外的效果——它只會出現在工作流程的日誌裡給你看。除錯時很方便。

## Execute Workflow

從這個工作流程呼叫另一個工作流程。被呼叫的那個會自己獨立跑——你的工作流程不等它跑完就繼續往下。

用這個來共用共通的邏輯。把「貼到事件頻道」做成一個工作流程，之後任何需要通知那個頻道的工作流程都可以呼叫它。

有一道安全上限，讓工作流程不會沒完沒了地互相呼叫下去。請見[工作流程設定與安全](/docs/workflows/configuration)。

## OneUptime 資料元件

OneUptime 裡每一種記錄（監測器、事件、警示、狀態頁面、待命策略，還有很多其他的），在 **新增元件** 面板裡都有下面這些元件——用該類型的名稱搜尋就找得到。每個標題都是從記錄類型產生出來的，所以 Monitor 這一組讀起來是這樣：

- **Find One Monitor**——讀取一筆符合查詢的記錄。
- **Find Many Monitors**——讀取一份符合查詢的記錄清單。
- **Create One Monitor**——用一個 JSON 物件新增一筆記錄。
- **Create Many Monitors**——用一個 JSON 陣列新增多筆記錄。
- **Update One Monitor**——把要寫入的酬載套用到一筆符合的記錄上。
- **Update Many Monitors**——把要寫入的酬載套用到符合的記錄上，數量以 Limit 為上限。
- **Delete One Monitor**——刪掉一筆符合的記錄。
- **Delete Many Monitors**——刪掉符合的記錄，數量以 Limit 為上限。

同一組還會給你三個觸發器——**On Create Monitor**、**On Update Monitor** 和 **On Delete Monitor**。請見[工作流程觸發器](/docs/workflows/triggers)。

一種類型只會提供它的模型允許的元件。唯讀的類型只有那兩個 Find 元件，別的都沒有，所以如果你在面板裡找不到 **Delete One Monitor**，就表示那個類型不允許。

工作流程就是這樣讀取和變更 OneUptime 資料的。舉例來說：你 CI 工具送來的 webhook，可以用 **Create One Incident** 開一則帶著失敗細節的事件。

## 操作記錄

資料元件上的每個欄位，都是以記錄自身的**資料欄**名稱為鍵——就是 API 用的那些名稱，不是儀表板表單上的標籤。ID 資料欄是 `_id`。任何可以打資料欄名稱的地方都接受 `id` 這種寫法當別名，但記錄回傳的是 `_id`，所以往外讀的時候要讀這個：

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** 決定元件要對哪些記錄動作。鍵是資料欄，值是要比對的內容：

```json
{ "monitorType": "Website", "isEnabled": true }
```

查詢永遠限縮在工作流程執行所在的那個專案裡。你碰不到別的專案的記錄，也不需要自己把專案條件加進查詢。

Create One 上的 **JSON Object**、Create Many 上的 **JSON Array**，以及 Update 元件上的 **Data (JSON Object)**，帶的是要寫入的欄位，鍵的規則一樣：

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

不是資料欄的鍵會被忽略，而不是被拒絕——執行日誌會寫出它丟掉了哪些，所以某個欄位沒寫進去時就去那裡看。Find 元件和觸發器上的 **Select Fields** 用的是同一套資料欄鍵，值填 `true`：`{"_id": true, "name": true}`。

**略過** 和 **Limit** 是 Find Many、Update Many 和 Delete Many 上的兩個數字欄位——`Skip: 0` 搭配 `Limit: 100` 會取前一百筆符合的記錄。Limit 預設是 `10`，而在 Update Many 和 Delete Many 上，它限制的是真正被寫入的記錄數，不只是回傳幾筆。所以 `Items Deleted: 10` 的意思是刪掉了十筆，不是有十筆符合。打算改動超過十筆時，記得把 Limit 調高。

**成功** 和 **錯誤** 回報的是查詢有沒有跑起來，不是它找到了什麼。什麼都沒比對到的查詢會回傳 `0`，而且照樣從 **成功** 走出去——那不算失敗。要依有沒有比對到東西來分支，就在 **If / Else** 區塊裡讀回傳的筆數。

## 我該用哪一個元件？

幾條快速的規則：

- 如果你要做的事有專屬區塊（Slack、Email、某種 OneUptime 記錄），就用它——錯誤處理比較好，日誌也比較清楚。
- 其他任何外部 API，就用 **API**。
- 要從你明確選定的工作流程資料裡摘要、分類或起草文字，就用 **Generate Text with AI**。
- 要在區塊之間重塑資料，用 **Custom Code** 或 **JSON**。
- 要依某個值採取不同動作，用 **Conditions**。

## 接下來可以閱讀

- [工作流程變數](/docs/workflows/variables)——在區塊之間傳遞資料。
- [工作流程執行與日誌](/docs/workflows/runs-and-logs)——查看某次執行裡每個區塊做了什麼。
- [工作流程設定與安全](/docs/workflows/configuration)——上限、擁有者和密鑰。
