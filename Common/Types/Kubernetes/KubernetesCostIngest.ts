/*
 * Wire contract for POST /kubernetes-cost/ingest — the payload the
 * Kubernetes agent's cost poller ships after querying an in-cluster cost
 * engine's Allocation API (OpenCost `/allocation/compute`, Kubecost
 * `/model/allocation`). One request carries one cluster's allocation rows
 * for one or more closed time windows.
 *
 * The agent projects are standalone (no dependency on Common), so the
 * poller carries its own mirror of these interfaces
 * (KubernetesCostAgent/Types.ts) — keep the two in sync.
 */

export interface KubernetesCostAllocationIngestRow {
  /** ISO-8601 start of the allocation window. Required. */
  windowStart: string;
  /** ISO-8601 end of the allocation window. Required. */
  windowEnd: string;

  /*
   * Workload identity. All optional — idle / unallocated rows carry the
   * engine's sentinel in `namespace` ("__idle__" / "__unallocated__") and
   * nothing else.
   */
  namespace?: string | undefined;
  controllerKind?: string | undefined;
  controllerName?: string | undefined;
  podName?: string | undefined;
  containerName?: string | undefined;
  nodeName?: string | undefined;
  providerId?: string | undefined;
  labels?: Record<string, string> | undefined;

  // Usage / request measures.
  cpuCoreHours?: number | undefined;
  cpuCoreRequestAverage?: number | undefined;
  cpuCoreUsageAverage?: number | undefined;
  gpuHours?: number | undefined;
  ramByteHours?: number | undefined;
  ramBytesRequestAverage?: number | undefined;
  ramBytesUsageAverage?: number | undefined;
  pvByteHours?: number | undefined;

  // Pre-priced cost components (in `currency` of the payload).
  cpuCost?: number | undefined;
  gpuCost?: number | undefined;
  ramCost?: number | undefined;
  pvCost?: number | undefined;
  networkCost?: number | undefined;
  loadBalancerCost?: number | undefined;
  sharedCost?: number | undefined;
  externalCost?: number | undefined;
  totalCost?: number | undefined;

  // Efficiency ratios (usage / request, 0..1+).
  cpuEfficiency?: number | undefined;
  ramEfficiency?: number | undefined;
  totalEfficiency?: number | undefined;
}

export interface KubernetesCostIngestPayload {
  /**
   * Cluster identifier — must match the k8s.cluster.name the agent stamps
   * on metrics so cost rows land on the same KubernetesCluster resource.
   */
  clusterName: string;
  /** Currency code of all cost figures (e.g. "USD"). Optional. */
  currency?: string | undefined;
  allocations: Array<KubernetesCostAllocationIngestRow>;
}

/**
 * Upper bound on `allocations.length` per request. The poller chunks its
 * output to stay under this; the ingest endpoint rejects anything larger.
 */
export const MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST: number = 5000;
