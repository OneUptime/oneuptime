# 監控標準：JavaScript 表達式

您可以使用 JavaScript 表達式創建自定義監控標準。表達式在受監控對象的上下文中求值。表達式必須返回布爾值。如果表達式返回 `true`，則滿足監控標準。如果表達式返回 `false`，則不滿足監控標準。

JavaScript 表達式作爲監控標準適用於以下監控類型：API、網站和傳入請求。

### 網站和 API 監控器

以下變量在受監控對象的上下文中可用：

| 變量 | 描述 | 類型 |
|------|------|------|
| `responseBody` | 響應體對象。如果響應體是 HTML/XML 格式，類型爲字符串；如果是 JSON 格式，類型爲 JSON | `string` 或 `JSON` |
| `responseHeaders` | 響應頭對象。 | `Dictionary<string>` |
| `responseStatusCode` | 響應狀態碼。 | `number` |
| `responseTimeInMs` | 響應時間（毫秒）。 | `number` |

#### 示例

以下示例展示瞭如何使用 JavaScript 表達式監控網站響應體中的特定字符串：

```javascript

/**
 *  
 * 如果響應體是 JSON 格式，responseBody 將是一個 JSON 對象
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// 或者您可以使用響應頭

"{{responseHeaders.contentType}} === "application/json"


// 您也可以使用正則表達式

"{{responseBody.item}}".match(/hello/)

// 您也可以使用響應狀態碼

{{responseStatusCode}} === 200

// 您可以使用邏輯運算符組合多個表達式

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// 對於數組可以使用以下方式

/**
 *  
 * 如果響應體是： 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### 傳入請求監控器

以下變量在受監控對象的上下文中可用：

| 變量 | 描述 | 類型 |
|------|------|------|
| `requestBody` | 請求體對象。 | `string` 或 `JSON` |
| `requestHeaders` | 請求頭對象。 | `Dictionary<string>` |


#### 示例

以下示例展示瞭如何使用 JavaScript 表達式監控傳入請求體中的特定字符串：

```javascript
"{{requestBody.item}}" === "hello"

// 或者您可以使用請求頭

"{{requestHeaders.contentType}}" === "text/html"

// 您也可以使用正則表達式

"{{requestBody.item}}".match(/hello/)

// 您可以使用邏輯運算符組合多個表達式

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// 數組可以使用以下方式

"{{requestBody.items[0].name}}" === "hello"
```

### 注意事項

* 腳本有 1 秒超時，如果腳本執行時間超過 1 秒，將返回 `false`。
* `{{var}}` 將用值替換變量，因此如果您想比較字符串，需要用引號括起來，例如 `"{{responseBody.item}}" === "hello"`；如果您想比較數字，則不需要引號，例如 `{{responseStatusCode}} === 200`
