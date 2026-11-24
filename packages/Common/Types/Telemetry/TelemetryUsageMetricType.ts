/*
 * Metric names the telemetry usage sweep posts every five minutes for a
 * project that publishes its usage as metrics (issue #6355,
 * Project.publishTelemetryUsageMetrics), so usage can be charted next to
 * every other metric, and a Metrics monitor can alert when a service's
 * usage rises - within minutes, not the next day, when the daily usage rows
 * are counted.
 *
 * The values are stored verbatim as metric names in ClickHouse. Renaming one
 * orphans every point already written under the old name and silences every
 * monitor watching it, so treat them as a public, append-only contract.
 *
 * They sit under `oneuptime.telemetry.usage.`, beside the ingestion budget
 * readings under `oneuptime.telemetry.budget.`: a budget's readings exist
 * only while a budget is set; usage for every project that asks for it.
 *
 * Each point is one resource's - a service, a host, a cluster, or the
 * project's unattributed telemetry - keyed to it (primaryEntityId), so it is
 * read by whoever may read that resource's own telemetry, and charted on its
 * page. It carries `projectId`, `signal` (logs, traces, metrics or
 * profiles), `resourceType`, `resourceId` and `resourceName` attributes,
 * and a service's the `oneuptime.service.id` and `oneuptime.service.name`
 * its other telemetry carries.
 */
enum TelemetryUsageMetricType {
  /*
   * The bytes the resource sent of the signal in the five minutes the point
   * starts at, decompressed, counted as they arrived: its share of each
   * batch's bytes, as ingestion budgets count them. Unit "By".
   */
  UsageBytes = "oneuptime.telemetry.usage.bytes",
}

export default TelemetryUsageMetricType;
