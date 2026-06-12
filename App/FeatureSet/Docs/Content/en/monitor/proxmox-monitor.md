# Proxmox Monitor

Proxmox monitoring allows you to monitor the health and performance of your Proxmox VE clusters — nodes, QEMU VMs, LXC containers, storage, HA state, backup-job coverage, and storage replication. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime Proxmox Agent**) and evaluates them against your configured criteria.

## Overview

Proxmox monitors use metrics from your clusters to provide visibility into your virtualization workloads. This enables you to:

- Monitor cluster, node, and per-guest health
- Track CPU, memory, disk, and network usage across nodes and guests
- Detect offline nodes and stopped VMs / containers
- Watch storage volumes approaching capacity
- Alert on degraded HA state, guests missing from every backup job, and failing storage replication

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
- **Filters** — Attribute-based filtering on the raw `id` label or the derived `pve.scope` / `pve.type` / `pve.id` attributes (see below)
- **Group By** — Optionally group by the `id` label so each node, guest, storage volume, or replication job is evaluated independently — one incident per resource

You can also create **formulas** that combine multiple metric queries using mathematical expressions — for example a memory percentage from `pve_memory_usage_bytes / pve_memory_size_bytes`.

### The `id` Label and Derived Attributes

Every metric the agent collects carries an `id` datapoint label that identifies the Proxmox resource the datapoint belongs to:

| `id` value | Resource |
|------------|----------|
| `node/<name>` | A cluster node, e.g. `node/pve1` |
| `qemu/<vmid>` | A QEMU virtual machine, e.g. `qemu/100` |
| `lxc/<vmid>` | An LXC container, e.g. `lxc/101` |
| `storage/<node>/<storage>` | A storage volume on a node, e.g. `storage/pve1/local` |

Two exceptions: replication series (`pve_replication_*`) carry the replication **job** id in `id` (e.g. `100-0`), and the cluster-level `pve_not_backed_up_total` has no `id` label at all.

Monitor criteria and attribute filters match on equality (not prefix), so the agent additionally splits `id` into three equality-filterable datapoint attributes. The built-in alert templates rely on them:

| Attribute | Values | Example for `qemu/100` |
|-----------|--------|------------------------|
| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |
| `pve.type` | `node`, `qemu`, `lxc`, `storage` | `qemu` |
| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |

Filter on `pve.scope` or `pve.type` to scope a query to one resource class, on `pve.id` (or `id`) to scope to one resource, and group by `id` to evaluate each resource independently.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

The Proxmox Agent scrapes prometheus-pve-exporter every 30 seconds with both the cluster and node collectors enabled — which also covers the exporter's default-on `backup-info` (cluster-level) and `replication` (node-level) collectors.

### Availability

| Metric | Description |
|--------|-------------|
| `pve_up` | 1 when the node or guest is up / running, 0 otherwise |
| `pve_uptime_seconds` | Uptime of the node or guest in seconds |
| `pve_version_info` | Metadata series carrying the Proxmox VE release in its version/release labels (value is always 1) |

### Node

| Metric | Description |
|--------|-------------|
| `pve_node_info` | Node metadata (value is always 1) — sum it to count the nodes reporting in the cluster |
| `pve_cpu_usage_ratio` | CPU usage as a 0–1 ratio of the available CPU |
| `pve_cpu_usage_limit` | CPU available, in cores (for guests: allocated vCPUs) |
| `pve_memory_usage_bytes` | Memory in use, in bytes |
| `pve_memory_size_bytes` | Total memory, in bytes |

### Guest (VM / LXC)

| Metric | Description |
|--------|-------------|
| `pve_guest_info` | Guest metadata (name, node, type `qemu` or `lxc`) as labels, value is always 1 |
| `pve_network_receive_bytes` | Cumulative bytes received by the guest — chart as a rate to see throughput |
| `pve_network_transmit_bytes` | Cumulative bytes transmitted by the guest — chart as a rate to see throughput |
| `pve_disk_read_bytes` | Cumulative bytes read from disk by the guest — chart as a rate |
| `pve_disk_write_bytes` | Cumulative bytes written to disk by the guest — chart as a rate |
| `pve_onboot_status` | 1 when the guest is configured to start on node boot — a stopped guest with onboot=1 is usually unintended downtime |

CPU and memory series (`pve_cpu_usage_ratio`, `pve_memory_usage_bytes`, ...) are also emitted per guest on `qemu/*` and `lxc/*` ids.

### Storage

| Metric | Description |
|--------|-------------|
| `pve_disk_usage_bytes` | Bytes used on the disk / storage. For QEMU guests this reads 0 unless the QEMU guest agent is installed |
| `pve_disk_size_bytes` | Total size of the disk / storage in bytes |
| `pve_storage_info` | Storage metadata (value is always 1) — sum it to count storage volumes |

### HA

| Metric | Description |
|--------|-------------|
| `pve_ha_state` | High-availability state as an enum-style series: one series per possible state (`started`, `stopped`, `error`, ...) with value 1 for the current state — filter on the `state` label to alert on specific states |

### Backup Coverage

From the exporter's cluster-level `backup-info` collector (enabled by default). These report backup-**job** coverage only — whether backups ran recently or succeeded is not exposed by pve-exporter:

| Metric | Description |
|--------|-------------|
| `pve_not_backed_up_total` | Count of guests not covered by ANY backup job. A single cluster-level series with no `id` label |
| `pve_not_backed_up_info` | One series per uncovered guest (value is always 1), labeled with the guest's `id`. Group by `id` to list the uncovered guests — the series disappears once the guest joins a backup job |

### Replication

From the exporter's node-level `replication` collector (enabled by default). Series carry the replication **job** id in the `id` label (e.g. `100-0`):

| Metric | Description |
|--------|-------------|
| `pve_replication_failed_syncs` | Consecutive failed sync attempts for the job — anything above 0 means its replica is going stale |
| `pve_replication_duration_seconds` | How long the job's last sync took |
| `pve_replication_last_sync_timestamp_seconds` | Unix timestamp of the last **successful** sync |
| `pve_replication_last_try_timestamp_seconds` | Unix timestamp of the last sync **attempt** — newer than last-sync means the most recent attempt failed |
| `pve_replication_next_sync_timestamp_seconds` | Unix timestamp of the next scheduled sync |
| `pve_replication_info` | Job metadata (value is always 1) with type, source, target, and guest labels |

> The criteria engine has no wall-clock math, so replica **staleness** (`now − last_sync`) cannot be alerted on — the Proxmox cluster Overview page computes it client-side instead. Alert on `pve_replication_failed_syncs` (the Replication Failing template below).

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

OneUptime ships 11 templates for common Proxmox monitoring scenarios. Each builds a complete monitor — metric queries, attribute filters, group-by, a fire criteria, and an auto-recover criteria — that you can edit after applying. Thresholds are starting points. All templates evaluate over the past 5 minutes:

| Template | Severity | Watches | Fires when |
|----------|----------|---------|------------|
| Node Offline | Critical | `pve_up` filtered to `pve.scope=node`, Min per `id` | Any node reports below 1. One incident per node; recovers at ≥ 1 |
| Guest Down | Warning | `pve_up` filtered to `pve.scope=guest`, Min per `id` | Any VM or container reports below 1. Intentionally stopped guests also report 0 — add a `pve.id` filter to scope to guests that should always run |
| Cluster Quorum at Risk | Critical | Formula: `pve_up` ÷ `pve_node_info` × 100 (both Sum, `pve.scope=node`) = % of nodes online | ≤ 50% of nodes are online — the honest quorum proxy, since pve-exporter exposes no corosync metric |
| High Node CPU Usage | Warning | `pve_cpu_usage_ratio` filtered to `pve.scope=node`, Avg per `id` | > 0.9 (90% of the node's cores) |
| High Node Memory Usage | Warning | Formula: `pve_memory_usage_bytes` ÷ `pve_memory_size_bytes` × 100, `pve.scope=node`, per `id` | > 85% of the node's RAM — a true percentage, no per-node byte threshold to tune |
| High Guest CPU Usage | Warning | `pve_cpu_usage_ratio` filtered to `pve.scope=guest`, Avg per `id` | > 0.9 (90% of allocated vCPUs) |
| Storage Near Full | Warning | Formula: `pve_disk_usage_bytes` ÷ `pve_disk_size_bytes` × 100, `pve.scope=storage`, per `id` | > 85% of the volume's capacity |
| Container Root Disk Near Full | Warning | The same disk ratio, filtered to `pve.type=lxc`, per `id` | > 90%. QEMU VMs are excluded — their in-guest disk usage reads 0 without the QEMU guest agent |
| HA Resource in Error State | Critical | `pve_ha_state` filtered to `state=error`, Max per `id` | > 0 — HA could not recover the resource; recovers at 0 |
| Guest Not Backed Up | Warning | `pve_not_backed_up_total`, Max (one cluster-wide series, no group-by) | > 0 — at least one guest is in no backup job; recovers at 0. Group `pve_not_backed_up_info` by `id` to list the guests. Covers job membership only — not whether backups ran or succeeded |
| Replication Failing | Critical | `pve_replication_failed_syncs`, Max per `id` (the replication job id) | > 0 — the job's replica is going stale; recovers at 0 |

> Notes on the choices baked in: down/offline templates use **Min** so a single down scrape trips the threshold instead of being masked by scrapes where the resource was still up; CPU templates use **Avg** because `pve_cpu_usage_ratio` is already a 0–1 ratio, so the per-minute average is the sustained utilization; state-style templates (HA, backup, replication) use **Max** so one bad scrape fires. Ratio formulas aggregate both sides with **Sum** — numerator and denominator ride the same exporter scrape, so the scrape multiple cancels and the result is a true percentage. Templates are pre-scoped with `pve.scope` / `pve.type` filters and grouped by `id`, so one incident fires per affected resource.

## Setup Requirements

To use Proxmox monitoring, you need to:

1. Install the OneUptime Proxmox Agent on a machine that can reach your Proxmox VE API — see the [Proxmox Agent installation guide](/docs/telemetry/proxmox). The required read-only API token is a two-command `pveum` snippet (also in the guide)
2. Pass `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `PROXMOX_CLUSTER_NAME`, and the Proxmox API details as environment variables
3. Wait for the cluster to auto-register (about a minute after the first scrape)

> Proxmox VE 9+ can also push metrics natively via its built-in OpenTelemetry metric server — see the [zero-install alternative](/docs/telemetry/proxmox) in the agent guide. The native push uses different metric names (`proxmox_*` instead of `pve_*`), so the templates and catalog on this page apply to the agent path.

## Troubleshooting

### The cluster does not appear in the monitor's cluster picker

The cluster registers itself from the agent's telemetry. Check the agent is running and shipping (see [Verify the Installation](/docs/telemetry/proxmox)), and that `PROXMOX_CLUSTER_NAME` is set.

### Guest metrics are missing

Guest series come from the exporter's cluster collector (`cluster=1` scrape parameter, enabled in the shipped config). If you customized the collector config, restore it.

### Incidents are not firing for "High Node CPU Usage"

The template evaluates the **Avg** of `pve_cpu_usage_ratio` grouped by the `id` label, so each node is checked independently. If you built a custom query instead, make sure it groups by `id` — an ungrouped average across all nodes is diluted by idle ones and rarely crosses the threshold.

### Backup or replication metrics are missing

`pve_not_backed_up_*` comes from the exporter's cluster-level `backup-info` collector and `pve_replication_*` from its node-level `replication` collector — both enabled by default and covered by the shipped config's `cluster=1` / `node=1` scrape parameters. If you run your own exporter, check you have not disabled those collectors. `pve_replication_*` series only exist when the cluster has storage replication jobs configured.

### Counters like `pve_network_receive_bytes` only ever grow

Network and disk I/O series are cumulative counters. Alert on their rate of change (or use a formula over a rolling window) rather than the raw value.
