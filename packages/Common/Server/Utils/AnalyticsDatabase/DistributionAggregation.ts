import AggregationType from "../../../Types/BaseDatabase/AggregationType";

/*
 * Metric point types whose rows carry a pre-aggregated distribution
 * (count/sum/min/max + buckets) instead of a single observation. For
 * these rows the `value` column holds the datapoint's SUM of all
 * observations in the export interval (see OtelMetricsIngestService's
 * buildMetricRow: value = asInt ?? asDouble ?? sum), so aggregating
 * `value` directly produces sum-scale numbers — e.g. "Avg of
 * http.client.request.duration" would return ~110s for a service whose
 * true mean latency is 0.586s at ~188 requests per export interval.
 */
const DISTRIBUTION_POINT_TYPES: ReadonlyArray<string> = [
  "Histogram",
  "ExponentialHistogram",
  "Summary",
];

export function isDistributionPointType(pointType: unknown): boolean {
  return (
    typeof pointType === "string" &&
    DISTRIBUTION_POINT_TYPES.includes(pointType)
  );
}

/**
 * Distribution-aware per-bucket expression for scalar aggregations
 * over `value`. Distribution rows (histogram/summary — identified by
 * a non-null `count`) carry the datapoint's observation total in
 * `sum` (mirrored into `value` at ingest) and the observation count
 * in `count`, so:
 *
 *   Avg   -> sum(sum) / sum(count)   (count-weighted mean of
 *            observations, not the mean of per-export-interval sums)
 *   Sum   -> sum(sum)                (total of all observations)
 *   Count -> sum(count)              (number of observations, not
 *            the number of export intervals)
 *   Min   -> min(min), falling back to the datapoint mean when the
 *            optional OTLP min is absent
 *   Max   -> max(max), same fallback
 *
 * Scalar rows (Sum/Gauge points — `count` is null) degrade to the
 * plain value semantics these aggregations always had: each row is
 * one observation of `value` with weight 1.
 */
export function getDistributionAwareAggregationExpression(
  aggregationType: AggregationType,
  column: string,
): string {
  const distRowCondition: string = `isNotNull(count) AND isNotNull(coalesce(sum, ${column}))`;
  const observationTotalExpression: string = `sum(multiIf(${distRowCondition}, toFloat64(coalesce(sum, ${column})), isNotNull(${column}), toFloat64(${column}), 0))`;
  const observationCountExpression: string = `sum(multiIf(${distRowCondition}, toFloat64(count), isNotNull(${column}), 1, 0))`;
  const datapointMeanExpression: string = `toFloat64(coalesce(sum, ${column})) / toFloat64(count)`;

  switch (aggregationType) {
    case AggregationType.Sum:
      return observationTotalExpression;
    case AggregationType.Count:
      return observationCountExpression;
    case AggregationType.Avg:
      return `if(${observationCountExpression} = 0, 0, ${observationTotalExpression} / ${observationCountExpression})`;
    case AggregationType.Min:
      return `min(multiIf(isNotNull(min), toFloat64(min), ${distRowCondition} AND count > 0, ${datapointMeanExpression}, isNotNull(${column}), toFloat64(${column}), NULL))`;
    case AggregationType.Max:
      return `max(multiIf(isNotNull(max), toFloat64(max), ${distRowCondition} AND count > 0, ${datapointMeanExpression}, isNotNull(${column}), toFloat64(${column}), NULL))`;
    default:
      return `${aggregationType.toLocaleLowerCase()}(${column})`;
  }
}
