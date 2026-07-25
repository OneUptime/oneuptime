import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import EmbeddedMetricCard from "../../Components/Metrics/EmbeddedMetricCard";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
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
  ClusterCostRow,
  CostTrendPoint,
  fetchClusterBreakdown,
  fetchCostTrend,
  formatCost,
  formatEfficiency,
} from "./Utils/KubernetesCostUtils";

function getSectionTitle(icon: IconProp, title: string): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon icon={icon} className="h-5 w-5 text-gray-500" />
      <span>{title}</span>
    </div>
  );
}

const KubernetesCosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [trend, setTrend] = useState<Array<CostTrendPoint>>([]);
  const [clusterRows, setClusterRows] = useState<Array<ClusterCostRow>>([]);
  const [clusterIdByName, setClusterIdByName] = useState<Map<string, string>>(
    new Map<string, string>(),
  );

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
        const params: { startDate: Date; endDate: Date } = {
          startDate: new Date(startMs),
          endDate: new Date(endMs),
        };

        const [trendPoints, clusters, clusterList] = await Promise.all([
          fetchCostTrend(params),
          fetchClusterBreakdown(params),
          ModelAPI.getList<KubernetesCluster>({
            modelType: KubernetesCluster,
            query: {},
            select: {
              _id: true,
              clusterIdentifier: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {},
          }),
        ]);

        if (cancelled) {
          return;
        }

        const idByName: Map<string, string> = new Map<string, string>();
        for (const cluster of (clusterList as ListResult<KubernetesCluster>)
          .data) {
          if (cluster.clusterIdentifier && cluster.id) {
            idByName.set(cluster.clusterIdentifier, cluster.id.toString());
          }
        }

        setTrend(trendPoints);
        setClusterRows(clusters);
        setClusterIdByName(idByName);
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
  }, [startMs, endMs]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const totalSpend: number = clusterRows.reduce(
    (sum: number, row: ClusterCostRow): number => {
      return sum + row.totalCost;
    },
    0,
  );
  const idleSpend: number = clusterRows.reduce(
    (sum: number, row: ClusterCostRow): number => {
      return sum + row.idleCost;
    },
    0,
  );
  const idlePercent: string =
    totalSpend > 0 ? `${Math.round((idleSpend / totalSpend) * 100)}%` : "-";

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

  type StatTile = { title: string; value: string };
  const tiles: Array<StatTile> = [
    { title: "Total Spend", value: formatCost(totalSpend) },
    { title: "Workload Spend", value: formatCost(totalSpend - idleSpend) },
    { title: "Idle Spend", value: formatCost(idleSpend) },
    { title: "Idle %", value: idlePercent },
  ];

  return (
    <Fragment>
      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Billing, "Kubernetes Spend")}
        description="Total cost allocated across every Kubernetes cluster in this project."
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
              syncid="k8s-project-costs"
            />
          ) : (
            emptyState
          )}
        </div>
      </EmbeddedMetricCard>

      <Card
        title="Spend by Cluster"
        description="Whole-window cost per cluster, highest spend first. Click a cluster to break its spend down by namespace and workload."
      >
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-md bg-gray-50" />
        ) : clusterRows.length === 0 ? (
          emptyState
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Cluster</th>
                  <th className="py-2 pr-4 text-right">Workload</th>
                  <th className="py-2 pr-4 text-right">Idle</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                  <th className="py-2 text-right">Efficiency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clusterRows.map(
                  (row: ClusterCostRow, index: number): ReactElement => {
                    const clusterId: string | undefined = clusterIdByName.get(
                      row.clusterName,
                    );
                    return (
                      <tr key={index}>
                        <td className="py-2 pr-4 font-medium">
                          {clusterId ? (
                            <Link
                              className="text-indigo-600 hover:text-indigo-800"
                              to={RouteUtil.populateRouteParams(
                                RouteMap[
                                  PageMap.KUBERNETES_CLUSTER_VIEW_COSTS
                                ] as Route,
                                { modelId: new ObjectID(clusterId) },
                              )}
                            >
                              {row.clusterName}
                            </Link>
                          ) : (
                            row.clusterName || "-"
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatCost(row.totalCost - row.idleCost)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatCost(row.idleCost)}
                        </td>
                        <td className="py-2 pr-4 text-right font-semibold">
                          {formatCost(row.totalCost)}
                        </td>
                        <td className="py-2 text-right">
                          {formatEfficiency(row.efficiency)}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Fragment>
  );
};

export default KubernetesCosts;
