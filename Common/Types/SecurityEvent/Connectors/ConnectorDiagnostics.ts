import { JSONObject } from "../../JSON";

/*
 * The shape every "Test connection" produces, whichever source is behind
 * it — Google SecOps and every provider in the Security Event Connections
 * framework return the same report, so one dashboard component renders
 * all of them.
 *
 * A report is a checklist, not a boolean. The customer complaint this was
 * built for ("connected, but nothing is ingested") is never answered by
 * "credentials accepted": it needs, in order, whether the source can be
 * reached, whether it allows reading detections, whether there is
 * anything to import right now, and whether OneUptime's own scheduler and
 * workers are actually running. Each of those is a check with its own
 * remediation text, so a failed step tells the reader what to do next
 * instead of leaving them with a status word.
 */

export type SecurityConnectorCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface SecurityConnectorCheck {
  /*
   * Stable machine key (kebab-case), e.g. "authentication",
   * "worker-consumers". UI groups and tests key off it; the human name may
   * be reworded freely.
   */
  key: string;
  name: string;
  status: SecurityConnectorCheckStatus;
  durationMs: number;
  // What was observed, in one or two sentences. Credentials are never here.
  message: string;
  // What to do when the check did not pass. Omitted for passing checks.
  remediation?: string | undefined;
  // Structured extras for the UI (counts, timestamps). Never credentials.
  details?: JSONObject | undefined;
}

/*
 * What the tester could learn about the OneUptime deployment itself. Every
 * probe is independently best-effort: `null` means "could not determine",
 * which the UI renders as unknown rather than as healthy.
 */
export interface ConnectorPlatformStatus {
  // Processes consuming the Worker queue (BullMQ getWorkersCount).
  workerConsumers: number | null;
  // Whether the minute-cadence poll scheduler is registered on the queue.
  schedulerRegistered: boolean | null;
  schedulerNextRunAt?: string | undefined;
  queueWaiting: number | null;
  queueFailed: number | null;
  // Whether the analytics database that stores security events answered.
  storageReachable: boolean | null;
}

export interface SecurityConnectorSample {
  id: string;
  title: string;
  severity: string;
  // When the source created the record.
  createdTime?: string | undefined;
  // The record's own event/detection time, which may be much earlier.
  eventTime?: string | undefined;
}

export type SecurityConnectorTestStatus = "pass" | "fail" | "warn";

export interface SecurityConnectorTestReport {
  // Provider identifier, e.g. "google-secops" or a SecurityEventConnectorProvider value.
  provider: string;
  status: SecurityConnectorTestStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  checks: Array<SecurityConnectorCheck>;
  // One-paragraph verdict written for the person reading the modal.
  summary: string;
  platform?: ConnectorPlatformStatus | undefined;
  /*
   * Availability counts, keyed by a stable name the UI knows how to label,
   * e.g. { createdLast24h: 12, createdLast7d: 140, hasMoreLast7d: false }.
   */
  counts?: JSONObject | undefined;
  samples?: Array<SecurityConnectorSample> | undefined;
}

/*
 * Fold check statuses into the report verdict: any failure fails the
 * report; otherwise any warning makes it a warning; skips are neutral.
 */
export function summarizeCheckStatuses(
  checks: Array<SecurityConnectorCheck>,
): SecurityConnectorTestStatus {
  if (
    checks.some((check: SecurityConnectorCheck): boolean => {
      return check.status === "fail";
    })
  ) {
    return "fail";
  }

  if (
    checks.some((check: SecurityConnectorCheck): boolean => {
      return check.status === "warn";
    })
  ) {
    return "warn";
  }

  return "pass";
}
