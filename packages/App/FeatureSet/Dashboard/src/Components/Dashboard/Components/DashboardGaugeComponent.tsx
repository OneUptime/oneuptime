import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardGaugeComponent from "Common/Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import GaugeWidgetView from "./GaugeWidgetView";
import {
  aggregateValues,
  collectDataPoints,
  getNumericValues,
  getResultsErrorMessage,
} from "./ValueWidgetData";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardGaugeComponent;
}

/*
 * Radial gauge over a OneUptime METRIC query. The external Data Source
 * equivalent is DashboardDataSourceGaugeComponent — a separate widget type
 * with its own query editor; the two share GaugeWidgetView so they look
 * identical on a board.
 */
const DashboardGaugeComponentElement: FunctionComponent<ComponentProps> = (
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

    /*
     * Default a missing aggregation to Avg instead of bailing out
     * silently. MetricUtil.fetchResults already sends Avg when
     * `aggegationType` is absent, and the "Aggregate by" picker displays
     * Avg as its default without always persisting it — so a gauge
     * configured by picking only a metric must still fetch and render
     * rather than sit at a blank "0" with no explanation.
     */
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

  const aggregatedValue: number | null = aggregateValues(
    getNumericValues(collectDataPoints(metricResults)),
    aggregationType,
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
    <GaugeWidgetView
      widthInPx={props.dashboardComponentWidthInPx}
      heightInPx={props.dashboardComponentHeightInPx}
      componentId={props.componentId?.toString() || ""}
      isLoading={isLoading}
      hasEverLoaded={metricResults.length > 0}
      error={error}
      value={aggregatedValue}
      noDataMessage={
        getResultsErrorMessage(metricResults) ||
        "No data for the selected time range"
      }
      isConfigured={isConfigured}
      setupTitle="Gauge Widget"
      setupMessage="Click to configure metric"
      title={props.component.arguments.gaugeTitle}
      rawUnit={rawUnit}
      metricName={metricName}
      minValue={props.component.arguments.minValue ?? 0}
      maxValue={props.component.arguments.maxValue ?? 100}
      warningThreshold={props.component.arguments.warningThreshold}
      criticalThreshold={props.component.arguments.criticalThreshold}
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

  if (!JSONFunctions.deepEqual(prev.variables, next.variables)) {
    return false;
  }

  /*
   * metricTypes drives unit lookup for ValueFormatter — compare by length
   * and names so re-renders happen only when the underlying registry
   * changes, not on every parent identity flip.
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

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardGaugeComponentElement, arePropsEqual);
