# 自訂程式碼監控器

自訂程式碼監控器讓您可以撰寫自訂指令碼來監控您的應用程式。您可以使用此功能，以現有監控器無法達成的方式來監控您的應用程式。例如，您可以執行多步驟的 API 請求。

#### 範例

以下範例示範如何使用自訂程式碼監控器：

```javascript
// You can use axios module.

await axios.get('https://api.example.com/');

// Axios Documentation here: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // return any data you like here. 
};
```


### 使用監控器密鑰

#### 新增密鑰

若要新增密鑰，請前往 OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret。

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

您可以選擇哪些監控器能夠存取該密鑰。在此案例中，我們新增了 `ApiKey` 密鑰，並選擇了可存取它的監控器。

**請注意**：密鑰會經過加密並安全儲存。如果您遺失了密鑰，您將需要建立新的密鑰。密鑰一經儲存後，您將無法檢視或更新它。

#### 使用密鑰

若要在指令碼中使用監控器密鑰，您可以在指令碼的上下文中使用 `monitorSecrets` 物件。您可以用它來存取您已新增至監控器的密鑰。

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret); 
```


### 自訂指標

您可以使用 `oneuptime.captureMetric()` 函式從您的指令碼中擷取自訂指標。這些指標會儲存在 OneUptime 中，並可使用 Metric Explorer 在儀表板上繪製圖表。

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name`（字串，必填）：指標名稱（例如 `"api.response.time"`）。它會自動以 `custom.monitor.` 前綴儲存。
- `value`（數字，必填）：數值型的指標值。
- `attributes`（物件，選填）：用於提供額外上下文的鍵值對。

#### 範例

```javascript
const response = await axios.get('https://api.example.com/health');

// Capture a simple metric
oneuptime.captureMetric('api.response.time', response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

一旦擷取後，這些指標就會以類似 `custom.monitor.api.response.time` 的名稱出現在 Metric Explorer 中。您可以將它們加入儀表板圖表、設定警報，並依監控器、探針或您所提供的任何自訂屬性進行篩選。

**限制：**
- 每次指令碼執行最多 100 個指標。
- 指標名稱限制為 200 個字元。
- 值必須為數值型。

### 指令碼中可用的模組
- `axios`：您可以使用此模組來發出 HTTP 請求。它是一個以 promise 為基礎的 HTTP 用戶端，適用於瀏覽器與 Node.js。
- `crypto`：您可以使用此模組來執行加密運算。它是 Node.js 的內建模組，提供加密功能，其中包含一組針對 OpenSSL 的 hash、HMAC、cipher、decipher、sign 與 verify 函式的封裝。
- `console.log`：您可以使用此模組將資料記錄至主控台。這對於除錯目的很有用。
- `oneuptime.captureMetric`：您可以使用它從您的指令碼中擷取自訂指標。請參閱上方的「自訂指標」章節。
- `http`：您可以使用此模組來發出 HTTP 請求。它是 Node.js 的內建模組，提供 HTTP 用戶端與伺服器。
- `https`：您可以使用此模組來發出 HTTPS 請求。它是 Node.js 的內建模組，提供 HTTPS 用戶端與伺服器。

### 須考量的事項

- 您可以使用 `console.log` 將資料記錄至主控台。這將可在監控器的記錄區段中取得（Probes > View Logs）。
- 您可以使用 `return` 陳述式從指令碼回傳資料。
- 這是一個 JavaScript 指令碼，因此您可以在指令碼中使用所有的 JavaScript 功能。
- 指令碼的逾時時間為 2 分鐘。如果指令碼執行超過 2 分鐘，它將會被終止。
