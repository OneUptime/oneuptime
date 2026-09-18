import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardDataSourceChartComponentType from "Common/Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import MetricCharts from "../../Metrics/MetricCharts";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData, {
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceQueryUtil from "../../../Utils/DataSourceQuery";
import DataSourceQueryText from "Common/Utils/DataSource/DataSourceQueryText";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { isPublicDashboard } from "../Utils/PublicDashboardContext";
import { getConfiguredDataSourceQueries } from "../Utils/DataSourceWidget";
import DataSourceWidgetPlaceholder from "./DataSourceWidgetPlaceholder";
import JSONFunctions from "Common/Types/JSONFunctions";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDataSourceChartComponentType;
}

/*
 * Chart renderer for widgets bound to an EXTERNAL Data Source (PromQL /
 * SQL / LogQL / ES DSL / REST). Fetches through the authenticated
 * /data-source/query endpoint and feeds the results into the same
 * MetricCharts layer OneUptime metrics use, via a synthetic query config:
 *  - series grouping comes from each point's `attributes` object, exposed
 *    through groupByAttributeKeys computed from the result;
 *  - `filterData.metricName` stays unset so MetricCharts never fires
 *    metric-exemplar fetches for external data;
 *  - a legend template ("{{label}}") becomes a getSeries naming hook.
 *
 * Public dashboards render a placeholder instead — the anonymous API has
 * no data-source surface, by design.
 */
const DashboardDataSourceChartComponent: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [results, setResults] = useState<Array<AggregatedResult>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const queryConfigs: Array<DataSourceQueryConfig> = useMemo(() => {
    return getConfiguredDataSourceQueries(props.component.arguments.queries);
  }, [props.component.arguments.queries]);

  const startAndEndDate: ReturnType<
    typeof RangeStartAndEndDateTimeUtil.getStartAndEndDate
  > = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    );
    /*
     * refreshTick re-resolves the relative range each auto-refresh, same
     * as the metric chart widget.
     */
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  const fetchStateRef: React.MutableRefObject<{
    queryConfigs: Array<DataSourceQueryConfig>;
    variables: Array<DashboardVariable> | undefined;
    startDate: Date | undefined;
    endDate: Date | undefined;
  }> = useRef({
    queryConfigs: queryConfigs,
    variables: props.variables,
    startDate: startAndEndDate?.startValue,
    endDate: startAndEndDate?.endValue,
  });
  fetchStateRef.current = {
    queryConfigs: queryConfigs,
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
     * requests, and Promise.all completions are not ordered — only the
     * NEWEST fetch may write state, or an old response would overwrite a
     * newer result (and clear a newer error).
     */
    const fetchId: number = ++fetchSequenceRef.current;
    setIsLoading(true);

    if (!state.startDate || !state.endDate) {
      setError("Please select a valid start and end date.");
      setIsLoading(false);
      return;
    }

    /*
     * Nothing to run yet. Not an error — the widget is seeded with a blank
     * query card, so this is simply the state every new chart starts in.
     * The setup prompt below says so; an error tile would read as a failure
     * the user caused.
     */
    if (state.queryConfigs.length === 0) {
      setError("");
      setIsLoading(false);
      return;
    }

    try {
      const fetched: Array<AggregatedResult> = await Promise.all(
        state.queryConfigs.map((config: DataSourceQueryConfig) => {
          const interpolatedQuery: string = DataSourceQueryText.applyVariables(
            config.query,
            state.variables,
          );
          return DataSourceQueryUtil.fetchTimeSeries({
            queryConfig: { ...config, query: interpolatedQuery },
            startDate: state.startDate!,
            endDate: state.endDate!,
          });
        }),
      );
      if (fetchId !== fetchSequenceRef.current) {
        return;
      }
      setResults(fetched);
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
    queryConfigs,
    props.variables,
    props.refreshTick,
    fetchResults,
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

  /*
   * Synthetic MetricViewData: one query config per external query, with
   * groupByAttributeKeys computed from the data so MetricCharts splits
   * series on point.attributes, and a getSeries hook when a legend
   * template is set.
   */
  const chartMetricViewData: MetricViewData = useMemo(() => {
    const syntheticConfigs: Array<MetricQueryConfigData> = queryConfigs.map(
      (config: DataSourceQueryConfig, index: number) => {
        const result: AggregatedResult | undefined = results[index];
        const attributeKeys: Array<string> = result
          ? DataSourceQueryUtil.getAttributeKeys(result)
          : [];

        const legendTemplate: string | undefined = config.legend;

        const syntheticConfig: MetricQueryConfigData = {
          id: config.id || `data-source-query-${index}`,
          metricAliasData: {
            metricVariable: undefined,
            title: undefined,
            description: undefined,
            legend:
              legendTemplate && !legendTemplate.includes("{{")
                ? legendTemplate
                : legendTemplate
                  ? undefined
                  : `Query ${index + 1}`,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {},
            groupByAttributeKeys:
              attributeKeys.length > 0 ? attributeKeys : undefined,
          },
          chartType: getMetricChartType(),
        };

        if (legendTemplate && legendTemplate.includes("{{")) {
          syntheticConfig.getSeries = (dataPoint: AggregatedModel) => {
            const attributes: Record<string, string> | undefined = (
              dataPoint as Record<string, unknown>
            )["attributes"] as Record<string, string> | undefined;
            return {
              title: DataSourceQueryText.applyLegendTemplate(
                legendTemplate,
                attributes,
              ),
            };
          };
        }

        return syntheticConfig;
      },
    );

    return {
      queryConfigs: syntheticConfigs,
      startAndEndDate: startAndEndDate,
      formulaConfigs: [],
    };
  }, [queryConfigs, results, startAndEndDate, getMetricChartType]);

  if (isPublicDashboard()) {
    return <DataSourceWidgetPlaceholder icon={IconProp.ChartBar} />;
  }

  /*
   * Before any query is filled in. This outranks the error branch below for
   * the same reason it does on the other three widgets: a chart with no
   * queries left has nothing to be wrong about, and the fetch that would
   * clear a previous error is the one the missing query stops from running.
   */
  if (queryConfigs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-1.5">
        <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
          <div className="h-5 w-5 text-indigo-300">
            <Icon icon={IconProp.ChartBar} />
          </div>
        </div>
        <p className="text-xs font-medium text-gray-500">
          {props.component.arguments.chartTitle?.trim() || "Data Source Chart"}
        </p>
        <p className="text-xs text-gray-400 text-center">
          Click to configure a query
        </p>
      </div>
    );
  }

  if (isLoading && results.length === 0) {
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
          <div className="min-w-0">
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
        </div>
      )}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <MetricCharts
          metricResults={results}
          metricTypes={[]}
          metricViewData={chartMetricViewData}
          hideCard={true}
          topNOverrideScope={props.componentId.toString()}
          /*
           * These series come from an EXTERNAL data source through a
           * synthetic query config — OneUptime's logs/traces/exceptions
           * and the Metric Explorer know nothing about them, so the
           * per-series investigate menu would only mislead (and it must
           * never render on unauthenticated public dashboards).
           */
          enableSeriesActions={false}
          chartSyncId={props.chartSyncId}
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

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(DashboardDataSourceChartComponent, arePropsEqual);
