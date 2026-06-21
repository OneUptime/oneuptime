import { CephResourceScope } from "./MonitorStepCephMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type CephMetricCategory = "Cluster Health" | "OSD" | "Pool" | "PG";

export interface CephMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: CephMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: CephResourceScope;
  unit?: string;
}

/*
 * Metric names follow the ceph-mgr Prometheus module naming scheme.
 * Per-daemon series carry a `ceph_daemon` datapoint label (e.g. "osd.3",
 * "mon.a"); per-pool series carry a `pool_id` label only — the pool name
 * exists solely on `ceph_pool_metadata`, so filter/group pool data series
 * by `pool_id` and join the metadata series when a display name is needed.
 */
const cephMetricCatalog: Array<CephMetricDefinition> = [
  // Cluster Health Metrics
  {
    id: "ceph-health-status",
    friendlyName: "Cluster Health Status",
    description:
      "Overall Ceph cluster health: 0 = HEALTH_OK, 1 = HEALTH_WARN, 2 = HEALTH_ERR. The single most important Ceph metric to alert on.",
    metricName: "ceph_health_status",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
  },
  {
    id: "ceph-health-detail",
    friendlyName: "Health Check Detail",
    description:
      "One series per active health check (e.g. OSD_DOWN, PG_DEGRADED) with name and severity labels. Exposed by the mgr prometheus module on Quincy and later — absent on older releases.",
    metricName: "ceph_health_detail",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "ceph-healthcheck-slow-ops",
    friendlyName: "Slow Operations",
    description:
      "Number of slow OSD/monitor operations reported by the SLOW_OPS health check. Non-zero values surface as client I/O latency or hangs.",
    metricName: "ceph_healthcheck_slow_ops",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "ceph-daemon-health-metrics",
    friendlyName: "Daemon Health Metrics",
    description:
      "Per-daemon health metrics from the mgr, keyed by a type label (e.g. SLOW_OPS, PENDING_CREATING_PGS) and a ceph_daemon label. Filter type = SLOW_OPS and group by ceph_daemon to pinpoint the exact OSD or monitor reporting slow operations.",
    metricName: "ceph_daemon_health_metrics",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "count",
  },
  {
    id: "ceph-mon-quorum-status",
    friendlyName: "Monitor Quorum Status",
    description:
      "Whether each Ceph monitor daemon is in quorum (1) or not (0). One series per monitor — sum to count members in quorum, or take the minimum to detect any monitor out of quorum.",
    metricName: "ceph_mon_quorum_status",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Mon,
    unit: "count",
  },
  {
    id: "ceph-mon-metadata",
    friendlyName: "Monitor Metadata",
    description:
      "Metadata series for each monitor daemon (value is always 1) carrying hostname and ceph_version labels. Sum it to count monitors in the cluster.",
    metricName: "ceph_mon_metadata",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Mon,
    unit: "count",
  },
  {
    id: "ceph-cluster-total-bytes",
    friendlyName: "Cluster Total Capacity",
    description:
      "Total raw storage capacity of the cluster across all OSDs, before replication or erasure-coding overhead.",
    metricName: "ceph_cluster_total_bytes",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
    unit: "bytes",
  },
  {
    id: "ceph-cluster-total-used-bytes",
    friendlyName: "Cluster Used Capacity",
    description:
      "Raw storage currently used across all OSDs. Compare against Cluster Total Capacity to track how full the cluster is.",
    metricName: "ceph_cluster_total_used_bytes",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
    unit: "bytes",
  },

  // OSD Metrics
  {
    id: "ceph-osd-up",
    friendlyName: "OSD Up",
    description:
      "Whether each OSD daemon is up (1) or down (0). One series per OSD — take the minimum to detect any OSD down, or sum to count OSDs that are up.",
    metricName: "ceph_osd_up",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "count",
  },
  {
    id: "ceph-osd-in",
    friendlyName: "OSD In",
    description:
      "Whether each OSD is in the cluster (1) or marked out (0). An OSD that is up but out no longer stores data and triggers rebalancing.",
    metricName: "ceph_osd_in",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "count",
  },
  {
    id: "ceph-osd-apply-latency",
    friendlyName: "OSD Apply Latency",
    description:
      "Time for each OSD to apply an operation to its backing store, in milliseconds. Sustained high values point to a failing or saturated disk.",
    metricName: "ceph_osd_apply_latency_ms",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "ms",
  },
  {
    id: "ceph-osd-commit-latency",
    friendlyName: "OSD Commit Latency",
    description:
      "Time for each OSD to commit an operation to its journal/WAL, in milliseconds. Compare against apply latency to distinguish journal from backing-store slowness.",
    metricName: "ceph_osd_commit_latency_ms",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "ms",
  },
  {
    id: "ceph-osd-stat-bytes",
    friendlyName: "OSD Total Capacity",
    description: "Total raw capacity of each OSD's backing device.",
    metricName: "ceph_osd_stat_bytes",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "bytes",
  },
  {
    id: "ceph-osd-stat-bytes-used",
    friendlyName: "OSD Used Capacity",
    description:
      "Raw bytes used on each OSD. Compare against OSD Total Capacity to spot imbalanced or nearfull OSDs before they block writes.",
    metricName: "ceph_osd_stat_bytes_used",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "bytes",
  },
  {
    id: "ceph-osd-numpg",
    friendlyName: "OSD Placement Groups",
    description:
      "Number of placement groups hosted by each OSD. Outliers indicate CRUSH imbalance — overloaded OSDs become latency hotspots.",
    metricName: "ceph_osd_numpg",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "count",
  },
  {
    id: "ceph-osd-metadata",
    friendlyName: "OSD Metadata",
    description:
      "Metadata series for each OSD daemon (value is always 1) carrying hostname, device_class, and ceph_version labels. Sum it to count OSDs in the cluster.",
    metricName: "ceph_osd_metadata",
    category: "OSD",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Osd,
    unit: "count",
  },

  // Pool Metrics
  {
    id: "ceph-pool-stored",
    friendlyName: "Pool Stored Data",
    description:
      "Logical data stored in each pool, before replication or erasure-coding overhead.",
    metricName: "ceph_pool_stored",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "bytes",
  },
  {
    id: "ceph-pool-max-avail",
    friendlyName: "Pool Max Available",
    description:
      "Estimated space still writable to each pool given current cluster capacity and the pool's replication factor. Alert when this gets low to avoid a full pool.",
    metricName: "ceph_pool_max_avail",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "bytes",
  },
  {
    id: "ceph-pool-objects",
    friendlyName: "Pool Object Count",
    description: "Number of objects stored in each pool.",
    metricName: "ceph_pool_objects",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },
  {
    id: "ceph-pool-rd",
    friendlyName: "Pool Read Operations",
    description:
      "Cumulative read operations served by each pool. Chart as a rate to see read IOPS.",
    metricName: "ceph_pool_rd",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "ops",
  },
  {
    id: "ceph-pool-wr",
    friendlyName: "Pool Write Operations",
    description:
      "Cumulative write operations served by each pool. Chart as a rate to see write IOPS.",
    metricName: "ceph_pool_wr",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "ops",
  },
  {
    id: "ceph-pool-rd-bytes",
    friendlyName: "Pool Read Throughput",
    description:
      "Cumulative bytes read from each pool. Chart as a rate to see read throughput.",
    metricName: "ceph_pool_rd_bytes",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "bytes",
  },
  {
    id: "ceph-pool-wr-bytes",
    friendlyName: "Pool Write Throughput",
    description:
      "Cumulative bytes written to each pool. Chart as a rate to see write throughput.",
    metricName: "ceph_pool_wr_bytes",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "bytes",
  },
  {
    id: "ceph-pool-metadata",
    friendlyName: "Pool Metadata",
    description:
      "Metadata series for each pool (value is always 1) carrying the pool's name label — the ONLY series that maps pool_id to a name. Sum it to count pools in the cluster.",
    metricName: "ceph_pool_metadata",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },

  /*
   * PG (Placement Group) Metrics
   *
   * All ceph_pg_* state metrics are exported PER POOL with a `pool_id`
   * datapoint label on every supported release (Nautilus and later) —
   * they are NOT single cluster-wide gauges. Sum across pools for a
   * cluster-wide count; Max yields only the largest pool's value.
   */
  {
    id: "ceph-pg-total",
    friendlyName: "Total PGs",
    description:
      "Number of placement groups per pool (pool_id label). Sum across pools for the cluster-wide total; subtract Active PGs (also summed) to count PGs unable to serve I/O.",
    metricName: "ceph_pg_total",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },
  {
    id: "ceph-pg-active",
    friendlyName: "Active PGs",
    description:
      "Number of placement groups in the active state (able to serve I/O) per pool (pool_id label). In a healthy cluster the sum across pools equals the summed total PG count.",
    metricName: "ceph_pg_active",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },
  {
    id: "ceph-pg-clean",
    friendlyName: "Clean PGs",
    description:
      "Number of placement groups in the clean state (fully replicated, no recovery pending) per pool (pool_id label). In a healthy cluster the sum across pools equals the summed total PG count.",
    metricName: "ceph_pg_clean",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },
  {
    id: "ceph-pg-degraded",
    friendlyName: "Degraded PGs",
    description:
      "Number of placement groups with fewer data replicas than configured, per pool (pool_id label). Non-zero values mean redundancy is reduced — typically after an OSD failure.",
    metricName: "ceph_pg_degraded",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },
  {
    id: "ceph-pg-undersized",
    friendlyName: "Undersized PGs",
    description:
      "Number of placement groups mapped to fewer OSDs than their configured replica count, per pool (pool_id label). Sustained non-zero values mean the cluster cannot restore full redundancy.",
    metricName: "ceph_pg_undersized",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Pool,
    unit: "count",
  },
  {
    id: "ceph-num-objects-degraded",
    friendlyName: "Degraded Objects",
    description:
      "Number of objects with fewer replicas than configured. Should trend to zero as recovery completes after an OSD failure.",
    metricName: "ceph_num_objects_degraded",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "ceph-num-objects-misplaced",
    friendlyName: "Misplaced Objects",
    description:
      "Number of objects not stored on their CRUSH-intended OSDs (data is safe, placement is wrong). Non-zero during rebalancing — should trend to zero.",
    metricName: "ceph_num_objects_misplaced",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: CephResourceScope.Cluster,
    unit: "count",
  },
];

export function getAllCephMetrics(): Array<CephMetricDefinition> {
  return cephMetricCatalog;
}

export function getCephMetricsByCategory(
  category: CephMetricCategory,
): Array<CephMetricDefinition> {
  return cephMetricCatalog.filter((m: CephMetricDefinition) => {
    return m.category === category;
  });
}

export function getCephMetricById(
  id: string,
): CephMetricDefinition | undefined {
  return cephMetricCatalog.find((m: CephMetricDefinition) => {
    return m.id === id;
  });
}

export function getCephMetricByMetricName(
  metricName: string,
): CephMetricDefinition | undefined {
  return cephMetricCatalog.find((m: CephMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllCephMetricCategories(): Array<CephMetricCategory> {
  return ["Cluster Health", "OSD", "Pool", "PG"];
}
