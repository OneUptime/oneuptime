# Port Monitor

Port monitoring allows you to monitor the availability of specific TCP or UDP ports on a host. OneUptime periodically attempts to connect to the specified port and checks whether it is open and responsive.

## Overview

Port monitors test whether a specific network port is accepting connections. This enables you to:

- Monitor service availability on specific ports
- Track port response times
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

| Port | Service |
|------|---------|
| 22 | SSH |
| 25 | SMTP |
| 80 | HTTP |
| 443 | HTTPS |
| 3306 | MySQL |
| 5432 | PostgreSQL |
| 6379 | Redis |
| 27017 | MongoDB |

## Monitoring Criteria

You can configure criteria to determine when your port is considered online, degraded, or offline based on:

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Is Online | Whether the port is open and accepting connections |
| Response Time (in ms) | Time to establish a connection in milliseconds |
| Is Request Timeout | Whether the connection attempt timed out |

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

#### Mark as offline if port is closed

- **Check On**: Is Online
- **Filter Type**: False

#### Alert if connection time exceeds 500ms

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### Mark as degraded if connection is slow

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 200
