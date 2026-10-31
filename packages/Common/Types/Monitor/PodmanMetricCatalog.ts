import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type PodmanMetricCategory =
  | "CPU"
  | "Memory"
  | "Network"
  | "BlockIO"
  | "Container";

export interface PodmanMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: PodmanMetricCategory;
  defaultAggregation: MetricsAggregationType;
  unit?: string;
  /*
   * Datapoint attributes a query must filter on for the entry to mean what
   * its name says. The receiver reports block I/O as ONE metric split by an
   * `operation` attribute, so "Block I/O Read" is that metric filtered to
   * `operation = read`. Unset: the metric as it is.
   */
  attributes?: Record<string, string> | undefined;
}

/*
 * Only what the shipped Podman Agent sends
 * (agents/PodmanAgent/otel-collector-config.yaml). The docker_stats
 * receiver's optional metrics stay off there - per-core CPU
 * (container.cpu.usage.percpu), container.memory.rss and
 * container.memory.cache (cgroup v1 only, too) and the network packet
 * counters - and there is no `container.blockio.io_service_bytes_recursive
 * .read` / `.write`: the receiver emits one
 * container.blockio.io_service_bytes_recursive, with an `operation`
 * attribute (lower-cased: `read`, `write`) and the device's major/minor
 * numbers. An entry for a metric that never arrives is a monitor that
 * never fires.
 */

const podmanMetricCatalog: Array<PodmanMetricDefinition> = [
  // CPU Metrics
  {
    id: "container-cpu-usage-total",
    friendlyName: "Container CPU Usage (Total)",
    description: "Total CPU time consumed by the container",
    metricName: "container.cpu.usage.total",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ns",
  },
  {
    id: "container-cpu-utilization",
    friendlyName: "Container CPU Utilization",
    description:
      "CPU utilization of the container as a percentage (100% = 1 full CPU core)",
    metricName: "container.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },
  {
    id: "container-cpu-throttled-time",
    friendlyName: "Container CPU Throttled Time",
    description: "Total time the container CPU has been throttled",
    metricName: "container.cpu.throttling_data.throttled_time",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "ns",
  },

  // Memory Metrics
  {
    id: "container-memory-usage-total",
    friendlyName: "Container Memory Usage",
    description: "Total memory usage of the container",
    metricName: "container.memory.usage.total",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },
  {
    id: "container-memory-usage-limit",
    friendlyName: "Container Memory Limit",
    description: "Memory limit configured for the container",
    metricName: "container.memory.usage.limit",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },
  {
    id: "container-memory-percent",
    friendlyName: "Container Memory Percent",
    description:
      "Memory usage as a percentage of the container limit or host total",
    metricName: "container.memory.percent",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },

  // Network Metrics
  {
    id: "container-network-rx-bytes",
    friendlyName: "Container Network Received",
    description: "Bytes received over the network by the container",
    metricName: "container.network.io.usage.rx_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "container-network-tx-bytes",
    friendlyName: "Container Network Transmitted",
    description: "Bytes transmitted over the network by the container",
    metricName: "container.network.io.usage.tx_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },

  // Block I/O Metrics
  {
    id: "container-blockio-read",
    friendlyName: "Container Block I/O Read",
    description:
      "Bytes the container has read from each block device since it started. A lifetime counter, per device: chart it as a rate.",
    metricName: "container.blockio.io_service_bytes_recursive",
    attributes: { operation: "read" },
    category: "BlockIO",
    /*
     * Max, not Sum: a minute's rows are the same lifetime total sampled
     * twice (and once per device), so a Sum doubles it.
     */
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },
  {
    id: "container-blockio-write",
    friendlyName: "Container Block I/O Write",
    description:
      "Bytes the container has written to each block device since it started. A lifetime counter, per device: chart it as a rate.",
    metricName: "container.blockio.io_service_bytes_recursive",
    attributes: { operation: "write" },
    category: "BlockIO",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },

  // Container Info Metrics
  {
    id: "container-uptime",
    friendlyName: "Container Uptime",
    description: "How long the container has been running",
    metricName: "container.uptime",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "seconds",
  },
  {
    id: "container-restarts",
    friendlyName: "Container Restarts",
    description: "Number of times the container has restarted",
    metricName: "container.restarts",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "count",
  },
  /*
   * What to alert on for restarts: the agent sends, with each sample, the
   * restarts since its previous sample of the container
   * (cumulative_to_delta/restarts-increase in the agent's config), so their
   * Sum over a window is the restarts in it. container.restarts above is
   * the lifetime count, for the charts.
   */
  {
    id: "container-restarts-increase",
    friendlyName: "Container Restarts (Increase)",
    description:
      "Restarts since the agent's previous sample of the container. Their sum over a window is the restarts in it.",
    metricName: "container.restarts.increase",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "count",
  },
  {
    id: "container-pids-count",
    friendlyName: "Container Process Count",
    description:
      "Tasks in the container: processes and their threads, as the cgroup pids controller counts them.",
    metricName: "container.pids.count",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
];

export function getAllPodmanMetrics(): Array<PodmanMetricDefinition> {
  return podmanMetricCatalog;
}

export function getPodmanMetricsByCategory(
  category: PodmanMetricCategory,
): Array<PodmanMetricDefinition> {
  return podmanMetricCatalog.filter((m: PodmanMetricDefinition) => {
    return m.category === category;
  });
}

export function getPodmanMetricById(
  id: string,
): PodmanMetricDefinition | undefined {
  return podmanMetricCatalog.find((m: PodmanMetricDefinition) => {
    return m.id === id;
  });
}

export function getPodmanMetricByMetricName(
  metricName: string,
): PodmanMetricDefinition | undefined {
  return podmanMetricCatalog.find((m: PodmanMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllPodmanMetricCategories(): Array<PodmanMetricCategory> {
  return ["CPU", "Memory", "Network", "BlockIO", "Container"];
}
