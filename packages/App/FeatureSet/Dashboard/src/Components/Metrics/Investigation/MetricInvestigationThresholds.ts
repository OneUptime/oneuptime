import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import { AggregationIntervalUtil } from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import TimeRange from "Common/Types/Time/TimeRange";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import { MetricChartThreshold } from "../Utils/MetricChartThresholds";
import MetricInvestigationTime from "./MetricInvestigationTime";
import { MetricInvestigationQueries } from "./MetricInvestigationQueries";

/*
 * Which of a page's threshold lines a metric investigation draws right now
 * (issues #5759 and #6250). The lines belong to the metrics the page starts
 * from - the ones its monitor compares - so:
 *
 * - a line is drawn while its query or formula still charts what it did at
 *   the start. The reader can change a metric, its filters or its
 *   aggregation (Edit metrics): the line then says nothing about the chart,
 *   and goes. A change of how it is drawn (bar or line, a colour, a unit to
 *   read it in) keeps it;
 * - a line on a sum or a count holds only where each point covers what the
 *   monitor reads: a count of errors per minute is not a count per fifteen
 *   minutes. On a chart of another range it is left off, and the range that
 *   shows it is offered instead.
 *
 * Pure: the card, its tests and the pages read it the same way.
 */

export interface MetricInvestigationThreshold extends MetricChartThreshold {
  /*
   * The stretch each point of a chart must cover for the line to hold
   * (MonitorMetricThreshold.onlyAtInterval); null or left out when it
   * holds on a chart of any range.
   */
  onlyAtInterval?: AggregationInterval | null | undefined;
}

export interface DrawnThresholds {
  // The lines the charts draw.
  drawn: Array<MetricChartThreshold>;
  // Lines on unchanged metrics that this range's points cannot show.
  hiddenAtThisRange: Array<MetricInvestigationThreshold>;
}

type SeriesKeyFunction = (
  queries: MetricInvestigationQueries,
  variable: string,
) => string | null;

// What a query charts, leaving out how it is drawn.
const getQueryDataKey: (queryConfig: MetricQueryConfigData) => string = (
  queryConfig: MetricQueryConfigData,
): string => {
  const serialized: SerializedMetricQuery =
    MetricExplorerUrl.buildSerializedMetricQuery(queryConfig);

  return JSON.stringify({
    metricName: serialized.metricName,
    attributes: serialized.attributes || {},
    aggregationType: serialized.aggregationType || "",
    groupByAttributeKeys: serialized.groupByAttributeKeys || [],
    transformAsRate: Boolean(serialized.transformAsRate),
  });
};

const findQuery: (
  queries: MetricInvestigationQueries,
  variable: string,
) => MetricQueryConfigData | undefined = (
  queries: MetricInvestigationQueries,
  variable: string,
): MetricQueryConfigData | undefined => {
  return queries.queryConfigs.find(
    (queryConfig: MetricQueryConfigData): boolean => {
      return queryConfig.metricAliasData?.metricVariable === variable;
    },
  );
};

/*
 * What a query or formula charts: a query's metric, filters, aggregation and
 * grouping; a formula's expression and what each query it reads charts.
 * Null when there is none by that variable.
 */
const getSeriesKey: SeriesKeyFunction = (
  queries: MetricInvestigationQueries,
  variable: string,
): string | null => {
  const query: MetricQueryConfigData | undefined = findQuery(queries, variable);

  if (query) {
    return `query:${getQueryDataKey(query)}`;
  }

  const formula: MetricFormulaConfigData | undefined =
    queries.formulaConfigs.find(
      (formulaConfig: MetricFormulaConfigData): boolean => {
        return formulaConfig.metricAliasData?.metricVariable === variable;
      },
    );

  if (!formula) {
    return null;
  }

  const expression: string = formula.metricFormulaData?.metricFormula || "";

  const referenced: Array<string> =
    MetricFormulaEvaluator.getReferencedVariables(expression).map(
      (referencedVariable: string): string => {
        const referencedQuery: MetricQueryConfigData | undefined =
          queries.queryConfigs.find(
            (queryConfig: MetricQueryConfigData): boolean => {
              return (
                (
                  queryConfig.metricAliasData?.metricVariable || ""
                ).toLowerCase() === referencedVariable
              );
            },
          );

        return referencedQuery ? getQueryDataKey(referencedQuery) : "";
      },
    );

  return `formula:${JSON.stringify({ expression: expression.trim(), referenced })}`;
};

/*
 * The bucket a chart of this window draws each point at: the same interval
 * the metric view reads it at (AggregationIntervalUtil, which MetricView's
 * aligned window uses).
 */
export function getChartInterval(
  window: InBetween<Date> | null | undefined,
): AggregationInterval | null {
  const usableWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(window);

  if (!usableWindow) {
    return null;
  }

  return AggregationIntervalUtil.getAggregationIntervalForWindow({
    startDate: usableWindow.startValue,
    endDate: usableWindow.endValue,
  });
}

export function getDrawnThresholds(input: {
  thresholds: Array<MetricInvestigationThreshold> | undefined;
  // The metrics the investigation starts from: the ones the lines are on.
  defaultQueries: MetricInvestigationQueries;
  // The metrics on screen.
  queries: MetricInvestigationQueries;
  // The window on screen.
  window: InBetween<Date> | null | undefined;
}): DrawnThresholds {
  const drawn: Array<MetricChartThreshold> = [];
  const hiddenAtThisRange: Array<MetricInvestigationThreshold> = [];

  if (!input.thresholds || input.thresholds.length === 0) {
    return { drawn, hiddenAtThisRange };
  }

  const chartInterval: AggregationInterval | null = getChartInterval(
    input.window,
  );

  for (const threshold of input.thresholds) {
    const startKey: string | null = getSeriesKey(
      input.defaultQueries,
      threshold.metricVariable,
    );

    if (
      !startKey ||
      getSeriesKey(input.queries, threshold.metricVariable) !== startKey
    ) {
      continue;
    }

    if (
      threshold.onlyAtInterval &&
      threshold.onlyAtInterval !== chartInterval
    ) {
      hiddenAtThisRange.push(threshold);
      continue;
    }

    drawn.push(threshold);
  }

  return { drawn, hiddenAtThisRange };
}

/*
 * The range of the time picker whose points cover this interval, to offer
 * where a line is hidden: the longest one, for the most context. Null for
 * an interval no range of the picker draws at (five minutes: from three to
 * twelve hours).
 */
const RANGES_BY_INTERVAL: Partial<Record<AggregationInterval, TimeRange>> = {
  [AggregationInterval.Minute]: TimeRange.PAST_THREE_HOURS,
  [AggregationInterval.FifteenMinutes]: TimeRange.PAST_ONE_DAY,
  [AggregationInterval.ThirtyMinutes]: TimeRange.PAST_TWO_DAYS,
  [AggregationInterval.Hour]: TimeRange.PAST_ONE_WEEK,
  [AggregationInterval.Day]: TimeRange.PAST_ONE_MONTH,
  [AggregationInterval.Week]: TimeRange.PAST_THREE_MONTHS,
};

export function getRangeShowingInterval(
  interval: AggregationInterval | null | undefined,
): TimeRange | null {
  return (interval && RANGES_BY_INTERVAL[interval]) || null;
}

/*
 * The range to offer for the lines hidden at this range: the one showing
 * the first of them. Null when there is none to offer.
 */
export function getRangeShowingHiddenThresholds(
  hidden: Array<MetricInvestigationThreshold>,
): TimeRange | null {
  for (const threshold of hidden) {
    const range: TimeRange | null = getRangeShowingInterval(
      threshold.onlyAtInterval,
    );

    if (range) {
      return range;
    }
  }

  return null;
}
