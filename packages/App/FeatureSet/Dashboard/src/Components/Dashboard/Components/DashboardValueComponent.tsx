import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import DashboardValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardValueComponent";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import ValueWidgetView, { SparklinePoint } from "./ValueWidgetView";
import {
  aggregateValues,
  collectDataPoints,
  getNumericValues,
  getResultsErrorMessage,
} from "./ValueWidgetData";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardValueComponentType;
}

/*
 * Single big-number stat from a OneUptime METRIC query. The external
 * Data Source equivalent is DashboardDataSourceValueComponent — a separate
 * widget type with its own query editor; the two share ValueWidgetView so
 * they look identical on a board.
 */
const DashboardValueComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [aggregationType, setAggregationType] = useState<AggregationType>(
    AggregationType.Avg,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const rawMetricQueryConfig: MetricQueryConfigData | undefined =
    props.component.arguments.metricQueryConfig;

  const metricQueryConfig: MetricQueryConfigData | undefined = useMemo(() => {
    if (!rawMetricQueryConfig) {
      return undefined;
    }
    return DashboardVariableInterpolation.applyToQueryConfig(
      rawMetricQueryConfig,
      props.variables,
    );
  }, [rawMetricQueryConfig, props.variables]);

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
      queryConfigs: metricQueryConfig ? [metricQueryConfig] : [],
      startAndEndDate: startAndEndDate,
      formulaConfigs: [],
    };
  }, [metricQueryConfig, startAndEndDate]);

  const metricViewDataRef: React.MutableRefObject<MetricViewData> =
    useRef<MetricViewData>(metricViewData);
  metricViewDataRef.current = metricViewData;

  // Monotonic id of the newest fetch — see the staleness guards below.
  const fetchSequenceRef: React.MutableRefObject<number> = useRef(0);

  const fetchAggregatedResults: () => Promise<void> = useCallback(async () => {
    const data: MetricViewData = metricViewDataRef.current;
    /*
     * Staleness guard: refresh ticks and config edits can overlap slow
     * requests — only the NEWEST fetch may write state, or an old
     * response would overwrite a newer result (and clear a newer error).
     */
    const fetchId: number = ++fetchSequenceRef.current;
    setIsLoading(true);

    if (!data.startAndEndDate?.startValue || !data.startAndEndDate?.endValue) {
      setIsLoading(false);
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
      return;
    }

    if (!data.queryConfigs[0].metricQueryData.filterData?.aggegationType) {
      setIsLoading(false);
      return;
    }
    setAggregationType(
      (data.queryConfigs[0].metricQueryData.filterData
        ?.aggegationType as AggregationType) || AggregationType.Avg,
    );

    try {
      const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
        metricViewData: data,
      });

      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setMetricResults(results);
      setError("");
    } catch (err: unknown) {
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAggregatedResults();
  }, [
    startAndEndDate,
    metricQueryConfig,
    props.variables,
    props.refreshTick,
    fetchAggregatedResults,
  ]);

  // Collect all data points for sparkline and aggregation
  const allDataPoints: Array<AggregatedModel> =
    collectDataPoints(metricResults);

  const numericValues: Array<number> = getNumericValues(allDataPoints);

  const aggregatedValue: number | null = aggregateValues(
    numericValues,
    aggregationType,
  );

  /*
   * Sparkline data — preserve timestamp alongside value so the view can
   * render it under the big number while the cursor is over the chart.
   */
  const sparklineData: Array<SparklinePoint> = allDataPoints.map(
    (item: AggregatedModel) => {
      return {
        value: item.value,
        timestamp:
          item.timestamp instanceof Date
            ? item.timestamp
            : new Date(item.timestamp as unknown as string),
      };
    },
  );

  const metricName: string =
    props.component.arguments.metricQueryConfig?.metricQueryData.filterData.metricName?.toString() ||
    "";

  const rawUnit: string =
    props.metricTypes?.find((item: MetricType) => {
      return item.name?.toString() === metricName;
    })?.unit || "";

  const isConfigured: boolean = Boolean(
    props.component.arguments.metricQueryConfig?.metricQueryData?.filterData &&
      Object.keys(
        props.component.arguments.metricQueryConfig.metricQueryData.filterData,
      ).length > 0,
  );

  return (
    <ValueWidgetView
      widthInPx={props.dashboardComponentWidthInPx}
      heightInPx={props.dashboardComponentHeightInPx}
      isEditMode={props.isEditMode}
      isLoading={isLoading}
      hasEverLoaded={metricResults.length > 0}
      error={error}
      value={aggregatedValue}
      points={sparklineData}
      noDataMessage={
        getResultsErrorMessage(metricResults) ||
        "No data for the selected time range"
      }
      isConfigured={isConfigured}
      setupTitle="Value Widget"
      setupMessage="Click to configure metric"
      title={props.component.arguments.title}
      rawUnit={rawUnit}
      metricName={metricName}
      hideUnit={props.component.arguments.hideUnit === true}
      warningThreshold={props.component.arguments.warningThreshold}
      criticalThreshold={props.component.arguments.criticalThreshold}
      trendDirection={props.component.arguments.trendDirection}
    />
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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  if (!JSONFunctions.deepEqual(prev.variables, next.variables)) {
    return false;
  }

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

export default React.memo(DashboardValueComponentElement, arePropsEqual);
