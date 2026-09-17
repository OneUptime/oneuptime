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
}

/*
 * These are the real OpenTelemetry host metrics emitted by the OneUptime
 * Infrastructure Agent's hostmetrics receiver (the Hosts product). The
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
      "Host CPU utilization as a ratio (0 to 1). 1.0 = all cores fully busy.",
    metricName: "system.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
  },
  {
    id: "process-cpu-utilization",
    friendlyName: "Process CPU Utilization",
    description:
      "Per-process CPU utilization as a ratio (0 to 1) for processes running on the host.",
    metricName: "process.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "ratio",
  },

  // Memory Metrics
  {
    id: "system-memory-utilization",
    friendlyName: "Memory Utilization",
    description:
      "Host memory utilization as a ratio (0 to 1) of total physical memory in use.",
    metricName: "system.memory.utilization",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ratio",
  },
  {
    id: "system-memory-usage",
    friendlyName: "Memory Usage",
    description: "Host memory usage in bytes.",
    metricName: "system.memory.usage",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },

  // Disk / Filesystem Metrics
  {
    id: "system-filesystem-utilization",
    friendlyName: "Filesystem Utilization",
    description:
      "Filesystem utilization as a ratio (0 to 1) of total disk capacity in use.",
    metricName: "system.filesystem.utilization",
    category: "Disk",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "ratio",
  },
  {
    id: "system-filesystem-usage",
    friendlyName: "Filesystem Usage",
    description: "Filesystem usage in bytes.",
    metricName: "system.filesystem.usage",
    category: "Disk",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },

  // Network Metrics
  {
    id: "system-network-io",
    friendlyName: "Network I/O",
    description:
      "Cumulative network bytes transferred (received + transmitted) by the host.",
    metricName: "system.network.io",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
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
