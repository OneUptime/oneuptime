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
  /*
   * Per-(attributeKey, attributeValue, minute) rollup for shape-collapsed
   * monitor evaluation of single-attribute-filtered metrics (Phase 3). Created
   * ONLY when TELEMETRY_MONITOR_ATTRIBUTE_KEY_MV_ENABLED is set, because its MV
   * fans each ingested metric row out across its attributes — see the model.
   */
  MetricItemAggMV1mByAttributeKeys = "MetricItemAggMV1mByAttributeKeys",
  MetricBaselineHourly = "MetricBaselineHourly",
}

export default AnalyticsTableName;
