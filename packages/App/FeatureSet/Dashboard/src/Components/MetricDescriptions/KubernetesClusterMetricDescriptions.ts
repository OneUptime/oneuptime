/*
 * What each number on the Kubernetes cluster pages means, in plain words:
 * the cluster overview (Pages/Kubernetes/View/Index.tsx), the Insights
 * network chart, the cluster and project Costs pages and the Right-Sizing
 * card. Shown in the (i) tooltip beside a tile, chart, count or column title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest. Four things are easy to get wrong:
 *
 * - The overview's golden tiles average the chart points that START in the
 *   LAST 5 MINUTES of the selected range, falling back to the whole range
 *   when none does - which is what usually happens on ranges over 12 hours,
 *   whose points are 15 minutes or wider. The charts plot the whole range.
 * - The filesystem numbers are per NODE: kubeletstats reports one root
 *   filesystem per node, with no mount or device attribute.
 * - Health, counts, pod phases and node pressure come from the latest
 *   inventory snapshot and ignore the time range picker. So do the top
 *   consumers, which read each pod's latest minute from the past hour.
 * - The cluster Costs page folds "unallocated" cost into idle spend; the
 *   project Costs page counts only idle capacity as idle.
 *
 * Change the fetch, change the words.
 */

export type KubernetesClusterMetric =
  | "availability"
  | "cpu"
  | "memory"
  | "filesystem"
  | "network"
  | "availabilityChart"
  | "cpuChart"
  | "memoryChart"
  | "filesystemChart"
  | "networkChart"
  | "inventoryCounts"
  | "podsRunning"
  | "podsPending"
  | "podsFailed"
  | "nodesNotReady"
  | "clusterHealth"
  | "nodes"
  | "pods"
  | "namespaces"
  | "agentStatus"
  | "memoryPressure"
  | "diskPressure"
  | "pidPressure"
  | "podHealth"
  | "topCpuPods"
  | "topMemoryPods"
  | "networkThroughput";

export const KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS: Record<
  KubernetesClusterMetric,
  string
> = {
  // Golden tiles - the last 5 minutes of the selected range.
  availability:
    "Share of the selected range in which OneUptime received metrics (a heartbeat) from this cluster's agent, leaving out the latest intervals whose data may still be arriving. It shows whether the cluster was reporting, not whether your apps were up.",
  cpu: "CPU in use across all nodes as a share of allocatable CPU - the CPU Kubernetes can hand out to pods. Averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data).",
  memory:
    "Memory in use on all nodes added together, averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). It includes file cache the system can free, so it reads higher than what apps need.",
  filesystem:
    "Used space divided by used plus free space on each node's disk, averaged across nodes over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). One nearly full node can hide behind emptier ones.",
  network:
    "Bytes per second received plus sent, added up across every node and network interface and averaged over the last 5 minutes of the selected range (often the whole range on ranges over 12 hours or without recent data). The line below splits it into in and out.",

  // Charts under the tiles - every interval of the selected range.
  availabilityChart:
    "Whether the cluster's agent sent metrics (a heartbeat) in each interval: Up if any arrived, Down if none did. The badge is the share of intervals that were up over the selected range.",
  cpuChart:
    "Cluster CPU in use as a share of total allocatable CPU (what Kubernetes can hand out to pods) in each interval. Stays empty when the nodes do not report allocatable CPU.",
  memoryChart:
    "Memory in use on all nodes added together in each interval, in bytes. Includes file cache the system can free when apps need the memory.",
  filesystemChart:
    "Average disk fullness in each interval: for every node, used space divided by used plus free space on its disk, then averaged across the nodes.",
  networkChart:
    "Bytes per second received (In) and sent (Out) in each interval, added up across all nodes and network interfaces. Worked out from the running byte counters the nodes report.",

  // Hero chips - the latest inventory snapshot.
  inventoryCounts:
    "Counts from the latest inventory the Kubernetes agent sent: nodes, pods in any phase, namespaces, deployments, and containers defined in pod specs (init containers are not counted). They ignore the time range picker.",
  podsRunning:
    "Pods placed on a node with at least one container running, starting or restarting. Running does not mean healthy - a container can still be failing its readiness check.",
  podsPending:
    "Pods the cluster has accepted but not started yet - usually waiting for a node with enough free CPU or memory, for an image to download, or for a volume. Any pending pod marks the cluster Degraded.",
  podsFailed:
    "Pods whose containers have all stopped, with at least one ending in an error; they will not be restarted. Any failed pod, even one left behind by a finished job, marks the cluster Unhealthy.",
  nodesNotReady:
    "Nodes whose Ready check is not passing - the node agent (kubelet) is unhealthy, cannot run pods or has stopped reporting - so no new pods are placed on them. Any such node marks the cluster Unhealthy.",

  // Summary cards - the latest inventory snapshot.
  clusterHealth:
    "Worked out from the latest inventory, not the selected range: Unhealthy if any pod has failed or any node is not ready, Degraded if any pod is pending or a node reports memory, disk or process pressure, otherwise Healthy.",
  nodes:
    "Nodes (the machines that run your pods) in the latest inventory, not the selected range. Nodes whose Ready check is failing are called out as not ready - new pods are not placed on them.",
  pods: "Pods in the latest inventory in any phase - running, pending, completed or failed - not limited to the selected range. A pod is one or more containers that run together on a node.",
  namespaces:
    "Namespaces in the latest inventory. A namespace is a named group that keeps one team's or app's resources separate from the rest of the cluster.",
  agentStatus:
    "Connected while the Kubernetes agent keeps sending data to OneUptime; it switches to Disconnected after about 15 minutes of silence. While disconnected, inventory counts on this page keep their last reported values.",

  // Node pressure banner - nodes reporting each condition right now.
  memoryPressure:
    "The node is running low on memory. Kubernetes stops placing new pods on it and may evict running pods to free memory.",
  diskPressure:
    "The node is running low on disk space for images and container data. Kubernetes may evict pods and delete unused images to free space.",
  pidPressure:
    "The node is close to its limit on running processes (PIDs). New containers may fail to start and Kubernetes may evict pods.",

  podHealth:
    "Pods by phase in the latest inventory: Running, Succeeded (all containers finished without error, such as completed jobs), Pending (not started yet) and Failed (stopped with an error). Not tied to the time range.",

  // Top consumers - each pod's latest minute from the past hour.
  topCpuPods:
    "The 5 pods using the most CPU, as a share of the allocatable CPU of the node each runs on. Uses each pod's latest minute of data from the past hour, not the time range picker; if nodes report no allocatable CPU, the value is in cores.",
  topMemoryPods:
    "The 5 pods using the most memory, as a share of the allocatable memory of the node each runs on, with the amount below. Uses each pod's latest minute of data from the past hour, not the time range picker.",

  // Insights page network card.
  networkThroughput:
    "Bytes per second received and transmitted in each interval, added up across every node and network interface the agent reports. Worked out from the nodes' running byte counters rather than sampled directly.",
};

export type KubernetesCostMetric =
  // Cluster Costs page.
  | "totalSpend"
  | "workloadSpend"
  | "idleSpend"
  | "idlePercent"
  | "spendTrend"
  | "namespaceCpuCost"
  | "namespaceMemoryCost"
  | "namespaceStorageCost"
  | "namespaceOtherCost"
  | "namespaceTotalCost"
  | "workloadTotalCost"
  | "efficiency"
  // Project (all clusters) Costs page.
  | "fleetTotalSpend"
  | "fleetWorkloadSpend"
  | "fleetIdleSpend"
  | "fleetIdlePercent"
  | "fleetSpendTrend"
  | "clusterWorkloadCost"
  | "clusterIdleCost"
  | "clusterTotalCost"
  | "clusterEfficiency";

export const KUBERNETES_COST_METRIC_DESCRIPTIONS: Record<
  KubernetesCostMetric,
  string
> = {
  totalSpend:
    "Everything this cluster cost in the selected range, as priced by its cost engine: CPU, memory, GPUs, storage, network and load balancers, including capacity no workload used.",
  workloadSpend:
    "The part of total spend charged to namespaces and workloads - total spend minus idle and unallocated capacity.",
  idleSpend:
    "Cost of node capacity that no workload requested or used in the selected range (idle), plus cost the engine reports as unallocated. Running fewer or smaller nodes lowers it.",
  idlePercent:
    "Idle spend as a share of total spend in the selected range. The bar turns amber at 25% and red at 40% - a high share means paying for node capacity your workloads do not use.",
  spendTrend:
    "Cluster cost over time, idle capacity included. Each point adds up the cost records that start in that interval of the chart, so longer ranges use bigger intervals and show taller points.",
  namespaceCpuCost:
    "Cost of the CPU this namespace was charged for in the selected range. The cost engine charges for the larger of what was requested and what was used.",
  namespaceMemoryCost:
    "Cost of the memory this namespace was charged for in the selected range, based on the larger of requested and used memory.",
  namespaceStorageCost:
    "Cost of the persistent volumes (disks that outlive a pod) this namespace used in the selected range.",
  namespaceOtherCost:
    "Everything in the namespace's total that is not CPU, memory or storage, such as GPUs, network traffic, load balancers and shared costs.",
  namespaceTotalCost:
    "All costs for this namespace in the selected range. The percentage and bar show its share of the cluster's total spend, idle capacity included.",
  workloadTotalCost:
    "All costs for this workload (a Deployment, StatefulSet, Job and so on) in the selected range. The percentage and bar show its share of workload spend, which leaves idle capacity out.",
  efficiency:
    "How much of the requested CPU and memory was actually used, averaged over the cost records in the range; above 100% means more was used than requested. Green from 70%, red below 40% - low values mean paying for unused requests.",

  fleetTotalSpend:
    "Everything all Kubernetes clusters in this project cost in the selected range, as priced by each cluster's cost engine, including capacity no workload used.",
  fleetWorkloadSpend:
    "Total spend minus idle capacity, across all clusters. Cost an engine reports as unallocated is counted here rather than as idle.",
  fleetIdleSpend:
    "Cost of node capacity that no workload requested or used, across all clusters in the selected range. Unallocated cost is not included here.",
  fleetIdlePercent:
    "Idle spend as a share of total spend across all clusters in the selected range. The bar turns amber at 25% and red at 40%.",
  fleetSpendTrend:
    "Cost of all clusters over time, idle capacity included. Each point adds up the cost records that start in that interval of the chart, so longer ranges show taller points.",
  clusterWorkloadCost:
    "What this cluster spent on workloads in the selected range: its total cost minus idle capacity.",
  clusterIdleCost:
    "What this cluster spent in the selected range on node capacity that no workload requested or used.",
  clusterTotalCost:
    "Everything this cluster cost in the selected range. The percentage and bar show its share of spend across all clusters.",
  clusterEfficiency:
    "Average share of requested CPU and memory that was actually used, over all of this cluster's cost records in the range, idle-capacity records included. Green from 70%, red below 40%.",
};

export type KubernetesRightSizingMetric =
  | "potentialSaving"
  | "overprovisioned"
  | "underprovisioned"
  | "analyzed"
  | "cpuRequest"
  | "memoryRequest"
  | "estimatedSaving";

export const KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS: Record<
  KubernetesRightSizingMetric,
  string
> = {
  potentialSaving:
    "Estimated monthly saving if every recommendation below were applied, scaled from the selected range to a 730-hour month. Containers that would cost more after the change are not subtracted from it.",
  overprovisioned:
    "Containers whose recommendation (observed demand plus 25% headroom) is more than 15% below their current CPU or memory request. Lowering those requests frees node capacity and saves money.",
  underprovisioned:
    "Containers whose recommendation is more than 15% above their CPU or memory request. They use more than they reserve, so a busy node can slow them down, and they are among the first killed or evicted when memory runs short.",
  analyzed:
    "Containers with cost data in the selected range, including ones already right-sized. Each container of a workload counts once however many replicas it runs; idle capacity is left out.",
  cpuRequest:
    "Current CPU request and the recommended one: the 95th percentile of hourly CPU usage (95% of hourly readings were lower) plus 25% headroom. Needs 24 hours of data; within 15% counts as right-sized.",
  memoryRequest:
    "Current memory request and the recommended one: the highest memory peak any replica reached, plus 25% headroom. Shows - when there is under 24 hours of data or no peak (the agent reads peaks from Prometheus).",
  estimatedSaving:
    "Projected monthly change in cost if this container's recommendation is applied, scaled from the selected range to a 730-hour month. Green is a saving; amber with + is the extra cost of giving it enough.",
};
