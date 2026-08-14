import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Route from "Common/Types/API/Route";
import Log from "Common/Models/AnalyticsModels/Log";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import { buildExceptionsGroupRoute } from "./TraceCorrelatedSignals";

/*
 * Pure helpers behind the session replay correlation panel's Logs / Errors
 * tabs and its exception-fingerprint links. Renderer-free so the App jest
 * suite can exercise them in plain Node; anything needing RouteMap (the
 * exceptions list route) takes the populated Route as an argument instead of
 * importing it, which keeps this module loadable without browser stubs.
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

export const REPLAY_PANEL_DEFAULT_WIDTH_CLASS: string = "w-[38rem]";
export const REPLAY_PANEL_WIDE_WIDTH_CLASS: string = "w-[64rem] max-w-[95vw]";

type GetReplayPanelWidthClassNameFunction = (activeTabId: string) => string;

/**
 * The detail panel's width class per tab: the metadata tabs keep the
 * TelemetryDetailPanel default, while the Logs / Errors tabs — which embed
 * the full logs viewer and the exceptions table — get the wide variant so
 * their tables are usable without editing the shared panel component.
 */
export const getReplayPanelWidthClassName: GetReplayPanelWidthClassNameFunction =
  (activeTabId: string): string => {
    if (activeTabId === "logs" || activeTabId === "errors") {
      return REPLAY_PANEL_WIDE_WIDTH_CLASS;
    }

    return REPLAY_PANEL_DEFAULT_WIDTH_CLASS;
  };
