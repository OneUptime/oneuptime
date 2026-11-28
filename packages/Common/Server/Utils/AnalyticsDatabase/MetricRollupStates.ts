/*
 * WHAT A ONE-MINUTE METRIC ROLLUP HOLDS OF EACH MINUTE (issue #11373).
 *
 * Each metric rollup's view (MetricItemAggMV1m and the per-host, per-cluster,
 * per-container and per-service ones) rolls the raw rows of a minute up into
 * these four aggregate-function states, read back with sumMerge, countMerge,
 * minMerge and maxMerge (DistributionAggregation.getRollupAggregationExpression).
 *
 * A check's window that the rollup cannot serve whole is served by its
 * whole minutes and the raw rows of its two partial ones
 * (MinuteRollupRange.split): those rows are rolled up here exactly as the
 * views roll them, so the read merges the two as one rollup. A view that
 * rolled them up otherwise would read differently in a window's edges than
 * in its middle; MetricRollupStatesMatchViews holds every view to these.
 */

// A rollup's state columns, in the order a split read selects them.
export const METRIC_ROLLUP_STATE_COLUMNS: ReadonlyArray<string> = [
  "valueSumState",
  "valueCountState",
  "valueMinState",
  "valueMaxState",
];

// The value each view rolls up: a point's value, or a distribution's sum.
export const METRIC_ROLLUP_VALUE: string = "toFloat64(coalesce(value, sum, 0))";

// Each state, as each view writes it from the raw rows of a minute.
export const METRIC_ROLLUP_STATES_FROM_RAW_ROWS: ReadonlyArray<string> = [
  `sumState(${METRIC_ROLLUP_VALUE}) AS valueSumState`,
  `countState(${METRIC_ROLLUP_VALUE}) AS valueCountState`,
  `minState(${METRIC_ROLLUP_VALUE}) AS valueMinState`,
  `maxState(${METRIC_ROLLUP_VALUE}) AS valueMaxState`,
];

// A raw row's minute, as each view writes a bucket's: the minute it starts.
export const METRIC_ROLLUP_BUCKET_FROM_RAW_ROWS: string =
  "toDateTime(toStartOfMinute(time)) AS bucketTime";
