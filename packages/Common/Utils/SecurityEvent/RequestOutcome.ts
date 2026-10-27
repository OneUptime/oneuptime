import SecurityEventRequestOutcome, {
  getRequestOutcomeRank,
} from "../../Types/SecurityEvent/SecurityEventRequestOutcome";

/*
 * HOW FAR A REQUEST GOT, read from what OneUptime holds about it: the status
 * an access log line recorded, or the spans and exceptions of its trace.
 *
 * Pure and bounded: the trace reader (Server/Utils/SecurityEvent/
 * RequestTrace/SecurityRequestTrace.ts) hands it rows it already read, the
 * event panel hands it the same rows read again, and both reach the same
 * verdict. Every scan of text is an indexOf, never a regular expression,
 * because the text is a request an attacker wrote.
 */

// The status an HTTP response carried, as an outcome.
export function requestOutcomeFromStatusCode(
  statusCode: number,
): SecurityEventRequestOutcome | undefined {
  if (!Number.isInteger(statusCode)) {
    return undefined;
  }

  if (statusCode >= 500 && statusCode <= 599) {
    return SecurityEventRequestOutcome.Errored;
  }

  if (statusCode >= 400 && statusCode <= 499) {
    return SecurityEventRequestOutcome.Rejected;
  }

  if (statusCode >= 200 && statusCode <= 399) {
    return SecurityEventRequestOutcome.ReachedApp;
  }

  return undefined;
}

// The more serious of two outcomes; either may be absent.
export function getMoreSeriousOutcome(
  first: SecurityEventRequestOutcome | undefined,
  second: SecurityEventRequestOutcome | undefined,
): SecurityEventRequestOutcome | undefined {
  return getRequestOutcomeRank(second) > getRequestOutcomeRank(first)
    ? second
    : first;
}

// An HTTP status code from an attribute value, or 0.
export function readStatusCode(value: unknown): number {
  const text: string =
    typeof value === "number" ? String(value) : String(value || "").trim();

  if (text.length !== 3) {
    return 0;
  }

  const statusCode: number = Number(text);

  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : 0;
}

/*
 * A request is decoded before it is read for the SQL it carries: scanners
 * send SLEEP%2816%29 as often as SLEEP(16). A sequence that is not valid
 * percent-encoding (the overlong %c0%ae a path traversal uses) leaves the
 * text as it was.
 */
export function decodeRequestText(text: string): string {
  if (text.indexOf("%") === -1 && text.indexOf("+") === -1) {
    return text;
  }

  try {
    return decodeURIComponent(text.split("+").join(" "));
  } catch {
    return text;
  }
}

// The longest delay a time-based injection is believed to ask for.
export const MAX_REQUESTED_DELAY_SECONDS: number = 300;

// Shorter delays are noise: a request takes a second for many reasons.
export const MIN_REQUESTED_DELAY_SECONDS: number = 2;

const SLEEP_FUNCTIONS: ReadonlyArray<string> = ["sleep(", "pg_sleep("];
const WAITFOR_DELAY: string = "waitfor delay '";

function readLeadingNumber(text: string, from: number): number {
  let end: number = from;

  while (end < text.length && end - from < 6) {
    const code: number = text.charCodeAt(end);

    if ((code < 48 || code > 57) && text[end] !== ".") {
      break;
    }

    end++;
  }

  const value: number = Number(text.slice(from, end));

  return end > from && Number.isFinite(value) ? value : 0;
}

/*
 * The seconds a time-based SQL injection asks the database to wait -
 * SLEEP(16), pg_sleep(16), WAITFOR DELAY '0:0:16' - or 0 when the request
 * asks for none (or for too little, or too much, to tell from a slow
 * request).
 */
export function readRequestedDelaySeconds(request: string): number {
  const text: string = decodeRequestText(request).toLowerCase();
  let seconds: number = 0;

  for (const name of SLEEP_FUNCTIONS) {
    let index: number = text.indexOf(name);
    let checked: number = 0;

    while (index !== -1 && checked < 16) {
      seconds = Math.max(seconds, readLeadingNumber(text, index + name.length));
      index = text.indexOf(name, index + name.length);
      checked++;
    }
  }

  const waitfor: number = text.indexOf(WAITFOR_DELAY);

  if (waitfor !== -1) {
    // hh:mm:ss, of which the last part is the one scanners vary.
    const start: number = waitfor + WAITFOR_DELAY.length;
    const close: number = text.indexOf("'", start);
    const parts: Array<string> =
      close === -1 ? [] : text.slice(start, Math.min(close, start + 12)).split(":");

    if (parts.length === 3) {
      seconds = Math.max(
        seconds,
        readLeadingNumber(parts[0]!, 0) * 3600 +
          readLeadingNumber(parts[1]!, 0) * 60 +
          readLeadingNumber(parts[2]!, 0),
      );
    }
  }

  if (
    seconds < MIN_REQUESTED_DELAY_SECONDS ||
    seconds > MAX_REQUESTED_DELAY_SECONDS
  ) {
    return 0;
  }

  return seconds;
}

/*
 * Whether a request that took `durationMs` waited as long as its SQL asked:
 * at least nine tenths of the delay, and not so much longer that it was
 * just slow.
 */
export function didRequestWaitAsAsked(data: {
  requestedDelaySeconds: number;
  durationMs: number;
}): boolean {
  if (data.requestedDelaySeconds <= 0 || !(data.durationMs > 0)) {
    return false;
  }

  const requestedMs: number = data.requestedDelaySeconds * 1000;

  return (
    data.durationMs >= requestedMs * 0.9 &&
    data.durationMs <= requestedMs * 1.5 + 5000
  );
}

/*
 * One span of the request's trace, as the follow-up reads it: only the
 * few attributes it looks at, already read out of the span.
 */
export interface RequestTraceSpan {
  spanId: string;
  parentSpanId: string;
  name: string;
  // OpenTelemetry's span kind as stored: "SPAN_KIND_SERVER", "Server", ...
  kind: string;
  // The span's status: 2 is an error.
  statusCode: number;
  durationMs: number;
  attributes: Record<string, string>;
}

// One exception the request's trace recorded.
export interface RequestTraceException {
  spanId: string;
  fingerprint: string;
  exceptionType: string;
  message: string;
}

export interface RequestTraceDatabaseEvidence {
  system: string;
  statement: string;
  durationMs: number;
}

export interface RequestTraceAssessment {
  outcome: SecurityEventRequestOutcome | undefined;
  // The span that answered the request, when the trace holds one.
  serverSpanId: string;
  statusCode: number;
  method: string;
  url: string;
  route: string;
  clientAddress: string;
  userAgent: string;
  userId: string;
  durationMs: number;
  exception: RequestTraceException | undefined;
  database: RequestTraceDatabaseEvidence | undefined;
  // The delay the request's SQL asked for, when it waited that long.
  requestedDelaySeconds: number;
}

// Attribute names, newest OpenTelemetry convention first.
export const REQUEST_SPAN_ATTRIBUTE_KEYS: {
  statusCode: ReadonlyArray<string>;
  method: ReadonlyArray<string>;
  url: ReadonlyArray<string>;
  path: ReadonlyArray<string>;
  query: ReadonlyArray<string>;
  route: ReadonlyArray<string>;
  clientAddress: ReadonlyArray<string>;
  userAgent: ReadonlyArray<string>;
  userId: ReadonlyArray<string>;
  databaseStatement: ReadonlyArray<string>;
  databaseSystem: ReadonlyArray<string>;
} = {
  statusCode: ["http.response.status_code", "http.status_code"],
  method: ["http.request.method", "http.method"],
  url: ["url.full", "http.url", "url.original"],
  path: ["url.path", "http.target"],
  query: ["url.query"],
  route: ["http.route"],
  clientAddress: [
    "client.address",
    "http.client_ip",
    "net.peer.ip",
    "network.peer.address",
    "net.sock.peer.addr",
  ],
  userAgent: ["user_agent.original", "http.user_agent"],
  userId: ["enduser.id", "user.id"],
  databaseStatement: ["db.query.text", "db.statement"],
  databaseSystem: ["db.system.name", "db.system"],
};

// Every attribute the follow-up reads, for the reader's SELECT.
export const REQUEST_SPAN_ATTRIBUTES_READ: ReadonlyArray<string> = Array.from(
  new Set<string>(
    Object.values(REQUEST_SPAN_ATTRIBUTE_KEYS).flatMap(
      (keys: ReadonlyArray<string>): Array<string> => {
        return [...keys];
      },
    ),
  ),
);

export function readSpanAttribute(
  span: RequestTraceSpan,
  keys: ReadonlyArray<string>,
): string {
  for (const key of keys) {
    const value: string | undefined = span.attributes[key];

    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return "";
}

export function isServerSpan(span: RequestTraceSpan): boolean {
  return String(span.kind || "")
    .toLowerCase()
    .endsWith("server");
}

export const SPAN_STATUS_ERROR: number = 2;

/*
 * The span that answered the request: the server span the event's own
 * span runs under, else the trace's outermost server span, else any span
 * that recorded an HTTP status.
 */
export function findServerSpan(data: {
  spans: ReadonlyArray<RequestTraceSpan>;
  eventSpanId: string;
}): RequestTraceSpan | undefined {
  const byId: Map<string, RequestTraceSpan> = new Map();

  for (const span of data.spans) {
    if (span.spanId) {
      byId.set(span.spanId, span);
    }
  }

  // Up from the event's span, at most as many steps as there are spans.
  let current: RequestTraceSpan | undefined = data.eventSpanId
    ? byId.get(data.eventSpanId)
    : undefined;

  for (let steps: number = 0; current && steps <= byId.size; steps++) {
    if (isServerSpan(current)) {
      return current;
    }

    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }

  const servers: Array<RequestTraceSpan> = data.spans.filter(
    (span: RequestTraceSpan): boolean => {
      return isServerSpan(span);
    },
  );

  const outermost: RequestTraceSpan | undefined = servers.find(
    (span: RequestTraceSpan): boolean => {
      return !span.parentSpanId || !byId.has(span.parentSpanId);
    },
  );

  if (outermost) {
    return outermost;
  }

  if (servers.length > 0) {
    return servers[0];
  }

  return data.spans.find((span: RequestTraceSpan): boolean => {
    return (
      readStatusCode(
        readSpanAttribute(span, REQUEST_SPAN_ATTRIBUTE_KEYS.statusCode),
      ) > 0
    );
  });
}

// The longest database statement an event keeps as evidence.
export const MAX_EVIDENCE_STATEMENT_LENGTH: number = 500;

/*
 * The first query of the trace that holds one of the payload's markers:
 * the request's SQL ran inside a statement the app built, which a
 * parameterized query never does.
 */
export function findDatabaseEvidence(data: {
  spans: ReadonlyArray<RequestTraceSpan>;
  markers: ReadonlyArray<string>;
}): RequestTraceDatabaseEvidence | undefined {
  if (data.markers.length === 0) {
    return undefined;
  }

  for (const span of data.spans) {
    const statement: string = readSpanAttribute(
      span,
      REQUEST_SPAN_ATTRIBUTE_KEYS.databaseStatement,
    );

    if (!statement) {
      continue;
    }

    const lower: string = statement.toLowerCase();

    for (const marker of data.markers) {
      if (marker && lower.indexOf(marker) !== -1) {
        return {
          system: readSpanAttribute(
            span,
            REQUEST_SPAN_ATTRIBUTE_KEYS.databaseSystem,
          ),
          statement:
            statement.length > MAX_EVIDENCE_STATEMENT_LENGTH
              ? `${statement.slice(0, MAX_EVIDENCE_STATEMENT_LENGTH - 1)}…`
              : statement,
          durationMs: span.durationMs,
        };
      }
    }
  }

  return undefined;
}

/*
 * The verdict on a request, from its trace.
 *
 *   Reached Database  a query holds the payload, or the request waited as
 *                     long as its SQL asked;
 *   Errored           it answered 5xx, or answered 2xx/3xx (or nothing)
 *                     while recording an exception or a failed span;
 *   Rejected          it answered 4xx - an exception a 4xx answer records
 *                     (a "not found" thrown and caught) is how the app
 *                     turned it away, not something it broke;
 *   Reached App       it answered 2xx or 3xx.
 *
 * No outcome when the trace holds no answer and nothing failed.
 */
export function assessRequestTrace(data: {
  spans: ReadonlyArray<RequestTraceSpan>;
  exceptions: ReadonlyArray<RequestTraceException>;
  eventSpanId: string;
  // Lowercased strings whose presence in a query means the payload ran.
  sqlMarkers: ReadonlyArray<string>;
  // The request as the event recorded it: read for a time-based delay.
  requestText: string;
}): RequestTraceAssessment {
  const serverSpan: RequestTraceSpan | undefined = findServerSpan({
    spans: data.spans,
    eventSpanId: data.eventSpanId,
  });

  const statusCode: number = serverSpan
    ? readStatusCode(
        readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.statusCode),
      )
    : 0;

  let url: string = serverSpan
    ? readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.url)
    : "";

  if (!url && serverSpan) {
    const path: string = readSpanAttribute(
      serverSpan,
      REQUEST_SPAN_ATTRIBUTE_KEYS.path,
    );
    const query: string = readSpanAttribute(
      serverSpan,
      REQUEST_SPAN_ATTRIBUTE_KEYS.query,
    );

    url = path && query && path.indexOf("?") === -1 ? `${path}?${query}` : path;
  }

  const durationMs: number = serverSpan?.durationMs || 0;

  const database: RequestTraceDatabaseEvidence | undefined =
    findDatabaseEvidence({ spans: data.spans, markers: data.sqlMarkers });

  const delay: number = readRequestedDelaySeconds(data.requestText || url);
  const waitedAsAsked: boolean = didRequestWaitAsAsked({
    requestedDelaySeconds: delay,
    durationMs,
  });

  const exception: RequestTraceException | undefined = data.exceptions[0];
  const failedSpan: boolean = data.spans.some(
    (span: RequestTraceSpan): boolean => {
      return span.statusCode === SPAN_STATUS_ERROR;
    },
  );

  let outcome: SecurityEventRequestOutcome | undefined;

  if (database || waitedAsAsked) {
    outcome = SecurityEventRequestOutcome.ReachedDatabase;
  } else if (statusCode >= 500) {
    outcome = SecurityEventRequestOutcome.Errored;
  } else if (statusCode >= 400) {
    outcome = SecurityEventRequestOutcome.Rejected;
  } else if (statusCode >= 200) {
    outcome =
      exception || failedSpan
        ? SecurityEventRequestOutcome.Errored
        : SecurityEventRequestOutcome.ReachedApp;
  } else if (exception || failedSpan) {
    outcome = SecurityEventRequestOutcome.Errored;
  }

  return {
    outcome,
    serverSpanId: serverSpan?.spanId || "",
    statusCode,
    method: serverSpan
      ? readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.method)
      : "",
    url,
    route: serverSpan
      ? readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.route)
      : "",
    clientAddress: serverSpan
      ? readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.clientAddress)
      : "",
    userAgent: serverSpan
      ? readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.userAgent)
      : "",
    userId: serverSpan
      ? readSpanAttribute(serverSpan, REQUEST_SPAN_ATTRIBUTE_KEYS.userId)
      : "",
    durationMs,
    exception,
    database,
    requestedDelaySeconds: waitedAsAsked ? delay : 0,
  };
}
