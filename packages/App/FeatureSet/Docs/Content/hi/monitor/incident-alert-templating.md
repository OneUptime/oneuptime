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

| Variable             | विवरण                                                                | Type                 |
| -------------------- | -------------------------------------------------------------------- | -------------------- |
| `responseBody`       | response body object। HTML/XML है तो string। JSON है तो JSON object। | `string` या `JSON`   |
| `responseHeaders`    | response headers object (keys lower-cased)।                          | `Dictionary<string>` |
| `responseStatusCode` | HTTP response status code।                                           | `number`             |
| `responseTimeInMs`   | milliseconds में response time।                                      | `number`             |
| `isOnline`           | monitor online माना जाता है या नहीं।                                 | `boolean`            |

### Incoming Request Monitors

| Variable                    | विवरण                                             | Type                 |
| --------------------------- | ------------------------------------------------- | -------------------- |
| `requestBody`               | request body object।                              | `string` या `JSON`   |
| `requestHeaders`            | request headers object (keys lower-cased)।        | `Dictionary<string>` |
| `requestMethod`             | incoming request का HTTP method (GET, POST, आदि)। | `string`             |
| `incomingRequestReceivedAt` | incoming request received होने की date और time।   | `Date`               |

जब criteria में **Group incidents and alerts by a payload field** चालू होता है, तो निकाली गई grouping key भी उपलब्ध रहती है — एक ऐसे variable नाम के तहत जो grouping path के **आख़िरी segment** से लिया जाता है। `requestBody.alerts[*].labels.alertname` से grouping करने पर `{{alertname}}` मिलता है; `requestBody.alerts[*].fingerprint` से grouping करने पर `{{fingerprint}}` मिलता है। पूरा `requestBody` उसके साथ-साथ उपलब्ध रहता है।

> **Note:** `[*]` केवल grouping path वाले फ़ील्ड्स में ही समझा जाता है — यहाँ यह resolve नहीं होता, इसलिए placeholder ज्यों का त्यों, ब्रेसेज़ समेत छप जाता है। किसी title या description के अंदर `{{requestBody.alerts[0].annotations.summary}}` हमेशा payload का पहला alert पढ़ता है, वह नहीं जिसके लिए incident खोला गया था। इसके बजाय grouping variable और payload के साझा फ़ील्ड (`commonLabels`, `commonAnnotations`) इस्तेमाल करें। देखें [Incoming Request मॉनिटर](/docs/monitor/incoming-request-monitor)।

### Ping Monitors

| Variable           | विवरण                                    | Type      |
| ------------------ | ---------------------------------------- | --------- |
| `isOnline`         | ping target online माना जाता है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में ping response time।     | `number`  |
| `failureCause`     | ping fail होने पर failure का कारण।       | `string`  |
| `isTimeout`        | ping request timeout हुआ या नहीं।        | `boolean` |

### Port Monitors

| Variable           | विवरण                                        | Type      |
| ------------------ | -------------------------------------------- | --------- |
| `isOnline`         | port online/accessible माना जाता है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में connection response time।   | `number`  |
| `failureCause`     | port check fail होने पर failure का कारण।     | `string`  |
| `isTimeout`        | port connection timeout हुआ या नहीं।         | `boolean` |

### IP Monitors

| Variable           | विवरण                                   | Type      |
| ------------------ | --------------------------------------- | --------- |
| `isOnline`         | IP address online माना जाता है या नहीं। | `boolean` |
| `responseTimeInMs` | milliseconds में ping response time।    | `number`  |
| `failureCause`     | IP check fail होने पर failure का कारण।  | `string`  |
| `isTimeout`        | IP ping request timeout हुआ या नहीं।    | `boolean` |

### NTP Monitors

| Variable             | विवरण                                                                                               | Type      |
| -------------------- | --------------------------------------------------------------------------------------------------- | --------- |
| `isOnline`           | टाइम सर्वर ने प्रोब के अनुरोध का जवाब दिया या नहीं।                                                 | `boolean` |
| `isSynchronized`     | क्या उसने स्ट्रेटम 1 से 15 पर, लीप अलार्म के बिना और असली टाइमस्टैम्प के साथ जवाब दिया।             | `boolean` |
| `stratum`            | सर्वर का बताया स्ट्रेटम: प्राइमरी सर्वर के लिए 1, सिंक्रनाइज़ न होने पर 16, kiss-o'-death के लिए 0। | `number`  |
| `clockOffsetInMs`    | सर्वर की घड़ी प्रोब की घड़ी से कितनी दूर है, मिलीसेकंड में। धनात्मक का मतलब है कि सर्वर आगे है।     | `number`  |
| `referenceId`        | सर्वर किससे सिंक होता है: स्ट्रेटम 1 पर `GPS` जैसा स्रोत, या उसके ऊपर वाले सर्वर का पता।            | `string`  |
| `leapIndicator`      | सब ठीक होने पर 0 से 2, जब सर्वर कहे कि उसकी घड़ी सिंक्रनाइज़ नहीं है तो 3।                          | `number`  |
| `kissCode`           | स्ट्रेटम 0 पर, सर्वर ने समय की जगह जो चार अक्षरों का कोड भेजा, जैसे `RATE`।                         | `string`  |
| `responseTimeInMs`   | अनुरोध से जवाब तक का समय, मिलीसेकंड में।                                                            | `number`  |
| `roundTripDelayInMs` | सर्वर के अपने प्रोसेसिंग समय के बिना, इस आदान-प्रदान का नेटवर्क राउंड ट्रिप।                        | `number`  |
| `rootDelayInMs`      | सर्वर से उसकी रेफ़रेंस घड़ी तक का राउंड ट्रिप, मिलीसेकंड में।                                       | `number`  |
| `rootDispersionInMs` | सर्वर का अपनी अधिकतम त्रुटि का अपना अनुमान, मिलीसेकंड में।                                          | `number`  |
| `serverTime`         | जवाब भेजते समय सर्वर की घड़ी, ISO 8601 टाइमस्टैम्प के रूप में।                                      | `string`  |
| `referenceTime`      | सर्वर की घड़ी आखिरी बार कब सेट या ठीक की गई, ISO 8601 टाइमस्टैम्प के रूप में।                       | `string`  |
| `serverAddress`      | वह पता जिस पर अनुरोध गया।                                                                           | `string`  |
| `port`               | वह UDP पोर्ट जिस पर अनुरोध गया।                                                                     | `number`  |
| `failureCause`       | सर्वर ने जवाब क्यों नहीं दिया, या वह सिंक्रनाइज़ क्यों नहीं है।                                     | `string`  |
| `isTimeout`          | सर्वर ने समय पर जवाब नहीं दिया या नहीं।                                                             | `boolean` |

### SSL Certificate Monitors

| Variable             | विवरण                                        | Type      |
| -------------------- | -------------------------------------------- | --------- |
| `isOnline`           | SSL certificate check successful था या नहीं। | `boolean` |
| `isSelfSigned`       | SSL certificate self-signed है या नहीं।      | `boolean` |
| `createdAt`          | SSL certificate कब बनाया गया।                | `Date`    |
| `expiresAt`          | SSL certificate कब expire होगा।              | `Date`    |
| `commonName`         | certificate से common name (CN)।             | `string`  |
| `organizationalUnit` | certificate से organizational unit (OU)।     | `string`  |
| `organization`       | certificate से organization (O)।             | `string`  |
| `locality`           | certificate से locality (L)।                 | `string`  |
| `state`              | certificate से state/province (ST)।          | `string`  |
| `country`            | certificate से country (C)।                  | `string`  |
| `serialNumber`       | certificate का serial number।                | `string`  |
| `fingerprint`        | certificate का SHA-1 fingerprint।            | `string`  |
| `fingerprint256`     | certificate का SHA-256 fingerprint।          | `string`  |
| `failureCause`       | SSL check fail होने पर failure का कारण।      | `string`  |

### Server/VM Monitors

| Variable                     | विवरण                                                 | Type            |
| ---------------------------- | ----------------------------------------------------- | --------------- |
| `hostname`                   | monitored server का hostname।                         | `string`        |
| `requestReceivedAt`          | server monitor request received होने की date और time। | `Date`          |
| `cpuUsagePercent`            | CPU usage percentage।                                 | `number`        |
| `cpuCores`                   | CPU cores की संख्या।                                  | `number`        |
| `memoryUsagePercent`         | memory usage percentage।                              | `number`        |
| `memoryFreePercent`          | free memory percentage।                               | `number`        |
| `memoryTotalBytes`           | bytes में total memory।                               | `number`        |
| `diskMetrics`                | सभी mounted disks के लिए disk metrics का Array।       | `Array<Object>` |
| `diskMetrics[].diskPath`     | disk mount point का path।                             | `string`        |
| `diskMetrics[].usagePercent` | इस mount point के लिए disk usage percentage।          | `number`        |
| `diskMetrics[].freePercent`  | इस mount point के लिए disk free percentage।           | `number`        |
| `diskMetrics[].totalBytes`   | इस mount point के लिए bytes में total disk space।     | `number`        |
| `processes`                  | server पर चलने वाले processes का Array।               | `Array<Object>` |
| `processes[].pid`            | process ID।                                           | `number`        |
| `processes[].name`           | process name।                                         | `string`        |
| `processes[].command`        | process start करने के लिए उपयोग की गई command।        | `string`        |
| `failureCause`               | server check fail होने पर failure का कारण।            | `string`        |

### Synthetic Monitors

Synthetic monitors script को कई browsers (Chromium, Firefox, Webkit) और screen sizes (mobile, tablet, desktop) पर चलाते हैं, प्रति configuration एक response produce करते हैं। प्रत्येक run `syntheticResponses` array के माध्यम से exposed होती है — index से specific run access करें (`{{syntheticResponses[0].browserType}}`) या `{{#each syntheticResponses}}` से iterate करें।

| Variable                                 | विवरण                                                                                  | Type                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `failureCause`                           | synthetic check fail होने पर failure का कारण।                                          | `string`                                 |
| `syntheticResponses`                     | script जिस browser/screen-size combination पर चली प्रत्येक के लिए एक entry वाला Array। | `Array<Object>`                          |
| `syntheticResponses[].executionTimeInMs` | इस run के लिए milliseconds में execution time।                                         | `number`                                 |
| `syntheticResponses[].result`            | इस run द्वारा returned result।                                                         | `string`, `number`, `boolean`, या `JSON` |
| `syntheticResponses[].scriptError`       | इस run के दौरान कोई error।                                                             | `string`                                 |
| `syntheticResponses[].logMessages`       | इस run के दौरान generated log messages।                                                | `Array<string>`                          |
| `syntheticResponses[].screenshots`       | इस run के दौरान captured screenshots।                                                  | `Object`                                 |
| `syntheticResponses[].browserType`       | इस run के लिए उपयोग किया गया Browser।                                                  | `string`                                 |
| `syntheticResponses[].screenSizeType`    | इस run के लिए उपयोग किया गया Screen size।                                              | `string`                                 |

### Custom JavaScript Code Monitors

| Variable            | विवरण                                                  | Type                                     |
| ------------------- | ------------------------------------------------------ | ---------------------------------------- |
| `executionTimeInMs` | milliseconds में custom code execute होने में लगा समय। | `number`                                 |
| `result`            | custom code द्वारा returned result।                    | `string`, `number`, `boolean`, या `JSON` |
| `scriptError`       | code execution के दौरान कोई error।                     | `string`                                 |
| `logMessages`       | execution के दौरान generated log messages का Array।    | `Array<string>`                          |

### SNMP Monitors

| Variable               | विवरण                                                          | Type                 |
| ---------------------- | -------------------------------------------------------------- | -------------------- |
| `isOnline`             | SNMP device online और responding है या नहीं।                   | `boolean`            |
| `responseTimeInMs`     | milliseconds में SNMP query response time।                     | `number`             |
| `failureCause`         | SNMP query fail होने पर failure का कारण।                       | `string`             |
| `isTimeout`            | SNMP query timeout हुई या नहीं।                                | `boolean`            |
| `oidResponses`         | oid, name, value और type के साथ OID response objects का Array। | `Array<Object>`      |
| `oidResponses[].oid`   | query किया गया OID।                                            | `string`             |
| `oidResponses[].name`  | OID का friendly name (यदि प्रदान किया गया हो)।                 | `string`             |
| `oidResponses[].value` | OID द्वारा returned value।                                     | `string` या `number` |
| `oidResponses[].type`  | value का SNMP data type।                                       | `string`             |
| `{{OID_NAME}}`         | name से OID value तक direct access (जैसे `{{sysUpTime}}`)।     | `string` या `number` |

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

यदि कोई path मौजूद नहीं है, तो placeholder जैसा लिखा गया है ठीक वैसा ही output में बना रहता है — `{{responseBody.error.id}}` incident title में ब्रेसेज़ समेत ज्यों का त्यों दिखता है। केवल किसी अनुपस्थित path पर बने `{{#each}}` ब्लॉक हटाए जाते हैं।

### Description और remediation notes में values

Description और remediation notes Markdown होते हैं: ये incident या alert के page पर, email में, और उसके Slack और Microsoft Teams channels में दिखते हैं। Template वहाँ जो values रखता है, वे वही हैं जो monitored system ने भेजा - कोई response body या header, कोई incoming request या email, किसी device या series के labels - इसलिए हर value text के रूप में रखी जाती है। Template उसे जहाँ भी रखे, वह ठीक वैसी ही पढ़ी जाती है जैसी भेजी गई थी, और उसमें मौजूद कोई link, image, HTML tag या `<!channel>` जैसा Slack mention काम करने के बजाय text के रूप में दिखता है। किसी value में अकेला web address फिर भी link बनता है, ऐसा link जो दिखाता है कि वह कहाँ ले जाता है। Template में आप खुद जो Markdown लिखते हैं, वह वैसा ही दिखता है जैसा आपने लिखा।

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
