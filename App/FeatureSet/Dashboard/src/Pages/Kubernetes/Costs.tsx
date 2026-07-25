import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import EmbeddedMetricCard from "../../Components/Metrics/EmbeddedMetricCard";
import GoldenMetricTile from "../../Components/Infrastructure/GoldenMetricTile";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
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
  COST_ROWS_PER_PAGE,
  CostTrendPoint,
  fetchClusterBreakdown,
  fetchCostTrend,
  formatCost,
  pageCostRows,
  sortCostRows,
} from "./Utils/KubernetesCostUtils";
import {
  getCostElement,
  getEfficiencyElement,
  getTotalCostElement,
  noCostDataMessage,
} from "./Utils/KubernetesCostTableCells";

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

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<keyof ClusterCostRow | null>(
    "totalCost",
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_WEEK,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_WEEK,
    }),
  );

  // Bumped by the table's Refresh button to re-run the load effect.
  const [refreshToggle, setRefreshToggle] = useState<number>(0);

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
        setCurrentPage(1);
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
  }, [startMs, endMs, refreshToggle]);

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
  const idlePercent: number | null =
    totalSpend > 0 ? (idleSpend / totalSpend) * 100 : null;

  const sortedRows: Array<ClusterCostRow> = useMemo(() => {
    return sortCostRows<ClusterCostRow>(clusterRows, sortBy, sortOrder);
  }, [clusterRows, sortBy, sortOrder]);

  const pagedRows: Array<ClusterCostRow> = useMemo(() => {
    return pageCostRows<ClusterCostRow>(sortedRows, currentPage);
  }, [sortedRows, currentPage]);

  const tableColumns: Array<Column<ClusterCostRow>> = useMemo(() => {
    return [
      {
        title: "Cluster",
        type: FieldType.Element,
        key: "clusterName",
        getElement: (row: ClusterCostRow): ReactElement => {
          const clusterId: string | undefined = clusterIdByName.get(
            row.clusterName,
          );

          if (!row.clusterName) {
            return <span className="text-gray-400">-</span>;
          }

          if (!clusterId) {
            return (
              <span className="font-medium text-gray-900">
                {row.clusterName}
              </span>
            );
          }

          return (
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_COSTS] as Route,
                { modelId: new ObjectID(clusterId) },
              )}
              className="font-medium text-gray-900 hover:text-indigo-600 hover:underline"
            >
              {row.clusterName}
            </Link>
          );
        },
      },
      {
        title: "Workload",
        type: FieldType.Element,
        key: "workloadCost",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getCostElement(row.workloadCost);
        },
      },
      {
        title: "Idle",
        type: FieldType.Element,
        key: "idleCost",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getCostElement(row.idleCost);
        },
      },
      {
        title: "Total",
        type: FieldType.Element,
        key: "totalCost",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getTotalCostElement(row.totalCost, totalSpend);
        },
      },
      {
        title: "Efficiency",
        type: FieldType.Element,
        key: "efficiency",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getEfficiencyElement(row.efficiency);
        },
      },
    ];
  }, [clusterIdByName, totalSpend]);

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        setRefreshToggle((toggle: number) => {
          return toggle + 1;
        });
      },
      icon: IconProp.Refresh,
    },
  ];

  if (error) {
    return <ErrorMessage message={error} />;
  }

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

  const clusterCountLabel: string = `${clusterRows.length} cluster${
    clusterRows.length === 1 ? "" : "s"
  }`;

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
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <GoldenMetricTile
              title="Total Spend"
              icon={IconProp.CurrencyDollar}
              iconColor="emerald"
              value={isLoading ? "—" : formatCost(totalSpend)}
              sublabel={isLoading ? "loading" : `across ${clusterCountLabel}`}
            />
            <GoldenMetricTile
              title="Workload Spend"
              icon={IconProp.Cube}
              iconColor="blue"
              value={isLoading ? "—" : formatCost(totalSpend - idleSpend)}
              sublabel="attributed to workloads"
            />
            <GoldenMetricTile
              title="Idle Spend"
              icon={IconProp.Clock}
              iconColor="amber"
              value={isLoading ? "—" : formatCost(idleSpend)}
              sublabel="provisioned but unused"
            />
            <GoldenMetricTile
              title="Idle %"
              icon={IconProp.ChartPie}
              iconColor="slate"
              value={
                isLoading || idlePercent === null
                  ? "—"
                  : `${Math.round(idlePercent)}%`
              }
              sublabel="share of total spend"
              percent={isLoading ? null : idlePercent}
              thresholds={{ warn: 25, danger: 40 }}
            />
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
            <ErrorMessage message={noCostDataMessage} />
          )}
        </div>
      </EmbeddedMetricCard>

      <Card
        title="Spend by Cluster"
        description="Whole-window cost per cluster, highest spend first. Click a cluster to break its spend down by namespace and workload."
        buttons={cardButtons}
      >
        <Table<ClusterCostRow>
          id="kubernetes-cluster-costs-table"
          columns={tableColumns}
          data={pagedRows}
          singularLabel="Cluster"
          pluralLabel="Clusters"
          isLoading={isLoading}
          error=""
          currentPageNumber={currentPage}
          totalItemsCount={sortedRows.length}
          itemsOnPage={COST_ROWS_PER_PAGE}
          onNavigateToPage={(pageNumber: number) => {
            setCurrentPage(pageNumber);
          }}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSortChanged={(
            newSortBy: keyof ClusterCostRow | null,
            newSortOrder: SortOrder,
          ) => {
            setSortBy(newSortBy);
            setSortOrder(newSortOrder);
            setCurrentPage(1);
          }}
          noItemsMessage={noCostDataMessage}
        />
      </Card>
    </Fragment>
  );
};

export default KubernetesCosts;
