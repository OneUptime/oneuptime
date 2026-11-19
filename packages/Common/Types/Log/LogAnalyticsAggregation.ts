import AggregationType from "../BaseDatabase/AggregationType";

/*
 * WHAT LOGS → ANALYTICS MEASURES (#7716).
 *
 * A chart of the log explorer's Analytics counts its logs, or the unique
 * values of one field, or reads one numeric attribute the logs carry - the
 * duration_ms of a request, the bytes of a response - and charts its sum,
 * average, minimum, maximum or a percentile, over time, as a top list or as
 * a table. The names are the ones `POST /api/telemetry/logs/analytics`
 * takes as `aggregation`, and the Analytics view offers, in this order.
 *
 * Each aggregation of a number is one of AggregationType's, so a log
 * recording rule made from a chart computes it the same way (see
 * Server/Utils/Telemetry/LogNumericAttributeSql): the attribute read as a
 * number, a log whose value is no finite number left out, a percentile
 * read with ClickHouse's quantile.
 */
export type LogAnalyticsAggregation =
  | "count"
  | "unique"
  | "sum"
  | "avg"
  | "p50"
  | "p90"
  | "p95"
  | "p99"
  | "min"
  | "max";

// Each aggregation of a numeric attribute, by the aggregate it computes.
export const LOG_ANALYTICS_NUMERIC_AGGREGATIONS: Readonly<
  Record<Exclude<LogAnalyticsAggregation, "count" | "unique">, AggregationType>
> = {
  sum: AggregationType.Sum,
  avg: AggregationType.Avg,
  p50: AggregationType.P50,
  p90: AggregationType.P90,
  p95: AggregationType.P95,
  p99: AggregationType.P99,
  min: AggregationType.Min,
  max: AggregationType.Max,
};

export const LOG_ANALYTICS_AGGREGATIONS: ReadonlyArray<LogAnalyticsAggregation> =
  [
    "count",
    "unique",
    ...(Object.keys(
      LOG_ANALYTICS_NUMERIC_AGGREGATIONS,
    ) as Array<LogAnalyticsAggregation>),
  ];

export function isLogAnalyticsAggregation(
  value: unknown,
): value is LogAnalyticsAggregation {
  return (
    typeof value === "string" &&
    LOG_ANALYTICS_AGGREGATIONS.includes(value as LogAnalyticsAggregation)
  );
}

/*
 * The aggregate an aggregation of a numeric attribute computes, or null for
 * a count and a unique count, which read no number.
 */
export function getLogAnalyticsNumericAggregationType(
  aggregation: unknown,
): AggregationType | null {
  if (
    typeof aggregation !== "string" ||
    !Object.prototype.hasOwnProperty.call(
      LOG_ANALYTICS_NUMERIC_AGGREGATIONS,
      aggregation,
    )
  ) {
    return null;
  }

  return LOG_ANALYTICS_NUMERIC_AGGREGATIONS[
    aggregation as keyof typeof LOG_ANALYTICS_NUMERIC_AGGREGATIONS
  ];
}

// Whether the aggregation reads a numeric attribute.
export function isNumericLogAnalyticsAggregation(
  aggregation: unknown,
): boolean {
  return getLogAnalyticsNumericAggregationType(aggregation) !== null;
}

/*
 * Whether the aggregation needs a field to read: a unique count counts the
 * values of one, and every aggregation of a number reads one.
 */
export function needsLogAnalyticsAggregationField(
  aggregation: unknown,
): boolean {
  return (
    aggregation === "unique" || isNumericLogAnalyticsAggregation(aggregation)
  );
}

/*
 * Whether the groups' values add up to the whole's: a count and a sum do,
 * so a chart may stack them and total them. An average, a percentile, a
 * minimum or a maximum of several groups is no sum of theirs - the p95 of
 * three services stacked would read as a latency nobody had.
 */
export function isAdditiveLogAnalyticsAggregation(
  aggregation: unknown,
): boolean {
  return aggregation === "count" || aggregation === "sum";
}
