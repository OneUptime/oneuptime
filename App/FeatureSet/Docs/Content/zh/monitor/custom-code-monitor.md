# 自定义代码监控器

自定义代码监控器允许您编写自定义脚本来监控您的应用程序。您可以使用此功能以现有监控器无法实现的方式来监控您的应用程序。例如，您可以实现多步骤 API 请求。

#### 示例

以下示例展示了如何使用自定义代码监控器：

```javascript
// 您可以使用 axios 模块。

await axios.get('https://api.example.com/');

// Axios 文档：https://axios-http.com/docs/intro

return {
    data: 'Hello World' // 在此处返回您想要的任何数据。
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

- `name`（字符串，必填）：指标名称（例如 `"api.response.time"`）。它将自动以 `custom.monitor.` 前缀存储。
- `value`（数字，必填）：数值型指标值。
- `attributes`（对象，可选）：用于提供额外上下文的键值对。

#### 示例

```javascript
const response = await axios.get('https://api.example.com/health');

// 捕获简单指标
oneuptime.captureMetric('api.response.time', response.data.latency);

// 捕获带属性的指标
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

捕获后，这些指标将以 `custom.monitor.api.response.time` 等名称出现在指标浏览器中。您可以将它们添加到控制台图表、设置告警，并按监控器、探针或您提供的任何自定义属性进行过滤。

**限制：**
- 每次脚本执行最多 100 个指标。
- 指标名称限制为 200 个字符。
- 值必须为数值类型。

### 脚本中可用的模块
- `axios`：您可以使用此模块发出 HTTP 请求。它是一个基于 Promise 的浏览器和 Node.js HTTP 客户端。
- `crypto`：您可以使用此模块执行加密操作。它是一个内置的 Node.js 模块，提供加密功能，包括一组 OpenSSL 哈希、HMAC、密码、解密、签名和验证函数的封装。
- `console.log`：您可以使用此模块将数据记录到控制台。这对调试很有用。
- `oneuptime.captureMetric`：您可以使用此函数从脚本中捕获自定义指标。参见上方的自定义指标部分。
- `http`：您可以使用此模块发出 HTTP 请求。它是内置的 Node.js 模块，提供 HTTP 客户端和服务器。
- `https`：您可以使用此模块发出 HTTPS 请求。它是内置的 Node.js 模块，提供 HTTPS 客户端和服务器。

### 注意事项

- 您可以使用 `console.log` 将数据记录到控制台。这将显示在监控器的日志部分（探针 > 查看日志）。
- 您可以使用 `return` 语句从脚本返回数据。
- 这是一个 JavaScript 脚本，因此您可以使用所有 JavaScript 功能。
- 脚本超时为 2 分钟。如果脚本运行超过 2 分钟，将被终止。
