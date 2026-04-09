import MetricsAggregationType from "../Metrics/MetricsAggregationType";

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
}

const dockerMetricCatalog: Array<DockerMetricDefinition> = [
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
    id: "container-cpu-percent",
    friendlyName: "Container CPU Percent",
    description: "CPU usage percentage of the container",
    metricName: "container.cpu.percent",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },
  {
    id: "container-cpu-usage-percpu",
    friendlyName: "Container CPU Usage (Per Core)",
    description: "Per-core CPU usage of the container",
    metricName: "container.cpu.usage.percpu",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "ns",
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
  {
    id: "container-memory-rss",
    friendlyName: "Container Memory RSS",
    description: "Resident set size (non-swapped physical memory) used",
    metricName: "container.memory.rss",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },
  {
    id: "container-memory-cache",
    friendlyName: "Container Memory Cache",
    description: "Amount of memory used as page cache",
    metricName: "container.memory.cache",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
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
  {
    id: "container-network-rx-packets",
    friendlyName: "Container Network Packets Received",
    description: "Packets received over the network by the container",
    metricName: "container.network.io.usage.rx_packets",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "count",
  },
  {
    id: "container-network-tx-packets",
    friendlyName: "Container Network Packets Transmitted",
    description: "Packets transmitted over the network by the container",
    metricName: "container.network.io.usage.tx_packets",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "count",
  },

  // Block I/O Metrics
  {
    id: "container-blockio-read",
    friendlyName: "Container Block I/O Read",
    description: "Bytes read from block devices by the container",
    metricName: "container.blockio.io_service_bytes_recursive.read",
    category: "BlockIO",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "container-blockio-write",
    friendlyName: "Container Block I/O Write",
    description: "Bytes written to block devices by the container",
    metricName: "container.blockio.io_service_bytes_recursive.write",
    category: "BlockIO",
    defaultAggregation: MetricsAggregationType.Sum,
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
  {
    id: "container-pids-count",
    friendlyName: "Container Process Count",
    description: "Number of processes running inside the container",
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
