# IP Monitor

IP monitoring allows you to monitor the availability and responsiveness of any IPv4 or IPv6 address. OneUptime periodically tests connectivity to the target IP address and reports its status.

## Overview

IP monitors verify that a specific IP address is reachable and responsive. This enables you to:

- Monitor IPv4 and IPv6 address availability
- Track response times and latency
- Detect network connectivity issues
- Verify that infrastructure endpoints are reachable

## Creating an IP Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **IP** as the monitor type
4. Enter the IP address you want to monitor
5. Configure monitoring criteria as needed

## Configuration Options

### IP Address

Enter the IPv4 or IPv6 address you want to monitor (e.g., `192.168.1.1` or `2001:db8::1`). The value must be a valid IP address format.

## Monitoring Criteria

You can configure criteria to determine when your IP address is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Is Online | Whether the IP address is reachable |
| Response Time (in ms) | Response time in milliseconds |
| Is Request Timeout | Whether the request timed out |

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

#### Mark as offline if IP is unreachable

- **Check On**: Is Online
- **Filter Type**: False

#### Alert if latency exceeds 100ms

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 100
