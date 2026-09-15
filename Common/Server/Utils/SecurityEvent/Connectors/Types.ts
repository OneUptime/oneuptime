import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";

/*
 * The contract every managed security source implements.
 *
 * A connector is stateless: every call receives the decrypted settings and
 * opens its own HTTP session, so one instance is shared across requests
 * and across tenants. The poller, the tester and the API only ever talk
 * to this interface — a provider is a client, a normalizer and one class
 * implementing this, nothing else.
 *
 * Time basis is the whole design: fetchEvents lists records by the time
 * the SOURCE CREATED them, never by the time of the underlying activity.
 * A SIEM rule that runs hourly creates a detection long after the events
 * it matched; polling by event time with a forward-moving cursor skips
 * every such record, which is the bug this framework exists to avoid.
 */

/*
 * Decrypted, server-only settings for one connection. `config` holds the
 * catalog's non-secret keys, `secrets` its secret keys. Never serialize
 * this object into a response or a log line.
 */
export interface SecurityConnectorSettings {
  provider: SecurityEventConnectorProvider;
  config: JSONObject;
  secrets: JSONObject;
  alertingOnly: boolean;
}

/*
 * The transport every connector client sends requests through. It is the
 * SSRF-guarded DataSourceHttpFetch in production and a fixture in tests.
 */
export type ConnectorTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface ConnectorFetchWindow {
  // Inclusive lower bound on the source's creation time.
  startTime: Date;
  // Exclusive upper bound on the source's creation time.
  endTime: Date;
}

/*
 * Which operation a fetch serves. A poll reads strictly by creation time. A
 * preview or backfill reads a range a person picked, which a source that
 * can also list records by their event time may widen to that basis too
 * (Google SecOps searches detections by created AND detection time there),
 * so the records a person sees match what the source's own console shows
 * for that range.
 */
export type ConnectorFetchPurpose = "poll" | "preview" | "backfill";

export interface ConnectorFetchOptions {
  // Upper bound on outbound requests for this fetch, pagination included.
  maxRequests: number;
  // Upper bound on records collected before the connector must stop.
  maxEvents: number;
  requestTimeoutInMs: number;
  // How many samples to return for diagnostics.
  sampleLimit: number;
  // Undefined is treated as "poll".
  purpose?: ConnectorFetchPurpose | undefined;
  /*
   * Wall-clock budget for the whole fetch. A connector that honours it stops
   * issuing requests once it is spent and reports complete=false, like any
   * other bound. Undefined means only the request and event bounds apply.
   */
  maxDurationMs?: number | undefined;
  /*
   * The connection's poll interval, for connectors that report how late the
   * source created records relative to the schedule.
   */
  pollIntervalInMinutes?: number | undefined;
}

/*
 * Per-connector overrides of the poller's default fetch bounds. A source
 * that reads one window in several independently budgeted passes needs a
 * larger total than the single-list default; the connector still enforces
 * its own per-pass split inside the total it is given.
 *
 * The poller does not cap these against the worker's job timeout
 * (SECURITY_EVENT_CONNECTION_RUN_TIMEOUT_MS, 10 minutes). Keep maxDurationMs
 * well inside it, with room for the import that follows the fetch: a run the
 * queue kills mid-import is recorded as failed and re-reads its window.
 */
export interface ConnectorFetchBudget {
  maxRequests?: number | undefined;
  maxEvents?: number | undefined;
  maxDurationMs?: number | undefined;
}

export interface ConnectorFetchResult {
  events: Array<NormalizedSecurityEvent>;
  // Records returned by the source before normalization.
  fetchedCount: number;
  // Records the normalizer did not recognize.
  rejectedCount: number;
  // Records that threw during normalization.
  failedCount: number;
  /*
   * False when a bound (requests, events) or a partial source response
   * left part of the window unread.
   */
  complete: boolean;
  requestCount: number;
  warnings: Array<string>;
  samples: Array<SecurityConnectorSample>;
  /*
   * Where the next poll can resume when this fetch stopped on a bound.
   *
   * Set it only when the connector reads records in ASCENDING creation
   * order: it is the creation time of the last record read, so every
   * record created strictly before it inside the window has been read.
   * The poller moves its cursor here instead of re-reading the same
   * window, and its overlap plus dedupe re-reads the records that share
   * this timestamp. Leave it undefined when the source returns records in
   * any other order; the poller then narrows the next window instead.
   * Without either, a window holding more records than one run can read
   * would be re-read forever and nothing new would ever be imported.
   */
  resumeAfter?: Date | undefined;
  /*
   * One check per read pass, for a source that reads a window in several
   * passes (Google SecOps: rule detections, curated detections, the alerts
   * view). The poller records them before its own summary read check, so
   * a pass stopped by a budget shows as a warning under its own name
   * instead of disappearing into one green "read" step.
   */
  checks?: Array<SecurityConnectorCheck> | undefined;
  /*
   * Provider-specific diagnostics (per-pass counts, the time basis read,
   * creation-lag statistics). Copied verbatim onto the run result as
   * providerDetails. Never credentials.
   */
  details?: JSONObject | undefined;
}

export interface ConnectorTestOptions {
  requestTimeoutInMs: number;
  /*
   * True for a test run queued to a worker rather than the synchronous
   * "Test connection": the worker only needs to know whether access works,
   * so a connector may skip slow availability probes (counting records over
   * the last 7 days) to stay well inside the job timeout.
   */
  skipAvailability?: boolean | undefined;
}

/*
 * What testConnection may return instead of a bare check list, for a
 * connector that also counts what is available to import or can show a
 * sample record. The tester copies counts and samples onto the report.
 */
export interface ConnectorTestResult {
  checks: Array<SecurityConnectorCheck>;
  counts?: JSONObject | undefined;
  samples?: Array<SecurityConnectorSample> | undefined;
}

export interface SecurityEventConnector {
  provider: SecurityEventConnectorProvider;

  /*
   * Overrides of the poller's default fetch bounds (see ConnectorFetchBudget).
   * Absent for a connector the defaults suit.
   */
  fetchBudget?: ConnectorFetchBudget | undefined;

  /*
   * Synchronous shape validation of config and secrets beyond what the
   * catalog's required flags express (URL syntax, enum values, identifier
   * formats). Throws BadDataException with a message the person filling
   * the form can act on.
   */
  validateSettings(settings: SecurityConnectorSettings): void;

  /*
   * Provider-side checks only: authentication, a one-record read over the
   * last day, and how many records the source created in the last 24
   * hours and 7 days. Platform checks (workers, scheduler, storage) are
   * added by the shared tester. Never throws — failures are checks with
   * status "fail".
   */
  testConnection(
    settings: SecurityConnectorSettings,
    options: ConnectorTestOptions,
  ): Promise<Array<SecurityConnectorCheck> | ConnectorTestResult>;

  /*
   * List records created in the window and normalize them. Must paginate
   * and respect every bound in options; must throw for transport,
   * authentication and permission failures (the poller records them as a
   * failed run and holds the cursor). A connector that reads in passes may
   * attach the checks of the passes that ran to the thrown error with
   * attachConnectorChecks, so the failed run names the pass that failed.
   * It may also attach what those passes gathered (their warnings, request
   * and record counts, and provider details so far) with
   * attachConnectorFetchSummary, so the failed run still shows what was
   * read before the failure. Both ride on the original error; neither
   * changes its type or message.
   */
  fetchEvents(
    settings: SecurityConnectorSettings,
    window: ConnectorFetchWindow,
    options: ConnectorFetchOptions,
  ): Promise<ConnectorFetchResult>;
}

export function toConnectorTestResult(
  value: Array<SecurityConnectorCheck> | ConnectorTestResult,
): ConnectorTestResult {
  return Array.isArray(value) ? { checks: value } : value;
}

/*
 * The property attachConnectorChecks stores checks under. Kept on the
 * original error object, not a wrapper, so the error's type and message
 * (which the docs quote) reach the run unchanged.
 */
const CONNECTOR_CHECKS_PROPERTY: string = "oneuptimeConnectorChecks";

export function attachConnectorChecks<T>(
  error: T,
  checks: Array<SecurityConnectorCheck>,
): T {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, CONNECTOR_CHECKS_PROPERTY, {
        value: checks,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {
      /*
       * A frozen or non-extensible error cannot take the property. The
       * checks only name the failing pass, so the connector still rethrows
       * the original error rather than a TypeError about the property.
       */
    }
  }

  return error;
}

export function readConnectorChecks(
  error: unknown,
): Array<SecurityConnectorCheck> | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const checks: unknown = (error as Record<string, unknown>)[
    CONNECTOR_CHECKS_PROPERTY
  ];

  return Array.isArray(checks)
    ? (checks as Array<SecurityConnectorCheck>)
    : undefined;
}

/*
 * What a fetch that read in passes had gathered when a pass threw. The
 * poller copies it onto the failed run, so the run keeps the warnings the
 * passes that ran raised (a curated HTTP 403 downgrade, a budget stop),
 * how many requests they made, how many records they collected, and the
 * provider details so far. The retired Google SecOps poller mutated one
 * result through every pass and kept all of that on a failed run; this is
 * how a connector hands the same over through the shared poller. Never
 * credentials.
 */
export interface ConnectorFetchFailureSummary {
  warnings: Array<string>;
  requestCount: number;
  // Records collected before the failure, before normalization.
  fetchedCount: number;
  details?: JSONObject | undefined;
}

/*
 * Stored beside the checks and for the same reason: on the original error,
 * never a wrapper, so the error's type and message reach the run unchanged.
 */
const CONNECTOR_FETCH_SUMMARY_PROPERTY: string =
  "oneuptimeConnectorFetchSummary";

export function attachConnectorFetchSummary<T>(
  error: T,
  summary: ConnectorFetchFailureSummary,
): T {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, CONNECTOR_FETCH_SUMMARY_PROPERTY, {
        value: summary,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {
      /*
       * A frozen or non-extensible error cannot take the property. The
       * summary is diagnostics only, so the connector still rethrows the
       * original error rather than a TypeError about the property.
       */
    }
  }

  return error;
}

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/*
 * The summary attached to an error, or undefined. The property can be set
 * by anything holding the error, so the shape is checked rather than
 * trusted: a summary without an array of warnings or without both counts
 * is ignored, non-string warnings are dropped, and details that are not an
 * object are left out. The result is a copy, so a caller appending to its
 * warnings never changes what the error carries.
 */
export function readConnectorFetchSummary(
  error: unknown,
): ConnectorFetchFailureSummary | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const stored: unknown = (error as Record<string, unknown>)[
    CONNECTOR_FETCH_SUMMARY_PROPERTY
  ];

  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return undefined;
  }

  const candidate: Record<string, unknown> = stored as Record<string, unknown>;

  if (
    !Array.isArray(candidate["warnings"]) ||
    !isNonNegativeCount(candidate["requestCount"]) ||
    !isNonNegativeCount(candidate["fetchedCount"])
  ) {
    return undefined;
  }

  const details: unknown = candidate["details"];

  return {
    warnings: (candidate["warnings"] as Array<unknown>).filter(
      (warning: unknown): warning is string => {
        return typeof warning === "string";
      },
    ),
    requestCount: candidate["requestCount"],
    fetchedCount: candidate["fetchedCount"],
    ...(details && typeof details === "object" && !Array.isArray(details)
      ? { details: details as JSONObject }
      : {}),
  };
}

/*
 * Small helpers shared by connectors so their checks read alike.
 */
export function readSettingString(source: JSONObject, key: string): string {
  const value: unknown = source[key];

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function readSettingBoolean(
  source: JSONObject,
  key: string,
  fallback: boolean,
): boolean {
  const value: unknown = source[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

export function makeCheck(data: {
  key: string;
  name: string;
  status: SecurityConnectorCheck["status"];
  startedAtMs: number;
  message: string;
  remediation?: string | undefined;
  details?: JSONObject | undefined;
}): SecurityConnectorCheck {
  return {
    key: data.key,
    name: data.name,
    status: data.status,
    durationMs: Math.max(0, Date.now() - data.startedAtMs),
    message: data.message,
    ...(data.remediation ? { remediation: data.remediation } : {}),
    ...(data.details ? { details: data.details } : {}),
  };
}
