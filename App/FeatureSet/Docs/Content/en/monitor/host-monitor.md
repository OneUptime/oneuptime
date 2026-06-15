# Host Monitor

Host monitoring lets you monitor the health and performance of your OpenTelemetry-instrumented hosts and servers — the **Hosts** product. OneUptime collects host system metrics via the **OneUptime Infrastructure Agent** (a pre-configured OpenTelemetry Collector running the `hostmetrics` receiver) and evaluates them against your configured criteria.

> **Host Monitor vs. Server / VM Monitor**
>
> The **Host Monitor** is a *telemetry-metric* monitor. It evaluates the `system.*` OpenTelemetry metrics that the OneUptime Infrastructure Agent ships to your project's metrics store, and it fires criteria, alerts, and incidents from the telemetry-monitor worker.
>
> The **Server / VM Monitor** is a separate, *agent-push* monitor. It uses the OneUptime Server Agent, which pushes a status payload on a fixed interval and is evaluated against built-in checks (CPU %, memory %, disk %, etc.).
>
> Use the **Host Monitor** when your hosts are already instrumented with OpenTelemetry (the Hosts product). Use the **Server / VM Monitor** for the lightweight agent-push approach. They can coexist on the same machine.

## Overview

Host monitors use the `system.*` host metrics from your hosts to provide visibility into the underlying machines that run your workloads. This enables you to:

- Monitor host CPU, memory, disk, network, and load average
- Track process counts and per-process CPU utilization
- Alert on high CPU, high memory, full filesystems, high load average, and runaway process counts
- Evaluate metric formulas and per-series breakdowns across hosts

## Creating a Host Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Host** as the monitor type
4. Select the host to monitor
5. Configure metric queries and aggregation
6. Configure monitoring criteria as needed

## Configuration Options

### Host

Select the host to monitor. Hosts are auto-registered the first time the OneUptime Infrastructure Agent ships telemetry from them — the host identifier is sourced from the `host.name` OTel resource attribute. You do not need to create them manually.

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The host metric to query (a `system.*` or `process.*` metric)
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min, Count)
- **Filters** — Additional attribute-based filtering
- **Group By** — Optionally group by a resource attribute (e.g. `resource.host.name`) so each series is evaluated independently

You can also create **formulas** that combine multiple metric queries using mathematical expressions.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

The OneUptime Infrastructure Agent uses the OpenTelemetry `hostmetrics` receiver, which scrapes the host's system metrics at a configurable interval (default every 30 seconds). Every metric is stamped with the `resource.host.name` attribute, which is how the Host monitor scopes its queries to a single host.

### CPU

| Metric | Description |
|--------|-------------|
| `system.cpu.utilization` | Host CPU utilization as a [0, 1] ratio (1.0 = all cores fully busy) |
| `process.cpu.utilization` | Per-process CPU utilization as a [0, 1] ratio |

### Memory

| Metric | Description |
|--------|-------------|
| `system.memory.utilization` | Host memory utilization as a [0, 1] ratio of total physical memory |
| `system.memory.usage` | Host memory usage in bytes |

### Disk

| Metric | Description |
|--------|-------------|
| `system.filesystem.utilization` | Filesystem utilization as a [0, 1] ratio of total capacity |
| `system.filesystem.usage` | Filesystem usage in bytes |

### Network

| Metric | Description |
|--------|-------------|
| `system.network.io` | Cumulative network bytes transferred (received + transmitted) |

### Load Average

| Metric | Description |
|--------|-------------|
| `system.cpu.load_average.1m` | Host CPU load average over the last 1 minute |
| `system.cpu.load_average.5m` | Host CPU load average over the last 5 minutes |
| `system.cpu.load_average.15m` | Host CPU load average over the last 15 minutes |

### Processes

| Metric | Description |
|--------|-------------|
| `system.processes.count` | Number of processes running on the host |

> **A note on units.** The OTel host receiver reports the utilization metrics (`system.cpu.utilization`, `system.memory.utilization`, `system.filesystem.utilization`) as a **[0, 1] ratio**, not a percent. When setting a threshold by hand, use `0.8` for 80%. The built-in templates already account for this.

## Monitoring Criteria

### Available Check Types

| Check Type | Description |
|------------|-------------|
| Metric Value | The value of the configured metric query or formula |

### Aggregation Types

| Aggregation | Description |
|-------------|-------------|
| Average | Average value over the time window |
| Sum | Sum of all values |
| Maximum Value | Highest value in the time window |
| Minimum Value | Lowest value in the time window |
| All Values | All values must match the criteria |
| Any Value | At least one value must match |

### Filter Types

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Pre-built Alert Templates

OneUptime provides templates for common host monitoring scenarios:

| Template | Metric | Threshold | Aggregation |
|----------|--------|-----------|-------------|
| High CPU Utilization | `system.cpu.utilization` | > 80% (0.8 ratio) | Avg |
| High Memory Utilization | `system.memory.utilization` | > 85% (0.85 ratio) | Avg |
| High Filesystem Usage | `system.filesystem.utilization` | > 90% (0.9 ratio) | Max |
| High Load Average (1m) | `system.cpu.load_average.1m` | > 4 | Avg |
| High Process Count | `system.processes.count` | > 2000 | Max |

## Setup Requirements

To use Host monitoring, you need to:

1. Install the OneUptime Infrastructure Agent on each host you want to monitor
2. Configure it with your `ONEUPTIME_URL` and service token so it ships OTel telemetry to your project
3. Confirm metrics appear on the host's **Metrics** tab in the Hosts product

Once telemetry arrives, the host is auto-registered and becomes selectable in the Host monitor's host dropdown.

## Troubleshooting

### The host does not appear in the dropdown

Hosts are auto-registered by `resource.host.name` the first time the OneUptime Infrastructure Agent ships telemetry. If the host is missing, confirm the agent is running and that metrics are visible on the host's **Metrics** tab.

### A "High CPU" template never fires

Remember the utilization metrics are reported as a **[0, 1] ratio**. A hand-written threshold of `80` will never be crossed by a metric that maxes out at `1.0`. Use `0.8` for 80%, or start from the **High CPU Utilization** template, which already uses the correct ratio threshold.

### Incidents fire for the wrong host

The Host monitor scopes every metric query by `resource.host.name = <selected host identifier>`. If multiple hosts share the same `host.name`, their metrics collapse into one series. Give each host a unique `host.name` so the scoping stays clean.
