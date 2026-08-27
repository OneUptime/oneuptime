# Monitor Steps

`monitor_steps` is the attribute that tells an active monitor *what to check* and *how to decide the result* — the destination, the request, and the criteria that map responses to monitor statuses, incidents, and alerts. It is the most powerful attribute in the provider. This page explains the structure completely.

## Typed nested attributes, not JSON

`monitor_steps` is a **typed nested attribute**: a list of step objects written directly in HCL. There is no `jsonencode()`, no `{_type, value}` envelopes, no camelCase keys, and no hand-written ids — the provider translates your HCL to the API's wire format and the server generates all internal ids.

```hcl
resource "oneuptime_monitor" "example" {
  name         = "Example"
  description  = "Minimal shape of monitor_steps"
  monitor_type = "Website"

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [
      {
        name             = "Check if online"
        description      = "Website responds successfully"
        filter_condition = "All"

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          }
        ]
      }
    ]
  }]
}
```

> **Migrating from provider 1.x?** Previously `monitor_steps` was a JSON string written with `jsonencode({ _type = "MonitorSteps", value = { ... } })`. Replace it with the nested blocks on this page: drop the envelopes, convert the camelCase keys to snake_case (`monitorDestination` → `monitor_destination` + `monitor_destination_type`, `filterCondition` → `filter_condition`, `checkOn` → `check_on`), and **delete every `id` field** — server-generated ids are gone from configuration entirely (this also removes the old "hard-coded random ids" confusion from issue [#2291](https://github.com/OneUptime/oneuptime/issues/2291)). Old JSON-string state is not upgraded automatically; re-apply with the new syntax.

Two conventions apply everywhere in `monitor_steps`:

- **Omit what you do not use.** Unset optional attributes are simply not sent to the API. Never pass `[]`, `{}`, or `""` as a placeholder — the provider rejects empty strings, lists, and maps so that "absent" always means "unset".
- **Filter values are strings.** Comparison values are always strings, even for numbers: `value = "200"`, not `value = 200`. (`port` is the exception — it is a real number.)

## Complete annotated example

This is a working configuration from the provider's E2E suite (test `35-monitor-with-steps`) — the canonical "online / offline" website monitor:

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

  monitor_steps = [{
    monitor_destination      = "https://example.com" # what to hit
    monitor_destination_type = "URL"                 # URL | Hostname | IP
    request_type             = "GET"                 # HTTP method for Website/API monitors

    criteria = [ # evaluated in order; first match wins, so alerting first and healthy last
      {
        name                  = "Offline"
        description           = "Check if website is offline"
        filter_condition      = "Any"
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.offline.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "False"
          }
        ]
      },
      {
        name                  = "Online"
        description           = "Check if website is online"
        filter_condition      = "All" # All = AND the filters, Any = OR them
        change_monitor_status = true
        create_incidents      = false
        create_alerts         = false
        monitor_status_id     = oneuptime_monitor_status.operational.id

        filters = [
          {
            check_on    = "Is Online"
            filter_type = "True"
          },
          {
            check_on    = "Response Status Code"
            filter_type = "Equal To"
            value       = "200" # comparison values are strings
          }
        ]
      }
    ]
  }]
}
```

Referencing other Terraform resources — like `oneuptime_monitor_status.operational.id` above — is plain HCL now. This is the recommended way to wire criteria to statuses.

## Step attributes

Each element of `monitor_steps` is one probe target:

| Attribute | Type | Used by | Notes |
|-----------|------|---------|-------|
| `monitor_destination` | string | Website, API, Ping, Port, IP, SSL Certificate | The URL, hostname, or IP to probe. Requires `monitor_destination_type`. |
| `monitor_destination_type` | string | same | `URL`, `Hostname`, or `IP` — must match the monitor type (URLs for Website/API/SSL Certificate; hostnames or IPs for Ping/Port/IP). |
| `port` | number | Port | TCP port to probe, e.g. `443`. |
| `request_type` | string | Website, API | HTTP method: `GET`, `POST`, `PUT`, `DELETE`, `HEAD`, `PATCH`. The server defaults to `GET`. |
| `request_headers` | map(string) | API | Plain string map: `{ "Accept" = "application/json" }`. |
| `request_body` | string | API | Raw request body string. |
| `do_not_follow_redirects` | bool | Website, API | Stop at the first response instead of following redirects. |
| `allow_self_signed_certificates` | bool | Website, API | Accept self-signed TLS certificates. |
| `tls_client_certificate` | string | Website, API | mTLS client certificate (PEM or `{{monitorSecrets.name}}` reference). |
| `tls_client_key` | string (sensitive) | Website, API | mTLS client private key. Required together with the certificate. |
| `tls_client_key_passphrase` | string (sensitive) | Website, API | Passphrase for the client key. |
| `request_timeout_in_ms` | number | probe-based | Per-step timeout; capped at 60000 ms server-side. |
| `retry_count` | number | probe-based | Retries when a check fails; capped at 3 server-side. |
| `custom_code` | string | Custom JavaScript Code, Synthetic | The script this step executes. |
| `screen_size_types` | list(string) | Synthetic | `Mobile`, `Tablet`, `Desktop`. |
| `browser_types` | list(string) | Synthetic | `Chromium`, `Firefox`. |
| `retry_count_on_error` | number | Synthetic | Retries on script error. |
| `criteria` | list (required) | all | The decision tree — see below. |

Telemetry and infrastructure monitor types carry their query configuration in per-type **escape hatch** attributes — optional strings holding the sub-config's raw JSON, written with `jsonencode()`: `log_monitor`, `trace_monitor`, `metric_monitor`, `exception_monitor`, `profile_monitor`, `dns_monitor`, `domain_monitor`, `dnssec_monitor`, `sql_monitor`, `external_status_page_monitor`, `network_device_monitor`, `kubernetes_monitor`, `docker_monitor`, `docker_swarm_monitor`, `host_monitor`, `podman_monitor`, `proxmox_monitor`, `ceph_monitor`, `iot_monitor`. Example for a Logs monitor:

```hcl
monitor_steps = [{
  log_monitor = jsonencode({
    attributes          = {}
    body                = "error"
    severityTexts       = ["Error"]
    telemetryServiceIds = [oneuptime_telemetry_service.app.id]
    lastXSecondsOfLogs  = 300
  })

  criteria = [
    {
      name             = "Errors found"
      filter_condition = "Any"
      filters = [
        {
          check_on    = "Log Count"
          filter_type = "Greater Than"
          value       = "0"
        }
      ]
    }
  ]
}]
```

These escape hatches mirror the dashboard's JSON for each monitor type — an escape hatch, not the default. Everything probe-related is fully typed.

## Criteria attributes

Each entry of `criteria` is one rule: *if these filters match, do these things.*

**Order matters, and the order is alerting first.** Criteria are evaluated top to bottom and the first one that matches wins — evaluation stops there, and every criteria below it is never looked at on that check. So list your alerting criteria first, most severe first (critical, then warning), and put the "healthy" / recovery criteria **last**.

Putting a "healthy" criteria first is the most common way to build a monitor that never alerts. A broad healthy rule — `Is Online` is `True`, or a metric value `Greater Than` `0` — matches on almost every check, claims the evaluation, and the "down" criteria underneath it never runs. Ordered the other way round, the down criteria gets its chance first and the healthy criteria only matches when nothing above it did, which is exactly what you want.

**Grouped metric monitors are the one exception to first-match-wins.** When a metric monitor's query is grouped — `groupByAttributeKeys` set inside the escape-hatch JSON, at `metricViewConfig.queryConfigs[].metricQueryData.groupByAttributeKeys` — the monitor raises one alert/incident *per group* (per host, per container, per mountpoint) and every criteria is evaluated, so a "critical" and a "warning" criteria can fire on different hosts on the same check. A host that breaches both still pages once, from the first matching criteria, so most-severe-first still applies. See [Metrics Monitor](/docs/monitor/metrics-monitor).

| Attribute | Type | Meaning |
|-----------|------|---------|
| `name` | string (required) | Shown in the dashboard. |
| `description` | string | Shown in the dashboard. |
| `filter_condition` | string (required) | `All` (every filter must match) or `Any` (at least one). |
| `filters` | list (required) | The conditions — at least one. |
| `change_monitor_status` | bool | Whether a match changes the monitor status. |
| `monitor_status_id` | string | The `oneuptime_monitor_status` ID to switch to. Required when `change_monitor_status` is `true`. |
| `create_incidents` | bool | Whether a match opens an incident. |
| `incidents` | list | Incident templates — omit unless `create_incidents = true`. |
| `create_alerts` | bool | Whether a match opens an alert. |
| `alerts` | list | Alert templates — omit unless `create_alerts = true`. |
| `is_enabled` | bool | Defaults to `true` server-side; set `false` to keep a criteria without evaluating it. |
| `incident_grouping` | string (JSON) | Incoming Request monitors only: fan out one incident per extracted payload value (`jsonencode({ groupByJSONPath = "..." })`). |

Incident templates (`incidents`) support: `title` (required), `description` (required), `incident_severity_id`, `auto_resolve_incident`, `remediation_notes`, `on_call_policy_ids`, `label_ids`, `owner_team_ids`, `owner_user_ids`, `show_incident_on_status_page`, `is_private`. Alert templates (`alerts`) support the same shape with `alert_severity_id` and `auto_resolve_alert`:

```hcl
criteria = [
  {
    name                  = "Offline"
    description           = "Site is unreachable"
    filter_condition      = "Any"
    change_monitor_status = true
    monitor_status_id     = oneuptime_monitor_status.offline.id
    create_incidents      = true

    filters = [
      {
        check_on    = "Is Online"
        filter_type = "False"
      }
    ]

    incidents = [
      {
        title                 = "Website is down"
        description           = "The website did not respond to the probe."
        incident_severity_id  = oneuptime_incident_severity.critical.id
        auto_resolve_incident = true
      }
    ]
  }
]
```

## Filter reference

A filter has `check_on` (what to inspect), `filter_type` (the comparison), and `value` (the operand — a string; omit it for boolean comparisons like `True` / `False`). Filters that evaluate over a time window additionally take `evaluate_over_time = true`, `evaluate_over_time_minutes`, and `evaluate_over_time_type` (`Average`, `Sum`, `Maximum Value`, `Minimum Value`, `All Values`, `Any Value`).

`All Values` means "every check in the window breached", so it only matches once the window is actually covered by data — a monitor that has just been created waits for the window to fill rather than matching on its first check. Give it a window at least twice the monitor's `monitoring_interval`, otherwise the window can only ever hold one sample and "all values" means the same thing as "any value". `Any Value` matches on a single breaching check by design.

`evaluate_over_time_no_data_policy` decides what the filter does while the window cannot back it: `Ignore` (the default) does not match, `Trigger` treats the missing data as the failure (heartbeat semantics), and `Treat As Zero` compares the window as a single zero.

Common `check_on` values by monitor type:

| Monitor type | Typical `check_on` values |
|--------------|---------------------------|
| Any active monitor | `Is Online`, `Response Time (in ms)` |
| Website / API | `Response Status Code`, `Response Body`, `Response Header`, `JavaScript Expression`, `Is Request Timeout` |
| SSL Certificate | `Is Valid Certificate`, `Is Self Signed Certificate`, `Is Expired Certificate`, `Expires In Days`, `Expires In Hours` |
| Ping / IP / Port | `Is Online`, `Response Time (in ms)`, `Packet Loss (in %)`, `Jitter (in ms)` |
| Incoming Request | `Incoming Request`, `Request Body`, `Request Header` |
| Server | `CPU Usage (in %)`, `Memory Usage (in %)`, `Disk Usage (in %)` (needs `disk_path`), `Server Process Name` |
| Logs / Traces / Exceptions / Metrics | `Log Count`, `Span Count`, `Exception Count`, `Metric Value` (metric filters can carry `metric_monitor_options` JSON) |
| Custom Code / Synthetic | `Result Value`, `Error`, `Execution Time (in ms)` |
| DNS / Domain / DNSSEC | `DNS Is Online`, `DNS Record Value`, `Domain Is Expired`, `DNSSEC Chain Is Valid` |
| SQL Query | `SQL Is Online`, `SQL Query Row Count`, `SQL Query Scalar Value` |
| External Status Page | `External Status Page Is Online`, `External Status Page Active Incidents`, `External Status Page Component Status` |
| Network Device (SNMP) | `SNMP Device Is Online`, `SNMP OID Value` (SNMP filters can carry `snmp_monitor_options` JSON) |

Common `filter_type` values:

| Category | Values |
|----------|--------|
| Boolean | `True`, `False` |
| Numeric | `Equal To`, `Not Equal To`, `Greater Than`, `Less Than`, `Greater Than Or Equal To`, `Less Than Or Equal To` |
| Text | `Contains`, `Not Contains`, `Starts With`, `Ends With`, `Is Empty`, `Is Not Empty` |
| Heartbeat | `Recieved In Minutes`, `Not Recieved In Minutes` *(spelling is as the API expects)* |
| Scripting | `Evaluates To True` |
| Anomaly (metrics) | `Anomalously High`, `Anomalously Low`, `Anomalous` |

Example — degrade an SSL certificate monitor when the certificate expires within 30 days:

```hcl
filters = [
  {
    check_on    = "Expires In Days"
    filter_type = "Less Than"
    value       = "30"
  }
]
```

The provider validates `check_on`, `filter_type`, and the other enum attributes at plan time, so a typo fails before anything is sent to the API. The full lists are visible in the dashboard's criteria editor; anything the dashboard accepts is valid here, using exactly the label the dashboard shows.

## Common mistakes

1. **Passing empty placeholders.** `incidents = []`, `request_headers = {}`, or `description = ""` are rejected — omit the attribute instead. Absent always means "unset".
2. **Numbers where strings are expected.** Filter `value` is a string even for numeric comparisons: `value = "200"`. Only `port` and the other genuinely numeric attributes (`retry_count`, `request_timeout_in_ms`, `evaluate_over_time_minutes`, ...) take numbers.
3. **Wrong destination type.** `monitor_destination_type = "URL"` with a bare hostname (or `Hostname` with a full URL) fails probing. Website/API take URLs; Ping/Port take hostnames or IPs.
4. **`change_monitor_status = true` without `monitor_status_id`.** The criteria then matches but has no status to switch to.
5. **Writing ids.** There are no `id` attributes anywhere in `monitor_steps` anymore. If you are migrating old JSON, delete them — the server generates ids.
6. **Escape hatches with hand-built strings.** Write `log_monitor` and friends with `jsonencode()` so Terraform handles quoting and produces canonical JSON (for `metric_monitor`, include the full object shape the dashboard produces — the server normalizes it).

## Omitting monitor_steps entirely

If you omit `monitor_steps`, the server generates a default configuration for the monitor type (for `Website`: check the URL, offline when unreachable) and your Terraform state keeps the attribute `null` — server defaults do **not** cause drift. `Manual` monitors have no active checks and never need steps.

## Background: the wire format

On the wire, the API still speaks its typed-envelope JSON — every rich object is wrapped as `{_type, value}`:

```json
{
  "_type": "MonitorSteps",
  "value": {
    "monitorStepsInstanceArray": [
      {
        "_type": "MonitorStep",
        "value": {
          "monitorDestination": { "_type": "URL", "value": "https://example.com" },
          "requestType": "GET",
          "monitorCriteria": {
            "_type": "MonitorCriteria",
            "value": { "monitorCriteriaInstanceArray": [ { "_type": "MonitorCriteriaInstance", "value": { "...": "..." } } ] }
          }
        }
      }
    ]
  }
}
```

The provider builds this envelope from your HCL on write and maps it back on read, ignoring server-managed extras (generated ids, injected defaults). You only need to know this shape when reading raw API responses — for example in scripts that query `monitorSteps` directly.

## Related pages

- [Examples](/docs/terraform/examples) — ping, port, SSL, and API variants of this pattern
- [Troubleshooting](/docs/terraform/troubleshooting) — including "inconsistent result after apply" on monitors
