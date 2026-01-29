# Incident & Alert Dynamic Templating

You can use the same `{{variable}}` placeholder syntax used by JavaScript Expressions in monitor criteria to dynamically populate Incident and Alert Title, Description, and Remediation Notes when they are auto-created from monitor criteria.

## Supported Monitor Types & Variables

The following monitor types support dynamic templating with their respective variables:

- **Website and API Monitors**: Response data, headers, status codes, timing
- **Incoming Request Monitors**: Request data, headers, methods, timing
- **Ping Monitors**: Connectivity status, response times, failure causes
- **Port Monitors**: Port connectivity, response times, timeout status
- **IP Monitors**: IP reachability, ping times, failure information
- **SSL Certificate Monitors**: Certificate details, validation status, expiration info
- **Server/VM Monitors**: System metrics (CPU, memory, disk), processes, hostname
- **Synthetic Monitors**: Script execution results, screenshots, browser details
- **Custom JavaScript Code Monitors**: Execution results, timing, error messages
- **SNMP Monitors**: Device status, response times, OID values

> **Note**: Logs, Traces, and Metrics monitors do not currently support incident/alert templating as they use different trigger mechanisms.

## Supported Monitor Types & Variables

### Website and API Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `responseBody` | The response body object. If HTML / XML then string. If JSON then JSON object. | `string` or `JSON` |
| `responseHeaders` | The response headers object (keys lower-cased). | `Dictionary<string>` |
| `responseStatusCode` | The HTTP response status code. | `number` |
| `responseTimeInMs` | The response time in milliseconds. | `number` |
| `isOnline` | Whether the monitor is considered online. | `boolean` |

### Incoming Request Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `requestBody` | The request body object. | `string` or `JSON` |
| `requestHeaders` | The request headers object (keys lower-cased). | `Dictionary<string>` |
| `requestMethod` | The HTTP method of the incoming request (GET, POST, etc.). | `string` |
| `incomingRequestReceivedAt` | The date and time when the incoming request was received. | `Date` |

### Ping Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `isOnline` | Whether the ping target is considered online. | `boolean` |
| `responseTimeInMs` | The ping response time in milliseconds. | `number` |
| `failureCause` | The reason for failure if the ping failed. | `string` |
| `isTimeout` | Whether the ping request timed out. | `boolean` |

### Port Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `isOnline` | Whether the port is considered online/accessible. | `boolean` |
| `responseTimeInMs` | The connection response time in milliseconds. | `number` |
| `failureCause` | The reason for failure if the port check failed. | `string` |
| `isTimeout` | Whether the port connection timed out. | `boolean` |

### IP Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `isOnline` | Whether the IP address is considered online. | `boolean` |
| `responseTimeInMs` | The ping response time in milliseconds. | `number` |
| `failureCause` | The reason for failure if the IP check failed. | `string` |
| `isTimeout` | Whether the IP ping request timed out. | `boolean` |

### SSL Certificate Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `isOnline` | Whether the SSL certificate check was successful. | `boolean` |
| `isSelfSigned` | Whether the SSL certificate is self-signed. | `boolean` |
| `createdAt` | The date when the SSL certificate was created. | `Date` |
| `expiresAt` | The date when the SSL certificate expires. | `Date` |
| `commonName` | The common name (CN) from the certificate. | `string` |
| `organizationalUnit` | The organizational unit (OU) from the certificate. | `string` |
| `organization` | The organization (O) from the certificate. | `string` |
| `locality` | The locality (L) from the certificate. | `string` |
| `state` | The state/province (ST) from the certificate. | `string` |
| `country` | The country (C) from the certificate. | `string` |
| `serialNumber` | The serial number of the certificate. | `string` |
| `fingerprint` | The SHA-1 fingerprint of the certificate. | `string` |
| `fingerprint256` | The SHA-256 fingerprint of the certificate. | `string` |
| `failureCause` | The reason for failure if the SSL check failed. | `string` |

### Server/VM Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `hostname` | The hostname of the monitored server. | `string` |
| `requestReceivedAt` | The date and time when the server monitor request was received. | `Date` |
| `cpuUsagePercent` | The CPU usage percentage. | `number` |
| `cpuCores` | The number of CPU cores. | `number` |
| `memoryUsagePercent` | The memory usage percentage. | `number` |
| `memoryFreePercent` | The memory free percentage. | `number` |
| `memoryTotalBytes` | The total memory in bytes. | `number` |
| `diskMetrics` | Array of disk metrics for all mounted disks. | `Array<Object>` |
| `diskMetrics[].diskPath` | The path of the disk mount point. | `string` |
| `diskMetrics[].usagePercent` | The disk usage percentage for this mount point. | `number` |
| `diskMetrics[].freePercent` | The disk free percentage for this mount point. | `number` |
| `diskMetrics[].totalBytes` | The total disk space in bytes for this mount point. | `number` |
| `processes` | Array of running processes on the server. | `Array<Object>` |
| `processes[].pid` | The process ID. | `number` |
| `processes[].name` | The process name. | `string` |
| `processes[].command` | The command used to start the process. | `string` |
| `failureCause` | The reason for failure if the server check failed. | `string` |

### Synthetic Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `executionTimeInMs` | The time taken to execute the synthetic monitor script in milliseconds. | `number` |
| `result` | The result returned by the synthetic monitor script. | `string`, `number`, `boolean`, or `JSON` |
| `scriptError` | Any error that occurred during script execution. | `string` |
| `logMessages` | Array of log messages generated during execution. | `Array<string>` |
| `screenshots` | Base64 encoded screenshots taken during execution. | `Object` |
| `browserType` | The browser type used for the synthetic monitor. | `string` |
| `screenSizeType` | The screen size type used for the synthetic monitor. | `string` |

### Custom JavaScript Code Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `executionTimeInMs` | The time taken to execute the custom code in milliseconds. | `number` |
| `result` | The result returned by the custom code. | `string`, `number`, `boolean`, or `JSON` |
| `scriptError` | Any error that occurred during code execution. | `string` |
| `logMessages` | Array of log messages generated during execution. | `Array<string>` |

### SNMP Monitors

| Variable | Description | Type |
| --- | --- | --- |
| `isOnline` | Whether the SNMP device is online and responding. | `boolean` |
| `responseTimeInMs` | The SNMP query response time in milliseconds. | `number` |
| `failureCause` | The reason for failure if the SNMP query failed. | `string` |
| `isTimeout` | Whether the SNMP query timed out. | `boolean` |
| `oidResponses` | Array of OID response objects with oid, name, value, and type. | `Array<Object>` |
| `oidResponses[].oid` | The OID that was queried. | `string` |
| `oidResponses[].name` | The friendly name of the OID (if provided). | `string` |
| `oidResponses[].value` | The value returned by the OID. | `string` or `number` |
| `oidResponses[].type` | The SNMP data type of the value. | `string` |
| `{{OID_NAME}}` | Direct access to OID value by name (e.g., `{{sysUpTime}}`). | `string` or `number` |


## Basic Usage

In the Incident / Alert form inside a Monitor Criteria instance, you can write:

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

If a path does not exist it resolves to an empty string by default.

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
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### Synthetic Monitor Alert
```
Script execution completed in {{executionTimeInMs}}ms
Result: {{result}}
Browser: {{browserType}} ({{screenSizeType}})
```

### Custom Code Monitor Alert
```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP Monitor Alert Title
```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP Monitor Alert Description
```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```


