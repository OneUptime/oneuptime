/*
 * A probes × targets latency grid. Each cell is the latest response time a
 * probe measured for a monitor, so operators can see at a glance which
 * probe locations are slow to which targets. Built from each monitor's
 * per-probe last-check snapshot; no new data collection.
 */
export interface LatencyMatrixAxisItem {
  id: string;
  name: string;
}

export interface LatencyMatrixCell {
  monitorId: string;
  probeId: string;
  hasData: boolean;
  latencyInMs?: number | undefined;
  isOnline?: boolean | undefined;
  // Age of the measurement in seconds, so the UI can dim stale cells.
  ageInSeconds?: number | undefined;
}

export default interface LatencyMatrix {
  monitors: Array<LatencyMatrixAxisItem>;
  probes: Array<LatencyMatrixAxisItem>;
  // Keyed cells[monitorId][probeId].
  cells: Record<string, Record<string, LatencyMatrixCell>>;
}
