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

### Available Filter Types

| Filter Type           | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| Is Online             | Whether the IP address is reachable                                         |
| Response Time (in ms) | Response time in milliseconds                                               |
| Packet Loss (in %)    | Percentage of ICMP echo requests that received no reply                     |
| Jitter (in ms)        | Standard deviation of round-trip times across the packets sent in one check |
| Is Request Timeout    | Whether the request timed out                                               |

### Filter Conditions

For **Is Online** and **Is Request Timeout**:

- **True** — Condition is true
- **False** — Condition is false

For **Response Time**, **Packet Loss**, and **Jitter**:

- **Greater Than** — Value exceeds a threshold
- **Less Than** — Value is below a threshold
- **Greater Than or Equal To** — Value is at or above a threshold
- **Less Than or Equal To** — Value is at or below a threshold

**Evaluate this criteria over a period of time** is a separate checkbox on the criteria form rather than a filter condition. Turn it on to compare an aggregate — chosen under **Evaluate** (Average, Sum, Maximum Value, Minimum Value, All Values, Any Value) over the window set by **For the last (in minutes)** — instead of the value from the latest check. **All Values** and the aggregates (**Average/Sum/Maximum/Minimum**) only evaluate once the window is actually covered by data, so the criterion will not fire on a single result (a brand-new or just-restarted monitor waits until it has collected enough of the window). **Any Value** is the exception — a single matching result is enough. When the window has no data the criterion does not fire by default — configurable via `onNoDataPolicy` (Terraform/API).

### Example Criteria

#### Mark as offline if IP is unreachable

- **Filter Type**: Is Online
- **Filter Condition**: False

#### Alert if latency exceeds 100ms

- **Filter Type**: Response Time (in ms)
- **Filter Condition**: Greater Than
- **Value**: 100
