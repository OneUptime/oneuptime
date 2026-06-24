# 监控标准：JavaScript 表达式

您可以使用 JavaScript 表达式创建自定义监控标准。表达式在受监控对象的上下文中求值。表达式必须返回布尔值。如果表达式返回 `true`，则满足监控标准。如果表达式返回 `false`，则不满足监控标准。

JavaScript 表达式作为监控标准适用于以下监控类型：API、网站和传入请求。

### 网站和 API 监控器

以下变量在受监控对象的上下文中可用：

| 变量                 | 描述                                                                                | 类型                 |
| -------------------- | ----------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | 响应体对象。如果响应体是 HTML/XML 格式，类型为字符串；如果是 JSON 格式，类型为 JSON | `string` 或 `JSON`   |
| `responseHeaders`    | 响应头对象。                                                                        | `Dictionary<string>` |
| `responseStatusCode` | 响应状态码。                                                                        | `number`             |
| `responseTimeInMs`   | 响应时间（毫秒）。                                                                  | `number`             |

#### 示例

以下示例展示了如何使用 JavaScript 表达式监控网站响应体中的特定字符串：

```javascript

/**
 *
 * 如果响应体是 JSON 格式，responseBody 将是一个 JSON 对象
 * {
 *    "item": "hello"
 * }
 *
 *  **/

"{{responseBody.item}}" === "hello"

// 或者您可以使用响应头

"{{responseHeaders.contentType}} === "application/json"


// 您也可以使用正则表达式

"{{responseBody.item}}".match(/hello/)

// 您也可以使用响应状态码

{{responseStatusCode}} === 200

// 您可以使用逻辑运算符组合多个表达式

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// 对于数组可以使用以下方式

/**
 *
 * 如果响应体是：
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 *
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### 传入请求监控器

以下变量在受监控对象的上下文中可用：

| 变量             | 描述         | 类型                 |
| ---------------- | ------------ | -------------------- |
| `requestBody`    | 请求体对象。 | `string` 或 `JSON`   |
| `requestHeaders` | 请求头对象。 | `Dictionary<string>` |

#### 示例

以下示例展示了如何使用 JavaScript 表达式监控传入请求体中的特定字符串：

```javascript
"{{requestBody.item}}" === "hello";

// 或者您可以使用请求头

"{{requestHeaders.contentType}}" === "text/html";

// 您也可以使用正则表达式

"{{requestBody.item}}".match(/hello/);

// 您可以使用逻辑运算符组合多个表达式

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// 数组可以使用以下方式

"{{requestBody.items[0].name}}" === "hello";
```

### 注意事项

- 脚本有 1 秒超时，如果脚本执行时间超过 1 秒，将返回 `false`。
- `{{var}}` 将用值替换变量，因此如果您想比较字符串，需要用引号括起来，例如 `"{{responseBody.item}}" === "hello"`；如果您想比较数字，则不需要引号，例如 `{{responseStatusCode}} === 200`
