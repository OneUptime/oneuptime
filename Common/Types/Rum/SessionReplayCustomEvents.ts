import { SessionRotationReason } from "../../Utils/Rum/SessionIdentity";
import { isSessionReplayStringMap } from "../../Utils/Rum/SessionReplayStringMap";

/*
 * The rrweb type-5 custom events the recorder embeds in the payload
 * stream, and the shape of each one's payload.
 *
 * This is the vocabulary the player's rail, timeline and inactivity map
 * are built on, so it lives in Common where the recorder (which emits
 * them), the ChunkLoader (which extracts them) and the tests (which pin
 * both) read one definition. Every tag is additive-only: stored payloads
 * quote these strings, so nothing here is ever renamed or removed.
 *
 * On the wire an event is { type: 5, timestamp, data: { tag, payload } }.
 * The payload crosses a version boundary in both directions - an old
 * recorder against a new player and the reverse - so every reader goes
 * through the type guards below, which check the MINIMUM a row needs and
 * treat everything else as optional. An unrecognised payload costs that
 * one row, never the chunk.
 */

/*
 * Spelled out as an interface of literal types (rather than `as const`) so
 * every member keeps its exact string type under the repo's explicit
 * type-annotation rule, and so a typo in a consumer is a compile error.
 */
export interface SessionReplayCustomEventTagMap {
  /* console.error / console.warn, masked. */
  readonly Console: "oneuptime.console";
  /* One completed fetch / XHR: method, scrubbed URL, status, timing. */
  readonly Network: "oneuptime.network";
  /* History API / hash navigation inside a single page load. */
  readonly Route: "oneuptime.route";
  /* Uncaught error or unhandled rejection, masked. */
  readonly Error: "oneuptime.error";
  /* Rage, dead and error clicks, refresh rage. */
  readonly Frustration: "oneuptime.frustration";
  /* A performance budget exceeded, or (newer recorders) a web vital. */
  readonly Performance: "oneuptime.performance";
  /* The page came back from the back/forward cache. */
  readonly BfcacheRestore: "oneuptime.bfcache-restore";
  /* First event of a rolled-over session, naming the id it replaced. */
  readonly SessionRotated: "oneuptime.session-rotated";

  /* Every click, with a masked label. Capped per chunk. */
  readonly Click: "oneuptime.click";
  /* Emitted once per chunk when the click cap was hit. */
  readonly ClickDropped: "oneuptime.click-dropped";
  /* document.visibilityState changed; feeds "tab in background" bands. */
  readonly Visibility: "oneuptime.visibility";
  /* track(name, properties) from the host page. Capped per chunk. */
  readonly Custom: "oneuptime.custom";
  /* Emitted once per chunk when the custom-event cap was hit. */
  readonly CustomDropped: "oneuptime.custom-dropped";
  /* identify() was called. Carries whether traits came with it, never the ref. */
  readonly Identify: "oneuptime.identify";
  /* setTags()/addTag() changed the session's tag map. */
  readonly Tags: "oneuptime.tags";
}

export const SessionReplayCustomEventTag: SessionReplayCustomEventTagMap = {
  Console: "oneuptime.console",
  Network: "oneuptime.network",
  Route: "oneuptime.route",
  Error: "oneuptime.error",
  Frustration: "oneuptime.frustration",
  Performance: "oneuptime.performance",
  BfcacheRestore: "oneuptime.bfcache-restore",
  SessionRotated: "oneuptime.session-rotated",
  Click: "oneuptime.click",
  ClickDropped: "oneuptime.click-dropped",
  Visibility: "oneuptime.visibility",
  Custom: "oneuptime.custom",
  CustomDropped: "oneuptime.custom-dropped",
  Identify: "oneuptime.identify",
  Tags: "oneuptime.tags",
};

export type SessionReplayCustomEventTagValue =
  SessionReplayCustomEventTagMap[keyof SessionReplayCustomEventTagMap];

/* Every tag, for "is this one of ours" checks and exhaustiveness tests. */
export const SESSION_REPLAY_CUSTOM_EVENT_TAGS: ReadonlyArray<SessionReplayCustomEventTagValue> =
  Object.values(SessionReplayCustomEventTag);

/* rrweb's EventType.Custom. Declared here so readers stay rrweb-free. */
export const SESSION_REPLAY_RRWEB_CUSTOM_EVENT_TYPE: number = 5;

/* The `data` half of an rrweb custom event. */
export interface SessionReplayCustomEventData {
  tag: string;
  payload: unknown;
}

/* ---- Payloads the recorder already emits, field for field. ---- */

export type SessionReplayConsoleLevel = "error" | "warn";

export interface SessionReplayConsolePayload {
  level: SessionReplayConsoleLevel;
  message: string;
}

export interface SessionReplayNetworkPayload {
  method: string;
  /* Scrubbed: origin + path, no query, no fragment. */
  url: string;
  /* 0 when the request never completed. */
  status: number;
  durationMs: number;
  responseBytes: number;
  /* status === 0 || status >= 500, decided by the recorder. */
  isError: boolean;
  /* Present only when the request carried a traceparent. */
  traceId?: string;
  /*
   * Additive fields newer recorders send. Never headers, never bodies.
   */
  initiator?: "fetch" | "xhr";
  requestBytes?: number;
  /*
   * The page cancelled the request (AbortError / xhr.abort()). status is 0
   * and isError is false: a cancelled request is not a failed one, and
   * counting it as failed would paint every navigation-away red.
   */
  aborted?: boolean;
  /*
   * One entry per session at the per-session request cap, with an empty
   * method/url, so the rail can show WHERE network capture stopped rather
   * than silently ending the list.
   */
  isCapMarker?: boolean;
}

export type SessionReplayRouteKind =
  | "pushState"
  | "replaceState"
  | "popstate"
  | "hashchange";

export interface SessionReplayRoutePayload {
  from: string;
  to: string;
  kind: SessionReplayRouteKind;
}

export type SessionReplayErrorKind = "error" | "unhandledrejection";

export interface SessionReplayErrorPayload {
  kind: SessionReplayErrorKind;
  /* Masked. */
  message: string;
  source?: string;
  lineNumber?: number;
  columnNumber?: number;
  stack?: string;
  /*
   * Set when the error happened BEFORE recording started and was replayed
   * from the early-error buffer, so the row can carry its honest time.
   */
  occurredAtUnixMs?: number;
}

export type SessionReplayFrustrationKind =
  | "rage-click"
  | "dead-click"
  | "error-click"
  | "refresh-rage";

export interface SessionReplayFrustrationPayload {
  kind: SessionReplayFrustrationKind;
  atUnixMs: number;
  /* Present for click-derived signals. Viewport coordinates, never content. */
  x?: number;
  y?: number;
  /* Number of clicks in the cluster, for rage clicks. */
  clickCount?: number;
  /* Number of reloads in the window, for refresh rage. */
  reloadCount?: number;
}

export type SessionReplayPerformanceBudgetKind =
  | "lcp"
  | "long-task"
  | "slow-request";

/* A configured budget was exceeded. This is what fires the perf trigger. */
export interface SessionReplayPerformanceBudgetPayload {
  kind: SessionReplayPerformanceBudgetKind;
  /* For lcp this is the render time from navigation start. */
  durationMs: number;
  /* The budget that was exceeded, so playback can show both numbers. */
  budgetMs: number;
  /* Scrubbed URL for slow-request; absent otherwise. */
  url?: string;
  /*
   * Wall-clock time the entry HAPPENED (performance.timeOrigin +
   * entry.startTime), not the time the recorder got round to emitting it.
   * An LCP is reported at its own observer callback and a long task after
   * it ends, so without this the marker lands wherever the event queue
   * flushed rather than on the moment the viewer is looking for. Optional:
   * a recorder older than the field omits it and the player falls back to
   * the rrweb event's own timestamp.
   */
  occurredAtUnixMs?: number;
}

export type SessionReplayWebVitalMetric =
  | "LCP"
  | "CLS"
  | "INP"
  | "FCP"
  | "TTFB";

export type SessionReplayWebVitalRating = "good" | "needs-improvement" | "poor";

/*
 * A web vital observed once per metric per page. Informational only:
 * vitals never trigger an upload, and CLS's value is unitless while the
 * others are milliseconds.
 */
export interface SessionReplayWebVitalPayload {
  kind: "web-vital";
  metric: SessionReplayWebVitalMetric;
  value: number;
  rating: SessionReplayWebVitalRating;
  url?: string;
  /*
   * As on SessionReplayPerformanceBudgetPayload: when the measured entry
   * happened, in wall-clock ms. Vitals are reported late by design (CLS
   * and INP only settle at page hide), so the emit time can be minutes
   * after the moment the number describes. Optional for older recorders.
   */
  occurredAtUnixMs?: number;
}

export type SessionReplayPerformancePayload =
  | SessionReplayPerformanceBudgetPayload
  | SessionReplayWebVitalPayload;

export interface SessionReplayBfcacheRestorePayload {
  restoredAtUnixMs: number;
}

export interface SessionReplaySessionRotatedPayload {
  previousSessionId: string;
  rotationReason: SessionRotationReason;
  rotatedAtUnixMs: number;
}

/* ---- Payloads introduced with the engagement work. ---- */

export interface SessionReplayClickPayload {
  /* tag#id.class1.class2, up to 3 ancestors; never attribute values. */
  selector: string;
  /*
   * aria-label / name / text content after the active masking transform,
   * capped at SESSION_REPLAY_MAX_CLICK_TEXT_LENGTH. Omitted under
   * MaskAllText.
   */
  text?: string;
  /* Viewport coordinates, for the "show on stage" ring. */
  x: number;
  y: number;
  atUnixMs: number;
}

export interface SessionReplayClickDroppedPayload {
  /* Clicks past the per-chunk cap that were not labelled. */
  count: number;
}

export type SessionReplayVisibilityState = "hidden" | "visible";

export interface SessionReplayVisibilityPayload {
  state: SessionReplayVisibilityState;
  atUnixMs: number;
}

export interface SessionReplayCustomPayload {
  /* track() name, capped at SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH. */
  name: string;
  /* Already sanitised through SessionReplayStringMap and masked. */
  properties?: Record<string, string>;
}

export interface SessionReplayCustomDroppedPayload {
  count: number;
}

/*
 * Deliberately carries NO reference and NO traits: those ride on the chunk
 * meta under the identity ACL. The event only marks the moment identify()
 * was called so the rail can show "user identified here".
 */
export interface SessionReplayIdentifyPayload {
  hasTraits: boolean;
}

export interface SessionReplayTagsPayload {
  tags: Record<string, string>;
}

/* ---- Type guards. Minimum required fields only; the rest is optional. ---- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
): value is T {
  return (
    typeof value === "string" &&
    (allowed as ReadonlyArray<string>).includes(value)
  );
}

const CONSOLE_LEVELS: ReadonlyArray<SessionReplayConsoleLevel> = [
  "error",
  "warn",
];

const ROUTE_KINDS: ReadonlyArray<SessionReplayRouteKind> = [
  "pushState",
  "replaceState",
  "popstate",
  "hashchange",
];

const ERROR_KINDS: ReadonlyArray<SessionReplayErrorKind> = [
  "error",
  "unhandledrejection",
];

const FRUSTRATION_KINDS: ReadonlyArray<SessionReplayFrustrationKind> = [
  "rage-click",
  "dead-click",
  "error-click",
  "refresh-rage",
];

const PERFORMANCE_BUDGET_KINDS: ReadonlyArray<SessionReplayPerformanceBudgetKind> =
  ["lcp", "long-task", "slow-request"];

const WEB_VITAL_METRICS: ReadonlyArray<SessionReplayWebVitalMetric> = [
  "LCP",
  "CLS",
  "INP",
  "FCP",
  "TTFB",
];

const WEB_VITAL_RATINGS: ReadonlyArray<SessionReplayWebVitalRating> = [
  "good",
  "needs-improvement",
  "poor",
];

const VISIBILITY_STATES: ReadonlyArray<SessionReplayVisibilityState> = [
  "hidden",
  "visible",
];

export function isSessionReplayCustomEventTag(
  value: unknown,
): value is SessionReplayCustomEventTagValue {
  return isOneOf(value, SESSION_REPLAY_CUSTOM_EVENT_TAGS);
}

/*
 * The `data` of an rrweb event, when it is one of ours. Does not check the
 * event's `type`; callers filter on SESSION_REPLAY_RRWEB_CUSTOM_EVENT_TYPE
 * first because rrweb's own events also carry a `data` object.
 */
export function isSessionReplayCustomEventData(
  value: unknown,
): value is SessionReplayCustomEventData {
  return isRecord(value) && typeof value["tag"] === "string";
}

export function isSessionReplayConsolePayload(
  value: unknown,
): value is SessionReplayConsolePayload {
  return (
    isRecord(value) &&
    isOneOf(value["level"], CONSOLE_LEVELS) &&
    typeof value["message"] === "string"
  );
}

export function isSessionReplayNetworkPayload(
  value: unknown,
): value is SessionReplayNetworkPayload {
  /*
   * method/url/status are the row; timing, bytes and isError have safe
   * defaults on the reader side, and traceId is optional on the wire.
   */
  return (
    isRecord(value) &&
    typeof value["method"] === "string" &&
    typeof value["url"] === "string" &&
    isFiniteNumber(value["status"])
  );
}

export function isSessionReplayRoutePayload(
  value: unknown,
): value is SessionReplayRoutePayload {
  return (
    isRecord(value) &&
    typeof value["from"] === "string" &&
    typeof value["to"] === "string" &&
    isOneOf(value["kind"], ROUTE_KINDS)
  );
}

export function isSessionReplayErrorPayload(
  value: unknown,
): value is SessionReplayErrorPayload {
  return (
    isRecord(value) &&
    isOneOf(value["kind"], ERROR_KINDS) &&
    typeof value["message"] === "string"
  );
}

export function isSessionReplayFrustrationPayload(
  value: unknown,
): value is SessionReplayFrustrationPayload {
  return (
    isRecord(value) &&
    isOneOf(value["kind"], FRUSTRATION_KINDS) &&
    isFiniteNumber(value["atUnixMs"])
  );
}

export function isSessionReplayPerformanceBudgetPayload(
  value: unknown,
): value is SessionReplayPerformanceBudgetPayload {
  return (
    isRecord(value) &&
    isOneOf(value["kind"], PERFORMANCE_BUDGET_KINDS) &&
    isFiniteNumber(value["durationMs"]) &&
    isFiniteNumber(value["budgetMs"])
  );
}

export function isSessionReplayWebVitalPayload(
  value: unknown,
): value is SessionReplayWebVitalPayload {
  return (
    isRecord(value) &&
    value["kind"] === "web-vital" &&
    isOneOf(value["metric"], WEB_VITAL_METRICS) &&
    isFiniteNumber(value["value"]) &&
    isOneOf(value["rating"], WEB_VITAL_RATINGS)
  );
}

export function isSessionReplayPerformancePayload(
  value: unknown,
): value is SessionReplayPerformancePayload {
  return (
    isSessionReplayPerformanceBudgetPayload(value) ||
    isSessionReplayWebVitalPayload(value)
  );
}

export function isSessionReplayBfcacheRestorePayload(
  value: unknown,
): value is SessionReplayBfcacheRestorePayload {
  return isRecord(value) && isFiniteNumber(value["restoredAtUnixMs"]);
}

export function isSessionReplaySessionRotatedPayload(
  value: unknown,
): value is SessionReplaySessionRotatedPayload {
  return (
    isRecord(value) &&
    typeof value["previousSessionId"] === "string" &&
    isOneOf(value["rotationReason"], Object.values(SessionRotationReason)) &&
    isFiniteNumber(value["rotatedAtUnixMs"])
  );
}

export function isSessionReplayClickPayload(
  value: unknown,
): value is SessionReplayClickPayload {
  return (
    isRecord(value) &&
    typeof value["selector"] === "string" &&
    isFiniteNumber(value["x"]) &&
    isFiniteNumber(value["y"]) &&
    isFiniteNumber(value["atUnixMs"]) &&
    (value["text"] === undefined || typeof value["text"] === "string")
  );
}

export function isSessionReplayClickDroppedPayload(
  value: unknown,
): value is SessionReplayClickDroppedPayload {
  return isRecord(value) && isFiniteNumber(value["count"]);
}

export function isSessionReplayVisibilityPayload(
  value: unknown,
): value is SessionReplayVisibilityPayload {
  return (
    isRecord(value) &&
    isOneOf(value["state"], VISIBILITY_STATES) &&
    isFiniteNumber(value["atUnixMs"])
  );
}

export function isSessionReplayCustomPayload(
  value: unknown,
): value is SessionReplayCustomPayload {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    value["name"].length > 0 &&
    (value["properties"] === undefined ||
      isSessionReplayStringMap(value["properties"]))
  );
}

export function isSessionReplayCustomDroppedPayload(
  value: unknown,
): value is SessionReplayCustomDroppedPayload {
  return isRecord(value) && isFiniteNumber(value["count"]);
}

export function isSessionReplayIdentifyPayload(
  value: unknown,
): value is SessionReplayIdentifyPayload {
  return isRecord(value) && typeof value["hasTraits"] === "boolean";
}

export function isSessionReplayTagsPayload(
  value: unknown,
): value is SessionReplayTagsPayload {
  return isRecord(value) && isSessionReplayStringMap(value["tags"]);
}
