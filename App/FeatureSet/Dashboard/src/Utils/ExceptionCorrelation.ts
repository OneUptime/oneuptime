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
