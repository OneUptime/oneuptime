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

  // Bumped by the tables' Refresh buttons to re-run the load effect.
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
        type: FieldType.Element,
        key: "cpuCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.cpuCost);
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "ramCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.ramCost);
        },
      },
      {
        title: "Storage",
        type: FieldType.Element,
        key: "pvCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.pvCost);
        },
      },
      {
        title: "Other",
        type: FieldType.Element,
        key: "otherCost",
        hideOnMobile: true,
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getCostElement(row.otherCost);
        },
      },
      {
        title: "Total",
        type: FieldType.Element,
        key: "totalCost",
        getElement: (row: NamespaceCostRow): ReactElement => {
          return getTotalCostElement(row.totalCost, totalSpend);
        },
      },
      {
        title: "Efficiency",
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
        type: FieldType.Element,
        key: "totalCost",
        getElement: (row: WorkloadCostRow): ReactElement => {
          return getTotalCostElement(row.totalCost, workloadSpend);
        },
      },
      {
        title: "Efficiency",
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
    onClick: () => {
      setRefreshToggle((toggle: number) => {
        return toggle + 1;
      });
    },
    icon: IconProp.Refresh,
  };

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
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <GoldenMetricTile
              title="Total Spend"
              icon={IconProp.CurrencyDollar}
              iconColor="emerald"
              value={isLoading ? "—" : formatCost(totalSpend)}
              sublabel="allocated in this window"
            />
            <GoldenMetricTile
              title="Workload Spend"
              icon={IconProp.Cube}
              iconColor="blue"
              value={isLoading ? "—" : formatCost(workloadSpend)}
              sublabel="namespaces and workloads"
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
              syncid={`k8s-costs-${modelId.toString()}`}
            />
          ) : (
            <ErrorMessage message={noCostDataMessage} />
          )}
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
          error=""
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
          error=""
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
    </Fragment>
  );
};

export default KubernetesClusterCosts;
