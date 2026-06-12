# Proxmox Monitor

Proxmox monitoring allows you to monitor the health and performance of your Proxmox VE clusters — nodes, QEMU VMs, LXC containers, storage, and HA state. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime Proxmox Agent**) and evaluates them against your configured criteria.

## Overview

Proxmox monitors use metrics from your clusters to provide visibility into your virtualization workloads. This enables you to:

- Monitor cluster, node, and per-guest health
- Track CPU, memory, disk, and network usage across nodes and guests
- Detect offline nodes and stopped VMs / containers
- Watch storage pools approaching capacity
- Alert on degraded HA state, high CPU, high memory, and more

## Creating a Proxmox Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Proxmox** as the monitor type
4. Select the Proxmox cluster to monitor
5. Configure metric queries and aggregation
6. Configure monitoring criteria as needed

## Configuration Options

### Proxmox Cluster

Select the Proxmox cluster to monitor. Clusters are auto-registered the first time the OneUptime Proxmox Agent ships telemetry from them (keyed by the `proxmox.cluster.name` resource attribute) — you do not need to create them manually.

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The Proxmox metric to query (`pve_*` series)
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min)
- **Filters** — Additional attribute-based filtering, most usefully on the `id` label (`node/pve1`, `qemu/100`, `lxc/101`, `storage/pve1/local`)
- **Group By** — Optionally group by the `id` label so each node, guest, or storage is evaluated independently

You can also create **formulas** that combine multiple metric queries using mathematical expressions — for example a memory ratio from `pve_memory_usage_bytes / pve_memory_size_bytes`.

### The `id` Label

Every metric the agent collects carries an `id` label that identifies the Proxmox resource the datapoint belongs to:

| `id` value | Resource |
|------------|----------|
| `node/<name>` | A cluster node, e.g. `node/pve1` |
| `qemu/<vmid>` | A QEMU virtual machine, e.g. `qemu/100` |
| `lxc/<vmid>` | An LXC container, e.g. `lxc/101` |
| `storage/<node>/<storage>` | A storage on a node, e.g. `storage/pve1/local` |

Filter on it to scope a query to one resource class (or one resource), and group by it to evaluate each resource independently.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

The Proxmox Agent scrapes prometheus-pve-exporter every 30 seconds with both the cluster and node collectors enabled.

### Availability

| Metric | Description |
|--------|-------------|
| `pve_up` | 1 when the node or guest is up / running, 0 otherwise |
| `pve_uptime_seconds` | Uptime of the node or guest in seconds |

### Node

| Metric | Description |
|--------|-------------|
| `pve_node_info` | Node metadata (name, IP) as labels, value is always 1 |
| `pve_cpu_usage_ratio` | CPU usage as a 0–1 ratio of the available CPU |
| `pve_cpu_usage_limit` | Number of CPUs / cores available |
| `pve_memory_usage_bytes` | Memory in use, in bytes |
| `pve_memory_size_bytes` | Total memory, in bytes |

### Guest (VM / LXC)

| Metric | Description |
|--------|-------------|
| `pve_guest_info` | Guest metadata (name, node, type `qemu` or `lxc`) as labels, value is always 1 |
| `pve_network_receive_bytes` | Cumulative bytes received by the guest |
| `pve_network_transmit_bytes` | Cumulative bytes transmitted by the guest |

CPU and memory series (`pve_cpu_usage_ratio`, `pve_memory_usage_bytes`, ...) are also emitted per guest on `qemu/*` and `lxc/*` ids.

### Storage

| Metric | Description |
|--------|-------------|
| `pve_disk_usage_bytes` | Bytes used on the disk / storage |
| `pve_disk_size_bytes` | Total size of the disk / storage in bytes |

### HA

| Metric | Description |
|--------|-------------|
| `pve_ha_state` | High-availability state of the resource |

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

OneUptime provides templates for common Proxmox monitoring scenarios. Thresholds are starting points — edit them after applying a template:

| Template | Watches | Fires when |
|----------|---------|------------|
| Node Offline | `pve_up` | Min < 1 — a resource reports down. Add an `id` filter (e.g. `node/pve1`) to scope to nodes, since intentionally stopped guests also report 0 |
| Guest Down (Zero Uptime) | `pve_uptime_seconds` | Min = 0 — a VM or container has stopped or crashed |
| High Node CPU Usage | `pve_cpu_usage_ratio` | Max > 0.9 (90% of available CPU) |
| High Guest CPU Usage | `pve_cpu_usage_ratio` | Max > 0.9 — add an `id` filter (e.g. `qemu/100`) to scope to a specific guest |
| High Memory Usage | `pve_memory_usage_bytes` | Max above a byte threshold — tune to roughly 90% of your node's RAM (pve-exporter reports absolute bytes, not a percentage) |
| Storage Near Full | `pve_disk_usage_bytes` | Max above a byte threshold — tune to roughly 90% of the volume's capacity |
| HA State Degraded | `pve_ha_state` filtered to `state="error"` | An HA-managed resource enters the error state |

> Note: down/offline templates use **Min** aggregation so a single down resource trips the threshold instead of being masked by resources that are still up; usage templates use **Max** so the busiest resource is not averaged away by idle ones. Templates evaluate the whole cluster by default — add `id` attribute filters to scope them to a resource class or a single resource.

## Setup Requirements

To use Proxmox monitoring, you need to:

1. Install the OneUptime Proxmox Agent on a machine that can reach your Proxmox VE API — see the [Proxmox Agent installation guide](/docs/telemetry/proxmox)
2. Pass `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `PROXMOX_CLUSTER_NAME`, and the Proxmox API details as environment variables
3. Wait for the cluster to auto-register (about a minute after the first scrape)

> Proxmox VE 9+ can also push metrics natively via its built-in OpenTelemetry metric server — see the [zero-install alternative](/docs/telemetry/proxmox) in the agent guide. The native push uses different metric names (`proxmox_*` instead of `pve_*`), so the templates and catalog on this page apply to the agent path.

## Troubleshooting

### The cluster does not appear in the monitor's cluster picker

The cluster registers itself from the agent's telemetry. Check the agent is running and shipping (see [Verify the Installation](/docs/telemetry/proxmox)), and that `PROXMOX_CLUSTER_NAME` is set.

### Guest metrics are missing

Guest series come from the exporter's cluster collector (`cluster=1` scrape parameter, enabled in the shipped config). If you customized the collector config, restore it.

### Incidents are not firing for "Node High CPU"

Make sure the metric query's aggregation is **Max** (not Avg) and that it groups by the `id` label. An Avg across all nodes of a busy cluster is diluted by idle nodes and rarely crosses the threshold.

### Counters like `pve_network_receive_bytes` only ever grow

Network series are cumulative counters. Alert on their rate of change (or use a formula over a rolling window) rather than the raw value.
