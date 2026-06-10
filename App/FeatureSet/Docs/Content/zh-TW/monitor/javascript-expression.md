# 監控條件：JavaScript 運算式

您可以使用 JavaScript 運算式來建立自訂的監控條件。運算式會在受監控物件的環境中進行評估。運算式必須回傳布林值。如果運算式回傳 `true`，表示符合監控條件。如果運算式回傳 `false`，表示不符合監控條件。

JavaScript 運算式作為監控條件，可用於以下監控類型：API、網站，以及傳入請求 (Incoming Request)。

### 網站與 API 監控

在受監控物件的環境中，可使用以下變數：

| 變數 | 說明 | 型別 |
| --- | --- | --- |
| `responseBody` | 回應主體物件。如果回應主體為 HTML / XML，則型別為字串；如果回應主體為 JSON，則型別為 JSON。 | `string` 或 `JSON` |
| `responseHeaders` | 回應標頭物件。 | `Dictionary<string>` |
| `responseStatusCode` | 回應狀態碼。 | `number` |
| `responseTimeInMs` | 回應時間（以毫秒為單位）。 | `number` |

#### 範例

以下範例示範如何使用 JavaScript 運算式來監控網站回應主體中是否含有特定字串：

```javascript

/**
 *  
 * If response body is in JSON then responseBody will be a JSON object
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// or you can use response headers

"{{responseHeaders.contentType}} === "application/json"


// you can also use regular expressions

"{{responseBody.item}}".match(/hello/)

// you can also use response status code

{{responseStatusCode}} === 200

// you can combine multiple expressions using logical operators

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// for arrays you can use the following

/**
 *  
 * If response body is: 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### 傳入請求 (Incoming Request) 監控

在受監控物件的環境中，可使用以下變數：

| 變數 | 說明 | 型別 |
| --- | --- | --- |
| `requestBody` | 請求主體物件。 | `string` 或 `JSON` |
| `requestHeaders` | 請求標頭物件。 | `Dictionary<string>` |


#### 範例

以下範例示範如何使用 JavaScript 運算式來監控傳入請求的請求主體中是否含有特定字串：

```javascript
"{{requestBody.item}}" === "hello"

// or you can use request headers

"{{requestHeaders.contentType}}" === "text/html"

// you can also use regular expressions

"{{requestBody.item}}".match(/hello/)

// you can combine multiple expressions using logical operators

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// you can use the following for arrays

"{{requestBody.items[0].name}}" === "hello"
```

### 注意事項

* 指令碼有 1 秒的逾時限制，如果指令碼執行時間超過 1 秒，將會回傳 `false`。
* `{{var}}` 會將變數替換為其值，因此如果您要比較字串，需要將其以引號括住，例如 `"{{responseBody.item}}" === "hello"`；如果您要比較數字，則不需要以引號括住，例如 `{{responseStatusCode}} === 200`。
