/*
 * Right-sizing recommendations for Kubernetes workloads.
 *
 * Pure math over aggregates the cost pipeline already stores, kept out of
 * the dashboard so it can be unit-tested and reused server-side (digests,
 * alerts) without a browser.
 *
 * One asymmetry drives every choice in this file: a CPU request set too low
 * throttles a container, a memory request set too low gets it OOMKilled.
 * So CPU is sized from a P95 of hourly averages, while memory is sized only
 * ever from a true peak — never from an average, and not at all when the
 * peak is unknown. See `ramBytesUsageMax` on the KubernetesCostAllocation
 * model for why a 0 peak has to mean "unknown".
 */

/** Hours in an average month (365 * 24 / 12), for monthly projections. */
export const HOURS_IN_MONTH: number = 730;

/*
 * A workload has to be observed for at least a day before it gets a
 * recommendation. A four-hour window catches a nightly batch job at rest
 * and would happily advise shrinking it to nothing.
 */
export const MIN_OBSERVED_HOURS: number = 24;
export const MIN_SAMPLE_COUNT: number = 24;

/*
 * Headroom over observed demand. CPU can be tighter than memory because
 * overshooting CPU costs latency while overshooting memory costs the pod.
 */
export const CPU_HEADROOM_RATIO: number = 0.25;
export const MEMORY_HEADROOM_RATIO: number = 0.25;

/*
 * Floors, so a near-idle sidecar is never told to request 1m of CPU or
 * 4Mi of RAM — values that schedule badly and read as noise.
 */
export const MIN_RECOMMENDED_CPU_CORES: number = 0.01;
export const MIN_RECOMMENDED_MEMORY_BYTES: number = 32 * 1024 * 1024;

/*
 * Nobody should edit a manifest to shave 3% off a request, so a
 * recommendation within this band of the current value reads as "Optimal".
 */
export const SIGNIFICANCE_RATIO: number = 0.15;

const CPU_ROUNDING_STEP_CORES: number = 0.01; // 10 millicores
const MEMORY_ROUNDING_STEP_BYTES: number = 16 * 1024 * 1024; // 16 MiB

export enum RightSizingVerdict {
  /** Requesting materially more than observed demand — money on the table. */
  Overprovisioned = "Overprovisioned",
  /** Requesting materially less than observed demand — throttle / OOM risk. */
  Underprovisioned = "Underprovisioned",
  /** Request already sits within the significance band of the recommendation. */
  Optimal = "Optimal",
  /** No request set at all. A scheduling problem, not a cost one. */
  NoRequestSet = "NoRequestSet",
  /** Not enough signal to advise anything. Never guess here. */
  Unavailable = "Unavailable",
}

export interface ResourceRecommendation {
  /** Current per-container request. Null when none is set. */
  current: number | null;
  /** What the request should be. Null when we cannot say. */
  recommended: number | null;
  /** Observed demand the recommendation was built from (P95 CPU / peak RAM). */
  observedDemand: number | null;
  verdict: RightSizingVerdict;
  /**
   * Spend change over the observed window if the recommendation is applied.
   * Negative saves money, positive costs more (an under-provisioned
   * workload is under-charged today precisely because it is starved).
   */
  costDeltaInWindow: number;
  /** Why the recommendation is unavailable, for the UI to explain itself. */
  unavailableReason?: string | undefined;
}

/**
 * One container's recommendation. Keyed by controller rather than pod:
 * requests live in the pod template, so advice has to be per-container of a
 * controller to be actionable.
 */
export interface RightSizingRecommendation {
  namespace: string;
  controllerKind: string;
  controllerName: string;
  containerName: string;
  cpu: ResourceRecommendation;
  memory: ResourceRecommendation;
  /** Spend on this container over the observed window (CPU + RAM). */
  costInWindow: number;
  /** Projected monthly saving. Clamped at 0 — an increase is not a saving. */
  estimatedMonthlySavings: number;
  /** Projected monthly cost increase from fixing under-provisioning. */
  estimatedMonthlyIncrease: number;
  sampleCount: number;
}

/**
 * Per-container aggregates over the whole window. CPU usage is a P95 of the
 * hourly averages; memory usage is the maximum of the per-window peaks, so
 * it survives a burst that an average would smooth away.
 */
export interface RightSizingObservation {
  namespace: string;
  controllerKind: string;
  controllerName: string;
  containerName: string;
  /** Rows behind these aggregates — replicas * windows. */
  sampleCount: number;
  cpuCoreRequestAverage: number;
  cpuCoreUsageP95: number;
  cpuCost: number;
  ramBytesRequestAverage: number;
  /** Max of `ramBytesUsageMax`. 0 means unknown, never a real peak of zero. */
  ramBytesUsagePeak: number;
  ramCost: number;
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/*
 * Cost scales with what the engine allocated, which is max(request, usage)
 * — a container burning more than it asked for is billed for what it burnt.
 * Using that as the denominator keeps the delta honest in both directions.
 *
 * In the case that actually produces a savings headline (request above
 * demand) this collapses to the request, so the estimate there is exact
 * rather than approximate.
 */
function getAllocatedBasis(request: number, demand: number): number {
  return Math.max(request, demand);
}

interface BuildResourceInput {
  request: number;
  demand: number;
  demandIsKnown: boolean;
  cost: number;
  headroomRatio: number;
  floor: number;
  roundingStep: number;
  unknownDemandReason: string;
}

function buildResourceRecommendation(
  input: BuildResourceInput,
): ResourceRecommendation {
  const request: number = input.request > 0 ? input.request : 0;

  if (!input.demandIsKnown || !Number.isFinite(input.demand)) {
    return {
      current: request > 0 ? request : null,
      recommended: null,
      observedDemand: null,
      verdict: RightSizingVerdict.Unavailable,
      costDeltaInWindow: 0,
      unavailableReason: input.unknownDemandReason,
    };
  }

  const demand: number = Math.max(0, input.demand);
  const recommended: number = Math.max(
    input.floor,
    roundUpTo(demand * (1 + input.headroomRatio), input.roundingStep),
  );

  /*
   * A container with no request is a scheduling risk (it can be evicted or
   * scheduled onto a node that cannot hold it), but there is no request to
   * shrink, so it never contributes a saving.
   */
  if (request <= 0) {
    return {
      current: null,
      recommended: recommended,
      observedDemand: demand,
      verdict: RightSizingVerdict.NoRequestSet,
      costDeltaInWindow: 0,
    };
  }

  const basis: number = getAllocatedBasis(request, demand);
  const costDeltaInWindow: number =
    basis > 0 ? input.cost * (recommended / basis - 1) : 0;

  const ratio: number = recommended / request;

  let verdict: RightSizingVerdict = RightSizingVerdict.Optimal;
  if (ratio < 1 - SIGNIFICANCE_RATIO) {
    verdict = RightSizingVerdict.Overprovisioned;
  } else if (ratio > 1 + SIGNIFICANCE_RATIO) {
    verdict = RightSizingVerdict.Underprovisioned;
  }

  return {
    current: request,
    recommended: recommended,
    observedDemand: demand,
    verdict: verdict,
    // Within the significance band we advise no change, so nothing moves.
    costDeltaInWindow:
      verdict === RightSizingVerdict.Optimal ? 0 : costDeltaInWindow,
  };
}

const INSUFFICIENT_DATA_REASON: string =
  "Not enough history yet — a workload needs at least a day of cost windows before it can be sized.";

const NO_MEMORY_PEAK_REASON: string =
  "No memory peak available. The agent reads peaks from Prometheus; without one, a memory request could only be guessed from an average, which is how containers get OOMKilled.";

/**
 * Turns one container's window aggregates into a recommendation.
 *
 * `observedHours` is the wall-clock length of the query window and is what
 * monthly projections scale by — not the sample count, which counts
 * replicas too and would multiply a Deployment's savings by its replica
 * count.
 */
export function buildRightSizingRecommendation(
  observation: RightSizingObservation,
  observedHours: number,
): RightSizingRecommendation {
  const costInWindow: number =
    (observation.cpuCost || 0) + (observation.ramCost || 0);

  const hasEnoughHistory: boolean =
    observedHours >= MIN_OBSERVED_HOURS &&
    observation.sampleCount >= MIN_SAMPLE_COUNT;

  const cpu: ResourceRecommendation = buildResourceRecommendation({
    request: observation.cpuCoreRequestAverage,
    demand: observation.cpuCoreUsageP95,
    demandIsKnown: hasEnoughHistory,
    cost: observation.cpuCost || 0,
    headroomRatio: CPU_HEADROOM_RATIO,
    floor: MIN_RECOMMENDED_CPU_CORES,
    roundingStep: CPU_ROUNDING_STEP_CORES,
    unknownDemandReason: INSUFFICIENT_DATA_REASON,
  });

  /*
   * A zero peak is indistinguishable from "the agent never reported one",
   * so it is treated as unknown. Sizing memory off the average instead is
   * the one shortcut this feature must not take.
   */
  const hasMemoryPeak: boolean = observation.ramBytesUsagePeak > 0;

  const memory: ResourceRecommendation = buildResourceRecommendation({
    request: observation.ramBytesRequestAverage,
    demand: observation.ramBytesUsagePeak,
    demandIsKnown: hasEnoughHistory && hasMemoryPeak,
    cost: observation.ramCost || 0,
    headroomRatio: MEMORY_HEADROOM_RATIO,
    floor: MIN_RECOMMENDED_MEMORY_BYTES,
    roundingStep: MEMORY_ROUNDING_STEP_BYTES,
    unknownDemandReason: hasEnoughHistory
      ? NO_MEMORY_PEAK_REASON
      : INSUFFICIENT_DATA_REASON,
  });

  const windowDelta: number = cpu.costDeltaInWindow + memory.costDeltaInWindow;
  const monthlyFactor: number =
    observedHours > 0 ? HOURS_IN_MONTH / observedHours : 0;
  const monthlyDelta: number = windowDelta * monthlyFactor;

  return {
    namespace: observation.namespace,
    controllerKind: observation.controllerKind,
    controllerName: observation.controllerName,
    containerName: observation.containerName,
    cpu: cpu,
    memory: memory,
    costInWindow: costInWindow,
    estimatedMonthlySavings: monthlyDelta < 0 ? -monthlyDelta : 0,
    estimatedMonthlyIncrease: monthlyDelta > 0 ? monthlyDelta : 0,
    sampleCount: observation.sampleCount,
  };
}

/** True when a recommendation is worth showing at all. */
export function hasActionableRecommendation(
  recommendation: RightSizingRecommendation,
): boolean {
  const actionable: Array<RightSizingVerdict> = [
    RightSizingVerdict.Overprovisioned,
    RightSizingVerdict.Underprovisioned,
    RightSizingVerdict.NoRequestSet,
  ];

  return (
    actionable.includes(recommendation.cpu.verdict) ||
    actionable.includes(recommendation.memory.verdict)
  );
}

/**
 * Formats cores the way Kubernetes writes them, so the value can be pasted
 * straight into a manifest: sub-core as millicores, whole cores as decimals.
 */
export function formatCpuCores(cores: number | null): string {
  if (cores === null || !Number.isFinite(cores)) {
    return "-";
  }

  if (cores < 1) {
    return `${Math.round(cores * 1000)}m`;
  }

  return `${Number(cores.toFixed(2))}`;
}

/** Formats bytes as a Kubernetes binary quantity (`512Mi`, `2Gi`). */
export function formatMemoryBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "-";
  }

  const gibibyte: number = 1024 * 1024 * 1024;
  const mebibyte: number = 1024 * 1024;

  if (bytes >= gibibyte) {
    return `${Number((bytes / gibibyte).toFixed(2))}Gi`;
  }

  if (bytes >= mebibyte) {
    return `${Math.round(bytes / mebibyte)}Mi`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))}Ki`;
}

/** Human label for a verdict. */
export function getVerdictLabel(verdict: RightSizingVerdict): string {
  switch (verdict) {
    case RightSizingVerdict.Overprovisioned:
      return "Over-provisioned";
    case RightSizingVerdict.Underprovisioned:
      return "Under-provisioned";
    case RightSizingVerdict.Optimal:
      return "Right-sized";
    case RightSizingVerdict.NoRequestSet:
      return "No request set";
    default:
      return "Unavailable";
  }
}
