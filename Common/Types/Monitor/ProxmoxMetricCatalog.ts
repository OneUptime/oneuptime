import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type ProxmoxMetricCategory =
  | "Availability"
  | "Node"
  | "Guest"
  | "Storage"
  | "HA";

export interface ProxmoxMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: ProxmoxMetricCategory;
  defaultAggregation: MetricsAggregationType;
  unit?: string;
}

/*
 * Metric names follow the prometheus-pve-exporter naming scheme. Each series
 * carries an `id` datapoint label identifying the Proxmox resource it belongs
 * to: `node/<name>` for nodes, `qemu/<vmid>` for VMs, `lxc/<vmid>` for
 * containers, and `storage/<node>/<storage>` for storage volumes.
 */
const proxmoxMetricCatalog: Array<ProxmoxMetricDefinition> = [
  // Availability Metrics
  {
    id: "pve-up",
    friendlyName: "Resource Up",
    description:
      "Whether a Proxmox resource is up (1) or down/stopped (0). Reported for nodes and guests — use the id label (e.g. node/pve1, qemu/100) to scope to a specific resource.",
    metricName: "pve_up",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
  },
  {
    id: "pve-uptime-seconds",
    friendlyName: "Uptime",
    description:
      "How long a node or guest has been running. Drops to zero when the resource is stopped or rebooted.",
    metricName: "pve_uptime_seconds",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "seconds",
  },

  // Node Metrics
  {
    id: "pve-cpu-usage-ratio",
    friendlyName: "CPU Usage Ratio",
    description:
      "CPU usage as a ratio of available CPU (0 to 1, where 1 = all cores fully used). Reported for nodes and guests — use the id label to scope.",
    metricName: "pve_cpu_usage_ratio",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
  },
  {
    id: "pve-cpu-usage-limit",
    friendlyName: "CPU Limit (Cores)",
    description:
      "Maximum CPU available to a node or guest, in cores. For guests this is the number of allocated vCPUs.",
    metricName: "pve_cpu_usage_limit",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "cores",
  },
  {
    id: "pve-memory-usage-bytes",
    friendlyName: "Memory Usage",
    description:
      "Memory currently in use by a node or guest. Compare against Memory Size to gauge memory pressure.",
    metricName: "pve_memory_usage_bytes",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },
  {
    id: "pve-memory-size-bytes",
    friendlyName: "Memory Size",
    description:
      "Total memory available to a node or guest. For guests this is the configured memory allocation.",
    metricName: "pve_memory_size_bytes",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },
  {
    id: "pve-node-info",
    friendlyName: "Node Info",
    description:
      "Metadata series for each Proxmox node (value is always 1). Sum it to count the nodes reporting in the cluster.",
    metricName: "pve_node_info",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "count",
  },

  // Guest Metrics
  {
    id: "pve-network-receive-bytes",
    friendlyName: "Network Received",
    description:
      "Cumulative bytes received over the network by a guest (VM or container).",
    metricName: "pve_network_receive_bytes",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "pve-network-transmit-bytes",
    friendlyName: "Network Transmitted",
    description:
      "Cumulative bytes transmitted over the network by a guest (VM or container).",
    metricName: "pve_network_transmit_bytes",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "pve-guest-info",
    friendlyName: "Guest Info",
    description:
      "Metadata series for each guest (value is always 1) carrying name, node, and type labels. Sum it to count guests in the cluster.",
    metricName: "pve_guest_info",
    category: "Guest",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "count",
  },

  // Storage Metrics
  {
    id: "pve-disk-usage-bytes",
    friendlyName: "Disk Usage",
    description:
      "Disk space currently used. Reported for storage volumes, node root filesystems, and guest root disks — use the id label to scope.",
    metricName: "pve_disk_usage_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },
  {
    id: "pve-disk-size-bytes",
    friendlyName: "Disk Size",
    description:
      "Total disk space available on a storage volume, node root filesystem, or guest root disk.",
    metricName: "pve_disk_size_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },

  // HA Metrics
  {
    id: "pve-ha-state",
    friendlyName: "HA State",
    description:
      "High-availability state of a node or guest as an enum-style series: one series per possible state (e.g. started, stopped, error) with value 1 for the current state. Filter on the state label to alert on specific states.",
    metricName: "pve_ha_state",
    category: "HA",
    defaultAggregation: MetricsAggregationType.Max,
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
  return ["Availability", "Node", "Guest", "Storage", "HA"];
}
