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
4. Choose the spans to count: the span name, the time window and the span statuses
5. To narrow them to telemetry services, infrastructure entities or attributes, open **More fields** below these filters
6. Configure the criteria as needed

## Configuration Options

### Telemetry Services

Select one or more services to monitor traces from, under **More fields**. Leave it empty to monitor spans from every service. Services must be sending traces to OneUptime via OpenTelemetry.

### Span Filters

| Filter        | Description                                                             | Required |
| ------------- | ----------------------------------------------------------------------- | -------- |
| Span Statuses | Filter by span status code (OK, ERROR, UNSET)                           | No       |
| Span Name     | Text search for specific span names (e.g., operation or endpoint names) | No       |
| Attributes    | Key-value pairs to filter on custom span attributes                     | No       |
| Time Window   | How far back to search for spans (in seconds, default: 60)              | No       |

### Span Status Codes

- **OK** — The operation was explicitly marked successful, by application code or a trace pipeline
- **ERROR** — The operation encountered an error
- **UNSET** — No error status was set. This is the OpenTelemetry default status

UNSET does not mean data is missing. OpenTelemetry instrumentation sets ERROR when an operation fails and leaves successful spans UNSET, so on a healthy service most spans are UNSET. OneUptime shows them in green as "Unset (no error)". Recording an exception does not change a span's status, so an UNSET span can still have exceptions; they are listed with the span. To alert on failures, filter on ERROR. To count every span that did not fail, select both OK and UNSET.

If you want successful requests to show as OK, add a trace pipeline under **Traces > Settings > Pipelines** with the filter condition **Status = Unset** and a **Status Remapper** that maps `http.response.status_code` values such as `200` to Ok.

## Monitoring Criteria

### Available Filter Types

| Filter Type | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| Span Count  | The number of spans matching your filters in the time window |

### Filter Conditions

- **Greater Than** — Span count exceeds a threshold
- **Less Than** — Span count is below a threshold
- **Greater Than or Equal To** — Span count is at or above a threshold
- **Less Than or Equal To** — Span count is at or below a threshold
- **Equal To** — Span count matches exactly

### Example Criteria

#### Alert if more than 50 error spans in 60 seconds

- **Span Statuses**: ERROR
- **Time Window**: 60 seconds
- **Filter Type**: Span Count
- **Filter Condition**: Greater Than
- **Value**: 50

#### Alert on errors in a specific endpoint

- **Span Name**: `POST /api/checkout`
- **Span Statuses**: ERROR
- **Time Window**: 120 seconds
- **Filter Type**: Span Count
- **Filter Condition**: Greater Than
- **Value**: 0

## Setup Requirements

Traces monitoring requires your applications to send distributed traces to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
