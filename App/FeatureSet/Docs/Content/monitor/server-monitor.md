# Server / VM Monitor

Server and VM monitoring allows you to monitor the health and performance of your servers, virtual machines, and other infrastructure by installing a lightweight agent that reports system metrics to OneUptime.

## Overview

Server monitors use an infrastructure agent installed on your servers to collect and report system metrics. This enables you to:

- Monitor server uptime and availability
- Track CPU, memory, and disk usage
- Monitor running processes
- Set alerts based on resource utilization thresholds
- Detect infrastructure issues before they impact your services

## Creating a Server Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Server / VM** as the monitor type
4. A **Secret Key** will be generated for this monitor — you will need it to configure the agent
5. Follow the installation instructions to set up the agent on your server

## Installing the Infrastructure Agent

The OneUptime Infrastructure Agent is a lightweight Go-based daemon that collects system metrics and sends them to OneUptime every 30 seconds. It supports Linux, macOS, and Windows.

### Linux / macOS

```bash
# Install the agent
curl -sSL https://oneuptime.com/docs/static/scripts/infrastructure-agent/install.sh | sudo bash

# Configure the agent
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start the agent
sudo oneuptime-infrastructure-agent start
```

Replace `YOUR_SECRET_KEY` with the secret key shown in your monitor's settings, and `https://oneuptime.com` with your OneUptime instance URL if self-hosted.

### Windows

1. Download the latest agent from [GitHub Releases](https://github.com/OneUptime/oneuptime/releases/latest)
   - `oneuptime-infrastructure-agent_windows_amd64.zip` for x64 systems
   - `oneuptime-infrastructure-agent_windows_arm64.zip` for ARM64 systems
2. Extract the zip file
3. Open Command Prompt as Administrator and run:

```bash
# Configure the agent
oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com

# Start the agent
oneuptime-infrastructure-agent start
```

### Proxy Support

If your server connects to the internet through a proxy, you can configure the agent to use it:

```bash
sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com --proxy-url=http://proxy.example.com:8080
```

## Agent Commands

The infrastructure agent supports the following commands:

| Command | Description |
|---------|-------------|
| `configure` | Configure the agent with your secret key and OneUptime URL |
| `start` | Start the agent service |
| `stop` | Stop the agent service |
| `restart` | Restart the agent service |
| `status` | Show the current service status |
| `logs` | View agent logs (use `-n` for line count, `-f` to follow) |
| `uninstall` | Uninstall the agent service |

## Collected Metrics

The agent collects the following metrics from your server:

### CPU

- **CPU Usage Percent** — Overall CPU utilization as a percentage
- **CPU Cores** — Number of CPU cores

### Memory

- **Total Memory** — Total available memory
- **Used Memory** — Memory currently in use
- **Free Memory** — Available free memory
- **Memory Usage Percent** — Memory utilization as a percentage

### Disk

For each mounted disk/volume:

- **Total Disk Space** — Total capacity of the disk
- **Used Disk Space** — Space currently in use
- **Free Disk Space** — Available free space
- **Disk Usage Percent** — Disk utilization as a percentage
- **Disk Path** — Mount path of the disk

### Processes

- **Process Name** — Name of the running process
- **Process ID (PID)** — Process identifier
- **Process Command** — Full command used to start the process

## Monitoring Criteria

You can configure criteria to determine when your server is considered online, degraded, or offline.

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Is Online | Whether the server agent is reporting (based on heartbeat) |
| CPU Usage Percent | Current CPU utilization percentage |
| Memory Usage Percent | Current memory utilization percentage |
| Disk Usage Percent | Current disk utilization percentage (for a specific disk path) |
| Server Process Name | Check if a process with a specific name is running |
| Server Process Command | Check if a process with a specific command is running |
| Server Process PID | Check if a process with a specific PID is running |

### Filter Types

For numeric metrics (CPU, memory, disk):

- **Greater Than** — Value exceeds a threshold
- **Less Than** — Value is below a threshold
- **Greater Than or Equal To** — Value is at or above a threshold
- **Less Than or Equal To** — Value is at or below a threshold
- **Evaluate Over Time** — Evaluate using aggregation (Average, Sum, Maximum, Minimum, All Values, Any Value) over a time window

For process checks:

- **Is Executing** — The process is currently running
- **Is Not Executing** — The process is not running

### Example Criteria

#### Mark server as offline if agent stops reporting

- **Check On**: Is Online
- **Filter Type**: False

#### Alert when CPU usage exceeds 90%

- **Check On**: CPU Usage Percent
- **Filter Type**: Greater Than
- **Value**: 90

#### Alert when disk usage exceeds 85%

- **Check On**: Disk Usage Percent
- **Disk Path**: `/`
- **Filter Type**: Greater Than
- **Value**: 85

#### Alert when memory usage exceeds 80%

- **Check On**: Memory Usage Percent
- **Filter Type**: Greater Than
- **Value**: 80

#### Alert if a critical process stops running

- **Check On**: Server Process Name
- **Filter Type**: Is Not Executing
- **Value**: `nginx`

## Troubleshooting

### Agent not reporting

- Verify the agent is running: `sudo oneuptime-infrastructure-agent status`
- Check agent logs: `sudo oneuptime-infrastructure-agent logs -n 50`
- Confirm the secret key is correct
- Ensure the server can reach your OneUptime instance URL
- Check firewall rules allow outbound HTTPS connections

### High resource usage by agent

The agent is designed to be lightweight. If you notice high resource usage:
- Restart the agent: `sudo oneuptime-infrastructure-agent restart`
- Check agent logs for errors

### Proxy issues

- Verify the proxy URL and port are correct
- Ensure the proxy allows connections to your OneUptime instance
- Reconfigure with: `sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy:port --secret-key=YOUR_KEY --oneuptime-url=YOUR_URL`

## Best Practices

1. **Set meaningful thresholds** — Configure degraded and offline criteria that match your server's normal operating ranges
2. **Monitor critical processes** — Use process monitoring to ensure essential services like web servers and databases are always running
3. **Monitor disk usage proactively** — Disk space issues can cascade into application failures; set alerts well before disks are full
4. **Use "Evaluate Over Time"** — For metrics like CPU that can spike briefly, use time-based aggregation to avoid false alerts
5. **Keep the agent updated** — Periodically update the infrastructure agent to get the latest improvements and fixes
