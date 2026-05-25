# 自定義代碼監控器

自定義代碼監控器允許您編寫自定義腳本來監控您的應用程序。您可以使用此功能以現有監控器無法實現的方式來監控您的應用程序。例如，您可以實現多步驟 API 請求。

#### 示例

以下示例展示瞭如何使用自定義代碼監控器：

```javascript
// 您可以使用 axios 模塊。

await axios.get('https://api.example.com/');

// Axios 文檔：https://axios-http.com/docs/intro

return {
    data: 'Hello World' // 在此處返回您想要的任何數據。
};
```


### 使用監控器密鑰

#### 添加密鑰

要添加密鑰，請前往 OneUptime 控制台 -> 項目設置 -> 監控器密鑰 -> 創建監控器密鑰。

![創建密鑰](/docs/static/images/CreateMonitorSecret.png)

您可以選擇哪些監控器有權訪問該密鑰。在本例中，我們添加了 `ApiKey` 密鑰並選擇了有權訪問它的監控器。

**請注意**：密鑰經過加密並安全儲存。如果您丟失了密鑰，需要創建新密鑰。保存後無法查看或更新密鑰。

#### 使用密鑰

要在腳本中使用監控器密鑰，您可以在腳本上下文中使用 `monitorSecrets` 對象。您可以使用它來訪問已添加到監控器的密鑰。

```javascript
// 如果您的密鑰是字符串類型，需要用引號括起來
let stringSecret = '{{monitorSecrets.StringSecret}}';

// 如果您的密鑰是數字或布爾類型，可以直接使用
let numberSecret = {{monitorSecrets.NumberSecret}};

// 如果您的密鑰是布爾類型，可以直接使用
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// 您甚至可以通過 console.log 驗證密鑰是否被正確獲取
console.log(stringSecret); 
```


### 自定義指標

您可以使用 `oneuptime.captureMetric()` 函數從腳本中捕獲自定義指標。這些指標儲存在 OneUptime 中，可以通過指標瀏覽器在控制台上製圖。

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name`（字符串，必填）：指標名稱（例如 `"api.response.time"`）。它將自動以 `custom.monitor.` 前綴儲存。
- `value`（數字，必填）：數值型指標值。
- `attributes`（對象，可選）：用於提供額外上下文的鍵值對。

#### 示例

```javascript
const response = await axios.get('https://api.example.com/health');

// 捕獲簡單指標
oneuptime.captureMetric('api.response.time', response.data.latency);

// 捕獲帶屬性的指標
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

捕獲後，這些指標將以 `custom.monitor.api.response.time` 等名稱出現在指標瀏覽器中。您可以將它們添加到控制台圖表、設置警報，並按監控器、探針或您提供的任何自定義屬性進行過濾。

**限制：**
- 每次腳本執行最多 100 個指標。
- 指標名稱限制爲 200 個字符。
- 值必須爲數值類型。

### 腳本中可用的模塊
- `axios`：您可以使用此模塊發出 HTTP 請求。它是一個基於 Promise 的瀏覽器和 Node.js HTTP 客戶端。
- `crypto`：您可以使用此模塊執行加密操作。它是一個內置的 Node.js 模塊，提供加密功能，包括一組 OpenSSL 哈希、HMAC、密碼、解密、簽名和驗證函數的封裝。
- `console.log`：您可以使用此模塊將數據記錄到控制台。這對調試很有用。
- `oneuptime.captureMetric`：您可以使用此函數從腳本中捕獲自定義指標。參見上方的自定義指標部分。
- `http`：您可以使用此模塊發出 HTTP 請求。它是內置的 Node.js 模塊，提供 HTTP 客戶端和服務器。
- `https`：您可以使用此模塊發出 HTTPS 請求。它是內置的 Node.js 模塊，提供 HTTPS 客戶端和服務器。

### 注意事項

- 您可以使用 `console.log` 將數據記錄到控制台。這將顯示在監控器的日誌部分（探針 > 查看日誌）。
- 您可以使用 `return` 語句從腳本返回數據。
- 這是一個 JavaScript 腳本，因此您可以使用所有 JavaScript 功能。
- 腳本超時爲 2 分鐘。如果腳本運行超過 2 分鐘，將被終止。
