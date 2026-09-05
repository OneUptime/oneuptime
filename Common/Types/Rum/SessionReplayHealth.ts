/*
 * Recording health for one RUM application: the answer to "why are there
 * no recordings?" as data rather than as silence.
 *
 * Two shapes live here. SessionReplayIngestStatusResponseDto is the JSON
 * that POST /telemetry/rum/session-replay/ingest-status answers today
 * plus its additive fields, every new one optional. RecordingHealthStatus
 * is the normalised object the Dashboard builds from it (see
 * parseRecordingHealthStatus in Common/Utils/Rum/SessionReplayHealth.ts)
 * and the only input diagnoseRecordingHealth takes. Keeping the two apart
 * is what lets the diagnosis be exhaustively tested against a stable
 * shape while the wire grows a field at a time.
 *
 * One rule runs through both: a counter that could not be read is null,
 * never 0. "0 refusals" and "the refusal counter is unreachable" are
 * different facts and the UI says "unknown" for the second.
 */

/*
 * WHY the ingest gate refused a chunk. This is the gate's EXISTING closed
 * vocabulary (SessionReplayIngestService.gateChunkRequest), copied rather
 * than invented: the refusal counters are keyed on the reason string the
 * gate already puts on the chunk response, so a customer's support ticket,
 * the recorder's debug log and this list all quote the same word.
 */
export type SessionReplayRefusalReason =
  /* SESSION_REPLAY_INGEST_ENABLED=false on this deployment. */
  | "ingest-disabled"
  /* No recorder artifact is published, so nothing should be posting. */
  | "instance-not-offering-replay"
  /* The policy lookup threw; failed closed. */
  | "policy-unavailable"
  /* Project or application switched off, or an unknown identifier. */
  | "not-enabled"
  /* The Origin header is not in the application's allowed origins. */
  | "origin-not-allowed"
  /* The session already holds MAX_SESSION_REPLAY_CHUNKS_PER_SESSION. */
  | "session-chunk-cap"
  /* The server's sampling draw disagrees with the recorder's. */
  | "not-sampled"
  | "rate-limited"
  /* The rate counter (Redis) was unreachable; failed closed. */
  | "rate-counter-unavailable"
  /* The project's daily byte budget is spent. */
  | "budget-exhausted"
  /* The budget counter (Redis) was unreachable; failed closed. */
  | "budget-counter-unavailable"
  /* The application's own monthly budget is spent. */
  | "app-monthly-budget-exhausted"
  /*
   * Every frame in the request asserted consent Unknown while the
   * application requires explicit consent. The recorder is told to keep
   * recording (directive continue): the page simply has not called
   * grantConsent() yet, and this is the count that tells the customer so.
   */
  | "consent-required";

export const SESSION_REPLAY_REFUSAL_REASONS: ReadonlyArray<SessionReplayRefusalReason> =
  [
    "ingest-disabled",
    "instance-not-offering-replay",
    "policy-unavailable",
    "not-enabled",
    "origin-not-allowed",
    "session-chunk-cap",
    "not-sampled",
    "rate-limited",
    "rate-counter-unavailable",
    "budget-exhausted",
    "budget-counter-unavailable",
    "app-monthly-budget-exhausted",
    "consent-required",
  ];

export function isSessionReplayRefusalReason(
  value: unknown,
): value is SessionReplayRefusalReason {
  return (
    typeof value === "string" &&
    (SESSION_REPLAY_REFUSAL_REASONS as ReadonlyArray<string>).includes(value)
  );
}

export interface SessionReplayRefusalCount {
  reason: SessionReplayRefusalReason;
  count: number;
}

/*
 * The wire response of /ingest-status. The first block is what the route
 * has always answered; everything after it is additive and optional.
 */
export interface SessionReplayIngestStatusResponseDto {
  isProjectAllowed: boolean;
  isApplicationEnabled: boolean;
  appIdentifier: string;
  allowedOrigins: Array<string>;
  samplePercentage: number;
  captureTrigger: string;
  /* ISO-8601 or null. */
  lastChunkReceivedAt: string | null;
  budgetExceededAt: string | null;
  /* null = counter unreachable. */
  projectBytesUsedToday: number | null;
  dailyByteLimit: number;
  applicationBytesUsedThisMonth: number | null;
  monthlyBudgetInGB: number | null;

  /* ---- Additive. ---- */
  consentMode?: string;
  maskingMode?: string;
  retentionInDays?: number;
  /* The recorder artifact version the /config route hands out; null when none is built. */
  publishedRecorderVersion?: string | null;
  /* RumApplication.lastSeenAt: the /config route stamps it on every fetch. */
  lastConfigFetchAt?: string | null;
  lastSessionStartedAt?: string | null;
  sessionsLast24h?: number | null;
  playableSessionsLast24h?: number | null;
  /* null when the counter store is unreachable; [] when nothing was refused. */
  refusalsLast24h?: Array<{ reason: string; count: number }> | null;
  /*
   * Chunks the server ACCEPTED (202) and then dropped in the ingest worker,
   * by reason. Kept apart from refusals because the recorder was told these
   * landed; an open vocabulary (scrub-incomplete, over-cap, erased, ...)
   * because the worker's drop reasons are operational, not a contract.
   */
  dropsLast24h?: Array<{ reason: string; count: number }> | null;
  /*
   * What the recorder that most recently uploaded announced it can
   * capture (SESSION_REPLAY_RECORDER_CAPABILITIES on the chunk envelope,
   * the same vocabulary the manifest header carries). The setup guide and
   * the health card show it so "no clicks in the rail" can be answered
   * with "this recorder does not send click events" rather than left as a
   * mystery. null = not reported (an older server, or no chunk yet);
   * [] = a recorder uploaded and announced nothing, which is a different
   * fact and reads as "unknown capabilities" on purpose.
   */
  recorderCapabilities?: Array<string> | null;
}

/* The policy half of the status, as the recorder would see it. */
export interface RecordingHealthPolicy {
  isProjectEnabled: boolean;
  isApplicationEnabled: boolean;
  /* SessionReplayCaptureTrigger value; "" when the server did not say. */
  captureTrigger: string;
  samplePercentage: number;
  /* SessionReplayConsentMode value; "" when the server did not say. */
  consentMode: string;
  /* SessionReplayMaskingMode value; "" when the server did not say. */
  maskingMode: string;
  /* null when the server did not say. */
  retentionInDays: number | null;
}

/*
 * Normalised health status. Timestamps stay ISO strings (null when the
 * event never happened); the diagnosis converts them against `now` so it
 * remains a pure function of its inputs.
 */
export interface RecordingHealthStatus {
  appIdentifier: string;
  allowedOrigins: Array<string>;
  policy: RecordingHealthPolicy;
  /* null when no recorder artifact is published or the server did not say. */
  publishedRecorderVersion: string | null;
  lastConfigFetchAt: string | null;
  lastChunkReceivedAt: string | null;
  lastSessionStartedAt: string | null;
  budgetExceededAt: string | null;
  sessionsLast24h: number | null;
  playableSessionsLast24h: number | null;
  refusalsLast24h: Array<SessionReplayRefusalCount> | null;
  /*
   * Open vocabulary; see SessionReplayIngestStatusResponseDto.dropsLast24h.
   * Optional as well as nullable: it was added after the surfaces that
   * build this object, and absent means the same as null (unknown).
   */
  dropsLast24h?: Array<{ reason: string; count: number }> | null;
  /*
   * See SessionReplayIngestStatusResponseDto.recorderCapabilities. Carried
   * through parseRecordingHealthStatus so the surfaces that already hold a
   * RecordingHealthStatus do not have to keep a second parse of the same
   * body alive. Optional as well as nullable for the same reason
   * dropsLast24h is: it postdates the objects that build this shape.
   */
  recorderCapabilities?: Array<string> | null;
  projectBytesUsedToday: number | null;
  dailyByteLimit: number;
  applicationBytesUsedThisMonth: number | null;
  monthlyBudgetInGB: number | null;
}

/*
 * In strict priority order. The diagnosis returns the FIRST state whose
 * condition holds, so a project that is switched off is reported as
 * switched off even when its refusal counters are also climbing.
 */
export type RecordingHealthState =
  | "disabled-project"
  | "disabled-app"
  | "budget-paused"
  | "refusing"
  | "never-loaded"
  | "loaded-never-uploaded"
  | "stale"
  | "healthy-quiet"
  | "healthy"
  | "unknown";

export type RecordingHealthSeverity = "ok" | "info" | "warning" | "error";

/* Where the one offered action takes the viewer. */
export type RecordingHealthActionTarget =
  | "app-settings"
  | "project-settings"
  | "setup-guide"
  | "docs-consent"
  | "docs-csp"
  | "budget"
  | "allowed-origins";

export interface RecordingHealthAction {
  label: string;
  target: RecordingHealthActionTarget;
}

export interface RecordingHealthDiagnosis {
  state: RecordingHealthState;
  severity: RecordingHealthSeverity;
  /* One line: names the cause. */
  title: string;
  /* One or two sentences: quantifies it. */
  detail: string;
  /* At most one. Absent when nothing in the product fixes the state. */
  action?: RecordingHealthAction;
}
