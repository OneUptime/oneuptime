/*
 * Wire contract for POST /kubernetes-cost/ingest — the payload the
 * Kubernetes agent's cost poller ships after querying an in-cluster cost
 * engine's Allocation API (OpenCost `/allocation/compute`, Kubecost
 * `/model/allocation`). One request carries one cluster's allocation rows
 * for one or more closed time windows.
 *
 * The route is mounted under both "/telemetry" and "/" (TELEMETRY_PREFIXES).
 * The agent posts to the "/telemetry" prefix — see the note in
 * KubernetesCostAgent/Shipper.ts for why.
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

  // Usage / request / limit measures.
  cpuCoreHours?: number | undefined;
  cpuCoreRequestAverage?: number | undefined;
  cpuCoreUsageAverage?: number | undefined;
  cpuCoreLimitAverage?: number | undefined;
  gpuHours?: number | undefined;
  ramByteHours?: number | undefined;
  ramBytesRequestAverage?: number | undefined;
  ramBytesUsageAverage?: number | undefined;
  ramBytesLimitAverage?: number | undefined;

  /*
   * Peak working set over the window, sourced from Prometheus rather than
   * the cost engine — the Allocation API only reports averages, and an
   * hourly mean hides the burst that OOMKills a container, so a memory
   * recommendation built on the average is actively dangerous.
   *
   * 0 when the agent has no Prometheus configured (external-engine installs
   * have no bundled one), when the scrape had no data for the window, or
   * when the agent predates this field. The server cannot tell those apart
   * from a real 0, so recommendations must require a positive value.
   */
  ramBytesUsageMax?: number | undefined;

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

  /*
   * Identity of one shipment — the agent's delivery of ONE window — and this
   * request's position within it.
   *
   * A window wider than the agent's batch size arrives as several requests,
   * each becoming its own ingest job. Without an identity the server cannot
   * tell "another chunk of the shipment I have already started" (accept)
   * from "a window an earlier shipment already delivered in full" (drop, or
   * a restart double-counts spend), so it dropped both and lost every row
   * past the first chunk on clusters above SHIP_BATCH_SIZE containers.
   *
   * shipmentId is a content hash over the window's row identities, so the
   * same window re-shipped after a restart hashes the same and its chunks
   * dedup individually. Both are absent on agents older than this contract;
   * the server then falls back to the whole-window guard.
   */
  shipmentId?: string | undefined;
  shipmentChunk?: number | undefined;

  allocations: Array<KubernetesCostAllocationIngestRow>;
}

/**
 * Upper bound on `allocations.length` per request. The poller chunks its
 * output to stay under this; the ingest endpoint rejects anything larger.
 */
export const MAX_KUBERNETES_COST_ALLOCATIONS_PER_REQUEST: number = 5000;
