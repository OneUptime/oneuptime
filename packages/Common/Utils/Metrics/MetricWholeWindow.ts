import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../Types/BaseDatabase/AggregationType";

/*
 * A METRIC MONITOR THAT READS ITS WHOLE WINDOW AS ONE VALUE
 * (MonitorStepMetricMonitor.aggregatesWholeWindow).
 *
 * Its queries are read with AggregationInterval.Total: one row per series
 * for the whole window, holding the window's sum, average, highest or
 * lowest. Two things are then done to each query's answer, so its formulas
 * compute the window's own value:
 *
 *   - Every row is stamped with the window's end. The analytics store stamps
 *     the row with the earliest point it folded, which differs from one
 *     query to the next - the first failed request is not the first request
 *     - and a formula joins its variables by time, so a share of two counts
 *     would otherwise find nothing to join.
 *   - An ungrouped count that read no point at all is a total of zero: one
 *     row of 0 at the window's end. A cloud writes no point for a period with
 *     no failure (CloudWatch's 5xx counts, Azure Monitor's totals), so
 *     without it a load balancer whose targets failed while it did not would
 *     have no total of its own failures, and the formula adding the two up
 *     would join nothing. A level (an average, a highest) that read nothing
 *     is no reading, and stays empty.
 *
 * Shared by the worker that reads the monitor (MonitorTelemetryMonitor) and
 * the tests that evaluate a template the way it does. React-free and
 * server-safe.
 */
export default class MetricWholeWindow {
  // The folds whose total over a window with no point is zero.
  public static isCountAggregation(aggregationType: AggregationType): boolean {
    return (
      aggregationType === AggregationType.Sum ||
      aggregationType === AggregationType.Count
    );
  }

  public static toWholeWindowResult(data: {
    result: AggregatedResult;
    windowEnd: Date;
    aggregationType: AggregationType;
    // A grouped query names its own series: none can be made up for it.
    isGrouped: boolean;
  }): AggregatedResult {
    if (
      data.result.data.length === 0 &&
      !data.isGrouped &&
      MetricWholeWindow.isCountAggregation(data.aggregationType)
    ) {
      return {
        ...data.result,
        data: [{ timestamp: data.windowEnd, value: 0 }],
      };
    }

    return {
      ...data.result,
      data: data.result.data.map((row: AggregatedModel): AggregatedModel => {
        return { ...row, timestamp: data.windowEnd };
      }),
    };
  }
}
