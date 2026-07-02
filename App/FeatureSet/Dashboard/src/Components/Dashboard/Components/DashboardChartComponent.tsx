import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardChartComponent";
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
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardChartComponent;
}

const DashboardChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const primaryQueryConfig: MetricQueryConfigData | undefined =
    props.component.arguments.metricQueryConfig;
  const additionalQueryConfigs: Array<MetricQueryConfigData> | undefined =
    props.component.arguments.metricQueryConfigs;
  const formulaConfigsArg: Array<MetricFormulaConfigData> | undefined =
    props.component.arguments.metricFormulaConfigs;

  /*
   * Stabilize derived values so this component does not re-fetch (or
   * cause MetricCharts to re-render) every time the parent re-renders
   * with structurally-identical inputs. The dashboard parent emits new
   * object references on most render passes (timer ticks, drag state,
   * canvas resize), so without these memos every chart would refetch
   * on each tick.
   */
  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const configs: Array<MetricQueryConfigData> = [];
    if (primaryQueryConfig) {
      configs.push(primaryQueryConfig);
    }
    if (additionalQueryConfigs && additionalQueryConfigs.length > 0) {
      configs.push(...additionalQueryConfigs);
    }
    return DashboardVariableInterpolation.applyToQueryConfigs(
      configs,
      props.variables,
    );
  }, [primaryQueryConfig, additionalQueryConfigs, props.variables]);

  const formulaConfigs: Array<MetricFormulaConfigData> = useMemo(() => {
    return formulaConfigsArg && formulaConfigsArg.length > 0
      ? formulaConfigsArg
      : [];
  }, [formulaConfigsArg]);

  /*
   * refreshTick is a dep so each auto-refresh re-resolves the relative
   * range ("Past 1 hour") to a fresh concrete window; without it the
   * window is frozen at mount and every refresh re-queries stale data.
   */
  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: queryConfigs,
      startAndEndDate: startAndEndDate,
      formulaConfigs: formulaConfigs,
    };
  }, [queryConfigs, startAndEndDate, formulaConfigs]);

  /*
   * Latest props in a ref so fetchAggregatedResults can stay stable
   * across renders without React warning about missing deps.
   */
  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    useRef<MetricViewData>(metricViewData);
  metricViewDataRef.current = metricViewData;

  const fetchAggregatedResults: () => Promise<void> = useCallback(async () => {
    const data: MetricViewData = metricViewDataRef.current;
    setIsLoading(true);

    if (!data.startAndEndDate?.startValue || !data.startAndEndDate?.endValue) {
      setIsLoading(false);
      setError("Please select a valid start and end date.");
      return;
    }

    if (
      !data.queryConfigs ||
      data.queryConfigs.length === 0 ||
      !data.queryConfigs[0] ||
      !data.queryConfigs[0].metricQueryData ||
      !data.queryConfigs[0].metricQueryData.filterData ||
      Object.keys(data.queryConfigs[0].metricQueryData.filterData).length === 0
    ) {
      setIsLoading(false);
      setError("Please select a metric. Click here to add a metric.");
      return;
    }

    if (!data.queryConfigs[0].metricQueryData.filterData?.aggegationType) {
      setIsLoading(false);
      setError("Please select a aggregation. Click here to add a aggregation.");
      return;
    }

    try {
      const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
        metricViewData: data,
      });

      setMetricResults(results);
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, []);

  /*
   * Fetch when the bound time range, the query config shape, or the
   * external refresh tick change. metricTypes is intentionally not in
   * the dep list — it is only used downstream for unit display in
   * MetricCharts and changing its array reference (which the parent
   * does on every render) must not trigger another aggregate call.
   */
  useEffect(() => {
    fetchAggregatedResults();
  }, [
    startAndEndDate,
    queryConfigs,
    formulaConfigs,
    props.refreshTick,
    fetchAggregatedResults,
  ]);

  const getMetricChartType: () => MetricChartType = useCallback(() => {
    if (props.component.arguments.chartType === DashboardChartType.Bar) {
      return MetricChartType.BAR;
    }
    if (
      props.component.arguments.chartType === DashboardChartType.Area ||
      props.component.arguments.chartType === DashboardChartType.StackedArea
    ) {
      return MetricChartType.AREA;
    }
    return MetricChartType.LINE;
  }, [props.component.arguments.chartType]);

  const chartMetricViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: queryConfigs.map((config: MetricQueryConfigData) => {
        return {
          ...config,
          metricAliasData: {
            metricVariable: config.metricAliasData?.metricVariable || undefined,
            title: config.metricAliasData?.title || undefined,
            description: config.metricAliasData?.description || undefined,
            legend: config.metricAliasData?.legend || undefined,
            legendUnit: config.metricAliasData?.legendUnit || undefined,
          },
          chartType: config.chartType || getMetricChartType(),
        };
      }),
      startAndEndDate: startAndEndDate,
      formulaConfigs: formulaConfigs.map((config: MetricFormulaConfigData) => {
        return {
          ...config,
          chartType: config.chartType || getMetricChartType(),
        };
      }),
    };
  }, [queryConfigs, formulaConfigs, startAndEndDate, getMetricChartType]);

  if (isLoading && metricResults.length === 0) {
    // Skeleton loading for chart - only on initial load
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
      {(props.component.arguments.chartTitle ||
        props.component.arguments.chartDescription) && (
        <div className="px-2 pt-2 pb-1 flex-shrink-0">
          {props.component.arguments.chartTitle && (
            <h3 className="text-sm font-semibold text-gray-700 tracking-tight">
              {props.component.arguments.chartTitle}
            </h3>
          )}
          {props.component.arguments.chartDescription && (
            <p className="mt-0.5 text-xs text-gray-400">
              {props.component.arguments.chartDescription}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <MetricCharts
          metricResults={metricResults}
          metricTypes={props.metricTypes}
          metricViewData={chartMetricViewData}
          hideCard={true}
        />
      </div>
    </div>
  );
};

/*
 * Custom comparator: skip re-render unless something the chart actually
 * cares about has changed. The parent passes new metrics/array references
 * on every render — without this, every chart re-renders on every parent
 * tick (auto-refresh, drag state, canvas resize) and the children
 * recompute series/legends each time.
 */
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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  if (!JSONFunctions.deepEqual(prev.variables, next.variables)) {
    return false;
  }

  /*
   * metricTypes drives unit display — compare by length + names rather
   * than identity, since the parent rebuilds the array on each render.
   */
  const prevTypes: Array<{ name?: string }> = prev.metricTypes as Array<{
    name?: string;
  }>;
  const nextTypes: Array<{ name?: string }> = next.metricTypes as Array<{
    name?: string;
  }>;
  if (prevTypes.length !== nextTypes.length) {
    return false;
  }
  for (let i: number = 0; i < prevTypes.length; i++) {
    if (prevTypes[i]?.name !== nextTypes[i]?.name) {
      return false;
    }
  }

  return true;
}

export default React.memo(DashboardChartComponentElement, arePropsEqual);
