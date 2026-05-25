# 合成監控器

合成監控是一種通過模擬用戶交互來主動監控應用程序的方式。您可以創建合成監控器，從世界各地的不同位置檢查應用程序的可用性和性能。

#### 示例

以下示例展示瞭如何使用合成監控器：

```javascript

// 腳本上下文中可用的對象有：

// - axios：用於發出 HTTP 請求的 Axios 模塊
// - page：用於與瀏覽器交互的 Playwright Page 對象
// - browserType：當前運行上下文中的瀏覽器類型 - Chromium、Firefox、Webkit
// - screenSizeType：當前運行上下文中的屏幕尺寸類型 - Mobile、Tablet、Desktop

// 您可以使用這些對象與瀏覽器交互併發出 HTTP 請求。

await page.goto('https://playwright.dev/');

// Playwright 文檔：https://playwright.dev/docs/intro

// 以下是您可以在受監控對象上下文中使用的一些變量：

console.log(browserType) // 這將列出當前運行上下文中的瀏覽器類型 - Chromium、Firefox、Webkit

console.log(screenSizeType) // 這將列出當前運行上下文中的屏幕尺寸類型 - Mobile、Tablet、Desktop

// Playwright page 對象屬於特定瀏覽器上下文，因此您可以使用它與瀏覽器交互。

// 要截取屏幕截圖，請將其賦值給腳本上下文中提供的 `screenshots` 對象。
// 以這種方式捕獲的截圖即使在腳本後來拋出錯誤時也會保留——對調試失敗的運行非常有用。

screenshots['screenshot-name'] = await page.screenshot(); // 您可以保存多個截圖併爲它們指定不同的名稱。

// 當您想要返回值時，請使用帶有 data 屬性的 return 語句。

// 要記錄數據，請使用 console.log
// console.log('Hello World');

// 如果需要，您可以通過 page.context() 訪問瀏覽器上下文（例如，創建新頁面或處理彈出窗口）。


return {
    data: 'Hello World'
};
```

### 使用 Playwright

我們使用 Playwright 模擬用戶交互。您可以使用 Playwright `page` 對象與瀏覽器交互，執行點擊按鈕、填寫表單和截取屏幕截圖等操作。

### 截圖

腳本上下文中提供了一個預先聲明的 `screenshots` 對象。在腳本的任意位置將截圖賦值給它——這些截圖**即使在腳本拋出錯誤時（包括斷言失敗、超時或意外錯誤）也會被捕獲**，因此您可以看到運行失敗時頁面的確切狀態。捕獲的截圖顯示在 OneUptime 控制台中特定監控器運行的頁面上。

```javascript

// 通過 `screenshots` 副通道捕獲截圖——在成功和失敗時都會保留。

await page.goto('https://app.example.com/login');
screenshots['login-page'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// 如果下一個斷言拋出錯誤，上面的 `login-page` 截圖仍然會被捕獲。
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['dashboard'] = await page.screenshot();

return {
    data: 'Login succeeded'
};

```

#### 返回截圖（舊版方式）

爲了向後兼容，您也可以將截圖作爲返回值的一部分從腳本中返回。以這種方式返回的截圖**只有**在腳本正常完成時纔會被捕獲——如果腳本拋出錯誤則會丟失。當您想要保留失敗證據時，建議使用上面的副通道模式。

```javascript
// 舊版模式——截圖僅在成功返回時捕獲。
const screenshots = {};
screenshots['screenshot-name'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots
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

- `name`（字符串，必填）：指標名稱（例如 `"dashboard.load.time"`）。它將自動以 `custom.monitor.` 前綴儲存。
- `value`（數字，必填）：數值型指標值。
- `attributes`（對象，可選）：用於提供額外上下文的鍵值對。

#### 示例

```javascript
await page.goto('https://app.example.com');

const startTime = Date.now();
await page.waitForSelector('#dashboard-loaded');
const loadTime = Date.now() - startTime;

// 將頁面加載時間作爲自定義指標捕獲
oneuptime.captureMetric('dashboard.load.time', loadTime, {
    page: 'dashboard'
});

screenshots['dashboard'] = await page.screenshot();

return {
    data: { loadTime }
};
```

捕獲後，這些指標將以 `custom.monitor.dashboard.load.time` 等名稱出現在指標瀏覽器中。您可以將它們添加到控制台圖表、設置警報，並按監控器、探針、瀏覽器類型、屏幕尺寸或您提供的任何自定義屬性進行過濾。

**限制：**
- 每次腳本執行最多 100 個指標。
- 指標名稱限制爲 200 個字符。
- 值必須爲數值類型。

### 腳本中可用的模塊
- `page`：您可以使用此模塊與瀏覽器交互。它是一個 Playwright Page 對象，允許您執行點擊按鈕、填寫表單和截取截圖等操作。如果需要，您可以通過 `page.context()` 訪問瀏覽器上下文（例如，創建新頁面或處理彈出窗口）。
- `screenshots`：一個預先聲明的對象，您可以向其賦值截圖（例如 `screenshots['login-page'] = await page.screenshot()`）。此處賦值的截圖即使在腳本後來拋出錯誤時也會被捕獲。
- `axios`：您可以使用此模塊發出 HTTP 請求。它是一個基於 Promise 的瀏覽器和 Node.js HTTP 客戶端。
- `crypto`：您可以使用此模塊執行加密操作。它是一個內置的 Node.js 模塊，提供加密功能，包括一組 OpenSSL 哈希、HMAC、密碼、解密、簽名和驗證函數的封裝。
- `console.log`：您可以使用此模塊將數據記錄到控制台。這對調試很有用。
- `oneuptime.captureMetric`：您可以使用此函數從腳本中捕獲自定義指標。參見上方的自定義指標部分。
- `http`：您可以使用此模塊發出 HTTP 請求。它是內置的 Node.js 模塊，提供 HTTP 客戶端和服務器。
- `https`：您可以使用此模塊發出 HTTPS 請求。它是內置的 Node.js 模塊，提供 HTTPS 客戶端和服務器。

### 注意事項

- `page` 對象是與瀏覽器交互的主要接口。這來自 Playwright Page 類。如果需要，您可以通過 `page.context()` 訪問瀏覽器上下文。
- 您可以使用 `console.log` 將數據記錄到控制台。這將顯示在監控器的日誌部分。
- 您可以使用 `return` 語句從腳本返回數據。將截圖賦值給提供的 `screenshots` 對象，這樣即使腳本拋出錯誤也會保留它們。
- 您可以使用 `browserType` 和 `screenSizeType` 變量獲取當前運行上下文中的瀏覽器類型和屏幕尺寸類型。如果您喜歡，可以在腳本中自由使用它們。
- 這是一個 JavaScript 腳本，因此您可以使用所有 JavaScript 功能。
- 您可以在腳本中使用 `axios` 模塊發出 HTTP 請求。您可以使用它從腳本中進行 API 調用。
- 如果您使用 oneuptime.com，在腳本上下文中將始終提供最新版本的 Playwright 和瀏覽器。如果您是自託管，請確保更新探針以獲取最新版本的 Playwright 和瀏覽器。
- 腳本超時爲 2 分鐘。如果腳本運行超過 2 分鐘，將被終止。
