# 元件

元件是您在觸發器之後加入的建構單元。每個元件只做一件事——傳送訊息、呼叫 API、檢查條件——並連接到接下來的任何元件。

本頁是元件目錄。關於如何在畫布上拖放與連接它們，請參閱[撰寫工作流程](/docs/workflows/authoring)。

## API

向任何 URL 發出 HTTP 請求。

**設定**：

- **Method** — `GET`、`POST`、`PUT`、`PATCH` 或 `DELETE`。
- **URL** — 要呼叫的位址。
- **Headers** — 要傳送的任何標頭。
- **Body** — `POST` / `PUT` / `PATCH` 的請求主體。

**輸出**：

- **Success** — 當呼叫成功時觸發（2xx 回應）。一併傳遞狀態、標頭與主體。
- **Error** — 在網路失敗或非 2xx 回應時觸發。一併傳遞錯誤訊息。

適用於：任何外部 API、您自己的管理端點，或任何沒有專屬元件的整合。

## Webhook（出站）

API 元件的簡化版本，適用於「發送後不理會」的情境。將 JSON 主體 POST 到某個 URL。

如果您需要讀取回應，請使用 **API**。如果您只想送出通知然後繼續，請使用 **Webhook**。

## Slack

將訊息張貼到 Slack 頻道。

**設定**：

- **Channel** — 頻道名稱。機器人必須已經在該頻道中。
- **Message** — 要傳送的文字。支援 Slack 格式設定。

請先在 **Project Settings → Workspace Connections → Slack** 下將 Slack 連接到您的專案。請參閱 [Slack 工作區連線](/docs/workspace-connections/slack)。

## Microsoft Teams

將訊息張貼到 Microsoft Teams 頻道。

**設定**：

- **Team and channel** — 張貼的位置。
- **Message** — 要傳送的文字。

設定方式請參閱 [Microsoft Teams 工作區連線](/docs/workspace-connections/microsoft-teams)。

## Discord

透過傳入的 webhook URL 將訊息張貼到 Discord 頻道。

## Telegram

使用機器人權杖（bot token）與 chat ID 將訊息傳送到 Telegram 聊天室。

## Email

透過 OneUptime 傳送電子郵件。

**設定**：

- **To** — 收件者的電子郵件位址。
- **Subject** — 主旨列。
- **Body** — 以 Markdown 或 HTML 撰寫的訊息。

電子郵件會從您專案所設定的寄件者送出——請參閱 [SMTP](/docs/emails/smtp)。

## Custom Code

當您需要其他區塊無法完成的功能時，執行一小段 JavaScript。

**設定**：

- **Code** — 您的 JavaScript。最後一個值（或您從非同步函式回傳的內容）會成為該區塊的輸出。
- **Arguments** — 您可以傳入的具名值。

**輸出**：success（您的回傳值）與 error（任何例外狀況）。

適用於：在兩個系統之間重塑資料、進行小型計算，或任何不值得擁有專屬區塊的工作。若需要較繁重的指令碼撰寫，請改用 [Runbook](/docs/runbooks/index)。

## JSON

在文字與 JSON 之間進行轉換。

- **JSON → Text** — 將 JSON 物件轉成字串。當下一個區塊需要文字時很有用。
- **Text → JSON** — 將字串解析為 JSON 物件。當某些內容以文字形式抵達而您需要讀取某個欄位時很有用。

## Conditions

依據比較結果進行分支。

**設定**：

- **Left value** — 通常是來自先前區塊的值。
- **Operator** — `==`、`!=`、`>`、`>=`、`<`、`<=`、`contains`、`starts with`、`ends with`。
- **Right value** — 要比較的對象。

**輸出**：**Yes** 與 **No**。將接下來的區塊連接到您想要的任一分支。

## Delay

在繼續之前，讓工作流程暫停一段設定的時間。當您需要給另一個系統一點時間趕上時很有用。

## Log

將一行內容寫入執行記錄。沒有外部作用——它只會顯示在工作流程的記錄中供您閱讀。對於除錯很方便。

## Execute Workflow

從目前的工作流程呼叫另一個工作流程。被呼叫的工作流程會獨立執行——您的工作流程會繼續進行，而不會等待它完成。

使用此元件可共用通用邏輯。只需建立一次「張貼到事件頻道」工作流程，然後從任何其他需要通知該頻道的工作流程呼叫它。

有一個安全限制，使工作流程不能持續以迴圈方式互相呼叫。請參閱[組態與安全](/docs/workflows/configuration)。

## OneUptime 資料元件

對於 OneUptime 中每一種記錄（監視器、事件、警示、狀態頁面、待命政策，以及更多），調色盤都有這些元件——以類型名稱搜尋：

- **Find One** — 依 ID 或篩選條件取得一筆記錄。
- **Find** — 取得記錄清單。
- **Create** — 新增一筆記錄。
- **Update** — 變更一筆記錄。
- **Delete** — 移除一筆記錄。
- **Count** — 計算符合篩選條件的記錄數量。

這就是工作流程讀取與變更 OneUptime 資料的方式。例如：來自您 CI 工具的 webhook 可以使用 **Create Incident**，以失敗的詳細資訊開啟一個事件。

## 我應該使用哪個元件？

幾個快速原則：

- 如果有專屬區塊可以滿足您的需求（Slack、Email、某個 OneUptime 記錄），就使用它——您會獲得更好的錯誤處理與更清楚的記錄。
- 對於任何其他外部 API，請使用 **API**。
- 若要在區塊之間重塑資料，請使用 **Custom Code** 或 **JSON**。
- 若要依據某個值採取不同的動作，請使用 **Conditions**。

## 接下來閱讀的內容

- [變數](/docs/workflows/variables) — 在區塊之間傳遞資料。
- [執行與記錄](/docs/workflows/runs-and-logs) — 檢查每個區塊在某次執行中做了什麼。
- [組態與安全](/docs/workflows/configuration) — 限制、擁有者與密鑰。
