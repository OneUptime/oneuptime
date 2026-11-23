import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "./TelemetryIngestionBudget";

/*
 * WHY TELEMETRY SENT WITH A KNOWN INGESTION KEY WAS REFUSED (issue #6378).
 *
 * The ingest guards turn a request away for one of these reasons, and
 * TelemetryIngestRefusalRecorder counts each refusal against the key that
 * sent it (TelemetryIngestionKeyRefusal: one row per key, reason and
 * surface), so the RUM setup check, its empty charts and the key's own page
 * can say what was refused, when, and how to fix it.
 *
 * Only a refusal of a key that resolved is counted. A missing or unknown
 * token names no project, so it is counted nowhere: the sender's 401 and the
 * server's "Invalid service token." log line are all there is of it.
 *
 * The values are stored, so they never change; a new reason is a new value.
 */
export enum TelemetryIngestRefusalReason {
  // The key's kill switch is off.
  KeyDisabled = "key-disabled",
  // The key's expiry date passed.
  KeyExpired = "key-expired",
  // A Browser key's request came from an origin it does not list, or none.
  OriginNotAllowed = "origin-not-allowed",
  // A Browser key on a surface only Server keys may use.
  BrowserKeyNotAllowedHere = "browser-key-not-allowed-here",
  /*
   * A Mobile key (issue #6457) sending anything but a mobile app's OTLP
   * traces, logs and metrics over HTTP, or sending from a web page.
   */
  MobileKeyNotAllowedHere = "mobile-key-not-allowed-here",
  // A key pinned to one service on an identity registration surface.
  PinnedKeyNotAllowedHere = "pinned-key-not-allowed-here",
  // Over the key's own requests-per-minute limit.
  KeyRequestsPerMinute = "key-requests-per-minute",
  // The key's own daily ingestion budget is used up.
  KeyDailyBudget = "key-daily-budget",
  // Over the key's own ingestion rate (bytes per second).
  KeyIngestionRate = "key-ingestion-rate",
  // The project's daily ingestion budget is used up.
  ProjectDailyBudget = "project-daily-budget",
  // Over the project's ingestion rate (bytes per second).
  ProjectIngestionRate = "project-ingestion-rate",
  // The project has no way to pay (pay-as-you-go billing).
  PaymentRequired = "payment-required",
  // An administrator of this install blocked the project.
  ProjectBlocked = "project-blocked",
}

export const ALL_TELEMETRY_INGEST_REFUSAL_REASONS: ReadonlyArray<TelemetryIngestRefusalReason> =
  Object.values(TelemetryIngestRefusalReason);

/*
 * The reasons that hold for every key of the project alike: whichever key
 * the sender used, it would have been refused the same way. The rest belong
 * to the key that was refused.
 */
export const PROJECT_WIDE_TELEMETRY_INGEST_REFUSAL_REASONS: ReadonlySet<TelemetryIngestRefusalReason> =
  new Set<TelemetryIngestRefusalReason>([
    TelemetryIngestRefusalReason.ProjectDailyBudget,
    TelemetryIngestRefusalReason.ProjectIngestionRate,
    TelemetryIngestRefusalReason.PaymentRequired,
    TelemetryIngestRefusalReason.ProjectBlocked,
  ]);

/*
 * The surface stored for a refusal on the legacy guard
 * (TelemetryIngest.isAuthorizedServiceMiddleware), which names none.
 */
export const UNNAMED_TELEMETRY_INGEST_SURFACE: string = "unnamed";

export function isTelemetryIngestRefusalReason(
  value: unknown,
): value is TelemetryIngestRefusalReason {
  return (
    typeof value === "string" &&
    (ALL_TELEMETRY_INGEST_REFUSAL_REASONS as ReadonlyArray<string>).includes(
      value,
    )
  );
}

/*
 * Whether a budget scope's refusal is the key's own, or holds for every key
 * of the project alike - each scope named, so a new one is decided here.
 *
 * A team's or a label's budget (#6386) never refuses a request: whose
 * telemetry a request carries is known only in the worker, after the
 * sender was answered, so its budget drops what it counts there and keeps
 * its drops in its own day counters (TelemetryIngestAttribution), which
 * the Usage page and Security Events read. Were one handed here, it would
 * read as the project's, not the key's: whichever key sent the team's
 * telemetry, it would have been dropped the same way.
 */
const IS_KEY_SCOPE: Record<TelemetryIngestionBudgetScope, boolean> = {
  [TelemetryIngestionBudgetScope.Project]: false,
  [TelemetryIngestionBudgetScope.IngestionKey]: true,
  [TelemetryIngestionBudgetScope.Team]: false,
  [TelemetryIngestionBudgetScope.Label]: false,
};

// The reason an ingestion budget refusal is counted under.
export function getTelemetryIngestRefusalReasonForBudget(refusal: {
  kind: TelemetryIngestionBudgetRefusalKind;
  scope: TelemetryIngestionBudgetScope;
}): TelemetryIngestRefusalReason {
  const isKey: boolean = IS_KEY_SCOPE[refusal.scope] === true;

  if (refusal.kind === TelemetryIngestionBudgetRefusalKind.RateLimited) {
    return isKey
      ? TelemetryIngestRefusalReason.KeyIngestionRate
      : TelemetryIngestRefusalReason.ProjectIngestionRate;
  }

  return isKey
    ? TelemetryIngestRefusalReason.KeyDailyBudget
    : TelemetryIngestRefusalReason.ProjectDailyBudget;
}
