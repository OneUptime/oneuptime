# Metrics Monitor

Metrics monitoring allows you to monitor custom application and infrastructure metrics collected via OpenTelemetry. OneUptime evaluates metric values over a time window and triggers alerts based on your configured criteria.

## Overview

Metrics monitors query and evaluate numeric metrics from your telemetry services. This enables you to:

- Monitor custom application metrics (request rates, queue depths, error rates, etc.)
- Track infrastructure metrics (CPU, memory, disk, network)
- Create complex metric queries with filters and aggregations
- Combine multiple metrics using mathematical formulas
- Set alerts based on metric thresholds

## Creating a Metrics Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Metrics** as the monitor type
4. Configure metric queries and optional formulas
5. Select the aggregation strategy
6. Configure monitoring criteria as needed

## Configuration Options

### Metric Queries

Define one or more metric queries. Each query includes:

| Field            | Description                                                    | Required |
| ---------------- | -------------------------------------------------------------- | -------- |
| Metric Name      | The name of the metric to query                                | Yes      |
| Aggregation Type | How to aggregate raw metric values (sum, avg, min, max, count) | Yes      |
| Attributes       | Key-value filters to narrow the metric data                    | No       |
| Group By         | Attributes to split the query into one series per unique value | No       |

Each query is assigned an alias (e.g., `a`, `b`, `c`) for use in formulas.

### Formulas

Combine multiple metric queries using mathematical expressions. For example:

- `a / b * 100` — Calculate a percentage from two queries
- `a + b` — Sum two metrics
- `a - b` — Difference between metrics

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

### Aggregation Strategy

Choose how to aggregate the metric values for evaluation:

| Strategy      | Description                        |
| ------------- | ---------------------------------- |
| Average       | Average value over the time window |
| Sum           | Sum of all values                  |
| Maximum Value | Highest value in the time window   |
| Minimum Value | Lowest value in the time window    |
| All Values    | All values must match the criteria |
| Any Value     | At least one value must match      |

## Monitoring Criteria

### What Gets Evaluated

These monitors always evaluate the **Metric Value** — the aggregated value of the configured metric query or formula. The criteria form has no Filter Type selector; it shows **Metric**, **Aggregation**, **Condition**, and **Threshold**.

### Conditions

Static thresholds — compared against the **Threshold** you enter:

- **Greater Than** — Metric value exceeds a threshold
- **Less Than** — Metric value is below a threshold
- **Greater Than or Equal To** — Metric value is at or above a threshold
- **Less Than or Equal To** — Metric value is at or below a threshold
- **Equal To** — Metric value matches exactly

Baseline anomaly detection — no threshold; the form shows **Sensitivity** and **Baseline Window** instead, and compares each sample to the same-hour-of-week baseline built from that window:

- **Anomalously High** — Metric value rises above the expected range
- **Anomalously Low** — Metric value falls below the expected range
- **Anomalous** — Metric value leaves the expected range in either direction

Anomaly conditions stay in a "Learning" state and produce no alerts until at least the chosen Baseline Window of metric history exists.

### Example Criteria

#### Alert if error rate exceeds 5%

- **Query a**: `http_requests_total` filtered by `status=5xx`
- **Query b**: `http_requests_total`
- **Formula**: `a / b * 100`
- **Condition**: Greater Than
- **Threshold**: 5

#### Alert if request queue depth is high

- **Query**: `request_queue_size`, aggregation: Maximum Value
- **Condition**: Greater Than
- **Threshold**: 1000

## Per-Series Alerting (Group By)

**Group By** on a metric query splits that query into one series per unique attribute value — one per host, one per container, one per mountpoint — and a monitor with Group By set evaluates every series independently. That single setting is the difference between "the fleet is unhealthy" and "`prod-db-01` is unhealthy".

### One alert per group

With Group By set to `host.name`, a disk-usage monitor watching fifty hosts raises **one alert (or incident) per breaching host**. Host A filling up opens its own alert; host B filling up ten minutes later opens a second, separate alert alongside it.

Without Group By, the same monitor is a single scalar: the query collapses every host into one number and the monitor raises **one alert for the whole monitor**. While that alert is open, a second host breaching produces nothing — the monitor is already alerting, so there is nothing new to raise, and the on-call engineer never learns about host B. **Setting Group By is how you get per-host alerts.** If you want to be paged per host, per container, or per mountpoint, set it.

### Independent resolution

Each per-group alert tracks its own group. When host A drops back under the threshold its alert resolves on its own, and host B's alert stays open until host B recovers. One group recovering never closes another group's alert.

### Criteria evaluation differs

- **Grouped monitors evaluate every criteria.** Severity bands can therefore fire on different groups at the same time: with "Critical — greater than 95" above "Warning — greater than 80", a host at 96% opens a critical alert while a host at 85% opens a warning alert on the same check. A host that breaches both bands still gets exactly one alert — from the first matching criteria, so **order the criteria most severe first**.
- **Ungrouped monitors stop at the first matching criteria.** Only that one criteria fires, which is another reason to put the alerting criteria above the healthy one: a broad healthy criteria placed first matches on nearly every check and prevents the alerting criteria below it from ever being evaluated.

### Choosing an attribute to group by

Group by an attribute that genuinely identifies a distinct thing you would page someone about: the host attribute for a fleet-wide host metric, the container or pod attribute for a container metric, the mountpoint or device attribute for a filesystem or disk-I/O metric, the interface attribute for a network metric. The **Group by** dropdown is populated from the attributes your collector actually sends, so pick from the list rather than typing a key by hand.

Do not group a metric that is already a single scalar for the whole system — a cluster-wide leader flag, a scheduler backlog, or a single host's CPU on a single-host monitor. Grouping those produces exactly one series and changes nothing except the alert titles.

The grouping attribute values are also available as [template variables](/docs/monitor/incident-alert-templating) in the alert or incident title, description, and remediation notes — grouping by `host.name` lets the title read `Disk almost full on {{host.name}}`.

## Setup Requirements

Metrics monitoring requires your applications or infrastructure to send metrics to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
