/*
 * Build-time copy of the product analytics wire contract (issue #6629):
 * what Common's Types/Rum/ProductAnalyticsEvents.ts says a recorder sends to
 * the events route - the batch, its limits, the event kinds, the metric
 * name rule and the config field that switches it on. This package is
 * installed in customer React Native applications and must not pull the
 * OneUptime monorepo's Common package into their bundle, so it carries a
 * copy, as Contract.ts carries the replay contract. ContractParity holds
 * every constant, type and rule here identical to Common's.
 */

/* ---- Where the recorder posts. ---- */

export const PRODUCT_ANALYTICS_EVENTS_PATH: string =
  "/telemetry/session-replay/v1/events";

/* The batch's wire version. Additive changes keep it; anything else bumps it. */
export const PRODUCT_ANALYTICS_WIRE_VERSION: number = 1;

export const PRODUCT_ANALYTICS_CONTENT_TYPE: string = "application/json";

/* ---- What one batch may hold. Enforced on both sides of the wire. ---- */

export const PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH: number = 100;
export const PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH: number = 100;
export const PRODUCT_ANALYTICS_MAX_BATCH_BYTES: number = 64 * 1024;

/* How large a batch grows before it is sent, well under the server's cap. */
export const PRODUCT_ANALYTICS_TARGET_BATCH_BYTES: number = 24 * 1024;

/* How often the recorder sends what it has, in milliseconds. */
export const PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS: number = 5000;

/*
 * Events (and, apart, metric points) the recorder holds while it cannot
 * send them yet - consent not given, the device offline: past this, the
 * oldest are dropped.
 */
export const PRODUCT_ANALYTICS_MAX_PENDING_EVENTS: number = 500;

/* A custom event's name, at most this long. */
export const PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH: number = 64;

/* The device, system and version a batch says it came from. */
export const PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH: number = 64;

/*
 * Common's SESSION_REPLAY_MAX_APP_VERSION_LENGTH: the longest app version
 * the server keeps, and so the longest one sent.
 */
export const PRODUCT_ANALYTICS_MAX_APP_VERSION_LENGTH: number = 64;

/*
 * Events this old when they arrive are dropped by the server, so the
 * recorder drops them itself rather than send them (an app held offline for
 * days).
 */
export const PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS: number =
  3 * 24 * 60 * 60 * 1000;

/*
 * Common's PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE: the shorter side, in
 * points, from which a mobile app's screen is a tablet's - the rule its
 * recorded sessions are filed by, so an event and a session agree.
 */
export const PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE: number = 600;

/* ---- Metric names. ---- */

export const PRODUCT_ANALYTICS_MAX_METRIC_NAME_LENGTH: number = 100;
const METRIC_NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_./-]{0,99}$/;

/* OneUptime's own namespace: metric() refuses every name in it. */
export const PRODUCT_ANALYTICS_RESERVED_METRIC_PREFIX: string = "oneuptime.";

/*
 * A name metric() may send: the OpenTelemetry instrument name shape, and
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

/* One event, as it travels. `at` is the device's clock. */
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
  /*
   * The app's version: a mobile app's own, or the one a web page gave the
   * browser recorder (its appVersion option, issue #6625); "" when unset.
   */
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

/*
 * Common's toProductAnalyticsEventName: trimmed, control characters
 * dropped, at most PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH long, or null
 * when nothing is left.
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

// eslint-disable-next-line no-control-regex
const NOT_PRINTABLE_PATTERN: RegExp = /[\u0000-\u001f\u007f-\u009f]/;

/*
 * Common's toSessionReplayAppVersion: trimmed, at most
 * PRODUCT_ANALYTICS_MAX_APP_VERSION_LENGTH long, and "" for anything that
 * is not a string or holds a control character, as the server keeps it.
 */
export function toProductAnalyticsAppVersion(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const version: string = value
    .trim()
    .slice(0, PRODUCT_ANALYTICS_MAX_APP_VERSION_LENGTH)
    .trim();

  return NOT_PRINTABLE_PATTERN.test(version) ? "" : version;
}

/* ---- What the recorder learns from the replay config. ---- */

/* The identify() traits events may carry: at most 20 keys of 40 characters. */
export const PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEYS: number = 20;
export const PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEY_LENGTH: number = 40;

/*
 * The optional `productAnalytics` field of the replay config. Absent - an
 * older server, or an application with product analytics off - reads as
 * off, so the recorder never sends a batch nobody asked for.
 */
export interface ProductAnalyticsRecorderConfig {
  enabled: boolean;
  /* The identify() traits events may carry. */
  userPropertyKeys: Array<string>;
}

/*
 * Common's normalizeProductAnalyticsUserPropertyKeys: trimmed, without
 * duplicates (ignoring case), at most the key cap of keys of at most the
 * key length.
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
      .slice(0, PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEY_LENGTH);

    if (key.length === 0 || key === "__proto__") {
      continue;
    }

    if (seen.has(key.toLowerCase())) {
      continue;
    }

    seen.add(key.toLowerCase());
    keys.push(key);

    if (keys.length >= PRODUCT_ANALYTICS_MAX_USER_PROPERTY_KEYS) {
      break;
    }
  }

  return keys;
}

/* Common's readProductAnalyticsRecorderConfig. */
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
