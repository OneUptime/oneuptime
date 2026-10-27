/*
 * HOW FAR THE REQUEST BEHIND A SECURITY EVENT GOT, as its trace shows.
 *
 * A log line that holds an attack string says somebody tried. The trace of
 * the request it was written in says whether it worked: the status the app
 * answered with, how long it took, the exception it threw, the database
 * statement it ran. OneUptime holds that trace beside the log, so it can
 * say what a SIEM that only reads logs cannot (Server/Utils/SecurityEvent/
 * RequestTrace/SecurityRequestTrace.ts reads it, Utils/SecurityEvent/
 * RequestOutcome.ts decides).
 *
 * Stored on the event (SecurityEvent.requestOutcome). Empty when the event
 * names no request OneUptime could follow: no trace, or no spans for it.
 */
enum SecurityEventRequestOutcome {
  // The app turned the request away (4xx): no handler did what it asked.
  Rejected = "Rejected",
  // A handler ran and answered (2xx, 3xx).
  ReachedApp = "Reached App",
  // The request broke something: a 5xx, a failed span or an exception.
  Errored = "Errored",
  /*
   * The payload ran in the database: a query the request made holds it, or
   * the request took as long as the SQL it carried asked the database to
   * sleep.
   */
  ReachedDatabase = "Reached Database",
}

// Least to most serious - the order the UI lists and ranks them in.
export const SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER: ReadonlyArray<SecurityEventRequestOutcome> =
  [
    SecurityEventRequestOutcome.Rejected,
    SecurityEventRequestOutcome.ReachedApp,
    SecurityEventRequestOutcome.Errored,
    SecurityEventRequestOutcome.ReachedDatabase,
  ];

export function isSecurityEventRequestOutcome(
  value: unknown,
): value is SecurityEventRequestOutcome {
  return (
    typeof value === "string" &&
    (
      SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER as ReadonlyArray<string>
    ).includes(value)
  );
}

// 0 for no outcome, then 1 (Rejected) to 4 (Reached Database).
export function getRequestOutcomeRank(value: string | undefined): number {
  if (!isSecurityEventRequestOutcome(value)) {
    return 0;
  }

  return SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER.indexOf(value) + 1;
}

/*
 * The facts a followed request leaves on its event, as attributes: the
 * OpenTelemetry names where OpenTelemetry has one, so a search or a rule
 * reads them the way it reads any request, and oneuptime.* for what only
 * the trace says. The UI writes its sentences from these, so a reader's
 * language words them.
 */
export const SECURITY_REQUEST_ATTRIBUTES: {
  method: string;
  url: string;
  route: string;
  statusCode: string;
  clientAddress: string;
  userAgent: string;
  userId: string;
  durationMs: string;
  serverSpanId: string;
  exceptionFingerprint: string;
  exceptionType: string;
  exceptionMessage: string;
  databaseSystem: string;
  databaseStatement: string;
  databaseDurationMs: string;
  requestedDelaySeconds: string;
} = {
  method: "http.request.method",
  url: "url.original",
  route: "http.route",
  statusCode: "http.response.status_code",
  clientAddress: "client.address",
  userAgent: "user_agent.original",
  userId: "enduser.id",
  durationMs: "oneuptime.request.duration_ms",
  serverSpanId: "oneuptime.request.span_id",
  exceptionFingerprint: "oneuptime.exception.fingerprint",
  exceptionType: "oneuptime.exception.type",
  exceptionMessage: "oneuptime.exception.message",
  databaseSystem: "oneuptime.database.system",
  databaseStatement: "oneuptime.database.statement",
  databaseDurationMs: "oneuptime.database.duration_ms",
  requestedDelaySeconds: "oneuptime.attack.requested_delay_seconds",
};

export default SecurityEventRequestOutcome;
