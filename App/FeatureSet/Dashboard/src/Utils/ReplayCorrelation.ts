import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import OneUptimeDate from "Common/Types/Date";
import TimeRange from "Common/Types/Time/TimeRange";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import Text from "Common/Types/Text";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import { buildExceptionsGroupRoute } from "./TraceCorrelatedSignals";

/*
 * Pure helpers behind the session replay rail's backend tabs (Logs / Traces /
 * Errors), the details panel's exception-fingerprint links, and the "open
 * logs at this moment" pivot. Renderer-free so the App jest suite can
 * exercise them in plain Node; anything needing RouteMap (the exceptions
 * list route, the logs explorer route) takes the populated Route as an
 * argument instead of importing it, which keeps this module loadable
 * without browser stubs.
 */

/*
 * The recording window is padded on both sides before it bounds the Logs /
 * Errors tabs: backend rows are stamped with server receive time, which can
 * trail the client-side session bounds by ingest lag plus the session's own
 * (server-clamped) clock skew. Same ±5 minutes the trace explorer pads its
 * metric-link windows with.
 */
export const REPLAY_SESSION_WINDOW_PADDING_MS: number = 5 * 60 * 1000;

function parseManifestTime(value: string | null | undefined): Date | null {
  const trimmed: string = (value || "").trim();

  if (trimmed.length === 0) {
    return null;
  }

  const parsed: Date = new Date(trimmed);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type GetReplaySessionWindowFunction = (args: {
  startTime: string;
  endTime: string;
  now?: Date | undefined;
}) => InBetween<Date> | null;

/**
 * The padded time window one replay session's backend signals live in, from
 * the manifest header's ISO start/end strings. A missing or unparseable end
 * means the session is still open (or the finalizer has not sealed it), so
 * the window runs to "now"; a missing start means there is no moment to
 * anchor on at all and null is returned so callers fall back to an unbounded
 * session-id filter instead of pinning a made-up window. A malformed
 * end-before-start pair is clamped to the start so the returned window's
 * start is never after its end.
 */
export const getReplaySessionWindow: GetReplaySessionWindowFunction = (args: {
  startTime: string;
  endTime: string;
  now?: Date | undefined;
}): InBetween<Date> | null => {
  const start: Date | null = parseManifestTime(args.startTime);

  if (!start) {
    return null;
  }

  let end: Date = parseManifestTime(args.endTime) || args.now || new Date();

  if (end.getTime() < start.getTime()) {
    end = start;
  }

  return new InBetween<Date>(
    new Date(start.getTime() - REPLAY_SESSION_WINDOW_PADDING_MS),
    new Date(end.getTime() + REPLAY_SESSION_WINDOW_PADDING_MS),
  );
};

type BuildReplaySessionLogsQueryFunction = (
  window: InBetween<Date> | null,
) => Query<Log>;

/**
 * The logQuery for the panel's embedded logs viewer. Only the pinned window
 * rides here — the session filter itself goes through the viewer's
 * sessionIds prop so the histogram / facets / analytics endpoints cover the
 * same rows as the list. The `time` key is what
 * TelemetryQueryTimeRange.getPinnedRangeForQuery reads to pin the picker to
 * the session's moment instead of a rolling "past 1 hour".
 */
export const buildReplaySessionLogsQuery: BuildReplaySessionLogsQueryFunction =
  (window: InBetween<Date> | null): Query<Log> => {
    if (!window) {
      return {};
    }

    return { time: window } as Query<Log>;
  };

type BuildReplaySessionExceptionsQueryFunction = (args: {
  sessionId: string;
  window: InBetween<Date> | null;
}) => Query<ExceptionInstance> | null;

/**
 * The query for the panel's Errors tab: exception instances stamped with
 * this session's id, bounded to the padded session window when one exists.
 * Null for a blank session id — an unscoped query would silently show every
 * exception in the project under a heading claiming they belong to one
 * session, so the host renders nothing instead.
 */
export const buildReplaySessionExceptionsQuery: BuildReplaySessionExceptionsQueryFunction =
  (args: {
    sessionId: string;
    window: InBetween<Date> | null;
  }): Query<ExceptionInstance> | null => {
    const sessionId: string = (args.sessionId || "").trim();

    if (sessionId.length === 0) {
      return null;
    }

    const query: Query<ExceptionInstance> = {
      sessionId: sessionId,
    } as Query<ExceptionInstance>;

    if (args.window) {
      (query as Record<string, unknown>)["time"] = args.window;
    }

    return query;
  };

type BuildReplaySessionSpansQueryFunction = (args: {
  sessionId: string;
  window: InBetween<Date> | null;
}) => Query<Span> | null;

/**
 * The query for the rail's Traces tab: spans stamped with this session's id
 * (Span.sessionId, which the recorder's own network instrumentation and a
 * correctly wired OpenTelemetry SDK both set), bounded to the padded session
 * window when one exists, on the span's startTime. Null for a blank session
 * id for the same reason as the exceptions query: an unscoped span query
 * under a "this session" heading would be a lie.
 */
export const buildReplaySessionSpansQuery: BuildReplaySessionSpansQueryFunction =
  (args: {
    sessionId: string;
    window: InBetween<Date> | null;
  }): Query<Span> | null => {
    const sessionId: string = (args.sessionId || "").trim();

    if (sessionId.length === 0) {
      return null;
    }

    const query: Query<Span> = {
      sessionId: sessionId,
    } as Query<Span>;

    if (args.window) {
      (query as Record<string, unknown>)["startTime"] = args.window;
    }

    return query;
  };

/*
 * Half-width of the window an "open logs at this moment" pivot asks for.
 * Thirty seconds each side is enough to see what the backend did around a
 * click without drowning the moment in the rest of the session.
 */
export const REPLAY_LOGS_MOMENT_HALF_WINDOW_MS: number = 30 * 1000;

type GetReplayMomentWindowFunction = (args: {
  momentUnixMs: number;
  halfWindowMs?: number | undefined;
}) => InBetween<Date> | null;

/**
 * The +-window around one absolute moment. Null for a moment that is not a
 * finite positive timestamp (a playhead with no known session start), so a
 * caller builds no link rather than a link to 1970.
 */
export const getReplayMomentWindow: GetReplayMomentWindowFunction = (args: {
  momentUnixMs: number;
  halfWindowMs?: number | undefined;
}): InBetween<Date> | null => {
  if (!Number.isFinite(args.momentUnixMs) || args.momentUnixMs <= 0) {
    return null;
  }

  const halfWindowMs: number =
    typeof args.halfWindowMs === "number" &&
    Number.isFinite(args.halfWindowMs) &&
    args.halfWindowMs >= 0
      ? args.halfWindowMs
      : REPLAY_LOGS_MOMENT_HALF_WINDOW_MS;

  return new InBetween<Date>(
    new Date(args.momentUnixMs - halfWindowMs),
    new Date(args.momentUnixMs + halfWindowMs),
  );
};

export interface ReplayLogsAtMomentArgs {
  sessionId: string;
  /* Absolute: header.startTimeUnixMs + the playhead offset. */
  momentUnixMs: number;
  halfWindowMs?: number | undefined;
}

type BuildReplayLogsAtMomentQueryParamsFunction = (
  args: ReplayLogsAtMomentArgs,
) => Dictionary<string> | null;

/**
 * The logs explorer's own URL grammar for "this session, around this
 * moment": a `filters` tuple list (the shape LogsViewer.readInitialUrlState
 * JSON.parses back into its facet map, where a single-valued key compiles to
 * an equality on that Log column - here `sessionId`) plus the
 * range=Custom/start/end triple the same reader turns into a pinned window.
 * The window is what makes the link land on the moment instead of on
 * "past 1 hour" with the session filter applied to the wrong hour.
 *
 * Null without a session id or a usable moment: a link that would show every
 * log in the project under a session heading is worse than no link.
 */
export const buildReplayLogsAtMomentQueryParams: BuildReplayLogsAtMomentQueryParamsFunction =
  (args: ReplayLogsAtMomentArgs): Dictionary<string> | null => {
    const sessionId: string = (args.sessionId || "").trim();

    if (sessionId.length === 0) {
      return null;
    }

    const window: InBetween<Date> | null = getReplayMomentWindow({
      momentUnixMs: args.momentUnixMs,
      halfWindowMs: args.halfWindowMs,
    });

    if (!window) {
      return null;
    }

    return {
      filters: JSON.stringify([["sessionId", [sessionId]]]),
      range: TimeRange.CUSTOM,
      start: OneUptimeDate.toString(window.startValue),
      end: OneUptimeDate.toString(window.endValue),
    };
  };

type BuildReplayLogsAtMomentRouteFunction = (
  args: ReplayLogsAtMomentArgs & { logsExplorerRoute: Route },
) => Route | null;

/**
 * The logs explorer route scoped to one session around one moment. Takes
 * the populated explorer route (RouteUtil.populateRouteParams(RouteMap[
 * PageMap.LOGS])) rather than importing RouteMap - see the module comment.
 * Values are encoded here because Route.addQueryParams appends verbatim.
 */
export const buildReplayLogsAtMomentRoute: BuildReplayLogsAtMomentRouteFunction =
  (
    args: ReplayLogsAtMomentArgs & { logsExplorerRoute: Route },
  ): Route | null => {
    const params: Dictionary<string> | null =
      buildReplayLogsAtMomentQueryParams(args);

    if (!params) {
      return null;
    }

    const encoded: Dictionary<string> = {};

    for (const key of Object.keys(params)) {
      encoded[key] = encodeURIComponent(params[key] as string);
    }

    try {
      return new Route(args.logsExplorerRoute.toString()).addQueryParams(
        encoded,
      );
    } catch {
      return null;
    }
  };

export interface ReplayFingerprintLink {
  fingerprint: string;
  route: Route | null;
}

type BuildReplayFingerprintLinksFunction = (
  fingerprints: Array<string> | null | undefined,
  exceptionsListRoute: Route,
) => Array<ReplayFingerprintLink>;

/**
 * One entry per correlated exception group, each deep-linked to its group on
 * the exceptions list via buildExceptionsGroupRoute (exact `@fingerprint:`
 * search, status=all so resolved groups still surface). Entries are trimmed,
 * deduped in first-appearance order, and blank ones dropped; a null route
 * (which buildExceptionsGroupRoute only returns for an empty fingerprint, so
 * it cannot happen after the trim) keeps the fingerprint renderable as plain
 * text rather than losing it.
 */
export const buildReplayFingerprintLinks: BuildReplayFingerprintLinksFunction =
  (
    fingerprints: Array<string> | null | undefined,
    exceptionsListRoute: Route,
  ): Array<ReplayFingerprintLink> => {
    const links: Array<ReplayFingerprintLink> = [];
    const seen: Set<string> = new Set<string>();

    for (const raw of fingerprints || []) {
      const fingerprint: string = (raw || "").trim();

      if (fingerprint.length === 0 || seen.has(fingerprint)) {
        continue;
      }

      seen.add(fingerprint);
      links.push({
        fingerprint: fingerprint,
        route: buildExceptionsGroupRoute({
          exceptionsListRoute: exceptionsListRoute,
          fingerprint: fingerprint,
        }),
      });
    }

    return links;
  };

/*
 * A millisecond quantity for the details panel: "420 ms" below a second,
 * "1.5s" below a minute, "2m 05s" beyond. The previous form rounded to
 * whole seconds, which printed "0s (server-clamped)" for a 300 ms skew and
 * listed a "0s missing" gap - copy that contradicted itself.
 */
export function formatReplayMilliseconds(ms: number): string {
  if (!Number.isFinite(ms)) {
    return "unknown";
  }

  const absolute: number = Math.abs(ms);
  const sign: string = ms < 0 ? "-" : "";

  if (absolute < 1000) {
    return `${sign}${Math.round(absolute)} ms`;
  }

  if (absolute < 60 * 1000) {
    const seconds: number = absolute / 1000;
    const rendered: string =
      Number.isInteger(seconds) || seconds >= 10
        ? String(Math.round(seconds))
        : seconds.toFixed(1);

    return `${sign}${rendered}s`;
  }

  const minutes: number = Math.floor(absolute / (60 * 1000));
  const seconds: number = Math.round((absolute % (60 * 1000)) / 1000);

  return `${sign}${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/*
 * Client clock skew as the panel shows it. Positive means the device ran
 * ahead of the server; the server clamped every client timestamp by this
 * much. Zero is "none measured" rather than a number, because a skew of
 * exactly 0 ms is what the header carries when the recorder never reported
 * one.
 */
export function formatReplayClockSkew(clockSkewMs: number): string {
  if (!Number.isFinite(clockSkewMs) || clockSkewMs === 0) {
    return "None";
  }

  const direction: string = clockSkewMs > 0 ? "ahead" : "behind";

  return `${formatReplayMilliseconds(Math.abs(clockSkewMs))} ${direction} (server-clamped)`;
}

/*
 * Readable labels for the enum-valued header fields. An unknown value from
 * a newer recorder is humanised rather than dropped, but never rendered as
 * the bare machine token.
 */
const TRIGGER_REASON_LABELS: Record<string, string> = {
  [SessionReplayTriggerReason.Error]: "An error occurred on the page",
  [SessionReplayTriggerReason.Frustration]:
    "A frustration signal (rage, dead or error click)",
  [SessionReplayTriggerReason.Sampled]: "Picked by the sample percentage",
  [SessionReplayTriggerReason.Manual]:
    "The page called OneUptimeReplay.captureSession()",
  [SessionReplayTriggerReason.Performance]: "A performance budget was exceeded",
};

export function getReplayTriggerReasonLabel(raw: string): string {
  const trimmed: string = (raw || "").trim();

  if (trimmed.length === 0) {
    return "";
  }

  return (
    TRIGGER_REASON_LABELS[trimmed.toLowerCase()] ||
    Text.fromPascalCaseToReadable(Text.fromDashesToPascalCase(trimmed))
  );
}

const CONSENT_STATE_LABELS: Record<string, string> = {
  granted: "Granted by the end user",
  notrequired: "Not required by this application's policy",
  unknown: "Unknown - the recorder did not report it",
};

export function getReplayConsentStateLabel(raw: string): string {
  const trimmed: string = (raw || "").trim();

  if (trimmed.length === 0) {
    return "";
  }

  return (
    CONSENT_STATE_LABELS[trimmed.toLowerCase()] ||
    Text.fromPascalCaseToReadable(Text.fromDashesToPascalCase(trimmed))
  );
}

export const REPLAY_PANEL_DEFAULT_WIDTH_CLASS: string = "w-[38rem]";
export const REPLAY_PANEL_WIDE_WIDTH_CLASS: string = "w-[64rem] max-w-[95vw]";

type GetReplayPanelWidthClassNameFunction = (activeTabId: string) => string;

/**
 * The detail panel's width class per tab. The metadata tabs (Session /
 * Privacy / Fidelity, the only ones the panel has now that the rail owns
 * the backend rows) keep the TelemetryDetailPanel default; the wide variant
 * stays mapped to the retired "logs" / "errors" ids so a tab that embeds a
 * table again gets a usable width without editing the shared panel.
 */
export const getReplayPanelWidthClassName: GetReplayPanelWidthClassNameFunction =
  (activeTabId: string): string => {
    if (activeTabId === "logs" || activeTabId === "errors") {
      return REPLAY_PANEL_WIDE_WIDTH_CLASS;
    }

    return REPLAY_PANEL_DEFAULT_WIDTH_CLASS;
  };
