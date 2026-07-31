# Monitor Steps

`monitor_steps` is the attribute that tells an active monitor *what to check* and *how to decide the result* — the destination, the request, and the criteria that map responses to monitor statuses, incidents, and alerts. It is the most powerful attribute in the provider, and the most common source of confusion. This page explains the structure completely.

## The one rule: it is JSON, not HCL blocks

The provider does **not** use nested HCL blocks for monitor configuration. `monitor_steps` is a single string attribute containing JSON, and the idiomatic way to write it is `jsonencode()` over an HCL object:

```hcl
resource "oneuptime_monitor" "example" {
  name         = "Example"
  description  = "Minimal shape of monitor_steps"
  monitor_type = "Website"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        # one or more MonitorStep envelopes go here
      ]
    }
  })
}
```

Everything inside mirrors OneUptime's API types exactly — the same JSON the dashboard produces. Keys inside the JSON are **camelCase** (`monitorDestination`, `filterCondition`), unlike the snake_case Terraform attributes around it.

## The typed envelope: `{_type, value}`

OneUptime's API wraps every rich type in an envelope object with two keys:

- `_type` — the OneUptime type name (`"MonitorSteps"`, `"MonitorStep"`, `"MonitorCriteria"`, `"MonitorCriteriaInstance"`, `"CriteriaFilter"`, `"URL"`, `"Hostname"`, `"IP"`, `"Port"`)
- `value` — the payload for that type

Envelopes nest: `MonitorSteps` wraps an array of `MonitorStep` envelopes, each of which wraps a `MonitorCriteria` envelope, and so on. If you forget an envelope and pass a bare object where a `{_type, value}` pair is expected, the API rejects the monitor or silently drops the configuration.

Scalar wrapper types use the same pattern with a scalar `value`:

```json
{ "_type": "URL",  "value": "https://example.com" }
{ "_type": "Port", "value": 443 }
```

Date/time values inside the JSON are RFC3339 strings, same as top-level attributes. `DateTime` values carry the full timestamp (`2026-08-01T02:00:00Z`); `Date` values carry only the day (`2026-08-01`).

## Complete annotated example

This is a working configuration from the provider's E2E suite (test `35-monitor-with-steps`), trimmed to one step with two criteria — the canonical "online / offline" website monitor:

```hcl
resource "oneuptime_monitor_status" "operational" {
  name                 = "Operational"
  description          = "Monitor is operational"
  color                = "#2ecc71"
  priority             = 1
  is_operational_state = true
}

resource "oneuptime_monitor_status" "offline" {
  name                 = "Offline"
  description          = "Monitor is offline"
  color                = "#e74c3c"
  priority             = 3
  is_operational_state = false
}

resource "oneuptime_monitor" "website" {
  name         = "Website"
  description  = "Website monitor with explicit steps"
  monitor_type = "Website"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"                       # outermost envelope
    value = {
      monitorStepsInstanceArray = [              # a monitor can have multiple steps
        {
          _type = "MonitorStep"                  # one probe target
          value = {
            id = "step-website-1"                # stable id you choose; keep it constant across applies

            monitorDestination = {               # what to hit
              _type = "URL"                      # URL | Hostname | IP
              value = "https://example.com"
            }
            requestType = "GET"                  # HTTP method for Website/API monitors

            monitorCriteria = {                  # how to evaluate the response
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [ # evaluated in order; first match wins
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id                  = "criteria-online"
                      name                = "Online"
                      description         = "Check if website is online"
                      filterCondition     = "All"   # All = AND the filters, Any = OR them
                      changeMonitorStatus = true
                      createIncidents     = false
                      createAlerts        = false
                      monitorStatusId     = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "True"
                          }
                        },
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Response Status Code"
                            filterType = "Equal To"
                            value      = "200"      # comparison values are strings
                          }
                        }
                      ]
                      incidents = []                # incident templates if createIncidents = true
                      alerts    = []                # alert templates if createAlerts = true
                    }
                  },
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id                  = "criteria-offline"
                      name                = "Offline"
                      description         = "Check if website is offline"
                      filterCondition     = "Any"
                      changeMonitorStatus = true
                      createIncidents     = false
                      createAlerts        = false
                      monitorStatusId     = oneuptime_monitor_status.offline.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "False"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })
}
```

Referencing other Terraform resources inside the JSON — like `oneuptime_monitor_status.operational.id` above — works because `jsonencode()` is evaluated by Terraform before the string is sent. This is the recommended way to wire criteria to statuses.

## MonitorStep fields

Inside a `MonitorStep` envelope's `value`:

| Field | Type | Used by | Notes |
|-------|------|---------|-------|
| `id` | string | all | Your identifier for the step. Pick something stable (`"step-1"`); changing it rewrites the step. |
| `monitorDestination` | envelope | Website, API, Ping, Port, IP, SSL Certificate | `_type` of `URL`, `Hostname`, or `IP` with a matching scalar `value`. |
| `monitorDestinationPort` | envelope | Port | `{ "_type": "Port", "value": 443 }`. |
| `requestType` | string | Website, API | HTTP method: `GET`, `POST`, `PUT`, `DELETE`, ... |
| `requestHeaders` | object | API | Plain string map — no envelope: `{ "Accept" = "application/json" }`. |
| `requestBody` | string | API | Raw request body string, e.g. `"{\"test\": \"data\"}"`. |
| `monitorCriteria` | envelope | all | The decision tree — see below. |

Destination `_type` must match the monitor type: `URL` for Website/API/SSL Certificate monitors, `Hostname` or `IP` for Ping/Port monitors, `IP` for IP monitors.

An API monitor step with headers and body, from the same E2E test:

```hcl
locals {
  api_step = {
    _type = "MonitorStep"
    value = {
      id = "step-api-1"
      monitorDestination = {
        _type = "URL"
        value = "https://api.example.com/health"
      }
      requestType = "POST"
      requestHeaders = {
        "Content-Type" = "application/json"
        "Accept"       = "application/json"
      }
      requestBody = "{\"source\": \"uptime-check\"}"
      monitorCriteria = {
        _type = "MonitorCriteria"
        value = {
          monitorCriteriaInstanceArray = []
        }
      }
    }
  }
}
```

## MonitorCriteriaInstance fields

Each criteria instance is one rule: *if these filters match, do these things.* Instances are evaluated in array order and the first matching instance wins, so put your "healthy" criteria first and your "down" criteria after it.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Stable identifier you choose. |
| `name`, `description` | string | Shown in the dashboard. |
| `filterCondition` | string | `"All"` (every filter must match) or `"Any"` (at least one). |
| `filters` | array | `CriteriaFilter` envelopes — the conditions. |
| `changeMonitorStatus` | bool | Whether a match changes the monitor status. |
| `monitorStatusId` | string | The `oneuptime_monitor_status` ID to switch to. Required when `changeMonitorStatus` is `true`. |
| `createIncidents` | bool | Whether a match opens an incident. |
| `incidents` | array | Incident templates (title, severity, auto-resolve). Use `[]` when `createIncidents` is `false`. |
| `createAlerts` | bool | Whether a match opens an alert. |
| `alerts` | array | Alert templates. Use `[]` when `createAlerts` is `false`. |

## CriteriaFilter reference

A filter's `value` has up to three fields: `checkOn` (the metric), `filterType` (the comparison), and `value` (the comparison operand — a string; omit it for boolean comparisons like `True` / `False`).

Common `checkOn` values by monitor type:

| Monitor type | Typical `checkOn` values |
|--------------|--------------------------|
| Any active monitor | `Is Online`, `Response Time (in ms)` |
| Website / API | `Response Status Code`, `Response Body`, `Response Header`, `JavaScript Expression` |
| SSL Certificate | `Is Valid Certificate`, `Is Self Signed Certificate`, `Is Expired Certificate`, `Expires In Days`, `Expires In Hours` |
| Ping / IP / Port | `Is Online`, `Response Time (in ms)`, `Packet Loss (in %)`, `Jitter (in ms)` |
| Incoming Request | `Incoming Request`, `Request Body`, `Request Header` |
| Server | `CPU Usage (in %)`, `Memory Usage (in %)`, `Disk Usage (in %)`, `Server Process Name` |

Common `filterType` values:

| Category | Values |
|----------|--------|
| Boolean | `True`, `False` |
| Numeric | `Equal To`, `Not Equal To`, `Greater Than`, `Less Than`, `Greater Than Or Equal To`, `Less Than Or Equal To` |
| Text | `Contains`, `Not Contains`, `Starts With`, `Ends With`, `Is Empty`, `Is Not Empty` |
| Heartbeat | `Recieved In Minutes`, `Not Recieved In Minutes` *(spelling is as the API expects)* |
| Scripting | `Evaluates To True` |

Example — degrade an SSL certificate monitor when the certificate expires within 30 days:

```json
{
  "_type": "CriteriaFilter",
  "value": {
    "checkOn": "Expires In Days",
    "filterType": "Less Than",
    "value": "30"
  }
}
```

The full lists are visible in the dashboard's criteria editor; anything the dashboard accepts is valid here, using exactly the label the dashboard shows.

## Common mistakes

These account for most `monitor_steps` bug reports (see issues [#2291](https://github.com/OneUptime/oneuptime/issues/2291) and [#2242](https://github.com/OneUptime/oneuptime/issues/2242)):

1. **Missing envelopes.** Every typed object needs `{_type, value}`. A bare `{ monitorStepsInstanceArray = [...] }` without the outer `MonitorSteps` envelope is invalid.
2. **snake_case keys inside the JSON.** The JSON uses the API's camelCase: `monitorDestination`, not `monitor_destination`. Only the Terraform attribute names around the JSON are snake_case.
3. **Numbers where strings are expected.** `CriteriaFilter.value` is a string even for numeric comparisons: `value = "200"`, not `value = 200`. The `Port` envelope is the opposite — its `value` is a number: `value = 443`.
4. **Wrong destination type.** `{"_type": "URL"}` with a bare hostname (or `Hostname` with a full URL) fails probing. Website/API take URLs; Ping/Port take hostnames or IPs.
5. **`changeMonitorStatus = true` without `monitorStatusId`.** The criteria then matches but has no status to switch to.
6. **Unstable `id` values.** Generating step or criteria ids with random or time-based functions forces a rewrite on every apply. Use fixed literals.
7. **Hand-written JSON strings with escaping errors.** Prefer `jsonencode()` over heredoc JSON — Terraform validates the object syntax and handles quoting, and `terraform plan` diffs it structurally.
8. **Pasting a dashboard JSON export as the whole resource.** Dashboard exports are API payloads, not Terraform configuration. Only the *steps object* belongs inside `jsonencode()`; the rest of the resource stays HCL.

## Omitting monitor_steps entirely

If you omit `monitor_steps`, the server generates a default configuration for the monitor type (for `Website`: check the URL, offline when unreachable). The computed value is readable as `oneuptime_monitor.<name>.monitor_steps` after apply and does **not** cause drift on the next plan. `Manual` monitors have no active checks and never need steps.

## Related pages

- [Examples](/docs/terraform/examples) — ping, port, SSL, and API variants of this pattern
- [Troubleshooting](/docs/terraform/troubleshooting) — including "inconsistent result after apply" on monitors
