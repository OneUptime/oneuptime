# 合成監控（Synthetic Monitor）

合成監控是一種透過模擬使用者互動來主動監控您應用程式的方式。您可以建立一個合成監控，從世界各地不同的位置檢查應用程式的可用性與效能。

#### 範例

以下範例展示如何使用合成監控：

```javascript
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: Playwright Page object to interact with the browser
// - browserType: Browser type in the current run context - Chromium, Firefox, Webkit
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto("https://playwright.dev/");

// Playwright Documentation here: https://playwright.dev/docs/intro

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType); // This will list the browser type in the current run context - Chromium, Firefox, Webkit

console.log(screenSizeType); // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots, assign them to the `screenshots` object that is provided
// in the script context. Screenshots captured this way are preserved even if the
// script later throws — useful for debugging failed runs.

screenshots["screenshot-name"] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop.

// To log data, use console.log
// console.log('Hello World');

// You can access the browser context via page.context() if needed (for example, to create a new page or dealing with popups).

return {
  data: "Hello World",
};
```

### Playwright 的使用

我們使用 Playwright 來模擬使用者互動。您可以使用 Playwright 的 `page` 物件與瀏覽器互動，並執行點擊按鈕、填寫表單與擷取畫面等動作。

### 螢幕截圖

腳本內容中提供了一個預先宣告的 `screenshots` 物件。您可以在腳本中的任何時間點將螢幕截圖指派給它——這些螢幕截圖**即使腳本拋出例外也會被擷取**（包括斷言失敗、逾時或非預期的錯誤），因此您可以準確看到執行失敗時頁面的樣貌。擷取到的螢幕截圖會顯示在該特定監控執行的 OneUptime Dashboard 中。

```javascript
// Capture screenshots via the `screenshots` side-channel — they are preserved on both success and failure.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// If the next assertion throws, the `login-page` screenshot above is still captured.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### 回傳螢幕截圖（舊版）

為了向後相容，您也可以將螢幕截圖作為回傳值的一部分從腳本中回傳。以這種方式回傳的螢幕截圖**只有**在腳本正常完成時才會被擷取——如果腳本拋出例外，它們將會遺失。當您希望取得失敗的證據時，請優先使用上述的旁路（side-channel）模式。

```javascript
// Legacy pattern — screenshots only captured on successful return.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### 使用監控密鑰（Monitor Secrets）

#### 新增密鑰

若要新增密鑰，請前往 OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret。

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

您可以選擇哪些監控能夠存取該密鑰。在此範例中，我們新增了 `ApiKey` 密鑰，並選擇了可以存取它的監控。

**請注意**：密鑰會經過加密並安全儲存。如果您遺失了密鑰，將需要建立一個新的密鑰。密鑰儲存後即無法檢視或更新。

#### 使用密鑰

若要在腳本中使用監控密鑰，您可以在腳本內容中使用 `monitorSecrets` 物件。您可以使用它來存取已新增到該監控的密鑰。

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

### 自訂指標（Custom Metrics）

您可以使用 `oneuptime.captureMetric()` 函式從腳本中擷取自訂指標。這些指標會儲存在 OneUptime 中，並可使用 Metric Explorer 在儀表板上繪製成圖表。

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name`（字串，必填）：指標名稱（例如 `"dashboard.load.time"`）。它會自動以 `custom.monitor.` 前綴儲存。
- `value`（數字，必填）：數值型的指標值。
- `attributes`（物件，選填）：用於提供額外內容的鍵值對。

#### 範例

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Capture page load time as a custom metric
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

一旦擷取後，這些指標會以 `custom.monitor.dashboard.load.time` 之類的名稱出現在 Metric Explorer 中。您可以將它們加入儀表板圖表、設定警示，並依監控、探針（probe）、瀏覽器類型、螢幕大小，或您所提供的任何自訂屬性進行篩選。

**限制：**

- 每次腳本執行最多 100 個指標。
- 指標名稱長度上限為 200 個字元。
- 值必須為數字。

### 腳本中可用的模組

- `page`：您可以使用此模組與瀏覽器互動。它是一個 Playwright Page 物件，可讓您執行點擊按鈕、填寫表單與擷取畫面等動作。如有需要，您可以透過 `page.context()` 存取瀏覽器內容（例如建立新頁面或處理彈出視窗）。
- `screenshots`：一個預先宣告的物件，您可以將螢幕截圖指派給它（例如 `screenshots['login-page'] = await page.screenshot()`）。在此處指派的螢幕截圖即使腳本之後拋出例外也會被擷取。
- `axios`：您可以使用此模組來發出 HTTP 請求。它是一個基於 Promise 的 HTTP 用戶端，可用於瀏覽器與 Node.js。
- `crypto`：您可以使用此模組執行加密運算。它是 Node.js 的內建模組，提供加密功能，包含一組針對 OpenSSL 的 hash、HMAC、cipher、decipher、sign 與 verify 函式的封裝。
- `console.log`：您可以使用此模組將資料記錄到主控台。這對於除錯非常有用。
- `oneuptime.captureMetric`：您可以使用它從腳本中擷取自訂指標。請參閱上方的「自訂指標」章節。
- `http`：您可以使用此模組來發出 HTTP 請求。它是 Node.js 的內建模組，提供 HTTP 用戶端與伺服器。
- `https`：您可以使用此模組來發出 HTTPS 請求。它是 Node.js 的內建模組，提供 HTTPS 用戶端與伺服器。

### 須考量的事項

- `page` 物件是與瀏覽器互動的主要介面。它來自 Playwright 的 Page 類別。如有需要，您可以透過 `page.context()` 存取瀏覽器內容。
- 您可以使用 `console.log` 將資料記錄到主控台。這會顯示在監控的記錄（logs）區段中。
- 您可以使用 `return` 陳述式從腳本回傳資料。請將螢幕截圖指派給所提供的 `screenshots` 物件，使其即使在腳本拋出例外時也能被保留。
- 您可以使用 `browserType` 與 `screenSizeType` 變數來取得目前執行內容中的瀏覽器類型與螢幕大小類型。如果您願意，可以在腳本中自由使用它們。
- 這是一個 JavaScript 腳本，因此您可以在腳本中使用所有的 JavaScript 功能。
- 您可以使用 `axios` 模組在腳本中發出 HTTP 請求。您可以使用它從腳本中發出 API 呼叫。
- 如果您使用 oneuptime.com，您在腳本內容中將始終擁有最新版本的 Playwright 與瀏覽器。如果您是自架（self-hosting），請確保更新探針（probes）以擁有最新版本的 Playwright 與瀏覽器。
- 腳本的逾時時間為 2 分鐘。如果腳本執行超過 2 分鐘，它將會被終止。
