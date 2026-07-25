import { EngineAllocation, KubernetesCostAllocationIngestRow } from "./Types";

/*
 * Pure mapping helpers, kept free of Config imports so tests can load them
 * without the agent's required environment variables.
 */

/*
 * Engine sentinels for non-workload capacity. When an allocation has no
 * namespace but its name is one of these, the sentinel becomes the
 * namespace so idle spend groups cleanly server-side.
 */
const SENTINEL_NAMES: Array<string> = ["__idle__", "__unallocated__"];

export const mapAllocationToRow: (data: {
  allocation: EngineAllocation;
  windowStart: Date;
  windowEnd: Date;
}) => KubernetesCostAllocationIngestRow = (data: {
  allocation: EngineAllocation;
  windowStart: Date;
  windowEnd: Date;
}): KubernetesCostAllocationIngestRow => {
  const allocation: EngineAllocation = data.allocation;
  const properties: NonNullable<EngineAllocation["properties"]> =
    allocation.properties || {};

  let namespace: string = properties.namespace || "";
  if (!namespace && allocation.name) {
    const sentinel: string | undefined = SENTINEL_NAMES.find(
      (name: string): boolean => {
        return allocation.name === name || allocation.name!.includes(name);
      },
    );
    if (sentinel) {
      namespace = sentinel;
    }
  }

  /*
   * Prefer the allocation's own window (the engine reports what it actually
   * covered); fall back to the requested window.
   */
  const windowStart: string =
    allocation.window?.start ||
    allocation.start ||
    data.windowStart.toISOString();
  const windowEnd: string =
    allocation.window?.end || allocation.end || data.windowEnd.toISOString();

  return {
    windowStart,
    windowEnd,
    namespace,
    controllerKind: properties.controllerKind || "",
    controllerName: properties.controller || "",
    podName: properties.pod || "",
    containerName: properties.container || "",
    nodeName: properties.node || "",
    providerId: properties.providerID || "",
    labels: properties.labels || {},

    cpuCoreHours: allocation.cpuCoreHours,
    cpuCoreRequestAverage: allocation.cpuCoreRequestAverage,
    cpuCoreUsageAverage: allocation.cpuCoreUsageAverage,
    gpuHours: allocation.gpuHours,
    ramByteHours: allocation.ramByteHours,
    ramBytesRequestAverage: allocation.ramBytesRequestAverage,
    ramBytesUsageAverage: allocation.ramBytesUsageAverage,
    pvByteHours: allocation.pvByteHours,

    /*
     * Cost components include the engine's reconciliation adjustments so
     * what OneUptime shows matches the engine's own UI.
     */
    cpuCost: (allocation.cpuCost || 0) + (allocation.cpuCostAdjustment || 0),
    gpuCost: (allocation.gpuCost || 0) + (allocation.gpuCostAdjustment || 0),
    ramCost: (allocation.ramCost || 0) + (allocation.ramCostAdjustment || 0),
    pvCost: (allocation.pvCost || 0) + (allocation.pvCostAdjustment || 0),
    networkCost:
      (allocation.networkCost || 0) + (allocation.networkCostAdjustment || 0),
    loadBalancerCost:
      (allocation.loadBalancerCost || 0) +
      (allocation.loadBalancerCostAdjustment || 0),
    sharedCost: allocation.sharedCost,
    externalCost: allocation.externalCost,
    totalCost: allocation.totalCost,

    cpuEfficiency: allocation.cpuEfficiency,
    ramEfficiency: allocation.ramEfficiency,
    totalEfficiency: allocation.totalEfficiency,
  };
};

/** Floor a timestamp (ms) to the window grid. */
export const floorToWindow: (nowMs: number, windowSeconds: number) => number = (
  nowMs: number,
  windowSeconds: number,
): number => {
  const windowMs: number = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
};
