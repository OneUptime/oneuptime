# Telemetry Search Syntax

## Overview

The search box above the Logs, Traces, Metrics and Exceptions explorers all speak the same language. A query is a list of filters separated by spaces, and **every filter must match** — there is no implicit OR between filters.

```
severity:error @platform.team:a* -@http.method:GET timeout
```

That reads as: error-level logs, whose `platform.team` attribute starts with `a`, whose `http.method` attribute is not `GET`, and whose message mentions `timeout`.

## The two kinds of filter

| Form | Filters | Example |
| --- | --- | --- |
| `field:value` | A built-in field of the signal | `severity:error` |
| `@attribute:value` | An OpenTelemetry attribute on the row | `@http.status_code:500` |
| bare words | The message (logs), span name (traces), metric name (metrics) | `connection refused` |

A bare `key:value` whose key is not a known field is treated as an attribute, so `k8s.pod:api-0` and `@k8s.pod:api-0` mean the same thing. Prefixing with `@` is never wrong and always means "look in the attributes".

Text that merely happens to contain a colon stays text — `https://example.com` and `12:30` are searched for as words, not read as filters.

## Matching values

Everything in this table works on both a field and an attribute.

| You type | It matches |
| --- | --- |
| `@k:abc` | exactly `abc` |
| `@k:a*` | anything starting with `a` — `abc`, `alpha` |
| `@k:*c` | anything ending with `c` |
| `@k:a*c` | starts with `a` and ends with `c` |
| `@k:a?c` | `?` is exactly one character — `abc`, `axc`, but not `ac` |
| `@k:*` | the attribute is present, with any value |
| `@k:~abc` | contains `abc` anywhere |
| `@k:!abc` | anything except `abc` |
| `@k:>100` | greater than 100. Also `>=`, `<`, `<=` |
| `@k:(a OR b)` | either value. `@k:[a, b]` is the same thing |
| `@k:(a* OR b*)` | either pattern |

Wildcard and contains matching ignore case; exact matching does not, because it is compared against the value exactly as it was stored.

### Values with spaces

Wrap the value in double quotes:

```
name:"SELECT wp_options"
@k8s.container.name:"my container"
```

Quotes protect **spaces**, not wildcards — `@k:"a b*"` still matches anything starting with `a b`.

### Literal `*`, `?` and other punctuation

A backslash makes the next character literal:

| You type | It matches |
| --- | --- |
| `@k:a\*b` | exactly `a*b` |
| `@k:\~abc` | exactly `~abc` |
| `@k:\>5` | exactly `>5` |

Values containing `%` or `_` need no escaping — they are always literal.

## Excluding

A leading `-` inverts any filter, including the ones above:

| You type | It matches |
| --- | --- |
| `-severity:debug` | everything except debug |
| `-@platform.team:a*` | anything whose `platform.team` does **not** start with `a`, including rows that have no `platform.team` at all |
| `-@k:*` | the attribute is absent or empty |
| `-@k:(a OR b)` | neither value |
| `-@k:>100` | 100 or less |
| `-@k:~abc` | does not contain `abc` |

## Fields by signal

### Logs

| Field | Aliases | Notes |
| --- | --- | --- |
| `severity` | `level` | `fatal`, `error`, `warning`, `info`, `debug`, `trace` — any casing |
| `service` | | Service name |
| `trace` | | Trace ID |
| `span` | | Span ID |
| `message` | `msg`, `log`, `body` | The log line. Bare words search this too |

### Traces

| Field | Notes |
| --- | --- |
| `service` | Service name |
| `name` | Span name. Bare words search this too |
| `status` | `ok`, `error`, `unset` |
| `kind` | `server`, `client`, `producer`, `consumer`, `internal` |
| `duration` | Milliseconds, e.g. `duration:>500` |
| `statusMessage` | Status message text |
| `hasException` | `true` or `false` |
| `trace`, `span` | IDs |

### Metrics

| Field | Notes |
| --- | --- |
| `name` | Metric name. Bare words search this too |
| `service` | Service name |

### Exceptions

| Field | Notes |
| --- | --- |
| `type` | Exception type, e.g. `type:TypeError` |
| `env` | Environment |
| `service` | Service name |

## Combining filters

Filters are combined with AND. `AND` may be written between them and changes nothing:

```
severity:error service:api          # both must hold
severity:error AND service:api      # identical
```

There is no OR **between** filters. To match either of two values for the same key, use the any-of form:

```
@http.method:(GET OR POST)
```

Two filters on the same key are ANDed, which is how a range or a two-sided pattern is written:

```
@duration:>=100 @duration:<=500
@k:a* @k:*z
```

## Chips and the search box

Pressing Enter on a `key:value` term turns it into a chip above the results. A chip carries the value exactly as it was typed, so a wildcard stays a wildcard. Clicking a value in the facet sidebar adds the same kind of chip, with its value escaped — a stored value that happens to contain `*` filters for that literal value, not as a pattern.

Chips are part of the saved view and the page URL, so a filter survives a refresh, a bookmark and a shared link.

## Notes

- Attribute **keys** are matched case-insensitively for wildcard, contains and prefix/suffix filters, so you do not have to remember whether it was ingested as `requestId` or `requestid`.
- A `-@k:...` filter also matches rows that never had the attribute — a row that does not carry `platform.team` at all trivially does not start with `a`.
- Numeric comparisons work on attribute values stored as text; a value that is not a number never satisfies one.
