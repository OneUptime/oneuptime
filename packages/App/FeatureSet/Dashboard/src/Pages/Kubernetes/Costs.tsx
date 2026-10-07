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
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
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
import KubernetesCostTrendChart from "./View/KubernetesCostTrendChart";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { KUBERNETES_COST_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/KubernetesClusterMetricDescriptions";

/*
 * `description` explains a section whose chart has no title of its own -
 * the spend trend under the tiles - in an (i) beside the section title.
 */
function getSectionTitle(
  icon: IconProp,
  title: string,
  description?: string | undefined,
): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon icon={icon} className="h-5 w-5 text-gray-500" />
      <span>{title}</span>
      <InfoTooltip label={title} text={description} />
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
  const [pageSize, setPageSize] = useState<number>(COST_ROWS_PER_PAGE);
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

  // Bumped by every Refresh (and a retry) to re-run the load effect.
  const [refreshToggle, setRefreshToggle] = useState<number>(0);

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  /*
   * Loads the page's window again. A window alone cannot ask for that: a
   * Custom window, and every zoom is one, re-resolves to the same instants,
   * so the Spend card's Refresh changed nothing the load effect could see
   * while zoomed - an error included.
   */
  const reload: () => void = useCallback((): void => {
    setRefreshToggle((toggle: number) => {
      return toggle + 1;
    });
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

  /*
   * After a failed load the rows still hold the previous window's figures,
   * which the picker no longer shows: the tiles read "—" rather than those.
   */
  const showFigures: boolean = !isLoading && !error;

  const sortedRows: Array<ClusterCostRow> = useMemo(() => {
    return sortCostRows<ClusterCostRow>(clusterRows, sortBy, sortOrder);
  }, [clusterRows, sortBy, sortOrder]);

  const pagedRows: Array<ClusterCostRow> = useMemo(() => {
    return pageCostRows<ClusterCostRow>(sortedRows, currentPage, pageSize);
  }, [sortedRows, currentPage, pageSize]);

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
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.clusterWorkloadCost,
        type: FieldType.Element,
        key: "workloadCost",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getCostElement(row.workloadCost);
        },
      },
      {
        title: "Idle",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.clusterIdleCost,
        type: FieldType.Element,
        key: "idleCost",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getCostElement(row.idleCost);
        },
      },
      {
        title: "Total",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.clusterTotalCost,
        type: FieldType.Element,
        key: "totalCost",
        getElement: (row: ClusterCostRow): ReactElement => {
          return getTotalCostElement(row.totalCost, totalSpend);
        },
      },
      {
        title: "Efficiency",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.clusterEfficiency,
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
      onClick: reload,
      icon: IconProp.Refresh,
    },
  ];

  const clusterCountLabel: string = `${clusterRows.length} cluster${
    clusterRows.length === 1 ? "" : "s"
  }`;

  const totalSpendSublabel: string = isLoading
    ? "loading"
    : error
      ? "could not load"
      : `across ${clusterCountLabel}`;

  /*
   * Issue #4105: a drag across the spend chart narrows the page to the
   * window dragged out - the tiles and the cluster table are read for the
   * page's window, so they follow - and a double-click on the chart (or
   * Reset zoom beside the card's picker) puts the range back.
   *
   * A failed load is shown where the chart and the table were, not in
   * place of the page: the zoom, the picker, Reset zoom and every Refresh
   * stay, so a zoom whose load fails can still be retried or undone.
   */
  return (
    <TimeRangeZoomScope
      timeRange={timeRange}
      onTimeRangeChange={handleTimeRangeChange}
    >
      <EmbeddedMetricCard
        title={getSectionTitle(
          IconProp.Billing,
          "Kubernetes Spend",
          KUBERNETES_COST_METRIC_DESCRIPTIONS.fleetSpendTrend,
        )}
        description="Total cost allocated across every Kubernetes cluster in this project."
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
        onRefresh={reload}
      >
        <div>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <GoldenMetricTile
              title="Total Spend"
              icon={IconProp.CurrencyDollar}
              iconColor="emerald"
              value={showFigures ? formatCost(totalSpend) : "—"}
              sublabel={totalSpendSublabel}
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.fleetTotalSpend}
            />
            <GoldenMetricTile
              title="Workload Spend"
              icon={IconProp.Cube}
              iconColor="blue"
              value={showFigures ? formatCost(totalSpend - idleSpend) : "—"}
              sublabel="attributed to workloads"
              description={
                KUBERNETES_COST_METRIC_DESCRIPTIONS.fleetWorkloadSpend
              }
            />
            <GoldenMetricTile
              title="Idle Spend"
              icon={IconProp.Clock}
              iconColor="amber"
              value={showFigures ? formatCost(idleSpend) : "—"}
              sublabel="provisioned but unused"
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.fleetIdleSpend}
            />
            <GoldenMetricTile
              title="Idle %"
              icon={IconProp.ChartPie}
              iconColor="slate"
              value={
                !showFigures || idlePercent === null
                  ? "—"
                  : `${Math.round(idlePercent)}%`
              }
              sublabel="share of total spend"
              percent={showFigures ? idlePercent : null}
              thresholds={{ warn: 25, danger: 40 }}
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.fleetIdlePercent}
            />
          </div>
          <KubernetesCostTrendChart
            trend={trend}
            isLoading={isLoading}
            error={error}
            onRetry={reload}
            startAndEndDate={startAndEndDate}
            syncid="k8s-project-costs"
          />
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
          error={error}
          onRefreshClick={error ? reload : undefined}
          currentPageNumber={currentPage}
          totalItemsCount={sortedRows.length}
          itemsOnPage={pageSize}
          onNavigateToPage={(pageNumber: number, itemsOnPage: number) => {
            setCurrentPage(pageNumber);
            if (itemsOnPage > 0) {
              setPageSize(itemsOnPage);
            }
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
    </TimeRangeZoomScope>
  );
};

export default KubernetesCosts;
