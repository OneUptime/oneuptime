import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import {
  fillValueWidgetSeriesGaps,
  getValueWidgetSeries,
  ValueWidgetPoint,
  ValueWidgetReduce,
} from "Common/Utils/Dashboard/ValueWidgetSeries";

/*
 * Pure, React-free data helpers for the value widget. Kept out of the .tsx so
 * the reduction that produces the single displayed number — and, just as
 * importantly, its "there was nothing to reduce" answer — can be unit-tested
 * in the node test environment.
 */

/*
 * Flatten every result's buckets into one list, in result then bucket order -
 * which is NOT time order: the metrics API answers newest first. Read the
 * points through getMetricValueWidgetSeries wherever their order matters.
 */
export function collectDataPoints(
  results: Array<AggregatedResult>,
): Array<AggregatedModel> {
  const dataPoints: Array<AggregatedModel> = [];
  for (const result of results) {
    for (const item of result.data) {
      dataPoints.push(item);
    }
  }
  return dataPoints;
}

/*
 * Keep only the finite per-bucket values. AggregatedModel.value is typed
 * `number` but the model carries a JSONValue index signature, and a ClickHouse
 * NULL / missing column arrives as null — left unchecked it poisons the
 * reduction with NaN.
 */
export function getNumericValues(
  dataPoints: Array<AggregatedModel>,
): Array<number> {
  const numericValues: Array<number> = [];
  for (const item of dataPoints) {
    const value: number = item.value as number;
    if (typeof value === "number" && Number.isFinite(value)) {
      numericValues.push(value);
    }
  }
  return numericValues;
}

/*
 * Reduce the per-bucket values into the single displayed number, or null when
 * there is nothing to reduce.
 *
 * The null is the point: seeding an accumulator at 0 and rendering it made an
 * empty metric indistinguishable from a genuine measurement of zero, which on
 * the RUM template read as a flawless site ("AVG LCP 0", "AVG CLS 0"). Callers
 * must render a no-data state rather than substituting a number.
 *
 * - Percentiles (P50/P75/P90/P95/P99) are computed per bucket server-side, so —
 *   like Avg — we take the mean across the window.
 * - Count sums the per-bucket counts the server already returned
 *   (`count(value) as value`) rather than counting time buckets.
 * - Min/Max fold over the real values, so an all-positive metric's Min is not
 *   forced to exactly 0.
 */
export function aggregateValues(
  values: Array<number>,
  aggregationType: AggregationType,
): number | null {
  if (values.length === 0) {
    return null;
  }

  switch (aggregationType) {
    case AggregationType.Sum:
    case AggregationType.Count:
      return values.reduce((sum: number, value: number) => {
        return sum + value;
      }, 0);
    case AggregationType.Min:
      return Math.min(...values);
    case AggregationType.Max:
      return Math.max(...values);
    default:
      // Avg and every percentile aggregation: mean of per-bucket values.
      return (
        values.reduce((sum: number, value: number) => {
          return sum + value;
        }, 0) / values.length
      );
  }
}

/*
 * The widget's own reduction as a function of a list of values: what each
 * half of the time range is reduced with for the trend, and how the points a
 * grouped query returns for one bucket are combined into the one point the
 * sparkline draws there.
 */
export function getMetricValueWidgetReduce(
  aggregationType: AggregationType,
): ValueWidgetReduce {
  return (values: Array<number>): number | null => {
    return aggregateValues(values, aggregationType);
  };
}

/*
 * A sum or a count adds its buckets up, so the two halves of the time range
 * are compared as totals over equal lengths of time. Every other aggregation
 * reads as a level, and a bucket counts once, in one half.
 */
export function isAdditiveAggregation(
  aggregationType: AggregationType,
): boolean {
  return (
    aggregationType === AggregationType.Sum ||
    aggregationType === AggregationType.Count
  );
}

/*
 * The sparkline's points: oldest first whatever order the API answered in
 * (newest first, for the metrics API), one point per bucket, and only the
 * buckets with a number in them.
 */
export function getMetricValueWidgetSeries(
  results: Array<AggregatedResult>,
  aggregationType: AggregationType,
): Array<ValueWidgetPoint> {
  return getValueWidgetSeries(
    collectDataPoints(results),
    getMetricValueWidgetReduce(aggregationType),
  );
}

/*
 * The interval the metrics API buckets a window at: the same rule the
 * server compiles its toStartOfInterval with (AggregationIntervalUtil).
 */
export function getMetricValueWidgetBucketWidthMs(window: {
  startDate: Date;
  endDate: Date;
}): number {
  return AggregationIntervalUtil.getAggregationIntervalMs(
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: window.startDate,
      endDate: window.endDate,
    }),
  );
}

/*
 * What the sparkline draws: the series, and for a sum or a count every
 * empty bucket between its first reading and its last drawn at 0
 * (fillValueWidgetSeriesGaps). A sparse count drew only the buckets it had,
 * so its line read flat while its arrow said it rose. An average, a
 * percentile, a min or a max of no readings is not 0, and keeps its gaps.
 */
export function getMetricValueWidgetSparkline(data: {
  results: Array<AggregatedResult>;
  aggregationType: AggregationType;
  window: { startDate: Date; endDate: Date } | null;
}): Array<ValueWidgetPoint> {
  const series: Array<ValueWidgetPoint> = getMetricValueWidgetSeries(
    data.results,
    data.aggregationType,
  );

  if (!data.window || !isAdditiveAggregation(data.aggregationType)) {
    return series;
  }

  return fillValueWidgetSeriesGaps({
    series: series,
    bucketWidthMs: getMetricValueWidgetBucketWidthMs(data.window),
  });
}

/*
 * The first reason any result carries for being empty — set by client-side
 * formula evaluation, never by the server — so the widget can explain itself
 * instead of showing a bare "no data".
 */
export function getResultsErrorMessage(
  results: Array<AggregatedResult>,
): string | undefined {
  return results.find((result: AggregatedResult) => {
    return Boolean(result.errorMessage);
  })?.errorMessage;
}
