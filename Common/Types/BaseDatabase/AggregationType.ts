enum AggregationType {
  Max = "Max",
  Min = "Min",
  Sum = "Sum",
  Avg = "Avg",
  Count = "Count",
  /*
   * Percentile aggregations. For Metric (the only model that carries
   * histogram bucket data), MetricService overrides the aggregate path to
   * fan out histogram buckets into weighted samples and use
   * quantileExactWeighted, so a P95 of an `http.server.request.duration`
   * histogram returns the bucket-derived 95th percentile rather than the
   * 95th percentile of the per-row `sum`. For other models (Span, Log,
   * etc.) the StatementGenerator falls back to ClickHouse's `quantile(p)`
   * over the raw column, which is the right thing for scalar columns.
   */
  P50 = "P50",
  P90 = "P90",
  P95 = "P95",
  P99 = "P99",
}

export default AggregationType;

export const PercentileAggregationLevels: Record<string, number> = {
  [AggregationType.P50]: 0.5,
  [AggregationType.P90]: 0.9,
  [AggregationType.P95]: 0.95,
  [AggregationType.P99]: 0.99,
};

export function isPercentileAggregation(type: AggregationType): boolean {
  return Object.prototype.hasOwnProperty.call(
    PercentileAggregationLevels,
    type,
  );
}

export function getPercentileLevel(type: AggregationType): number | null {
  if (!isPercentileAggregation(type)) {
    return null;
  }
  return PercentileAggregationLevels[type] ?? null;
}
