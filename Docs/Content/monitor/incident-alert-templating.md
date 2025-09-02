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
Last User: {{responseBody.users[last].name}}
```

If a path does not exist it resolves to an empty string by default.

## Fallback Syntax

You can supply a fallback with `||` inside the placeholder:

```
Status: {{responseStatusCode||unknown}}
Latency: {{responseTimeInMs||0}}ms
Primary Region: {{responseBody.metadata.region||"us-east-1"}}
Online: {{isOnline||false}}
```

Parsing rules for fallback:
- `true`, `false`, `null` become their boolean/null equivalents.
- Numeric strings become numbers (e.g. `0`, `404`).
- Quoted JSON or objects/arrays will attempt `JSON.parse` (e.g. `{"key":"value"}` or `[1,2]`).
- Otherwise the raw text is used (quotes around a string fallback can be omitted unless you need commas / special chars).

If the variable is found, fallback is ignored.

## Tips

- To avoid accidental empty string when something is sometimes missing, always provide a fallback: `{{responseHeaders.content-type||"n/a"}}`
- Entire placeholder as value: If the field ONLY contains `{{responseStatusCode}}` and the value is a number, the resulting value will be the number coerced to string for storage.
- Mixed inline usage always stringifies: `Code: {{responseStatusCode}}`.

## Examples

### Incident Title
```
High latency: {{responseTimeInMs||0}}ms (> threshold)
```

### Incident Description (Markdown)
```
### API Error
Status: **{{responseStatusCode||unknown}}**  
Latency: **{{responseTimeInMs||0}}ms**  
Body Snippet: `{{responseBody.error.message||"(no message)"}}`
```

### Incoming Request Alert Title
```
Bad inbound request: header auth = {{requestHeaders.authorization||"missing"}}
```

## Edge Cases & Behavior
- Undefined path + no fallback -> replaced with empty string.
- Large JSON values (objects/arrays) inline will be stringified.
- `last` index works for arrays: `{{responseBody.items[last].id}}`.

