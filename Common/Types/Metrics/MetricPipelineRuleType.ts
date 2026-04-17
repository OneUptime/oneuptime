// Rule types for the metric ingest pipeline. Evaluated per data-point in
// OtelMetricsIngestService after buildMetricRow() and before the ClickHouse
// insert buffer.
//
// - Filter:           keep only rows matching the match expression; drop others.
// - Drop:             drop rows matching the match expression; keep others.
// - RenameMetric:     rename the metric (row.name) from one string to another.
// - RenameAttribute:  rename an attribute key (renameFromKey -> renameToKey).
// - AddAttribute:     add an attribute (addAttributeKey = addAttributeValue).
// - RemoveAttribute:  remove an attribute by key.
// - RedactAttribute:  replace an attribute's value with redactReplacement.
// - Sample:           keep `samplePercentage`% of matching rows; drop the rest.

enum MetricPipelineRuleType {
  Filter = "Filter",
  Drop = "Drop",
  RenameMetric = "RenameMetric",
  RenameAttribute = "RenameAttribute",
  AddAttribute = "AddAttribute",
  RemoveAttribute = "RemoveAttribute",
  RedactAttribute = "RedactAttribute",
  Sample = "Sample",
}

export default MetricPipelineRuleType;
