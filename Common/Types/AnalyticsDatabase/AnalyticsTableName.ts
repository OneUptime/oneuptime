enum AnalyticsTableName {
  Log = "LogItemV3",
  Metric = "MetricItemV3",
  ExceptionInstance = "ExceptionItemV3",
  Span = "SpanItemV3",
  MonitorLog = "MonitorLogV3",
  NetworkFlow = "NetworkFlowV1",
  Profile = "ProfileItemV3",
  ProfileSample = "ProfileSampleItemV3",
  AuditLog = "AuditLogV2",
  KubernetesCostAllocation = "KubernetesCostAllocationV1",
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
   * Entity-keyed siblings of MetricItemAggMV1mByHostV2 — same layout,
   * keyed by the other ingest-stamped scalar entity-key columns
   * (serviceEntityKey / k8sClusterEntityKey / containerEntityKey) so
   * entity-scoped chart queries can be served from a pre-aggregated
   * rollup instead of scanning MetricItemV3.
   */
  MetricItemAggMV1mByService = "MetricItemAggMV1mByService",
  MetricItemAggMV1mByK8sCluster = "MetricItemAggMV1mByK8sCluster",
  MetricItemAggMV1mByContainer = "MetricItemAggMV1mByContainer",
  MetricBaselineHourly = "MetricBaselineHourly",
  MutableMetric = "MutableMetricItem",
  /*
   * SLO / Error Budget history rollup. ReplacingMergeTree keyed by
   * (projectId, sloId, metricName, bucketStart) with a `version` column
   * so at-least-once evaluator writes and trailing re-writes dedupe to
   * the latest value. Deliberately NOT MetricItemV3: its own monthly
   * partitions + 400-day TTL keep long-lived SLO rows from pinning the
   * daily raw-telemetry partitions (ttl_only_drop_parts hazard).
   */
  SloHistory = "SloHistory",
}

export default AnalyticsTableName;
