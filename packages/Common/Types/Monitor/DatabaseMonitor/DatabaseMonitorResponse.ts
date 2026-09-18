import ProbeAttempt from "../../Probe/ProbeAttempt";
import { DatabaseMetricGroup } from "../DatabaseMetricCatalog";
import MonitorMetricType from "../MonitorMetricType";

/*
 * Why a metric group produced nothing. Kept as a closed set so the dashboard
 * can render an actionable message (and, for MissingPermission, the exact
 * GRANT to run) instead of echoing a driver error at the operator.
 */
export enum DatabaseMetricGroupUnavailableReason {
  // The monitoring login lacks the grant this group's views need.
  MissingPermission = "MissingPermission",
  /*
   * The engine does not expose this data at all: an older major version, a
   * disabled extension, or a feature the engine simply does not have (there
   * is no deadlock counter in stock MySQL, for instance).
   */
  NotSupportedByEngine = "NotSupportedByEngine",
  // The group's query exceeded the statement timeout.
  Timeout = "Timeout",
  // Anything else. `message` carries the sanitized detail.
  Error = "Error",
}

export interface DatabaseMetricGroupStatus {
  group: DatabaseMetricGroup;
  reason: DatabaseMetricGroupUnavailableReason;
  /*
   * Sanitized, operator-facing explanation. Never contains a DSN, a
   * password, or a raw driver error - SqlMonitor.sanitizeError is applied
   * before anything lands here.
   */
  message: string;
  /*
   * The grant that would fix it, when we know it (e.g.
   * "GRANT pg_read_all_stats TO monitoring_user"). Rendered verbatim in the
   * monitor's summary view so the fix is copy-pasteable.
   */
  remediation?: string | undefined;
}

/*
 * What a probe reports back for one Database Health check.
 *
 * The central contract here is that COLLECTION IS PARTIAL BY DESIGN.
 * `isOnline` answers exactly one question - could we connect and run the
 * baseline probe query - and nothing else in this payload can change it. A
 * login without VIEW SERVER STATE, a replica group that times out, or an
 * engine that has no deadlock counter all produce entries in
 * `unavailableGroups` while the monitor stays online, because the database
 * being monitored is fine; it is our visibility into it that is reduced.
 *
 * No rows of customer data ever appear here. Values are numeric aggregates
 * read from engine catalog views, keyed by the metric series they feed.
 */
export default interface DatabaseMonitorResponse {
  isOnline: boolean;
  // Time to connect and run the baseline probe query.
  responseTimeInMs: number;
  failureCause: string;
  /*
   * Collected values, keyed by the series each one writes. A metric absent
   * from this map is simply not written - the engine did not report it,
   * or its group was skipped. Never zero-fill: a missing replication lag
   * and a replication lag of zero mean opposite things.
   */
  metrics: Partial<Record<MonitorMetricType, number>>;
  // Groups that ran and produced values.
  collectedGroups: Array<DatabaseMetricGroup>;
  // Groups that could not be collected, with the reason and the fix.
  unavailableGroups: Array<DatabaseMetricGroupStatus>;
  /*
   * Engine version string as the server reports it, for the summary view.
   * Also what the collector version-gates on (PostgreSQL moved the
   * checkpoint counters out of pg_stat_bgwriter in 17, for example).
   */
  engineVersion?: string | undefined;
  // Sanitized connection error, present only when isOnline is false.
  connectionError: string | null;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
