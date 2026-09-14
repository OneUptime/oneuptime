import Route from "Common/Types/API/Route";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";

/*
 * Pure helpers behind the exception page's correlation surfaces: the
 * lazy-mounted "Logs" section on the exception detail page (trace-scoped
 * viewer embed or the /telemetry/logs/context fallback), and the
 * per-occurrence replay / logs affordances in the occurrence table. All
 * renderer-free so the App jest suite can exercise them in plain Node.
 */

/** Half-width of the pinned window around one occurrence: ±5 minutes. */
export const EXCEPTION_LOG_WINDOW_MS: number = 5 * 60 * 1000;

/*
 * POST /telemetry/logs/context requires a `logId` and uses it only to
 * exclude that row (`_id != logId`) from the before/after lists. An
 * exception occurrence has no anchor log row, so this sentinel — which no
 * log `_id` can equal — excludes nothing.
 */
export const EXCEPTION_CONTEXT_ANCHOR_LOG_ID: string = "exception-occurrence";

/** Rows fetched per side (before / after); the server caps count at 20. */
export const EXCEPTION_CONTEXT_LOG_COUNT: number = 10;

/*
 * Lenient date coercion for values coming off analytics rows: Date
 * instances, ISO strings and epoch numbers all parse; empty/blank strings
 * are rejected explicitly because `new Date("")` is "now", which would
 * silently re-anchor an old occurrence's window to the present.
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  const parsed: Date = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTrimmedString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export interface OccurrenceLogWindow {
  startTime: Date;
  endTime: Date;
}

type GetOccurrenceLogWindowFunction = (
  occurrenceTime: unknown,
  now?: Date | undefined,
) => OccurrenceLogWindow | null;

/**
 * The pinned window around one occurrence: ±5 minutes, with the end clamped
 * to "now" for a now-adjacent occurrence (logs cannot exist in the future,
 * and a picker showing a future bound reads as a bug). The clamp never pulls
 * the end before the occurrence itself, so a skewed client clock still gets
 * a window that contains the occurrence. Null for an unparseable time.
 */
export const getOccurrenceLogWindow: GetOccurrenceLogWindowFunction = (
  occurrenceTime: unknown,
  now?: Date | undefined,
): OccurrenceLogWindow | null => {
  const occurredAt: Date | null = toDate(occurrenceTime);

  if (!occurredAt) {
    return null;
  }

  const effectiveNow: Date = toDate(now) || new Date();

  const startTime: Date = new Date(
    occurredAt.getTime() - EXCEPTION_LOG_WINDOW_MS,
  );

  let endMs: number = occurredAt.getTime() + EXCEPTION_LOG_WINDOW_MS;

  if (endMs > effectiveNow.getTime()) {
    endMs = Math.max(effectiveNow.getTime(), occurredAt.getTime());
  }

  return { startTime, endTime: new Date(endMs) };
};

export type ExceptionLogsScopeMode = "trace" | "service-window" | "none";

/**
 * Which scope the exception page's Logs section shows: the latest
 * occurrence's whole trace when it has one, the service's logs immediately
 * around the occurrence when it does not, or nothing when neither is
 * derivable.
 */
export interface ExceptionLogsScopePlan {
  mode: ExceptionLogsScopeMode;
  traceId: string | null;
  primaryEntityId: string | null;
  /** Parsed occurrence time (the /logs/context anchor), when parseable. */
  anchorTime: Date | null;
  /** Pinned picker window around the occurrence, when derivable. */
  window: OccurrenceLogWindow | null;
}

type GetExceptionLogsScopePlanFunction = (args: {
  traceId?: string | null | undefined;
  primaryEntityId?: string | null | undefined;
  time?: unknown;
  now?: Date | undefined;
}) => ExceptionLogsScopePlan;

/**
 * Scope-mode selection for the Logs section. A traceId that is present but
 * blank ("" is the default on rows predating tracing) selects the fallback,
 * not an empty trace filter; the fallback additionally needs a parseable
 * occurrence time because /telemetry/logs/context anchors on it.
 */
export const getExceptionLogsScopePlan: GetExceptionLogsScopePlanFunction =
  (args: {
    traceId?: string | null | undefined;
    primaryEntityId?: string | null | undefined;
    time?: unknown;
    now?: Date | undefined;
  }): ExceptionLogsScopePlan => {
    const traceId: string = toTrimmedString(args.traceId);
    const primaryEntityId: string = toTrimmedString(args.primaryEntityId);
    const anchorTime: Date | null = toDate(args.time);
    const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
      args.time,
      args.now,
    );

    if (traceId.length > 0) {
      return {
        mode: "trace",
        traceId,
        primaryEntityId: primaryEntityId.length > 0 ? primaryEntityId : null,
        anchorTime,
        window,
      };
    }

    if (primaryEntityId.length > 0 && anchorTime) {
      return {
        mode: "service-window",
        traceId: null,
        primaryEntityId,
        anchorTime,
        window,
      };
    }

    return {
      mode: "none",
      traceId: null,
      primaryEntityId: null,
      anchorTime: null,
      window: null,
    };
  };

type BuildOccurrenceLogsContextRequestFunction = (args: {
  primaryEntityId: string | null | undefined;
  time: unknown;
  sessionId?: string | null | undefined;
  count?: number | undefined;
}) => JSONObject | null;

/**
 * Request body for POST /telemetry/logs/context (Common/Server/API/
 * TelemetryAPI.ts: logId + primaryEntityId + time required, count capped at
 * 20, optional sessionIds keep the context within one RUM session). Null
 * when the occurrence carries no usable service id or time.
 */
export const buildOccurrenceLogsContextRequest: BuildOccurrenceLogsContextRequestFunction =
  (args: {
    primaryEntityId: string | null | undefined;
    time: unknown;
    sessionId?: string | null | undefined;
    count?: number | undefined;
  }): JSONObject | null => {
    const primaryEntityId: string = toTrimmedString(args.primaryEntityId);
    const anchorTime: Date | null = toDate(args.time);

    if (primaryEntityId.length === 0 || !anchorTime) {
      return null;
    }

    let count: number = EXCEPTION_CONTEXT_LOG_COUNT;

    if (
      typeof args.count === "number" &&
      Number.isFinite(args.count) &&
      args.count >= 1
    ) {
      count = Math.min(Math.floor(args.count), 20);
    }

    const request: JSONObject = {
      logId: EXCEPTION_CONTEXT_ANCHOR_LOG_ID,
      primaryEntityId,
      time: anchorTime.toISOString(),
      count,
    };

    const sessionId: string = toTrimmedString(args.sessionId);

    if (sessionId.length > 0) {
      request["sessionIds"] = [sessionId];
    }

    return request;
  };

export interface OccurrenceContextLogRow {
  section: "before" | "after";
  time: string;
  severityText: string;
  body: string;
  traceId: string;
  spanId: string;
}

function parseContextRows(
  rows: unknown,
  section: "before" | "after",
): Array<OccurrenceContextLogRow> {
  if (!Array.isArray(rows)) {
    return [];
  }

  const parsed: Array<OccurrenceContextLogRow> = [];

  for (const row of rows as JSONArray) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const record: JSONObject = row as JSONObject;

    parsed.push({
      section,
      time: toTrimmedString(record["time"]),
      severityText: toTrimmedString(record["severityText"]),
      body:
        record["body"] === null || record["body"] === undefined
          ? ""
          : String(record["body"]),
      traceId: toTrimmedString(record["traceId"]),
      spanId: toTrimmedString(record["spanId"]),
    });
  }

  return parsed;
}

type ParseLogsContextResponseFunction = (
  response: JSONObject | null | undefined,
) => Array<OccurrenceContextLogRow>;

/**
 * Flatten a /telemetry/logs/context response into one chronological list
 * (the server already returns `before` oldest-first and `after`
 * oldest-first). Malformed rows are skipped rather than crashing the panel.
 */
export const parseLogsContextResponse: ParseLogsContextResponseFunction = (
  response: JSONObject | null | undefined,
): Array<OccurrenceContextLogRow> => {
  if (!response || typeof response !== "object") {
    return [];
  }

  return [
    ...parseContextRows(response["before"], "before"),
    ...parseContextRows(response["after"], "after"),
  ];
};

type GetReplayAnchorOffsetMsFunction = (
  occurrenceTime: unknown,
  sessionStartTime: unknown,
) => number | null;

/**
 * Offset of one occurrence within its session recording, for ReplayLink's
 * `atOffsetMs`. Clamped to zero for an occurrence stamped before the
 * recording started; null when either time is unparseable so callers fall
 * back to linking the session start instead of a bogus moment.
 */
export const getReplayAnchorOffsetMs: GetReplayAnchorOffsetMsFunction = (
  occurrenceTime: unknown,
  sessionStartTime: unknown,
): number | null => {
  const occurredAt: Date | null = toDate(occurrenceTime);
  const sessionStart: Date | null = toDate(sessionStartTime);

  if (!occurredAt || !sessionStart) {
    return null;
  }

  return Math.max(0, occurredAt.getTime() - sessionStart.getTime());
};

type CollectDistinctSessionIdsFunction = (
  rows:
    | Array<{ sessionId?: string | undefined } | null | undefined>
    | null
    | undefined,
) => Array<string>;

/**
 * Distinct non-blank session ids across one page of occurrence rows, in
 * first-appearance order — the batch key set for the RumSession anchor
 * lookup. Blank ids ('' is the pre-recorder default) carry no session.
 */
export const collectDistinctSessionIds: CollectDistinctSessionIdsFunction = (
  rows:
    | Array<{ sessionId?: string | undefined } | null | undefined>
    | null
    | undefined,
): Array<string> => {
  if (!rows || !Array.isArray(rows)) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const sessionIds: Array<string> = [];

  for (const row of rows) {
    const sessionId: string = toTrimmedString(row?.sessionId);

    if (sessionId.length === 0 || seen.has(sessionId)) {
      continue;
    }

    seen.add(sessionId);
    sessionIds.push(sessionId);
  }

  return sessionIds;
};

/**
 * What a replay link needs beyond the occurrence row itself: the
 * application the session lives in, and the recording's start time to
 * translate the occurrence's absolute timestamp into a playback offset.
 */
export interface RumSessionAnchor {
  rumApplicationId: string;
  startTime: Date | null;
}

type BuildRumSessionAnchorMapFunction = (
  sessions:
    | Array<
        | {
            sessionId?: string | undefined;
            rumApplicationId?: string | undefined;
            startTime?: unknown;
          }
        | null
        | undefined
      >
    | null
    | undefined,
) => Map<string, RumSessionAnchor>;

/**
 * Index a RumSession lookup result by session id. Rows without a session id
 * or an application id cannot anchor a link and are skipped; the first row
 * per session id wins. A missing/unparseable startTime keeps the anchor
 * (the link still works, it just starts at the beginning).
 */
export const buildRumSessionAnchorMap: BuildRumSessionAnchorMapFunction = (
  sessions:
    | Array<
        | {
            sessionId?: string | undefined;
            rumApplicationId?: string | undefined;
            startTime?: unknown;
          }
        | null
        | undefined
      >
    | null
    | undefined,
): Map<string, RumSessionAnchor> => {
  const anchors: Map<string, RumSessionAnchor> = new Map<
    string,
    RumSessionAnchor
  >();

  if (!sessions || !Array.isArray(sessions)) {
    return anchors;
  }

  for (const session of sessions) {
    const sessionId: string = toTrimmedString(session?.sessionId);
    const rumApplicationId: string = toTrimmedString(session?.rumApplicationId);

    if (
      sessionId.length === 0 ||
      rumApplicationId.length === 0 ||
      anchors.has(sessionId)
    ) {
      continue;
    }

    anchors.set(sessionId, {
      rumApplicationId,
      startTime: toDate(session?.startTime),
    });
  }

  return anchors;
};

export interface OccurrenceLogsLink {
  route: Route;
  /**
   * Scope fields the logs-explorer grammar could not express (serializer
   * `dropped` names). Empty for this scope shape in practice, but surfaced
   * so a future scope field is never silently hidden.
   */
  dropped: Array<string>;
}

type BuildOccurrenceLogsExplorerLinkFunction = (args: {
  logsRoute: Route;
  traceId: string | null | undefined;
  time: unknown;
  now?: Date | undefined;
}) => OccurrenceLogsLink | null;

/**
 * Deep link from one occurrence row to the logs explorer, scoped to that
 * occurrence's trace and pinned to the ±5 minute window around it. Param
 * values are pre-encoded because Route rejects raw quotes/spaces (the JSON
 * `filters` value contains both) and the logs explorer reads params through
 * URLSearchParams, which decodes exactly once. Null when the row carries no
 * trace; an unparseable time still links, just without the pinned window.
 */
export const buildOccurrenceLogsExplorerLink: BuildOccurrenceLogsExplorerLinkFunction =
  (args: {
    logsRoute: Route;
    traceId: string | null | undefined;
    time: unknown;
    now?: Date | undefined;
  }): OccurrenceLogsLink | null => {
    const traceId: string = toTrimmedString(args.traceId);

    if (traceId.length === 0) {
      return null;
    }

    const window: OccurrenceLogWindow | null = getOccurrenceLogWindow(
      args.time,
      args.now,
    );

    const scope: TelemetryCrossSignalScope = {
      traceIds: [traceId],
      ...(window
        ? { startTime: window.startTime, endTime: window.endTime }
        : {}),
    };

    const serialized: CrossSignalQueryParams = toLogsExplorerQueryParams(scope);

    /*
     * Route validates its characters and throws on anything outside its
     * whitelist (encodeURIComponent leaves e.g. "~" bare, which Route
     * rejects). This builder runs per table row, so a malformed id must
     * yield "no link", never an exception out of a cell renderer.
     */
    try {
      const route: Route = new Route(args.logsRoute.toString());
      const encodedParams: Record<string, string> = {};

      for (const paramName of Object.keys(serialized.params)) {
        encodedParams[paramName] = encodeURIComponent(
          serialized.params[paramName] as string,
        );
      }

      route.addQueryParams(encodedParams);

      return { route, dropped: serialized.dropped };
    } catch {
      return null;
    }
  };

/*
 * How far outside a recording's own [start, end] an occurrence may fall and
 * still be treated as "in this session". The occurrence is stamped by the
 * telemetry SDK's clock and the recording by the ingest clock; the manifest
 * carries clockSkewMs precisely because they disagree, and the server
 * clamps that skew, so a minute covers the honest cases without letting an
 * occurrence from a different visit claim this recording.
 */
export const REPLAY_CARD_MOMENT_TOLERANCE_MS: number = 60 * 1000;

export interface ReplayCardMoment {
  /* Unix ms of the occurrence, to be handed to the route builder as `at`. */
  errorTimeUnixMs: number;
}

export interface ReplayCardMomentArgs {
  /* The occurrence the page is showing (latest instance or the row). */
  errorTimeUnixMs: number | null | undefined;
  /* The session THAT occurrence carries; '' on rows predating the recorder. */
  instanceSessionId: string | null | undefined;
  /* The session the card is about to link to. */
  session: {
    sessionId: string | null | undefined;
    startTime?: unknown;
    endTime?: unknown;
    durationMs?: number | null | undefined;
  };
}

type GetReplayCardMomentFunction = (
  args: ReplayCardMomentArgs,
) => ReplayCardMoment | null;

/**
 * Whether the card may promise "N seconds before the error" for a session.
 *
 * The /for-exception list is ordered newest-first and an exception group's
 * latest occurrence is the newest ExceptionInstance; those coincide only by
 * luck, so pairing one instance's time with another session's start
 * produced a confident link to the wrong moment (correlation-1). A moment
 * is claimed only when the occurrence names this very session AND its time
 * lies inside the recording (with skew tolerance); otherwise the caller
 * links the session without a moment and says so.
 */
export const getReplayCardMoment: GetReplayCardMomentFunction = (
  args: ReplayCardMomentArgs,
): ReplayCardMoment | null => {
  const errorTimeUnixMs: number | null | undefined = args.errorTimeUnixMs;

  if (
    typeof errorTimeUnixMs !== "number" ||
    !Number.isFinite(errorTimeUnixMs) ||
    errorTimeUnixMs <= 0
  ) {
    return null;
  }

  const instanceSessionId: string = toTrimmedString(args.instanceSessionId);
  const sessionId: string = toTrimmedString(args.session.sessionId);

  if (
    instanceSessionId.length === 0 ||
    sessionId.length === 0 ||
    instanceSessionId !== sessionId
  ) {
    return null;
  }

  const startTime: Date | null = toDate(args.session.startTime);

  /*
   * Without a start there is nothing to check against; the ids matched, so
   * the moment is trusted and the player clamps it against the manifest.
   */
  if (!startTime) {
    return { errorTimeUnixMs };
  }

  if (errorTimeUnixMs < startTime.getTime() - REPLAY_CARD_MOMENT_TOLERANCE_MS) {
    return null;
  }

  let endMs: number | null = null;
  const endTime: Date | null = toDate(args.session.endTime);

  if (endTime) {
    endMs = endTime.getTime();
  } else if (
    typeof args.session.durationMs === "number" &&
    Number.isFinite(args.session.durationMs) &&
    args.session.durationMs > 0
  ) {
    endMs = startTime.getTime() + args.session.durationMs;
  }

  /* An open recording (no end yet) accepts any occurrence after its start. */
  if (
    endMs !== null &&
    errorTimeUnixMs > endMs + REPLAY_CARD_MOMENT_TOLERANCE_MS
  ) {
    return null;
  }

  return { errorTimeUnixMs };
};

/* Longest label an exception group gets in a link; the rest is a tooltip. */
export const EXCEPTION_GROUP_LABEL_MAX_LENGTH: number = 120;

/* How many characters of a fingerprint are shown when nothing better exists. */
export const EXCEPTION_FINGERPRINT_SHORT_LENGTH: number = 12;

export interface ExceptionGroupSummary {
  /* TelemetryException id, when the group row was resolved. */
  id?: string | null | undefined;
  fingerprint?: string | null | undefined;
  exceptionType?: string | null | undefined;
  message?: string | null | undefined;
}

type GetExceptionGroupLabelFunction = (
  group: ExceptionGroupSummary | null | undefined,
  fingerprint?: string | null | undefined,
) => string;

/**
 * Human label for an exception group: "TypeError: x is not a function",
 * falling back to whichever half exists, and to the first characters of the
 * fingerprint only when nothing was resolved. A viewer should read an
 * error, never a hash (correlation-7).
 */
export const getExceptionGroupLabel: GetExceptionGroupLabelFunction = (
  group: ExceptionGroupSummary | null | undefined,
  fingerprint?: string | null | undefined,
): string => {
  const exceptionType: string = toTrimmedString(group?.exceptionType);
  const message: string = toTrimmedString(group?.message).split("\n")[0] || "";

  let label: string = "";

  if (exceptionType.length > 0 && message.length > 0) {
    label = `${exceptionType}: ${message}`;
  } else if (exceptionType.length > 0) {
    label = exceptionType;
  } else if (message.length > 0) {
    label = message;
  }

  if (label.length > EXCEPTION_GROUP_LABEL_MAX_LENGTH) {
    label = `${label.slice(0, EXCEPTION_GROUP_LABEL_MAX_LENGTH - 1)}…`;
  }

  if (label.length > 0) {
    return label;
  }

  const resolvedFingerprint: string =
    toTrimmedString(fingerprint) || toTrimmedString(group?.fingerprint);

  if (resolvedFingerprint.length === 0) {
    return "Unknown error";
  }

  return resolvedFingerprint.length > EXCEPTION_FINGERPRINT_SHORT_LENGTH
    ? `Error ${resolvedFingerprint.slice(0, EXCEPTION_FINGERPRINT_SHORT_LENGTH)}…`
    : `Error ${resolvedFingerprint}`;
};

export interface ExceptionGroupLink {
  route: Route;
  label: string;
  /* True when the link opens the exception itself, not a filtered list. */
  isDirect: boolean;
}

export interface BuildExceptionGroupLinkArgs {
  fingerprint: string | null | undefined;
  /* The group row when it was resolved (id, type, message). */
  group?: ExceptionGroupSummary | null | undefined;
  /* Populated EXCEPTIONS_UNRESOLVED route, the filtered-list fallback. */
  exceptionsListRoute: Route;
  /*
   * Builds the exception view route for a TelemetryException id. Passed in
   * because this module stays free of RouteMap (it reads `window` on load),
   * so the App jest suite can run it in plain Node.
   */
  exceptionViewRouteForId?: ((id: string) => Route) | undefined;
}

type BuildExceptionGroupLinkFunction = (
  args: BuildExceptionGroupLinkArgs,
) => ExceptionGroupLink | null;

/**
 * A link for one correlated exception group. Direct to the exception page
 * when the group was resolved to a TelemetryException id and the caller
 * can build that route; otherwise the list page filtered to the
 * fingerprint (the pre-existing hop). Null only when there is neither a
 * fingerprint nor an id to link with.
 */
export const buildExceptionGroupLink: BuildExceptionGroupLinkFunction = (
  args: BuildExceptionGroupLinkArgs,
): ExceptionGroupLink | null => {
  const fingerprint: string =
    toTrimmedString(args.fingerprint) ||
    toTrimmedString(args.group?.fingerprint);
  const groupId: string = toTrimmedString(args.group?.id);
  const label: string = getExceptionGroupLabel(args.group, fingerprint);

  if (groupId.length > 0 && args.exceptionViewRouteForId) {
    try {
      return {
        route: args.exceptionViewRouteForId(groupId),
        label,
        isDirect: true,
      };
    } catch {
      // Fall through to the list route below.
    }
  }

  if (fingerprint.length === 0) {
    return null;
  }

  const route: Route = new Route(args.exceptionsListRoute.toString());

  /*
   * Same grammar as TraceCorrelatedSignals.buildExceptionsGroupRoute: the
   * list's search DSL compiles `@fingerprint:<value>` to an exact filter,
   * and status=all + the widest relative range keep resolved or long-quiet
   * groups from being filtered out on arrival.
   */
  try {
    route.addQueryParams({
      search: encodeURIComponent(`@fingerprint:${fingerprint}`),
      status: "all",
      range: encodeURIComponent("Past 3 Months"),
    });
  } catch {
    return null;
  }

  return { route, label, isDirect: false };
};

type IndexExceptionGroupsByFingerprintFunction = (
  rows:
    | Array<
        | {
            id?: unknown;
            _id?: unknown;
            fingerprint?: unknown;
            exceptionType?: unknown;
            message?: unknown;
          }
        | null
        | undefined
      >
    | null
    | undefined,
) => Map<string, ExceptionGroupSummary>;

/**
 * Index a TelemetryException lookup result by fingerprint, so a batch of
 * bare fingerprints (a session header's exceptionFingerprints) resolves to
 * labels and ids in one pass. The first row per fingerprint wins; rows
 * without a fingerprint cannot be matched and are skipped.
 */
export const indexExceptionGroupsByFingerprint: IndexExceptionGroupsByFingerprintFunction =
  (
    rows:
      | Array<
          | {
              id?: unknown;
              _id?: unknown;
              fingerprint?: unknown;
              exceptionType?: unknown;
              message?: unknown;
            }
          | null
          | undefined
        >
      | null
      | undefined,
  ): Map<string, ExceptionGroupSummary> => {
    const index: Map<string, ExceptionGroupSummary> = new Map<
      string,
      ExceptionGroupSummary
    >();

    if (!rows || !Array.isArray(rows)) {
      return index;
    }

    for (const row of rows) {
      const fingerprint: string = toTrimmedString(row?.fingerprint);

      if (fingerprint.length === 0 || index.has(fingerprint)) {
        continue;
      }

      const id: string = toTrimmedString(row?.id) || toTrimmedString(row?._id);

      index.set(fingerprint, {
        id: id.length > 0 ? id : null,
        fingerprint,
        exceptionType: toTrimmedString(row?.exceptionType) || null,
        message: toTrimmedString(row?.message) || null,
      });
    }

    return index;
  };
