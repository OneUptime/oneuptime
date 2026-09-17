import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type DockerSwarmMetricCategory =
  | "CPU"
  | "Memory"
  | "Network"
  | "Container";

export interface DockerSwarmMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: DockerSwarmMetricCategory;
  defaultAggregation: MetricsAggregationType;
  unit?: string;
}

/*
 * Metric names follow the OpenTelemetry docker_stats receiver naming
 * scheme. The OneUptime Docker Swarm Agent runs the docker_stats receiver
 * against the Swarm manager node, so the series that actually arrive are
 * the standard `container.*` container-runtime metrics — there are NO
 * `docker_swarm_*` or `pve_*` metrics. Each datapoint carries the owning
 * container's identity labels (`container.name`,
 * `container.image.name`); for a Swarm service task the container name is
 * `<service>.<slot>.<taskid>`. The whole batch is scoped by the
 * `docker.swarm.cluster.name` resource attribute the agent stamps.
 */
const dockerSwarmMetricCatalog: Array<DockerSwarmMetricDefinition> = [
  // CPU Metrics
  {
    id: "container-cpu-utilization",
    friendlyName: "Container CPU Utilization",
    description:
      "CPU utilization of a Swarm task's container as a percentage (100% = one full CPU core).",
    metricName: "container.cpu.utilization",
    category: "CPU",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },

  // Memory Metrics
  {
    id: "container-memory-usage-total",
    friendlyName: "Container Memory Usage",
    description: "Total memory usage of a Swarm task's container.",
    metricName: "container.memory.usage.total",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "bytes",
  },
  {
    id: "container-memory-percent",
    friendlyName: "Container Memory Percent",
    description:
      "Memory usage of a Swarm task's container as a percentage of its limit or the host total.",
    metricName: "container.memory.percent",
    category: "Memory",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "%",
  },

  // Network Metrics
  {
    id: "container-network-rx-bytes",
    friendlyName: "Container Network Received",
    description:
      "Bytes received over the network by a Swarm task's container. Chart as a rate to see throughput.",
    metricName: "container.network.io.usage.rx_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },
  {
    id: "container-network-tx-bytes",
    friendlyName: "Container Network Transmitted",
    description:
      "Bytes transmitted over the network by a Swarm task's container. Chart as a rate to see throughput.",
    metricName: "container.network.io.usage.tx_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Sum,
    unit: "bytes",
  },

  // Container Info Metrics
  {
    id: "container-pids-count",
    friendlyName: "Container Process Count",
    description:
      "Number of processes running inside a Swarm task's container. A sudden spike can indicate a fork bomb or resource leak.",
    metricName: "container.pids.count",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
  {
    id: "container-uptime",
    friendlyName: "Container Uptime",
    description:
      "How long a Swarm task's container has been running. Drops to zero when the task is rescheduled, restarted, or crashes.",
    metricName: "container.uptime",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    unit: "seconds",
  },
];

export function getAllDockerSwarmMetrics(): Array<DockerSwarmMetricDefinition> {
  return dockerSwarmMetricCatalog;
}

export function getDockerSwarmMetricsByCategory(
  category: DockerSwarmMetricCategory,
): Array<DockerSwarmMetricDefinition> {
  return dockerSwarmMetricCatalog.filter((m: DockerSwarmMetricDefinition) => {
    return m.category === category;
  });
}

export function getDockerSwarmMetricById(
  id: string,
): DockerSwarmMetricDefinition | undefined {
  return dockerSwarmMetricCatalog.find((m: DockerSwarmMetricDefinition) => {
    return m.id === id;
  });
}

export function getDockerSwarmMetricByMetricName(
  metricName: string,
): DockerSwarmMetricDefinition | undefined {
  return dockerSwarmMetricCatalog.find((m: DockerSwarmMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllDockerSwarmMetricCategories(): Array<DockerSwarmMetricCategory> {
  return ["CPU", "Memory", "Network", "Container"];
}
