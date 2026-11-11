/*
 * Product analytics, part two (issue #6444): the application's own events
 * and metrics, sent by the RUM recorders from EVERY session - recorded or
 * not - and read back as event trends, funnels and retention.
 *
 * Part one (ProductAnalytics.ts) counts the sessions Session Replay
 * records. This part adds a second, light channel beside the recordings: a
 * small JSON batch of events (a session started, a page was viewed, the page
 * called track()) and metric points (metric()) that the recorders post to
 * PRODUCT_ANALYTICS_EVENTS_PATH whatever the replay sample decided. The
 * events land in RumProductAnalyticsEventV1, kept for
 * PRODUCT_ANALYTICS_RETENTION_MONTHS like part one's tables; the metric
 * points land in the metric store under the RUM application, where charts,
 * dashboards and Metrics monitors already read.
 *
 * Isomorphic and dependency-free, like everything else in this directory:
 * the browser recorder inlines it into the script served on customers'
 * pages (the React Native recorder sends no events yet; when it does, it
 * mirrors this file as it mirrors the replay contract), and the ingest
 * worker runs the SAME parser over the bytes the recorder sent, so "the
 * server keeps exactly what the client sent" holds by construction.
 * Nothing here may touch Node, the DOM, or a module outside
 * Common/Types/Rum and Common/Utils/Rum. The reads (routes, limits,
 * answers) live in ProductAnalyticsEventReads.ts, so the script on
 * customers' pages carries none of them.
 */

import {
  SessionReplayStringMapLimits,
  sanitizeSessionReplayStringMap,
} from "../../Utils/Rum/SessionReplayStringMap";
import {
  SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_EVENT_PROPERTY_KEYS,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
  SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
  SESSION_REPLAY_VISITOR_ID_PATTERN,
} from "./SessionReplay";

/* ---- Where the recorders post. ---- */

/*
 * The ingest route as the Telemetry router declares it (mounted under every
 * telemetry prefix, like the chunk route), and the path the recorders call,
 * which carries the /telemetry prefix a deployment's reverse proxy routes on.
 */
export const PRODUCT_ANALYTICS_EVENTS_ROUTE: string =
  "/session-replay/v1/events";
export const PRODUCT_ANALYTICS_EVENTS_PATH: string = `/telemetry${PRODUCT_ANALYTICS_EVENTS_ROUTE}`;

/* The batch's wire version. Additive changes keep it; anything else bumps it. */
export const PRODUCT_ANALYTICS_WIRE_VERSION: number = 1;

export const PRODUCT_ANALYTICS_CONTENT_TYPE: string = "application/json";

/* ---- What one batch may hold. Enforced on both sides of the wire. ---- */

/*
 * A batch is one tab's events of one session, sent every few seconds and
 * when the tab is hidden. Small on purpose: the tab's last batch goes out
 * as a keepalive request, and a page's keepalive requests share 64 KB.
 */
export const PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH: number = 100;
export const PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH: number = 100;
export const PRODUCT_ANALYTICS_MAX_BATCH_BYTES: number = 64 * 1024;

/*
 * How many bytes a recorder lets a batch grow to before it sends it, well
 * under the server's cap so the one keepalive request of a closing tab is
 * never refused for its size.
 */
export const PRODUCT_ANALYTICS_TARGET_BATCH_BYTES: number = 24 * 1024;

/* How often a recorder sends what it has, in milliseconds. */
export const PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS: number = 5000;

/*
 * Events a recorder holds while it cannot send them yet (consent not given,
 * the network down): past this, the oldest are dropped.
 */
export const PRODUCT_ANALYTICS_MAX_PENDING_EVENTS: number = 500;

/* An event's name, and its properties: the caps track() already has. */
export const PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH: number =
  SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH;

export const PRODUCT_ANALYTICS_PROPERTY_LIMITS: SessionReplayStringMapLimits = {
  maxKeys: SESSION_REPLAY_MAX_CUSTOM_EVENT_PROPERTY_KEYS,
  maxKeyLength: SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  maxValueLength: SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
};

/*
 * The user properties an event carries: the identify() traits the
 * application chose to keep for analytics, under the trait caps.
 */
export const PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS: SessionReplayStringMapLimits =
  {
    maxKeys: SESSION_REPLAY_MAX_TRAIT_KEYS,
    maxKeyLength: SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
    maxValueLength: SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
  };

/* A page's path, without its query or fragment. */
export const PRODUCT_ANALYTICS_MAX_PAGE_LENGTH: number = 512;

/* The device, browser, system and version a batch says it came from. */
export const PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH: number = 64;

/*
 * Events this old when they arrive are dropped: a recorder that queued them
 * for longer (a phone offline for days) sends history nobody asked about,
 * and a range already read would change under its reader.
 */
export const PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS: number =
  3 * 24 * 60 * 60 * 1000;

/*
 * Events and metric points a project may send in one minute, all its
 * applications together. Over it, the batch is refused with a 429 and the
 * recorder waits for the next minute.
 */
export const PRODUCT_ANALYTICS_MAX_ITEMS_PER_PROJECT_PER_MINUTE: number = 60000;

/* ---- Metric names. ---- */

/*
 * A metric's name: a letter, then letters, digits, "_", ".", "-" or "/",
 * at most PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH long - the OpenTelemetry
 * instrument name rules, so the same name reads the same in every chart.
 */
export const PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH: number = 100;
const METRIC_NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_./-]{0,99}$/;

/*
 * Names in OneUptime's own namespace. A recorder's metric() refuses them all,
 * so nothing a page sends can pass for a series OneUptime writes.
 */
export const PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX: string = "oneuptime.";

/*
 * The series the event pipeline writes itself, counted per minute, so an
 * application's events can be charted, put on a dashboard and alerted on
 * through the metric store. Their prefix is refused at OTLP ingest too
 * (isProductAnalyticsDerivedMetricName) and left out of telemetry billing.
 */
export const PRODUCT_ANALYTICS_DERIVED_METRIC_PREFIX: string =
  "oneuptime.rum.product.";

export enum ProductAnalyticsDerivedMetric {
  /* track() events, by event.name. */
  Events = "oneuptime.rum.product.events",
  /* Sessions started, by device.type. */
  Sessions = "oneuptime.rum.product.sessions",
  /* Pages viewed, by device.type (never by path: one series per page would not end). */
  PageViews = "oneuptime.rum.product.page.views",
}

export const PRODUCT_ANALYTICS_DERIVED_METRICS: ReadonlyArray<ProductAnalyticsDerivedMetric> =
  [
    ProductAnalyticsDerivedMetric.Events,
    ProductAnalyticsDerivedMetric.Sessions,
    ProductAnalyticsDerivedMetric.PageViews,
  ];

/* The attributes the derived series carry. */
export const PRODUCT_ANALYTICS_EVENT_NAME_ATTRIBUTE: string = "event.name";
export const PRODUCT_ANALYTICS_DEVICE_TYPE_ATTRIBUTE: string = "device.type";

/* The minute the derived series count over, in milliseconds. */
export const PRODUCT_ANALYTICS_DERIVED_METRIC_INTERVAL_MS: number = 60000;

export function isProductAnalyticsDerivedMetricName(
  name: string | null | undefined,
): boolean {
  return (
    typeof name === "string" &&
    name
      .trim()
      .toLowerCase()
      .startsWith(PRODUCT_ANALYTICS_DERIVED_METRIC_PREFIX)
  );
}

const DERIVED_METRIC_DESCRIPTIONS: Readonly<
  Record<ProductAnalyticsDerivedMetric, string>
> = {
  [ProductAnalyticsDerivedMetric.Events]:
    "Events the application sent with track(), counted per minute, by event.name.",
  [ProductAnalyticsDerivedMetric.Sessions]:
    "Sessions that started, counted per minute, by device.type.",
  [ProductAnalyticsDerivedMetric.PageViews]:
    "Pages viewed, counted per minute, by device.type.",
};

export function getProductAnalyticsDerivedMetricDescription(
  metric: ProductAnalyticsDerivedMetric,
): string {
  return DERIVED_METRIC_DESCRIPTIONS[metric];
}

/*
 * A name a recorder may send with metric(): the instrument name shape, and
 * not in OneUptime's namespace.
 */
export function isProductAnalyticsMetricName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    METRIC_NAME_PATTERN.test(value) &&
    !value.toLowerCase().startsWith(PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX)
  );
}

/* ---- Events. ---- */

export enum ProductAnalyticsEventKind {
  /* A session started; named "". */
  Session = "session",
  /* A page (a mobile app's screen) was viewed; named by its path. */
  Page = "page",
  /* The application called track(); named as it said. */
  Custom = "custom",
}

export const PRODUCT_ANALYTICS_EVENT_KINDS: ReadonlyArray<ProductAnalyticsEventKind> =
  [
    ProductAnalyticsEventKind.Session,
    ProductAnalyticsEventKind.Page,
    ProductAnalyticsEventKind.Custom,
  ];

export function isProductAnalyticsEventKind(
  value: unknown,
): value is ProductAnalyticsEventKind {
  return PRODUCT_ANALYTICS_EVENT_KINDS.includes(
    value as ProductAnalyticsEventKind,
  );
}

/*
 * One event, as it travels. `at` is the recorder's clock; the server moves
 * it by the difference between the batch's `sentAt` and its own clock.
 */
export interface ProductAnalyticsWireEvent {
  kind: ProductAnalyticsEventKind;
  name: string;
  at: number;
  /* The page the event happened on. */
  page?: string | undefined;
  properties?: Record<string, string> | undefined;
}

export interface ProductAnalyticsWireMetric {
  name: string;
  value: number;
  at: number;
  attributes?: Record<string, string> | undefined;
}

/* What the session runs on: the same values Session Replay files it under. */
export interface ProductAnalyticsWireContext {
  /* desktop, mobile or tablet; "" when unknown. */
  deviceType: string;
  browserName: string;
  osName: string;
  /* A mobile app's version; "" for a web page. */
  appVersion: string;
}

export interface ProductAnalyticsWireBatch {
  v: number;
  /* 32 hex; the same id on a retry, so a batch lands once. */
  batchId: string;
  sessionId: string;
  visitorId: string;
  /*
   * The signed-in user's reference, only when the application captures user
   * identity, and the traits it keeps for analytics.
   */
  userRef?: string | undefined;
  userProperties?: Record<string, string> | undefined;
  /*
   * The page's consent, as a replay chunk reports it ("Granted",
   * "NotRequired", "Unknown"). An application that asks for explicit
   * consent files a batch only when it says "Granted".
   */
  consentState: string;
  sentAt: number;
  context: ProductAnalyticsWireContext;
  events: Array<ProductAnalyticsWireEvent>;
  metrics: Array<ProductAnalyticsWireMetric>;
}

const HEX_32_PATTERN: RegExp = /^[0-9a-f]{32}$/;

/* Where a page's query or fragment begins. */
const QUERY_OR_FRAGMENT_PATTERN: RegExp = /[?#]/;

export function isProductAnalyticsId(value: unknown): value is string {
  return typeof value === "string" && HEX_32_PATTERN.test(value);
}

/*
 * A custom event's name as stored: trimmed, at most
 * PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH long, or null when nothing is left.
 * Control characters are dropped, so a name always prints on one line.
 */
export function toProductAnalyticsEventName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  let name: string = "";

  for (const character of value) {
    const code: number = character.charCodeAt(0);

    if (code < 32 || code === 127) {
      continue;
    }

    name += character;
  }

  name = name.trim().slice(0, PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH).trim();

  return name.length > 0 ? name : null;
}

/*
 * A page as stored: its path, from the first "/", without a query or a
 * fragment. A mobile app's screen name ("Checkout") becomes "/Checkout",
 * the path part one files its sessions' pages under. "" when there is none.
 */
export function toProductAnalyticsPage(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let page: string = value.trim();
  const schemeIndex: number = page.indexOf("://");

  if (schemeIndex >= 0) {
    const pathIndex: number = page.indexOf("/", schemeIndex + 3);
    page = pathIndex >= 0 ? page.slice(pathIndex) : "/";
  }

  const queryIndex: number = page.search(QUERY_OR_FRAGMENT_PATTERN);

  if (queryIndex >= 0) {
    page = page.slice(0, queryIndex);
  }

  if (page.length === 0) {
    return "";
  }

  if (!page.startsWith("/")) {
    page = `/${page}`;
  }

  return page.slice(0, PRODUCT_ANALYTICS_MAX_PAGE_LENGTH);
}

function toContextValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH)
    : "";
}

const DEVICE_TYPES: ReadonlyArray<string> = ["desktop", "mobile", "tablet"];

export function toProductAnalyticsContext(
  value: unknown,
): ProductAnalyticsWireContext {
  const record: Record<string, unknown> =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const deviceType: string = toContextValue(record["deviceType"]);

  return {
    deviceType: DEVICE_TYPES.includes(deviceType) ? deviceType : "",
    browserName: toContextValue(record["browserName"]),
    osName: toContextValue(record["osName"]),
    appVersion: toContextValue(record["appVersion"]),
  };
}

/*
 * The application's list of identify() traits it keeps for analytics, as
 * stored and served: trimmed, without duplicates (ignoring case), at most
 * PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys keys of at most maxKeyLength.
 */
export function normalizeProductAnalyticsUserPropertyKeys(
  value: unknown,
): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const key: string = entry
      .trim()
      .slice(0, PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeyLength);

    if (key.length === 0 || key === "__proto__") {
      continue;
    }

    if (seen.has(key.toLowerCase())) {
      continue;
    }

    seen.add(key.toLowerCase());
    keys.push(key);

    if (keys.length >= PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys) {
      break;
    }
  }

  return keys;
}

/*
 * The traits an event may carry: those the application listed, matched as
 * written, under the trait caps. Any other trait never leaves the page, and
 * the server drops it again if a recorder sent it.
 */
export function pickProductAnalyticsUserProperties(
  traits: unknown,
  allowedKeys: ReadonlyArray<string>,
): Record<string, string> {
  const sanitized: Record<string, string> = sanitizeSessionReplayStringMap(
    traits,
    PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS,
  );
  const picked: Record<string, string> = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
      picked[key] = sanitized[key] as string;
    }
  }

  return picked;
}

/* ---- The server's reading of a batch. ---- */

export interface ProductAnalyticsParsedEvent {
  kind: ProductAnalyticsEventKind;
  name: string;
  /* Server time, unix milliseconds. */
  time: number;
  page: string;
  properties: Record<string, string>;
}

export interface ProductAnalyticsParsedMetric {
  name: string;
  value: number;
  time: number;
  attributes: Record<string, string>;
}

export interface ProductAnalyticsParsedBatch {
  batchId: string;
  sessionId: string;
  visitorId: string;
  userRef: string;
  userProperties: Record<string, string>;
  context: ProductAnalyticsWireContext;
  events: Array<ProductAnalyticsParsedEvent>;
  metrics: Array<ProductAnalyticsParsedMetric>;
  /* Items left out, and why, for the ingest's own counters. */
  droppedEvents: number;
  droppedMetrics: number;
  droppedTooOld: number;
}

export type ProductAnalyticsBatchError =
  | "not-an-object"
  | "unsupported-version"
  | "invalid-batch-id"
  | "invalid-session-id"
  | "invalid-visitor-id"
  | "too-many-events"
  | "too-many-metrics";

export type ProductAnalyticsBatchParseResult =
  | { isValid: true; batch: ProductAnalyticsParsedBatch }
  | { isValid: false; error: ProductAnalyticsBatchError };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/*
 * The batch as the server keeps it. A batch whose ids or size are wrong is
 * refused whole (the recorder that sent it is broken, and the next one will
 * be too); an event or a metric point that is wrong is left out alone and
 * counted, so one bad call on a page does not cost the rest of its batch.
 *
 * Times move by the gap between the recorder's clock and the server's
 * (receivedAt - sentAt), so a phone whose clock is a day out still files
 * its events when they happened; none lands in the future, and one older
 * than PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS is dropped.
 *
 * userProperties keep only allowedUserPropertyKeys; with no userRef (the
 * application does not capture identity, or nobody signed in) there are
 * none at all.
 */
export function parseProductAnalyticsBatch(
  input: unknown,
  options: {
    receivedAtUnixMs: number;
    allowedUserPropertyKeys: ReadonlyArray<string>;
  },
): ProductAnalyticsBatchParseResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { isValid: false, error: "not-an-object" };
  }

  const body: Record<string, unknown> = input as Record<string, unknown>;

  if (body["v"] !== PRODUCT_ANALYTICS_WIRE_VERSION) {
    return { isValid: false, error: "unsupported-version" };
  }

  if (!isProductAnalyticsId(body["batchId"])) {
    return { isValid: false, error: "invalid-batch-id" };
  }

  if (!isProductAnalyticsId(body["sessionId"])) {
    return { isValid: false, error: "invalid-session-id" };
  }

  const rawVisitorId: unknown = body["visitorId"];

  if (
    rawVisitorId !== undefined &&
    rawVisitorId !== "" &&
    !(
      typeof rawVisitorId === "string" &&
      SESSION_REPLAY_VISITOR_ID_PATTERN.test(rawVisitorId)
    )
  ) {
    return { isValid: false, error: "invalid-visitor-id" };
  }

  const rawEvents: Array<unknown> = Array.isArray(body["events"])
    ? (body["events"] as Array<unknown>)
    : [];
  const rawMetrics: Array<unknown> = Array.isArray(body["metrics"])
    ? (body["metrics"] as Array<unknown>)
    : [];

  if (rawEvents.length > PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH) {
    return { isValid: false, error: "too-many-events" };
  }

  if (rawMetrics.length > PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH) {
    return { isValid: false, error: "too-many-metrics" };
  }

  const receivedAt: number = options.receivedAtUnixMs;
  const sentAt: unknown = body["sentAt"];
  const skew: number = isFiniteNumber(sentAt) ? receivedAt - sentAt : 0;
  const oldest: number = receivedAt - PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS;

  let droppedTooOld: number = 0;

  /* null for a time too old to keep; never later than the server's now. */
  const toServerTime: (at: unknown) => number | null = (
    at: unknown,
  ): number | null => {
    const time: number = isFiniteNumber(at)
      ? Math.round(Math.min(at + skew, receivedAt))
      : receivedAt;

    if (time < oldest) {
      droppedTooOld++;
      return null;
    }

    return time;
  };

  const events: Array<ProductAnalyticsParsedEvent> = [];
  let droppedEvents: number = 0;

  for (const rawEvent of rawEvents) {
    if (
      rawEvent === null ||
      typeof rawEvent !== "object" ||
      Array.isArray(rawEvent)
    ) {
      droppedEvents++;
      continue;
    }

    const event: Record<string, unknown> = rawEvent as Record<string, unknown>;
    const kind: unknown = event["kind"];

    if (!isProductAnalyticsEventKind(kind)) {
      droppedEvents++;
      continue;
    }

    const page: string = toProductAnalyticsPage(event["page"]);
    let name: string | null;

    if (kind === ProductAnalyticsEventKind.Session) {
      name = "";
    } else if (kind === ProductAnalyticsEventKind.Page) {
      name = toProductAnalyticsPage(event["name"]) || page || null;
    } else {
      name = toProductAnalyticsEventName(event["name"]);
    }

    if (name === null) {
      droppedEvents++;
      continue;
    }

    const time: number | null = toServerTime(event["at"]);

    if (time === null) {
      continue;
    }

    events.push({
      kind: kind,
      name: name,
      time: time,
      page: kind === ProductAnalyticsEventKind.Page ? name : page,
      properties:
        kind === ProductAnalyticsEventKind.Custom
          ? sanitizeSessionReplayStringMap(
              event["properties"],
              PRODUCT_ANALYTICS_PROPERTY_LIMITS,
            )
          : {},
    });
  }

  const metrics: Array<ProductAnalyticsParsedMetric> = [];
  let droppedMetrics: number = 0;

  for (const rawMetric of rawMetrics) {
    if (
      rawMetric === null ||
      typeof rawMetric !== "object" ||
      Array.isArray(rawMetric)
    ) {
      droppedMetrics++;
      continue;
    }

    const metric: Record<string, unknown> = rawMetric as Record<
      string,
      unknown
    >;

    if (
      !isProductAnalyticsMetricName(metric["name"]) ||
      !isFiniteNumber(metric["value"])
    ) {
      droppedMetrics++;
      continue;
    }

    const time: number | null = toServerTime(metric["at"]);

    if (time === null) {
      continue;
    }

    metrics.push({
      name: metric["name"],
      value: metric["value"],
      time: time,
      attributes: sanitizeSessionReplayStringMap(
        metric["attributes"],
        PRODUCT_ANALYTICS_PROPERTY_LIMITS,
      ),
    });
  }

  const rawUserRef: unknown = body["userRef"];
  const userRef: string =
    typeof rawUserRef === "string"
      ? rawUserRef.trim().slice(0, SESSION_REPLAY_MAX_USER_REF_LENGTH)
      : "";

  return {
    isValid: true,
    batch: {
      batchId: body["batchId"] as string,
      sessionId: body["sessionId"] as string,
      visitorId: typeof rawVisitorId === "string" ? rawVisitorId : "",
      userRef: userRef,
      userProperties: userRef
        ? pickProductAnalyticsUserProperties(
            body["userProperties"],
            options.allowedUserPropertyKeys,
          )
        : {},
      context: toProductAnalyticsContext(body["context"]),
      events: events,
      metrics: metrics,
      droppedEvents: droppedEvents,
      droppedMetrics: droppedMetrics,
      droppedTooOld: droppedTooOld,
    },
  };
}

/* ---- What the recorders learn from the replay config. ---- */

/*
 * The optional `productAnalytics` field of the replay config. Absent - an
 * older server, or an application with product analytics off - reads as
 * off, so a recorder never sends a batch nobody asked for.
 */
export interface ProductAnalyticsRecorderConfig {
  enabled: boolean;
  /* The identify() traits events may carry. */
  userPropertyKeys: Array<string>;
}

export function readProductAnalyticsRecorderConfig(
  value: unknown,
): ProductAnalyticsRecorderConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { enabled: false, userPropertyKeys: [] };
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return {
    enabled: record["enabled"] === true,
    userPropertyKeys: normalizeProductAnalyticsUserPropertyKeys(
      record["userPropertyKeys"],
    ),
  };
}
