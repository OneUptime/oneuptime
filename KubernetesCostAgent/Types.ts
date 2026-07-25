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
  allocations: Array<KubernetesCostAllocationIngestRow>;
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
  ramByteHours?: number;
  ramBytesRequestAverage?: number;
  ramBytesUsageAverage?: number;
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
