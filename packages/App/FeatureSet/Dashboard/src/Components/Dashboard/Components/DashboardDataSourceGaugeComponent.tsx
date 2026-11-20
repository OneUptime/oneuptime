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
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { useDashboardWidgetPlace } from "./DashboardWidgetPreview";
import {
  DashboardWidgetSetupNeed,
  getDashboardWidgetSetupLine,
} from "./DashboardWidgetSetupCopy";
import DataSourceWidgetPlaceholder from "./DataSourceWidgetPlaceholder";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";
import IconProp from "Common/Types/Icon/IconProp";
import { getRunnableDataSourceQueries } from "../Utils/DataSourceWidget";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDataSourceGaugeComponentType;
}

/*
 * Radial gauge over an EXTERNAL Data Source query. Fetches through the
 * authenticated /data-source/query endpoint and reduces the returned series
 * client-side (the widget's "Reduce" setting).
 *
 * Presentation is shared with the metric Gauge widget via GaugeWidgetView.
 * On a public dashboard (issue #10226) it is drawn only when it reads this
 * project's metrics: its stored query is run by the dashboard's public
 * PromQL route, named by this widget, and drawn the same way.
 */
const DashboardDataSourceGaugeComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [results, setResults] = useState<Array<AggregatedResult>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // The query it runs, signed in or on a public dashboard.
  const queryConfig: DataSourceQueryConfig | undefined = useMemo(() => {
    return getRunnableDataSourceQueries(props.component.arguments.query)[0];
  }, [props.component.arguments.query]);

  const isConfigured: boolean = Boolean(queryConfig);

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  const fetchStateRef: React.MutableRefObject<{
    componentId: string;
    queryConfig: DataSourceQueryConfig | undefined;
    variables: Array<DashboardVariable> | undefined;
    startDate: Date | undefined;
    endDate: Date | undefined;
  }> = useRef({
    componentId: props.componentId.toString(),
    queryConfig: queryConfig,
    variables: props.variables,
    startDate: startAndEndDate?.startValue,
    endDate: startAndEndDate?.endValue,
  });
  fetchStateRef.current = {
    componentId: props.componentId.toString(),
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
      // A public dashboard's stored query, by this widget.
      const result: AggregatedResult = isPublicDashboard()
        ? await DataSourceQueryUtil.fetchPublicTimeSeries({
            target: {
              componentId: state.componentId,
              queryIndex: 0,
              variables: state.variables,
            },
            startDate: state.startDate,
            endDate: state.endDate,
          })
        : await DataSourceQueryUtil.fetchTimeSeries({
            queryConfig: {
              ...state.queryConfig,
              query: DataSourceQueryText.applyVariablesForSource({
                dataSourceId: state.queryConfig.dataSourceId,
                queryText: state.queryConfig.query,
                variables: state.variables,
              }),
            },
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
   * Until a query is written: a click only where it opens the settings
   * (issue #7160). Read before the public dashboard's placeholder below,
   * as every hook is.
   */
  const setupMessage: string = getDashboardWidgetSetupLine(
    DashboardWidgetSetupNeed.Query,
    useDashboardWidgetPlace(props.isEditMode),
  );

  // A public dashboard is served no query of it to run: nothing to draw.
  if (isPublicDashboard() && !isConfigured) {
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
        translationKey("No data for the selected time range")
      }
      isConfigured={isConfigured}
      setupTitle={translationKey("Data Source Gauge")}
      setupMessage={setupMessage}
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
