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
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardDataSourceGaugeComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardDataSourceGaugeComponent";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceQueryUtil from "../../../Utils/DataSourceQuery";
import DataSourceQueryText from "Common/Utils/DataSource/DataSourceQueryText";
import DataSourceValueReducer from "Common/Utils/DataSource/DataSourceValueReducer";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import GaugeWidgetView from "./GaugeWidgetView";
import DataSourceWidgetPlaceholder from "./DataSourceWidgetPlaceholder";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";
import IconProp from "Common/Types/Icon/IconProp";
import { isDataSourceQueryConfigured } from "../Utils/DataSourceWidget";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDataSourceGaugeComponentType;
}

/*
 * Radial gauge over an EXTERNAL Data Source query. Fetches through the
 * authenticated /data-source/query endpoint and reduces the returned series
 * client-side (the widget's "Reduce" setting).
 *
 * Presentation is shared with the metric Gauge widget via GaugeWidgetView.
 * Public dashboards render a placeholder — the anonymous API has no
 * data-source surface, by design.
 */
const DashboardDataSourceGaugeComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [results, setResults] = useState<Array<AggregatedResult>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const rawQueryConfig: DataSourceQueryConfig | undefined =
    props.component.arguments.query;

  const isConfigured: boolean = isDataSourceQueryConfigured(rawQueryConfig);

  const queryConfig: DataSourceQueryConfig | undefined = isConfigured
    ? rawQueryConfig
    : undefined;

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  const fetchStateRef: React.MutableRefObject<{
    queryConfig: DataSourceQueryConfig | undefined;
    variables: Array<DashboardVariable> | undefined;
    startDate: Date | undefined;
    endDate: Date | undefined;
  }> = useRef({
    queryConfig: queryConfig,
    variables: props.variables,
    startDate: startAndEndDate?.startValue,
    endDate: startAndEndDate?.endValue,
  });
  fetchStateRef.current = {
    queryConfig: queryConfig,
    variables: props.variables,
    startDate: startAndEndDate?.startValue,
    endDate: startAndEndDate?.endValue,
  };

  // Monotonic id of the newest fetch — see the staleness guard below.
  const fetchSequenceRef: React.MutableRefObject<number> = useRef(0);

  const fetchResults: () => Promise<void> = useCallback(async () => {
    const state: typeof fetchStateRef.current = fetchStateRef.current;
    /*
     * Staleness guard: refresh ticks and config edits can overlap slow
     * requests — only the NEWEST fetch may write state, or an old
     * response would overwrite a newer result (and clear a newer error).
     */
    const fetchId: number = ++fetchSequenceRef.current;
    setIsLoading(true);

    if (!state.queryConfig || !state.startDate || !state.endDate) {
      setIsLoading(false);
      return;
    }

    try {
      const interpolatedQuery: string = DataSourceQueryText.applyVariables(
        state.queryConfig.query,
        state.variables,
      );
      const result: AggregatedResult =
        await DataSourceQueryUtil.fetchTimeSeries({
          queryConfig: { ...state.queryConfig, query: interpolatedQuery },
          startDate: state.startDate,
          endDate: state.endDate,
        });
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setResults([result]);
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
    if (isPublicDashboard()) {
      setIsLoading(false);
      return;
    }
    fetchResults();
  }, [
    startAndEndDate,
    queryConfig,
    props.variables,
    props.refreshTick,
    fetchResults,
  ]);

  const reducedValue: number | null = DataSourceValueReducer.reduce(
    DataSourceValueReducer.getNumericValues(results),
    props.component.arguments.reduce,
  );

  if (isPublicDashboard()) {
    return <DataSourceWidgetPlaceholder icon={IconProp.Gauge} />;
  }

  return (
    <GaugeWidgetView
      widthInPx={props.dashboardComponentWidthInPx}
      heightInPx={props.dashboardComponentHeightInPx}
      componentId={props.componentId?.toString() || ""}
      isLoading={isLoading}
      hasEverLoaded={results.length > 0}
      error={error}
      value={reducedValue}
      noDataMessage={
        DataSourceValueReducer.getResultsErrorMessage(results) ||
        "No data for the selected time range"
      }
      isConfigured={isConfigured}
      setupTitle="Data Source Gauge"
      setupMessage="Click to configure a query"
      title={props.component.arguments.gaugeTitle}
      rawUnit={props.component.arguments.unit || ""}
      /*
       * External data has no OneUptime metric behind it, so there is no
       * name for ValueFormatter's name-based heuristics (fraction rescale,
       * higher-is-worse) to read.
       */
      metricName=""
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

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(
  DashboardDataSourceGaugeComponentElement,
  arePropsEqual,
);
