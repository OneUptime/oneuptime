# Profiles Monitor

Profiles monitoring allows you to monitor continuous profiling data from your applications and trigger alerts based on profile counts and patterns. OneUptime evaluates profile data from your telemetry services over a time window.

## Overview

Profiles monitors count and filter profiling data matching specific criteria. This enables you to:

- Monitor continuous profiling data from your applications
- Filter profiles by type (CPU, memory, goroutines, etc.)
- Track profile volume and patterns
- Alert on profiling anomalies
- Filter by custom profile attributes

## Creating a Profiles Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Profiles** as the monitor type
4. Select the telemetry services to monitor
5. Configure profile filters and criteria as needed

## Configuration Options

### Telemetry Services

Select one or more services to monitor profiles from. Services must be sending continuous profiling data to OneUptime via OpenTelemetry.

### Profile Filters

| Filter | Description | Required |
|--------|-------------|----------|
| Profile Types | Filter by profile type names (e.g., CPU, memory, goroutines) | No |
| Attributes | Key-value pairs to filter on custom profile attributes | No |
| Time Window | How far back to search for profiles (in seconds, default: 60) | No |

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Profile Count | The number of profiles matching your filters in the time window |

### Filter Types

- **Greater Than** — Profile count exceeds a threshold
- **Less Than** — Profile count is below a threshold
- **Greater Than or Equal To** — Profile count is at or above a threshold
- **Less Than or Equal To** — Profile count is at or below a threshold
- **Equal To** — Profile count matches exactly
- **Not Equal To** — Profile count does not match

### Example Criteria

#### Alert if no profiles received in 5 minutes

- **Time Window**: 300 seconds
- **Check On**: Profile Count
- **Filter Type**: Equal To
- **Value**: 0

## Setup Requirements

Profiles monitoring requires your applications to send continuous profiling data to OneUptime via OpenTelemetry. See the [OpenTelemetry](/docs/telemetry/open-telemetry) documentation for setup instructions.
