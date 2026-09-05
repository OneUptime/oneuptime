/*
 * The unified signal shape the rail renders: one row type for everything
 * the recording captured AND everything the backend logged, traced or
 * threw for the same session, all on the session clock.
 *
 * Types only, plus the id helpers. The adapters that build signals
 * (Rail/ReplaySignals.ts), the fetchers (Rail/ReplayBackendSignals.ts)
 * and the clock alignment (Rail/ReplayClockAlignment.ts) all import from
 * here so the rail, the timeline markers, the URL (?signal=) and the
 * keyboard map agree on one vocabulary.
 *
 * ID CONVENTIONS. A signal id is stable across re-renders, chunk
 * re-fetches and page reloads, because it is what ?signal= addresses:
 *
 *   rec:<chunkIndex>:<ordinal>   a row lifted from the recording; ordinal
 *                                is the row's position among the custom
 *                                events extracted from that chunk, in
 *                                stream order (ChunkLoader assigns it)
 *   log:<logId>                  a Log row's _id
 *   span:<spanId>                a Span row's spanId (one row per TRACE in
 *                                the Traces tab uses the root span's id)
 *   exc:<exceptionInstanceId>    an ExceptionInstance row's _id
 */

export type ReplaySignalKind =
  | "console"
  | "network"
  | "navigation"
  | "interaction"
  | "frustration"
  | "performance"
  | "client-error"
  | "server-error"
  | "log"
  | "span"
  | "custom"
  | "marker";

export type ReplaySignalSource = "recording" | "telemetry";

export type ReplaySignalSeverity = "info" | "warn" | "error" | "success";

/*
 * How well a signal's offset is known on the session clock.
 *
 *   exact       recording signals: chunk offset + within-chunk delta
 *   anchored    telemetry rows shifted by a delta agreed by >= 2 trace pairs
 *   unanchored  telemetry rows placed by server time alone; uncertainty
 *               is shown on the row and the marker is drawn hollow
 */
export type ReplaySignalAlignment = "exact" | "anchored" | "unanchored";

/* Cross-references a row can offer as links out. All optional. */
export interface ReplaySignalLinks {
  traceId?: string;
  spanId?: string;
  logId?: string;
  exceptionFingerprint?: string;
  exceptionInstanceId?: string;
}

export interface ReplaySignal {
  id: string;
  kind: ReplaySignalKind;
  source: ReplaySignalSource;
  /* Session clock, milliseconds from header.startTimeUnixMs. */
  offsetMs: number;
  /* Set for spans (a trace is active for its whole duration). */
  endOffsetMs?: number;
  severity: ReplaySignalSeverity;
  /* One line: "POST 500 /api/orders", "[ERROR] payment-svc charge failed". */
  title: string;
  /* Right-hand meta: "220ms 1.2KB", the service name, the level. */
  subtitle?: string;
  /* Recording signals only: which chunk the row came from. */
  chunkIndex?: number;
  links: ReplaySignalLinks;
  /* Kind-specific fields for the inline detail; rendered by kind. */
  detail: Record<string, unknown>;
  alignment?: ReplaySignalAlignment;
}

/* The rail's tabs. "all" merges every kind. */
export type ReplayRailTabId =
  | "all"
  | "console"
  | "network"
  | "navigation"
  | "interactions"
  | "performance"
  | "errors"
  | "logs"
  | "traces";

export const REPLAY_RAIL_TAB_IDS: ReadonlyArray<ReplayRailTabId> = [
  "all",
  "console",
  "network",
  "navigation",
  "interactions",
  "performance",
  "errors",
  "logs",
  "traces",
];

/* Which signal kinds each tab shows. "errors" merges client and server. */
export const REPLAY_RAIL_TAB_KINDS: Record<
  ReplayRailTabId,
  ReadonlyArray<ReplaySignalKind>
> = {
  all: [
    "console",
    "network",
    "navigation",
    "interaction",
    "frustration",
    "performance",
    "client-error",
    "server-error",
    "log",
    "span",
    "custom",
    "marker",
  ],
  console: ["console"],
  network: ["network"],
  navigation: ["navigation", "marker"],
  interactions: ["interaction", "frustration", "custom"],
  performance: ["performance"],
  errors: ["client-error", "server-error"],
  logs: ["log"],
  traces: ["span"],
};

/*
 * How telemetry rows are placed on the session clock.
 *
 * Baseline: offsetMs = rowUnixMs - header.startTimeUnixMs, deliberately
 * NOT adjusted by clockSkewMs (that is a client-vs-server delta and only
 * applies to client-stamped values). Trace anchoring refines it: each
 * recording network row with a traceId is paired with the earliest span
 * of that trace and deltaMs = median(spanStart - (startTime + offset)).
 */
export interface ReplayClockAlignmentState {
  /*
   *   pending     no telemetry loaded yet, nothing to align
   *   anchored    >= 2 pairs agreed within the tolerance; delta applied
   *   unanchored  too few or disagreeing pairs; baseline used, uncertainty shown
   */
  status: "pending" | "anchored" | "unanchored";
  /* Milliseconds added to telemetry baselines; 0 when unanchored. */
  deltaMs: number;
  /* Trace pairs that contributed. */
  pairCount: number;
  /* +-window shown on unanchored rows: |clockSkewMs| + ingest lag. */
  uncertaintyMs: number;
}

/* Anchoring needs this many agreeing pairs before it is trusted. */
export const REPLAY_CLOCK_ANCHOR_MIN_PAIRS: number = 2;

/* Pairs must agree within this to count as agreeing. */
export const REPLAY_CLOCK_ANCHOR_TOLERANCE_MS: number = 2 * 1000;

/* A delta beyond this is a wrong pairing, not clock skew; stay unanchored. */
export const REPLAY_CLOCK_ANCHOR_MAX_DELTA_MS: number = 5 * 60 * 1000;

/* The backend data sets the rail fetches lazily, one per telemetry tab. */
export type ReplayBackendSignalKind = "log" | "span" | "exception";

/*
 *   idle      not requested yet (the tab was never opened)
 *   loading   request in flight
 *   ready     rows loaded (possibly zero, possibly truncated)
 *   locked    403: the caller lacks the model's read permission
 *   error     request failed; retryable
 */
export type ReplayBackendSignalsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "locked"
  | "error";

export interface ReplayBackendSignalsSlot {
  status: ReplayBackendSignalsStatus;
  /* null until a fetch completes; never a claimed 0 before that. */
  rowCount: number | null;
  /* The fetch hit its row cap; the scope toggle defaults to +-30s. */
  isTruncated: boolean;
  /* For "locked": the permission name to show. */
  lockedPermission?: string;
  /* For "error": domain copy. */
  errorMessage?: string;
  /* When the rows were fetched, for the 60s live refresh. */
  fetchedAtUnixMs: number | null;
}

export type ReplayBackendSignalsState = Record<
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot
>;

export function makeIdleBackendSignalsSlot(): ReplayBackendSignalsSlot {
  return {
    status: "idle",
    rowCount: null,
    isTruncated: false,
    fetchedAtUnixMs: null,
  };
}

/* Row cap per backend fetch; over it the slot is flagged truncated. */
export const REPLAY_BACKEND_SIGNALS_ROW_LIMIT: number = 500;

/* ---- Signal id helpers. ---- */

export const REPLAY_SIGNAL_ID_PREFIX_RECORDING: string = "rec";
export const REPLAY_SIGNAL_ID_PREFIX_LOG: string = "log";
export const REPLAY_SIGNAL_ID_PREFIX_SPAN: string = "span";
export const REPLAY_SIGNAL_ID_PREFIX_EXCEPTION: string = "exc";

export type ParsedReplaySignalId =
  | { source: "rec"; chunkIndex: number; ordinal: number }
  | { source: "log"; id: string }
  | { source: "span"; id: string }
  | { source: "exc"; id: string };

export function makeRecordingSignalId(
  chunkIndex: number,
  ordinal: number,
): string {
  return `${REPLAY_SIGNAL_ID_PREFIX_RECORDING}:${chunkIndex}:${ordinal}`;
}

export function makeLogSignalId(logId: string): string {
  return `${REPLAY_SIGNAL_ID_PREFIX_LOG}:${logId}`;
}

export function makeSpanSignalId(spanId: string): string {
  return `${REPLAY_SIGNAL_ID_PREFIX_SPAN}:${spanId}`;
}

export function makeExceptionSignalId(instanceId: string): string {
  return `${REPLAY_SIGNAL_ID_PREFIX_EXCEPTION}:${instanceId}`;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/*
 * Parse a signal id (from ?signal=, so it is untrusted). Returns null for
 * anything that is not one of the four shapes above; a recording id needs
 * two non-negative integers, a telemetry id a non-empty tail (ids may
 * themselves contain ":" - the tail is taken whole).
 */
export function parseReplaySignalId(id: string): ParsedReplaySignalId | null {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  const separatorIndex: number = id.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === id.length - 1) {
    return null;
  }

  const prefix: string = id.slice(0, separatorIndex);
  const tail: string = id.slice(separatorIndex + 1);

  if (prefix === REPLAY_SIGNAL_ID_PREFIX_RECORDING) {
    const parts: Array<string> = tail.split(":");

    if (parts.length !== 2) {
      return null;
    }

    const chunkIndex: number = Number(parts[0]);
    const ordinal: number = Number(parts[1]);

    if (
      parts[0] === "" ||
      parts[1] === "" ||
      !isNonNegativeInteger(chunkIndex) ||
      !isNonNegativeInteger(ordinal)
    ) {
      return null;
    }

    return { source: "rec", chunkIndex: chunkIndex, ordinal: ordinal };
  }

  if (prefix === REPLAY_SIGNAL_ID_PREFIX_LOG) {
    return { source: "log", id: tail };
  }

  if (prefix === REPLAY_SIGNAL_ID_PREFIX_SPAN) {
    return { source: "span", id: tail };
  }

  if (prefix === REPLAY_SIGNAL_ID_PREFIX_EXCEPTION) {
    return { source: "exc", id: tail };
  }

  return null;
}

/* ---- Telemetry placement (added by WP-P4a, additive). ---- */

/*
 * What a telemetry adapter (fromLogRow / fromSpanRow / fromExceptionRow)
 * needs to put a server-stamped row on the session clock: the clock's
 * zero and the current anchoring state. Service names are optional
 * because Log/Span/ExceptionInstance rows carry only primaryEntityId; the
 * rail resolves ids to names once per page and passes the map through so
 * a row can read "payment-svc" instead of an ObjectID.
 */
export interface ReplayTelemetryClock {
  /* header.startTimeUnixMs, server-clamped. */
  startTimeUnixMs: number;
  alignment: ReplayClockAlignmentState;
  /* primaryEntityId (as a string) -> display name. Absent = show nothing. */
  serviceNameById?: Record<string, string> | undefined;
}
