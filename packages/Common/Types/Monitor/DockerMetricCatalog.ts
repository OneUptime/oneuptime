import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { translationKey } from "../Translator";

export type DockerMetricCategory =
  | "CPU"
  | "Memory"
  | "Network"
  | "BlockIO"
  | "Container";

export interface DockerMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: DockerMetricCategory;
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
 * Only what the shipped Docker Agent sends
 * (agents/DockerAgent/otel-collector-config.yaml). The docker_stats
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

const dockerMetricCatalog: Array<DockerMetricDefinition> = [
  // CPU Metrics
  {
    id: "container-cpu-usage-total",
    friendlyName: translationKey("Container CPU Usage (Total)"),
    description: translationKey("Total CPU time consumed by the container"),
    metricName: "container.cpu.usage.total",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ns",
  },
  {
    id: "container-cpu-utilization",
    friendlyName: translationKey("Container CPU Utilization"),
    description: translationKey(
      "CPU utilization of the container as a percentage (100% = 1 full CPU core)",
    ),
    metricName: "container.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },
  {
    id: "container-cpu-throttled-time",
    friendlyName: translationKey("Container CPU Throttled Time"),
    description: translationKey(
      "Total time the container CPU has been throttled",
    ),
    metricName: "container.cpu.throttling_data.throttled_time",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "ns",
  },

  // Memory Metrics
  {
    id: "container-memory-usage-total",
    friendlyName: translationKey("Container Memory Usage"),
    description: translationKey("Total memory usage of the container"),
    metricName: "container.memory.usage.total",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },
  {
    id: "container-memory-usage-limit",
    friendlyName: translationKey("Container Memory Limit"),
    description: translationKey("Memory limit configured for the container"),
    metricName: "container.memory.usage.limit",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },
  {
    id: "container-memory-percent",
    friendlyName: translationKey("Container Memory Percent"),
    description: translationKey(
      "Memory usage as a percentage of the container limit or host total",
    ),
    metricName: "container.memory.percent",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },

  // Network Metrics
  {
    id: "container-network-rx-bytes",
    friendlyName: translationKey("Container Network Received"),
    description: translationKey(
      "Bytes received over the network by the container",
    ),
    metricName: "container.network.io.usage.rx_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "container-network-tx-bytes",
    friendlyName: translationKey("Container Network Transmitted"),
    description: translationKey(
      "Bytes transmitted over the network by the container",
    ),
    metricName: "container.network.io.usage.tx_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },

  // Block I/O Metrics
  {
    id: "container-blockio-read",
    friendlyName: translationKey("Container Block I/O Read"),
    description: translationKey(
      "Bytes the container has read from each block device since it started. A lifetime counter, per device: chart it as a rate.",
    ),
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
    friendlyName: translationKey("Container Block I/O Write"),
    description: translationKey(
      "Bytes the container has written to each block device since it started. A lifetime counter, per device: chart it as a rate.",
    ),
    metricName: "container.blockio.io_service_bytes_recursive",
    attributes: { operation: "write" },
    category: "BlockIO",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "bytes",
  },

  // Container Info Metrics
  {
    id: "container-uptime",
    friendlyName: translationKey("Container Uptime"),
    description: translationKey("How long the container has been running"),
    metricName: "container.uptime",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "seconds",
  },
  {
    id: "container-restarts",
    friendlyName: translationKey("Container Restarts"),
    description: translationKey("Number of times the container has restarted"),
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
    friendlyName: translationKey("Container Restarts (Increase)"),
    description: translationKey(
      "Restarts since the agent's previous sample of the container. Their sum over a window is the restarts in it.",
    ),
    metricName: "container.restarts.increase",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "count",
  },
  {
    id: "container-pids-count",
    friendlyName: translationKey("Container Process Count"),
    description: translationKey(
      "Tasks in the container: processes and their threads, as the cgroup pids controller counts them.",
    ),
    metricName: "container.pids.count",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
];

export function getAllDockerMetrics(): Array<DockerMetricDefinition> {
  return dockerMetricCatalog;
}

export function getDockerMetricsByCategory(
  category: DockerMetricCategory,
): Array<DockerMetricDefinition> {
  return dockerMetricCatalog.filter((m: DockerMetricDefinition) => {
    return m.category === category;
  });
}

export function getDockerMetricById(
  id: string,
): DockerMetricDefinition | undefined {
  return dockerMetricCatalog.find((m: DockerMetricDefinition) => {
    return m.id === id;
  });
}

export function getDockerMetricByMetricName(
  metricName: string,
): DockerMetricDefinition | undefined {
  return dockerMetricCatalog.find((m: DockerMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllDockerMetricCategories(): Array<DockerMetricCategory> {
  return ["CPU", "Memory", "Network", "BlockIO", "Container"];
}

/*
 * Each group's heading in the metric picker, a key: a category is an
 * identifier the catalog's metrics name, so the picker looks its heading up
 * here, once (#8353).
 */
const categoryLabels: Record<DockerMetricCategory, string> = {
  CPU: translationKey("CPU"),
  Memory: translationKey("Memory"),
  Network: translationKey("Network"),
  BlockIO: translationKey("Block I/O"),
  Container: translationKey("Container"),
};

export function getDockerMetricCategoryLabel(
  category: DockerMetricCategory,
): string {
  return categoryLabels[category] || category;
}
