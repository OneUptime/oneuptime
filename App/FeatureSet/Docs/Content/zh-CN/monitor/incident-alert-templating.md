# 事件和告警动态模板

您可以在监控器标准的 JavaScript 表达式中使用的相同 `{{variable}}` 占位符语法，来动态填充从监控器标准自动创建的事件和告警的标题、描述和修复说明。

## 支持的监控器类型和变量

以下监控器类型支持使用各自变量进行动态模板：

- **网站和 API 监控器**：响应数据、头信息、状态码、时间
- **传入请求监控器**：请求数据、头信息、方法、时间
- **Ping 监控器**：连接状态、响应时间、失败原因
- **端口监控器**：端口连接性、响应时间、超时状态
- **IP 监控器**：IP 可达性、Ping 时间、失败信息
- **SSL 证书监控器**：证书详情、验证状态、过期信息
- **服务器/虚拟机监控器**：系统指标（CPU、内存、磁盘）、进程、主机名
- **合成监控器**：脚本执行结果、截图、浏览器详情
- **自定义 JavaScript 代码监控器**：执行结果、时间、错误消息
- **SNMP 监控器**：设备状态、响应时间、OID 值

> **注意**：日志、追踪和指标监控器目前不支持事件/告警模板，因为它们使用不同的触发机制。

## 支持的监控器类型和变量

### 网站和 API 监控器

| 变量                 | 描述                                                                 | 类型                 |
| -------------------- | -------------------------------------------------------------------- | -------------------- |
| `responseBody`       | 响应体对象。如果是 HTML/XML 则为字符串，如果是 JSON 则为 JSON 对象。 | `string` 或 `JSON`   |
| `responseHeaders`    | 响应头对象（键名为小写）。                                           | `Dictionary<string>` |
| `responseStatusCode` | HTTP 响应状态码。                                                    | `number`             |
| `responseTimeInMs`   | 响应时间（毫秒）。                                                   | `number`             |
| `isOnline`           | 监控器是否被认为在线。                                               | `boolean`            |

### 传入请求监控器

| 变量                        | 描述                                   | 类型                 |
| --------------------------- | -------------------------------------- | -------------------- |
| `requestBody`               | 请求体对象。                           | `string` 或 `JSON`   |
| `requestHeaders`            | 请求头对象（键名为小写）。             | `Dictionary<string>` |
| `requestMethod`             | 传入请求的 HTTP 方法（GET、POST 等）。 | `string`             |
| `incomingRequestReceivedAt` | 收到传入请求的日期和时间。             | `Date`               |

### Ping 监控器

| 变量               | 描述                        | 类型      |
| ------------------ | --------------------------- | --------- |
| `isOnline`         | Ping 目标是否被认为在线。   | `boolean` |
| `responseTimeInMs` | Ping 响应时间（毫秒）。     | `number`  |
| `failureCause`     | Ping 失败的原因（如失败）。 | `string`  |
| `isTimeout`        | Ping 请求是否超时。         | `boolean` |

### 端口监控器

| 变量               | 描述                           | 类型      |
| ------------------ | ------------------------------ | --------- |
| `isOnline`         | 端口是否被认为在线/可访问。    | `boolean` |
| `responseTimeInMs` | 连接响应时间（毫秒）。         | `number`  |
| `failureCause`     | 端口检查失败的原因（如失败）。 | `string`  |
| `isTimeout`        | 端口连接是否超时。             | `boolean` |

### IP 监控器

| 变量               | 描述                          | 类型      |
| ------------------ | ----------------------------- | --------- |
| `isOnline`         | IP 地址是否被认为在线。       | `boolean` |
| `responseTimeInMs` | Ping 响应时间（毫秒）。       | `number`  |
| `failureCause`     | IP 检查失败的原因（如失败）。 | `string`  |
| `isTimeout`        | IP Ping 请求是否超时。        | `boolean` |

### SSL 证书监控器

| 变量                 | 描述                           | 类型      |
| -------------------- | ------------------------------ | --------- |
| `isOnline`           | SSL 证书检查是否成功。         | `boolean` |
| `isSelfSigned`       | SSL 证书是否为自签名证书。     | `boolean` |
| `createdAt`          | SSL 证书创建日期。             | `Date`    |
| `expiresAt`          | SSL 证书过期日期。             | `Date`    |
| `commonName`         | 证书中的通用名称（CN）。       | `string`  |
| `organizationalUnit` | 证书中的组织单位（OU）。       | `string`  |
| `organization`       | 证书中的组织（O）。            | `string`  |
| `locality`           | 证书中的地区（L）。            | `string`  |
| `state`              | 证书中的州/省（ST）。          | `string`  |
| `country`            | 证书中的国家（C）。            | `string`  |
| `serialNumber`       | 证书的序列号。                 | `string`  |
| `fingerprint`        | 证书的 SHA-1 指纹。            | `string`  |
| `fingerprint256`     | 证书的 SHA-256 指纹。          | `string`  |
| `failureCause`       | SSL 检查失败的原因（如失败）。 | `string`  |

### 服务器/虚拟机监控器

| 变量                         | 描述                             | 类型            |
| ---------------------------- | -------------------------------- | --------------- |
| `hostname`                   | 受监控服务器的主机名。           | `string`        |
| `requestReceivedAt`          | 收到服务器监控请求的日期和时间。 | `Date`          |
| `cpuUsagePercent`            | CPU 使用率百分比。               | `number`        |
| `cpuCores`                   | CPU 核心数。                     | `number`        |
| `memoryUsagePercent`         | 内存使用率百分比。               | `number`        |
| `memoryFreePercent`          | 内存空闲百分比。                 | `number`        |
| `memoryTotalBytes`           | 总内存（字节）。                 | `number`        |
| `diskMetrics`                | 所有挂载磁盘的磁盘指标数组。     | `Array<Object>` |
| `diskMetrics[].diskPath`     | 磁盘挂载点路径。                 | `string`        |
| `diskMetrics[].usagePercent` | 该挂载点的磁盘使用率百分比。     | `number`        |
| `diskMetrics[].freePercent`  | 该挂载点的磁盘空闲百分比。       | `number`        |
| `diskMetrics[].totalBytes`   | 该挂载点的总磁盘空间（字节）。   | `number`        |
| `processes`                  | 服务器上运行的进程数组。         | `Array<Object>` |
| `processes[].pid`            | 进程 ID。                        | `number`        |
| `processes[].name`           | 进程名称。                       | `string`        |
| `processes[].command`        | 启动进程的命令。                 | `string`        |
| `failureCause`               | 服务器检查失败的原因（如失败）。 | `string`        |

### 合成监控器

合成监控器在多个浏览器（Chromium、Firefox、Webkit）和屏幕尺寸（移动端、平板、桌面）上运行相同的脚本，每个配置产生一个响应。每次运行通过 `syntheticResponses` 数组暴露——通过索引访问特定运行（`{{syntheticResponses[0].browserType}}`）或使用 `{{#each syntheticResponses}}` 迭代。

| 变量                                     | 描述                                                      | 类型                                    |
| ---------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| `failureCause`                           | 合成检查失败的原因（如失败）。                            | `string`                                |
| `syntheticResponses`                     | 包含脚本针对每个浏览器/屏幕尺寸组合运行的一个条目的数组。 | `Array<Object>`                         |
| `syntheticResponses[].executionTimeInMs` | 该次运行的执行时间（毫秒）。                              | `number`                                |
| `syntheticResponses[].result`            | 该次运行返回的结果。                                      | `string`、`number`、`boolean` 或 `JSON` |
| `syntheticResponses[].scriptError`       | 该次运行期间发生的任何错误。                              | `string`                                |
| `syntheticResponses[].logMessages`       | 该次运行期间生成的日志消息。                              | `Array<string>`                         |
| `syntheticResponses[].screenshots`       | 该次运行期间捕获的截图。                                  | `Object`                                |
| `syntheticResponses[].browserType`       | 该次运行使用的浏览器。                                    | `string`                                |
| `syntheticResponses[].screenSizeType`    | 该次运行使用的屏幕尺寸。                                  | `string`                                |

### 自定义 JavaScript 代码监控器

| 变量                | 描述                                 | 类型                                    |
| ------------------- | ------------------------------------ | --------------------------------------- |
| `executionTimeInMs` | 执行自定义代码所花费的时间（毫秒）。 | `number`                                |
| `result`            | 自定义代码返回的结果。               | `string`、`number`、`boolean` 或 `JSON` |
| `scriptError`       | 代码执行期间发生的任何错误。         | `string`                                |
| `logMessages`       | 执行期间生成的日志消息数组。         | `Array<string>`                         |

### SNMP 监控器

| 变量                   | 描述                                                | 类型                 |
| ---------------------- | --------------------------------------------------- | -------------------- |
| `isOnline`             | SNMP 设备是否在线并响应。                           | `boolean`            |
| `responseTimeInMs`     | SNMP 查询响应时间（毫秒）。                         | `number`             |
| `failureCause`         | SNMP 查询失败的原因（如失败）。                     | `string`             |
| `isTimeout`            | SNMP 查询是否超时。                                 | `boolean`            |
| `oidResponses`         | 包含 oid、name、value 和 type 的 OID 响应对象数组。 | `Array<Object>`      |
| `oidResponses[].oid`   | 被查询的 OID。                                      | `string`             |
| `oidResponses[].name`  | OID 的友好名称（如果提供）。                        | `string`             |
| `oidResponses[].value` | OID 返回的值。                                      | `string` 或 `number` |
| `oidResponses[].type`  | 值的 SNMP 数据类型。                                | `string`             |
| `{{OID_NAME}}`         | 按名称直接访问 OID 值（例如 `{{sysUpTime}}`）。     | `string` 或 `number` |

## 基本用法

在监控器标准实例内的事件/告警表单中，您可以写：

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

如果监控器响应状态码为 `502`，时间为 `842`，则存储的标题变为：

```
API returned 502 in 842ms
```

嵌套 JSON 访问的工作方式与 JavaScript 表达式相同：

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

支持数组索引：

```
First User: {{responseBody.users[0].name}}
```

如果路径不存在，默认解析为空字符串。

## 高级用法

### 访问数组元素

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### 嵌套对象访问

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### 使用 `{{#each}}` 循环遍历数组

您可以使用 `{{#each path}}...{{/each}}` 块语法迭代数组。当数据包含一系列项目且您希望在事件或告警描述中包含每个项目时，这非常有用。

**语法：**

```
{{#each arrayPath}}
  ...使用每个元素的 {{property}} 的正文...
{{/each}}
```

在循环体内：

- `{{propertyName}}` 相对于当前数组元素解析
- `{{nested.property}}` 点符号访问在当前元素上有效
- `{{@index}}` 解析为当前迭代的从 0 开始的索引
- `{{this}}` 解析为当前元素值（对字符串/数字数组有用）
- 在当前元素上找不到的变量会退回到父存储映射

**示例 — 包含告警数组的传入请求（例如 Grafana Webhooks）：**

如果您的传入请求体如下：

```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

您可以编写如下模板：

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

输出为：

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**示例 — 服务器磁盘指标：**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**示例 — 使用 `{{@index}}`：**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**示例 — 使用 `{{this}}` 的基本类型数组：**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**示例 — 嵌套循环：**

您可以为多级数组嵌套 `{{#each}}` 块：

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **注意**：如果路径未解析为数组，则整个 `{{#each}}...{{/each}}` 块将从输出中删除。空数组不会为该块产生任何输出。

## 示例

### 网站/API 监控器事件标题

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### 网站/API 监控器事件描述

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### 传入请求告警标题

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL 证书告警标题

```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### 服务器监控告警描述

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**
Last Check: {{requestReceivedAt}}
```

### Ping 监控告警标题

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### 端口监控告警描述

```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### 合成监控告警

通过索引访问特定浏览器/屏幕尺寸运行：

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

使用 `{{#each}}` 迭代每个浏览器/屏幕尺寸组合：

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### 自定义代码监控告警

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP 监控告警标题

```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP 监控告警描述

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### 包含数组循环的传入请求（Grafana Webhook）

标题：

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

描述：

```
### Alerts from {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Alert {{@index}}**: {{labels.alertname}}
- Label: {{labels.label}}
- Status: {{status}}
- Values: {{valueString}}
- Source: {{generatorURL}}
{{/each}}
```

### 带磁盘循环的服务器监控

描述：

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**

**Disk Usage:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used ({{freePercent}}% free)
{{/each}}

**Running Processes:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### 带 OID 循环的 SNMP 监控

描述：

```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
