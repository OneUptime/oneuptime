/*
 * The replay session id, carried on W3C trace context.
 *
 * The browser recorder adds one `tracestate` list member to the requests a
 * page makes to its own origin:
 *
 *   tracestate: oneuptime=sid:<32 hex session id>[;p:<16 hex parent id>]
 *
 * tracestate is the one channel a stock OpenTelemetry backend carries
 * without being told to. Every SDK's W3C propagator extracts it onto the
 * remote parent, every child span inherits it, every OTLP exporter sends
 * it as the span's `traceState`, and every outgoing call re-injects it. So
 * span ingest can stamp Span.sessionId for every service a browser request
 * touched, with no code in the customer's backend. (OTLP log records carry
 * no trace state; logs are joined to a session by trace id instead.)
 *
 * `p` is present only when the recorder MINTED the traceparent. Its parent
 * id then names a browser span that is never exported, so the backend's
 * entry span would otherwise arrive pointing at a parent that does not
 * exist: never a root span, flagged as missing its parent. Ingest treats a
 * span whose parent is exactly `p` as the root it really is.
 *
 * Both halves live here so the recorder that writes the member and the
 * ingest that reads it cannot drift. Standalone functions rather than
 * class statics, because the recorder bundle tree-shakes unused exports
 * but not unused statics - the recorder imports only the builder.
 *
 * Dependency-free: bundled into the browser recorder as well as imported
 * by the server.
 */

/* The list-member key. A valid W3C tracestate simple key. */
export const SESSION_TRACE_STATE_KEY: string = "oneuptime";

/*
 * Hostile-input bounds for the parser. W3C caps a well-formed header at 32
 * members, and the OpenTelemetry JS SDK at 512 characters, but other SDKs
 * only cap member count and member length, so a legitimate value carrying
 * other vendors' members can be longer than 512. Past these a value is not
 * one the recorder wrote, so no session is read out of it - but our
 * members are still stripped from it.
 */
const MAX_TRACE_STATE_LENGTH: number = 8192;
const MAX_TRACE_STATE_MEMBERS: number = 64;

const SESSION_ID_PATTERN: RegExp = /^[0-9a-f]{32}$/;
const PARENT_SPAN_ID_PATTERN: RegExp = /^[0-9a-f]{16}$/;
const ALL_ZERO_PATTERN: RegExp = /^0+$/;

export interface SessionTraceState {
  /* 32 lowercase hex characters. */
  sessionId: string;

  /*
   * 16 lowercase hex characters: the parent id of a traceparent the
   * recorder minted, which no exported span carries. null when the
   * traceparent came from the page or its own instrumentation.
   */
  syntheticParentSpanId: string | null;
}

export interface ParsedSessionTraceState {
  /* The session member, or null when there is none or it is malformed. */
  sessionTraceState: SessionTraceState | null;

  /*
   * The trace state with every `oneuptime` member removed, so the session
   * id is stored in exactly one column - the one erasure deletes by -
   * rather than also in the raw trace state. Other vendors' members are
   * kept verbatim (trimmed of optional whitespace), in order.
   */
  remainingTraceState: string;
}

/*
 * The tracestate list member for a session. Callers pass recorder-minted
 * values (a 32-hex session id, a 16-hex parent id); nothing here needs
 * escaping, because hex and the ':' / ';' separators are all legal in a
 * tracestate value.
 */
export function buildSessionTraceStateMember(
  sessionId: string,
  syntheticParentSpanId?: string | null,
): string {
  return (
    SESSION_TRACE_STATE_KEY +
    "=sid:" +
    sessionId +
    (syntheticParentSpanId ? ";p:" + syntheticParentSpanId : "")
  );
}

/*
 * Read the session member out of a span's trace state.
 *
 * Accepts anything, because the value comes from an OTLP body a customer
 * (or anyone holding an ingestion key) controls: a non-string, an
 * oversized string or a malformed member yields no session and never
 * throws. The first `oneuptime` member wins, as in the W3C rule that a
 * vendor's own member is the left-most one; fields inside it are
 * `name:value` pairs separated by ';', in any order, and unknown fields are
 * ignored so the format can grow.
 */
export function parseSessionTraceState(
  traceState: unknown,
): ParsedSessionTraceState {
  if (typeof traceState !== "string") {
    return { sessionTraceState: null, remainingTraceState: "" };
  }

  /*
   * Fast path, and the path almost every span takes: no member of ours,
   * nothing to parse and nothing to strip.
   */
  if (traceState.indexOf(SESSION_TRACE_STATE_KEY) === -1) {
    return { sessionTraceState: null, remainingTraceState: traceState };
  }

  const members: Array<string> = traceState.split(",");

  /*
   * Past the bounds nothing is READ as a session - a value this far out of
   * spec is not one the recorder wrote - but our members are still
   * stripped, so an id cannot survive in the raw trace state just because
   * the value around it was oversized.
   */
  const isWithinBounds: boolean =
    traceState.length <= MAX_TRACE_STATE_LENGTH &&
    members.length <= MAX_TRACE_STATE_MEMBERS;

  let sessionTraceState: SessionTraceState | null = null;
  let sawSessionMember: boolean = false;
  const remaining: Array<string> = [];

  for (const rawMember of members) {
    const member: string = rawMember.trim();

    if (member === "") {
      continue;
    }

    const equalsIndex: number = member.indexOf("=");
    const key: string =
      equalsIndex === -1 ? member : member.slice(0, equalsIndex).trim();

    if (key !== SESSION_TRACE_STATE_KEY) {
      remaining.push(member);
      continue;
    }

    /*
     * Every member under our key is stripped, parsed or not: a malformed
     * one can still hold an id, and the point of stripping is that no id
     * survives outside the sessionId column.
     */
    if (isWithinBounds && !sawSessionMember && equalsIndex !== -1) {
      sessionTraceState = readSessionMemberValue(member.slice(equalsIndex + 1));
    }

    sawSessionMember = true;
  }

  return {
    sessionTraceState: sessionTraceState,
    remainingTraceState: remaining.join(","),
  };
}

function readSessionMemberValue(value: string): SessionTraceState | null {
  let sessionId: string | null = null;
  let syntheticParentSpanId: string | null = null;

  for (const rawField of value.split(";")) {
    const field: string = rawField.trim();
    const colonIndex: number = field.indexOf(":");

    if (colonIndex === -1) {
      continue;
    }

    const name: string = field.slice(0, colonIndex);
    const fieldValue: string = field.slice(colonIndex + 1).toLowerCase();

    if (name === "sid" && sessionId === null) {
      if (!SESSION_ID_PATTERN.test(fieldValue)) {
        return null;
      }

      sessionId = fieldValue;
    } else if (name === "p" && syntheticParentSpanId === null) {
      /*
       * A malformed parent id costs only the root-span repair, never the
       * session: the session id is what the member is for.
       */
      if (
        PARENT_SPAN_ID_PATTERN.test(fieldValue) &&
        !ALL_ZERO_PATTERN.test(fieldValue)
      ) {
        syntheticParentSpanId = fieldValue;
      }
    }
  }

  if (sessionId === null || ALL_ZERO_PATTERN.test(sessionId)) {
    return null;
  }

  return {
    sessionId: sessionId,
    syntheticParentSpanId: syntheticParentSpanId,
  };
}
