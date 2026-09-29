# Exceptions Monitor

Exceptions monitoring allows you to monitor application exceptions and errors, triggering alerts when exception counts exceed your configured thresholds. OneUptime evaluates exception data from your telemetry services over a time window.

## Overview

Exceptions monitors count and filter exceptions matching specific criteria. This enables you to:

- Alert on exception spikes in your applications
- Monitor specific exception types
- Scope alerts to a deployment environment such as `production`
- Search for exceptions by error message
- Track resolved and active exceptions separately
- Detect application stability issues from error patterns

## Creating an Exceptions Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Exceptions** as the monitor type
4. Select the telemetry services to monitor
5. Configure exception filters and criteria as needed

## Configuration Options

### Telemetry Services

Select one or more services to monitor exceptions from. Services must be sending exception data to OneUptime via OpenTelemetry.

### Exception Filters

| Filter           | Description                                                                | Required |
| ---------------- | -------------------------------------------------------------------------- | -------- |
| Exception Types  | Filter by exception type names (e.g., `NullPointerException`, `TypeError`) | No       |
| Environments     | Filter by deployment environment (e.g., `production`, `staging`)           | No       |
| Message          | Text search within exception messages                                      | No       |
| Include Resolved | Include exceptions that have been marked as resolved (default: false)      | No       |
| Include Archived | Include exceptions that have been archived (default: false)                | No       |
| Time Window      | How far back to search for exceptions (in seconds, default: 60)            | No       |

### Environments

Environments come from the `deployment.environment` OpenTelemetry resource attribute on each exception, the same value the Exceptions explorer filters with `env:production`. Enter one environment, or several separated by commas; an exception is counted when its environment matches any of them.

Matching is exact and case-sensitive: `production` does not match `Production` or `prod`. Exceptions with no environment are not counted when this filter is set. Leave it empty to count exceptions from every environment, including those with no environment.

The environment filter is combined with every other filter, so a monitor scoped to one telemetry service and `production` only counts that service's production exceptions.

When creating the monitor through the API, set `environments` on the step's `exceptionMonitor` to a list of environment names:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Monitoring Criteria

### Available Filter Types

| Filter Type     | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| Exception Count | The number of exceptions matching your filters in the time window |

### Filter Conditions

- **Greater Than** — Exception count exceeds a threshold
- **Less Than** — Exception count is below a threshold
- **Greater Than or Equal To** — Exception count is at or above a threshold
- **Less Than or Equal To** — Exception count is at or below a threshold
- **Equal To** — Exception count matches exactly
- **Not Equal To** — Exception count does not match

### Example Criteria

#### Alert if more than 10 exceptions in 60 seconds

- **Time Window**: 60 seconds
- **Filter Type**: Exception Count
- **Filter Condition**: Greater Than
- **Value**: 10

#### Alert on any NullPointerException

- **Exception Types**: `NullPointerException`
- **Time Window**: 60 seconds
- **Filter Type**: Exception Count
- **Filter Condition**: Greater Than
- **Value**: 0

#### Alert on production exceptions only

- **Environments**: `production`
- **Time Window**: 300 seconds
- **Filter Type**: Exception Count
- **Filter Condition**: Greater Than
- **Value**: 5

#### Monitor exceptions containing a specific message

- **Message**: `out of memory`
- **Time Window**: 300 seconds
- **Filter Type**: Exception Count
- **Filter Condition**: Greater Than
- **Value**: 0

## Setup Requirements

Exceptions monitoring requires your applications to send exception data to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
