# Ceph Monitor

Ceph monitoring allows you to monitor the health and performance of your Ceph clusters — overall health, mon quorum, OSDs, pools, and placement groups. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime Ceph Agent**) and evaluates them against your configured criteria.

## Overview

Ceph monitors use metrics from the Ceph mgr `prometheus` module to provide visibility into your storage clusters. This enables you to:

- Alert the moment cluster health degrades to `HEALTH_WARN` or `HEALTH_ERR`
- Detect down or out OSDs before data availability suffers
- Watch placement groups for degraded or undersized states
- Track pool capacity, object counts, and IOPS / throughput
- Monitor mon quorum membership

## Creating a Ceph Monitor

1. Go to **Monitors** in the OneUptime Dashboard
2. Click **Create Monitor**
3. Select **Ceph** as the monitor type
4. Select the Ceph cluster to monitor
5. Configure metric queries and aggregation
6. Configure monitoring criteria as needed

## Configuration Options

### Ceph Cluster

Select the Ceph cluster to monitor. Clusters are auto-registered the first time the OneUptime Ceph Agent ships telemetry from them (keyed by the `ceph.cluster.name` resource attribute) — you do not need to create them manually.

### Metric Queries

Configure one or more metric queries to evaluate. Each query specifies:

- **Metric name** — The Ceph metric to query (`ceph_*` series)
- **Aggregation** — How to aggregate metric values (Avg, Sum, Max, Min)
- **Filters** — Additional attribute-based filtering, most usefully on the `ceph_daemon` label (e.g. `osd.3`) or pool labels
- **Group By** — Optionally group by `ceph_daemon` or the pool label so each OSD or pool is evaluated independently

You can also create **formulas** that combine multiple metric queries using mathematical expressions — for example a used-capacity ratio from `ceph_cluster_total_used_bytes / ceph_cluster_total_bytes`.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

The Ceph Agent scrapes every mgr daemon every 30 seconds with `honor_labels: true`, so Ceph's own labels (`ceph_daemon`, pool labels) are preserved.

### Cluster Health

| Metric | Description |
|--------|-------------|
| `ceph_health_status` | Overall cluster health: 0 = `HEALTH_OK`, 1 = `HEALTH_WARN`, 2 = `HEALTH_ERR` |
| `ceph_mon_quorum_status` | 1 when the mon is in quorum, per `ceph_daemon` (e.g. `mon.a`) |
| `ceph_cluster_total_bytes` | Total cluster capacity in bytes |
| `ceph_cluster_total_used_bytes` | Used cluster capacity in bytes |

### OSD

| Metric | Description |
|--------|-------------|
| `ceph_osd_up` | 1 when the OSD is up, per `ceph_daemon` (e.g. `osd.3`) |
| `ceph_osd_in` | 1 when the OSD is in the data distribution, per `ceph_daemon` |

### Pool

| Metric | Description |
|--------|-------------|
| `ceph_pool_stored` | Bytes of user data stored in the pool |
| `ceph_pool_max_avail` | Bytes still writable to the pool given its replication / EC profile |
| `ceph_pool_objects` | Number of objects in the pool |
| `ceph_pool_rd` | Cumulative read operations on the pool |
| `ceph_pool_wr` | Cumulative write operations on the pool |
| `ceph_pool_rd_bytes` | Cumulative bytes read from the pool |
| `ceph_pool_wr_bytes` | Cumulative bytes written to the pool |

### Placement Groups

| Metric | Description |
|--------|-------------|
| `ceph_pg_active` | Number of PGs in the `active` state, per pool |
| `ceph_pg_degraded` | Number of PGs in the `degraded` state, per pool |
| `ceph_pg_undersized` | Number of PGs in the `undersized` state, per pool |

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

OneUptime provides templates for common Ceph monitoring scenarios. Thresholds are starting points — edit them after applying a template:

| Template | Watches | Fires when |
|----------|---------|------------|
| Cluster Health Warning | `ceph_health_status` | Max >= 1 — health reaches `HEALTH_WARN` (or worse) |
| Cluster Health Error | `ceph_health_status` | Max >= 2 — health reaches `HEALTH_ERR` |
| OSD Down | `ceph_osd_up` | Min < 1 — any OSD reports down |
| Monitor Quorum Degraded | `ceph_mon_quorum_status` | Min < 1 — a monitor drops out of quorum |
| Degraded Placement Groups | `ceph_pg_degraded` | Max > 0 — degraded PGs exist |
| Undersized Placement Groups | `ceph_pg_undersized` | Max > 0 — undersized PGs exist |
| Pool Low Capacity | `ceph_pool_max_avail` | Min below a byte threshold — the fullest pool's writable headroom drops too low (default 100 GB) |

> Note: down/quorum templates use **Min** aggregation so a single down OSD or out-of-quorum monitor trips the threshold instead of being masked by the healthy majority; the capacity template also uses Min so the fullest pool drives the alert. Add a `ceph_daemon` attribute filter to scope the OSD template to a specific OSD.

## Setup Requirements

To use Ceph monitoring, you need to:

1. Enable the mgr prometheus module on the cluster: `ceph mgr module enable prometheus`
2. Install the OneUptime Ceph Agent on a machine that can reach every mgr daemon on port 9283 — see the [Ceph Agent installation guide](/docs/telemetry/ceph)
3. Pass `ONEUPTIME_URL`, `ONEUPTIME_TELEMETRY_INGESTION_KEY`, `CEPH_CLUSTER_NAME`, and `CEPH_MGR_ENDPOINTS` (all mgrs, comma-separated, wrapped in square brackets) as environment variables
4. Wait for the cluster to auto-register (about a minute after the first scrape)

## Troubleshooting

### The cluster does not appear in the monitor's cluster picker

The cluster registers itself from the agent's telemetry. Check the agent is running and shipping (see [Verify the Installation](/docs/telemetry/ceph)), and that `CEPH_CLUSTER_NAME` is set.

### Metrics stopped after a mgr failover

The agent must scrape **all** mgr daemons, not just the active one — standbys return empty responses until they take over. List every mgr in `CEPH_MGR_ENDPOINTS`.

### `ceph_health_status` is 1 but no incident fires

Check the criteria filter is **Greater Than or Equal To** `1` (not Greater Than), and that the monitor's rolling window covers at least one scrape interval (30 seconds).

### Counters like `ceph_pool_wr_bytes` only ever grow

Pool IO series are cumulative counters. Alert on their rate of change (or use a formula over a rolling window) rather than the raw value.
