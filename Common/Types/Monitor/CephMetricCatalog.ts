import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type CephMetricCategory = "Cluster Health" | "OSD" | "Pool" | "PG";

export interface CephMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: CephMetricCategory;
  defaultAggregation: MetricsAggregationType;
  unit?: string;
}

/*
 * Metric names follow the ceph-mgr Prometheus module naming scheme.
 * Per-daemon series carry a `ceph_daemon` datapoint label (e.g. "osd.3",
 * "mon.a"); per-pool series carry a `pool_id` label (join against
 * `ceph_pool_metadata` for the pool name).
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
  },
  {
    id: "ceph-mon-quorum-status",
    friendlyName: "Monitor Quorum Status",
    description:
      "Whether each Ceph monitor daemon is in quorum (1) or not (0). One series per monitor — sum to count members in quorum, or take the minimum to detect any monitor out of quorum.",
    metricName: "ceph_mon_quorum_status",
    category: "Cluster Health",
    defaultAggregation: MetricsAggregationType.Sum,
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
    unit: "bytes",
  },
  {
    id: "ceph-pool-objects",
    friendlyName: "Pool Object Count",
    description: "Number of objects stored in each pool.",
    metricName: "ceph_pool_objects",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "count",
  },
  {
    id: "ceph-pool-rd",
    friendlyName: "Pool Read Operations",
    description: "Cumulative read operations served by each pool.",
    metricName: "ceph_pool_rd",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "ops",
  },
  {
    id: "ceph-pool-wr",
    friendlyName: "Pool Write Operations",
    description: "Cumulative write operations served by each pool.",
    metricName: "ceph_pool_wr",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "ops",
  },
  {
    id: "ceph-pool-rd-bytes",
    friendlyName: "Pool Read Throughput",
    description: "Cumulative bytes read from each pool.",
    metricName: "ceph_pool_rd_bytes",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "ceph-pool-wr-bytes",
    friendlyName: "Pool Write Throughput",
    description: "Cumulative bytes written to each pool.",
    metricName: "ceph_pool_wr_bytes",
    category: "Pool",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },

  // PG (Placement Group) Metrics
  {
    id: "ceph-pg-active",
    friendlyName: "Active PGs",
    description:
      "Number of placement groups in the active state (able to serve I/O). In a healthy cluster this equals the total PG count.",
    metricName: "ceph_pg_active",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "count",
  },
  {
    id: "ceph-pg-degraded",
    friendlyName: "Degraded PGs",
    description:
      "Number of placement groups with fewer data replicas than configured. Non-zero values mean redundancy is reduced — typically after an OSD failure.",
    metricName: "ceph_pg_degraded",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "count",
  },
  {
    id: "ceph-pg-undersized",
    friendlyName: "Undersized PGs",
    description:
      "Number of placement groups mapped to fewer OSDs than their configured replica count. Sustained non-zero values mean the cluster cannot restore full redundancy.",
    metricName: "ceph_pg_undersized",
    category: "PG",
    defaultAggregation: MetricsAggregationType.Max,
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
