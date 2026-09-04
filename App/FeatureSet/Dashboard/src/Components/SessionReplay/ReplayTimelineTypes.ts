import {
  SessionReplayConsoleLevel,
  SessionReplayErrorKind,
  SessionReplayFrustrationKind,
  SessionReplayPerformanceBudgetKind,
  SessionReplayRouteKind,
  SessionReplayVisibilityState,
  SessionReplayWebVitalMetric,
  SessionReplayWebVitalRating,
} from "Common/Types/Rum/SessionReplayCustomEvents";

/*
 * A timeline event lifted out of one decoded chunk: the recorder's type-5
 * custom events (console, network, route, error, frustration, performance,
 * click, visibility, custom, identify, tags), plus two rows derived from
 * rrweb's own stream for recordings that predate the click recorder
 * ("navigation" from Meta events on full loads, "click" from
 * MouseInteraction when a chunk carries no oneuptime.click).
 *
 * ChunkLoader.extractTimelineEvents produces these; Rail/ReplaySignals.ts
 * turns them into ReplaySignal rows; the inactivity map reads the
 * visibility rows and activity intervals. Every per-kind field is
 * optional because one interface covers every kind, and readers branch on
 * `kind` before touching them.
 */

export type ReplayTimelineEventKind =
  | "console"
  | "network"
  | "route"
  | "error"
  | "frustration"
  | "performance"
  | "click"
  | "visibility"
  | "custom"
  | "identify"
  | "tags"
  /* rrweb Meta on a full page load (not a history-API route change). */
  | "navigation"
  /* Recorder cap notices: N clicks / custom events were not labelled. */
  | "click-dropped"
  | "custom-dropped";

export const REPLAY_TIMELINE_EVENT_KINDS: ReadonlyArray<ReplayTimelineEventKind> =
  [
    "console",
    "network",
    "route",
    "error",
    "frustration",
    "performance",
    "click",
    "visibility",
    "custom",
    "identify",
    "tags",
    "navigation",
    "click-dropped",
    "custom-dropped",
  ];

export interface ReplayTimelineEvent {
  /* rec:<chunkIndex>:<ordinal>, see Rail/ReplaySignalTypes.ts. */
  id: string;
  kind: ReplayTimelineEventKind;
  chunkIndex: number;
  /* Position on the session clock, clamped to the chunk's window. */
  offsetMs: number;
  /*
   * The recorder's wall clock for the event, when the payload carried one
   * (frustration, click, visibility, and errors replayed from before
   * recording started). Lets a row be paired with server-stamped rows.
   */
  atUnixMs?: number;

  /* console + error */
  level?: SessionReplayConsoleLevel | string;
  message?: string;

  /* network */
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  responseBytes?: number;
  requestBytes?: number;
  isError?: boolean;
  initiator?: "fetch" | "xhr";
  /*
   * The W3C trace id this request carried, when the page (or the
   * recorder's own traceparent injection) put one on the wire. This is
   * what lets a request row link to the backend trace of the call that
   * failed, and what trace anchoring pairs against.
   */
  traceId?: string;

  /* route + navigation */
  from?: string;
  to?: string;
  routeKind?: SessionReplayRouteKind;

  /* error */
  errorKind?: SessionReplayErrorKind;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: string;

  /* frustration */
  frustrationKind?: SessionReplayFrustrationKind;
  clickCount?: number;
  reloadCount?: number;

  /* frustration + click: viewport coordinates, never content. */
  x?: number;
  y?: number;

  /* performance (budget variant) */
  performanceKind?: SessionReplayPerformanceBudgetKind | "web-vital";
  budgetMs?: number;

  /* performance (web-vital variant) */
  metric?: SessionReplayWebVitalMetric;
  value?: number;
  rating?: SessionReplayWebVitalRating;

  /* click */
  selector?: string;
  text?: string;

  /* visibility */
  visibilityState?: SessionReplayVisibilityState;

  /* custom */
  name?: string;
  properties?: Record<string, string>;

  /* identify */
  hasTraits?: boolean;

  /* tags */
  tags?: Record<string, string>;

  /* click-dropped + custom-dropped */
  droppedCount?: number;
}

/*
 * A stretch of one chunk during which the user was doing something:
 * rrweb MouseMove/MouseInteraction/Scroll/Input/TouchMove or one of the
 * recorder's route/frustration/click events. The complement, over
 * SESSION_REPLAY_IDLE_THRESHOLD_MS, is an idle band.
 */
export interface ReplayActivityInterval {
  startMs: number;
  endMs: number;
  chunkIndex: number;
}

/*
 * Per-kind caps applied during extraction, so a page that logs in a loop
 * cannot push every other kind out of a bounded map. When a kind hits its
 * cap the kind is listed in truncatedKinds and the rail says so.
 */
export const REPLAY_TIMELINE_EXTRACTION_CAPS: Record<
  ReplayTimelineEventKind,
  number
> = {
  console: 1500,
  network: 2000,
  click: 2000,
  frustration: 2000,
  route: 500,
  navigation: 500,
  error: 500,
  performance: 500,
  visibility: 500,
  custom: 500,
  identify: 500,
  tags: 500,
  "click-dropped": 500,
  "custom-dropped": 500,
};

export interface ReplayTimelineExtractionStats {
  /* Rows kept per kind across the loaded chunks. Absent kind = none seen. */
  countsByKind: Partial<Record<ReplayTimelineEventKind, number>>;
  /* Kinds whose cap was hit; rows past it were dropped, oldest kept. */
  truncatedKinds: Array<ReplayTimelineEventKind>;
  activityIntervals: Array<ReplayActivityInterval>;
}

export function makeEmptyExtractionStats(): ReplayTimelineExtractionStats {
  return {
    countsByKind: {},
    truncatedKinds: [],
    activityIntervals: [],
  };
}
