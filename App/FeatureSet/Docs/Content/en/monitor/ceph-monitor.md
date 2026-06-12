# Ceph Monitor

Ceph monitoring allows you to monitor the health and performance of your Ceph clusters — overall health, active health checks, mon quorum, OSDs, pools, and placement groups. OneUptime collects metrics via a pre-configured OpenTelemetry Collector (the **OneUptime Ceph Agent**) and evaluates them against your configured criteria.

## Overview

Ceph monitors use metrics from the Ceph mgr `prometheus` module to provide visibility into your storage clusters. This enables you to:

- Alert the moment cluster health degrades to `HEALTH_WARN` or `HEALTH_ERR`
- Detect down or out OSDs before data availability suffers
- Watch placement groups for inactive, degraded, undersized, or damaged states
- Track cluster, pool, and per-OSD capacity, plus pool IOPS / throughput
- Monitor mon quorum membership, clock skew, and mon disk space
- Catch daemon crashes, slow operations, and slow OSD heartbeats via Ceph's own health checks

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
- **Filters** — Attribute-based filtering on the `ceph_daemon` label (e.g. `osd.3`, `mon.a`) for per-daemon metrics, the `pool_id` label for per-pool metrics, or the `name` label of `ceph_health_detail` (e.g. `OSD_NEARFULL`)
- **Group By** — Optionally group by `ceph_daemon` or `pool_id` so each OSD/monitor or pool is evaluated independently — one incident per daemon or pool

You can also create **formulas** that combine multiple metric queries using mathematical expressions — for example a used-capacity ratio from `ceph_cluster_total_used_bytes / ceph_cluster_total_bytes`.

> Pool **data** series carry only the `pool_id` label — the pool name exists solely on `ceph_pool_metadata`. Filter and group pool data series by `pool_id`, and join the metadata series when you need a display name.

### Health-check Series

`ceph_health_detail` (Quincy and later) exports **one series per active health check**, labeled `name` (e.g. `OSD_NEARFULL`, `RECENT_CRASH`) and `severity`. A series exists only while its check fires — absence means healthy. That makes "Max > 0 fires / = 0 recovers" the right shape for alerting on any Ceph health check by name, and it is exactly how the health-check templates below are built (their recover criteria treat series absence as zero). `ceph_daemon_health_metrics` follows the same pattern per daemon, keyed by a `type` label (e.g. `SLOW_OPS`) and `ceph_daemon`.

### Rolling Time Window

Select the time window for metric evaluation:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

The Ceph Agent scrapes every mgr daemon every 30 seconds with `honor_labels: true`, so Ceph's own labels (`ceph_daemon`, `pool_id`) are preserved.

### Cluster Health

| Metric | Description |
|--------|-------------|
| `ceph_health_status` | Overall cluster health: 0 = `HEALTH_OK`, 1 = `HEALTH_WARN`, 2 = `HEALTH_ERR` |
| `ceph_health_detail` | One series per **active** health check with `name` and `severity` labels (Quincy and later — absent on older releases) |
| `ceph_healthcheck_slow_ops` | Number of slow OSD/monitor operations reported by the SLOW_OPS health check |
| `ceph_daemon_health_metrics` | Per-daemon health metrics keyed by `type` (e.g. `SLOW_OPS`) and `ceph_daemon` |
| `ceph_mon_quorum_status` | 1 when the mon is in quorum, per `ceph_daemon` (e.g. `mon.a`) |
| `ceph_mon_metadata` | Mon metadata (value is always 1) — sum it to count monitors |
| `ceph_cluster_total_bytes` | Total raw cluster capacity in bytes |
| `ceph_cluster_total_used_bytes` | Used raw cluster capacity in bytes |

### OSD

| Metric | Description |
|--------|-------------|
| `ceph_osd_up` | 1 when the OSD is up, per `ceph_daemon` (e.g. `osd.3`) |
| `ceph_osd_in` | 1 when the OSD is in the data distribution, per `ceph_daemon` |
| `ceph_osd_apply_latency_ms` | Time to apply an operation to the backing store, per OSD |
| `ceph_osd_commit_latency_ms` | Time to commit an operation to the journal/WAL, per OSD |
| `ceph_osd_stat_bytes` | Total raw capacity of each OSD's backing device |
| `ceph_osd_stat_bytes_used` | Raw bytes used on each OSD — compare against total to spot imbalanced or nearfull OSDs |
| `ceph_osd_numpg` | Number of placement groups hosted by each OSD |
| `ceph_osd_metadata` | OSD metadata (hostname, device_class, version; value is always 1) — sum it to count OSDs |

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
| `ceph_pool_metadata` | Pool metadata (value is always 1) — the ONLY series mapping `pool_id` to a name |

### Placement Groups

All `ceph_pg_*` state metrics are exported **per pool** with a `pool_id` label — they are not single cluster-wide gauges. Sum across pools for a cluster-wide count:

| Metric | Description |
|--------|-------------|
| `ceph_pg_total` | Number of PGs, per pool |
| `ceph_pg_active` | Number of PGs in the `active` state (able to serve I/O), per pool |
| `ceph_pg_clean` | Number of PGs in the `clean` state (fully replicated), per pool |
| `ceph_pg_degraded` | Number of PGs in the `degraded` state, per pool |
| `ceph_pg_undersized` | Number of PGs in the `undersized` state, per pool |
| `ceph_num_objects_degraded` | Objects with fewer replicas than configured |
| `ceph_num_objects_misplaced` | Objects not on their CRUSH-intended OSDs (data safe, placement wrong) |

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

OneUptime ships 22 templates covering cluster health, OSDs, placement groups, and capacity. Each builds a complete monitor — metric queries, label filters, group-by, a fire criteria, and an auto-recover criteria — that you can edit after applying. Thresholds are starting points. Templates evaluate over the past 5 minutes unless noted:

### Cluster Health

| Template | Severity | Watches | Fires when |
|----------|----------|---------|------------|
| Cluster Health Error | Critical | `ceph_health_status`, Max over the past 1 minute | ≥ 2 — health reaches `HEALTH_ERR`; recovers below 2 |
| Cluster Health Warning | Warning | `ceph_health_status`, Max | ≥ 1 — health reaches `HEALTH_WARN` or worse |
| Monitor Quorum Degraded | Critical | `ceph_mon_quorum_status`, Min per `ceph_daemon`, past 1 minute | Any monitor drops below 1 (out of quorum). One incident per monitor |
| Slow Operations | Warning | `ceph_healthcheck_slow_ops`, Max | > 0 — the cluster-level SLOW_OPS health check is active |
| Daemon Slow Operations | Warning | `ceph_daemon_health_metrics` filtered to `type=SLOW_OPS`, Max per `ceph_daemon` | > 0 — pinpoints the exact OSD or monitor reporting slow ops. One incident per daemon |
| Daemon Crash | Critical | `ceph_health_detail` filtered to `name=RECENT_CRASH`, Max | The check is active — unacknowledged daemon crashes exist (the only crash signal the mgr exports; there is no `ceph_crash_*` metric). Clears when crashes are archived |
| Monitor Clock Skew | Warning | `ceph_health_detail` filtered to `name=MON_CLOCK_SKEW`, Max | The check is active — mon clock skew exceeds the allowed threshold (default 0.05 s) |
| Monitor Disk Space | Critical + Warning | `ceph_health_detail`, two queries: `name=MON_DISK_CRIT` and `name=MON_DISK_LOW` | Two tiers in one template: Critical when MON_DISK_CRIT is active (default 5% free), Warning when MON_DISK_LOW is active (default 30% free). Recovers when both clear |

### OSD

| Template | Severity | Watches | Fires when |
|----------|----------|---------|------------|
| OSD Down | Critical | `ceph_osd_up`, Min per `ceph_daemon` | Any OSD reports below 1. One incident per OSD |
| OSD Out | Warning | `ceph_osd_in`, Min per `ceph_daemon` | Any OSD reports below 1 (marked out of the data distribution) |
| OSD High Latency | Warning | `ceph_osd_apply_latency_ms`, Avg per `ceph_daemon` | > 100 ms sustained apply latency. One incident per OSD |
| OSD Slow Heartbeats | Warning | `ceph_health_detail`, two queries: `name=OSD_SLOW_PING_TIME_FRONT` and `name=OSD_SLOW_PING_TIME_BACK` | Either check is active — heartbeat pings on the public or cluster network exceed the grace threshold (the mgr exports no ping-time gauge, so these checks are the only signal). Recovers when both clear |

### Placement Groups

| Template | Severity | Watches | Fires when |
|----------|----------|---------|------------|
| Inactive Placement Groups | Critical | Formula: `ceph_pg_total` − `ceph_pg_active`, both Summed across pools | > 0 — PGs cannot serve I/O; client requests to them hang. Recovers at 0 |
| Degraded Placement Groups | Warning | `ceph_pg_degraded`, Max | > 0 — objects have fewer replicas than configured |
| Undersized Placement Groups | Warning | `ceph_pg_undersized`, Max | > 0 — PGs are mapped to fewer OSDs than their replica count |
| Damaged Placement Groups | Critical | `ceph_health_detail`, two queries: `name=PG_DAMAGED` and `name=OSD_SCRUB_ERRORS` | Either check is active — scrubbing found data damage or OSD read errors. Recovers when both clear |

### Capacity

| Template | Severity | Watches | Fires when |
|----------|----------|---------|------------|
| Cluster Near Full | Warning | Formula: `ceph_cluster_total_used_bytes` ÷ `ceph_cluster_total_bytes` × 100 | > 85% — Ceph's default nearfull ratio |
| Cluster Full | Critical | The same ratio | > 95% — Ceph's default full ratio, at which writes stop cluster-wide |
| Pool Near Full | Warning | Formula: `ceph_pool_stored` ÷ (`ceph_pool_stored` + `ceph_pool_max_avail`) × 100, per `pool_id` | Any pool exceeds 85% of its writable capacity. One incident per pool |
| OSD Nearfull | Warning | `ceph_health_detail` filtered to `name=OSD_NEARFULL`, Max | The check is active — an individual OSD crossed the nearfull threshold (default 85%); single OSDs fill up long before the cluster average does |
| OSD Backfillfull | Warning | `ceph_health_detail` filtered to `name=OSD_BACKFILLFULL`, Max | The check is active — backfill onto the OSD is refused (default 90%), stalling recovery and rebalancing |
| OSD Full | Critical | `ceph_health_detail` filtered to `name=OSD_FULL`, Max over the past 1 minute | The check is active — an OSD reached the full threshold (default 95%) and writes are being refused |

> Notes on the choices baked in: down/quorum templates use **Min** so a single down OSD or out-of-quorum monitor trips the threshold instead of being masked by the healthy majority; count-style and health-check templates use **Max** so one bad scrape fires. The PG-inactive difference and the capacity ratios aggregate both sides with **Sum** — `ceph_pg_*` and pool series are per-pool, and both sides ride the same mgr scrape, so the scrape multiple cancels. Templates watching `ceph_health_detail` require **Quincy or later**; health-check series (`ceph_health_detail` and `ceph_daemon_health_metrics`) exist only while the check is active, so the recover criteria treat series absence as zero — the monitor returns to healthy when the check clears. Add a `ceph_daemon` attribute filter to scope per-daemon templates to a specific daemon.

Not covered by templates, with reasons: PG imbalance needs cross-series stddev math the criteria engine does not support; capacity-forecast alerting needs server-side derived metrics (the dashboard shows a client-side growth fit instead); hardware/SMART failure prediction has no mgr metric; scrub-staleness has no per-pool staleness metric; NVMe-oF / RBD-mirror / cephadm rules need different exporters.

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

### Health-check templates never fire

Templates watching `ceph_health_detail` (Daemon Crash, Monitor Clock Skew, OSD Nearfull/Backfillfull/Full, Monitor Disk Space, Damaged PGs, OSD Slow Heartbeats) need the mgr prometheus module from **Quincy or later** — older releases do not export that series. `curl http://ACTIVE_MGR:9283/metrics | grep ceph_health_detail` while a check is active to verify. Remember health-check series (including `ceph_daemon_health_metrics`) only exist while the check fires — no series during a healthy period is expected.

### Counters like `ceph_pool_wr_bytes` only ever grow

Pool IO series are cumulative counters. Alert on their rate of change (or use a formula over a rolling window) rather than the raw value.
