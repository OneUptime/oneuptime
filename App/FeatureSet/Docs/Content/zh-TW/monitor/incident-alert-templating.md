# 事件與警示動態範本

當事件 (Incident) 與警示 (Alert) 是依據監控條件自動建立時，您可以使用與監控條件中 JavaScript 運算式相同的 `{{variable}}` 佔位符語法，動態填入事件與警示的標題、描述與修復備註。

## 支援的監控類型與變數

以下監控類型支援搭配各自變數的動態範本：

- **網站與 API 監控**：回應資料、標頭、狀態碼、計時資訊
- **傳入請求監控**：請求資料、標頭、方法、計時資訊
- **Ping 監控**：連線狀態、回應時間、失敗原因
- **連接埠監控**：連接埠連線狀態、回應時間、逾時狀態
- **IP 監控**：IP 可達性、ping 時間、失敗資訊
- **SSL 憑證監控**：憑證詳細資料、驗證狀態、到期資訊
- **伺服器/VM 監控**：系統指標（CPU、記憶體、磁碟）、處理程序、主機名稱
- **合成監控**：指令碼執行結果、螢幕截圖、瀏覽器詳細資料
- **自訂 JavaScript 程式碼監控**：執行結果、計時資訊、錯誤訊息
- **SNMP 監控**：裝置狀態、回應時間、OID 值

> **注意**：Logs、Traces 與 Metrics 監控目前不支援事件/警示範本，因為它們使用不同的觸發機制。

## 支援的監控類型與變數

### 網站與 API 監控

| 變數                 | 描述                                                               | 型別                 |
| -------------------- | ------------------------------------------------------------------ | -------------------- |
| `responseBody`       | 回應主體物件。若為 HTML / XML 則為字串。若為 JSON 則為 JSON 物件。 | `string` 或 `JSON`   |
| `responseHeaders`    | 回應標頭物件（鍵轉為小寫）。                                       | `Dictionary<string>` |
| `responseStatusCode` | HTTP 回應狀態碼。                                                  | `number`             |
| `responseTimeInMs`   | 回應時間（毫秒）。                                                 | `number`             |
| `isOnline`           | 監控是否被視為在線。                                               | `boolean`            |

### 傳入請求監控

| 變數                        | 描述                                   | 型別                 |
| --------------------------- | -------------------------------------- | -------------------- |
| `requestBody`               | 請求主體物件。                         | `string` 或 `JSON`   |
| `requestHeaders`            | 請求標頭物件（鍵轉為小寫）。           | `Dictionary<string>` |
| `requestMethod`             | 傳入請求的 HTTP 方法（GET、POST 等）。 | `string`             |
| `incomingRequestReceivedAt` | 接收到傳入請求的日期與時間。           | `Date`               |

### Ping 監控

| 變數               | 描述                       | 型別      |
| ------------------ | -------------------------- | --------- |
| `isOnline`         | ping 目標是否被視為在線。  | `boolean` |
| `responseTimeInMs` | ping 回應時間（毫秒）。    | `number`  |
| `failureCause`     | 若 ping 失敗時的失敗原因。 | `string`  |
| `isTimeout`        | ping 請求是否逾時。        | `boolean` |

### 連接埠監控

| 變數               | 描述                           | 型別      |
| ------------------ | ------------------------------ | --------- |
| `isOnline`         | 連接埠是否被視為在線/可存取。  | `boolean` |
| `responseTimeInMs` | 連線回應時間（毫秒）。         | `number`  |
| `failureCause`     | 若連接埠檢查失敗時的失敗原因。 | `string`  |
| `isTimeout`        | 連接埠連線是否逾時。           | `boolean` |

### IP 監控

| 變數               | 描述                         | 型別      |
| ------------------ | ---------------------------- | --------- |
| `isOnline`         | IP 位址是否被視為在線。      | `boolean` |
| `responseTimeInMs` | ping 回應時間（毫秒）。      | `number`  |
| `failureCause`     | 若 IP 檢查失敗時的失敗原因。 | `string`  |
| `isTimeout`        | IP ping 請求是否逾時。       | `boolean` |

### SSL 憑證監控

| 變數                 | 描述                          | 型別      |
| -------------------- | ----------------------------- | --------- |
| `isOnline`           | SSL 憑證檢查是否成功。        | `boolean` |
| `isSelfSigned`       | SSL 憑證是否為自我簽署。      | `boolean` |
| `createdAt`          | SSL 憑證建立的日期。          | `Date`    |
| `expiresAt`          | SSL 憑證到期的日期。          | `Date`    |
| `commonName`         | 憑證中的一般名稱 (CN)。       | `string`  |
| `organizationalUnit` | 憑證中的組織單位 (OU)。       | `string`  |
| `organization`       | 憑證中的組織 (O)。            | `string`  |
| `locality`           | 憑證中的地區 (L)。            | `string`  |
| `state`              | 憑證中的州/省 (ST)。          | `string`  |
| `country`            | 憑證中的國家 (C)。            | `string`  |
| `serialNumber`       | 憑證的序號。                  | `string`  |
| `fingerprint`        | 憑證的 SHA-1 指紋。           | `string`  |
| `fingerprint256`     | 憑證的 SHA-256 指紋。         | `string`  |
| `failureCause`       | 若 SSL 檢查失敗時的失敗原因。 | `string`  |

### 伺服器/VM 監控

| 變數                         | 描述                               | 型別            |
| ---------------------------- | ---------------------------------- | --------------- |
| `hostname`                   | 受監控伺服器的主機名稱。           | `string`        |
| `requestReceivedAt`          | 接收到伺服器監控請求的日期與時間。 | `Date`          |
| `cpuUsagePercent`            | CPU 使用率百分比。                 | `number`        |
| `cpuCores`                   | CPU 核心數量。                     | `number`        |
| `memoryUsagePercent`         | 記憶體使用率百分比。               | `number`        |
| `memoryFreePercent`          | 記憶體可用百分比。                 | `number`        |
| `memoryTotalBytes`           | 記憶體總量（位元組）。             | `number`        |
| `diskMetrics`                | 所有已掛載磁碟的磁碟指標陣列。     | `Array<Object>` |
| `diskMetrics[].diskPath`     | 磁碟掛載點的路徑。                 | `string`        |
| `diskMetrics[].usagePercent` | 此掛載點的磁碟使用率百分比。       | `number`        |
| `diskMetrics[].freePercent`  | 此掛載點的磁碟可用百分比。         | `number`        |
| `diskMetrics[].totalBytes`   | 此掛載點的總磁碟空間（位元組）。   | `number`        |
| `processes`                  | 伺服器上執行中的處理程序陣列。     | `Array<Object>` |
| `processes[].pid`            | 處理程序 ID。                      | `number`        |
| `processes[].name`           | 處理程序名稱。                     | `string`        |
| `processes[].command`        | 用來啟動處理程序的指令。           | `string`        |
| `failureCause`               | 若伺服器檢查失敗時的失敗原因。     | `string`        |

### 合成監控

合成監控會在多種瀏覽器（Chromium、Firefox、Webkit）與螢幕尺寸（行動裝置、平板、桌機）上執行相同的指令碼，並為每個組態產生一筆回應。每次執行皆透過 `syntheticResponses` 陣列公開——可依索引存取特定一次執行（`{{syntheticResponses[0].browserType}}`），或使用 `{{#each syntheticResponses}}` 進行迭代。

| 變數                                     | 描述                                                        | 型別                                    |
| ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `failureCause`                           | 若合成檢查失敗時的失敗原因。                                | `string`                                |
| `syntheticResponses`                     | 陣列，內含指令碼所執行的每個瀏覽器/螢幕尺寸組合各一筆項目。 | `Array<Object>`                         |
| `syntheticResponses[].executionTimeInMs` | 此次執行的執行時間（毫秒）。                                | `number`                                |
| `syntheticResponses[].result`            | 此次執行所傳回的結果。                                      | `string`、`number`、`boolean` 或 `JSON` |
| `syntheticResponses[].scriptError`       | 此次執行期間發生的任何錯誤。                                | `string`                                |
| `syntheticResponses[].logMessages`       | 此次執行期間產生的記錄訊息。                                | `Array<string>`                         |
| `syntheticResponses[].screenshots`       | 此次執行期間擷取的螢幕截圖。                                | `Object`                                |
| `syntheticResponses[].browserType`       | 此次執行所使用的瀏覽器。                                    | `string`                                |
| `syntheticResponses[].screenSizeType`    | 此次執行所使用的螢幕尺寸。                                  | `string`                                |

### 自訂 JavaScript 程式碼監控

| 變數                | 描述                                 | 型別                                    |
| ------------------- | ------------------------------------ | --------------------------------------- |
| `executionTimeInMs` | 執行自訂程式碼所花費的時間（毫秒）。 | `number`                                |
| `result`            | 自訂程式碼所傳回的結果。             | `string`、`number`、`boolean` 或 `JSON` |
| `scriptError`       | 程式碼執行期間發生的任何錯誤。       | `string`                                |
| `logMessages`       | 執行期間產生的記錄訊息陣列。         | `Array<string>`                         |

### SNMP 監控

| 變數                   | 描述                                              | 型別                 |
| ---------------------- | ------------------------------------------------- | -------------------- |
| `isOnline`             | SNMP 裝置是否在線並有回應。                       | `boolean`            |
| `responseTimeInMs`     | SNMP 查詢回應時間（毫秒）。                       | `number`             |
| `failureCause`         | 若 SNMP 查詢失敗時的失敗原因。                    | `string`             |
| `isTimeout`            | SNMP 查詢是否逾時。                               | `boolean`            |
| `oidResponses`         | OID 回應物件陣列，包含 oid、name、value 與 type。 | `Array<Object>`      |
| `oidResponses[].oid`   | 所查詢的 OID。                                    | `string`             |
| `oidResponses[].name`  | OID 的易讀名稱（若有提供）。                      | `string`             |
| `oidResponses[].value` | OID 所傳回的值。                                  | `string` 或 `number` |
| `oidResponses[].type`  | 值的 SNMP 資料型別。                              | `string`             |
| `{{OID_NAME}}`         | 依名稱直接存取 OID 值（例如 `{{sysUpTime}}`）。   | `string` 或 `number` |

## 基本用法

在 Monitor Criteria 實例內的事件/警示表單中，您可以撰寫：

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

若監控回應狀態碼為 `502` 且時間為 `842`，所儲存的標題會變成：

```
API returned 502 in 842ms
```

巢狀 JSON 存取的運作方式與 JavaScript 運算式相同：

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

支援陣列索引：

```
First User: {{responseBody.users[0].name}}
```

若某個路徑不存在，預設會解析為空字串。

## 進階用法

### 存取陣列元素

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### 巢狀物件存取

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### 使用 `{{#each}}` 迭代陣列

您可以使用 `{{#each path}}...{{/each}}` 區塊語法迭代陣列。當資料包含一份項目清單，而您想將每一筆都納入事件或警示描述時，這會很實用。

**語法：**

```
{{#each arrayPath}}
  ...body using {{property}} from each element...
{{/each}}
```

在迴圈主體中：

- `{{propertyName}}` 相對於目前的陣列元素解析
- `{{nested.property}}` 點記號存取可作用於目前元素
- `{{@index}}` 解析為目前迭代的 0 起始索引
- `{{this}}` 解析為目前元素值（適用於字串/數字陣列）
- 在目前元素上找不到的變數會回退至父層儲存對應

**範例——含警示陣列的傳入請求（例如 Grafana webhook）：**

若您的傳入請求主體如下：

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

您可以撰寫如下範本：

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

其產生結果為：

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**範例——伺服器磁碟指標：**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**範例——使用 `{{@index}}`：**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**範例——使用 `{{this}}` 的基本型別陣列：**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**範例——巢狀迴圈：**

您可以為多層陣列巢狀使用 `{{#each}}` 區塊：

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **注意**：若路徑未解析為陣列，整個 `{{#each}}...{{/each}}` 區塊會從輸出中移除。空陣列則該區塊不會產生任何輸出。

## 範例

### 網站/API 監控事件標題

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### 網站/API 監控事件描述

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### 傳入請求警示標題

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL 憑證警示標題

```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### 伺服器監控警示描述

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**
Last Check: {{requestReceivedAt}}
```

### Ping 監控警示標題

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### 連接埠監控警示描述

```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### 合成監控警示

依索引存取特定的瀏覽器/螢幕尺寸執行：

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

使用 `{{#each}}` 迭代每個瀏覽器/螢幕尺寸組合：

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### 自訂程式碼監控警示

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP 監控警示標題

```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP 監控警示描述

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### 含陣列迴圈的傳入請求（Grafana Webhook）

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

### 含磁碟迴圈的伺服器監控

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

### 含 OID 迴圈的 SNMP 監控

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
