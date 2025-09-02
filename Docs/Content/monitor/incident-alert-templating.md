# Incident & Alert Dynamic Templating

You can use the same `{{variable}}` placeholder syntax used by JavaScript Expressions in monitor criteria to dynamically populate Incident and Alert Title, Description, and Remediation Notes when they are auto-created from monitor criteria.

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

(Additional monitor types can be added in future – reach out if you need more.)

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


## Examples

### Incident Title
```
High latency: {{responseTimeInMs||0}}ms (> threshold)
```

### Incident Description (Markdown)
```
### API Error
Status: **{{responseStatusCode}}**  
Latency: **{{responseTimeInMs}}ms**  
Body Snippet: `{{responseBody.error.message}}`
```

### Incoming Request Alert Title
```
Bad inbound request: header auth = {{requestHeaders.authorization}}
```


