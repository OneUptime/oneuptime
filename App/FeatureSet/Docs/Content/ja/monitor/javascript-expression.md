# 監視条件：JavaScriptエクスプレッション

JavaScriptエクスプレッションを使用してカスタム監視条件を作成できます。エクスプレッションは監視対象オブジェクトのコンテキストで評価されます。エクスプレッションはブール値を返す必要があります。`true` を返した場合、監視条件を満たしたと判断されます。`false` を返した場合、監視条件は満たされていません。

JavaScriptエクスプレッションによる監視条件は、API、ウェブサイト、受信リクエストの監視タイプで利用できます。

### ウェブサイト・APIモニター

監視対象オブジェクトのコンテキストで以下の変数が利用できます。

| 変数 | 説明 | 型 |
| --- | --- | --- |
| `responseBody` | レスポンスボディオブジェクト。HTML/XMLの場合は文字列型、JSONの場合はJSON型。 | `string` または `JSON` |
| `responseHeaders` | レスポンスヘッダーオブジェクト。 | `Dictionary<string>` |
| `responseStatusCode` | レスポンスステータスコード。 | `number` |
| `responseTimeInMs` | レスポンスタイム（ミリ秒）。 | `number` |

#### 使用例

以下の例は、JavaScriptエクスプレッションを使用してレスポンスボディ内の特定の文字列でウェブサイトを監視する方法を示しています。

```javascript

/**
 *  
 * レスポンスボディがJSONの場合、responseBodyはJSONオブジェクトになります
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// レスポンスヘッダーも使用できます

"{{responseHeaders.contentType}} === "application/json"


// 正規表現も使用できます

"{{responseBody.item}}".match(/hello/)

// レスポンスステータスコードも使用できます

{{responseStatusCode}} === 200

// 論理演算子を使って複数のエクスプレッションを組み合わせることもできます

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// 配列に対しては以下のように使用できます

/**
 *  
 * レスポンスボディが以下の場合: 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### 受信リクエストモニター

監視対象オブジェクトのコンテキストで以下の変数が利用できます。

| 変数 | 説明 | 型 |
| --- | --- | --- |
| `requestBody` | リクエストボディオブジェクト。 | `string` または `JSON` |
| `requestHeaders` | リクエストヘッダーオブジェクト。 | `Dictionary<string>` |


#### 使用例

以下の例は、JavaScriptエクスプレッションを使用してリクエストボディ内の特定の文字列で受信リクエストを監視する方法を示しています。

```javascript
"{{requestBody.item}}" === "hello"

// リクエストヘッダーも使用できます

"{{requestHeaders.contentType}}" === "text/html"

// 正規表現も使用できます

"{{requestBody.item}}".match(/hello/)

// 論理演算子を使って複数のエクスプレッションを組み合わせることもできます

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// 配列に対しては以下のように使用できます

"{{requestBody.items[0].name}}" === "hello"
```

### 注意事項

* スクリプトは1秒のタイムアウトがあり、1秒以上かかると `false` を返します。
* `{{var}}` は変数を値に置換します。文字列を比較する場合は引用符で囲む必要があります（例：`"{{responseBody.item}}" === "hello"`）。数値を比較する場合は引用符で囲む必要はありません（例：`{{responseStatusCode}} === 200`）。
