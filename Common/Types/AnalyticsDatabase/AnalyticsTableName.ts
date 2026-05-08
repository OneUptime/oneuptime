enum AnalyticsTableName {
  Log = "LogItemV2",
  Metric = "MetricItemV2",
  ExceptionInstance = "ExceptionItemV2",
  Span = "SpanItemV2",
  MonitorLog = "MonitorLogV2",
  Profile = "ProfileItemV2",
  ProfileSample = "ProfileSampleItemV2",
  AuditLog = "AuditLogV1",
  /*
   * Materialized-view target tables. These hold AggregateFunction
   * states populated by attached MVs on the source `Metric` table.
   * The `_mv` triggers themselves live in DataMigrations and are not
   * named here (they aren't queried directly).
   */
  MetricItemAggMV1m = "MetricItemAggMV1m",
  MetricItemAggMV1mByHost = "MetricItemAggMV1mByHost",
  MetricBaselineHourly = "MetricBaselineHourly",
}

export default AnalyticsTableName;
