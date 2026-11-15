import { ProxmoxResourceScope } from "./MonitorStepProxmoxMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { translationKey } from "../Translator";

export type ProxmoxMetricCategory =
  | "Availability"
  | "Node"
  | "Guest"
  | "Storage"
  | "HA"
  | "Backup"
  | "Replication";

export interface ProxmoxMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: ProxmoxMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: ProxmoxResourceScope;
  unit?: string;
}

/*
 * Metric names follow the prometheus-pve-exporter naming scheme. Each series
 * carries an `id` datapoint label identifying the Proxmox resource it belongs
 * to: `node/<name>` for nodes, `qemu/<vmid>` for VMs, `lxc/<vmid>` for
 * containers, `storage/<node>/<storage>` for storage volumes, and
 * `cluster/<name>` for the cluster's own series (quorum, as `pve_up`, and the
 * backup total). The agent's OTTL transform additionally stamps `pve.scope`
 * (node | guest | storage | cluster), `pve.type` (node | qemu | lxc |
 * storage) and `pve.id` (the part after the first slash: `pve1/local` for a
 * storage) as datapoint attributes — `defaultResourceScope` is the
 * `pve.scope` value the metric is usually filtered to (Cluster = spans
 * multiple scopes; don't pre-filter).
 */
const proxmoxMetricCatalog: Array<ProxmoxMetricDefinition> = [
  // Availability Metrics
  {
    id: "pve-up",
    friendlyName: translationKey("Resource Up"),
    description: translationKey(
      "Whether a Proxmox resource is up (1) or down/stopped (0). Reported for nodes, guests and storage, and for the cluster itself (id cluster/<name>, 1 while it is quorate) — filter on pve.scope or the id label to scope.",
    ),
    metricName: "pve_up",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
  },
  {
    id: "pve-uptime-seconds",
    friendlyName: translationKey("Uptime"),
    description: translationKey(
      "How long a node or guest has been running. Drops to zero when the resource is stopped or rebooted.",
    ),
    metricName: "pve_uptime_seconds",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "seconds",
  },
  {
    id: "pve-version-info",
    friendlyName: translationKey("PVE Version Info"),
    description: translationKey(
      "Metadata series carrying the Proxmox VE release in its version/release labels (value is always 1).",
    ),
    metricName: "pve_version_info",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "count",
  },

  // Node Metrics
  {
    id: "pve-cpu-usage-ratio",
    friendlyName: translationKey("CPU Usage Ratio"),
    description: translationKey(
      "CPU usage as a ratio of available CPU (0 to 1, where 1 = all cores fully used). Reported for nodes and guests — filter on pve.scope to pick one.",
    ),
    metricName: "pve_cpu_usage_ratio",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: ProxmoxResourceScope.Node,
    unit: "ratio",
  },
  {
    id: "pve-cpu-usage-limit",
    friendlyName: translationKey("CPU Limit (Cores)"),
    description: translationKey(
      "Maximum CPU available to a node or guest, in cores. For guests this is the number of allocated vCPUs.",
    ),
    metricName: "pve_cpu_usage_limit",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Node,
    unit: "cores",
  },
  {
    id: "pve-memory-usage-bytes",
    friendlyName: translationKey("Memory Usage"),
    description: translationKey(
      "Memory currently in use by a node or guest. Compare against Memory Size to gauge memory pressure.",
    ),
    metricName: "pve_memory_usage_bytes",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: ProxmoxResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "pve-memory-size-bytes",
    friendlyName: translationKey("Memory Size"),
    description: translationKey(
      "Total memory available to a node or guest. For guests this is the configured memory allocation.",
    ),
    metricName: "pve_memory_size_bytes",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "pve-node-info",
    friendlyName: translationKey("Node Info"),
    description: translationKey(
      "Metadata series for each Proxmox node (value is always 1) carrying the node's name label: 1 while the node reports. The agent scrapes every 30 seconds, and a Sum adds every scrape in the minute, so it does not count nodes.",
    ),
    metricName: "pve_node_info",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Node,
    unit: "count",
  },

  // Guest Metrics
  {
    id: "pve-network-receive-bytes",
    friendlyName: translationKey("Network Received"),
    description: translationKey(
      "Cumulative bytes received over the network by a guest (VM or container). Chart as a rate to see throughput. Max reads its latest total.",
    ),
    metricName: "pve_network_receive_bytes",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Guest,
    unit: "bytes",
  },
  {
    id: "pve-network-transmit-bytes",
    friendlyName: translationKey("Network Transmitted"),
    description: translationKey(
      "Cumulative bytes transmitted over the network by a guest (VM or container). Chart as a rate to see throughput. Max reads its latest total.",
    ),
    metricName: "pve_network_transmit_bytes",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Guest,
    unit: "bytes",
  },
  {
    id: "pve-disk-read-bytes",
    friendlyName: translationKey("Disk Read"),
    description: translationKey(
      "Cumulative bytes read from disk by a guest (VM or container). Chart as a rate to see read throughput. Max reads its latest total.",
    ),
    metricName: "pve_disk_read_bytes",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Guest,
    unit: "bytes",
  },
  {
    id: "pve-disk-write-bytes",
    friendlyName: translationKey("Disk Write"),
    description: translationKey(
      "Cumulative bytes written to disk by a guest (VM or container). Chart as a rate to see write throughput. Max reads its latest total.",
    ),
    metricName: "pve_disk_write_bytes",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Guest,
    unit: "bytes",
  },
  {
    id: "pve-guest-info",
    friendlyName: translationKey("Guest Info"),
    description: translationKey(
      "Metadata series for each guest (value is always 1) carrying name, node, and type labels: 1 while the guest exists. A Sum adds every scrape in the minute, so it does not count guests.",
    ),
    metricName: "pve_guest_info",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Guest,
    unit: "count",
  },
  {
    id: "pve-lock-state",
    friendlyName: translationKey("Lock State"),
    description: translationKey(
      "The lock Proxmox holds on a guest while a backup, migration, snapshot or clone runs, as an enum-style series: one series per lock (backup, migrate, snapshot, suspended...) with value 1 for the one held. Filter on the state label.",
    ),
    metricName: "pve_lock_state",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Guest,
  },
  {
    id: "pve-onboot-status",
    friendlyName: translationKey("Start-on-Boot Status"),
    description: translationKey(
      "Whether a guest is configured to start on node boot (1) or not (0). A stopped guest with onboot=1 is usually unintended downtime.",
    ),
    metricName: "pve_onboot_status",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: ProxmoxResourceScope.Guest,
    unit: "count",
  },

  // Storage Metrics
  {
    id: "pve-disk-usage-bytes",
    friendlyName: translationKey("Disk Usage"),
    description: translationKey(
      "Disk space currently used. Reported for storage volumes, node root filesystems, and guest root disks — filter on pve.scope to pick one. For QEMU guests this reads 0 unless the QEMU guest agent is installed.",
    ),
    metricName: "pve_disk_usage_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: ProxmoxResourceScope.Storage,
    unit: "bytes",
  },
  {
    id: "pve-disk-size-bytes",
    friendlyName: translationKey("Disk Size"),
    description: translationKey(
      "Total disk space available on a storage volume, node root filesystem, or guest root disk.",
    ),
    metricName: "pve_disk_size_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Storage,
    unit: "bytes",
  },
  {
    id: "pve-storage-shared",
    friendlyName: translationKey("Shared Storage"),
    description: translationKey(
      "Whether every node of the cluster can use a storage (1) or only its own node (0).",
    ),
    metricName: "pve_storage_shared",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Storage,
    unit: "count",
  },
  {
    id: "pve-storage-info",
    friendlyName: translationKey("Storage Info"),
    description: translationKey(
      "Metadata series for each storage volume (value is always 1) carrying node and storage labels: 1 while the storage exists. A Sum adds every scrape in the minute, so it does not count storage volumes.",
    ),
    metricName: "pve_storage_info",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Storage,
    unit: "count",
  },

  // HA Metrics
  {
    id: "pve-ha-state",
    friendlyName: translationKey("HA State"),
    description: translationKey(
      "High-availability state of a node or guest as an enum-style series: one series per possible state (e.g. started, stopped, error) with value 1 for the current state. Filter on the state label to alert on specific states.",
    ),
    metricName: "pve_ha_state",
    category: "HA",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
  },

  /*
   * Backup Metrics — cluster-level backup-info collector (default-on).
   * These report backup-JOB coverage only: whether backups ran
   * recently or succeeded is not exposed by pve-exporter.
   */
  {
    id: "pve-not-backed-up-total",
    friendlyName: translationKey("Guests Without Backup"),
    description: translationKey(
      "Count of guests (VMs and containers) not covered by ANY backup job. A single cluster-level series, id cluster/<name>, reported at 0 too. Covers backup-job membership only — not whether backups ran recently or succeeded.",
    ),
    metricName: "pve_not_backed_up_total",
    category: "Backup",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "pve-not-backed-up-info",
    friendlyName: translationKey("Guest Without Backup Info"),
    description: translationKey(
      "Metadata series present for each guest NOT covered by any backup job (value is always 1), labeled only with the guest's id. Group by id to list the uncovered guests; the series disappears once the guest joins a backup job.",
    ),
    metricName: "pve_not_backed_up_info",
    category: "Backup",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "count",
  },

  /*
   * Replication Metrics — node-level replication collector
   * (default-on). Series carry the replication JOB id in the `id`
   * label (e.g. 100-0), not a node/qemu/lxc-prefixed resource id;
   * pve_replication_info additionally carries type, source, target
   * and guest labels.
   */
  {
    id: "pve-replication-failed-syncs",
    friendlyName: translationKey("Replication Failed Syncs"),
    description: translationKey(
      "Number of consecutive failed sync attempts for a storage replication job. Anything above 0 means the job's replica is going stale — group by id to alert per job.",
    ),
    metricName: "pve_replication_failed_syncs",
    category: "Replication",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "pve-replication-duration-seconds",
    friendlyName: translationKey("Replication Duration"),
    description: translationKey(
      "How long a replication job's last sync took. A rising duration usually means growing deltas or a slow/congested target.",
    ),
    metricName: "pve_replication_duration_seconds",
    category: "Replication",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "seconds",
  },
  {
    id: "pve-replication-last-sync-timestamp-seconds",
    friendlyName: translationKey("Replication Last Sync"),
    description: translationKey(
      "Unix timestamp of a replication job's last SUCCESSFUL sync. Compare against the current time to gauge replica staleness (the criteria engine has no wall-clock math, so staleness is a chart/UI concern, not an alert).",
    ),
    metricName: "pve_replication_last_sync_timestamp_seconds",
    category: "Replication",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "seconds",
  },
  {
    id: "pve-replication-last-try-timestamp-seconds",
    friendlyName: translationKey("Replication Last Try"),
    description: translationKey(
      "Unix timestamp of a replication job's last sync ATTEMPT. A last-try newer than last-sync means the most recent attempt failed.",
    ),
    metricName: "pve_replication_last_try_timestamp_seconds",
    category: "Replication",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "seconds",
  },
  {
    id: "pve-replication-next-sync-timestamp-seconds",
    friendlyName: translationKey("Replication Next Sync"),
    description: translationKey(
      "Unix timestamp of a replication job's next scheduled sync.",
    ),
    metricName: "pve_replication_next_sync_timestamp_seconds",
    category: "Replication",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "seconds",
  },
  {
    id: "pve-replication-info",
    friendlyName: translationKey("Replication Info"),
    description: translationKey(
      "Metadata series for each storage replication job (value is always 1) carrying type, source, target and guest labels: 1 while the job exists. Join its labels to map a job id to the guest and node pair it replicates.",
    ),
    metricName: "pve_replication_info",
    category: "Replication",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: ProxmoxResourceScope.Cluster,
    unit: "count",
  },
];

export function getAllProxmoxMetrics(): Array<ProxmoxMetricDefinition> {
  return proxmoxMetricCatalog;
}

export function getProxmoxMetricsByCategory(
  category: ProxmoxMetricCategory,
): Array<ProxmoxMetricDefinition> {
  return proxmoxMetricCatalog.filter((m: ProxmoxMetricDefinition) => {
    return m.category === category;
  });
}

export function getProxmoxMetricById(
  id: string,
): ProxmoxMetricDefinition | undefined {
  return proxmoxMetricCatalog.find((m: ProxmoxMetricDefinition) => {
    return m.id === id;
  });
}

export function getProxmoxMetricByMetricName(
  metricName: string,
): ProxmoxMetricDefinition | undefined {
  return proxmoxMetricCatalog.find((m: ProxmoxMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllProxmoxMetricCategories(): Array<ProxmoxMetricCategory> {
  return [
    "Availability",
    "Node",
    "Guest",
    "Storage",
    "HA",
    "Backup",
    "Replication",
  ];
}

/*
 * Each group's heading in the metric picker, a key: a category is the value
 * the catalog's metrics name, so the picker looks its heading up here, once
 * (#8653).
 */
const categoryLabels: Record<ProxmoxMetricCategory, string> = {
  Availability: translationKey("Availability"),
  Node: translationKey("Node"),
  Guest: translationKey("Guest"),
  Storage: translationKey("Storage"),
  HA: translationKey("HA"),
  Backup: translationKey("Backup"),
  Replication: translationKey("Replication"),
};

export function getProxmoxMetricCategoryLabel(
  category: ProxmoxMetricCategory,
): string {
  return categoryLabels[category] || category;
}
