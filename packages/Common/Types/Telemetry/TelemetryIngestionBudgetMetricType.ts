/*
 * Metric names the ingestion budget sweep posts every five minutes
 * (Common/Server/Utils/Telemetry/TelemetryIngestionBudgetMetrics.ts), so a
 * project's telemetry budgets can be charted and alerted on like any other
 * metric: an ordinary Metrics monitor on `...used.percent` pages someone at
 * 80% instead of the budget only turning a meter red on the Usage page.
 *
 * The values are stored verbatim as metric names in ClickHouse. Renaming one
 * orphans every point already written under the old name and silences every
 * monitor watching it, so treat them as a public, append-only contract.
 *
 * They sit under `oneuptime.telemetry.budget.`, apart from the
 * `oneuptime.telemetry.usage.` names #6355 proposes for usage itself: a
 * budget's readings exist only while a budget is set, usage for everything.
 *
 * Every row carries `projectId`, `signal` (logs, traces, metrics, profiles or
 * security-events) and `scope` (project or ingestion-key) attributes, and an
 * ingestion key's rows `ingestionKeyId` and `ingestionKeyName` too. The rows
 * are keyed to the project (primaryEntityId = its id): a budget belongs to
 * the project, or to one of its keys, never to a service.
 */
enum TelemetryIngestionBudgetMetricType {
  /*
   * Bytes counted against the budget since the budget day started,
   * decompressed, as they arrived. Unit "By".
   */
  UsedBytes = "oneuptime.telemetry.budget.used.bytes",

  /*
   * The above as a percent of the daily budget, rounded down to 0.01 so
   * ">= 100" means exactly what the ingest gate means by "used up". Not
   * capped: the request that crosses the line is stored. Posted only while a
   * daily budget is set. Unit "%".
   */
  UsedPercent = "oneuptime.telemetry.budget.used.percent",

  /*
   * Bytes refused (or dropped) since the budget day started because the daily
   * budget was used up. Posted only while it is above zero. Unit "By".
   */
  DroppedBytes = "oneuptime.telemetry.budget.dropped.bytes",

  /*
   * Requests refused since the budget day started because they came faster
   * than the per-second rate allows; their senders retry them. Posted only
   * while it is above zero. Unit "{request}".
   */
  ThrottledRequests = "oneuptime.telemetry.budget.throttled.requests",
}

export default TelemetryIngestionBudgetMetricType;
