/*
 * What each number on a database's Overview means, in plain words. Shown in
 * the (i) tooltip beside a tile or chart title, the way every other
 * product's Overview explains its figures (Components/MetricDescriptions).
 *
 * Each text describes what the page actually computes
 * (Pages/Database/Utils/DatabaseServerTelemetryQueries), not what the title
 * might suggest:
 *
 *   - Queries, errors and latency are the CLIENT spans applications record
 *     for calls to one of the database's endpoints, in the selected range.
 *   - The p95 tile is one percentile over every query in the range; the
 *     chart is the p95 of each interval.
 *   - Calling services counts every service in the range; the table below
 *     it lists only the busiest ten.
 *   - The runtime charts average the pods' / containers' own metrics.
 *   - Engine metric tiles carry their catalog description instead
 *     (Types/DatabaseServer/DatabaseServerMetricCatalog).
 *
 * Change the fetch, change the words.
 */

export type DatabaseMetric =
  | "queries"
  | "errorRate"
  | "p95Latency"
  | "callingServices"
  | "queriesChart"
  | "p95Chart"
  | "runtimeCpu"
  | "runtimeMemory";

export const DATABASE_METRIC_DESCRIPTIONS: Record<DatabaseMetric, string> = {
  queries:
    "Queries and commands your instrumented applications sent to this database in the selected range, counted from their client spans. Only calls to one of the database's endpoints count; traffic from applications that are not instrumented does not appear here.",
  errorRate:
    "Share of those queries whose client span ended with an error status, in the selected range. A failure the database driver did not report as an error is not counted.",
  p95Latency:
    "95% of the queries applications sent in the selected range finished faster than this. It is one percentile over every query in the range, measured by the applications themselves, so it includes network time and waiting for a free connection, not only the time the database spent.",
  callingServices:
    "How many different services sent at least one query to this database in the selected range. The Calling services table below lists the busiest ten.",
  queriesChart:
    "Queries applications sent to this database in each interval of the selected range, with the ones that failed.",
  p95Chart:
    "The p95 query duration of each interval: 95% of the queries sent in that interval finished faster than the line. A spike in one interval can come from a handful of slow queries.",
  runtimeCpu:
    "CPU used by the pods or containers this database runs as, averaged across them for each interval, as their own Kubernetes, Docker or Podman agent reports it.",
  runtimeMemory:
    "Memory used by the pods or containers this database runs as, averaged across them for each interval, as their own Kubernetes, Docker or Podman agent reports it.",
};
