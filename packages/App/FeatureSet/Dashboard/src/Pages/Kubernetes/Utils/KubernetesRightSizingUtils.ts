import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import GroupBy from "Common/Server/Types/Database/GroupBy";
import {
  FetchCostParams,
  buildAggregateBy,
  isSentinelNamespace,
  runAggregate,
} from "./KubernetesCostUtils";
import {
  RightSizingObservation,
  RightSizingRecommendation,
  RightSizingVerdict,
  buildRightSizingRecommendation,
  hasActionableRecommendation,
} from "Common/Types/Kubernetes/KubernetesRightSizing";

/*
 * Pulls the per-container aggregates right-sizing needs out of the cost
 * table and hands them to the pure recommender in Common.
 *
 * Grouping is by (namespace, controllerKind, controllerName, containerName)
 * rather than by pod: requests live in the pod template, so per-pod advice
 * would not be something anyone can act on. Aggregating across replicas is
 * also what makes the memory peak safe — it becomes the worst peak any
 * replica hit, which is the number the shared template has to survive.
 */

/** How the four grouping columns are joined into a map key. */
const GROUP_COLUMNS: Array<string> = [
  "namespace",
  "controllerKind",
  "controllerName",
  "containerName",
];

/*
 * Kubernetes names are DNS-1123 (lowercase alphanumeric, '-' and '.'), so a
 * pipe cannot occur inside one and is safe as a composite-key separator.
 */
const KEY_SEPARATOR: string = "|";

type GroupedValues = Map<string, number>;

/*
 * Every aggregation here runs at AggregationInterval.Total, which collapses
 * to exactly one row per group. `combine` therefore never actually fires —
 * it is here so that a Max stays a Max rather than becoming a sum if this
 * ever runs bucketed.
 */
function toGroupedValues(
  result: AggregatedResult,
  combine: (existing: number, incoming: number) => number,
): GroupedValues {
  const values: GroupedValues = new Map<string, number>();

  for (const item of result.data) {
    const record: Record<string, unknown> = item as Record<string, unknown>;
    const key: string = GROUP_COLUMNS.map((column: string): string => {
      return String(record[column] ?? "");
    }).join(KEY_SEPARATOR);

    const incoming: number = (item as AggregatedModel).value || 0;
    values.set(
      key,
      values.has(key) ? combine(values.get(key)!, incoming) : incoming,
    );
  }

  return values;
}

function sum(existing: number, incoming: number): number {
  return existing + incoming;
}

function max(existing: number, incoming: number): number {
  return Math.max(existing, incoming);
}

export interface RightSizingSummary {
  /** Total monthly saving available across every actionable container. */
  totalMonthlySavings: number;
  /** Monthly cost of fixing every under-provisioned container. */
  totalMonthlyIncrease: number;
  overprovisionedCount: number;
  underprovisionedCount: number;
  noRequestSetCount: number;
  /** Containers examined, including those already right-sized. */
  analyzedCount: number;
  /**
   * Containers whose memory could not be sized because no Prometheus peak
   * reached us. Surfaced so a half-configured install explains itself
   * instead of looking like a workload with nothing to fix.
   */
  missingMemoryPeakCount: number;
}

export interface RightSizingResult {
  recommendations: Array<RightSizingRecommendation>;
  summary: RightSizingSummary;
  /** Wall-clock length of the queried window, in hours. */
  observedHours: number;
}

function isVerdict(
  recommendation: RightSizingRecommendation,
  verdict: RightSizingVerdict,
): boolean {
  return (
    recommendation.cpu.verdict === verdict ||
    recommendation.memory.verdict === verdict
  );
}

function summarize(
  recommendations: Array<RightSizingRecommendation>,
  analyzedCount: number,
  missingMemoryPeakCount: number,
): RightSizingSummary {
  const summary: RightSizingSummary = {
    totalMonthlySavings: 0,
    totalMonthlyIncrease: 0,
    overprovisionedCount: 0,
    underprovisionedCount: 0,
    noRequestSetCount: 0,
    analyzedCount: analyzedCount,
    missingMemoryPeakCount: missingMemoryPeakCount,
  };

  for (const recommendation of recommendations) {
    summary.totalMonthlySavings += recommendation.estimatedMonthlySavings;
    summary.totalMonthlyIncrease += recommendation.estimatedMonthlyIncrease;

    if (isVerdict(recommendation, RightSizingVerdict.Overprovisioned)) {
      summary.overprovisionedCount++;
    }
    if (isVerdict(recommendation, RightSizingVerdict.Underprovisioned)) {
      summary.underprovisionedCount++;
    }
    if (isVerdict(recommendation, RightSizingVerdict.NoRequestSet)) {
      summary.noRequestSetCount++;
    }
  }

  return summary;
}

/**
 * Fetches every container's window aggregates and returns the actionable
 * recommendations, highest saving first.
 *
 * CPU demand is a P95 of the hourly averages — high enough to cover real
 * load, low enough that one spike does not re-inflate the request. Memory
 * demand is the maximum of the per-window peaks, because the number a
 * memory request has to survive is the worst moment, not the typical one.
 */
export const fetchRightSizingRecommendations: (
  params: FetchCostParams,
) => Promise<RightSizingResult> = async (
  params: FetchCostParams,
): Promise<RightSizingResult> => {
  const groupBy: GroupBy<KubernetesCostAllocation> = {
    namespace: true,
    controllerKind: true,
    controllerName: true,
    containerName: true,
  };

  type Measure = {
    column: keyof KubernetesCostAllocation;
    aggregationType: AggregationType;
    combine: (existing: number, incoming: number) => number;
  };

  const measures: Array<Measure> = [
    {
      column: "cpuCoreRequestAverage",
      aggregationType: AggregationType.Avg,
      combine: max,
    },
    {
      column: "cpuCoreUsageAverage",
      aggregationType: AggregationType.P95,
      combine: max,
    },
    { column: "cpuCost", aggregationType: AggregationType.Sum, combine: sum },
    {
      column: "ramBytesRequestAverage",
      aggregationType: AggregationType.Avg,
      combine: max,
    },
    {
      column: "ramBytesUsageMax",
      aggregationType: AggregationType.Max,
      combine: max,
    },
    { column: "ramCost", aggregationType: AggregationType.Sum, combine: sum },
    {
      column: "totalCost",
      aggregationType: AggregationType.Count,
      combine: sum,
    },
  ];

  const results: Array<AggregatedResult> = await Promise.all(
    measures.map((measure: Measure): Promise<AggregatedResult> => {
      return runAggregate(
        buildAggregateBy({
          params,
          aggregateColumnName: measure.column,
          aggregationType: measure.aggregationType,
          groupBy,
          aggregationInterval: AggregationInterval.Total,
        }),
      );
    }),
  );

  const [
    cpuRequest,
    cpuUsageP95,
    cpuCost,
    ramRequest,
    ramUsagePeak,
    ramCost,
    sampleCount,
  ] = results.map((result: AggregatedResult, index: number): GroupedValues => {
    return toGroupedValues(result, measures[index]!.combine);
  }) as [
    GroupedValues,
    GroupedValues,
    GroupedValues,
    GroupedValues,
    GroupedValues,
    GroupedValues,
    GroupedValues,
  ];

  const observedHours: number = Math.max(
    0,
    (params.endDate.getTime() - params.startDate.getTime()) / (1000 * 60 * 60),
  );

  const recommendations: Array<RightSizingRecommendation> = [];
  let analyzedCount: number = 0;
  let missingMemoryPeakCount: number = 0;

  /*
   * Iterate the sample-count map: it is a Count, so it holds a key for
   * every group in the window even when every measure on it is zero.
   */
  for (const [key, samples] of sampleCount) {
    const [namespace, controllerKind, controllerName, containerName] =
      key.split(KEY_SEPARATOR);

    /*
     * Idle and unallocated capacity are not workloads — they have no
     * requests to right-size. Rows without a container are the engine's
     * pod- or controller-level rollups, which the per-container advice
     * would double-count.
     */
    if (isSentinelNamespace(namespace || "") || !containerName) {
      continue;
    }

    const observation: RightSizingObservation = {
      namespace: namespace || "",
      controllerKind: controllerKind || "",
      controllerName: controllerName || "",
      containerName: containerName,
      sampleCount: samples,
      cpuCoreRequestAverage: cpuRequest.get(key) || 0,
      cpuCoreUsageP95: cpuUsageP95.get(key) || 0,
      cpuCost: cpuCost.get(key) || 0,
      ramBytesRequestAverage: ramRequest.get(key) || 0,
      ramBytesUsagePeak: ramUsagePeak.get(key) || 0,
      ramCost: ramCost.get(key) || 0,
    };

    analyzedCount++;

    if (observation.ramBytesUsagePeak <= 0) {
      missingMemoryPeakCount++;
    }

    const recommendation: RightSizingRecommendation =
      buildRightSizingRecommendation(observation, observedHours);

    if (hasActionableRecommendation(recommendation)) {
      recommendations.push(recommendation);
    }
  }

  recommendations.sort(
    (a: RightSizingRecommendation, b: RightSizingRecommendation): number => {
      /*
       * Savings first, because that is what the page is for. Containers
       * with no saving to offer (under-provisioned, or missing a request)
       * fall below, ordered by what they cost today so the biggest
       * reliability risks still surface near the top.
       */
      if (b.estimatedMonthlySavings !== a.estimatedMonthlySavings) {
        return b.estimatedMonthlySavings - a.estimatedMonthlySavings;
      }
      return b.costInWindow - a.costInWindow;
    },
  );

  return {
    recommendations: recommendations,
    summary: summarize(recommendations, analyzedCount, missingMemoryPeakCount),
    observedHours: observedHours,
  };
};
