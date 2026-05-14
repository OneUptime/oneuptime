# Ping Monitor

Ping monitoring allows you to monitor the availability and responsiveness of any host or IP address. OneUptime periodically sends ping requests to your target and checks whether it responds correctly.

## Overview

Ping monitors test basic network connectivity by sending ICMP ping requests to a host. This enables you to:

- Monitor host uptime and availability
- Track network latency and response times
- Detect connectivity issues before they impact your services
- Verify that servers and network devices are reachable

## Creating a Ping Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Ping** as the monitor type
4. Enter the hostname or IP address you want to monitor
5. Configure monitoring criteria as needed

## Configuration Options

### Ping Hostname or IP Address

Enter the hostname or IP address of the target you want to monitor (e.g., `example.com` or `192.168.1.1`). Both hostnames and IP addresses are accepted.

## Monitoring Criteria

You can configure criteria to determine when your host is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Is Online | Whether the host responds to ping requests |
| Response Time (in ms) | Round-trip time of the ping request in milliseconds |
| Is Request Timeout | Whether the ping request timed out |

### Filter Types

For **Is Online** and **Is Request Timeout**:

- **True** — Condition is true
- **False** — Condition is false

For **Response Time**:

- **Greater Than** — Response time exceeds a threshold
- **Less Than** — Response time is below a threshold
- **Greater Than or Equal To** — Response time is at or above a threshold
- **Less Than or Equal To** — Response time is at or below a threshold
- **Equal To** — Response time matches exactly
- **Not Equal To** — Response time does not match
- **Evaluate Over Time** — Evaluate using aggregation (Average, Sum, Maximum, Minimum, All Values, Any Value) over a time window

### Example Criteria

#### Mark as offline if host is unreachable

- **Check On**: Is Online
- **Filter Type**: False

#### Alert if response time exceeds 200ms

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 200
