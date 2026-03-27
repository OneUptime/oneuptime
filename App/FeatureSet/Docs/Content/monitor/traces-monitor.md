# Traces Monitor

Traces monitoring allows you to monitor distributed traces from your applications and trigger alerts based on span patterns, counts, and statuses. OneUptime evaluates trace data from your telemetry services over a time window.

## Overview

Traces monitors search and count spans matching specific filters. This enables you to:

- Alert on error span spikes in your services
- Monitor specific operations and endpoints
- Track span volume and patterns
- Filter by span status, name, and custom attributes
- Detect performance and reliability issues from trace data

## Creating a Traces Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Traces** as the monitor type
4. Select the telemetry services to monitor
5. Configure span filters and criteria as needed

## Configuration Options

### Telemetry Services

Select one or more services to monitor traces from. Services must be sending traces to OneUptime via OpenTelemetry.

### Span Filters

| Filter | Description | Required |
|--------|-------------|----------|
| Span Statuses | Filter by span status code (OK, ERROR, UNSET) | No |
| Span Name | Text search for specific span names (e.g., operation or endpoint names) | No |
| Attributes | Key-value pairs to filter on custom span attributes | No |
| Time Window | How far back to search for spans (in seconds, default: 60) | No |

### Span Status Codes

- **OK** — The operation completed successfully
- **ERROR** — The operation encountered an error
- **UNSET** — Status was not explicitly set

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Span Count | The number of spans matching your filters in the time window |

### Filter Types

- **Greater Than** — Span count exceeds a threshold
- **Less Than** — Span count is below a threshold
- **Greater Than or Equal To** — Span count is at or above a threshold
- **Less Than or Equal To** — Span count is at or below a threshold
- **Equal To** — Span count matches exactly
- **Not Equal To** — Span count does not match

### Example Criteria

#### Alert if more than 50 error spans in 60 seconds

- **Span Statuses**: ERROR
- **Time Window**: 60 seconds
- **Check On**: Span Count
- **Filter Type**: Greater Than
- **Value**: 50

#### Alert on errors in a specific endpoint

- **Span Name**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **Time Window**: 120 seconds
- **Check On**: Span Count
- **Filter Type**: Greater Than
- **Value**: 0

## Setup Requirements

Traces monitoring requires your applications to send distributed traces to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
