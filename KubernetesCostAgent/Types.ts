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
  gpuHours?: number | undefined;
  ramByteHours?: number | undefined;
  ramBytesRequestAverage?: number | undefined;
  ramBytesUsageAverage?: number | undefined;
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

export interface KubernetesCostIngestPayload {
  clusterName: string;
  currency?: string | undefined;
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
 * Allocation API response envelope. `data` is one allocation-set per step;
 * with accumulate=true there is exactly one set for the whole window.
 */
export interface EngineAllocationResponse {
  code?: number;
  data?: Array<Record<string, EngineAllocation> | null> | null;
}
