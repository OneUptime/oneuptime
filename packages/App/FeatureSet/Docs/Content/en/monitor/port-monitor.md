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

### Available Filter Types

| Filter Type                               | Description                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Is Online                                 | Whether the port is open and accepting connections                                  |
| Total Connection Time (DNS + TCP) (in ms) | Total connection time, including DNS lookup when the target is a hostname           |
| Port DNS Lookup Time (in ms)              | DNS lookup time before the first TCP attempt; unavailable when the target is an IP  |
| Port TCP Connect Time (in ms)             | Time from the first TCP attempt until a connection succeeds, including IP fallback  |
| Is Request Timeout                        | Whether the DNS lookup or TCP connection attempt exceeded the configured time limit |

### Filter Conditions

For **Is Online** and **Is Request Timeout**:

- **True** — Condition is true
- **False** — Condition is false

For **Total Connection Time (DNS + TCP)**, **Port DNS Lookup Time**, and **Port TCP Connect Time**:

- **Greater Than** — Response time exceeds a threshold
- **Less Than** — Response time is below a threshold
- **Greater Than or Equal To** — Response time is at or above a threshold
- **Less Than or Equal To** — Response time is at or below a threshold

**Evaluate this criteria over a period of time** is a separate checkbox on the criteria form rather than a filter condition. Turn it on to compare an aggregate — chosen under **Evaluate** (Average, Sum, Maximum Value, Minimum Value, All Values, Any Value) over the window set by **For the last (in minutes)** — instead of the value from the latest check.

**All Values** only matches once the window is genuinely covered by data. A monitor that has just been created, or one whose checks stopped being recorded, does not have enough history to say anything about the last N minutes, so the criteria waits rather than matching on the one reading it does have. **Any Value** is the setting for "tell me the moment a single check breaches" and still fires immediately.

**If No Data** controls what happens while the window cannot back the criteria:

- **Ignore** (default) — the criteria does not match. Use this for ordinary threshold alerting.
- **Trigger** — treat the missing data as the problem. Use this for heartbeat-style checks where silence is itself a failure.
- **Treat As Zero** — compare the window as a single zero. Use this for counters where "no events" genuinely means zero.

DNS lookup criteria have no value to evaluate when the target is already an IP address. Use the total or TCP connection time for criteria that must work with both hostnames and IP addresses.

### Example Criteria

#### Mark as offline if port is closed

- **Filter Type**: Is Online
- **Filter Condition**: False

#### Alert if total connection time exceeds 500ms

- **Filter Type**: Total Connection Time (DNS + TCP) (in ms)
- **Filter Condition**: Greater Than
- **Value**: 500

#### Mark as degraded if the total connection is slow

- **Filter Type**: Total Connection Time (DNS + TCP) (in ms)
- **Filter Condition**: Greater Than
- **Value**: 200

#### Alert if DNS lookup is slow

- **Filter Type**: Port DNS Lookup Time (in ms)
- **Filter Condition**: Greater Than
- **Value**: 100

#### Alert if TCP connection setup is slow

- **Filter Type**: Port TCP Connect Time (in ms)
- **Filter Condition**: Greater Than
- **Value**: 250
