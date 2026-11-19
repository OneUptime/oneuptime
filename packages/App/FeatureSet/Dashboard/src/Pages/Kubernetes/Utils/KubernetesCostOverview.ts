import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import GroupBy from "Common/Server/Types/Database/GroupBy";
import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";
import ObjectID from "Common/Types/ObjectID";
import {
  FetchCostParams,
  buildAggregateBy,
  isSentinelNamespace,
  runAggregate,
} from "./KubernetesCostUtils";

/*
 * WHAT A CLUSTER'S OVERVIEW SAYS ABOUT ITS COST (#9548).
 *
 * The Costs page answers "where did the money go" for any range. The
 * overview answers the questions asked on the way past: what does this
 * cluster cost, how much of it pays for nothing, how well is what it pays
 * for used, and who spends the most. So it reads two fixed windows, not the
 * page's range - figures that compare from one visit to the next:
 *
 *   - the last 24 hours: spend (idle included), idle spend and its share,
 *     the cost-weighted efficiency of the workloads, and the namespaces and
 *     workloads that cost the most;
 *   - the last 7 days, hour by hour: the monthly run-rate, the average
 *     hourly spend over the hours that have cost data times the hours in an
 *     average month. Hours with no data are left out rather than counted as
 *     free, so a cluster whose agent started yesterday is not projected at a
 *     seventh of its cost.
 *
 * Cost arrives about an hour after each hour closes, so "the last 24 hours"
 * holds about 23 hours of it.
 *
 * Four aggregate reads, all at once: spend per namespace, spend and
 * efficiency per workload, and spend per hour. React-free, so it is tested
 * without a page.
 */

export const COST_OVERVIEW_SPEND_WINDOW_HOURS: number = 24;
export const COST_OVERVIEW_RUN_RATE_DAYS: number = 7;
// 365 days of 24 hours, over 12 months.
export const HOURS_PER_MONTH: number = 730;
// Rows each list shows: what the eye takes in at once.
export const COST_OVERVIEW_TOP_ROWS: number = 5;

export interface CostOverviewNamespace {
  namespace: string;
  totalCost: number;
}

export interface CostOverviewWorkload {
  namespace: string;
  controllerKind: string;
  controllerName: string;
  totalCost: number;
}

export interface KubernetesCostOverview {
  // Whether the cluster sent any cost in the last 7 days.
  hasData: boolean;
  // Whether any of it is in the last 24 hours.
  hasRecentData: boolean;
  // When the newest hour of cost started, or null for none.
  newestWindowStart: Date | null;
  // Spend in the last 24 hours, idle capacity included.
  lastDaySpend: number;
  // The part of it that paid for idle and unallocated capacity.
  lastDayIdleSpend: number;
  // lastDayIdleSpend's share of lastDaySpend, 0-100, or null for no spend.
  idlePercent: number | null;
  /*
   * How much of what the workloads reserved they used, 0-1 and above, as
   * each workload's own figure weighted by what it cost; null when no
   * workload cost anything.
   */
  efficiency: number | null;
  // What a month would cost at the last 7 days' hourly rate, or null.
  monthlyRunRate: number | null;
  // The hours of cost data the run-rate is worked out from.
  runRateHours: number;
  // The costliest namespaces and workloads of the last 24 hours.
  topNamespaces: Array<CostOverviewNamespace>;
  topWorkloads: Array<CostOverviewWorkload>;
  /*
   * What the workload shares are of: the last day's spend without idle
   * capacity, as the Costs page's Spend by Workload measures it.
   */
  lastDayWorkloadSpend: number;
}

function finite(value: unknown): number {
  const num: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function groupValue(item: AggregatedModel, column: string): string {
  const value: unknown = (item as unknown as Record<string, unknown>)[column];
  return value === null || value === undefined ? "" : String(value);
}

function workloadKey(item: {
  namespace: string;
  controllerKind: string;
  controllerName: string;
}): string {
  return JSON.stringify([
    item.namespace,
    item.controllerKind,
    item.controllerName,
  ]);
}

/*
 * The overview from what the four reads returned. Pure: the reads are made
 * by fetchKubernetesCostOverview, and the tests hand it rows.
 */
export function buildKubernetesCostOverview(data: {
  namespaceSpend: AggregatedResult;
  workloadSpend: AggregatedResult;
  workloadEfficiency: AggregatedResult;
  hourlySpend: AggregatedResult;
}): KubernetesCostOverview {
  let lastDaySpend: number = 0;
  let lastDayIdleSpend: number = 0;
  let hasRecentData: boolean = false;

  const namespaceTotals: Map<string, number> = new Map<string, number>();

  for (const item of data.namespaceSpend.data) {
    hasRecentData = true;
    const namespace: string = groupValue(item, "namespace");
    const cost: number = finite(item.value);

    lastDaySpend += cost;

    if (isSentinelNamespace(namespace)) {
      lastDayIdleSpend += cost;
      continue;
    }

    namespaceTotals.set(
      namespace,
      (namespaceTotals.get(namespace) || 0) + cost,
    );
  }

  const topNamespaces: Array<CostOverviewNamespace> = Array.from(
    namespaceTotals.entries(),
  )
    .map(([namespace, totalCost]: [string, number]): CostOverviewNamespace => {
      return { namespace, totalCost };
    })
    .filter((row: CostOverviewNamespace): boolean => {
      return row.totalCost > 0;
    })
    .sort((a: CostOverviewNamespace, b: CostOverviewNamespace): number => {
      return b.totalCost - a.totalCost;
    })
    .slice(0, COST_OVERVIEW_TOP_ROWS);

  const workloads: Map<string, CostOverviewWorkload> = new Map<
    string,
    CostOverviewWorkload
  >();

  for (const item of data.workloadSpend.data) {
    const workload: CostOverviewWorkload = {
      namespace: groupValue(item, "namespace"),
      controllerKind: groupValue(item, "controllerKind"),
      controllerName: groupValue(item, "controllerName"),
      totalCost: finite(item.value),
    };

    // Idle capacity is no workload's: the idle figure counts it.
    if (isSentinelNamespace(workload.namespace)) {
      continue;
    }

    const key: string = workloadKey(workload);
    const existing: CostOverviewWorkload | undefined = workloads.get(key);

    if (existing) {
      existing.totalCost += workload.totalCost;
    } else {
      workloads.set(key, workload);
    }
  }

  const efficiencies: Map<string, number> = new Map<string, number>();

  for (const item of data.workloadEfficiency.data) {
    const value: number = Number(item.value);

    if (!Number.isFinite(value)) {
      continue;
    }

    efficiencies.set(
      workloadKey({
        namespace: groupValue(item, "namespace"),
        controllerKind: groupValue(item, "controllerKind"),
        controllerName: groupValue(item, "controllerName"),
      }),
      value,
    );
  }

  /*
   * Each workload's efficiency counts by what the workload cost, so a
   * sidecar-sized Job at 5% cannot pull a cluster of well-used services
   * down to its figure - the same weighting the efficiency metric uses.
   */
  let weightedEfficiency: number = 0;
  let efficiencyWeight: number = 0;
  let lastDayWorkloadSpend: number = 0;

  for (const [key, workload] of workloads) {
    lastDayWorkloadSpend += workload.totalCost;

    const efficiency: number | undefined = efficiencies.get(key);

    if (efficiency === undefined || workload.totalCost <= 0) {
      continue;
    }

    weightedEfficiency += efficiency * workload.totalCost;
    efficiencyWeight += workload.totalCost;
  }

  const topWorkloads: Array<CostOverviewWorkload> = Array.from(
    workloads.values(),
  )
    .filter((row: CostOverviewWorkload): boolean => {
      return row.totalCost > 0;
    })
    .sort((a: CostOverviewWorkload, b: CostOverviewWorkload): number => {
      return b.totalCost - a.totalCost;
    })
    .slice(0, COST_OVERVIEW_TOP_ROWS);

  let runRateSpend: number = 0;
  let newestWindowStartMs: number | null = null;
  const hoursWithData: Set<number> = new Set<number>();

  for (const item of data.hourlySpend.data) {
    const startMs: number = new Date(item.timestamp).getTime();

    if (!Number.isFinite(startMs)) {
      continue;
    }

    runRateSpend += finite(item.value);
    hoursWithData.add(startMs);

    if (newestWindowStartMs === null || startMs > newestWindowStartMs) {
      newestWindowStartMs = startMs;
    }
  }

  const runRateHours: number = hoursWithData.size;

  return {
    hasData: runRateHours > 0 || hasRecentData,
    hasRecentData: hasRecentData,
    newestWindowStart:
      newestWindowStartMs === null ? null : new Date(newestWindowStartMs),
    lastDaySpend: lastDaySpend,
    lastDayIdleSpend: lastDayIdleSpend,
    idlePercent:
      lastDaySpend > 0 ? (lastDayIdleSpend / lastDaySpend) * 100 : null,
    efficiency:
      efficiencyWeight > 0 ? weightedEfficiency / efficiencyWeight : null,
    monthlyRunRate:
      runRateHours > 0 ? (runRateSpend / runRateHours) * HOURS_PER_MONTH : null,
    runRateHours: runRateHours,
    topNamespaces: topNamespaces,
    topWorkloads: topWorkloads,
    lastDayWorkloadSpend: lastDayWorkloadSpend,
  };
}

const WORKLOAD_GROUP_BY: GroupBy<KubernetesCostAllocation> = {
  namespace: true,
  controllerKind: true,
  controllerName: true,
};

export const fetchKubernetesCostOverview: (data: {
  kubernetesClusterId: ObjectID;
  now: Date;
}) => Promise<KubernetesCostOverview> = async (data: {
  kubernetesClusterId: ObjectID;
  now: Date;
}): Promise<KubernetesCostOverview> => {
  const lastDay: FetchCostParams = {
    kubernetesClusterId: data.kubernetesClusterId,
    startDate: new Date(
      data.now.getTime() - COST_OVERVIEW_SPEND_WINDOW_HOURS * 60 * 60 * 1000,
    ),
    endDate: data.now,
  };
  const lastWeek: FetchCostParams = {
    kubernetesClusterId: data.kubernetesClusterId,
    startDate: new Date(
      data.now.getTime() - COST_OVERVIEW_RUN_RATE_DAYS * 24 * 60 * 60 * 1000,
    ),
    endDate: data.now,
  };

  const [namespaceSpend, workloadSpend, workloadEfficiency, hourlySpend] =
    await Promise.all([
      runAggregate(
        buildAggregateBy({
          params: lastDay,
          aggregateColumnName: "totalCost",
          aggregationType: AggregationType.Sum,
          groupBy: { namespace: true },
          aggregationInterval: AggregationInterval.Total,
        }),
      ),
      runAggregate(
        buildAggregateBy({
          params: lastDay,
          aggregateColumnName: "totalCost",
          aggregationType: AggregationType.Sum,
          groupBy: WORKLOAD_GROUP_BY,
          aggregationInterval: AggregationInterval.Total,
        }),
      ),
      runAggregate(
        buildAggregateBy({
          params: lastDay,
          aggregateColumnName: "totalEfficiency",
          aggregationType: AggregationType.Avg,
          groupBy: WORKLOAD_GROUP_BY,
          aggregationInterval: AggregationInterval.Total,
        }),
      ),
      runAggregate(
        buildAggregateBy({
          params: lastWeek,
          aggregateColumnName: "totalCost",
          aggregationType: AggregationType.Sum,
          aggregationInterval: AggregationInterval.Hour,
        }),
      ),
    ]);

  return buildKubernetesCostOverview({
    namespaceSpend,
    workloadSpend,
    workloadEfficiency,
    hourlySpend,
  });
};
