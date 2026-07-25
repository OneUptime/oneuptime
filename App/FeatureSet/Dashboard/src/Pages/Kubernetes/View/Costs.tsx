import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  CostTrendPoint,
  NamespaceCostRow,
  WorkloadCostRow,
  IDLE_NAMESPACE,
  UNALLOCATED_NAMESPACE,
  fetchCostTrend,
  fetchNamespaceBreakdown,
  fetchWorkloadBreakdown,
  formatCost,
  formatEfficiency,
  isSentinelNamespace,
} from "../Utils/KubernetesCostUtils";

const TOP_ROWS_LIMIT: number = 25;

interface StatTile {
  title: string;
  value: string;
  description: string;
}

function getSectionTitle(icon: IconProp, title: string): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon icon={icon} className="h-5 w-5 text-gray-500" />
      <span>{title}</span>
    </div>
  );
}

function sentinelDisplayName(namespace: string): string {
  if (namespace === IDLE_NAMESPACE) {
    return "Idle (unused capacity)";
  }
  if (namespace === UNALLOCATED_NAMESPACE) {
    return "Unallocated";
  }
  return namespace;
}

const KubernetesClusterCosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [trend, setTrend] = useState<Array<CostTrendPoint>>([]);
  const [namespaceRows, setNamespaceRows] = useState<Array<NamespaceCostRow>>(
    [],
  );
  const [workloadRows, setWorkloadRows] = useState<Array<WorkloadCostRow>>([]);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_WEEK,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_WEEK,
    }),
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const startMs: number = startAndEndDate.startValue.getTime();
  const endMs: number = startAndEndDate.endValue.getTime();

  useEffect(() => {
    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const params: {
          kubernetesClusterId: ObjectID;
          startDate: Date;
          endDate: Date;
        } = {
          kubernetesClusterId: modelId,
          startDate: new Date(startMs),
          endDate: new Date(endMs),
        };

        const [trendPoints, namespaces, workloads] = await Promise.all([
          fetchCostTrend(params),
          fetchNamespaceBreakdown(params),
          fetchWorkloadBreakdown(params),
        ]);

        if (cancelled) {
          return;
        }

        setTrend(trendPoints);
        setNamespaceRows(namespaces);
        setWorkloadRows(workloads);
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [modelId.toString(), startMs, endMs]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const totalSpend: number = namespaceRows.reduce(
    (sum: number, row: NamespaceCostRow): number => {
      return sum + row.totalCost;
    },
    0,
  );
  const idleSpend: number = namespaceRows
    .filter((row: NamespaceCostRow): boolean => {
      return isSentinelNamespace(row.namespace);
    })
    .reduce((sum: number, row: NamespaceCostRow): number => {
      return sum + row.totalCost;
    }, 0);
  const workloadSpend: number = totalSpend - idleSpend;
  const idlePercent: string =
    totalSpend > 0 ? `${Math.round((idleSpend / totalSpend) * 100)}%` : "-";

  const tiles: Array<StatTile> = [
    {
      title: "Total Spend",
      value: formatCost(totalSpend),
      description: "All cost allocated to this cluster in the window.",
    },
    {
      title: "Workload Spend",
      value: formatCost(workloadSpend),
      description: "Spend attributed to namespaces and workloads.",
    },
    {
      title: "Idle Spend",
      value: formatCost(idleSpend),
      description: "Provisioned but unused capacity.",
    },
    {
      title: "Idle %",
      value: idlePercent,
      description: "Idle spend as a share of total spend.",
    },
  ];

  const series: Array<SeriesPoint> = [
    {
      seriesName: "Total Cost",
      data: trend,
    },
  ];

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: startAndEndDate.startValue,
      max: startAndEndDate.endValue,
      aggregateType: XAxisAggregateType.Sum,
    },
  };

  const yAxis: YAxis = {
    legend: "Cost",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.TwoDecimals,
      formatter: (value: number): string => {
        return formatCost(value);
      },
    },
  };

  const emptyState: ReactElement = (
    <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-gray-400">
      <div>No cost data reported for the selected time range.</div>
      <div>
        Cost data is shipped by the OneUptime Kubernetes agent — enable it with{" "}
        <code>cost.enabled=true</code> in the kubernetes-agent Helm chart. That
        alone is a complete install; if you already run OpenCost or Kubecost,
        set <code>cost.engine.url</code> to it instead.
      </div>
    </div>
  );

  return (
    <Fragment>
      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Billing, "Spend")}
        description="Total cost allocated to this cluster over time, including idle capacity."
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      >
        <div>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {tiles.map((tile: StatTile, index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className="rounded-md border border-gray-200 p-4"
                  title={tile.description}
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {tile.title}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">
                    {isLoading ? "..." : tile.value}
                  </div>
                </div>
              );
            })}
          </div>
          {isLoading ? (
            <div className="h-48 animate-pulse rounded-md bg-gray-50" />
          ) : trend.length > 0 ? (
            <LineChartElement
              data={series}
              xAxis={xAxis}
              yAxis={yAxis}
              curve={ChartCurve.MONOTONE}
              heightInPx={300}
              showLegend={false}
              sync={false}
              syncid={`k8s-costs-${modelId.toString()}`}
            />
          ) : (
            emptyState
          )}
        </div>
      </EmbeddedMetricCard>

      <Card
        title="Spend by Namespace"
        description="Whole-window cost per namespace with cpu / memory / storage split and request-vs-usage efficiency."
      >
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-md bg-gray-50" />
        ) : namespaceRows.length === 0 ? (
          emptyState
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Namespace</th>
                  <th className="py-2 pr-4 text-right">CPU</th>
                  <th className="py-2 pr-4 text-right">Memory</th>
                  <th className="py-2 pr-4 text-right">Storage</th>
                  <th className="py-2 pr-4 text-right">Other</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 text-right">Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {namespaceRows
                  .slice(0, TOP_ROWS_LIMIT)
                  .map((row: NamespaceCostRow, index: number): ReactElement => {
                    const isSentinel: boolean = isSentinelNamespace(
                      row.namespace,
                    );
                    return (
                      <tr
                        key={index}
                        className={isSentinel ? "text-gray-500" : ""}
                      >
                        <td className="py-2 pr-4 font-medium">
                          {sentinelDisplayName(row.namespace) || "-"}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatCost(row.cpuCost)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatCost(row.ramCost)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatCost(row.pvCost)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatCost(row.otherCost)}
                        </td>
                        <td className="py-2 pr-4 text-right font-semibold">
                          {formatCost(row.totalCost)}
                        </td>
                        <td className="py-2 text-right">
                          {isSentinel ? "-" : formatEfficiency(row.efficiency)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {namespaceRows.length > TOP_ROWS_LIMIT ? (
              <div className="mt-2 text-xs text-gray-400">
                Showing top {TOP_ROWS_LIMIT} of {namespaceRows.length}{" "}
                namespaces by spend.
              </div>
            ) : (
              <></>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Spend by Workload"
        description="Whole-window cost per workload (controller), highest spend first. Idle capacity is excluded."
      >
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-md bg-gray-50" />
        ) : workloadRows.length === 0 ? (
          emptyState
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Workload</th>
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2 pr-4">Namespace</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 text-right">Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {workloadRows
                  .slice(0, TOP_ROWS_LIMIT)
                  .map((row: WorkloadCostRow, index: number): ReactElement => {
                    return (
                      <tr key={index}>
                        <td className="py-2 pr-4 font-medium">
                          {row.controllerName || "-"}
                        </td>
                        <td className="py-2 pr-4">
                          {row.controllerKind || "-"}
                        </td>
                        <td className="py-2 pr-4">{row.namespace || "-"}</td>
                        <td className="py-2 pr-4 text-right font-semibold">
                          {formatCost(row.totalCost)}
                        </td>
                        <td className="py-2 text-right">
                          {formatEfficiency(row.efficiency)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {workloadRows.length > TOP_ROWS_LIMIT ? (
              <div className="mt-2 text-xs text-gray-400">
                Showing top {TOP_ROWS_LIMIT} of {workloadRows.length} workloads
                by spend.
              </div>
            ) : (
              <></>
            )}
          </div>
        )}
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterCosts;
