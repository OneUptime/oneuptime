import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";

/*
 * THE QUERY OF A WIDGET THAT READS ONE OF ONEUPTIME'S METRICS: the Value,
 * Gauge and Chart widgets. Kept free of React so the widgets and their
 * tests read it alike.
 */

/*
 * Whether the widget's query has been started: its filter holds anything,
 * a metric's name first of all. A new widget's is empty, and so is one
 * whose metric was cleared again - the widget then says what it needs
 * (DashboardWidgetSetupCopy) instead of reading anything.
 */
export const isMetricWidgetQuerySet: (
  queryConfig: MetricQueryConfigData | undefined,
) => boolean = (queryConfig: MetricQueryConfigData | undefined): boolean => {
  const filterData: FilterData<MetricsQuery> | undefined =
    queryConfig?.metricQueryData?.filterData;

  return Boolean(filterData && Object.keys(filterData).length > 0);
};

/*
 * A query that names no aggregation is an average. The "Aggregate by"
 * picker shows Avg until another one is picked and stores nothing until
 * then, and the metrics read asks for Avg when none is stored
 * (MetricUtil.fetchResults). So a chart whose metric was picked and
 * nothing else draws its average, as its settings say - not "pick an
 * aggregation" under a picker that shows one. The query is handed back
 * as it is when it has one, or names nothing yet.
 */
export const withAverageWhenNotAggregated: (
  queryConfig: MetricQueryConfigData,
) => MetricQueryConfigData = (
  queryConfig: MetricQueryConfigData,
): MetricQueryConfigData => {
  if (
    !isMetricWidgetQuerySet(queryConfig) ||
    queryConfig.metricQueryData.filterData.aggegationType
  ) {
    return queryConfig;
  }

  return {
    ...queryConfig,
    metricQueryData: {
      ...queryConfig.metricQueryData,
      filterData: {
        ...queryConfig.metricQueryData.filterData,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  };
};
