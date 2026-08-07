# Port Monitor

Port monitoring allows you to monitor the availability of a specific TCP port on a host. OneUptime periodically attempts to establish a TCP connection to the specified port and checks whether it is open and responsive.

## Overview

Port monitors test whether a specific network port is accepting connections. This enables you to:

- Monitor service availability on specific ports
- Track total connection time, including DNS lookup and TCP connection setup
- Verify that services like databases, mail servers, and application servers are running
- Detect service outages before they impact users

## Creating a Port Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Port** as the monitor type
4. Enter the hostname or IP address and port number
5. Configure monitoring criteria as needed

## Configuration Options

### Hostname or IP Address

Enter the hostname or IP address of the target host (e.g., `example.com` or `192.168.1.1`).

### Port

Enter the port number to monitor (1–65535). Common examples:

| Port  | Service    |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Connection Timing

For a hostname target, OneUptime measures the port check in two phases:

1. **DNS Lookup** — time from the start of the check until the first TCP connection attempt begins.
2. **TCP Connect** — time from the first TCP connection attempt until a connection succeeds. This includes the time spent trying another address when IPv6/IPv4 fallback is needed.

The **Total Connection Time (DNS + TCP)** is measured from the start of the check until the TCP connection succeeds. It is also retained as the port monitor's existing response-time value, so current criteria, alerts, and historical charts continue to use the same field.

When the target is an IP address, no DNS lookup is required, so the DNS phase is omitted. Older check results collected before phase timing was available show only the total connection time.

## Monitoring Criteria

You can configure criteria to determine when your port is considered online, degraded, or offline based on:

### Available Check Types

| Check Type                    | Description                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Is Online                     | Whether the port is open and accepting connections                                  |
| Total Connection Time (DNS + TCP) (in ms) | Total connection time, including DNS lookup when the target is a hostname |
| Port DNS Lookup Time (in ms)  | DNS lookup time before the first TCP attempt; unavailable when the target is an IP  |
| Port TCP Connect Time (in ms) | Time from the first TCP attempt until a connection succeeds, including IP fallback  |
| Is Request Timeout            | Whether the DNS lookup or TCP connection attempt exceeded the configured time limit |

### Filter Types

For **Is Online** and **Is Request Timeout**:

- **True** — Condition is true
- **False** — Condition is false

For **Total Connection Time (DNS + TCP)**, **Port DNS Lookup Time**, and **Port TCP Connect Time**:

- **Greater Than** — Response time exceeds a threshold
- **Less Than** — Response time is below a threshold
- **Greater Than or Equal To** — Response time is at or above a threshold
- **Less Than or Equal To** — Response time is at or below a threshold
- **Evaluate Over Time** — Evaluate using aggregation (Average, Sum, Maximum, Minimum, All Values, Any Value) over a time window

DNS lookup criteria have no value to evaluate when the target is already an IP address. Use the total or TCP connection time for criteria that must work with both hostnames and IP addresses.

### Example Criteria

#### Mark as offline if port is closed

- **Check On**: Is Online
- **Filter Type**: False

#### Alert if total connection time exceeds 500ms

- **Check On**: Total Connection Time (DNS + TCP) (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### Mark as degraded if the total connection is slow

- **Check On**: Total Connection Time (DNS + TCP) (in ms)
- **Filter Type**: Greater Than
- **Value**: 200

#### Alert if DNS lookup is slow

- **Check On**: Port DNS Lookup Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 100

#### Alert if TCP connection setup is slow

- **Check On**: Port TCP Connect Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 250
