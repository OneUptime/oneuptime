import {
  KubernetesResourceScope,
  KubernetesWorkloadKind,
} from "./MonitorStepKubernetesMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { translationKey } from "../Translator";
import {
  KUBERNETES_COST_DEFAULT_CURRENCY,
  KubernetesCostMetric,
} from "../Kubernetes/KubernetesCostMetrics";

export type KubernetesMetricCategory =
  | "Pod"
  | "Node"
  | "Container"
  | "Workload"
  | "HPA"
  | "ControlPlane"
  | "Cost";

export interface KubernetesMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: KubernetesMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: KubernetesResourceScope;
  /*
   * The kind of workload the metric is about, when it is about one: its
   * series carry only that kind's name (`k8s.job.name` on a Job's). The
   * monitor form's Workload Kind starts on it, so a Workload Name is read
   * as that kind's - a Job's name for Job Failed Pods, not a Deployment's;
   * an HPA's for the HPA metrics. Unset for pod, container, node and
   * cluster metrics.
   */
  workloadKind?: KubernetesWorkloadKind | undefined;
  unit?: string;
}

const kubernetesMetricCatalog: Array<KubernetesMetricDefinition> = [
  // Pod Metrics
  {
    id: "pod-cpu-utilization",
    friendlyName: translationKey("Pod CPU Usage"),
    description: translationKey(
      "CPU cores in use by the pod. kubeletstats reports this as a cores gauge despite the .utilization name - 0.18 means 0.18 of a core, not 18%. For a percentage, divide by the container CPU limit (k8s.container.cpu_limit) or the node allocatable CPU (k8s.node.allocatable_cpu).",
    ),
    metricName: "k8s.pod.cpu.utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
  },
  {
    id: "pod-memory-usage",
    friendlyName: translationKey("Pod Memory Usage"),
    description: translationKey("Memory usage in bytes for pods"),
    metricName: "k8s.pod.memory.usage",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "pod-phase",
    friendlyName: translationKey("Pod Phase (Code)"),
    description: translationKey(
      "The pod's phase as a numeric code (1 = Pending, 2 = Running, 3 = Succeeded, 4 = Failed, 5 = Unknown). This is a categorical value, not a quantity, so it must never be summed: the gauge re-emits on every scrape and a Sum totals (pods x scrapes). Use Max to catch the worst phase seen, or Min with 'equal to 1' to catch a stuck Pending pod. For a cluster-wide count of pods in a phase, filter by phase and count series instead.",
    ),
    metricName: "k8s.pod.phase",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "",
  },
  {
    id: "pod-filesystem-usage",
    friendlyName: translationKey("Pod Filesystem Usage"),
    description: translationKey("Filesystem usage in bytes for pods"),
    metricName: "k8s.pod.filesystem.usage",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  /*
   * A mounted volume's size and free space, from the kubeletstats volume
   * group: a persistent volume claim's names its claim, which the PVC Almost
   * Full template groups by (#9539).
   */
  {
    id: "volume-capacity",
    friendlyName: translationKey("Volume Capacity"),
    description: translationKey(
      "The size of a mounted volume's filesystem, in bytes, as the kubelet measures it. A persistent volume claim's volume names its claim in k8s.persistentvolumeclaim.name.",
    ),
    metricName: "k8s.volume.capacity",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Namespace,
    unit: "bytes",
  },
  {
    id: "volume-available",
    friendlyName: translationKey("Volume Free Space"),
    description: translationKey(
      "Bytes still free to write on a mounted volume's filesystem. Falling is bad, so alert with a 'less than' threshold; for a share of the capacity, use the PVC Almost Full template.",
    ),
    metricName: "k8s.volume.available",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Namespace,
    unit: "bytes",
  },
  {
    id: "pod-memory-limit-utilization",
    friendlyName: translationKey("Pod Memory Limit Utilization"),
    description: translationKey(
      "The pod's memory usage divided by its memory limit, as a ratio (0 to 1) - 0.93 means 93% of the limit, and it is shown as a percentage. kubeletstats divides by the SUM of the pod's container limits, so a pod with a sidecar is measured against its whole budget, and emits nothing for a pod where any container has no memory limit. The kubelet's memory figure includes reclaimable page cache, so a value near 1 means approaching the limit, not necessarily about to be OOMKilled.",
    ),
    metricName: "k8s.pod.memory_limit_utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "pod-cpu-limit-utilization",
    friendlyName: translationKey("Pod CPU Limit Utilization"),
    description: translationKey(
      "The pod's CPU usage divided by its CPU limit, as a ratio (0 to 1) - 0.93 means 93% of the limit, and it is shown as a percentage. kubeletstats divides by the SUM of the pod's container limits and emits nothing for a pod where any container has no CPU limit. Near 1 the kernel's CFS quota is throttling the pod: it gets slower rather than failing.",
    ),
    metricName: "k8s.pod.cpu_limit_utilization",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "ratio",
  },
  {
    id: "pod-network-io",
    friendlyName: translationKey(
      "Pod Network I/O (Cumulative, Both Directions)",
    ),
    description: translationKey(
      "Cumulative network bytes for pods. kubeletstats emits one series per (pod, interface, direction) with a `direction` datapoint attribute of receive|transmit, and this entry filters none of them - the value covers BOTH directions. It is a monotonically increasing counter, not a rate, so it is a poor alerting target; for throughput, chart it on the cluster page, which deltas it client-side.",
    ),
    metricName: "k8s.pod.network.io",
    category: "Pod",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },

  // Node Metrics
  {
    id: "node-cpu-utilization",
    friendlyName: translationKey("Node CPU Usage"),
    description: translationKey(
      "CPU cores in use by the node. kubeletstats reports this as a cores gauge despite the .utilization name - 1.4 means 1.4 cores, not 1.4%. For a percentage, divide by the node allocatable CPU (k8s.node.allocatable_cpu).",
    ),
    metricName: "k8s.node.cpu.utilization",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "cores",
  },
  {
    id: "node-allocatable-cpu",
    friendlyName: translationKey("Node Allocatable CPU"),
    description: translationKey(
      "CPU cores on the node that pods can be scheduled against: the node's capacity minus what the kubelet reserves for the operating system and Kubernetes daemons (system-reserved, kube-reserved). Reported by the k8s_cluster receiver. The scheduler never places pods whose CPU requests add up past it, so it is the right denominator for a node CPU percentage - usage or summed container requests divided by this.",
    ),
    metricName: "k8s.node.allocatable_cpu",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "cores",
  },
  {
    id: "node-memory-usage",
    friendlyName: translationKey("Node Memory Usage"),
    description: translationKey(
      "Memory usage in bytes for nodes, page cache included. For memory pressure, use Node Memory Working Set.",
    ),
    metricName: "k8s.node.memory.usage",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "node-memory-working-set",
    friendlyName: translationKey("Node Memory Working Set"),
    description: translationKey(
      "Memory in use on the node, in bytes, without the page cache the kernel can reclaim: the figure the kubelet evicts pods on, and the one kubectl top node prints. Divide by Node Allocatable Memory for a percentage.",
    ),
    metricName: "k8s.node.memory.working_set",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "node-filesystem-usage",
    friendlyName: translationKey("Node Filesystem Usage"),
    description: translationKey("Filesystem usage in bytes for nodes"),
    metricName: "k8s.node.filesystem.usage",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "node-allocatable-memory",
    friendlyName: translationKey("Node Allocatable Memory"),
    description: translationKey(
      "Memory in bytes on the node that pods can use: the node's capacity minus what the kubelet reserves for the operating system and Kubernetes daemons (system-reserved, kube-reserved) and the hard eviction threshold. Reported by the k8s_cluster receiver. The scheduler never places pods whose memory requests add up past it, so it - not the node's physical RAM - is the denominator for a meaningful node memory percentage.",
    ),
    metricName: "k8s.node.allocatable_memory",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "node-condition-ready",
    friendlyName: translationKey("Node Ready Condition"),
    description: translationKey(
      "The node's Ready condition: 1 = Ready, 0 = NotReady, -1 = Unknown (the kubelet stopped reporting, as a node that went down does). Alert on 'less than 1' to catch both.",
    ),
    metricName: "k8s.node.condition_ready",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "count",
  },
  /*
   * The pressure conditions the chart's node_conditions_to_report lists,
   * read by Node Under Pressure. True is the bad state here, so they
   * default to Max: any sample under pressure.
   */
  {
    id: "node-condition-memory-pressure",
    friendlyName: translationKey("Node Memory Pressure Condition"),
    description: translationKey(
      "The node's MemoryPressure condition: 1 = True (the kubelet is short of memory and evicts pods), 0 = False, -1 = Unknown (the kubelet stopped reporting).",
    ),
    metricName: "k8s.node.condition_memory_pressure",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "count",
  },
  {
    id: "node-condition-disk-pressure",
    friendlyName: translationKey("Node Disk Pressure Condition"),
    description: translationKey(
      "The node's DiskPressure condition: 1 = True (the kubelet is short of disk space and evicts pods), 0 = False, -1 = Unknown (the kubelet stopped reporting).",
    ),
    metricName: "k8s.node.condition_disk_pressure",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "count",
  },
  {
    id: "node-condition-pid-pressure",
    friendlyName: translationKey("Node PID Pressure Condition"),
    description: translationKey(
      "The node's PIDPressure condition: 1 = True (the kubelet is short of process IDs and evicts pods), 0 = False, -1 = Unknown (the kubelet stopped reporting).",
    ),
    metricName: "k8s.node.condition_pid_pressure",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "count",
  },
  {
    id: "node-filesystem-available",
    friendlyName: translationKey("Node Filesystem Available"),
    description: translationKey(
      "Free filesystem bytes remaining on the node. Falling is bad, so alert with a 'less than' threshold, not 'greater than'. For consumption instead, use Node Filesystem Usage.",
    ),
    metricName: "k8s.node.filesystem.available",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  /*
   * The size of a node's root filesystem (#9645): what High Node Disk Usage
   * divides by, as the kubelet measures nodefs.available against it.
   */
  {
    id: "node-filesystem-capacity",
    friendlyName: translationKey("Node Filesystem Capacity"),
    description: translationKey(
      "The size of the node's root filesystem, in bytes, as the kubelet measures it. Used is this minus Node Filesystem Available; by default the kubelet starts evicting pods when less than 10% of it is free, or 15% when it also holds the node's container images.",
    ),
    metricName: "k8s.node.filesystem.capacity",
    category: "Node",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },

  // Container Metrics
  {
    id: "container-restarts",
    friendlyName: translationKey("Container Restarts"),
    description: translationKey("Number of times a container has restarted"),
    metricName: "k8s.container.restarts",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  /*
   * What to alert on for restarts: the agent sends, with each sample, the
   * restarts since its previous sample of the container (the chart's
   * metrics/restarts-increase pipeline), so their Sum over a window is the
   * restarts in it - what CrashLoopBackOff Detection reads.
   * k8s.container.restarts above is the running total, for the charts.
   *
   * The increase carries what the running total carries but container.id:
   * the pod's namespace, name, UID and node, the container's name, and the
   * workload names the agent's k8sattributes gives every container metric
   * (resource.k8s.deployment.name and the rest), after the conversion. So
   * a Workload scope, or a group-by on a workload's name, reads it as it
   * reads the other container metrics.
   */
  {
    id: "container-restarts-increase",
    friendlyName: translationKey("Container Restarts (Increase)"),
    description: translationKey(
      "Restarts since the agent's previous sample of the container. Their sum over a window is the restarts in it. Carries its pod's workload names, so it can be scoped to a workload.",
    ),
    metricName: "k8s.container.restarts.increase",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "container-cpu-limit",
    friendlyName: translationKey("Container CPU Limit"),
    description: translationKey("CPU limit set for containers"),
    metricName: "k8s.container.cpu_limit",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
  },
  {
    id: "container-cpu-request",
    friendlyName: translationKey("Container CPU Request"),
    description: translationKey("CPU request set for containers"),
    metricName: "k8s.container.cpu_request",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "cores",
  },
  {
    id: "container-memory-limit",
    friendlyName: translationKey("Container Memory Limit"),
    description: translationKey("Memory limit set for containers"),
    metricName: "k8s.container.memory_limit",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-memory-request",
    friendlyName: translationKey("Container Memory Request"),
    description: translationKey("Memory request set for containers"),
    metricName: "k8s.container.memory_request",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "bytes",
  },
  {
    id: "container-ready",
    friendlyName: translationKey("Container Ready"),
    description: translationKey("Whether the container is in Ready state"),
    metricName: "k8s.container.ready",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Pod,
    unit: "count",
  },
  /*
   * A container's root filesystem, as the kubelet reports it (#9843): the
   * filesystem its writable layer lives on, which is the disk the node keeps
   * its images on on most nodes. Node Image Disk Almost Full and the Nodes
   * list's Image Disk read it, per node: every container of a node reports
   * the same disk. The kubeletstats receiver exports no image filesystem of
   * the node's own.
   */
  {
    id: "container-filesystem-available",
    friendlyName: translationKey("Container Filesystem Available"),
    description: translationKey(
      "Free bytes on the filesystem a container writes its own files to, as the kubelet measures it: on most nodes, the disk the node keeps its container images on. Every container on a node reports the same disk. Falling is bad, so alert with a 'less than' threshold.",
    ),
    metricName: "container.filesystem.available",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },
  {
    id: "container-filesystem-capacity",
    friendlyName: translationKey("Container Filesystem Capacity"),
    description: translationKey(
      "The size of the filesystem a container writes its own files to, in bytes, as the kubelet measures it: on most nodes, the disk the node keeps its container images on. Used is this minus Container Filesystem Available.",
    ),
    metricName: "container.filesystem.capacity",
    category: "Container",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Node,
    unit: "bytes",
  },

  /*
   * Workload Metrics
   *
   * These are the k8s_cluster receiver's names, which the agent chart
   * forwards unrenamed: `k8s.deployment.available` / `.desired`, not the
   * `*_replicas` spelling the Deployment status fields use. The receiver
   * has no "unavailable" series at all — a replica shortfall is
   * `desired - available` (see the k8s-deployment-replica-mismatch
   * template).
   */
  {
    id: "deployment-available-replicas",
    friendlyName: translationKey("Deployment Available Replicas"),
    description: translationKey(
      "Number of pods targeted by the deployment that have been ready for at least minReadySeconds",
    ),
    metricName: "k8s.deployment.available",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "deployment",
    unit: "count",
  },
  {
    id: "deployment-desired-replicas",
    friendlyName: translationKey("Deployment Desired Replicas"),
    description: translationKey(
      "Number of desired replicas (spec.replicas) in a deployment",
    ),
    metricName: "k8s.deployment.desired",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "deployment",
    unit: "count",
  },
  {
    id: "daemonset-desired-nodes",
    friendlyName: translationKey("DaemonSet Desired Nodes"),
    description: translationKey(
      "Number of nodes that should be running the daemon pod (status.desiredNumberScheduled)",
    ),
    metricName: "k8s.daemonset.desired_scheduled_nodes",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "daemonset",
    unit: "count",
  },
  {
    id: "daemonset-misscheduled-nodes",
    friendlyName: translationKey("DaemonSet Misscheduled Nodes"),
    description: translationKey(
      "Number of nodes running a daemon pod that should not be running one",
    ),
    metricName: "k8s.daemonset.misscheduled_nodes",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "daemonset",
    unit: "count",
  },
  {
    id: "daemonset-ready-nodes",
    friendlyName: translationKey("DaemonSet Ready Nodes"),
    description: translationKey("Number of nodes with a ready daemon pod"),
    metricName: "k8s.daemonset.ready_nodes",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "daemonset",
    unit: "count",
  },
  {
    id: "statefulset-desired-replicas",
    friendlyName: translationKey("StatefulSet Desired Replicas"),
    description: translationKey(
      "Number of desired pods (spec.replicas) in a StatefulSet",
    ),
    metricName: "k8s.statefulset.desired_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "statefulset",
    unit: "count",
  },
  {
    id: "statefulset-ready-replicas",
    friendlyName: translationKey("StatefulSet Ready Replicas"),
    description: translationKey(
      "Number of pods created by a StatefulSet that are Ready",
    ),
    metricName: "k8s.statefulset.ready_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "statefulset",
    unit: "count",
  },
  {
    id: "job-failed-pods",
    friendlyName: translationKey("Job Failed Pods"),
    description: translationKey("Number of failed pods in a Job"),
    metricName: "k8s.job.failed_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "job",
    unit: "count",
  },
  /*
   * What to alert on for Job failures: the agent sends, with each sample,
   * the Job's pods that failed since its previous sample of the Job (the
   * chart's transform/job-failures-increase), so their Sum over a window is
   * the failures in it - what Job Failures reads. k8s.job.failed_pods above
   * is the Job's running count, for the charts.
   *
   * A copy on the count's own resource, so it carries what the count
   * carries: the Job's name, UID and namespace. The Job is the workload, so
   * a Workload scope of kind Job reads it; the receiver puts no CronJob on a
   * Job's metrics.
   */
  {
    id: "job-failed-pods-increase",
    friendlyName: translationKey("Job Failed Pods (Increase)"),
    description: translationKey(
      "Pods of the Job that failed since the agent's previous sample of it. Their sum over a window is the failures in it. Carries the Job's name and namespace, so it can be scoped to a Job.",
    ),
    metricName: "k8s.job.failed_pods.increase",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "job",
    unit: "count",
  },
  {
    id: "job-successful-pods",
    friendlyName: translationKey("Job Successful Pods"),
    description: translationKey("Number of successful pods in a Job"),
    metricName: "k8s.job.successful_pods",
    category: "Workload",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "job",
    unit: "count",
  },

  /*
   * HPA Metrics. They carry the HPA's own name, not the name of what it
   * scales (KUBERNETES_HPA_KIND), so a Workload Name is read as the HPA's.
   */
  {
    id: "hpa-current-replicas",
    friendlyName: translationKey("HPA Current Replicas"),
    description: translationKey(
      "Current number of replicas managed by the HPA",
    ),
    metricName: "k8s.hpa.current_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "hpa",
    unit: "count",
  },
  {
    id: "hpa-desired-replicas",
    friendlyName: translationKey("HPA Desired Replicas"),
    description: translationKey(
      "Desired number of replicas as determined by the HPA",
    ),
    metricName: "k8s.hpa.desired_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "hpa",
    unit: "count",
  },
  {
    id: "hpa-max-replicas",
    friendlyName: translationKey("HPA Max Replicas"),
    description: translationKey(
      "Maximum number of replicas the HPA can scale to",
    ),
    metricName: "k8s.hpa.max_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "hpa",
    unit: "count",
  },
  {
    id: "hpa-min-replicas",
    friendlyName: translationKey("HPA Min Replicas"),
    description: translationKey("Minimum number of replicas the HPA maintains"),
    metricName: "k8s.hpa.min_replicas",
    category: "HPA",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Workload,
    workloadKind: "hpa",
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
    friendlyName: translationKey("etcd Has Leader"),
    description: translationKey(
      "Whether the etcd member sees an elected leader (1 = has a leader, 0 = no leader). A flag, not a count: without a leader etcd cannot commit writes, so the API server cannot persist any change. Min over the window catches a single leaderless sample.",
    ),
    metricName: "etcd_server_has_leader",
    category: "ControlPlane",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "",
  },
  {
    id: "apiserver-inflight-requests",
    friendlyName: translationKey("API Server In-Flight Requests"),
    description: translationKey(
      "Requests the Kubernetes API server is processing right now, one series per request_kind (mutating / readOnly). The server admits a bounded number at once (--max-requests-inflight, default 400; --max-mutating-requests-inflight, default 200) and rejects the rest with HTTP 429, so a value held at its limit means clients are being throttled.",
    ),
    metricName: "apiserver_current_inflight_requests",
    category: "ControlPlane",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },
  {
    id: "scheduler-pending-pods",
    friendlyName: translationKey("Scheduler Pending Pods"),
    description: translationKey(
      "Pods waiting in the kube-scheduler's queues, one series per queue (active, backoff, unschedulable, and gated on newer versions). A count that stays above zero means pods the scheduler cannot place - usually not enough allocatable CPU or memory, or taints, affinity or volume constraints no node satisfies.",
    ),
    metricName: "scheduler_pending_pods",
    category: "ControlPlane",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: "count",
  },

  /*
   * Cost Metrics
   *
   * Not the agent's collector's: OneUptime writes them from the allocation
   * rows the cost agent sends (Common/Types/Kubernetes/KubernetesCostMetrics),
   * one point per allocation window - an hour by default - stamped at the
   * window's start, about an hour after the window closes. So a monitor on
   * them wants a window of hours, and the costs are summed over it: each
   * point is what one hour cost.
   */
  {
    id: "cost-cluster",
    friendlyName: translationKey("Cluster Cost"),
    description: translationKey(
      "What the cluster cost in each hour, idle capacity included, as its cost engine priced it. Each point is one hour's cost, written about an hour after the hour ends: sum it over the past day for the day's cost.",
    ),
    metricName: KubernetesCostMetric.Total,
    category: "Cost",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: KUBERNETES_COST_DEFAULT_CURRENCY,
  },
  {
    id: "cost-idle",
    friendlyName: translationKey("Idle Cost"),
    description: translationKey(
      "The part of the cluster's cost in each hour that no workload used: node capacity nothing requested or used, and cost the engine could not allocate. Fewer or smaller nodes lower it.",
    ),
    metricName: KubernetesCostMetric.Idle,
    category: "Cost",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Cluster,
    unit: KUBERNETES_COST_DEFAULT_CURRENCY,
  },
  {
    id: "cost-workload",
    friendlyName: translationKey("Workload Cost"),
    description: translationKey(
      "What each workload cost in each hour, in its namespace. A Namespace scope adds up what the namespace cost, a Workload scope what one workload cost. Idle capacity is never charged to a workload.",
    ),
    metricName: KubernetesCostMetric.Workload,
    category: "Cost",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: KubernetesResourceScope.Namespace,
    unit: KUBERNETES_COST_DEFAULT_CURRENCY,
  },
  {
    id: "cost-workload-efficiency",
    friendlyName: translationKey("Workload Cost Efficiency"),
    description: translationKey(
      "How much of the CPU and memory each workload requested it used in each hour, in percent, weighted by what each part cost: 100 is all of it. Low values mean paying for requests nothing uses.",
    ),
    metricName: KubernetesCostMetric.Efficiency,
    category: "Cost",
    defaultAggregation: MetricsAggregationType.Avg,
    /*
     * Namespace, as for Workload Cost: the metric is written for every kind
     * of workload, so no one Workload Kind fits it; a Workload scope still
     * reads one workload, of the kind the form is set to.
     */
    defaultResourceScope: KubernetesResourceScope.Namespace,
    unit: "%",
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
  return [
    "Pod",
    "Node",
    "Container",
    "Workload",
    "HPA",
    "ControlPlane",
    "Cost",
  ];
}

/*
 * Each group's heading in the metric picker, a key: a category is an
 * identifier the catalog's metrics name, so the picker looks its heading up
 * here, once (#8353).
 */
const categoryLabels: Record<KubernetesMetricCategory, string> = {
  Pod: translationKey("Pod"),
  Node: translationKey("Node"),
  Container: translationKey("Container"),
  Workload: translationKey("Workload"),
  HPA: translationKey("HPA"),
  ControlPlane: translationKey("Control Plane"),
  Cost: translationKey("Cost"),
};

export function getKubernetesMetricCategoryLabel(
  category: KubernetesMetricCategory,
): string {
  return categoryLabels[category] || category;
}
