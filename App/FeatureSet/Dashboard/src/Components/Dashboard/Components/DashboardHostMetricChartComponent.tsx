import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardHostMetricChartComponent, {
  HostMetricKind,
} from "Common/Types/Dashboard/DashboardComponents/DashboardHostMetricChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import MetricCharts from "../../Metrics/MetricCharts";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import ValueFormatter from "Common/Utils/ValueFormatter";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardHostMetricChartComponent;
}

const HOST_NAME_ATTRIBUTE: string = "host.name";

interface MetricSpec {
  metricName: string;
  defaultTitle: string;
  legendUnit: string;
  aggregation: AggregationType;
  transformAsRate: boolean;
  yFormatter?: ((value: number) => string) | undefined;
}

function getMetricSpec(kind: HostMetricKind | undefined): MetricSpec {
  switch (kind) {
    case HostMetricKind.MemoryUtilization:
      return {
        metricName: "system.memory.utilization",
        defaultTitle: "Host Memory Utilization",
        legendUnit: "%",
        aggregation: AggregationType.Avg,
        transformAsRate: false,
      };
    case HostMetricKind.MemoryUsage:
      return {
        metricName: "system.memory.usage",
        defaultTitle: "Host Memory Usage",
        legendUnit: "",
        aggregation: AggregationType.Avg,
        transformAsRate: false,
        yFormatter: (value: number) => {
          return ValueFormatter.formatValue(value, "By");
        },
      };
    case HostMetricKind.DiskIo:
      return {
        metricName: "system.disk.io",
        defaultTitle: "Host Disk I/O",
        legendUnit: "B/s",
        aggregation: AggregationType.Sum,
        transformAsRate: true,
        yFormatter: (value: number) => {
          return `${ValueFormatter.formatValue(value, "By")}/s`;
        },
      };
    case HostMetricKind.NetworkIo:
      return {
        metricName: "system.network.io",
        defaultTitle: "Host Network I/O",
        legendUnit: "B/s",
        aggregation: AggregationType.Sum,
        transformAsRate: true,
        yFormatter: (value: number) => {
          return `${ValueFormatter.formatValue(value, "By")}/s`;
        },
      };
    case HostMetricKind.Filesystem:
      return {
        metricName: "system.filesystem.usage",
        defaultTitle: "Host Filesystem Usage",
        legendUnit: "",
        aggregation: AggregationType.Avg,
        transformAsRate: false,
        yFormatter: (value: number) => {
          return ValueFormatter.formatValue(value, "By");
        },
      };
    case HostMetricKind.ProcessCount:
      return {
        metricName: "system.processes.count",
        defaultTitle: "Host Process Count",
        legendUnit: "",
        aggregation: AggregationType.Avg,
        transformAsRate: false,
      };
    case HostMetricKind.CpuUtilization:
    default:
      return {
        metricName: "system.cpu.utilization",
        defaultTitle: "Host CPU Utilization",
        legendUnit: "%",
        aggregation: AggregationType.Avg,
        transformAsRate: false,
      };
  }
}

function getHostSeries(data: AggregatedModel): { title: string } {
  const attributes: Record<string, unknown> =
    (data["attributes"] as Record<string, unknown>) || {};
  const hostName: string =
    (attributes[HOST_NAME_ATTRIBUTE] as string) ||
    (attributes[`resource.${HOST_NAME_ATTRIBUTE}`] as string) ||
    "Unknown Host";
  return { title: hostName };
}

const DashboardHostMetricChartComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const args: DashboardHostMetricChartComponent["arguments"] =
    props.component.arguments;
  const metricKind: HostMetricKind =
    args.metricKind || HostMetricKind.CpuUtilization;
  const hostIdentifier: string | undefined =
    args.hostIdentifier && args.hostIdentifier.trim() !== ""
      ? args.hostIdentifier.trim()
      : undefined;

  const spec: MetricSpec = useMemo(() => {
    return getMetricSpec(metricKind);
  }, [metricKind]);

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate]);

  const queryConfig: MetricQueryConfigData = useMemo(() => {
    const attributes: Record<string, string> = {};
    if (hostIdentifier) {
      attributes[HOST_NAME_ATTRIBUTE] = hostIdentifier;
    }

    return {
      metricAliasData: {
        metricVariable: "host_metric",
        title: args.title || spec.defaultTitle,
        description: args.description,
        legend: hostIdentifier ? hostIdentifier : "Host",
        legendUnit: spec.legendUnit,
      },
      metricQueryData: {
        filterData: {
          metricName: spec.metricName,
          attributes: attributes,
          aggegationType: spec.aggregation,
          aggregateBy: {},
        },
        groupBy: hostIdentifier
          ? undefined
          : {
              attributes: true,
            },
        groupByAttributeKeys: hostIdentifier
          ? undefined
          : [HOST_NAME_ATTRIBUTE],
      },
      chartType: MetricChartType.LINE,
      transformAsRate: spec.transformAsRate,
      yAxisValueFormatter: spec.yFormatter,
      getSeries: hostIdentifier ? undefined : getHostSeries,
    };
  }, [args.title, args.description, spec, hostIdentifier]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: [queryConfig],
      startAndEndDate: startAndEndDate,
      formulaConfigs: [],
    };
  }, [queryConfig, startAndEndDate]);

  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    useRef<MetricViewData>(metricViewData);
  metricViewDataRef.current = metricViewData;

  const fetchAggregatedResults: () => Promise<void> = useCallback(async () => {
    const data: MetricViewData = metricViewDataRef.current;
    setIsLoading(true);

    if (!data.startAndEndDate?.startValue || !data.startAndEndDate?.endValue) {
      setIsLoading(false);
      setError("Please select a valid time range.");
      return;
    }

    try {
      const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
        metricViewData: data,
      });

      setMetricResults(results);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAggregatedResults();
  }, [startAndEndDate, queryConfig, props.refreshTick, fetchAggregatedResults]);

  const hasWidgetHeader: boolean = Boolean(args.title || args.description);
  const widgetHeaderHeight: number = hasWidgetHeader ? 50 : 0;
  const perChartOverhead: number = 80;
  let heightOfChart: number | undefined =
    (props.dashboardComponentHeightInPx || 0) -
    widgetHeaderHeight -
    perChartOverhead;
  if (heightOfChart < 50) {
    heightOfChart = undefined;
  }

  if (isLoading && metricResults.length === 0) {
    return (
      <div className="w-full h-full flex flex-col p-1 animate-pulse">
        <div className="h-3 w-28 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 flex items-end gap-1 px-2 pb-2">
          {Array.from({ length: 12 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex-1 bg-gray-100 rounded-t"
                style={{
                  height: `${20 + Math.random() * 60}%`,
                  opacity: 0.4 + Math.random() * 0.4,
                }}
              ></div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={IconProp.ChartBar} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full overflow-hidden flex flex-col"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {hasWidgetHeader && (
        <div className="px-2 pt-2 pb-1 flex-shrink-0">
          {args.title && (
            <h3 className="text-sm font-semibold text-gray-700 tracking-tight">
              {args.title}
            </h3>
          )}
          {args.description && (
            <p className="mt-0.5 text-xs text-gray-400">{args.description}</p>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MetricCharts
          metricResults={metricResults}
          metricTypes={props.metricTypes}
          metricViewData={metricViewData}
          hideCard={true}
          heightInPx={heightOfChart}
        />
      </div>
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(
  DashboardHostMetricChartComponentElement,
  arePropsEqual,
);
