import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { translationKey } from "../Translator";

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
   * CPU utilization the `user` state, filesystems give one series per mount
   * and processes one per status. CPU is never one series per state: idle,
   * at 0.95 on a quiet host, would pass any threshold set for busy time.
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
    friendlyName: translationKey("CPU Utilization"),
    description: translationKey(
      "Share of CPU time spent running applications (the user state), as a ratio (0 to 1). The High CPU Utilization template adds system time.",
    ),
    metricName: "system.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
    attributes: { state: "user" },
  },
  {
    id: "process-cpu-utilization",
    friendlyName: translationKey("Process CPU Utilization"),
    description: translationKey(
      "CPU utilization of each process on the host, as a ratio (0 to 1), one series per executable.",
    ),
    metricName: "process.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "ratio",
    groupByAttributeKeys: ["resource.process.executable.name"],
  },

  // Memory Metrics
  {
    id: "system-memory-utilization",
    friendlyName: translationKey("Memory Utilization"),
    description: translationKey(
      "Share of physical memory in use, as a ratio (0 to 1). Page cache and buffers are left out.",
    ),
    metricName: "system.memory.utilization",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
    attributes: { state: "used" },
  },
  {
    id: "system-memory-usage",
    friendlyName: translationKey("Memory Usage"),
    description: translationKey(
      "Memory in use, in bytes. Page cache and buffers are left out.",
    ),
    metricName: "system.memory.usage",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
    attributes: { state: "used" },
  },

  // Disk / Filesystem Metrics
  {
    id: "system-filesystem-utilization",
    friendlyName: translationKey("Filesystem Utilization"),
    description: translationKey(
      "Share of each filesystem in use, as a ratio (0 to 1), one series per mount point.",
    ),
    metricName: "system.filesystem.utilization",
    category: "Disk",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "ratio",
    groupByAttributeKeys: ["mountpoint"],
  },
  {
    id: "system-filesystem-usage",
    friendlyName: translationKey("Filesystem Usage"),
    description: translationKey(
      "Bytes in use on each filesystem, one series per mount point.",
    ),
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
    friendlyName: translationKey("Network I/O"),
    description: translationKey(
      "Bytes received and sent since the host started, one series per direction. A lifetime counter: it only grows.",
    ),
    metricName: "system.network.io",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
    groupByAttributeKeys: ["direction"],
  },

  // Load Average Metrics
  {
    id: "system-cpu-load-average-1m",
    friendlyName: translationKey("Load Average (1m)"),
    description: translationKey(
      "Host CPU load average over the last 1 minute.",
    ),
    metricName: "system.cpu.load_average.1m",
    category: "Load",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
  {
    id: "system-cpu-load-average-5m",
    friendlyName: translationKey("Load Average (5m)"),
    description: translationKey(
      "Host CPU load average over the last 5 minutes.",
    ),
    metricName: "system.cpu.load_average.5m",
    category: "Load",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
  {
    id: "system-cpu-load-average-15m",
    friendlyName: translationKey("Load Average (15m)"),
    description: translationKey(
      "Host CPU load average over the last 15 minutes.",
    ),
    metricName: "system.cpu.load_average.15m",
    category: "Load",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },

  // Process Metrics
  {
    id: "system-processes-count",
    friendlyName: translationKey("Process Count"),
    description: translationKey(
      "Number of processes on the host, one series per status (running, sleeping, blocked...).",
    ),
    metricName: "system.processes.count",
    category: "Processes",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
    groupByAttributeKeys: ["status"],
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

/*
 * Each group's heading in the metric picker, a key: a category is an
 * identifier the catalog's metrics name, so the picker looks its heading up
 * here, once (#8353).
 */
const categoryLabels: Record<HostMetricCategory, string> = {
  CPU: translationKey("CPU"),
  Memory: translationKey("Memory"),
  Disk: translationKey("Disk"),
  Network: translationKey("Network"),
  Load: translationKey("Load Average"),
  Processes: translationKey("Processes"),
};

export function getHostMetricCategoryLabel(
  category: HostMetricCategory,
): string {
  return categoryLabels[category] || category;
}
