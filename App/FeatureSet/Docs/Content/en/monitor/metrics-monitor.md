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

| Field | Description | Required |
|-------|-------------|----------|
| Metric Name | The name of the metric to query | Yes |
| Aggregation Type | How to aggregate raw metric values (sum, avg, min, max, count) | Yes |
| Attributes | Key-value filters to narrow the metric data | No |
| Aggregate By | Dimensions to group the metric by | No |

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

| Strategy | Description |
|----------|-------------|
| Average | Average value over the time window |
| Sum | Sum of all values |
| Maximum Value | Highest value in the time window |
| Minimum Value | Lowest value in the time window |
| All Values | All values must match the criteria |
| Any Value | At least one value must match |

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Metric Value | The aggregated value of the configured metric query or formula |

### Filter Types

- **Greater Than** — Metric value exceeds a threshold
- **Less Than** — Metric value is below a threshold
- **Greater Than or Equal To** — Metric value is at or above a threshold
- **Less Than or Equal To** — Metric value is at or below a threshold
- **Equal To** — Metric value matches exactly
- **Not Equal To** — Metric value does not match

### Example Criteria

#### Alert if error rate exceeds 5%

- **Query a**: `http_requests_total` filtered by `status=5xx`
- **Query b**: `http_requests_total`
- **Formula**: `a / b * 100`
- **Check On**: Metric Value
- **Filter Type**: Greater Than
- **Value**: 5

#### Alert if request queue depth is high

- **Query**: `request_queue_size`, aggregation: Maximum Value
- **Check On**: Metric Value
- **Filter Type**: Greater Than
- **Value**: 1000

## Setup Requirements

Metrics monitoring requires your applications or infrastructure to send metrics to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
