# 合成监控器

合成监控是一种通过模拟用户交互来主动监控应用程序的方式。您可以创建合成监控器，从世界各地的不同位置检查应用程序的可用性和性能。

#### 示例

以下示例展示了如何使用合成监控器：

```javascript
// 脚本上下文中可用的对象有：

// - axios：用于发出 HTTP 请求的 Axios 模块
// - page：用于与浏览器交互的 Playwright Page 对象
// - browserType：当前运行上下文中的浏览器类型 - Chromium、Firefox、Webkit
// - screenSizeType：当前运行上下文中的屏幕尺寸类型 - Mobile、Tablet、Desktop

// 您可以使用这些对象与浏览器交互并发出 HTTP 请求。

await page.goto("https://playwright.dev/");

// Playwright 文档：https://playwright.dev/docs/intro

// 以下是您可以在受监控对象上下文中使用的一些变量：

console.log(browserType); // 这将列出当前运行上下文中的浏览器类型 - Chromium、Firefox、Webkit

console.log(screenSizeType); // 这将列出当前运行上下文中的屏幕尺寸类型 - Mobile、Tablet、Desktop

// Playwright page 对象属于特定浏览器上下文，因此您可以使用它与浏览器交互。

// 要截取屏幕截图，请将其赋值给脚本上下文中提供的 `screenshots` 对象。
// 以这种方式捕获的截图即使在脚本后来抛出错误时也会保留——对调试失败的运行非常有用。

screenshots["screenshot-name"] = await page.screenshot(); // 您可以保存多个截图并为它们指定不同的名称。

// 当您想要返回值时，请使用带有 data 属性的 return 语句。

// 要记录数据，请使用 console.log
// console.log('Hello World');

// 如果需要，您可以通过 page.context() 访问浏览器上下文（例如，创建新页面或处理弹出窗口）。

return {
  data: "Hello World",
};
```

### 使用 Playwright

我们使用 Playwright 模拟用户交互。您可以使用 Playwright `page` 对象与浏览器交互，执行点击按钮、填写表单和截取屏幕截图等操作。

### 截图

脚本上下文中提供了一个预先声明的 `screenshots` 对象。在脚本的任意位置将截图赋值给它——这些截图**即使在脚本抛出错误时（包括断言失败、超时或意外错误）也会被捕获**，因此您可以看到运行失败时页面的确切状态。捕获的截图显示在 OneUptime 控制台中特定监控器运行的页面上。

```javascript
// 通过 `screenshots` 副通道捕获截图——在成功和失败时都会保留。

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// 如果下一个断言抛出错误，上面的 `login-page` 截图仍然会被捕获。
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### 返回截图（旧版方式）

为了向后兼容，您也可以将截图作为返回值的一部分从脚本中返回。以这种方式返回的截图**只有**在脚本正常完成时才会被捕获——如果脚本抛出错误则会丢失。当您想要保留失败证据时，建议使用上面的副通道模式。

```javascript
// 旧版模式——截图仅在成功返回时捕获。
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### 使用监控器密钥

#### 添加密钥

要添加密钥，请前往 OneUptime 控制台 -> 项目设置 -> 监控器密钥 -> 创建监控器密钥。

![创建密钥](/docs/static/images/CreateMonitorSecret.png)

您可以选择哪些监控器有权访问该密钥。在本例中，我们添加了 `ApiKey` 密钥并选择了有权访问它的监控器。

**请注意**：密钥经过加密并安全存储。如果您丢失了密钥，需要创建新密钥。保存后无法查看或更新密钥。

#### 使用密钥

要在脚本中使用监控器密钥，您可以在脚本上下文中使用 `monitorSecrets` 对象。您可以使用它来访问已添加到监控器的密钥。

```javascript
// 如果您的密钥是字符串类型，需要用引号括起来
let stringSecret = '{{monitorSecrets.StringSecret}}';

// 如果您的密钥是数字或布尔类型，可以直接使用
let numberSecret = {{monitorSecrets.NumberSecret}};

// 如果您的密钥是布尔类型，可以直接使用
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// 您甚至可以通过 console.log 验证密钥是否被正确获取
console.log(stringSecret);
```

### 自定义指标

您可以使用 `oneuptime.captureMetric()` 函数从脚本中捕获自定义指标。这些指标存储在 OneUptime 中，可以通过指标浏览器在控制台上制图。

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name`（字符串，必填）：指标名称（例如 `"dashboard.load.time"`）。它将自动以 `custom.monitor.` 前缀存储。
- `value`（数字，必填）：数值型指标值。
- `attributes`（对象，可选）：用于提供额外上下文的键值对。

#### 示例

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// 将页面加载时间作为自定义指标捕获
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

捕获后，这些指标将以 `custom.monitor.dashboard.load.time` 等名称出现在指标浏览器中。您可以将它们添加到控制台图表、设置告警，并按监控器、探针、浏览器类型、屏幕尺寸或您提供的任何自定义属性进行过滤。

**限制：**

- 每次脚本执行最多 100 个指标。
- 指标名称限制为 200 个字符。
- 值必须为数值类型。

### 脚本中可用的模块

- `page`：您可以使用此模块与浏览器交互。它是一个 Playwright Page 对象，允许您执行点击按钮、填写表单和截取截图等操作。如果需要，您可以通过 `page.context()` 访问浏览器上下文（例如，创建新页面或处理弹出窗口）。
- `screenshots`：一个预先声明的对象，您可以向其赋值截图（例如 `screenshots['login-page'] = await page.screenshot()`）。此处赋值的截图即使在脚本后来抛出错误时也会被捕获。
- `axios`：您可以使用此模块发出 HTTP 请求。它是一个基于 Promise 的浏览器和 Node.js HTTP 客户端。
- `crypto`：您可以使用此模块执行加密操作。它是一个内置的 Node.js 模块，提供加密功能，包括一组 OpenSSL 哈希、HMAC、密码、解密、签名和验证函数的封装。
- `console.log`：您可以使用此模块将数据记录到控制台。这对调试很有用。
- `oneuptime.captureMetric`：您可以使用此函数从脚本中捕获自定义指标。参见上方的自定义指标部分。
- `http`：您可以使用此模块发出 HTTP 请求。它是内置的 Node.js 模块，提供 HTTP 客户端和服务器。
- `https`：您可以使用此模块发出 HTTPS 请求。它是内置的 Node.js 模块，提供 HTTPS 客户端和服务器。

### 注意事项

- `page` 对象是与浏览器交互的主要接口。这来自 Playwright Page 类。如果需要，您可以通过 `page.context()` 访问浏览器上下文。
- 您可以使用 `console.log` 将数据记录到控制台。这将显示在监控器的日志部分。
- 您可以使用 `return` 语句从脚本返回数据。将截图赋值给提供的 `screenshots` 对象，这样即使脚本抛出错误也会保留它们。
- 您可以使用 `browserType` 和 `screenSizeType` 变量获取当前运行上下文中的浏览器类型和屏幕尺寸类型。如果您喜欢，可以在脚本中自由使用它们。
- 这是一个 JavaScript 脚本，因此您可以使用所有 JavaScript 功能。
- 您可以在脚本中使用 `axios` 模块发出 HTTP 请求。您可以使用它从脚本中进行 API 调用。
- 如果您使用 oneuptime.com，在脚本上下文中将始终提供最新版本的 Playwright 和浏览器。如果您是自托管，请确保更新探针以获取最新版本的 Playwright 和浏览器。
- 脚本超时为 2 分钟。如果脚本运行超过 2 分钟，将被终止。
