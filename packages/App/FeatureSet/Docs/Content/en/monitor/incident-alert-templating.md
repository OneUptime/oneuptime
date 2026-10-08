# Incident & Alert Dynamic Templating

You can use the same `{{variable}}` placeholder syntax used by JavaScript Expressions in monitor criteria to dynamically populate Incident and Alert Title, Description, and Remediation Notes when they are auto-created from monitor criteria.

## Supported Monitor Types & Variables

The following monitor types support dynamic templating with their respective variables:

- **Website and API Monitors**: Response data, headers, status codes, timing
- **Incoming Request Monitors**: Request data, headers, methods, timing
- **Incoming Email Monitors**: Email subject, sender, recipients, body, time received
- **Ping Monitors**: Connectivity status, response times, failure causes
- **Port Monitors**: Port connectivity, response times, timeout status
- **IP Monitors**: IP reachability, ping times, failure information
- **SSL Certificate Monitors**: Certificate details, validation status, expiration info
- **Server/VM Monitors**: System metrics (CPU, memory, disk), processes, hostname
- **Synthetic Monitors**: Script execution results, screenshots, browser details
- **Custom JavaScript Code Monitors**: Execution results, timing, error messages
- **Network Device (SNMP) Monitors**: Device reachability, SNMP walk time, OID values

> **Note**: Logs, Traces, and Metrics monitors do not currently support incident/alert templating as they use different trigger mechanisms.

## Supported Monitor Types & Variables

### Website and API Monitors

| Variable             | Description                                                                    | Type                 |
| -------------------- | ------------------------------------------------------------------------------ | -------------------- |
| `responseBody`       | The response body object. If HTML / XML then string. If JSON then JSON object. | `string` or `JSON`   |
| `responseHeaders`    | The response headers object (keys lower-cased).                                | `Dictionary<string>` |
| `responseStatusCode` | The HTTP response status code.                                                 | `number`             |
| `responseTimeInMs`   | The response time in milliseconds.                                             | `number`             |
| `isOnline`           | Whether the monitor is considered online.                                      | `boolean`            |

### Incoming Request Monitors

| Variable                    | Description                                                | Type                 |
| --------------------------- | ---------------------------------------------------------- | -------------------- |
| `requestBody`               | The request body object.                                   | `string` or `JSON`   |
| `requestHeaders`            | The request headers object (keys lower-cased).             | `Dictionary<string>` |
| `requestMethod`             | The HTTP method of the incoming request (GET, POST, etc.). | `string`             |
| `incomingRequestReceivedAt` | The date and time when the incoming request was received.  | `Date`               |

When the criteria has **Group incidents and alerts by a payload field** turned on, the extracted grouping key is also available, under a variable named after the **last segment** of the grouping path. Grouping by `requestBody.alerts[*].labels.alertname` gives you `{{alertname}}`; grouping by `requestBody.alerts[*].fingerprint` gives you `{{fingerprint}}`. The full `requestBody` is still available alongside it.

> **Note:** `[*]` is only understood in the grouping path fields themselves — here it does not resolve, so the placeholder is printed verbatim, braces and all. Inside a title or description, `{{requestBody.alerts[0].annotations.summary}}` always reads the first alert in the payload, not the one the incident was opened for. Use the grouping variable and the payload's shared fields (`commonLabels`, `commonAnnotations`) instead. See [Incoming Request Monitor](/docs/monitor/incoming-request-monitor).

### Incoming Email Monitors

| Variable          | Description                                                       | Type     |
| ----------------- | ----------------------------------------------------------------- | -------- |
| `emailSubject`    | The subject of the email.                                         | `string` |
| `emailFrom`       | The sender's email address.                                       | `string` |
| `emailTo`         | Who the email was sent to, with the monitor's own address masked. | `string` |
| `emailBody`       | The plain text body of the email.                                 | `string` |
| `emailReceivedAt` | When the email was received, as an ISO 8601 timestamp in UTC.     | `string` |

In a title, each of these is cut to one line of at most 150 characters. Descriptions and remediation notes get the full value. See [Incoming Email Monitor](/docs/monitor/incoming-email-monitor#template-variables).

### Ping Monitors

| Variable           | Description                                   | Type      |
| ------------------ | --------------------------------------------- | --------- |
| `isOnline`         | Whether the ping target is considered online. | `boolean` |
| `responseTimeInMs` | The ping response time in milliseconds.       | `number`  |
| `failureCause`     | The reason for failure if the ping failed.    | `string`  |
| `isTimeout`        | Whether the ping request timed out.           | `boolean` |

### Port Monitors

| Variable           | Description                                                             | Type      |
| ------------------ | ----------------------------------------------------------------------- | --------- |
| `isOnline`         | Whether the port is considered online/accessible.                       | `boolean` |
| `responseTimeInMs` | Total connection time (DNS lookup plus TCP connection) in milliseconds. | `number`  |
| `failureCause`     | The reason for failure if the port check failed.                        | `string`  |
| `isTimeout`        | Whether the port connection timed out.                                  | `boolean` |

### IP Monitors

| Variable           | Description                                    | Type      |
| ------------------ | ---------------------------------------------- | --------- |
| `isOnline`         | Whether the IP address is considered online.   | `boolean` |
| `responseTimeInMs` | The ping response time in milliseconds.        | `number`  |
| `failureCause`     | The reason for failure if the IP check failed. | `string`  |
| `isTimeout`        | Whether the IP ping request timed out.         | `boolean` |

### SSL Certificate Monitors

| Variable             | Description                                        | Type      |
| -------------------- | -------------------------------------------------- | --------- |
| `isOnline`           | Whether the SSL certificate check was successful.  | `boolean` |
| `isSelfSigned`       | Whether the SSL certificate is self-signed.        | `boolean` |
| `createdAt`          | The date when the SSL certificate was created.     | `Date`    |
| `expiresAt`          | The date when the SSL certificate expires.         | `Date`    |
| `commonName`         | The common name (CN) from the certificate.         | `string`  |
| `organizationalUnit` | The organizational unit (OU) from the certificate. | `string`  |
| `organization`       | The organization (O) from the certificate.         | `string`  |
| `locality`           | The locality (L) from the certificate.             | `string`  |
| `state`              | The state/province (ST) from the certificate.      | `string`  |
| `country`            | The country (C) from the certificate.              | `string`  |
| `serialNumber`       | The serial number of the certificate.              | `string`  |
| `fingerprint`        | The SHA-1 fingerprint of the certificate.          | `string`  |
| `fingerprint256`     | The SHA-256 fingerprint of the certificate.        | `string`  |
| `failureCause`       | The reason for failure if the SSL check failed.    | `string`  |

### Server/VM Monitors

| Variable                     | Description                                                     | Type            |
| ---------------------------- | --------------------------------------------------------------- | --------------- |
| `hostname`                   | The hostname of the monitored server.                           | `string`        |
| `requestReceivedAt`          | The date and time when the server monitor request was received. | `Date`          |
| `cpuUsagePercent`            | The CPU usage percentage.                                       | `number`        |
| `cpuCores`                   | The number of CPU cores.                                        | `number`        |
| `memoryUsagePercent`         | The memory usage percentage.                                    | `number`        |
| `memoryFreePercent`          | The memory free percentage.                                     | `number`        |
| `memoryTotalBytes`           | The total memory in bytes.                                      | `number`        |
| `diskMetrics`                | Array of disk metrics for all mounted disks.                    | `Array<Object>` |
| `diskMetrics[].diskPath`     | The path of the disk mount point.                               | `string`        |
| `diskMetrics[].usagePercent` | The disk usage percentage for this mount point.                 | `number`        |
| `diskMetrics[].freePercent`  | The disk free percentage for this mount point.                  | `number`        |
| `diskMetrics[].totalBytes`   | The total disk space in bytes for this mount point.             | `number`        |
| `processes`                  | Array of running processes on the server.                       | `Array<Object>` |
| `processes[].pid`            | The process ID.                                                 | `number`        |
| `processes[].name`           | The process name.                                               | `string`        |
| `processes[].command`        | The command used to start the process.                          | `string`        |
| `failureCause`               | The reason for failure if the server check failed.              | `string`        |

### Synthetic Monitors

Synthetic monitors run the same script across multiple browsers (Chromium, Firefox, Webkit) and screen sizes (mobile, tablet, desktop), producing one response per configuration. Each run is exposed through the `syntheticResponses` array — access a specific run by index (`{{syntheticResponses[0].browserType}}`) or iterate with `{{#each syntheticResponses}}`.

| Variable                                 | Description                                                                              | Type                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `failureCause`                           | The reason for failure if the synthetic check failed.                                    | `string`                                 |
| `syntheticResponses`                     | Array containing one entry per browser / screen-size combination the script ran against. | `Array<Object>`                          |
| `syntheticResponses[].executionTimeInMs` | Execution time in milliseconds for this run.                                             | `number`                                 |
| `syntheticResponses[].result`            | The result returned by this run.                                                         | `string`, `number`, `boolean`, or `JSON` |
| `syntheticResponses[].scriptError`       | Any error that occurred during this run.                                                 | `string`                                 |
| `syntheticResponses[].logMessages`       | Log messages generated during this run.                                                  | `Array<string>`                          |
| `syntheticResponses[].screenshots`       | Screenshots captured during this run, by name, each as base64 text. See [Showing a screenshot](#showing-a-screenshot). | `Object` |
| `syntheticResponses[].browserType`       | Browser used for this run.                                                               | `string`                                 |
| `syntheticResponses[].screenSizeType`    | Screen size used for this run.                                                           | `string`                                 |

#### Showing a screenshot

Each entry of `screenshots` is a screenshot the script took, under the name the script gave it (`screenshots["login-page"] = await page.screenshot()`), as base64 text. To show one in an incident's or alert's description or remediation notes, write an image around it:

```
{{syntheticResponses[0].scriptError}}

![Login page](data:image/png;base64,{{syntheticResponses[0].screenshots.login-page}})
```

The screenshot then appears on the incident's or alert's page, on the status pages that show the incident, in the email notifications about it, and in the Slack and Microsoft Teams messages about it. In an email it is attached and shown in the body, which Gmail, Outlook and Apple Mail all display, so whoever is on call can see what the page looked like without opening OneUptime.

- PNG, JPEG, GIF and WebP screenshots are shown. `image/png` works for a JPEG screenshot (`page.screenshot({ type: "jpeg" })`) too.
- One email carries at most 2 MB of images, and at most 20. An image that does not fit is replaced by a note with its alt text, so give each image alt text. A JPEG screenshot is much smaller than a PNG one, and one screenshot of the failing run usually says more than every screenshot of every run.
- In Slack and Microsoft Teams the screenshot is shown where the description has it: an image on a line of its own takes that line's place, and an image in the middle of a sentence, a list or a table leaves its alt text there and is shown after it. Slack shows PNG, JPEG and GIF screenshots, at most 10 and 10 MB per message; the OneUptime app uploads each one to your Slack workspace, privately, and shows it in the message. Teams shows PNG, JPEG and GIF screenshots of up to 1 MB each inside the message's card, at most 10 and 2 MB per message.
- Uploading to Slack needs the app's `files:write` permission. If your workspace connected Slack before OneUptime asked for it, connect Slack again in **Project Settings > Slack Integration** (on a self-hosted server, add the permission to your Slack app first - see [Slack Integration](/docs/self-hosted/slack-integration#images-in-messages)).
- A screenshot a chat cannot show - a WebP, one past those limits, one Slack or Teams refuses, or any screenshot in a message sent through an incoming webhook - is shown as its alt text, or "[image]" when it has none, so give each image alt text. The image's base64 never reaches the chat.
- Only an image you write in the template is shown. An image in a value the monitored page or script reported - an error message, a log line - still shows as text (see [Values in descriptions and remediation notes](#values-in-descriptions-and-remediation-notes)).

### Custom JavaScript Code Monitors

| Variable            | Description                                                | Type                                     |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `executionTimeInMs` | The time taken to execute the custom code in milliseconds. | `number`                                 |
| `result`            | The result returned by the custom code.                    | `string`, `number`, `boolean`, or `JSON` |
| `scriptError`       | Any error that occurred during code execution.             | `string`                                 |
| `logMessages`       | Array of log messages generated during execution.          | `Array<string>`                          |

### Network Device (SNMP) Monitors

| Variable               | Description                                                    | Type                 |
| ---------------------- | -------------------------------------------------------------- | -------------------- |
| `isOnline`             | Whether the device is reachable — by ping **or** SNMP. Set on every poll. | `boolean` |
| `responseTimeInMs`     | The SNMP **walk's** response time in milliseconds — never the ping's round-trip time. | `number` |
| `failureCause`         | The reason for failure if the SNMP walk failed.                | `string`             |
| `isTimeout`            | Whether the SNMP walk timed out.                               | `boolean`            |
| `oidResponses`         | Array of OID response objects with oid, name, value, and type. | `Array<Object>`      |
| `oidResponses[].oid`   | The OID that was queried.                                      | `string`             |
| `oidResponses[].name`  | The friendly name of the OID (if provided).                    | `string`             |
| `oidResponses[].value` | The value returned by the OID.                                 | `string` or `number` |
| `oidResponses[].type`  | The SNMP data type of the value.                               | `string`             |
| `{{OID_NAME}}`         | Direct access to OID value by name (e.g., `{{sysUpTime}}`).    | `string` or `number` |
| `sysName`              | Device name from the SNMP system group.                        | `string`             |
| `sysDescr`             | Device description from the SNMP system group.                 | `string`             |
| `sysObjectId`          | Vendor's registered enterprise OID (device fingerprint).       | `string`             |
| `sysLocation`          | Device location from the SNMP system group.                    | `string`             |
| `downInterfaces`       | Interfaces that are administratively up but operationally down, as `{name, alias, interfaceIndex}`. Requires interface monitoring. | `Array<Object>` |
| `interfacesTotal`      | Total number of interfaces walked.                             | `number`             |
| `interfacesUp`         | Interfaces that are administratively and operationally up.     | `number`             |
| `interfacesDown`       | Interfaces that are administratively up but operationally down. | `number`            |
| `interfaceWalkFailure` | Error message when the interface walk failed.                  | `string`             |
| `trapOid`              | Trap OID — set only when the check was triggered by an SNMP trap. | `string`          |
| `trapSourceIp`         | Source IP the trap was received from — trap-triggered checks only. | `string`         |
| `trapVarbinds`         | Varbinds carried by the trap, as `{oid, value}` — trap-triggered checks only. | `Array<Object>` |

A Network Device is pinged on every poll and walked over SNMP only when it has credentials, so **`isOnline` is the only variable above that a ping-only device fills in** — every other one comes from the SNMP walk and is empty without one. Lead with `{{isOnline}}` and the device's own name in templates that might be applied to devices without credentials. See [Network Device Monitor](/docs/monitor/network-device-monitor#what-a-poll-actually-does) for what each kind of poll collects.

### Database Health Monitors

| Variable                  | Description                                                                                                          | Type            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------- |
| `isOnline`                | Whether the probe could connect and run the baseline query. Missing metrics never make this false.                     | `boolean`       |
| `responseTimeInMs`        | Time to connect and run the baseline query.                                                                            | `number`        |
| `failureCause`            | The reason the check failed, when it did.                                                                              | `string`        |
| `connectionError`         | Sanitized connection error. Never contains credentials or a connection string.                                         | `string`        |
| `engineVersion`           | Version string the database server reported.                                                                           | `string`        |
| `collectedGroups`         | Metric groups that produced values on this check.                                                                      | `Array<string>` |
| `unavailableGroups`       | Groups that could not be collected, as `{group, reason, message, remediation}`.                                        | `Array<Object>` |
| `collectionIssueSummary`  | One line summarising every unavailable group, ready to paste into an alert.                                            | `string`        |
| `metrics`                 | Collected values keyed by series name, e.g. `{{metrics['oneuptime.monitor.database.connections.used.percent']}}`.      | `Object`        |

A metric that was not collected is **absent** from `metrics` rather than zero,
so template it defensively — `{{#if metrics.[...]}}` — when a group may be
unavailable on the database you are monitoring.

## Basic Usage

In the Incident / Alert form inside a Monitor Criteria instance, the **Description** and **Remediation Notes** editors list the variables of the monitor's type under **Template variables**: click one to put it where the cursor is, use **Insert variable** in the editor's toolbar, or type `{{` and pick one from the list that opens. **Learn about dynamic templates**, next to the title, opens the same reference. You can write, for example:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

If the monitor response status code is `502` and time is `842`, the stored title becomes:

```
API returned 502 in 842ms
```

Nested JSON access works the same way as JavaScript Expressions:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array indexing is supported:

```
First User: {{responseBody.users[0].name}}
```

If a path does not exist, the placeholder is left in the output exactly as written — `{{responseBody.error.id}}` appears literally, braces and all, in the incident title. Only `{{#each}}` blocks over a missing path are removed.

### Values in descriptions and remediation notes

A description and remediation notes are Markdown: they are shown on the incident's or alert's page, in email, and in its Slack and Microsoft Teams channels. The values a template places there are what the monitored system sent - a response body or header, an incoming request or email, a device's or a series' labels - so each one is placed as text. It reads exactly as it was sent, wherever the template puts it, and a link, an image, an HTML tag or a Slack mention such as `<!channel>` in it shows as text instead of acting. A bare web address in a value is still made a link, one that shows where it goes. The Markdown you write in the template itself renders as you wrote it.

A value can be of any size - a response body or a log of many megabytes - and the notification still goes out with it. Each channel carries what it takes, and a description too long for it is cut, at a line break where there is one, ending with "… (truncated — see OneUptime for the full text)":

- **Email**: each description, note or root cause carries up to about 256 KB of the email's text, and the note at the end of a longer one links to the incident or alert. A whole email - its text and its screenshots - stays under 3 MB, which every mail server and Microsoft Graph take: a screenshot that does not fit beside the text is left out, with a note in its place.
- **The incident's or alert's page** shows all of it. A description with more than 128 KB that would take long to lay out is shown as plain text, line by line.
- **Slack** carries at most what Slack shows of a message (about 30,000 characters). **Microsoft Teams** carries about 40,000 characters in a message from the OneUptime app, and about 12,000 through an incoming webhook (status page subscribers, workflows) - measured as the message is sent, so a table counts as the HTML it becomes.
- **SMS, phone calls, push notifications, WhatsApp and Telegram** carry what their providers take: see [How the levels page people](/docs/on-call/escalation-rules#how-the-levels-page-people).

Every channel renders the text in time that grows with its length. A part that would take a renderer far longer - a line longer than 64 KB, a long paragraph of plain lines, a paragraph full of `*`, `_` or `[` that never close, quotes or lists nested more than sixteen deep, and on the incident's or alert's page a table or list of more than a thousand lines - reads as plain text where it is, and the rest of the description renders as usual.

## Advanced Usage

### Accessing Array Elements

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Nested Object Access

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Looping Over Arrays with `{{#each}}`

You can iterate over arrays using the `{{#each path}}...{{/each}}` block syntax. This is useful when the data contains a list of items and you want to include each one in your incident or alert description.

**Syntax:**

```
{{#each arrayPath}}
  ...body using {{property}} from each element...
{{/each}}
```

Inside the loop body:

- `{{propertyName}}` resolves relative to the current array element
- `{{nested.property}}` dot-notation access works on the current element
- `{{@index}}` resolves to the 0-based index of the current iteration
- `{{this}}` resolves to the current element value (useful for arrays of strings/numbers)
- Variables not found on the current element fall back to the parent storage map

**Example — Incoming Request with array of alerts (e.g., Grafana webhooks):**

If your incoming request body looks like:

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

You can write a template like:

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Which produces:

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Example — Server disk metrics:**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**Example — Using `{{@index}}`:**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Example — Primitive array with `{{this}}`:**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Example — Nested loops:**

You can nest `{{#each}}` blocks for multi-level arrays:

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Note**: If the path does not resolve to an array, the entire `{{#each}}...{{/each}}` block is removed from the output. Empty arrays produce no output for the block.

## Examples

### Website/API Monitor Incident Title

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Website/API Monitor Incident Description

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### Incoming Request Alert Title

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
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

### Ping Monitor Alert Title

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Port Monitor Alert Description

```
Port connectivity issue
Target port status: {{isOnline}}
Total connection time (DNS + TCP): {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### Synthetic Monitor Alert

Access a specific browser / screen-size run by index:

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

Iterate over every browser / screen-size combination with `{{#each}}`:

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

Show the screenshot each run took when it failed (the script assigns `screenshots["failure"]`):

```
### What the page looked like
{{#each syntheticResponses}}
**{{browserType}} / {{screenSizeType}}**: {{scriptError}}

![{{browserType}} {{screenSizeType}}](data:image/png;base64,{{screenshots.failure}})

{{/each}}
```

### Custom Code Monitor Alert

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### Network Device Monitor Alert Title

The next three examples assume the device has SNMP credentials — everything but `{{isOnline}}` comes from the walk, so on a ping-only device they would render blanks.

```
SNMP walk failing: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Network Device Monitor Alert Description

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### Incoming Request with Array Loop (Grafana Webhook)

Title:

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Description:

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

### Server Monitor with Disk Loop

Description:

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

### Network Device Monitor with OID Loop

Description:

```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
