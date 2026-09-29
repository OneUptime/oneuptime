import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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
  COST_ROWS_PER_PAGE,
  CostTrendPoint,
  NamespaceCostRow,
  WorkloadCostRow,
  IDLE_NAMESPACE,
  UNALLOCATED_NAMESPACE,
  fetchCostTrend,
  fetchNamespaceBreakdown,
  fetchWorkloadBreakdown,
  formatCost,
  isSentinelNamespace,
  pageCostRows,
  sortCostRows,
} from "../Utils/KubernetesCostUtils";
import {
  getControllerKindElement,
  getCostElement,
  getEfficiencyElement,
  getNamespaceElement,
  getTotalCostElement,
  noCostDataMessage,
} from "../Utils/KubernetesCostTableCells";
import KubernetesRightSizingCard from "./KubernetesRightSizingCard";
import KubernetesCostTrendChart from "./KubernetesCostTrendChart";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { KUBERNETES_COST_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesClusterMetricDescriptions";

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

function sentinelDisplayName(namespace: string): string {
  if (namespace === IDLE_NAMESPACE) {
    return "Idle capacity";
  }
  if (namespace === UNALLOCATED_NAMESPACE) {
    return "Unallocated";
  }
  return namespace;
}

/*
 * The namespace column carries two kinds of row: real namespaces, which get
 * the same blue pill as everywhere else in the Kubernetes section, and the
 * engine's non-workload sentinels (idle / unallocated capacity), which are
 * labelled as such so nobody goes hunting for a namespace called `__idle__`.
 */
function getNamespaceCellElement(namespace: string): ReactElement {
  if (!isSentinelNamespace(namespace)) {
    return getNamespaceElement(namespace);
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-gray-500">
      <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
        {sentinelDisplayName(namespace)}
      </span>
      <span className="text-xs text-gray-400">not a workload</span>
    </span>
  );
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

  const [namespacePage, setNamespacePage] = useState<number>(1);
  const [namespaceSortBy, setNamespaceSortBy] = useState<
    keyof NamespaceCostRow | null
  >("totalCost");
  const [namespaceSortOrder, setNamespaceSortOrder] = useState<SortOrder>(
    SortOrder.Descending,
  );

  const [workloadPage, setWorkloadPage] = useState<number>(1);
  const [workloadSortBy, setWorkloadSortBy] = useState<
    keyof WorkloadCostRow | null
  >("totalCost");
  const [workloadSortOrder, setWorkloadSortOrder] = useState<SortOrder>(
    SortOrder.Descending,
  );

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
        setNamespacePage(1);
        setWorkloadPage(1);
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
  }, [modelId.toString(), startMs, endMs, refreshToggle]);

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
  const idlePercent: number | null =
    totalSpend > 0 ? (idleSpend / totalSpend) * 100 : null;

  /*
   * After a failed load the rows still hold the previous window's figures,
   * which the picker no longer shows: the tiles read "—" rather than those.
   */
  const showFigures: boolean = !isLoading && !error;

  const sortedNamespaceRows: Array<NamespaceCostRow> = useMemo(() => {
    return sortCostRows<NamespaceCostRow>(
      namespaceRows,
      namespaceSortBy,
      namespaceSortOrder,
    );
  }, [namespaceRows, namespaceSortBy, namespaceSortOrder]);

  const pagedNamespaceRows: Array<NamespaceCostRow> = useMemo(() => {
    return pageCostRows<NamespaceCostRow>(sortedNamespaceRows, namespacePage);
  }, [sortedNamespaceRows, namespacePage]);

  const sortedWorkloadRows: Array<WorkloadCostRow> = useMemo(() => {
    return sortCostRows<WorkloadCostRow>(
      workloadRows,
      workloadSortBy,
      workloadSortOrder,
    );
  }, [workloadRows, workloadSortBy, workloadSortOrder]);

  const pagedWorkloadRows: Array<WorkloadCostRow> = useMemo(() => {
    return pageCostRows<WorkloadCostRow>(sortedWorkloadRows, workloadPage);
  }, [sortedWorkloadRows, workloadPage]);

  const namespaceColumns: Array<Column<NamespaceCostRow>> = useMemo(() => {
    return [
      {
        title: "Namespace",
        type: FieldType.Element,
        key: "namespace",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getNamespaceCellElement(row.namespace);
        },
      },
      {
        title: "CPU",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.namespaceCpuCost,
        type: FieldType.Element,
        key: "cpuCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.cpuCost);
        },
      },
      {
        title: "Memory",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.namespaceMemoryCost,
        type: FieldType.Element,
        key: "ramCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.ramCost);
        },
      },
      {
        title: "Storage",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.namespaceStorageCost,
        type: FieldType.Element,
        key: "pvCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.pvCost);
        },
      },
      {
        title: "Other",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.namespaceOtherCost,
        type: FieldType.Element,
        key: "otherCost",
        hideOnMobile: true,
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.otherCost);
        },
      },
      {
        title: "Total",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.namespaceTotalCost,
        type: FieldType.Element,
        key: "totalCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getTotalCostElement(row.totalCost, totalSpend);
        },
      },
      {
        title: "Efficiency",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.efficiency,
        type: FieldType.Element,
        key: "efficiency",
        getElement: (row: NamespaceCostRow): ReactElement => {
          // Idle / unallocated capacity has no requests to compare against.
          if (isSentinelNamespace(row.namespace)) {
            return <span className="text-gray-400">-</span>;
          }
          return getEfficiencyElement(row.efficiency);
        },
      },
    ];
  }, [totalSpend]);

  const workloadColumns: Array<Column<WorkloadCostRow>> = useMemo(() => {
    return [
      {
        title: "Workload",
        type: FieldType.Element,
        key: "controllerName",
        getElement: (row: WorkloadCostRow): ReactElement => {
          if (!row.controllerName) {
            return <span className="text-gray-400">-</span>;
          }
          return (
            <span className="font-medium text-gray-900">
              {row.controllerName}
            </span>
          );
        },
      },
      {
        title: "Kind",
        type: FieldType.Element,
        key: "controllerKind",
        getElement: (row: WorkloadCostRow): ReactElement => {
          return getControllerKindElement(row.controllerKind);
        },
      },
      {
        title: "Namespace",
        type: FieldType.Element,
        key: "namespace",
        getElement: (row: WorkloadCostRow): ReactElement => {
          return getNamespaceElement(row.namespace);
        },
      },
      {
        title: "Total",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.workloadTotalCost,
        type: FieldType.Element,
        key: "totalCost",
        getElement: (row: WorkloadCostRow): ReactElement => {
          return getTotalCostElement(row.totalCost, workloadSpend);
        },
      },
      {
        title: "Efficiency",
        headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.efficiency,
        type: FieldType.Element,
        key: "efficiency",
        getElement: (row: WorkloadCostRow): ReactElement => {
          return getEfficiencyElement(row.efficiency);
        },
      },
    ];
  }, [workloadSpend]);

  const refreshButton: CardButtonSchema = {
    title: "",
    buttonStyle: ButtonStyleType.ICON,
    className: "py-0 pr-0 pl-1 mt-1",
    onClick: reload,
    icon: IconProp.Refresh,
  };

  /*
   * Issue #4105: a drag across the spend chart narrows the page to the
   * window dragged out - the tiles, the right-sizing card and both tables
   * are all read for the page's window, so they follow - and a
   * double-click on the chart (or Reset zoom beside the card's picker)
   * puts the range back.
   *
   * A failed load is shown where the chart and the tables were, not in
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
          "Spend",
          KUBERNETES_COST_METRIC_DESCRIPTIONS.spendTrend,
        )}
        description="Total cost allocated to this cluster over time, including idle capacity."
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
              sublabel="allocated in this window"
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.totalSpend}
            />
            <GoldenMetricTile
              title="Workload Spend"
              icon={IconProp.Cube}
              iconColor="blue"
              value={showFigures ? formatCost(workloadSpend) : "—"}
              sublabel="namespaces and workloads"
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.workloadSpend}
            />
            <GoldenMetricTile
              title="Idle Spend"
              icon={IconProp.Clock}
              iconColor="amber"
              value={showFigures ? formatCost(idleSpend) : "—"}
              sublabel="provisioned but unused"
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.idleSpend}
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
              description={KUBERNETES_COST_METRIC_DESCRIPTIONS.idlePercent}
            />
          </div>
          <KubernetesCostTrendChart
            trend={trend}
            isLoading={isLoading}
            error={error}
            onRetry={reload}
            startAndEndDate={startAndEndDate}
            syncid={`k8s-costs-${modelId.toString()}`}
          />
        </div>
      </EmbeddedMetricCard>

      <KubernetesRightSizingCard
        kubernetesClusterId={modelId}
        startDate={startAndEndDate.startValue}
        endDate={startAndEndDate.endValue}
        refreshToggle={refreshToggle}
      />

      <Card
        title="Spend by Namespace"
        description="Whole-window cost per namespace with cpu / memory / storage split and request-vs-usage efficiency."
        buttons={[refreshButton]}
      >
        <Table<NamespaceCostRow>
          id="kubernetes-namespace-costs-table"
          columns={namespaceColumns}
          data={pagedNamespaceRows}
          singularLabel="Namespace"
          pluralLabel="Namespaces"
          isLoading={isLoading}
          error={error}
          onRefreshClick={error ? reload : undefined}
          currentPageNumber={namespacePage}
          totalItemsCount={sortedNamespaceRows.length}
          itemsOnPage={COST_ROWS_PER_PAGE}
          onNavigateToPage={(pageNumber: number) => {
            setNamespacePage(pageNumber);
          }}
          sortBy={namespaceSortBy}
          sortOrder={namespaceSortOrder}
          onSortChanged={(
            newSortBy: keyof NamespaceCostRow | null,
            newSortOrder: SortOrder,
          ) => {
            setNamespaceSortBy(newSortBy);
            setNamespaceSortOrder(newSortOrder);
            setNamespacePage(1);
          }}
          noItemsMessage={noCostDataMessage}
        />
      </Card>

      <Card
        title="Spend by Workload"
        description="Whole-window cost per workload (controller), highest spend first. Idle capacity is excluded."
        buttons={[refreshButton]}
      >
        <Table<WorkloadCostRow>
          id="kubernetes-workload-costs-table"
          columns={workloadColumns}
          data={pagedWorkloadRows}
          singularLabel="Workload"
          pluralLabel="Workloads"
          isLoading={isLoading}
          error={error}
          onRefreshClick={error ? reload : undefined}
          currentPageNumber={workloadPage}
          totalItemsCount={sortedWorkloadRows.length}
          itemsOnPage={COST_ROWS_PER_PAGE}
          onNavigateToPage={(pageNumber: number) => {
            setWorkloadPage(pageNumber);
          }}
          sortBy={workloadSortBy}
          sortOrder={workloadSortOrder}
          onSortChanged={(
            newSortBy: keyof WorkloadCostRow | null,
            newSortOrder: SortOrder,
          ) => {
            setWorkloadSortBy(newSortBy);
            setWorkloadSortOrder(newSortOrder);
            setWorkloadPage(1);
          }}
          noItemsMessage={noCostDataMessage}
        />
      </Card>
    </TimeRangeZoomScope>
  );
};

export default KubernetesClusterCosts;
