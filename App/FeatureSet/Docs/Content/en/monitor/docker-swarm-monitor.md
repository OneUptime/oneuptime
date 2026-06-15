# Docker Swarm Monitor

Docker Swarm monitoring allows you to monitor the health and performance of your Docker Swarm clusters — the containers backing each service task across the cluster's nodes. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime Docker Swarm Agent**) running on a manager node, and evaluates them against your configured criteria.

## Overview

Docker Swarm monitors use per-task container metrics from your cluster to provide visibility into your Swarm workloads. This enables you to:

- Monitor per-task CPU and memory pressure across every service
- Detect tasks that crash, restart, or get rescheduled (uptime drops to zero)
- Watch task process counts for fork bombs or resource leaks
- Scope alerts to a single service, node, or task container

## Creating a Docker Swarm Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Docker Swarm** as the monitor type
4. Select the Docker Swarm cluster to monitor
5. Configure metric queries and aggregation (or pick a template)
6. Configure monitoring criteria as needed

## Configuration Options

### Docker Swarm Cluster

Select the Docker Swarm cluster to monitor. Clusters are auto-registered the first time the OneUptime Docker Swarm Agent ships telemetry from them (keyed by the `docker.swarm.cluster.name` resource attribute) — you do not need to create them manually.

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The container metric to query (the `container.*` series emitted by the docker_stats receiver)
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min)
- **Filters** — Optional attribute-based filtering on container identity (see below)
- **Group By** — Optionally group by the `container.name` label so each Swarm task is evaluated independently — one incident per task

You can also create **formulas** that combine multiple metric queries using mathematical expressions.

### Metrics

The OneUptime Docker Swarm Agent runs the OpenTelemetry **docker_stats** receiver against the cluster's containers, so the series that arrive are the standard container-runtime metrics:

| Metric | Description |
|--------|-------------|
| `container.cpu.utilization` | CPU utilization (%) of a task's container (100% = one full core) |
| `container.memory.usage.total` | Total memory used by a task's container (bytes) |
| `container.memory.percent` | Memory used as a percentage of the container's limit |
| `container.network.io.usage.rx_bytes` | Bytes received over the network |
| `container.network.io.usage.tx_bytes` | Bytes transmitted over the network |
| `container.pids.count` | Number of processes inside the container |
| `container.uptime` | How long the task's container has been running (seconds) |

There are **no** `docker_swarm_*` metrics — Swarm topology (nodes, services, tasks) is collected separately as inventory, not as metrics. These metric series describe the containers that back each service task.

### Cluster Scope and Container Identity

Every metric the agent collects is scoped by the `docker.swarm.cluster.name` **resource attribute** the agent stamps on the whole batch. The monitor always applies this scope from the cluster you selected — you do not configure it manually. The agent does **not** stamp `container.runtime` or `host.name`, so the monitor never filters on them.

Each datapoint carries the owning container's identity as datapoint labels:

| Attribute | Meaning | Example |
|-----------|---------|---------|
| `container.name` | A Swarm task's container, named `<service>.<slot>.<taskid>` | `web.1.abc123` |
| `container.image.name` | The container's image | `nginx:latest` |
| `docker.swarm.service.name` | The owning Swarm service (when stamped) | `web` |
| `docker.swarm.node.name` | The Swarm node the task runs on (when stamped) | `swarm-node-1` |

Filter on `container.image.name`, `docker.swarm.service.name`, or `docker.swarm.node.name` to scope a query, on `container.name` to scope to one task, and group by `container.name` to evaluate each task independently — one incident per task.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- and longer windows

## Alert Templates

The Quick Setup tab offers pre-built templates that auto-configure the metric, aggregation, grouping, time range, and thresholds:

| Template | Severity | Fires when |
|----------|----------|------------|
| **Task Down (Low Uptime)** | Critical | Any task's `container.uptime` drops to 0 (rescheduled, restarted, or crashed) |
| **High Task CPU Usage** | Warning | Any task's `container.cpu.utilization` exceeds 80% |
| **High Task Memory Usage** | Warning | Any task's `container.memory.percent` exceeds 85% of its limit |
| **High Task Process Count** | Warning | Any task's `container.pids.count` exceeds 500 |

Each template groups by `container.name`, so one incident fires per affected task.

## Inventory

Swarm nodes, services, and tasks are tracked as **inventory** (the `DockerSwarmResource` table, available under the cluster's pages), separately from these metrics. Use inventory to browse the cluster's topology; use the monitor to alert on per-task health.

## Criteria and Incidents

Docker Swarm monitors evaluate against per-task metric series. When a criteria threshold is breached, OneUptime creates an incident/alert with a root-cause breakdown listing the affected tasks (container name, service, node, and metric value). Incidents and alerts created by a Docker Swarm monitor are automatically linked to the cluster, so they appear on the cluster's activity pages.
