# 事件和警報動態模板

您可以在監控器標準的 JavaScript 表達式中使用的相同 `{{variable}}` 佔位符語法，來動態填充從監控器標準自動創建的事件和警報的標題、描述和修復說明。

## 支持的監控器類型和變量

以下監控器類型支持使用各自變量進行動態模板：

- **網站和 API 監控器**：響應數據、頭信息、狀態碼、時間
- **傳入請求監控器**：請求數據、頭信息、方法、時間
- **Ping 監控器**：連接狀態、響應時間、失敗原因
- **端口監控器**：端口連接性、響應時間、超時狀態
- **IP 監控器**：IP 可達性、Ping 時間、失敗信息
- **SSL 證書監控器**：證書詳情、驗證狀態、過期信息
- **服務器/虛擬機監控器**：系統指標（CPU、內存、磁盤）、進程、主機名
- **合成監控器**：腳本執行結果、截圖、瀏覽器詳情
- **自定義 JavaScript 代碼監控器**：執行結果、時間、錯誤消息
- **SNMP 監控器**：設備狀態、響應時間、OID 值

> **注意**：日誌、追蹤和指標監控器目前不支持事件/警報模板，因爲它們使用不同的觸發機制。

## 支持的監控器類型和變量

### 網站和 API 監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `responseBody` | 響應體對象。如果是 HTML/XML 則爲字符串，如果是 JSON 則爲 JSON 對象。 | `string` 或 `JSON` |
| `responseHeaders` | 響應頭對象（鍵名爲小寫）。 | `Dictionary<string>` |
| `responseStatusCode` | HTTP 響應狀態碼。 | `number` |
| `responseTimeInMs` | 響應時間（毫秒）。 | `number` |
| `isOnline` | 監控器是否被認爲在線。 | `boolean` |

### 傳入請求監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `requestBody` | 請求體對象。 | `string` 或 `JSON` |
| `requestHeaders` | 請求頭對象（鍵名爲小寫）。 | `Dictionary<string>` |
| `requestMethod` | 傳入請求的 HTTP 方法（GET、POST 等）。 | `string` |
| `incomingRequestReceivedAt` | 收到傳入請求的日期和時間。 | `Date` |

### Ping 監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `isOnline` | Ping 目標是否被認爲在線。 | `boolean` |
| `responseTimeInMs` | Ping 響應時間（毫秒）。 | `number` |
| `failureCause` | Ping 失敗的原因（如失敗）。 | `string` |
| `isTimeout` | Ping 請求是否超時。 | `boolean` |

### 端口監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `isOnline` | 端口是否被認爲在線/可訪問。 | `boolean` |
| `responseTimeInMs` | 連接響應時間（毫秒）。 | `number` |
| `failureCause` | 端口檢查失敗的原因（如失敗）。 | `string` |
| `isTimeout` | 端口連接是否超時。 | `boolean` |

### IP 監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `isOnline` | IP 地址是否被認爲在線。 | `boolean` |
| `responseTimeInMs` | Ping 響應時間（毫秒）。 | `number` |
| `failureCause` | IP 檢查失敗的原因（如失敗）。 | `string` |
| `isTimeout` | IP Ping 請求是否超時。 | `boolean` |

### SSL 證書監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `isOnline` | SSL 證書檢查是否成功。 | `boolean` |
| `isSelfSigned` | SSL 證書是否爲自簽名證書。 | `boolean` |
| `createdAt` | SSL 證書創建日期。 | `Date` |
| `expiresAt` | SSL 證書過期日期。 | `Date` |
| `commonName` | 證書中的通用名稱（CN）。 | `string` |
| `organizationalUnit` | 證書中的組織單位（OU）。 | `string` |
| `organization` | 證書中的組織（O）。 | `string` |
| `locality` | 證書中的地區（L）。 | `string` |
| `state` | 證書中的州/省（ST）。 | `string` |
| `country` | 證書中的國家（C）。 | `string` |
| `serialNumber` | 證書的序列號。 | `string` |
| `fingerprint` | 證書的 SHA-1 指紋。 | `string` |
| `fingerprint256` | 證書的 SHA-256 指紋。 | `string` |
| `failureCause` | SSL 檢查失敗的原因（如失敗）。 | `string` |

### 服務器/虛擬機監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `hostname` | 受監控服務器的主機名。 | `string` |
| `requestReceivedAt` | 收到服務器監控請求的日期和時間。 | `Date` |
| `cpuUsagePercent` | CPU 使用率百分比。 | `number` |
| `cpuCores` | CPU 核心數。 | `number` |
| `memoryUsagePercent` | 內存使用率百分比。 | `number` |
| `memoryFreePercent` | 內存空閒百分比。 | `number` |
| `memoryTotalBytes` | 總內存（字節）。 | `number` |
| `diskMetrics` | 所有掛載磁盤的磁盤指標數組。 | `Array<Object>` |
| `diskMetrics[].diskPath` | 磁盤掛載點路徑。 | `string` |
| `diskMetrics[].usagePercent` | 該掛載點的磁盤使用率百分比。 | `number` |
| `diskMetrics[].freePercent` | 該掛載點的磁盤空閒百分比。 | `number` |
| `diskMetrics[].totalBytes` | 該掛載點的總磁盤空間（字節）。 | `number` |
| `processes` | 服務器上運行的進程數組。 | `Array<Object>` |
| `processes[].pid` | 進程 ID。 | `number` |
| `processes[].name` | 進程名稱。 | `string` |
| `processes[].command` | 啓動進程的命令。 | `string` |
| `failureCause` | 服務器檢查失敗的原因（如失敗）。 | `string` |

### 合成監控器

合成監控器在多個瀏覽器（Chromium、Firefox、Webkit）和屏幕尺寸（移動端、平板、桌面）上運行相同的腳本，每個配置產生一個響應。每次運行通過 `syntheticResponses` 數組暴露——通過索引訪問特定運行（`{{syntheticResponses[0].browserType}}`）或使用 `{{#each syntheticResponses}}` 迭代。

| 變量 | 描述 | 類型 |
|------|------|------|
| `failureCause` | 合成檢查失敗的原因（如失敗）。 | `string` |
| `syntheticResponses` | 包含腳本針對每個瀏覽器/屏幕尺寸組合運行的一個條目的數組。 | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | 該次運行的執行時間（毫秒）。 | `number` |
| `syntheticResponses[].result` | 該次運行返回的結果。 | `string`、`number`、`boolean` 或 `JSON` |
| `syntheticResponses[].scriptError` | 該次運行期間發生的任何錯誤。 | `string` |
| `syntheticResponses[].logMessages` | 該次運行期間生成的日誌消息。 | `Array<string>` |
| `syntheticResponses[].screenshots` | 該次運行期間捕獲的截圖。 | `Object` |
| `syntheticResponses[].browserType` | 該次運行使用的瀏覽器。 | `string` |
| `syntheticResponses[].screenSizeType` | 該次運行使用的屏幕尺寸。 | `string` |

### 自定義 JavaScript 代碼監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `executionTimeInMs` | 執行自定義代碼所花費的時間（毫秒）。 | `number` |
| `result` | 自定義代碼返回的結果。 | `string`、`number`、`boolean` 或 `JSON` |
| `scriptError` | 代碼執行期間發生的任何錯誤。 | `string` |
| `logMessages` | 執行期間生成的日誌消息數組。 | `Array<string>` |

### SNMP 監控器

| 變量 | 描述 | 類型 |
|------|------|------|
| `isOnline` | SNMP 設備是否在線並響應。 | `boolean` |
| `responseTimeInMs` | SNMP 查詢響應時間（毫秒）。 | `number` |
| `failureCause` | SNMP 查詢失敗的原因（如失敗）。 | `string` |
| `isTimeout` | SNMP 查詢是否超時。 | `boolean` |
| `oidResponses` | 包含 oid、name、value 和 type 的 OID 響應對象數組。 | `Array<Object>` |
| `oidResponses[].oid` | 被查詢的 OID。 | `string` |
| `oidResponses[].name` | OID 的友好名稱（如果提供）。 | `string` |
| `oidResponses[].value` | OID 返回的值。 | `string` 或 `number` |
| `oidResponses[].type` | 值的 SNMP 數據類型。 | `string` |
| `{{OID_NAME}}` | 按名稱直接訪問 OID 值（例如 `{{sysUpTime}}`）。 | `string` 或 `number` |


## 基本用法

在監控器標準實例內的事件/警報表單中，您可以寫：

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

如果監控器響應狀態碼爲 `502`，時間爲 `842`，則儲存的標題變爲：

```
API returned 502 in 842ms
```

嵌套 JSON 訪問的工作方式與 JavaScript 表達式相同：

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

支持數組索引：

```
First User: {{responseBody.users[0].name}}
```

如果路徑不存在，默認解析爲空字符串。

## 高級用法

### 訪問數組元素
```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### 嵌套對象訪問
```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### 使用 `{{#each}}` 循環遍歷數組

您可以使用 `{{#each path}}...{{/each}}` 塊語法迭代數組。當數據包含一系列項目且您希望在事件或警報描述中包含每個項目時，這非常有用。

**語法：**
```
{{#each arrayPath}}
  ...使用每個元素的 {{property}} 的正文...
{{/each}}
```

在循環體內：
- `{{propertyName}}` 相對於當前數組元素解析
- `{{nested.property}}` 點符號訪問在當前元素上有效
- `{{@index}}` 解析爲當前迭代的從 0 開始的索引
- `{{this}}` 解析爲當前元素值（對字符串/數字數組有用）
- 在當前元素上找不到的變量會退回到父儲存映射

**示例 — 包含警報數組的傳入請求（例如 Grafana Webhooks）：**

如果您的傳入請求體如下：
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

您可以編寫如下模板：
```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

輸出爲：
```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**示例 — 服務器磁盤指標：**
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

**示例 — 使用 `{{this}}` 的基本類型數組：**
```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**示例 — 嵌套循環：**

您可以爲多級數組嵌套 `{{#each}}` 塊：
```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **注意**：如果路徑未解析爲數組，則整個 `{{#each}}...{{/each}}` 塊將從輸出中刪除。空數組不會爲該塊產生任何輸出。


## 示例

### 網站/API 監控器事件標題
```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### 網站/API 監控器事件描述
```
### API Error
Status: **{{responseStatusCode}}**  
Latency: **{{responseTimeInMs}}ms**  
Body Snippet: `{{responseBody.error.message}}`
```

### 傳入請求警報標題
```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL 證書警報標題
```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### 服務器監控警報描述
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**  
Memory Usage: **{{memoryUsagePercent}}%**  
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**  
Last Check: {{requestReceivedAt}}
```

### Ping 監控警報標題
```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### 端口監控警報描述
```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### 合成監控警報

通過索引訪問特定瀏覽器/屏幕尺寸運行：
```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

使用 `{{#each}}` 迭代每個瀏覽器/屏幕尺寸組合：
```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### 自定義代碼監控警報
```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP 監控警報標題
```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP 監控警報描述
```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### 包含數組循環的傳入請求（Grafana Webhook）

標題：
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

### 帶磁盤循環的服務器監控

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

### 帶 OID 循環的 SNMP 監控

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
