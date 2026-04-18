/*
 * Span aggregation options for Trace Recording Rules.
 * Duration-based aggregations return seconds (durationUnixNano / 1e9) so rule
 * expressions stay in human-friendly units.
 */
enum TraceAggregationType {
  Count = "Count",
  ErrorCount = "ErrorCount",
  AvgDurationSeconds = "AvgDurationSeconds",
  P50DurationSeconds = "P50DurationSeconds",
  P95DurationSeconds = "P95DurationSeconds",
  P99DurationSeconds = "P99DurationSeconds",
  MaxDurationSeconds = "MaxDurationSeconds",
  MinDurationSeconds = "MinDurationSeconds",
}

export default TraceAggregationType;
