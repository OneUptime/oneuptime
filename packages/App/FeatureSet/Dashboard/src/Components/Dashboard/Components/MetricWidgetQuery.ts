import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsQuery from "Common/Types/Metrics/MetricsQuery";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";

/*
 * THE QUERY OF A WIDGET THAT READS ONE OF ONEUPTIME'S METRICS: the Value,
 * Gauge and Chart widgets, and each metric column of the Table. Kept free
 * of React so the widgets and their tests read it alike.
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

// Whether the query names a metric to read: a Table column's may not yet.
export const namesAMetric: (
  queryConfig: MetricQueryConfigData | undefined,
) => boolean = (queryConfig: MetricQueryConfigData | undefined): boolean => {
  const metricName: unknown =
    queryConfig?.metricQueryData?.filterData?.metricName;

  return (
    metricName !== undefined &&
    metricName !== null &&
    String(metricName).trim().length > 0
  );
};

/*
 * WHAT THE METRIC TABLE READS (issue #7329).
 *
 * Each metric column of a Table is a query, and a new Table has one column
 * with no metric picked yet. The Table read every column's query as it
 * was: a new Table asked the metrics read for no metric at all, and so did
 * a column just added to a table that worked, beside the others. And an
 * older table's query that stored no aggregation stopped the whole table:
 * "Pick an aggregation for your first metric column.", under a picker that
 * showed Avg.
 *
 * Now a column is read once it names a metric, as its average while it
 * names no aggregation (withAverageWhenNotAggregated, as the Chart and the
 * Value widget read theirs), and the stored widget is never changed. A
 * table none of whose columns names a metric reads nothing and says what
 * it needs (DashboardWidgetSetupCopy's MetricColumn line).
 */
export interface MetricTableRead {
  // The queries to read: each that names a metric, aggregated.
  queryConfigs: Array<MetricQueryConfigData>;
  /*
   * For each of the table's queries, in its order: its place among the
   * queries read, or null for a column that names no metric yet.
   */
  readIndexes: Array<number | null>;
}

export const getMetricTableRead: (
  queryConfigs: Array<MetricQueryConfigData>,
) => MetricTableRead = (
  queryConfigs: Array<MetricQueryConfigData>,
): MetricTableRead => {
  const read: Array<MetricQueryConfigData> = [];
  const readIndexes: Array<number | null> = [];

  for (const queryConfig of queryConfigs) {
    if (!namesAMetric(queryConfig)) {
      readIndexes.push(null);
      continue;
    }

    readIndexes.push(read.length);
    read.push(withAverageWhenNotAggregated(queryConfig));
  }

  return { queryConfigs: read, readIndexes: readIndexes };
};

// Whether the Table has a column to read: one that names a metric.
export const isMetricTableSetUp: (
  queryConfigs: Array<MetricQueryConfigData>,
) => boolean = (queryConfigs: Array<MetricQueryConfigData>): boolean => {
  return queryConfigs.some((queryConfig: MetricQueryConfigData): boolean => {
    return namesAMetric(queryConfig);
  });
};

/*
 * The read's results back in the table's order: the metrics read answers
 * the queries it was asked first, in their order, then the formulas. A
 * column that names no metric gets no rows, so every result stays beside
 * its own column - and a formula that uses that column's letter says so
 * (an unknown variable), as it would for any letter no column has.
 */
export const placeMetricTableResults: (data: {
  read: MetricTableRead;
  results: Array<AggregatedResult>;
}) => Array<AggregatedResult> = (data: {
  read: MetricTableRead;
  results: Array<AggregatedResult>;
}): Array<AggregatedResult> => {
  const placed: Array<AggregatedResult> = data.read.readIndexes.map(
    (readIndex: number | null): AggregatedResult => {
      if (readIndex === null) {
        return { data: [] };
      }

      return data.results[readIndex] || { data: [] };
    },
  );

  return [...placed, ...data.results.slice(data.read.queryConfigs.length)];
};
