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
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardDataSourceValueComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceQueryUtil from "../../../Utils/DataSourceQuery";
import DataSourceQueryText from "Common/Utils/DataSource/DataSourceQueryText";
import DataSourceValueReducer from "Common/Utils/DataSource/DataSourceValueReducer";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import ValueWidgetView, { SparklinePoint } from "./ValueWidgetView";
import DataSourceWidgetPlaceholder from "./DataSourceWidgetPlaceholder";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";
import IconProp from "Common/Types/Icon/IconProp";
import { isDataSourceQueryConfigured } from "../Utils/DataSourceWidget";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDataSourceValueComponentType;
}

/*
 * Single big-number stat from an EXTERNAL Data Source query. Fetches
 * through the authenticated /data-source/query endpoint and reduces the
 * returned series client-side (the widget's "Reduce" setting) — an external
 * source has no OneUptime "Aggregate by" to do it server-side.
 *
 * Presentation is shared with the metric Value widget via ValueWidgetView.
 * Public dashboards render a placeholder: the anonymous API has no
 * data-source surface, by design.
 */
const DashboardDataSourceValueComponentElement: FunctionComponent<
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

  /*
   * Latest config + variables in a ref so the fetch callback stays stable
   * (no deps) while still reading current values.
   */
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

  /*
   * Sparkline points, in time order — a hand-written SQL query with no
   * ORDER BY would otherwise draw a scribble.
   */
  const sparklineData: Array<SparklinePoint> =
    DataSourceValueReducer.sortPointsByTime(results).map(
      (item: AggregatedModel): SparklinePoint => {
        return {
          value: item.value,
          timestamp:
            item.timestamp instanceof Date
              ? item.timestamp
              : new Date(item.timestamp as unknown as string),
        };
      },
    );

  if (isPublicDashboard()) {
    return <DataSourceWidgetPlaceholder icon={IconProp.Hashtag} />;
  }

  return (
    <ValueWidgetView
      widthInPx={props.dashboardComponentWidthInPx}
      heightInPx={props.dashboardComponentHeightInPx}
      isEditMode={props.isEditMode}
      isLoading={isLoading}
      hasEverLoaded={results.length > 0}
      error={error}
      value={reducedValue}
      points={sparklineData}
      noDataMessage={
        DataSourceValueReducer.getResultsErrorMessage(results) ||
        "No data for the selected time range"
      }
      isConfigured={isConfigured}
      setupTitle="Data Source Value"
      setupMessage="Click to configure a query"
      title={props.component.arguments.title}
      rawUnit={props.component.arguments.unit || ""}
      /*
       * External data has no OneUptime metric behind it, so there is no
       * name for ValueFormatter's name-based heuristics to read. The unit
       * the user typed is the only formatting signal.
       */
      metricName=""
      hideUnit={false}
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

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(
  DashboardDataSourceValueComponentElement,
  arePropsEqual,
);
