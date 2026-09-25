import { KubernetesResourceScope } from "./MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type KubernetesMetricCategory =
  | "Pod"
  | "Node"
  | "Container"
  | "Workload"
  | "HPA"
  | "ControlPlane";

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
    friendlyName: "Pod CPU Usage",
    description:
      "CPU cores in use by the pod. kubeletstats reports this as a cores gauge despite the .utilization name - 0.18 means 0.18 of a core, not 18%. For a percentage, divide by the container CPU limit (k8s.container.cpu_limit) or the node allocatable CPU (k8s.node.allocatable_cpu).",
    metricName: "k8s.pod.cpu.utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
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
    friendlyName: "Pod Phase (Code)",
    description:
      "The pod's phase as a numeric code (1 = Pending, 2 = Running, 3 = Succeeded, 4 = Failed, 5 = Unknown). This is a categorical value, not a quantity, so it must never be summed: the gauge re-emits on every scrape and a Sum totals (pods x scrapes). Use Max to catch the worst phase seen, or Min with 'equal to 1' to catch a stuck Pending pod. For a cluster-wide count of pods in a phase, filter by phase and count series instead.",
    metricName: "k8s.pod.phase",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "",
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
    id: "pod-memory-limit-utilization",
    friendlyName: "Pod Memory Limit Utilization",
    description:
      "The pod's memory usage divided by its memory limit, as a ratio (0 to 1) - 0.93 means 93% of the limit, and it is shown as a percentage. kubeletstats divides by the SUM of the pod's container limits, so a pod with a sidecar is measured against its whole budget, and emits nothing for a pod where any container has no memory limit. The kubelet's memory figure includes reclaimable page cache, so a value near 1 means approaching the limit, not necessarily about to be OOMKilled.",
    metricName: "k8s.pod.memory_limit_utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "pod-cpu-limit-utilization",
    friendlyName: "Pod CPU Limit Utilization",
    description:
      "The pod's CPU usage divided by its CPU limit, as a ratio (0 to 1) - 0.93 means 93% of the limit, and it is shown as a percentage. kubeletstats divides by the SUM of the pod's container limits and emits nothing for a pod where any container has no CPU limit. Near 1 the kernel's CFS quota is throttling the pod: it gets slower rather than failing.",
    metricName: "k8s.pod.cpu_limit_utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "pod-network-io",
    friendlyName: "Pod Network I/O (Cumulative, Both Directions)",
    description:
      "Cumulative network bytes for pods. kubeletstats emits one series per (pod, interface, direction) with a `direction` datapoint attribute of receive|transmit, and this entry filters none of them - the value covers BOTH directions. It is a monotonically increasing counter, not a rate, so it is a poor alerting target; for throughput, chart it on the cluster page, which deltas it client-side.",
    metricName: "k8s.pod.network.io",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },

  // Node Metrics
  {
    id: "node-cpu-utilization",
    friendlyName: "Node CPU Usage",
    description:
      "CPU cores in use by the node. kubeletstats reports this as a cores gauge despite the .utilization name - 1.4 means 1.4 cores, not 1.4%. For a percentage, divide by the node allocatable CPU (k8s.node.allocatable_cpu).",
    metricName: "k8s.node.cpu.utilization",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "cores",
  },
  {
    id: "node-cpu-usage",
    friendlyName: "Node CPU In Use",
    description:
      "CPU cores in use by the node, from kubeletstats' k8s.node.cpu.usage - the current name for the same cores value older receiver versions emit as k8s.node.cpu.utilization. 1.4 means 1.4 cores, not 1.4%. For a percentage, divide by Node Allocatable CPU (k8s.node.allocatable_cpu), which is how the High Node CPU Utilization template computes it.",
    metricName: "k8s.node.cpu.usage",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "cores",
  },
  {
    id: "node-allocatable-cpu",
    friendlyName: "Node Allocatable CPU",
    description:
      "CPU cores on the node that pods can be scheduled against: the node's capacity minus what the kubelet reserves for the operating system and Kubernetes daemons (system-reserved, kube-reserved). Reported by the k8s_cluster receiver. The scheduler never places pods whose CPU requests add up past it, so it is the right denominator for a node CPU percentage - usage or summed container requests divided by this.",
    metricName: "k8s.node.allocatable_cpu",
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
    id: "node-allocatable-memory",
    friendlyName: "Node Allocatable Memory",
    description:
      "Memory in bytes on the node that pods can use: the node's capacity minus what the kubelet reserves for the operating system and Kubernetes daemons (system-reserved, kube-reserved) and the hard eviction threshold. Reported by the k8s_cluster receiver. The scheduler never places pods whose memory requests add up past it, so it - not the node's physical RAM - is the denominator for a meaningful node memory percentage.",
    metricName: "k8s.node.allocatable_memory",
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
    id: "node-filesystem-available",
    friendlyName: "Node Filesystem Available",
    description:
      "Free filesystem bytes remaining on the node. Falling is bad, so alert with a 'less than' threshold, not 'greater than'. For consumption instead, use Node Filesystem Usage.",
    metricName: "k8s.node.filesystem.available",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Min,
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

  // Workload Metrics
  {
    id: "deployment-available-replicas",
    friendlyName: "Deployment Available Replicas",
    description: "Number of available replicas in a deployment",
    metricName: "k8s.deployment.available_replicas",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "deployment-desired-replicas",
    friendlyName: "Deployment Desired Replicas",
    description: "Number of desired replicas in a deployment",
    metricName: "k8s.deployment.desired_replicas",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    unit: "count",
  },
  {
    id: "deployment-unavailable-replicas",
    friendlyName: "Deployment Unavailable Replicas",
    description: "Number of unavailable replicas in a deployment",
    metricName: "k8s.deployment.unavailable_replicas",
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
    friendlyName: "StatefulSet Ready Replicas",
    description: "Number of ready replicas in a StatefulSet",
    metricName: "k8s.statefulset.ready_replicas",
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

  /*
   * Control Plane Metrics
   *
   * Prometheus metrics the agent scrapes from etcd, the API server and the
   * scheduler, and only when its control-plane scrape is enabled
   * (controlPlane.enabled). Managed clusters (EKS / GKE / AKS) do not
   * expose these endpoints, so on those these metrics never report.
   * Each is one cluster-wide signal, hence the Cluster scope.
   */
  {
    id: "etcd-has-leader",
    friendlyName: "etcd Has Leader",
    description:
      "Whether the etcd member sees an elected leader (1 = has a leader, 0 = no leader). A flag, not a count: without a leader etcd cannot commit writes, so the API server cannot persist any change. Min over the window catches a single leaderless sample.",
    metricName: "etcd_server_has_leader",
    category: "ControlPlane",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "",
  },
  {
    id: "apiserver-inflight-requests",
    friendlyName: "API Server In-Flight Requests",
    description:
      "Requests the Kubernetes API server is processing right now, one series per request_kind (mutating / readOnly). The server admits a bounded number at once (--max-requests-inflight, default 400; --max-mutating-requests-inflight, default 200) and rejects the rest with HTTP 429, so a value held at its limit means clients are being throttled.",
    metricName: "apiserver_current_inflight_requests",
    category: "ControlPlane",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "scheduler-pending-pods",
    friendlyName: "Scheduler Pending Pods",
    description:
      "Pods waiting in the kube-scheduler's queues, one series per queue (active, backoff, unschedulable, and gated on newer versions). A count that stays above zero means pods the scheduler cannot place - usually not enough allocatable CPU or memory, or taints, affinity or volume constraints no node satisfies.",
    metricName: "scheduler_pending_pods",
    category: "ControlPlane",
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
  return ["Pod", "Node", "Container", "Workload", "HPA", "ControlPlane"];
}

/**
 * How a category is titled in a picker. The category values are
 * identifiers ("ControlPlane" matches the alert templates' category), not
 * prose.
 */
export function getKubernetesMetricCategoryLabel(
  category: KubernetesMetricCategory,
): string {
  return category === "ControlPlane" ? "Control Plane" : category;
}
