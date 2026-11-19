/*
 * Wire types.
 *
 * KubernetesCostAllocationIngestRow / KubernetesCostIngestPayload mirror
 * Common/Types/Kubernetes/KubernetesCostIngest.ts (the agent projects are
 * standalone and do not depend on Common) — keep the two in sync.
 *
 * The engine types cover the subset of the OpenCost / Kubecost Allocation
 * API response the agent reads. Both engines share this schema — the
 * kubecost/cost-model codebase is the OpenCost lineage.
 */

export interface KubernetesCostAllocationIngestRow {
  windowStart: string;
  windowEnd: string;

  namespace?: string | undefined;
  controllerKind?: string | undefined;
  controllerName?: string | undefined;
  podName?: string | undefined;
  containerName?: string | undefined;
  nodeName?: string | undefined;
  providerId?: string | undefined;
  labels?: Record<string, string> | undefined;

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
   * Peak working set over the window, from Prometheus rather than the cost
   * engine. 0 when no Prometheus is configured or it had no data — the
   * server cannot distinguish that from a genuine 0, so a right-sizing
   * recommendation must require a positive value rather than trusting it.
   */
  ramBytesUsageMax?: number | undefined;
  pvByteHours?: number | undefined;

  cpuCost?: number | undefined;
  gpuCost?: number | undefined;
  ramCost?: number | undefined;
  pvCost?: number | undefined;
  networkCost?: number | undefined;
  loadBalancerCost?: number | undefined;
  sharedCost?: number | undefined;
  externalCost?: number | undefined;
  totalCost?: number | undefined;

  cpuEfficiency?: number | undefined;
  ramEfficiency?: number | undefined;
  totalEfficiency?: number | undefined;
}

/*
 * Where an engine's prices come from (EnginePricing): a cloud's public list
 * prices, the same with a Kubecost that reconciles them with the cloud's bill
 * later (billing-integration), rates someone set, the engine's built-in
 * defaults, or unknown.
 */
export type KubernetesCostPricingSource =
  | "list-prices"
  | "billing-integration"
  | "rate-card"
  | "default-rates"
  | "unknown";

/*
 * Where the memory peaks for right-sizing come from (#9970): the Prometheus
 * the cluster's own engine reads, the chart's bundled one, the one
 * cost.engine.prometheusUrl names, or none.
 */
export type KubernetesCostMemoryPeaksSource =
  | "engine"
  | "bundled"
  | "configured"
  | "";

/*
 * Which engine priced a shipment's rows, and how. See
 * Common/Types/Kubernetes/KubernetesCostIngest.ts.
 */
export interface KubernetesCostEngineInfo {
  // "OpenCost" or "Kubecost"; empty when the agent cannot tell.
  engine: string;
  /*
   * The cluster's own engine the agent found and read, as
   * "<namespace>/<service>"; empty for the bundled one or one set in
   * cost.engine.url.
   */
  service: string;
  /*
   * True when the chart bundled an engine the agent is not reading, because
   * it found the cluster's own: a second engine the cluster need not run.
   */
  bundledEngineUnused: boolean;
  pricingSource: KubernetesCostPricingSource;
  /*
   * The cloud whose list prices apply ("AWS"), with list-prices and
   * billing-integration; empty otherwise.
   */
  pricingProvider: string;
  /*
   * Where the rows' memory peaks come from (#9970), as the poller says it.
   * "bundled" beside bundledEngineUnused: stopping the bundled engine stops
   * the Prometheus they come from too. Absent from the resolver's own word.
   */
  memoryPeaksFrom?: KubernetesCostMemoryPeaksSource | undefined;
}

export interface KubernetesCostIngestPayload {
  clusterName: string;
  currency?: string | undefined;
  // Which engine priced these rows, and how. Absent on older agents.
  costEngine?: KubernetesCostEngineInfo | undefined;
  /*
   * Shipment identity — see Common/Types/Kubernetes/KubernetesCostIngest.ts
   * for the full rationale. shipmentId is a content hash over the window's
   * row identities (stable across agent restarts); shipmentChunk is this
   * request's index within the shipment. Together they let the server accept
   * every chunk of one window while still dropping a window a previous
   * shipment already delivered.
   */
  shipmentId?: string | undefined;
  shipmentChunk?: number | undefined;
  /*
   * True when the rows are a later reading of windows shipped before
   * (#9969, EngineCorrections): the server brings what it holds for each
   * window in line with them instead of skipping a window it has.
   */
  correction?: boolean | undefined;
  allocations: Array<KubernetesCostAllocationIngestRow>;
}

/*
 * Health snapshots. Poller and Shipper each report plain facts about what
 * they have done; Health.ts is the single place that turns those facts into
 * an ok/degraded verdict, so the judgement is testable without a clock, a
 * socket or either collaborator.
 */

export interface PollerStatus {
  /** When the poller was constructed (ms epoch). */
  startedAtMs: number;
  /**
   * When a window last drained — shipped or legitimately empty (ms epoch).
   * 0 means no window has ever completed.
   */
  lastWindowCompletedAtMs: number;
  windowsCompleted: number;
  /** Ticks that have thrown back-to-back; reset by any clean tick. */
  consecutivePollFailures: number;
  lastPollError: string | null;
}

export interface ShipperStatus {
  /** Last successful POST to OneUptime (ms epoch); 0 means never. */
  lastShipOkAtMs: number;
  lastShipError: string | null;
}

export interface HealthReport {
  healthy: boolean;
  status: "ok" | "degraded";
  /** Why it is degraded, in operator-readable prose. Empty when healthy. */
  reasons: Array<string>;
  lastPollError: string | null;
  lastShipError: string | null;
  windowsCompleted: number;
  uptimeSeconds: number;
}

/** properties block of one engine allocation. */
export interface EngineAllocationProperties {
  cluster?: string;
  node?: string;
  container?: string;
  controller?: string;
  controllerKind?: string;
  namespace?: string;
  pod?: string;
  providerID?: string;
  labels?: Record<string, string>;
}

/** One allocation object as returned by the engine. */
export interface EngineAllocation {
  name?: string;
  properties?: EngineAllocationProperties;
  window?: { start?: string; end?: string };
  start?: string;
  end?: string;

  cpuCoreHours?: number;
  cpuCoreRequestAverage?: number;
  cpuCoreUsageAverage?: number;
  cpuCoreLimitAverage?: number;
  cpuCost?: number;
  cpuCostAdjustment?: number;
  gpuHours?: number;
  gpuCost?: number;
  gpuCostAdjustment?: number;
  /*
   * Singular "Byte", deliberately. The engines' Go struct fields are
   * RAMBytesRequestAverage / RAMBytesUsageAverage but their json tags are
   * `ramByteRequestAverage` / `ramByteUsageAverage` — plural field name,
   * singular wire name. Reading the field name instead of the tag yields
   * undefined, which the server's sanitizeNumber turns into a silent 0, so
   * the mismatch is invisible until someone charts memory requests. Stable
   * across every OpenCost release from v1.108 to the bundled 1.121, and
   * Kubecost shares the lineage.
   */
  ramByteHours?: number;
  ramByteRequestAverage?: number;
  ramByteUsageAverage?: number;
  ramByteLimitAverage?: number;
  ramCost?: number;
  ramCostAdjustment?: number;
  pvByteHours?: number;
  pvCost?: number;
  pvCostAdjustment?: number;
  networkCost?: number;
  networkCostAdjustment?: number;
  loadBalancerCost?: number;
  loadBalancerCostAdjustment?: number;
  sharedCost?: number;
  externalCost?: number;
  totalCost?: number;
  cpuEfficiency?: number;
  ramEfficiency?: number;
  totalEfficiency?: number;
}

/*
 * What the poller reads windows from: an engine's client, or the resolver
 * that picks the engine (CostEngineResolver) and says which it picked.
 */
export interface CostEngineSource {
  fetchAllocations(data: {
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<EngineAllocation>>;
  describe?(): KubernetesCostEngineInfo | undefined;
  // Where the engine in use answers, for /healthz and troubleshoot.sh.
  engineUrl?(): string | undefined;
  /*
   * Whether the allocations just read hold the whole of a closed window
   * (EngineCollection): false holds the window for a later tick, unshipped,
   * without counting as a failure. Absent: always.
   */
  isWindowComplete?(data: {
    windowStart: Date;
    windowEnd: Date;
    allocations: Array<EngineAllocation>;
  }): Promise<boolean>;
}

// One http_sd target group, as Prometheus reads it.
export interface ScrapeTargetGroup {
  targets: Array<string>;
  labels: Record<string, string>;
}

/*
 * Where the engine in use serves its price metrics (EngineMetrics): what the
 * collector's http_sd asks for, and what /healthz says.
 */
export interface EngineMetricsSource {
  url(): string | null;
  // Why no address is known, once a look has failed.
  reason(): string;
  targetGroups(): Array<ScrapeTargetGroup>;
}

/*
 * Allocation API response envelope. `data` is one allocation-set per step;
 * with accumulate=true there is exactly one set for the whole window.
 */
export interface EngineAllocationResponse {
  code?: number;
  data?: Array<Record<string, EngineAllocation> | null> | null;
}

/*
 * Prometheus /api/v1/query response, instant-vector shape. Note the
 * envelope carries its own status: Prometheus answers HTTP 200 with
 * status:"error" for a rejected query, so the HTTP code alone is not a
 * success check.
 */

export interface PrometheusSample {
  metric?: {
    namespace?: string;
    pod?: string;
    container?: string;
  };
  /** [unixSeconds, "<value>"] — the value is a STRING, always. */
  value?: [number, string];
}

export interface PrometheusInstantQueryResponse {
  status?: string;
  error?: string;
  data?: {
    resultType?: string;
    result?: Array<PrometheusSample>;
  };
}
