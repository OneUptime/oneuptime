# Logs Monitor

Logs monitoring allows you to monitor your application logs and trigger alerts based on log patterns, counts, and severity levels. OneUptime evaluates logs from your telemetry services and checks them against your configured criteria.

## Overview

Logs monitors search and count logs matching specific filters over a time window. This enables you to:

- Alert on error log spikes
- Monitor specific log patterns or messages
- Track log volume by severity level
- Filter logs by service, attributes, and content
- Detect application issues from log patterns

## Creating a Logs Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Logs** as the monitor type
4. Select the telemetry services to monitor
5. Configure log filters and criteria as needed

## Configuration Options

### Telemetry Services

Select one or more services to monitor logs from. Services must be sending logs to OneUptime via OpenTelemetry.

### Log Filters

| Filter | Description | Required |
|--------|-------------|----------|
| Severity Levels | Filter by log severity (ERROR, WARN, INFO, DEBUG, etc.) | No |
| Body | Text search within the log message body | No |
| Attributes | Key-value pairs to filter on custom log attributes | No |
| Time Window | How far back to search for logs (in seconds, default: 60) | No |

### Severity Levels

Filter logs by one or more severity levels:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Log Count | The number of logs matching your filters in the time window |

### Filter Types

- **Greater Than** — Log count exceeds a threshold
- **Less Than** — Log count is below a threshold
- **Greater Than or Equal To** — Log count is at or above a threshold
- **Less Than or Equal To** — Log count is at or below a threshold
- **Equal To** — Log count matches exactly
- **Not Equal To** — Log count does not match

### Example Criteria

#### Alert if more than 100 error logs in 60 seconds

- **Severity Levels**: ERROR
- **Time Window**: 60 seconds
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 100

#### Alert if any fatal logs appear

- **Severity Levels**: FATAL
- **Time Window**: 60 seconds
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 0

#### Monitor logs containing a specific error message

- **Body**: `database connection timeout`
- **Time Window**: 300 seconds
- **Check On**: Log Count
- **Filter Type**: Greater Than
- **Value**: 5

## Setup Requirements

Logs monitoring requires your applications to send logs to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
