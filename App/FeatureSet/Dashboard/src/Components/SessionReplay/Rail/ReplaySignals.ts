import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  SessionReplayErrorKind,
  SessionReplayFrustrationKind,
  SessionReplayPerformanceBudgetKind,
  SessionReplayRouteKind,
  SessionReplayVisibilityState,
  SessionReplayWebVitalMetric,
  SessionReplayWebVitalRating,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import { ReplayTimelineEvent } from "../ReplayTimelineTypes";
import {
  alignTelemetryOffsetMs,
  alignmentLabelFor,
} from "./ReplayClockAlignment";
import {
  ReplaySignal,
  ReplaySignalKind,
  ReplaySignalSeverity,
  ReplayTelemetryClock,
  makeExceptionSignalId,
  makeLogSignalId,
  makeSpanSignalId,
} from "./ReplaySignalTypes";

/*
 * Adapters from everything the rail can show into ONE row shape.
 *
 * Recording rows (ReplayTimelineEvent, lifted by ChunkLoader from the
 * chunks) are exact on the session clock and carry their chunk index.
 * Telemetry rows (Log / Span / ExceptionInstance fetched by sessionId) are
 * server-stamped and go through ReplayClockAlignment to land on the same
 * clock, labelled with how much to trust the placement.
 *
 * Every adapter is pure and total: it never throws on a sparse row, and it
 * never invents a value - a missing duration is absent from the subtitle,
 * not rendered as 0ms. Copy rules: name the cause, quantify it. The row
 * title is the one line a person scans; the detail object carries
 * everything the inline panel needs, typed per kind below so the renderer
 * can branch on `kind` and read a known shape.
 */

/* Titles stay one line; the full text lives in detail. */
export const REPLAY_SIGNAL_TITLE_MAX_LENGTH: number = 200;

/* Row click lands this far before the row so the cause is on screen too. */
export const REPLAY_SIGNAL_SEEK_PRE_ROLL_MS: number = 1000;

/* A client error and a server exception this close with the same message. */
export const REPLAY_ERROR_PAIRING_WINDOW_MS: number = 2000;

/* The trace waterfall stops here; past it the trace view is the tool. */
export const REPLAY_TRACE_WATERFALL_MAX_SPANS: number = 50;

/* A request slower than this earns the "slow" chip. */
export const REPLAY_SLOW_REQUEST_MS: number = 1000;

export interface ReplayRecordingSignalContext {
  /*
   * header.startTimeUnixMs, so a recording row that carried no wall-clock
   * stamp of its own still gets one (start + offset) for the header's
   * wall-clock display and for pairing with server rows. null when the
   * manifest has not arrived yet.
   */
  startTimeUnixMs: number | null;
}

/* ---- Detail shapes, one per kind. Type aliases so they satisfy Record. ---- */

export type ReplayConsoleSignalDetail = {
  level: string;
  message: string;
  atUnixMs: number | null;
};

export type ReplayNetworkSignalDetail = {
  method: string;
  url: string;
  origin: string;
  path: string;
  status: number;
  durationMs: number | null;
  responseBytes: number | null;
  requestBytes: number | null;
  initiator: "fetch" | "xhr" | null;
  traceId: string | null;
  isError: boolean;
  /* status 0: aborted, offline, CORS-blocked - the browser never got a reply. */
  failedBeforeResponse: boolean;
  isSlow: boolean;
  atUnixMs: number | null;
};

export type ReplayNavigationSignalDetail = {
  from: string | null;
  to: string;
  kind: SessionReplayRouteKind | "full-load";
  /*
   * Full loads only: the viewport rrweb's Meta event declared for the
   * page, so the detail can say "1440x900" next to the URL. null on
   * history-API routes (the viewport did not change) and on chunks whose
   * Meta lived in an earlier chunk.
   */
  viewportWidth: number | null;
  viewportHeight: number | null;
  atUnixMs: number | null;
};

export type ReplayClientErrorSignalDetail = {
  kind: SessionReplayErrorKind | "unknown";
  message: string;
  source: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  stack: string | null;
  /* "app.js:12:5" when the recorder captured a location. */
  location: string | null;
  atUnixMs: number | null;
};

export type ReplayFrustrationSignalDetail = {
  kind: SessionReplayFrustrationKind | "unknown";
  x: number | null;
  y: number | null;
  clickCount: number | null;
  reloadCount: number | null;
  atUnixMs: number | null;
};

export type ReplayInteractionSignalDetail = {
  selector: string | null;
  text: string | null;
  x: number | null;
  y: number | null;
  /* Old recordings: rrweb MouseInteraction only, no selector or label. */
  isCoordinateOnly: boolean;
  atUnixMs: number | null;
};

export type ReplayPerformanceSignalDetail = {
  kind: SessionReplayPerformanceBudgetKind | "web-vital" | "unknown";
  durationMs: number | null;
  budgetMs: number | null;
  isOverBudget: boolean;
  metric: SessionReplayWebVitalMetric | null;
  value: number | null;
  rating: SessionReplayWebVitalRating | null;
  url: string | null;
  atUnixMs: number | null;
};

export type ReplayCustomSignalDetail = {
  name: string;
  properties: Record<string, string>;
  propertyCount: number;
  atUnixMs: number | null;
};

export type ReplayMarkerKind =
  | "visibility"
  | "identify"
  | "tags"
  | "click-dropped"
  | "custom-dropped";

export type ReplayMarkerSignalDetail = {
  markerKind: ReplayMarkerKind;
  visibilityState: SessionReplayVisibilityState | null;
  hasTraits: boolean | null;
  tags: Record<string, string> | null;
  droppedCount: number | null;
  atUnixMs: number | null;
};

export type ReplayLogSignalDetail = {
  body: string;
  /* Display level: ERROR, WARN, INFO, DEBUG, TRACE, FATAL, or "" when unset. */
  level: string;
  severityText: string | null;
  severityNumber: number | null;
  serviceId: string | null;
  serviceName: string | null;
  traceId: string | null;
  spanId: string | null;
  timeUnixMs: number;
  /* The baseline (server time - start) before anchoring, for the tooltip. */
  baselineOffsetMs: number;
};

export type ReplayServerErrorSignalDetail = {
  message: string;
  exceptionType: string | null;
  stackTrace: string | null;
  fingerprint: string | null;
  serviceId: string | null;
  serviceName: string | null;
  traceId: string | null;
  spanId: string | null;
  spanName: string | null;
  timeUnixMs: number;
  baselineOffsetMs: number;
};

export type ReplayTraceWaterfallSpan = {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  serviceName: string | null;
  /* Nesting under the root, for indentation. Root = 0. */
  depth: number;
  /* Relative to the trace's first span, for the bar's left edge. */
  startOffsetMs: number;
  durationMs: number;
  hasError: boolean;
  /* Session clock, so a click on the bar can seek. */
  sessionOffsetMs: number;
};

export type ReplaySpanSignalDetail = {
  traceId: string;
  rootSpanId: string;
  rootName: string;
  serviceId: string | null;
  serviceName: string | null;
  durationMs: number;
  spanCount: number;
  errorSpanCount: number;
  hasError: boolean;
  startUnixMs: number;
  baselineOffsetMs: number;
  spans: Array<ReplayTraceWaterfallSpan>;
  isWaterfallTruncated: boolean;
};

/* ---- Small formatters, shared by titles and subtitles. ---- */

export function formatSignalBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)}B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10}KB`;
  }

  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

export function formatSignalDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60 * 1000) {
    return `${Math.round((ms / 1000) * 10) / 10}s`;
  }

  const minutes: number = Math.floor(ms / 60000);
  const seconds: number = Math.round((ms % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
}

function firstLine(text: string): string {
  const newlineIndex: number = text.indexOf("\n");

  return newlineIndex === -1 ? text : text.slice(0, newlineIndex);
}

function toTitle(text: string): string {
  const line: string = firstLine(text).trim();

  if (line.length <= REPLAY_SIGNAL_TITLE_MAX_LENGTH) {
    return line;
  }

  return `${line.slice(0, REPLAY_SIGNAL_TITLE_MAX_LENGTH - 1)}…`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* Split a URL into origin and path without throwing on relative ones. */
export function splitSignalUrl(url: string): { origin: string; path: string } {
  try {
    const parsed: URL = new URL(url);

    return {
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
  } catch {
    return { origin: "", path: url };
  }
}

function wallClockFor(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): number | null {
  if (isFiniteNumber(event.atUnixMs)) {
    return event.atUnixMs;
  }

  if (ctx.startTimeUnixMs !== null && isFiniteNumber(ctx.startTimeUnixMs)) {
    return ctx.startTimeUnixMs + event.offsetMs;
  }

  return null;
}

function baseSignal(
  event: ReplayTimelineEvent,
  kind: ReplaySignalKind,
  severity: ReplaySignalSeverity,
  title: string,
): ReplaySignal {
  return {
    id: event.id,
    kind: kind,
    source: "recording",
    offsetMs: event.offsetMs,
    severity: severity,
    title: title,
    chunkIndex: event.chunkIndex,
    links: {},
    detail: {},
    alignment: "exact",
  };
}

/* ---- Recording adapters. ---- */

export function networkSeverity(
  status: number | undefined,
  isError: boolean | undefined,
): ReplaySignalSeverity {
  if (status === 0 || status === undefined || status === null) {
    return "error";
  }

  if (status >= 500) {
    return "error";
  }

  if (status >= 400 || isError === true) {
    return "warn";
  }

  return "info";
}

function consoleSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const level: string = (event.level || "log").toString();
  const message: string = event.message || "";
  const severity: ReplaySignalSeverity =
    level === "error" ? "error" : level === "warn" ? "warn" : "info";
  const signal: ReplaySignal = baseSignal(
    event,
    "console",
    severity,
    toTitle(message) || `console.${level}`,
  );

  signal.subtitle = level;

  const detail: ReplayConsoleSignalDetail = {
    level: level,
    message: message,
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

function networkSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const method: string = (event.method || "GET").toUpperCase();
  const url: string = event.url || "";
  const status: number = isFiniteNumber(event.status) ? event.status : 0;
  const { origin, path } = splitSignalUrl(url);
  const failedBeforeResponse: boolean = status === 0;
  const durationMs: number | null = numberOrNull(event.durationMs);
  const responseBytes: number | null = numberOrNull(event.responseBytes);
  const statusWord: string = failedBeforeResponse ? "failed" : String(status);
  const signal: ReplaySignal = baseSignal(
    event,
    "network",
    networkSeverity(status, event.isError),
    toTitle(`${method} ${statusWord} ${path || url}`),
  );

  const meta: Array<string> = [];

  if (durationMs !== null) {
    meta.push(formatSignalDuration(durationMs));
  }

  if (responseBytes !== null && responseBytes > 0) {
    meta.push(formatSignalBytes(responseBytes));
  }

  if (meta.length > 0) {
    signal.subtitle = meta.join(" ");
  }

  if (event.traceId) {
    signal.links.traceId = event.traceId;
  }

  const detail: ReplayNetworkSignalDetail = {
    method: method,
    url: url,
    origin: origin,
    path: path,
    status: status,
    durationMs: durationMs,
    responseBytes: responseBytes,
    requestBytes: numberOrNull(event.requestBytes),
    initiator: event.initiator || null,
    traceId: event.traceId || null,
    isError: event.isError === true || failedBeforeResponse || status >= 400,
    failedBeforeResponse: failedBeforeResponse,
    isSlow: durationMs !== null && durationMs > REPLAY_SLOW_REQUEST_MS,
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

const ROUTE_KIND_LABELS: Record<SessionReplayRouteKind | "full-load", string> =
  {
    pushState: "history push",
    replaceState: "history replace",
    popstate: "back/forward",
    hashchange: "hash change",
    "full-load": "full page load",
  };

function navigationSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const isFullLoad: boolean = event.kind === "navigation";
  const kind: SessionReplayRouteKind | "full-load" = isFullLoad
    ? "full-load"
    : event.routeKind || "pushState";
  const to: string = event.to || event.url || "";
  const signal: ReplaySignal = baseSignal(
    event,
    "navigation",
    "info",
    toTitle(to) || (isFullLoad ? "Page loaded" : "Route changed"),
  );

  signal.subtitle = ROUTE_KIND_LABELS[kind];

  const detail: ReplayNavigationSignalDetail = {
    from: stringOrNull(event.from),
    to: to,
    kind: kind,
    viewportWidth: numberOrNull(event.viewportWidth),
    viewportHeight: numberOrNull(event.viewportHeight),
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

const ERROR_KIND_LABELS: Record<SessionReplayErrorKind | "unknown", string> = {
  error: "uncaught error",
  unhandledrejection: "unhandled rejection",
  unknown: "error",
};

function errorLocation(event: ReplayTimelineEvent): string | null {
  if (!event.source) {
    return null;
  }

  const { path } = splitSignalUrl(event.source);
  const file: string = path || event.source;

  if (isFiniteNumber(event.lineNumber)) {
    if (isFiniteNumber(event.columnNumber)) {
      return `${file}:${event.lineNumber}:${event.columnNumber}`;
    }

    return `${file}:${event.lineNumber}`;
  }

  return file;
}

function clientErrorSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const kind: SessionReplayErrorKind | "unknown" = event.errorKind || "unknown";
  const message: string = event.message || "";
  const location: string | null = errorLocation(event);
  const signal: ReplaySignal = baseSignal(
    event,
    "client-error",
    "error",
    toTitle(message) || ERROR_KIND_LABELS[kind],
  );

  signal.subtitle = location
    ? `${ERROR_KIND_LABELS[kind]} · ${location}`
    : ERROR_KIND_LABELS[kind];

  const detail: ReplayClientErrorSignalDetail = {
    kind: kind,
    message: message,
    source: stringOrNull(event.source),
    lineNumber: numberOrNull(event.lineNumber),
    columnNumber: numberOrNull(event.columnNumber),
    stack: stringOrNull(event.stack),
    location: location,
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

function frustrationTitle(event: ReplayTimelineEvent): string {
  switch (event.frustrationKind) {
    case "rage-click":
      return isFiniteNumber(event.clickCount)
        ? `Rage click (${event.clickCount} clicks)`
        : "Rage click";
    case "dead-click":
      return "Dead click";
    case "error-click":
      return "Error click";
    case "refresh-rage":
      return isFiniteNumber(event.reloadCount)
        ? `Refresh rage (${event.reloadCount} reloads)`
        : "Refresh rage";
    default:
      return "Frustration";
  }
}

function frustrationSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const signal: ReplaySignal = baseSignal(
    event,
    "frustration",
    "warn",
    frustrationTitle(event),
  );

  if (isFiniteNumber(event.x) && isFiniteNumber(event.y)) {
    signal.subtitle = `at ${Math.round(event.x)}, ${Math.round(event.y)}`;
  }

  const detail: ReplayFrustrationSignalDetail = {
    kind: event.frustrationKind || "unknown",
    x: numberOrNull(event.x),
    y: numberOrNull(event.y),
    clickCount: numberOrNull(event.clickCount),
    reloadCount: numberOrNull(event.reloadCount),
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

function clickSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const text: string | null = stringOrNull(event.text?.trim());
  const selector: string | null = stringOrNull(event.selector);
  const hasCoordinates: boolean =
    isFiniteNumber(event.x) && isFiniteNumber(event.y);
  const isCoordinateOnly: boolean = !text && !selector;
  let title: string;

  if (text) {
    title = `Click "${toTitle(text)}"`;
  } else if (selector) {
    title = `Click ${toTitle(selector)}`;
  } else if (hasCoordinates) {
    title = `Click at (${Math.round(event.x as number)}, ${Math.round(event.y as number)})`;
  } else {
    title = "Click";
  }

  const signal: ReplaySignal = baseSignal(event, "interaction", "info", title);

  if (text && selector) {
    signal.subtitle = selector;
  } else if (hasCoordinates && !isCoordinateOnly) {
    signal.subtitle = `at ${Math.round(event.x as number)}, ${Math.round(event.y as number)}`;
  }

  const detail: ReplayInteractionSignalDetail = {
    selector: selector,
    text: text,
    x: numberOrNull(event.x),
    y: numberOrNull(event.y),
    isCoordinateOnly: isCoordinateOnly,
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

const BUDGET_KIND_LABELS: Record<SessionReplayPerformanceBudgetKind, string> = {
  lcp: "LCP",
  "long-task": "Long task",
  "slow-request": "Slow request",
};

function formatVitalValue(
  metric: SessionReplayWebVitalMetric | null,
  value: number,
): string {
  /* CLS is unitless; everything else is milliseconds. */
  if (metric === "CLS") {
    return String(Math.round(value * 1000) / 1000);
  }

  return formatSignalDuration(value);
}

function performanceSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const performanceKind:
    | SessionReplayPerformanceBudgetKind
    | "web-vital"
    | "unknown" =
    event.performanceKind || (event.metric ? "web-vital" : "unknown");
  const atUnixMs: number | null = wallClockFor(event, ctx);
  let title: string;
  let severity: ReplaySignalSeverity;
  let isOverBudget: boolean = false;

  if (performanceKind === "web-vital") {
    const metric: SessionReplayWebVitalMetric | null = event.metric || null;
    const value: number | null = numberOrNull(event.value);
    const rating: SessionReplayWebVitalRating | null = event.rating || null;

    title = [
      metric || "Web vital",
      value !== null ? formatVitalValue(metric, value) : "",
      rating || "",
    ]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(" ");
    severity =
      rating === "poor"
        ? "error"
        : rating === "needs-improvement"
          ? "warn"
          : rating === "good"
            ? "success"
            : "info";
    isOverBudget = rating === "poor" || rating === "needs-improvement";
  } else {
    const label: string =
      performanceKind === "unknown"
        ? "Performance"
        : BUDGET_KIND_LABELS[performanceKind];
    const durationMs: number | null = numberOrNull(event.durationMs);
    const budgetMs: number | null = numberOrNull(event.budgetMs);

    isOverBudget =
      durationMs !== null && budgetMs !== null && durationMs > budgetMs;
    title = label;

    if (durationMs !== null) {
      title = `${label} ${formatSignalDuration(durationMs)}`;
    }

    if (budgetMs !== null) {
      title = `${title} (budget ${formatSignalDuration(budgetMs)})`;
    }

    severity = isOverBudget ? "warn" : "info";
  }

  const signal: ReplaySignal = baseSignal(
    event,
    "performance",
    severity,
    toTitle(title),
  );

  if (event.url) {
    signal.subtitle = splitSignalUrl(event.url).path || event.url;
  }

  const detail: ReplayPerformanceSignalDetail = {
    kind: performanceKind,
    durationMs: numberOrNull(event.durationMs),
    budgetMs: numberOrNull(event.budgetMs),
    isOverBudget: isOverBudget,
    metric: event.metric || null,
    value: numberOrNull(event.value),
    rating: event.rating || null,
    url: stringOrNull(event.url),
    atUnixMs: atUnixMs,
  };

  signal.detail = detail;

  return signal;
}

function customSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  const name: string = event.name || "custom event";
  const properties: Record<string, string> = event.properties || {};
  const propertyCount: number = Object.keys(properties).length;
  const signal: ReplaySignal = baseSignal(
    event,
    "custom",
    "info",
    toTitle(name),
  );

  if (propertyCount > 0) {
    signal.subtitle =
      propertyCount === 1 ? "1 property" : `${propertyCount} properties`;
  }

  const detail: ReplayCustomSignalDetail = {
    name: name,
    properties: properties,
    propertyCount: propertyCount,
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

function markerSignal(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  let markerKind: ReplayMarkerKind;
  let title: string;
  let severity: ReplaySignalSeverity = "info";
  let subtitle: string | undefined;
  const droppedCount: number | null = numberOrNull(event.droppedCount);

  switch (event.kind) {
    case "visibility":
      markerKind = "visibility";
      title = event.visibilityState === "hidden" ? "Tab hidden" : "Tab visible";
      break;
    case "identify":
      markerKind = "identify";
      title = "User identified";
      subtitle = event.hasTraits ? "with traits" : undefined;
      break;
    case "tags": {
      markerKind = "tags";
      const tagCount: number = Object.keys(event.tags || {}).length;

      title = "Tags set";
      subtitle =
        tagCount > 0
          ? tagCount === 1
            ? "1 tag"
            : `${tagCount} tags`
          : undefined;
      break;
    }
    case "click-dropped":
      markerKind = "click-dropped";
      severity = "warn";
      title =
        droppedCount !== null
          ? `${droppedCount} clicks not labelled (recorder cap)`
          : "Some clicks not labelled (recorder cap)";
      break;
    default:
      markerKind = "custom-dropped";
      severity = "warn";
      title =
        droppedCount !== null
          ? `${droppedCount} custom events not recorded (recorder cap)`
          : "Some custom events not recorded (recorder cap)";
      break;
  }

  const signal: ReplaySignal = baseSignal(event, "marker", severity, title);

  if (subtitle) {
    signal.subtitle = subtitle;
  }

  const detail: ReplayMarkerSignalDetail = {
    markerKind: markerKind,
    visibilityState: event.visibilityState || null,
    hasTraits: typeof event.hasTraits === "boolean" ? event.hasTraits : null,
    tags: event.tags || null,
    droppedCount: droppedCount,
    atUnixMs: wallClockFor(event, ctx),
  };

  signal.detail = detail;

  return signal;
}

/*
 * ReplayTimelineEvent -> ReplaySignal. Total over every timeline kind: the
 * rail must never drop a row the loader kept, so an unknown kind still
 * becomes a marker rather than nothing.
 */
export function fromTimelineEvent(
  event: ReplayTimelineEvent,
  ctx: ReplayRecordingSignalContext,
): ReplaySignal {
  switch (event.kind) {
    case "console":
      return consoleSignal(event, ctx);
    case "network":
      return networkSignal(event, ctx);
    case "route":
    case "navigation":
      return navigationSignal(event, ctx);
    case "error":
      return clientErrorSignal(event, ctx);
    case "frustration":
      return frustrationSignal(event, ctx);
    case "click":
      return clickSignal(event, ctx);
    case "performance":
      return performanceSignal(event, ctx);
    case "custom":
      return customSignal(event, ctx);
    case "visibility":
    case "identify":
    case "tags":
    case "click-dropped":
    case "custom-dropped":
    default:
      return markerSignal(event, ctx);
  }
}

export function fromTimelineEvents(
  events: Array<ReplayTimelineEvent>,
  ctx: ReplayRecordingSignalContext,
): Array<ReplaySignal> {
  return events.map((event: ReplayTimelineEvent): ReplaySignal => {
    return fromTimelineEvent(event, ctx);
  });
}

/* ---- Telemetry adapters. ---- */

function idToString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (typeof value === "object" && "toString" in value) {
    const text: string = String(value);

    return text.length > 0 && text !== "[object Object]" ? text : null;
  }

  return null;
}

function dateToUnixMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms: number = value.getTime();

    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const ms: number = new Date(value).getTime();

    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

function serviceNameFor(
  clock: ReplayTelemetryClock,
  serviceId: string | null,
): string | null {
  if (!serviceId || !clock.serviceNameById) {
    return null;
  }

  return stringOrNull(clock.serviceNameById[serviceId]);
}

const LOG_LEVEL_DISPLAY: Record<string, string> = {
  [LogSeverity.Error]: "ERROR",
  [LogSeverity.Fatal]: "FATAL",
  [LogSeverity.Warning]: "WARN",
  [LogSeverity.Information]: "INFO",
  [LogSeverity.Debug]: "DEBUG",
  [LogSeverity.Trace]: "TRACE",
  [LogSeverity.Unspecified]: "",
};

export function logLevelDisplay(severityText: string | null): string {
  if (!severityText) {
    return "";
  }

  const known: string | undefined = LOG_LEVEL_DISPLAY[severityText];

  if (known !== undefined) {
    return known;
  }

  return severityText.toUpperCase();
}

export function logSeverityToSignalSeverity(
  severityText: string | null,
  severityNumber: number | null,
): ReplaySignalSeverity {
  if (
    severityText === LogSeverity.Error ||
    severityText === LogSeverity.Fatal
  ) {
    return "error";
  }

  if (severityText === LogSeverity.Warning) {
    return "warn";
  }

  /* Unknown text: fall back to the OTLP number ranges. */
  if (severityText === null || severityText === "") {
    if (severityNumber !== null && severityNumber >= 17) {
      return "error";
    }

    if (severityNumber !== null && severityNumber >= 13) {
      return "warn";
    }
  }

  return "info";
}

/* Null when the row has no id or no time: nothing to address, nowhere to put it. */
export function fromLogRow(
  row: Log,
  clock: ReplayTelemetryClock,
): ReplaySignal | null {
  const id: string | null = idToString(row.id);
  const timeUnixMs: number | null = dateToUnixMs(row.time);

  if (!id || timeUnixMs === null) {
    return null;
  }

  const severityText: string | null = stringOrNull(row.severityText);
  const severityNumber: number | null = numberOrNull(row.severityNumber);
  const body: string = typeof row.body === "string" ? row.body : "";
  const level: string = logLevelDisplay(severityText);
  const serviceId: string | null = idToString(row.primaryEntityId);
  const serviceName: string | null = serviceNameFor(clock, serviceId);
  const traceId: string | null = stringOrNull(row.traceId);
  const spanId: string | null = stringOrNull(row.spanId);
  const baselineOffsetMs: number = timeUnixMs - clock.startTimeUnixMs;
  const titleBody: string = toTitle(body) || "(empty log line)";

  const signal: ReplaySignal = {
    id: makeLogSignalId(id),
    kind: "log",
    source: "telemetry",
    offsetMs: alignTelemetryOffsetMs(
      timeUnixMs,
      clock.startTimeUnixMs,
      clock.alignment,
    ),
    severity: logSeverityToSignalSeverity(severityText, severityNumber),
    title: level ? `[${level}] ${titleBody}` : titleBody,
    links: {},
    detail: {},
    alignment: alignmentLabelFor(clock.alignment),
  };

  if (serviceName) {
    signal.subtitle = serviceName;
  }

  if (traceId) {
    signal.links.traceId = traceId;
  }

  if (spanId) {
    signal.links.spanId = spanId;
  }

  signal.links.logId = id;

  const detail: ReplayLogSignalDetail = {
    body: body,
    level: level,
    severityText: severityText,
    severityNumber: severityNumber,
    serviceId: serviceId,
    serviceName: serviceName,
    traceId: traceId,
    spanId: spanId,
    timeUnixMs: timeUnixMs,
    baselineOffsetMs: baselineOffsetMs,
  };

  signal.detail = detail;

  return signal;
}

export function fromExceptionRow(
  row: ExceptionInstance,
  clock: ReplayTelemetryClock,
): ReplaySignal | null {
  const id: string | null = idToString(row.id);
  const timeUnixMs: number | null = dateToUnixMs(row.time);

  if (!id || timeUnixMs === null) {
    return null;
  }

  const message: string = typeof row.message === "string" ? row.message : "";
  const exceptionType: string | null = stringOrNull(row.exceptionType);
  const fingerprint: string | null = stringOrNull(row.fingerprint);
  const serviceId: string | null = idToString(row.primaryEntityId);
  const serviceName: string | null = serviceNameFor(clock, serviceId);
  const traceId: string | null = stringOrNull(row.traceId);
  const spanId: string | null = stringOrNull(row.spanId);
  const baselineOffsetMs: number = timeUnixMs - clock.startTimeUnixMs;
  const headline: string = toTitle(message);
  let title: string;

  if (exceptionType && headline) {
    title = toTitle(`${exceptionType}: ${headline}`);
  } else if (exceptionType) {
    title = exceptionType;
  } else {
    title = headline || "Exception";
  }

  const signal: ReplaySignal = {
    id: makeExceptionSignalId(id),
    kind: "server-error",
    source: "telemetry",
    offsetMs: alignTelemetryOffsetMs(
      timeUnixMs,
      clock.startTimeUnixMs,
      clock.alignment,
    ),
    severity: "error",
    title: title,
    links: { exceptionInstanceId: id },
    detail: {},
    alignment: alignmentLabelFor(clock.alignment),
  };

  if (serviceName) {
    signal.subtitle = serviceName;
  }

  if (fingerprint) {
    signal.links.exceptionFingerprint = fingerprint;
  }

  if (traceId) {
    signal.links.traceId = traceId;
  }

  if (spanId) {
    signal.links.spanId = spanId;
  }

  const detail: ReplayServerErrorSignalDetail = {
    message: message,
    exceptionType: exceptionType,
    stackTrace: stringOrNull(row.stackTrace),
    fingerprint: fingerprint,
    serviceId: serviceId,
    serviceName: serviceName,
    traceId: traceId,
    spanId: spanId,
    spanName: stringOrNull(row.spanName),
    timeUnixMs: timeUnixMs,
    baselineOffsetMs: baselineOffsetMs,
  };

  signal.detail = detail;

  return signal;
}

/* Everything groupSpansIntoTraces needs from a Span row, read once. */
interface SpanFacts {
  spanId: string;
  parentSpanId: string | null;
  traceId: string;
  name: string;
  startUnixMs: number;
  durationMs: number;
  hasError: boolean;
  serviceId: string | null;
}

function spanFacts(row: Span): SpanFacts | null {
  const spanId: string | null = stringOrNull(row.spanId);
  const traceId: string | null = stringOrNull(row.traceId);
  const startUnixMs: number | null = dateToUnixMs(row.startTime);

  if (!spanId || !traceId || startUnixMs === null) {
    return null;
  }

  const durationNanos: number | null = numberOrNull(row.durationUnixNano);

  return {
    spanId: spanId,
    parentSpanId: stringOrNull(row.parentSpanId),
    traceId: traceId,
    name: stringOrNull(row.name) || "(unnamed span)",
    startUnixMs: startUnixMs,
    durationMs:
      durationNanos !== null ? Math.max(0, durationNanos / 1000000) : 0,
    hasError: row.statusCode === SpanStatus.Error,
    serviceId: idToString(row.primaryEntityId),
  };
}

/* One span as its own row; used when a caller wants spans ungrouped. */
export function fromSpanRow(
  row: Span,
  clock: ReplayTelemetryClock,
): ReplaySignal | null {
  const facts: SpanFacts | null = spanFacts(row);

  if (!facts) {
    return null;
  }

  return traceSignal([facts], clock);
}

function buildWaterfall(
  spans: Array<SpanFacts>,
  traceStartUnixMs: number,
  clock: ReplayTelemetryClock,
): Array<ReplayTraceWaterfallSpan> {
  const byId: Map<string, SpanFacts> = new Map<string, SpanFacts>();

  for (const span of spans) {
    byId.set(span.spanId, span);
  }

  const depthOf: (span: SpanFacts) => number = (span: SpanFacts): number => {
    let depth: number = 0;
    let cursor: SpanFacts | undefined = span;
    const seen: Set<string> = new Set<string>();

    while (cursor && cursor.parentSpanId && !seen.has(cursor.spanId)) {
      seen.add(cursor.spanId);
      cursor = byId.get(cursor.parentSpanId);

      if (cursor) {
        depth++;
      }
    }

    return depth;
  };

  return spans.map((span: SpanFacts): ReplayTraceWaterfallSpan => {
    return {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      serviceName: serviceNameFor(clock, span.serviceId),
      depth: depthOf(span),
      startOffsetMs: span.startUnixMs - traceStartUnixMs,
      durationMs: span.durationMs,
      hasError: span.hasError,
      sessionOffsetMs: alignTelemetryOffsetMs(
        span.startUnixMs,
        clock.startTimeUnixMs,
        clock.alignment,
      ),
    };
  });
}

function traceSignal(
  spans: Array<SpanFacts>,
  clock: ReplayTelemetryClock,
): ReplaySignal {
  const sorted: Array<SpanFacts> = [...spans].sort(
    (a: SpanFacts, b: SpanFacts): number => {
      return a.startUnixMs - b.startUnixMs;
    },
  );
  const first: SpanFacts = sorted[0] as SpanFacts;
  /*
   * The root is the span without a parent inside this trace; when the root
   * was not ingested (sampling, a different project) the earliest span
   * stands in, which is still the span a person would call "the request".
   */
  const spanIds: Set<string> = new Set<string>(
    sorted.map((span: SpanFacts): string => {
      return span.spanId;
    }),
  );
  const root: SpanFacts =
    sorted.find((span: SpanFacts): boolean => {
      return !span.parentSpanId || !spanIds.has(span.parentSpanId);
    }) || first;

  let endUnixMs: number = first.startUnixMs;
  let errorSpanCount: number = 0;

  for (const span of sorted) {
    endUnixMs = Math.max(endUnixMs, span.startUnixMs + span.durationMs);

    if (span.hasError) {
      errorSpanCount++;
    }
  }

  const durationMs: number = Math.max(0, endUnixMs - first.startUnixMs);
  const serviceName: string | null = serviceNameFor(clock, root.serviceId);
  const offsetMs: number = alignTelemetryOffsetMs(
    first.startUnixMs,
    clock.startTimeUnixMs,
    clock.alignment,
  );
  const meta: Array<string> = [];

  if (serviceName) {
    meta.push(serviceName);
  }

  meta.push(formatSignalDuration(durationMs));
  meta.push(sorted.length === 1 ? "1 span" : `${sorted.length} spans`);

  const waterfallSpans: Array<SpanFacts> = sorted.slice(
    0,
    REPLAY_TRACE_WATERFALL_MAX_SPANS,
  );

  const detail: ReplaySpanSignalDetail = {
    traceId: root.traceId,
    rootSpanId: root.spanId,
    rootName: root.name,
    serviceId: root.serviceId,
    serviceName: serviceName,
    durationMs: durationMs,
    spanCount: sorted.length,
    errorSpanCount: errorSpanCount,
    hasError: errorSpanCount > 0,
    startUnixMs: first.startUnixMs,
    baselineOffsetMs: first.startUnixMs - clock.startTimeUnixMs,
    spans: buildWaterfall(waterfallSpans, first.startUnixMs, clock),
    isWaterfallTruncated: sorted.length > REPLAY_TRACE_WATERFALL_MAX_SPANS,
  };

  return {
    id: makeSpanSignalId(root.spanId),
    kind: "span",
    source: "telemetry",
    offsetMs: offsetMs,
    endOffsetMs: offsetMs + durationMs,
    severity: errorSpanCount > 0 ? "error" : "info",
    title: toTitle(root.name),
    subtitle: meta.join(" · "),
    links: { traceId: root.traceId, spanId: root.spanId },
    detail: detail,
    alignment: alignmentLabelFor(clock.alignment),
  };
}

/*
 * One signal per trace, active from its first span to its last. Rows
 * without a trace id or a start time are skipped; they cannot be placed.
 * Output order follows the earliest span of each trace.
 */
export function groupSpansIntoTraces(
  rows: Array<Span>,
  clock: ReplayTelemetryClock,
): Array<ReplaySignal> {
  const byTrace: Map<string, Array<SpanFacts>> = new Map<
    string,
    Array<SpanFacts>
  >();

  for (const row of rows) {
    const facts: SpanFacts | null = spanFacts(row);

    if (!facts) {
      continue;
    }

    const bucket: Array<SpanFacts> | undefined = byTrace.get(facts.traceId);

    if (bucket) {
      bucket.push(facts);
    } else {
      byTrace.set(facts.traceId, [facts]);
    }
  }

  const signals: Array<ReplaySignal> = [];

  for (const spans of byTrace.values()) {
    signals.push(traceSignal(spans, clock));
  }

  return signals.sort((a: ReplaySignal, b: ReplaySignal): number => {
    return a.offsetMs - b.offsetMs;
  });
}

/* ---- Merging and the playhead. ---- */

const SOURCE_ORDER: Record<ReplaySignal["source"], number> = {
  recording: 0,
  telemetry: 1,
};

/*
 * Stable merge: by offset, then recording before telemetry (the exact row
 * outranks the placed one at the same instant), then input order. Input
 * order is kept explicitly so the result does not depend on the engine's
 * sort stability.
 */
export function mergeSignals(
  ...lists: Array<Array<ReplaySignal>>
): Array<ReplaySignal> {
  const decorated: Array<{ signal: ReplaySignal; index: number }> = [];
  let index: number = 0;

  for (const list of lists) {
    for (const signal of list) {
      decorated.push({ signal: signal, index: index });
      index++;
    }
  }

  decorated.sort(
    (
      a: { signal: ReplaySignal; index: number },
      b: { signal: ReplaySignal; index: number },
    ): number => {
      if (a.signal.offsetMs !== b.signal.offsetMs) {
        return a.signal.offsetMs - b.signal.offsetMs;
      }

      const sourceDelta: number =
        SOURCE_ORDER[a.signal.source] - SOURCE_ORDER[b.signal.source];

      if (sourceDelta !== 0) {
        return sourceDelta;
      }

      return a.index - b.index;
    },
  );

  return decorated.map(
    (entry: { signal: ReplaySignal; index: number }): ReplaySignal => {
      return entry.signal;
    },
  );
}

/*
 * The row the playhead has most recently passed, in a list sorted by
 * offset: the last row with offsetMs <= currentTimeMs, -1 before the
 * first. Same rule the old panel used.
 *
 * selectedSignalId resolves the pre-roll contradiction: clicking a row
 * seeks to offset - REPLAY_SIGNAL_SEEK_PRE_ROLL_MS, which by the plain
 * rule makes the PREVIOUS row active and dims the one just clicked. While
 * the playhead sits inside the selected row's pre-roll window the selected
 * row stays active; once the playhead moves on, the plain rule applies.
 */
export function getActiveSignalIndex(
  signals: Array<ReplaySignal>,
  currentTimeMs: number,
  selectedSignalId?: string | undefined,
): number {
  let index: number = -1;

  for (let i: number = 0; i < signals.length; i++) {
    const signal: ReplaySignal | undefined = signals[i];

    if (!signal) {
      break;
    }

    if (signal.offsetMs <= currentTimeMs) {
      index = i;
    } else {
      break;
    }
  }

  if (selectedSignalId) {
    const selectedIndex: number = signals.findIndex(
      (signal: ReplaySignal): boolean => {
        return signal.id === selectedSignalId;
      },
    );

    if (selectedIndex !== -1) {
      const selected: ReplaySignal = signals[selectedIndex] as ReplaySignal;

      if (
        currentTimeMs < selected.offsetMs &&
        currentTimeMs >= selected.offsetMs - REPLAY_SIGNAL_SEEK_PRE_ROLL_MS
      ) {
        return selectedIndex;
      }
    }
  }

  return index;
}

/* A trace stays "live" for its whole duration; everything else is a point. */
export function isSignalActiveAt(
  signal: ReplaySignal,
  currentTimeMs: number,
): boolean {
  const endMs: number = isFiniteNumber(signal.endOffsetMs)
    ? Math.max(signal.endOffsetMs, signal.offsetMs)
    : signal.offsetMs;

  return currentTimeMs >= signal.offsetMs && currentTimeMs <= endMs;
}

/* ---- Cross-references between rows. ---- */

/* traceId -> the trace row, for "Backend for this request". */
export function indexTraceSignalsByTraceId(
  signals: Array<ReplaySignal>,
): Map<string, ReplaySignal> {
  const index: Map<string, ReplaySignal> = new Map<string, ReplaySignal>();

  for (const signal of signals) {
    if (signal.kind !== "span" || !signal.links.traceId) {
      continue;
    }

    if (!index.has(signal.links.traceId)) {
      index.set(signal.links.traceId, signal);
    }
  }

  return index;
}

/* Error-severity log rows on a trace, for the request's backend block. */
export function findErrorLogsForTrace(
  signals: Array<ReplaySignal>,
  traceId: string,
): Array<ReplaySignal> {
  if (!traceId) {
    return [];
  }

  return signals.filter((signal: ReplaySignal): boolean => {
    return (
      signal.kind === "log" &&
      signal.severity === "error" &&
      signal.links.traceId === traceId
    );
  });
}

export interface ReplayErrorPair {
  clientSignalId: string;
  serverSignalId: string;
  /* server offset - client offset; negative when the server saw it first. */
  gapMs: number;
}

function normaliseErrorMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

/*
 * A client error and a server exception with the same message within
 * REPLAY_ERROR_PAIRING_WINDOW_MS are the same failure seen from both ends.
 * They are linked ("also reported server-side"), never collapsed: each
 * side carries detail the other lacks (stack vs. fingerprint). Each client
 * row pairs with at most its nearest server row and vice versa.
 */
export function pairClientAndServerErrors(
  signals: Array<ReplaySignal>,
  windowMs: number = REPLAY_ERROR_PAIRING_WINDOW_MS,
): Array<ReplayErrorPair> {
  const clientErrors: Array<ReplaySignal> = signals.filter(
    (signal: ReplaySignal): boolean => {
      return signal.kind === "client-error";
    },
  );
  const serverErrors: Array<ReplaySignal> = signals.filter(
    (signal: ReplaySignal): boolean => {
      return signal.kind === "server-error";
    },
  );

  if (clientErrors.length === 0 || serverErrors.length === 0) {
    return [];
  }

  const pairs: Array<ReplayErrorPair> = [];
  const usedServerIds: Set<string> = new Set<string>();

  for (const client of clientErrors) {
    const clientDetail: ReplayClientErrorSignalDetail =
      client.detail as ReplayClientErrorSignalDetail;
    const clientMessage: string = normaliseErrorMessage(
      typeof clientDetail.message === "string"
        ? clientDetail.message
        : client.title,
    );

    if (!clientMessage) {
      continue;
    }

    let best: ReplaySignal | null = null;
    let bestGap: number = Number.POSITIVE_INFINITY;

    for (const server of serverErrors) {
      if (usedServerIds.has(server.id)) {
        continue;
      }

      const serverDetail: ReplayServerErrorSignalDetail =
        server.detail as ReplayServerErrorSignalDetail;
      const serverMessage: string = normaliseErrorMessage(
        typeof serverDetail.message === "string" ? serverDetail.message : "",
      );
      const typedMessage: string = serverDetail.exceptionType
        ? normaliseErrorMessage(
            `${serverDetail.exceptionType}: ${serverDetail.message || ""}`,
          )
        : "";

      if (clientMessage !== serverMessage && clientMessage !== typedMessage) {
        continue;
      }

      const gap: number = server.offsetMs - client.offsetMs;

      if (Math.abs(gap) > windowMs) {
        continue;
      }

      if (Math.abs(gap) < Math.abs(bestGap)) {
        best = server;
        bestGap = gap;
      }
    }

    if (best) {
      usedServerIds.add(best.id);
      pairs.push({
        clientSignalId: client.id,
        serverSignalId: best.id,
        gapMs: bestGap,
      });
    }
  }

  return pairs;
}

/* signalId -> counterpart id, both directions, for row badges. */
export function buildErrorCounterpartIndex(
  pairs: Array<ReplayErrorPair>,
): Map<string, string> {
  const index: Map<string, string> = new Map<string, string>();

  for (const pair of pairs) {
    index.set(pair.clientSignalId, pair.serverSignalId);
    index.set(pair.serverSignalId, pair.clientSignalId);
  }

  return index;
}

/*
 * "error 0.4s after this click": the first client error within windowMs
 * AFTER an interaction row, for the interaction's detail cross-reference.
 */
export function findErrorAfterInteraction(
  signals: Array<ReplaySignal>,
  interaction: ReplaySignal,
  windowMs: number = REPLAY_ERROR_PAIRING_WINDOW_MS,
): ReplaySignal | null {
  let best: ReplaySignal | null = null;

  for (const signal of signals) {
    if (signal.kind !== "client-error") {
      continue;
    }

    const gap: number = signal.offsetMs - interaction.offsetMs;

    if (gap < 0 || gap > windowMs) {
      continue;
    }

    if (!best || signal.offsetMs < best.offsetMs) {
      best = signal;
    }
  }

  return best;
}
