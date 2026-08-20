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

### Available Filter Types

| Filter Type           | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| Is Online             | Whether the host responds to ping requests                                  |
| Response Time (in ms) | Round-trip time of the ping request in milliseconds                         |
| Packet Loss (in %)    | Percentage of ICMP echo requests that received no reply                     |
| Jitter (in ms)        | Standard deviation of round-trip times across the packets sent in one check |
| Is Request Timeout    | Whether the ping request timed out                                          |

### Filter Conditions

For **Is Online** and **Is Request Timeout**:

- **True** — Condition is true
- **False** — Condition is false

For **Response Time**, **Packet Loss**, and **Jitter**:

- **Greater Than** — Value exceeds a threshold
- **Less Than** — Value is below a threshold
- **Greater Than or Equal To** — Value is at or above a threshold
- **Less Than or Equal To** — Value is at or below a threshold

**Evaluate this criteria over a period of time** is a separate checkbox on the criteria form rather than a filter condition. Turn it on to compare an aggregate — chosen under **Evaluate** (Average, Sum, Maximum Value, Minimum Value, All Values, Any Value) over the window set by **For the last (in minutes)** — instead of the value from the latest check.

**All Values** only matches once the window is genuinely covered by data. A monitor that has just been created, or one whose checks stopped being recorded, does not have enough history to say anything about the last N minutes, so the criteria waits rather than matching on the one reading it does have. **Any Value** is the setting for "tell me the moment a single check breaches" and still fires immediately.

**If No Data** controls what happens while the window cannot back the criteria:

- **Ignore** (default) — the criteria does not match. Use this for ordinary threshold alerting.
- **Trigger** — treat the missing data as the problem. Use this for heartbeat-style checks where silence is itself a failure.
- **Treat As Zero** — compare the window as a single zero. Use this for counters where "no events" genuinely means zero.

### Example Criteria

#### Mark as offline if host is unreachable

- **Filter Type**: Is Online
- **Filter Condition**: False

#### Alert if response time exceeds 200ms

- **Filter Type**: Response Time (in ms)
- **Filter Condition**: Greater Than
- **Value**: 200
