enum AnalyticsTableName {
  Log = "LogItemV3",
  /*
   * SIEM signals normalized to OCSF at ingest (Google SecOps UDM, native
   * OCSF, generic security JSON). Peer of LogItemV3 in layout: same sort
   * key shape, per-row retentionDate TTL, and Map(String,String)
   * attributes with a keys sidecar for arbitrary-field filtering.
   */
  SecurityEvent = "SecurityEventItemV1",
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
  /*
   * Hour-of-week volume baselines for Traces and Logs monitors —
   * span/log counts per (project, service, status/severity, day,
   * hour-of-week, minute-of-hour) cell, populated by MVs on
   * SpanItemV3/LogItemV3 inserts. Peers of MetricBaselineHourly for the
   * AnomalouslyHigh/Low criteria on CheckOn.SpanCount / CheckOn.LogCount.
   */
  SpanCountBaseline = "SpanCountBaseline",
  LogCountBaseline = "LogCountBaseline",
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
  /*
   * Session replay. Two tables, deliberately split:
   *
   *  - RumSessionV1 is the narrow per-session header: identity, device,
   *    frustration counters, correlation keys. Every list, filter and
   *    metering query reads only this table, so it stays cheap.
   *  - RumSessionChunkV1 holds the opaque recorded payload, one row per
   *    ~15s frame. It is the fattest table in the system and is only ever
   *    read by (projectId, sessionId, tabId, chunkIndex).
   *
   * Both are ReplacingMergeTree so an at-least-once redelivery collapses
   * at merge instead of double-inserting; both therefore require a column
   * literally named `version` (see ClusterConfig.getStorageEngine).
   */
  RumSession = "RumSessionV1",
  RumSessionChunk = "RumSessionChunkV1",
}

export default AnalyticsTableName;
