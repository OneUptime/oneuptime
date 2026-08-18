# 元件

元件是你在觸發器之後加入的建構單元。每一個都只做一件事——傳送訊息、呼叫 API、檢查條件——並連接到接下來的任何元件。

本頁是元件目錄。關於如何在畫布上新增與連接它們，請參閱[建立工作流程](/docs/workflows/authoring)。

## API

向任何 URL 發出 HTTP 請求。

**Settings**：

- **Method**——`GET`、`POST`、`PUT`、`PATCH` 或 `DELETE`。
- **URL**——要呼叫的位址。
- **Headers**——要傳送的任何標頭。
- **Body**——`POST` / `PUT` / `PATCH` 的請求主體。

**Outputs**：

- **Success**——當呼叫成功時觸發（2xx 回應）。一併傳遞狀態碼、標頭與主體。
- **Error**——在網路失敗或非 2xx 回應時觸發。一併傳遞錯誤訊息。

適用於：任何外部 API、你自己的管理端點，或任何沒有專屬元件的整合。

## AI

### Generate Text with AI

根據提示與選填的 JSON 情境內容，產生一則文字回應。此元件會使用專案所設定的預設 LLM 供應商，若沒有設定，則回退至安裝層級的全域供應商。供應商憑證與端點是集中設定的，並非工作流程參數。

**Settings**：

- **System Instructions**——選填，用來指引模型的角色、語氣與限制。
- **Prompt**——必填的任務內容。可以包含工作流程變數與先前元件的輸出。
- **Context**——選填的 JSON，由你刻意隨請求一併附上。它會被附加在一個明確的訊息結尾信任標記之後，並在該訊息其餘部分中被視為不可信資料。
- **Temperature**——變化程度，範圍從 `0` 到 `1`。預設值為 `0.2`，以求自動化結果可預測。
- **Maximum Output Tokens**——範圍從 `1` 到 `4096`。預設值為 `1024`。

System Instructions、Prompt 與序列化後的 Context 合計上限為 50,000 個字元。對供應商的請求最長持續 60 秒，且只會嘗試一次。每個專案最多可同時執行三個工作流程 AI 請求。

**Outputs**：

- **Response**——產生的文字。
- **Provider** 與 **Model**——該次呼叫所使用的設定。
- **Total Tokens** 與 **Completion Tokens**——供應商回報的使用量。
- **LLM Log ID**——該次呼叫的計量 AI 日誌項目。
- **Error**——出現時的驗證、存取、供應商、預算、帳務或逾時錯誤。

將 **Success** 連接到會使用該回應的元件。將 **Error** 連接到明確的備援、警示或記錄路徑。此元件僅發出一次不含工具定義或供應商原生能力欄位的模型請求：它無法自行查詢 OneUptime、呼叫 API，或變更專案資料。除了 OneUptime 固定的元件安全指示之外，只有你所設定的 System Instructions、Prompt 與 Context 會在其中的工作流程變數被解析後送往供應商。所設定的供應商／模型仍是一道信任邊界，因為模型本身可能具備供應商管理的內建能力。

模型輸出屬於不可信文字。在傳送給客戶的溝通內容之前請先審閱，也不要單獨使用自由格式的 AI 文字來授權具破壞性的工作流程動作。供應商、對外連線、記錄與成本的細節，請參閱[設定與安全](/docs/workflows/configuration)。

## Webhook（出站）

API 元件的簡化版本，適用於「發送後不理會」的情境。將 JSON 主體 POST 到某個 URL。

如果你需要讀取回應，請使用 **API**。如果你只想送出通知然後繼續，請使用 **Webhook**。

## Slack

將訊息張貼到 Slack 頻道。

**Settings**：

- **Channel**——頻道名稱。機器人必須已經在該頻道中。
- **Message**——要傳送的文字。支援 Slack 格式設定。

請先在 **Project Settings → Workspace → Slack** 下將 Slack 連接到你的專案。請參閱 [Slack Workspace Connection](/docs/workspace-connections/slack)。

## Microsoft Teams

將訊息張貼到 Microsoft Teams 頻道。

**Settings**：

- **Team and channel**——張貼的位置。
- **Message**——要傳送的文字。

設定方式請參閱 [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams)。

## Discord

透過傳入 webhook URL 將訊息張貼到 Discord 頻道。

## Telegram

使用機器人權杖與聊天室 ID，將訊息傳送到 Telegram 聊天室。

## Email

透過 OneUptime 傳送電子郵件。

**Settings**：

- **To**——收件者的電子郵件位址。
- **Subject**——主旨列。
- **Body**——以 Markdown 或 HTML 撰寫的訊息。

電子郵件會從你專案所設定的寄件者送出——請參閱 [SMTP](/docs/emails/smtp)。

## Custom Code

當你需要其他區塊無法完成的功能時，執行一小段 JavaScript。

**Settings**：

- **Code**——你的 JavaScript。最後一個值（或你從非同步函式回傳的內容）會成為該區塊的輸出。
- **Arguments**——你可以傳入的具名值。

**Outputs**：success（你的回傳值）與 error（任何例外狀況）。

適用於：在兩個系統之間重塑資料、進行小型計算，或任何不值得擁有專屬區塊的工作。若需要較繁重的指令碼撰寫，請改用 [Runbook](/docs/runbooks/index)。

## JSON

在文字與 JSON 之間進行轉換。

- **JSON → Text**——將 JSON 物件轉成字串。當下一個區塊需要文字時很有用。
- **Text → JSON**——將字串解析為 JSON 物件。當某些內容以文字形式抵達，而你需要讀取某個欄位時很有用。

## Conditions

依據比較結果進行分支。在 **Add Component** 面板中，此區塊在 Conditions 類別下稱為 **If / Else**。

**Settings**：

- **Left value**——通常是來自先前區塊的值。
- **Operator**——`==`、`!=`、`>`、`>=`、`<`、`<=`、`contains`、`starts with`、`ends with`。
- **Right value**——要比較的對象。

**Outputs**：**Yes** 與 **No**。將接下來的區塊連接到你想要的任一分支。

## Delay

在繼續之前，讓工作流程暫停一段設定的時間。當你需要給另一個系統一點時間趕上時很有用。

## Log

將一行內容寫入執行日誌。沒有外部作用——它只會顯示在工作流程的日誌中供你閱讀。對除錯很方便。

## Execute Workflow

從目前的工作流程呼叫另一個工作流程。被呼叫的工作流程會獨立執行——你的工作流程會繼續進行，而不會等待它完成。

使用此元件可共用通用邏輯。只需建立一次「張貼到事件頻道」工作流程，然後從任何其他需要通知該頻道的工作流程呼叫它。

有一個安全限制，使工作流程不能持續以迴圈方式互相呼叫。請參閱[設定與安全](/docs/workflows/configuration)。

## OneUptime 資料元件

對於 OneUptime 中每一種記錄類型（監視器、事件、警示、狀態頁面、待命政策，以及更多），**Add Component** 面板都有這些元件——以該類型的名稱搜尋即可。每個標題都是由記錄類型產生的，因此 Monitor 這一組是：

- **Find One Monitor**——讀取一筆符合查詢條件的記錄。
- **Find Many Monitors**——讀取符合查詢條件的記錄清單。
- **Create One Monitor**——以 JSON 物件新增一筆記錄。
- **Create Many Monitors**——以 JSON 陣列新增多筆記錄。
- **Update One Monitor**——將寫入酬載套用到一筆符合條件的記錄。
- **Update Many Monitors**——將寫入酬載套用到符合條件的記錄，最多至 Limit。
- **Delete One Monitor**——刪除一筆符合條件的記錄。
- **Delete Many Monitors**——刪除符合條件的記錄，最多至 Limit。

同一組還提供三個觸發器——**On Create Monitor**、**On Update Monitor** 與 **On Delete Monitor**。請參閱[觸發器](/docs/workflows/triggers)。

某個類型只會提供其模型所允許的元件。唯讀的類型只有兩個 Find 元件，別無其他，因此如果你在面板中找不到 **Delete One Monitor**，代表該類型不允許這項操作。

這就是工作流程讀取與變更 OneUptime 資料的方式。例如：來自你 CI 工具的 webhook 可以使用 **Create One Incident**，以失敗的詳細資訊開啟一個事件。

## 操作記錄

資料元件上的每個欄位，鍵值都對應到記錄本身的**欄（column）**名稱——與 API 所使用的名稱相同，而不是儀表板表單上顯示的標籤。ID 欄是 `_id`。在任何可以輸入欄名稱的地方，`id` 這個拼法也會被接受為別名，但記錄回傳的是 `_id`，所以讀取時要留意的就是這個：

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** 決定該元件會作用於哪些記錄。鍵是欄名，值是要比對的內容：

```json
{ "monitorType": "Website", "isEnabled": true }
```

查詢一律以工作流程所執行的專案為範圍。你無法觸及其他專案的記錄，也不需要自行將專案加入查詢中。

Create One 上的 **JSON Object**、Create Many 上的 **JSON Array**，以及 Update 元件上的 **Data (JSON Object)**，都是要寫入的欄位，鍵值的方式相同：

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

不是欄名的鍵會被忽略而非拒絕——執行日誌會列出被捨棄的鍵，因此當某個欄位沒有生效時，可以到那裡查看。Find 元件與觸發器上的 **Select Fields**，使用同樣的欄鍵，並搭配 `true` 值：`{"_id": true, "name": true}`。

**Skip** 與 **Limit** 是 Find Many、Update Many 與 Delete Many 上的兩個數字欄位——`Skip: 0` 搭配 `Limit: 100` 會取前一百筆符合的記錄。Limit 預設為 `10`，而在 Update Many 與 Delete Many 上，它限制的是實際被寫入的記錄數，而不只是回傳的筆數。因此 `Items Deleted: 10` 代表刪除了十筆記錄，而不是有十筆符合條件。若你打算變更超過十筆記錄，請提高 Limit。

**Success** 與 **Error** 回報的是查詢是否有執行，而不是它找到了什麼。查詢沒有比對到任何內容時會回傳 `0`，並仍然從 Success 離開——這不算失敗。若要依據是否有比對結果來分支，請在 **If / Else** 區塊中讀取回傳的筆數。

## 我應該使用哪個元件？

幾個快速原則：

- 如果有專屬區塊可以滿足你的需求（Slack、Email、某個 OneUptime 記錄），就使用它——你會獲得更好的錯誤處理與更清楚的日誌。
- 對於任何其他外部 API，請使用 **API**。
- 若要根據明確選取的工作流程資料來摘要、分類或起草文字，請使用 **Generate Text with AI**。
- 若要在區塊之間重塑資料，請使用 **Custom Code** 或 **JSON**。
- 若要依據某個值採取不同的動作，請使用 **Conditions**。

## 接下來可以閱讀

- [變數](/docs/workflows/variables)——在區塊之間傳遞資料。
- [執行與日誌](/docs/workflows/runs-and-logs)——檢查每個區塊在某次執行中做了什麼。
- [設定與安全](/docs/workflows/configuration)——限制、擁有者與密鑰。
