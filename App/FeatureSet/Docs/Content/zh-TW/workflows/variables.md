# 變數

Workflows 的核心是讓資料流動——從觸發器流向第一個區塊、從一個區塊流向下一個區塊，以及將共用值帶到任何你需要的地方。變數就是資料流動的方式。

變數有兩種，它們使用相同的語法。

## 全域變數

這些是專案範圍的值，你只需儲存一次便能在任何地方重複使用。例如 API 金鑰、URL、頻道名稱——任何你不想複製到十個不同 Workflows 的內容。

你可以在 **Workflows → Global Variables** 底下找到它們。每一個都有：

- **Name** — 你將如何引用它。請使用 `UPPER_SNAKE_CASE`，讓它在你的區塊中更醒目。
- **Value** — 實際的值。多行的值也可以。
- **Is Secret** — 開啟時，該值在儲存後會於 UI 中隱藏，並且不會出現在執行記錄中。

在任何 Workflow 中使用全域變數的方式如下：

```
{{variable.NAME}}
```

舉例來說，如果你將 PagerDuty 金鑰儲存為 `PAGERDUTY_KEY`，任何區塊都可以用 `{{variable.PAGERDUTY_KEY}}` 來使用它——真正的金鑰絕不會出現在 Workflow 或其記錄中。

## 區域變數（來自先前區塊的資料）

區域變數是本次執行中已經執行過的區塊所產生的輸出。每個觸發器和每個元件都會產生一些你可以讀取的輸出。

引用先前區塊輸出的方式如下：

```
{{BlockName.fieldName}}
```

`BlockName` 是畫布上觸發器或元件的名稱（你可以將它重新命名為簡短而清楚的名稱）。`fieldName` 則是該區塊所產生的任何內容。

範例：

- 在名為 `LookupUser` 的 **API** 區塊執行後，你可以用 `{{LookupUser.response-status}}` 讀取狀態碼，並用 `{{LookupUser.response-body}}` 讀取主體。
- 在名為 `Incident` 的 **Incident → On Create** 觸發器執行後，你可以讀取 `{{Incident.title}}`、`{{Incident.description}}`，以及該事件上的任何其他欄位。
- 在名為 `Transform` 的 **Custom Code** 區塊執行後，回傳的值會位於 `{{Transform.value}}`。

區域變數只在目前的執行期間存在。每次新的執行都會重新開始。

## 變數可在哪裡使用

幾乎每個文字欄位都接受變數：

- API 區塊上的 URL。
- Slack、Teams、Discord、Telegram、Email 上的訊息文字。
- 電子郵件的主旨和主體。
- 標頭和主體欄位（在字串值內）。
- Conditions 區塊的兩側。

純 JSON 欄位在字串值內接受變數，但你無法將變數用作鍵（key）。如果你需要動態建構結構，請使用 **Custom Code** 區塊來建構它，然後將其輸出傳遞給下一個區塊。

**Custom Code** 區塊讀取變數的方式不同——全域變數會透過 `args.variables` 傳入，而你可以決定要將哪些先前的輸出作為引數傳入。

## 範例

### 從 webhook 建構 payload

一個 webhook 帶著像 `{ "service": "checkout", "status": "failed" }` 這樣的主體抵達。若要將其轉換為 OneUptime 事件：

1. 名為 `CIWebhook` 的 **Webhook** 觸發器。
2. **Conditions** 區塊：左側 `{{CIWebhook.Request Body.status}}`、運算子 `==`、右側 `failed`。
3. 從 **Yes** 分支連到一個 **Create Incident** 區塊，內容為：
   - Title：`CI build failed: {{CIWebhook.Request Body.service}}`
   - Description：`See {{CIWebhook.Request Body.url}} for the logs.`

### 在 API 呼叫中使用密鑰

一個呼叫 PagerDuty 的 Workflow：

1. 將 `PAGERDUTY_KEY` 儲存為密鑰（secret）全域變數。
2. 在 **API** 區塊上，將 `Authorization` 標頭設定為 `Token token={{variable.PAGERDUTY_KEY}}`。

金鑰會保持在 Workflow 和記錄之外。

### 串接兩個 API 呼叫

第一個呼叫提供第二個呼叫所需的 ID：

1. **API** 區塊 `LookupOrder`：`GET /orders?email={{Manual.JSON.email}}`。
2. **API** 區塊 `CancelOrder`：`POST /orders/{{LookupOrder.response-body.id}}/cancel`。

如果 `LookupOrder` 失敗，會觸發它的 **error** 輸出，而非 **success**。將其連接到 Email 或 Slack 區塊，這樣失敗就不會被忽略。

## 注意事項

- **重新命名區塊會破壞引用。** 如果你重新命名一個區塊，請更新它被使用的每一個地方。在執行記錄中，未解析的引用會以字面的 `{{BlockName.field}}` 文字顯示。
- **變數名稱區分大小寫。** `{{variable.MyKey}}` 和 `{{variable.mykey}}` 是不同的。
- **缺少的欄位會變成空字串。** 引用一個不存在的欄位會得到空字串，而不是錯誤。這很方便——但也可能隱藏 bug。請使用 **Conditions** 區塊在繼續之前檢查重要欄位。

## 接下來閱讀

- [Components](/docs/workflows/components) — 每個區塊所產生輸出的完整清單。
- [Runs & Logs](/docs/workflows/runs-and-logs) — 在執行後查看每個變數的實際值。
- [Configuration & Safety](/docs/workflows/configuration) — 哪些內容適合放入全域變數。
