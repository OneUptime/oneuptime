# Incident और Alert Dynamic Templating

आप monitor criteria से auto-created होने पर Incident और Alert Title, Description और Remediation Notes को dynamically populate करने के लिए JavaScript Expressions द्वारा उपयोग की जाने वाली same `{{variable}}` placeholder syntax उपयोग कर सकते हैं।

## समर्थित Monitor Types और Variables

निम्नलिखित monitor types अपने respective variables के साथ dynamic templating का समर्थन करते हैं:

- **Website और API Monitors**: Response data, headers, status codes, timing
- **Incoming Request Monitors**: Request data, headers, methods, timing
- **Ping Monitors**: Connectivity status, response times, failure causes
- **Port Monitors**: Port connectivity, response times, timeout status
- **IP Monitors**: IP reachability, ping times, failure information
- **SSL Certificate Monitors**: Certificate details, validation status, expiration info
- **Server/VM Monitors**: System metrics (CPU, memory, disk), processes, hostname
- **Synthetic Monitors**: Script execution results, screenshots, browser details
- **Custom JavaScript Code Monitors**: Execution results, timing, error messages
- **SNMP Monitors**: Device status, response times, OID values

> **नोट**: Logs, Traces और Metrics monitors वर्तमान में incident/alert templating का समर्थन नहीं करते क्योंकि वे अलग trigger mechanisms उपयोग करते हैं।

## समर्थित Monitor Types और Variables

### Website और API Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `responseBody` | response body object। HTML/XML है तो string। JSON है तो JSON object। | `string` या `JSON` |
| `responseHeaders` | response headers object (keys lower-cased)। | `Dictionary<string>` |
| `responseStatusCode` | HTTP response status code। | `number` |
| `responseTimeInMs` | milliseconds में response time। | `number` |
| `isOnline` | monitor online माना जाता है या नहीं। | `boolean` |

### Incoming Request Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `requestBody` | request body object। | `string` या `JSON` |
| `requestHeaders` | request headers object (keys lower-cased)। | `Dictionary<string>` |
| `requestMethod` | incoming request का HTTP method (GET, POST, आदि)। | `string` |
| `incomingRequestReceivedAt` | incoming request received होने की date और time। | `Date` |

### Ping Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `isOnline` | ping target online माना जाता है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में ping response time। | `number` |
| `failureCause` | ping fail होने पर failure का कारण। | `string` |
| `isTimeout` | ping request timeout हुआ या नहीं। | `boolean` |

### Port Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `isOnline` | port online/accessible माना जाता है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में connection response time। | `number` |
| `failureCause` | port check fail होने पर failure का कारण। | `string` |
| `isTimeout` | port connection timeout हुआ या नहीं। | `boolean` |

### IP Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `isOnline` | IP address online माना जाता है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में ping response time। | `number` |
| `failureCause` | IP check fail होने पर failure का कारण। | `string` |
| `isTimeout` | IP ping request timeout हुआ या नहीं। | `boolean` |

### SSL Certificate Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `isOnline` | SSL certificate check successful था या नहीं। | `boolean` |
| `isSelfSigned` | SSL certificate self-signed है या नहीं। | `boolean` |
| `createdAt` | SSL certificate कब बनाया गया। | `Date` |
| `expiresAt` | SSL certificate कब expire होगा। | `Date` |
| `commonName` | certificate से common name (CN)। | `string` |
| `organizationalUnit` | certificate से organizational unit (OU)। | `string` |
| `organization` | certificate से organization (O)। | `string` |
| `locality` | certificate से locality (L)। | `string` |
| `state` | certificate से state/province (ST)। | `string` |
| `country` | certificate से country (C)। | `string` |
| `serialNumber` | certificate का serial number। | `string` |
| `fingerprint` | certificate का SHA-1 fingerprint। | `string` |
| `fingerprint256` | certificate का SHA-256 fingerprint। | `string` |
| `failureCause` | SSL check fail होने पर failure का कारण। | `string` |

### Server/VM Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `hostname` | monitored server का hostname। | `string` |
| `requestReceivedAt` | server monitor request received होने की date और time। | `Date` |
| `cpuUsagePercent` | CPU usage percentage। | `number` |
| `cpuCores` | CPU cores की संख्या। | `number` |
| `memoryUsagePercent` | memory usage percentage। | `number` |
| `memoryFreePercent` | free memory percentage। | `number` |
| `memoryTotalBytes` | bytes में total memory। | `number` |
| `diskMetrics` | सभी mounted disks के लिए disk metrics का Array। | `Array<Object>` |
| `diskMetrics[].diskPath` | disk mount point का path। | `string` |
| `diskMetrics[].usagePercent` | इस mount point के लिए disk usage percentage। | `number` |
| `diskMetrics[].freePercent` | इस mount point के लिए disk free percentage। | `number` |
| `diskMetrics[].totalBytes` | इस mount point के लिए bytes में total disk space। | `number` |
| `processes` | server पर चलने वाले processes का Array। | `Array<Object>` |
| `processes[].pid` | process ID। | `number` |
| `processes[].name` | process name। | `string` |
| `processes[].command` | process start करने के लिए उपयोग की गई command। | `string` |
| `failureCause` | server check fail होने पर failure का कारण। | `string` |

### Synthetic Monitors

Synthetic monitors script को कई browsers (Chromium, Firefox, Webkit) और screen sizes (mobile, tablet, desktop) पर चलाते हैं, प्रति configuration एक response produce करते हैं। प्रत्येक run `syntheticResponses` array के माध्यम से exposed होती है — index से specific run access करें (`{{syntheticResponses[0].browserType}}`) या `{{#each syntheticResponses}}` से iterate करें।

| Variable | विवरण | Type |
| --- | --- | --- |
| `failureCause` | synthetic check fail होने पर failure का कारण। | `string` |
| `syntheticResponses` | script जिस browser/screen-size combination पर चली प्रत्येक के लिए एक entry वाला Array। | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | इस run के लिए milliseconds में execution time। | `number` |
| `syntheticResponses[].result` | इस run द्वारा returned result। | `string`, `number`, `boolean`, या `JSON` |
| `syntheticResponses[].scriptError` | इस run के दौरान कोई error। | `string` |
| `syntheticResponses[].logMessages` | इस run के दौरान generated log messages। | `Array<string>` |
| `syntheticResponses[].screenshots` | इस run के दौरान captured screenshots। | `Object` |
| `syntheticResponses[].browserType` | इस run के लिए उपयोग किया गया Browser। | `string` |
| `syntheticResponses[].screenSizeType` | इस run के लिए उपयोग किया गया Screen size। | `string` |

### Custom JavaScript Code Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `executionTimeInMs` | milliseconds में custom code execute होने में लगा समय। | `number` |
| `result` | custom code द्वारा returned result। | `string`, `number`, `boolean`, या `JSON` |
| `scriptError` | code execution के दौरान कोई error। | `string` |
| `logMessages` | execution के दौरान generated log messages का Array। | `Array<string>` |

### SNMP Monitors

| Variable | विवरण | Type |
| --- | --- | --- |
| `isOnline` | SNMP device online और responding है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में SNMP query response time। | `number` |
| `failureCause` | SNMP query fail होने पर failure का कारण। | `string` |
| `isTimeout` | SNMP query timeout हुई या नहीं। | `boolean` |
| `oidResponses` | oid, name, value और type के साथ OID response objects का Array। | `Array<Object>` |
| `oidResponses[].oid` | query किया गया OID। | `string` |
| `oidResponses[].name` | OID का friendly name (यदि प्रदान किया गया हो)। | `string` |
| `oidResponses[].value` | OID द्वारा returned value। | `string` या `number` |
| `oidResponses[].type` | value का SNMP data type। | `string` |
| `{{OID_NAME}}` | name से OID value तक direct access (जैसे `{{sysUpTime}}`)। | `string` या `number` |


## Basic Usage

एक Monitor Criteria instance के अंदर Incident/Alert form में, आप लिख सकते हैं:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

यदि monitor response status code `502` है और time `842` है, तो stored title बन जाता है:

```
API returned 502 in 842ms
```

Nested JSON access उसी तरह काम करता है जैसे JavaScript Expressions:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array indexing supported है:

```
First User: {{responseBody.users[0].name}}
```

यदि कोई path मौजूद नहीं है तो वह default रूप से empty string में resolve होता है।

## Advanced Usage

### Array Elements तक पहुंचना
```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Nested Object Access
```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### `{{#each}}` के साथ Arrays पर Looping

आप `{{#each path}}...{{/each}}` block syntax उपयोग करके arrays पर iterate कर सकते हैं। यह उपयोगी होता है जब data में items की एक list होती है और आप प्रत्येक को अपने incident या alert description में शामिल करना चाहते हैं।

**Syntax:**
```
{{#each arrayPath}}
  ...body using {{property}} from each element...
{{/each}}
```

loop body के अंदर:
- `{{propertyName}}` current array element के relative resolve होता है
- `{{nested.property}}` dot-notation access current element पर काम करता है
- `{{@index}}` current iteration का 0-based index है
- `{{this}}` current element value है (strings/numbers के arrays के लिए उपयोगी)
- current element पर नहीं मिलने वाले Variables parent storage map पर fallback करते हैं

**उदाहरण — alerts के array के साथ Incoming Request (जैसे Grafana webhooks):**

यदि आपका incoming request body इस तरह दिखता है:
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

आप एक template इस तरह लिख सकते हैं:
```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

जो produce करता है:
```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**उदाहरण — Server disk metrics:**
```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**उदाहरण — `{{@index}}` उपयोग करना:**
```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**उदाहरण — `{{this}}` के साथ Primitive array:**
```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

> **नोट**: यदि path एक array में resolve नहीं होता, तो पूरा `{{#each}}...{{/each}}` block output से remove हो जाता है। Empty arrays block के लिए कोई output produce नहीं करते।


## उदाहरण

### Website/API Monitor Incident Title
```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### SSL Certificate Alert Title
```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Server Monitor Alert Description
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**  
Memory Usage: **{{memoryUsagePercent}}%**  
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**  
Last Check: {{requestReceivedAt}}
```

### SNMP Monitor Alert Title
```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```
