import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import GroupBy from "Common/Server/Types/Database/GroupBy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";

/*
 * Client-side aggregation helpers for the KubernetesCostAllocation
 * analytics model. Cost rows are windowed (hourly by default) per
 * (namespace, controller, pod, container) with pre-priced components —
 * these helpers roll them up for the cluster Costs page.
 */

/*
 * Engine sentinels for non-workload capacity, stored in the `namespace`
 * column (see KubernetesCostIngestService).
 */
export const IDLE_NAMESPACE: string = "__idle__";
export const UNALLOCATED_NAMESPACE: string = "__unallocated__";

export const isSentinelNamespace: (namespace: string) => boolean = (
  namespace: string,
): boolean => {
  return namespace === IDLE_NAMESPACE || namespace === UNALLOCATED_NAMESPACE;
};

export interface CostTrendPoint {
  x: Date;
  y: number;
}

export interface NamespaceCostRow {
  namespace: string;
  cpuCost: number;
  ramCost: number;
  pvCost: number;
  otherCost: number;
  totalCost: number;
  efficiency: number | null;
}

export interface WorkloadCostRow {
  namespace: string;
  controllerKind: string;
  controllerName: string;
  totalCost: number;
  efficiency: number | null;
}

export interface ClusterCostRow {
  clusterName: string;
  totalCost: number;
  idleCost: number;
  efficiency: number | null;
}

export interface FetchCostParams {
  /** Omit to query across every cluster in the project. */
  kubernetesClusterId?: ObjectID | undefined;
  startDate: Date;
  endDate: Date;
}

export const formatCost: (value: number, currency?: string) => string = (
  value: number,
  currency?: string,
): string => {
  const symbol: string = !currency || currency === "USD" ? "$" : `${currency} `;
  if (value !== 0 && Math.abs(value) < 0.01) {
    return `${symbol}${value.toFixed(4)}`;
  }
  return `${symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatEfficiency: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
};

type BuildAggregateBy = (data: {
  params: FetchCostParams;
  aggregateColumnName: keyof KubernetesCostAllocation;
  aggregationType: AggregationType;
  groupBy?: GroupBy<KubernetesCostAllocation> | undefined;
  aggregationInterval?: AggregationInterval | undefined;
  extraQuery?: Record<string, unknown> | undefined;
}) => AggregateBy<KubernetesCostAllocation>;

const buildAggregateBy: BuildAggregateBy = (data: {
  params: FetchCostParams;
  aggregateColumnName: keyof KubernetesCostAllocation;
  aggregationType: AggregationType;
  groupBy?: GroupBy<KubernetesCostAllocation> | undefined;
  aggregationInterval?: AggregationInterval | undefined;
  extraQuery?: Record<string, unknown> | undefined;
}): AggregateBy<KubernetesCostAllocation> => {
  const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

  const query: Record<string, unknown> = {
    projectId: projectId,
    windowStart: new InBetween<Date>(
      data.params.startDate,
      data.params.endDate,
    ),
    ...(data.extraQuery || {}),
  };

  if (data.params.kubernetesClusterId) {
    query["kubernetesClusterId"] = data.params.kubernetesClusterId.toString();
  }

  const aggregateBy: AggregateBy<KubernetesCostAllocation> = {
    query: query as AggregateBy<KubernetesCostAllocation>["query"],
    aggregationType: data.aggregationType,
    aggregateColumnName: data.aggregateColumnName,
    aggregationTimestampColumnName: "windowStart",
    startTimestamp: data.params.startDate,
    endTimestamp: data.params.endDate,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: {
      windowStart: SortOrder.Ascending,
    },
  };

  if (data.groupBy) {
    aggregateBy.groupBy = data.groupBy;
  }
  if (data.aggregationInterval) {
    aggregateBy.aggregationInterval = data.aggregationInterval;
  }

  return aggregateBy;
};

type RunAggregate = (
  aggregateBy: AggregateBy<KubernetesCostAllocation>,
) => Promise<AggregatedResult>;

const runAggregate: RunAggregate = (
  aggregateBy: AggregateBy<KubernetesCostAllocation>,
): Promise<AggregatedResult> => {
  return AnalyticsModelAPI.aggregate<KubernetesCostAllocation>({
    modelType: KubernetesCostAllocation,
    aggregateBy: aggregateBy,
  });
};

/**
 * Total spend per time bucket (bucket size derived from the window).
 * Includes idle/unallocated — it is real spend.
 */
export const fetchCostTrend: (
  params: FetchCostParams,
) => Promise<Array<CostTrendPoint>> = async (
  params: FetchCostParams,
): Promise<Array<CostTrendPoint>> => {
  const result: AggregatedResult = await runAggregate(
    buildAggregateBy({
      params,
      aggregateColumnName: "totalCost",
      aggregationType: AggregationType.Sum,
    }),
  );

  return result.data
    .map((item: AggregatedModel): CostTrendPoint => {
      return {
        x: new Date(item.timestamp),
        y: item.value || 0,
      };
    })
    .sort((a: CostTrendPoint, b: CostTrendPoint): number => {
      return a.x.getTime() - b.x.getTime();
    });
};

type GroupedTotals = Map<string, number>;

const toGroupedTotals: (
  result: AggregatedResult,
  groupColumns: Array<string>,
) => GroupedTotals = (
  result: AggregatedResult,
  groupColumns: Array<string>,
): GroupedTotals => {
  const totals: GroupedTotals = new Map<string, number>();
  for (const item of result.data) {
    const key: string = groupColumns
      .map((column: string): string => {
        return String((item as Record<string, unknown>)[column] ?? "");
      })
      .join("|");
    totals.set(key, (totals.get(key) || 0) + (item.value || 0));
  }
  return totals;
};

/**
 * Whole-window spend per namespace, with cpu/ram/pv component splits and
 * average efficiency. Sentinel namespaces (__idle__ / __unallocated__)
 * are INCLUDED — the page splits them out for the idle tile.
 */
export const fetchNamespaceBreakdown: (
  params: FetchCostParams,
) => Promise<Array<NamespaceCostRow>> = async (
  params: FetchCostParams,
): Promise<Array<NamespaceCostRow>> => {
  const groupBy: GroupBy<KubernetesCostAllocation> = { namespace: true };

  type MeasureColumn = "totalCost" | "cpuCost" | "ramCost" | "pvCost";
  const measures: Array<MeasureColumn> = [
    "totalCost",
    "cpuCost",
    "ramCost",
    "pvCost",
  ];

  const [totalsResults, efficiencyResult] = await Promise.all([
    Promise.all(
      measures.map((measure: MeasureColumn): Promise<AggregatedResult> => {
        return runAggregate(
          buildAggregateBy({
            params,
            aggregateColumnName: measure,
            aggregationType: AggregationType.Sum,
            groupBy,
            aggregationInterval: AggregationInterval.Total,
          }),
        );
      }),
    ),
    runAggregate(
      buildAggregateBy({
        params,
        aggregateColumnName: "totalEfficiency",
        aggregationType: AggregationType.Avg,
        groupBy,
        aggregationInterval: AggregationInterval.Total,
      }),
    ),
  ]);

  const groupColumns: Array<string> = ["namespace"];
  const byMeasure: Array<GroupedTotals> = totalsResults.map(
    (result: AggregatedResult): GroupedTotals => {
      return toGroupedTotals(result, groupColumns);
    },
  );
  const efficiencyByNamespace: GroupedTotals = toGroupedTotals(
    efficiencyResult,
    groupColumns,
  );

  const rows: Array<NamespaceCostRow> = [];
  for (const [namespace, totalCost] of byMeasure[0]!) {
    const cpuCost: number = byMeasure[1]!.get(namespace) || 0;
    const ramCost: number = byMeasure[2]!.get(namespace) || 0;
    const pvCost: number = byMeasure[3]!.get(namespace) || 0;
    rows.push({
      namespace,
      cpuCost,
      ramCost,
      pvCost,
      otherCost: Math.max(0, totalCost - cpuCost - ramCost - pvCost),
      totalCost,
      efficiency: efficiencyByNamespace.has(namespace)
        ? efficiencyByNamespace.get(namespace)!
        : null,
    });
  }

  return rows.sort((a: NamespaceCostRow, b: NamespaceCostRow): number => {
    return b.totalCost - a.totalCost;
  });
};

/**
 * Whole-window spend per workload (namespace + controller), sentinel
 * namespaces excluded.
 */
export const fetchWorkloadBreakdown: (
  params: FetchCostParams,
) => Promise<Array<WorkloadCostRow>> = async (
  params: FetchCostParams,
): Promise<Array<WorkloadCostRow>> => {
  const groupBy: GroupBy<KubernetesCostAllocation> = {
    namespace: true,
    controllerKind: true,
    controllerName: true,
  };

  const [costResult, efficiencyResult] = await Promise.all([
    runAggregate(
      buildAggregateBy({
        params,
        aggregateColumnName: "totalCost",
        aggregationType: AggregationType.Sum,
        groupBy,
        aggregationInterval: AggregationInterval.Total,
      }),
    ),
    runAggregate(
      buildAggregateBy({
        params,
        aggregateColumnName: "totalEfficiency",
        aggregationType: AggregationType.Avg,
        groupBy,
        aggregationInterval: AggregationInterval.Total,
      }),
    ),
  ]);

  const groupColumns: Array<string> = [
    "namespace",
    "controllerKind",
    "controllerName",
  ];
  const costs: GroupedTotals = toGroupedTotals(costResult, groupColumns);
  const efficiencies: GroupedTotals = toGroupedTotals(
    efficiencyResult,
    groupColumns,
  );

  const rows: Array<WorkloadCostRow> = [];
  for (const [key, totalCost] of costs) {
    const [namespace, controllerKind, controllerName] = key.split("|");
    if (isSentinelNamespace(namespace || "")) {
      continue;
    }
    rows.push({
      namespace: namespace || "",
      controllerKind: controllerKind || "",
      controllerName: controllerName || "",
      totalCost,
      efficiency: efficiencies.has(key) ? efficiencies.get(key)! : null,
    });
  }

  return rows.sort((a: WorkloadCostRow, b: WorkloadCostRow): number => {
    return b.totalCost - a.totalCost;
  });
};

/**
 * Whole-window spend per cluster across the project, with idle share and
 * average efficiency. Powers the project-level Kubernetes Costs page.
 */
export const fetchClusterBreakdown: (params: {
  startDate: Date;
  endDate: Date;
}) => Promise<Array<ClusterCostRow>> = async (params: {
  startDate: Date;
  endDate: Date;
}): Promise<Array<ClusterCostRow>> => {
  const fetchParams: FetchCostParams = {
    startDate: params.startDate,
    endDate: params.endDate,
  };
  const groupBy: GroupBy<KubernetesCostAllocation> = { clusterName: true };

  const [totalResult, idleResult, efficiencyResult] = await Promise.all([
    runAggregate(
      buildAggregateBy({
        params: fetchParams,
        aggregateColumnName: "totalCost",
        aggregationType: AggregationType.Sum,
        groupBy,
        aggregationInterval: AggregationInterval.Total,
      }),
    ),
    runAggregate(
      buildAggregateBy({
        params: fetchParams,
        aggregateColumnName: "totalCost",
        aggregationType: AggregationType.Sum,
        groupBy,
        aggregationInterval: AggregationInterval.Total,
        extraQuery: { namespace: IDLE_NAMESPACE },
      }),
    ),
    runAggregate(
      buildAggregateBy({
        params: fetchParams,
        aggregateColumnName: "totalEfficiency",
        aggregationType: AggregationType.Avg,
        groupBy,
        aggregationInterval: AggregationInterval.Total,
      }),
    ),
  ]);

  const groupColumns: Array<string> = ["clusterName"];
  const totals: GroupedTotals = toGroupedTotals(totalResult, groupColumns);
  const idle: GroupedTotals = toGroupedTotals(idleResult, groupColumns);
  const efficiencies: GroupedTotals = toGroupedTotals(
    efficiencyResult,
    groupColumns,
  );

  const rows: Array<ClusterCostRow> = [];
  for (const [clusterName, totalCost] of totals) {
    rows.push({
      clusterName,
      totalCost,
      idleCost: idle.get(clusterName) || 0,
      efficiency: efficiencies.has(clusterName)
        ? efficiencies.get(clusterName)!
        : null,
    });
  }

  return rows.sort((a: ClusterCostRow, b: ClusterCostRow): number => {
    return b.totalCost - a.totalCost;
  });
};
