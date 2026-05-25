# 變量

工作流的核心是數據流動——從觸發器到第一個模塊、從一個模塊到下一個、從共享的值到任何需要的地方。變量就是數據流動的方式。

有兩種,它們共用同一種語法。

## 全局變量

項目級的值,保存一次就可以在任何地方複用。比如 API 密鑰、URL、頻道名——任何你不想複製到十個不同工作流裏的東西。

在 **工作流 → 全局變量** 下查看。每個變量有:

- **名稱**——你引用它的方式。使用 `UPPER_SNAKE_CASE`,這樣在模塊裏更顯眼。
- **值**——實際的值。也支持多行值。
- **是否密鑰**——開啓後,保存之後值會在 UI 中隱藏,並且不會出現在運行日誌裏。

在任意工作流中用以下語法引用全局變量:

```
{{variable.NAME}}
```

例如,如果你保存了 PagerDuty 密鑰爲 `PAGERDUTY_KEY`,任意模塊都可以用 `{{variable.PAGERDUTY_KEY}}` 引用它——真正的密鑰不會出現在工作流或它的日誌中。

## 局部變量(來自前面模塊的數據)

局部變量是本次執行中已經運行的模塊的輸出。每個觸發器和每個組件都會產生一些可以讀取的輸出。

像這樣引用前一個模塊的輸出:

```
{{BlockName.fieldName}}
```

`BlockName` 是畫布上觸發器或組件的名稱(你可以把它改成簡短清晰的名字)。`fieldName` 是該模塊產生的內容。

示例:

- 一個名爲 `LookupUser` 的 **API** 模塊運行後,你可以讀取狀態碼 `{{LookupUser.response-status}}` 和響應體 `{{LookupUser.response-body}}`。
- 在一個名爲 `Incident` 的 **事件 → 創建時** 觸發器之後,你可以讀取 `{{Incident.title}}`、`{{Incident.description}}` 以及事件上的任意其他字段。
- 在一個名爲 `Transform` 的 **自定義代碼** 模塊之後,返回的值位於 `{{Transform.value}}`。

局部變量只在當前運行期間存在。每次新的運行都是全新開始。

## 變量在哪裏可用

幾乎每個文本字段都接受變量:

- API 模塊的 URL。
- Slack、Teams、Discord、Telegram、郵件的消息文本。
- 郵件的主題和正文。
- 頭部和正文字段(在字符串值中)。
- 條件模塊的兩側。

純 JSON 字段在字符串值裏可以使用變量,但不能把變量當作鍵。如果你需要動態構建結構,使用 **自定義代碼** 模塊來構建,然後把它的輸出傳給下一個模塊。

**自定義代碼** 模塊讀取變量的方式不同——全局變量通過 `args.variables` 傳入,而前面模塊的輸出由你決定以參數形式傳入哪些。

## 示例

### 從 webhook 構建一個負載

一個 webhook 到達,請求體類似 `{ "service": "checkout", "status": "failed" }`。要把它轉換成 OneUptime 事件:

1. 名爲 `CIWebhook` 的 **Webhook** 觸發器。
2. **條件** 模塊:左側 `{{CIWebhook.Request Body.status}}`、運算符 `==`、右側 `failed`。
3. 從 **是** 分支接一個 **Create Incident** 模塊:
   - 標題:`CI build failed: {{CIWebhook.Request Body.service}}`
   - 描述:`See {{CIWebhook.Request Body.url}} for the logs.`

### 在 API 調用中使用密鑰

一個調用 PagerDuty 的工作流:

1. 把 `PAGERDUTY_KEY` 保存爲密鑰型全局變量。
2. 在 **API** 模塊上,把 `Authorization` 頭設爲 `Token token={{variable.PAGERDUTY_KEY}}`。

密鑰不會出現在工作流和日誌裏。

### 串接兩個 API 調用

第一個調用返回的 ID 是第二個調用需要的:

1. **API** 模塊 `LookupOrder`:`GET /orders?email={{Manual.JSON.email}}`。
2. **API** 模塊 `CancelOrder`:`POST /orders/{{LookupOrder.response-body.id}}/cancel`。

如果 `LookupOrder` 失敗,觸發的是它的 **錯誤** 輸出而不是 **成功**。把它連接到郵件或 Slack 模塊,這樣失敗就不會被忽略。

## 注意點

- **重命名模塊會破壞引用。** 如果重命名了一個模塊,要更新所有引用它的地方。在運行日誌裏,未解析的引用會顯示爲字面文本 `{{BlockName.field}}`。
- **變量名區分大小寫。** `{{variable.MyKey}}` 和 `{{variable.mykey}}` 是不同的。
- **缺失的字段會變爲空。** 引用不存在的字段會得到空字符串,而不是錯誤。這雖然方便——但可能掩蓋 bug。在繼續之前使用 **條件** 模塊檢查重要字段。

## 接下來讀什麼

- [組件](/docs/workflows/components)——每個模塊產生的完整輸出列表。
- [運行與日誌](/docs/workflows/runs-and-logs)——在運行後查看每個變量的實際值。
- [配置與安全](/docs/workflows/configuration)——哪些內容適合放進全局變量。
