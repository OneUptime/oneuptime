/*
 * What each number on the Kubernetes resource pages means, in plain words:
 * the list tables (Nodes, Pods, Containers, Deployments, ...), the summary
 * fields on each resource's Overview tab, the node's Network Throughput
 * chart and a pod's container cards. Shown in the (i) tooltip beside a
 * column header, field or chart title.
 *
 * The same title means different things on different pages, and the texts
 * say which:
 *   - CPU on the Nodes list is the node's own latest reading against its
 *     allocatable CPU. On the Pods and Containers lists it is the pod's or
 *     container's latest reading against the allocatable CPU of the NODE it
 *     runs on - not against its own request or limit.
 *   - CPU and Memory on the workload and Namespaces lists are SUMS of those
 *     per-pod percentages, so they pass 100% with a few busy pods. Only pods
 *     that reported in the last 15 minutes count. Workloads are matched by
 *     name only, so a same-named workload in another namespace is added in.
 *   - Memory on the Pods list is measured against the pod's container
 *     limits, falling back to the node's allocatable memory; on the
 *     Containers list against the container's own limit, or not at all.
 *   - Every list value is built from each resource's latest reading in the
 *     inventory snapshot, never an average; the lists have no time picker,
 *     and a reading older than 15 minutes shows as N/A.
 * Change the fetch, change the words.
 */

export type KubernetesResourceMetric =
  // List pages: built-in CPU / Memory columns, per page.
  | "nodeCpu"
  | "nodeMemory"
  | "podCpu"
  | "podMemory"
  | "containerCpu"
  | "containerMemory"
  | "deploymentCpu"
  | "deploymentMemory"
  | "statefulSetCpu"
  | "statefulSetMemory"
  | "daemonSetCpu"
  | "daemonSetMemory"
  | "jobCpu"
  | "jobMemory"
  | "cronJobCpu"
  | "cronJobMemory"
  | "namespaceCpu"
  | "namespaceMemory"
  // List pages: custom metric columns.
  | "podContainers"
  | "containerRestarts"
  | "deploymentReady"
  | "statefulSetReady"
  | "daemonSetReady"
  | "hpaMinReplicas"
  | "hpaMaxReplicas"
  | "hpaCurrentReplicas"
  | "hpaDesiredReplicas"
  | "pvcCapacity"
  | "pvCapacity"
  // Detail pages: Overview summary fields.
  | "nodeCpuCapacity"
  | "nodeMemoryCapacity"
  | "nodePodCapacity"
  | "nodeNetworkThroughput"
  | "podRestarts"
  | "deploymentRolloutStatus"
  | "deploymentDesiredReplicas"
  | "deploymentReadyReplicas"
  | "deploymentAvailableReplicas"
  | "deploymentUnavailableReplicas"
  | "statefulSetReplicas"
  | "statefulSetReadyReplicas"
  | "daemonSetDesiredScheduled"
  | "daemonSetCurrentScheduled"
  | "daemonSetNumberReady"
  | "daemonSetNumberAvailable"
  | "jobCompletions"
  | "jobParallelism"
  | "jobBackoffLimit"
  | "jobActive"
  | "jobSucceeded"
  | "jobFailed"
  | "cronJobActiveJobs"
  | "cronJobSuccessfulJobsHistoryLimit"
  | "cronJobFailedJobsHistoryLimit"
  | "pvcRequestedStorage"
  | "hpaMetrics"
  | "vpaRecommendation"
  // A pod's Containers tab.
  | "containerState"
  | "containerReady"
  | "containerRequests"
  | "containerLimits";

export const KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS: Record<
  KubernetesResourceMetric,
  string
> = {
  nodeCpu:
    "This node's most recent CPU reading, system processes included, as a share of its allocatable CPU (what is left for pods after the system's reservation), so it can pass 100%. It is the latest sample, not an average; N/A means no reading in the last 15 minutes.",
  nodeMemory:
    "This node's most recent memory use, and that as a share of its allocatable memory (its total memory when allocatable is not reported). It includes file cache and the percentage stops at 100%; N/A means no reading in the last 15 minutes.",
  podCpu:
    "This pod's most recent CPU reading as a share of the allocatable CPU on its node - not of the pod's own CPU request or limit. It is the latest sample, not an average; N/A means no reading in the last 15 minutes.",
  podMemory:
    "This pod's most recent memory use, compared with the sum of the memory limits its containers set, or with its node's allocatable memory when none sets a limit. The percentage stops at 100%; N/A means no reading in the last 15 minutes.",
  containerCpu:
    "This container's most recent CPU reading as a share of the allocatable CPU on its node, not of its own CPU limit. It is the latest sample, not an average; N/A means no reading in the last 15 minutes.",
  containerMemory:
    "This container's most recent memory use, shown as a share of its memory limit (the most it may use before it is killed) when it has one, up to 100%. Without a limit only the amount is shown; N/A means no reading in the last 15 minutes.",
  deploymentCpu:
    "The latest CPU use of this deployment's pods added up, each as a share of its own node's allocatable CPU, so it can pass 100% (the bar stops there). Counts pods that reported in the last 15 minutes, including same-named deployments in other namespaces.",
  deploymentMemory:
    "The latest memory use of this deployment's pods added up: the total amount, and each pod's share of its node's allocatable memory summed, which can pass 100%. Counts pods that reported in the last 15 minutes, including same-named deployments in other namespaces.",
  statefulSetCpu:
    "The latest CPU use of this StatefulSet's pods added up, each as a share of its own node's allocatable CPU, so it can pass 100% (the bar stops there). Counts pods that reported in the last 15 minutes, including same-named StatefulSets in other namespaces.",
  statefulSetMemory:
    "The latest memory use of this StatefulSet's pods added up: the total amount, and each pod's share of its node's allocatable memory summed, which can pass 100%. Counts pods that reported in the last 15 minutes, including same-named StatefulSets in other namespaces.",
  daemonSetCpu:
    "The latest CPU use of this DaemonSet's pods (usually one per node) added up, each as a share of its own node's allocatable CPU, so it can pass 100%. Counts pods that reported in the last 15 minutes, including same-named DaemonSets in other namespaces.",
  daemonSetMemory:
    "The latest memory use of this DaemonSet's pods added up: the total amount, and each pod's share of its node's allocatable memory summed, which can pass 100%. Counts pods that reported in the last 15 minutes, including same-named DaemonSets in other namespaces.",
  jobCpu:
    "The latest CPU use of this job's pods added up, each as a share of its own node's allocatable CPU, so it can pass 100%. Counts pods that reported in the last 15 minutes (so N/A soon after the job ends), including same-named jobs in other namespaces.",
  jobMemory:
    "The latest memory use of this job's pods added up: the total amount, and each pod's share of its node's allocatable memory summed, which can pass 100%. Counts pods that reported in the last 15 minutes (so N/A soon after the job ends), including same-named jobs in other namespaces.",
  cronJobCpu:
    "The latest CPU use of pods from this CronJob's runs that reported in the last 15 minutes, added up, each as a share of its node's allocatable CPU, so it can pass 100%. N/A between runs; same-named CronJobs in other namespaces are added in too.",
  cronJobMemory:
    "The latest memory use of pods from this CronJob's runs that reported in the last 15 minutes: the total amount, and each pod's share of its node's allocatable memory added up, which can pass 100%. N/A between runs; same-named CronJobs in other namespaces are added in too.",
  namespaceCpu:
    "The latest CPU use of every pod in this namespace added up, each as a share of its own node's allocatable CPU, so it can pass 100% (the bar stops there). Only pods that reported in the last 15 minutes count.",
  namespaceMemory:
    "The latest memory use of every pod in this namespace added up: the total amount, and each pod's share of its node's allocatable memory summed, which can pass 100%. Only pods that reported in the last 15 minutes count.",

  podContainers:
    "How many main containers this pod runs, not counting init containers, which Kubernetes starts first to prepare the pod.",
  containerRestarts:
    "How many times Kubernetes has restarted this container in its pod. A count that keeps climbing usually means it is crashing or failing its liveness check.",
  deploymentReady:
    "Pods of this deployment passing their readiness checks, out of the number it is set to run (its desired replicas).",
  statefulSetReady:
    "Pods of this StatefulSet passing their readiness checks, out of the number it is set to run (its desired replicas).",
  daemonSetReady:
    "Nodes where this DaemonSet's pod is running and ready, out of the nodes that should run one.",
  hpaMinReplicas:
    "The fewest pods this autoscaler will scale its target down to, however quiet things get.",
  hpaMaxReplicas:
    "The most pods this autoscaler may scale its target up to, however busy things get.",
  hpaCurrentReplicas:
    "How many pods the autoscaler's target had when the autoscaler last checked it.",
  hpaDesiredReplicas:
    "How many pods the autoscaler last worked out its target should have, from its metrics and kept between the min and max. When this differs from the current count, scaling is under way.",
  pvcCapacity:
    "The storage actually provisioned for this claim, which can be more than was requested because storage providers round up. N/A until the claim is bound to a volume; Gi means gibibytes (1 Gi = 1,024 Mi).",
  pvCapacity:
    "The total size of this persistent volume, in Kubernetes units: Gi is gibibytes and Mi is mebibytes (1 Gi = 1,024 Mi).",

  nodeCpuCapacity:
    "Capacity is the node's total CPU; allocatable is what is left for pods after the operating system and Kubernetes take their reservation. Values are in cores, and an m suffix means thousandths of a core (500m is half a core).",
  nodeMemoryCapacity:
    "Capacity is the node's total memory; allocatable is what pods can use after the system's reservation. Shown in Kubernetes units: Ki, Mi and Gi are kibibytes, mebibytes and gibibytes (1 Gi = 1,024 Mi).",
  nodePodCapacity:
    "The most pods this node is configured to run at once. It caps how many pods fit here even when CPU and memory are still free.",
  nodeNetworkThroughput:
    "Bytes per second this node received and sent, added up across its network interfaces. Worked out from how much the node's network byte counters grew between points in the selected time range.",
  podRestarts:
    "Total restarts across this pod's containers, not counting init containers. A number that keeps rising usually means a container is crashing or failing its liveness check.",
  deploymentRolloutStatus:
    "Complete when the number of ready pods matches the desired count and none are unavailable; In Progress otherwise, such as during a rollout or scale-up or while pods fail health checks. The bar shows ready pods out of desired.",
  deploymentDesiredReplicas:
    "How many copies of the pod (replicas) this deployment is set to run. An autoscaler, if one targets it, changes this number over time.",
  deploymentReadyReplicas:
    "How many of this deployment's pods are passing their readiness checks, so Services can send them traffic.",
  deploymentAvailableReplicas:
    "Pods that have stayed ready for at least the deployment's minimum ready time (minReadySeconds, 0 unless set), so they count as available to serve.",
  deploymentUnavailableReplicas:
    "How many more pods this deployment needs to be fully available, such as pods still starting, failing health checks or waiting for a node. Shown only when above zero.",
  statefulSetReplicas:
    "How many pods this StatefulSet is set to run (its desired replicas), each with a stable name such as web-0 and web-1.",
  statefulSetReadyReplicas:
    "Pods of this StatefulSet passing their readiness checks, out of the number it should run. Green when all are ready, amber when only some are, red when none are.",
  daemonSetDesiredScheduled:
    "How many nodes should run this DaemonSet's pod: every node its node selector, affinity and tolerations allow.",
  daemonSetCurrentScheduled:
    "How many of the nodes that should run this DaemonSet's pod have one placed on them right now, even if it has not started yet.",
  daemonSetNumberReady:
    "Nodes whose pod for this DaemonSet is running and passing its readiness check, out of the nodes that should run one. Green when all are, amber when some are, red when none are.",
  daemonSetNumberAvailable:
    "Nodes whose pod for this DaemonSet has stayed ready for at least its minimum ready time (minReadySeconds), out of the nodes that should run one.",
  jobCompletions:
    "How many pods must finish successfully for this job to be complete. 0 means no count was set, so the job is done once any pod succeeds and the rest have stopped.",
  jobParallelism:
    "The most pods of this job that may run at the same time. 0 means the job is effectively paused.",
  jobBackoffLimit:
    "How many times Kubernetes retries this job's failed pods before it gives up and marks the whole job as failed. Kubernetes uses 6 unless the job sets another value.",
  jobActive:
    "Pods of this job that are pending or running right now, as of the latest snapshot from your cluster.",
  jobSucceeded:
    "Pods of this job that have finished successfully. When the job sets a completions count, it is done once this reaches that count.",
  jobFailed:
    "Pods of this job that ended in failure, counting every retry. Once failures go past the backoff limit, Kubernetes stops retrying and marks the job as failed.",
  cronJobActiveJobs:
    "Meant to be the jobs this CronJob started that are still running. It is not read correctly from Kubernetes yet and shows 0 even during a run, so check the Jobs list for runs in progress.",
  cronJobSuccessfulJobsHistoryLimit:
    "How many finished, successful runs (Jobs) of this CronJob Kubernetes keeps before deleting the oldest. Kubernetes keeps 3 unless the CronJob sets another value; 0 keeps none.",
  cronJobFailedJobsHistoryLimit:
    "How many failed runs (Jobs) of this CronJob Kubernetes keeps, so you can look into them, before deleting the oldest. Kubernetes keeps 1 unless the CronJob sets another value.",
  pvcRequestedStorage:
    "The amount of storage this claim asked for. Kubernetes binds it to a volume at least this big, so the provisioned capacity can be larger.",
  hpaMetrics:
    "What this autoscaler watches and the level it aims for. For example, cpu (Utilization: 70) keeps average CPU near 70% of the pods' CPU requests; custom, external and per-container targets show only their type name.",
  vpaRecommendation:
    "The CPU and memory request the Vertical Pod Autoscaler recommends for this container, based on its observed usage (its target value). CPU is in cores or millicores (m); memory is in bytes or a unit such as k, Mi or Gi.",

  containerState:
    "What this container is doing right now: running, waiting (for example pulling its image or backing off after a crash) or terminated (it finished or was stopped).",
  containerReady:
    "Yes when this container is running and passing its readiness check; one without a readiness check counts as ready once it runs. A pod only gets traffic from Services once all its containers are ready.",
  containerRequests:
    "The CPU and memory this container asks Kubernetes to set aside for it; a pod is only placed on a node with that much free. CPU is in cores, and an m suffix means thousandths of a core.",
  containerLimits:
    "The most CPU and memory this container may use. At its CPU limit it is slowed down (throttled); if it goes over its memory limit it is killed (OOMKilled).",
};
