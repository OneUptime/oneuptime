import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type DockerSwarmMetricCategory =
  | "CPU"
  | "Memory"
  | "Network"
  | "Container"
  | "Swarm";

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
 * on every node, so most series are the standard `container.*`
 * container-runtime metrics — there are NO `docker_swarm_*` or `pve_*`
 * metrics. The receiver emits one ResourceMetrics per container and
 * carries the container's identity (`container.name`,
 * `container.image.name`) as RESOURCE attributes, which ClickHouse stores
 * `resource.`-prefixed: group and filter by `resource.container.name`,
 * never the bare key, which matches nothing. For a Swarm service task the
 * container name is `<service>.<slot>.<taskid>`. The whole batch is scoped
 * by the `docker.swarm.cluster.name` resource attribute the agent stamps.
 *
 * The "Swarm" ones are the swarm's own state, which the agent's poller
 * reads from a manager every minute (files 0.161.3 on): one resource per
 * node, `resource.docker.swarm.node.name`, and one per replicated or global
 * service, `resource.docker.swarm.service.name` - named as the node's and
 * the service's task containers are.
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
      "Tasks in a Swarm task's container: processes and their threads, as the cgroup pids controller counts them. A sudden spike can indicate a fork bomb or a thread leak.",
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

  // The swarm's own state, from the agent's poller on a manager.
  {
    id: "swarm-node-ready",
    friendlyName: "Node Ready",
    description:
      "Whether a Swarm node is ready, as the managers see it: 1 while it is, 0 while it is down, disconnected or unknown. One series per node.",
    metricName: "docker.swarm.node.ready",
    category: "Swarm",
    defaultAggregation: MetricsAggregationType.Min,
  },
  {
    id: "swarm-service-replicas-desired",
    friendlyName: "Service Desired Replicas",
    description:
      "The tasks a replicated or global Swarm service wants running: its replica count, or for a global service the nodes it should run on. One series per service.",
    metricName: "docker.swarm.service.replicas.desired",
    category: "Swarm",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
  },
  {
    id: "swarm-service-replicas-running",
    friendlyName: "Service Running Replicas",
    description:
      "The tasks of a replicated or global Swarm service that are running. Below Service Desired Replicas, the service runs short. One series per service.",
    metricName: "docker.swarm.service.replicas.running",
    category: "Swarm",
    defaultAggregation: MetricsAggregationType.Avg,
    unit: "count",
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
  return ["CPU", "Memory", "Network", "Container", "Swarm"];
}
