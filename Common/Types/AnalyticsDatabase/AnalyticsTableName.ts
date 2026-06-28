enum AnalyticsTableName {
  Log = "LogItemV3",
  Metric = "MetricItemV3",
  ExceptionInstance = "ExceptionItemV3",
  Span = "SpanItemV3",
  MonitorLog = "MonitorLogV3",
  Profile = "ProfileItemV3",
  ProfileSample = "ProfileSampleItemV3",
  AuditLog = "AuditLogV2",
  /*
   * Materialized-view target tables. These hold AggregateFunction
   * states populated by attached MVs on the source `Metric` table.
   * The `_mv` triggers themselves live in DataMigrations and are not
   * named here (they aren't queried directly).
   */
  MetricItemAggMV1m = "MetricItemAggMV1m",
  /*
   * Successor of MetricItemAggMV1mByHost (dropped by the
   * RekeyMetricHostRollupToEntityKey migration), keyed by the stable
   * hostEntityKey instead of the raw host.name spelling.
   */
  MetricItemAggMV1mByHostV2 = "MetricItemAggMV1mByHostV2",
  MetricBaselineHourly = "MetricBaselineHourly",
  MutableMetric = "MutableMetricItem",
}

export default AnalyticsTableName;
