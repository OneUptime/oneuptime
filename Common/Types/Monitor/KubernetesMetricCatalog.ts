import { KubernetesResourceScope } from "./MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type KubernetesMetricCategory =
  | "Pod"
  | "Node"
  | "Container"
  | "Workload"
  | "HPA"
  | "Storage";

export interface KubernetesMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: KubernetesMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: KubernetesResourceScope;
  unit?: string;
}

const kubernetesMetricCatalog: Array<KubernetesMetricDefinition> = [
  // Pod Metrics
  {
    id: "pod-cpu-utilization",
    friendlyName: "Pod CPU Utilization",
    description: "CPU usage percentage for pods",
    metricName: "k8s.pod.cpu.utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "%",
  },
  {
    id: "pod-memory-usage",
    friendlyName: "Pod Memory Usage",
    description: "Memory usage in bytes for pods",
    metricName: "k8s.pod.memory.usage",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "pod-phase",
    friendlyName: "Pod Phase",
    description:
      "Current phase of the pod, encoded in the metric value (1 = Pending, 2 = Running, 3 = Succeeded, 4 = Failed, 5 = Unknown). No phase attribute is emitted — filter/alert on the value. Min detects Pending, since 1 is the lowest encoding.",
    metricName: "k8s.pod.phase",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "pod-filesystem-usage",
    friendlyName: "Pod Filesystem Usage",
    description: "Filesystem usage in bytes for pods",
    metricName: "k8s.pod.filesystem.usage",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "pod-network-io-receive",
    friendlyName: "Pod Network Receive",
    description: "Network bytes received by pods",
    metricName: "k8s.pod.network.io",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "pod-network-errors",
    friendlyName: "Pod Network Errors",
    description: "Number of network errors for pods",
    metricName: "k8s.pod.network.errors",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "count",
  },
  {
    id: "pod-memory-working-set",
    friendlyName: "Pod Memory Working Set",
    description: "Working set memory in bytes for pods",
    metricName: "k8s.pod.memory.working_set",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "pod-cpu-limit-utilization",
    friendlyName: "Pod CPU Limit Utilization",
    description:
      "Pod CPU usage as a fraction of the sum of its containers' CPU limits (0-1). Zero when no limits are set.",
    metricName: "k8s.pod.cpu_limit_utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "pod-memory-limit-utilization",
    friendlyName: "Pod Memory Limit Utilization",
    description:
      "Pod memory usage as a fraction of the sum of its containers' memory limits (0-1). Zero when no limits are set.",
    metricName: "k8s.pod.memory_limit_utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },

  // Node Metrics
  {
    id: "node-cpu-utilization",
    friendlyName: "Node CPU Usage",
    description:
      "CPU cores used by nodes. Despite the 'utilization' name, kubeletstats reports this metric in cores, not percent.",
    metricName: "k8s.node.cpu.utilization",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "cores",
  },
  {
    id: "node-memory-usage",
    friendlyName: "Node Memory Usage",
    description: "Memory usage in bytes for nodes",
    metricName: "k8s.node.memory.usage",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "node-filesystem-usage",
    friendlyName: "Node Filesystem Usage",
    description: "Filesystem usage in bytes for nodes",
    metricName: "k8s.node.filesystem.usage",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "node-condition-ready",
    friendlyName: "Node Ready Condition",
    description:
      "Whether the node is in Ready condition (1 = ready, 0 = not ready)",
    metricName: "k8s.node.condition_ready",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "count",
  },
  {
    id: "node-disk-io",
    friendlyName: "Node Disk I/O",
    description: "Disk I/O operations on nodes",
    metricName: "k8s.node.filesystem.available",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },

  // Container Metrics
  {
    id: "container-restarts",
    friendlyName: "Container Restarts",
    description: "Number of times a container has restarted",
    metricName: "k8s.container.restarts",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "container-cpu-limit",
    friendlyName: "Container CPU Limit",
    description: "CPU limit set for containers",
    metricName: "k8s.container.cpu_limit",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
  },
  {
    id: "container-cpu-request",
    friendlyName: "Container CPU Request",
    description: "CPU request set for containers",
    metricName: "k8s.container.cpu_request",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
  },
  {
    id: "container-memory-limit",
    friendlyName: "Container Memory Limit",
    description: "Memory limit set for containers",
    metricName: "k8s.container.memory_limit",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-memory-request",
    friendlyName: "Container Memory Request",
    description: "Memory request set for containers",
    metricName: "k8s.container.memory_request",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-ready",
    friendlyName: "Container Ready",
    description: "Whether the container is in Ready state",
    metricName: "k8s.container.ready",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "count",
  },
  {
    id: "container-cpu-utilization",
    friendlyName: "Container CPU Usage",
    description:
      "CPU cores used by containers. Despite the 'utilization' name, kubeletstats reports this metric in cores, not percent.",
    metricName: "container.cpu.utilization",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
  },
  {
    id: "container-memory-usage",
    friendlyName: "Container Memory Usage",
    description: "Memory usage in bytes for containers",
    metricName: "container.memory.usage",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-memory-working-set",
    friendlyName: "Container Memory Working Set",
    description:
      "Working set memory in bytes for containers — the value the OOM killer compares against the memory limit",
    metricName: "container.memory.working_set",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-filesystem-usage",
    friendlyName: "Container Filesystem Usage",
    description: "Filesystem usage in bytes for containers",
    metricName: "container.filesystem.usage",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-filesystem-available",
    friendlyName: "Container Filesystem Available",
    description: "Filesystem space available in bytes for containers",
    metricName: "container.filesystem.available",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-cpu-limit-utilization",
    friendlyName: "Container CPU Limit Utilization",
    description:
      "Container CPU usage as a fraction of its CPU limit (0-1). Zero when no limit is set.",
    metricName: "k8s.container.cpu_limit_utilization",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "container-cpu-request-utilization",
    friendlyName: "Container CPU Request Utilization",
    description:
      "Container CPU usage as a fraction of its CPU request (0-1). Zero when no request is set.",
    metricName: "k8s.container.cpu_request_utilization",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "container-memory-limit-utilization",
    friendlyName: "Container Memory Limit Utilization",
    description:
      "Container memory usage as a fraction of its memory limit (0-1). Zero when no limit is set.",
    metricName: "k8s.container.memory_limit_utilization",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "container-memory-request-utilization",
    friendlyName: "Container Memory Request Utilization",
    description:
      "Container memory usage as a fraction of its memory request (0-1). Zero when no request is set.",
    metricName: "k8s.container.memory_request_utilization",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "container-oom-events",
    friendlyName: "Container OOM Events",
    description:
      "Number of out-of-memory (OOM) kill events for containers, scraped from cAdvisor. Cumulative counter — the value only ever increases.",
    metricName: "container_oom_events_total",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },

  // Workload Metrics
  /*
   * The k8s_cluster receiver's deployment gauges are named
   * `k8s.deployment.available` / `k8s.deployment.desired` — there is no
   * `*_replicas` variant (and no `unavailable` metric in any receiver
   * version; derive the mismatch as `desired - available`).
   */
  {
    id: "deployment-available-replicas",
    friendlyName: "Deployment Available Replicas",
    description: "Number of available replicas in a deployment",
    metricName: "k8s.deployment.available",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "deployment-desired-replicas",
    friendlyName: "Deployment Desired Replicas",
    description: "Number of desired replicas in a deployment",
    metricName: "k8s.deployment.desired",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "daemonset-misscheduled-nodes",
    friendlyName: "DaemonSet Misscheduled Nodes",
    description:
      "Number of nodes running a daemon pod that should not be running one",
    metricName: "k8s.daemonset.misscheduled_nodes",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "daemonset-ready-nodes",
    friendlyName: "DaemonSet Ready Nodes",
    description: "Number of nodes with a ready daemon pod",
    metricName: "k8s.daemonset.ready_nodes",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "statefulset-ready-replicas",
    friendlyName: "StatefulSet Ready Pods",
    description:
      "Number of ready pods in a StatefulSet (the k8s_cluster receiver names this ready_pods, not ready_replicas)",
    metricName: "k8s.statefulset.ready_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "job-failed-pods",
    friendlyName: "Job Failed Pods",
    description: "Number of failed pods in a Job",
    metricName: "k8s.job.failed_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "job-successful-pods",
    friendlyName: "Job Successful Pods",
    description: "Number of successful pods in a Job",
    metricName: "k8s.job.successful_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },

  // HPA Metrics
  {
    id: "hpa-current-replicas",
    friendlyName: "HPA Current Replicas",
    description: "Current number of replicas managed by the HPA",
    metricName: "k8s.hpa.current_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "hpa-desired-replicas",
    friendlyName: "HPA Desired Replicas",
    description: "Desired number of replicas as determined by the HPA",
    metricName: "k8s.hpa.desired_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "hpa-max-replicas",
    friendlyName: "HPA Max Replicas",
    description: "Maximum number of replicas the HPA can scale to",
    metricName: "k8s.hpa.max_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "hpa-min-replicas",
    friendlyName: "HPA Min Replicas",
    description: "Minimum number of replicas the HPA maintains",
    metricName: "k8s.hpa.min_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },

  // Storage Metrics
  {
    id: "volume-available",
    friendlyName: "Volume Available",
    description:
      "Free space in bytes for pod volumes, including PersistentVolumeClaims",
    metricName: "k8s.volume.available",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "bytes",
  },
  {
    id: "volume-capacity",
    friendlyName: "Volume Capacity",
    description:
      "Total capacity in bytes for pod volumes, including PersistentVolumeClaims",
    metricName: "k8s.volume.capacity",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "bytes",
  },
  {
    id: "volume-inodes-free",
    friendlyName: "Volume Inodes Free",
    description:
      "Number of free inodes for pod volumes, including PersistentVolumeClaims",
    metricName: "k8s.volume.inodes.free",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "volume-inodes-used",
    friendlyName: "Volume Inodes Used",
    description:
      "Number of used inodes for pod volumes, including PersistentVolumeClaims",
    metricName: "k8s.volume.inodes.used",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
];

export function getAllKubernetesMetrics(): Array<KubernetesMetricDefinition> {
  return kubernetesMetricCatalog;
}

export function getKubernetesMetricsByCategory(
  category: KubernetesMetricCategory,
): Array<KubernetesMetricDefinition> {
  return kubernetesMetricCatalog.filter((m: KubernetesMetricDefinition) => {
    return m.category === category;
  });
}

export function getKubernetesMetricById(
  id: string,
): KubernetesMetricDefinition | undefined {
  return kubernetesMetricCatalog.find((m: KubernetesMetricDefinition) => {
    return m.id === id;
  });
}

export function getKubernetesMetricByMetricName(
  metricName: string,
): KubernetesMetricDefinition | undefined {
  return kubernetesMetricCatalog.find((m: KubernetesMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllKubernetesMetricCategories(): Array<KubernetesMetricCategory> {
  return ["Pod", "Node", "Container", "Workload", "HPA", "Storage"];
}
