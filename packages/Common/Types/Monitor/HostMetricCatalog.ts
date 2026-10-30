import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type HostMetricCategory =
  | "CPU"
  | "Memory"
  | "Disk"
  | "Network"
  | "Load"
  | "Processes";

export interface HostMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: HostMetricCategory;
  defaultAggregation: MetricsAggregationType;
  unit?: string;
  /*
   * What makes the metric mean something on its own, as Custom Metric
   * builds its query. The hostmetrics receiver splits most of these by
   * `state` (CPU by user/system/idle..., memory by used/free/cached...), so
   * a query over every state reads 1/N of the total and never crosses a
   * useful threshold: memory and filesystem usage count the `used` state,
   * CPU utilization gives one series per state, filesystems one per mount.
   */
  attributes?: Record<string, string> | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}

/*
 * These are the real OpenTelemetry host metrics an OpenTelemetry Collector's
 * hostmetrics receiver sends from a host (the Hosts product). The
 * utilization metrics (system.cpu.utilization, system.memory.utilization,
 * system.filesystem.utilization) are reported as a [0, 1] ratio by the OTel
 * host receiver, so the friendly unit is "ratio" — the dashboard auto-scales
 * these to percent at render time.
 */
const hostMetricCatalog: Array<HostMetricDefinition> = [
  // CPU Metrics
  {
    id: "system-cpu-utilization",
    friendlyName: "CPU Utilization",
    description:
      "Share of CPU time in each state (user, system, iowait, idle...), as a ratio (0 to 1), one series per state: 0.8 fires when any one state passes 80%.",
    metricName: "system.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
    groupByAttributeKeys: ["state"],
  },
  {
    id: "process-cpu-utilization",
    friendlyName: "Process CPU Utilization",
    description:
      "CPU utilization of each process on the host, as a ratio (0 to 1), one series per executable.",
    metricName: "process.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "ratio",
    groupByAttributeKeys: ["resource.process.executable.name"],
  },

  // Memory Metrics
  {
    id: "system-memory-utilization",
    friendlyName: "Memory Utilization",
    description:
      "Share of physical memory in use, as a ratio (0 to 1). Page cache and buffers are left out.",
    metricName: "system.memory.utilization",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
    attributes: { state: "used" },
  },
  {
    id: "system-memory-usage",
    friendlyName: "Memory Usage",
    description:
      "Memory in use, in bytes. Page cache and buffers are left out.",
    metricName: "system.memory.usage",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
    attributes: { state: "used" },
  },

  // Disk / Filesystem Metrics
  {
    id: "system-filesystem-utilization",
    friendlyName: "Filesystem Utilization",
    description:
      "Share of each filesystem in use, as a ratio (0 to 1), one series per mount point.",
    metricName: "system.filesystem.utilization",
    category: "Disk",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "ratio",
    groupByAttributeKeys: ["mountpoint"],
  },
  {
    id: "system-filesystem-usage",
    friendlyName: "Filesystem Usage",
    description: "Bytes in use on each filesystem, one series per mount point.",
    metricName: "system.filesystem.usage",
    category: "Disk",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
    attributes: { state: "used" },
    groupByAttributeKeys: ["mountpoint"],
  },

  // Network Metrics
  {
    id: "system-network-io",
    friendlyName: "Network I/O",
    description:
      "Bytes received and sent since the host started, one series per direction. A lifetime counter: it only grows.",
    metricName: "system.network.io",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
    groupByAttributeKeys: ["direction"],
  },

  // Load Average Metrics
  {
    id: "system-cpu-load-average-1m",
    friendlyName: "Load Average (1m)",
    description: "Host CPU load average over the last 1 minute.",
    metricName: "system.cpu.load_average.1m",
    category: "Load",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
  {
    id: "system-cpu-load-average-5m",
    friendlyName: "Load Average (5m)",
    description: "Host CPU load average over the last 5 minutes.",
    metricName: "system.cpu.load_average.5m",
    category: "Load",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
  {
    id: "system-cpu-load-average-15m",
    friendlyName: "Load Average (15m)",
    description: "Host CPU load average over the last 15 minutes.",
    metricName: "system.cpu.load_average.15m",
    category: "Load",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },

  // Process Metrics
  {
    id: "system-processes-count",
    friendlyName: "Process Count",
    description: "Number of processes running on the host.",
    metricName: "system.processes.count",
    category: "Processes",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
];

export function getAllHostMetrics(): Array<HostMetricDefinition> {
  return hostMetricCatalog;
}

export function getHostMetricsByCategory(
  category: HostMetricCategory,
): Array<HostMetricDefinition> {
  return hostMetricCatalog.filter((m: HostMetricDefinition) => {
    return m.category === category;
  });
}

export function getHostMetricById(
  id: string,
): HostMetricDefinition | undefined {
  return hostMetricCatalog.find((m: HostMetricDefinition) => {
    return m.id === id;
  });
}

export function getHostMetricByMetricName(
  metricName: string,
): HostMetricDefinition | undefined {
  return hostMetricCatalog.find((m: HostMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllHostMetricCategories(): Array<HostMetricCategory> {
  return ["CPU", "Memory", "Disk", "Network", "Load", "Processes"];
}
