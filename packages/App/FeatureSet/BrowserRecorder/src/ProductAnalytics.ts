import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import { sanitizeSessionReplayStringMap } from "Common/Utils/Rum/SessionReplayStringMap";
import {
  PRODUCT_ANALYTICS_CONTENT_TYPE,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_PROPERTY_LIMITS,
  PRODUCT_ANALYTICS_TARGET_BATCH_BYTES,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsEventKind,
  ProductAnalyticsRecorderConfig,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireContext,
  ProductAnalyticsWireEvent,
  ProductAnalyticsWireMetric,
  isProductAnalyticsMetricName,
  pickProductAnalyticsUserProperties,
  toProductAnalyticsEventName,
  toProductAnalyticsPage,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import { debugLog, debugWarn } from "./Debug";

/*
 * Product analytics events (issue #6444, part two): the application's
 * session starts, page views, track() events and metric() points, sent from
 * EVERY session the replay policy lets the recorder run in - the ones the
 * replay sample leaves out too - as small JSON batches to
 * PRODUCT_ANALYTICS_EVENTS_PATH. Only when the application has product
 * analytics on (the replay config's productAnalytics.enabled).
 *
 * A second, light channel beside the recording, not a second recorder: the
 * session, the visitor, consent and who signed in all come from the
 * replay recorder (the host), so an event and a recording of the same
 * visit always carry the same ids. track() feeds both.
 *
 * What it never does: patch history (route changes are noticed by a
 * one-second look at the location, so the replay's own history hooks stay
 * the only ones), use sendBeacon or unload (a batch sent as the page is
 * hidden is a keepalive fetch, under the 64 KB those share), or send a
 * page's query or fragment (paths are scrubbed like every replay URL).
 */

/* Which session this browser last announced, shared by its tabs. */
const SESSION_ANNOUNCED_STORAGE_KEY: string = "oneuptime.analytics.session";

/* How often the location is looked at for a single-page app's route change. */
const PAGE_CHECK_INTERVAL_MS: number = 1000;

/* The longest a recorder waits before trying a failed batch again. */
const MAX_RETRY_DELAY_MS: number = 5 * 60 * 1000;

const RETRY_AFTER_LIMIT_SECONDS: number = 300;

export interface ProductAnalyticsHost {
  url: string;
  headers: Record<string, string>;
  /* The session an event happens in now. */
  getSessionId: (nowUnixMs: number) => string;
  /* "" while consent is withdrawn. */
  getVisitorId: () => string;
  /* "Granted", "NotRequired" or "Unknown", as a replay chunk reports it. */
  getConsentState: () => string;
  /* Whether the application waits for consent before anything is sent. */
  requiresConsent: boolean;
  /* The signed-in user and this page's traits, only with identity capture on. */
  getIdentity: () => {
    userRef: string;
    traits: Record<string, string> | null;
  };
  maskProperties: (map: Record<string, string>) => Record<string, string>;
  context: ProductAnalyticsWireContext;
}

/* Why the channel stopped, for the diagnostics. */
export type ProductAnalyticsStopReason =
  | "stopped"
  | "not-enabled"
  | "refused"
  | "origin-not-allowed";

function randomHex32(): string {
  const bytes: Uint8Array = new Uint8Array(16);
  const cryptoRef: Crypto | undefined =
    typeof crypto !== "undefined" ? crypto : undefined;

  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let index: number = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let hex: string = "";

  for (const byte of bytes) {
    hex += (byte < 16 ? "0" : "") + byte.toString(16);
  }

  return hex;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Blocked storage: the session is announced again on the next page. */
  }
}

/*
 * The page an event happened on: the scrubbed path, without query or
 * fragment - and for a hash router (#/orders/42) the route in the hash,
 * after the page's own path. Which fragment is a route is UrlScrubber's
 * rule, the one the replay's URLs are stored by.
 */
export function readProductAnalyticsPage(locationRef: Location): string {
  let path: string = UrlScrubber.scrubPath(locationRef.pathname || "/");
  const route: string | null = UrlScrubber.getHashRoute(locationRef.hash || "");

  if (route !== null) {
    path =
      (path.endsWith("/") ? path.slice(0, -1) : path) +
      UrlScrubber.scrubPath(route);
  }

  return toProductAnalyticsPage(path);
}

export default class ProductAnalytics {
  private readonly host: ProductAnalyticsHost;
  private readonly config: ProductAnalyticsRecorderConfig;
  private readonly windowRef: Window;

  private events: Array<ProductAnalyticsWireEvent> = [];
  private metrics: Array<ProductAnalyticsWireMetric> = [];

  /*
   * The batch on its way, kept until the server says what became of it, so
   * a retry sends the same batch id and the server files it once.
   */
  private pending: ProductAnalyticsWireBatch | null = null;
  private sending: boolean = false;
  private retryAtUnixMs: number = 0;
  private failures: number = 0;

  private sessionId: string = "";
  private page: string = "";
  private droppedEvents: number = 0;
  private stopReason: ProductAnalyticsStopReason | null = null;
  private revoked: boolean = false;

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pageTimer: ReturnType<typeof setInterval> | null = null;

  private readonly onHidden: () => void = (): void => {
    if (this.windowRef.document.visibilityState === "hidden") {
      this.flush(true);
    }
  };

  private readonly onPageHide: () => void = (): void => {
    this.flush(true);
  };

  private readonly onRouteEvent: () => void = (): void => {
    this.checkPage(Date.now());
  };

  public constructor(
    host: ProductAnalyticsHost,
    config: ProductAnalyticsRecorderConfig,
    windowRef: Window = window,
  ) {
    this.host = host;
    this.config = config;
    this.windowRef = windowRef;
  }

  /* The session's start (once per session, across tabs) and this page. */
  public start(): void {
    if (this.flushTimer || this.stopReason) {
      return;
    }

    this.checkPage(Date.now());

    this.flushTimer = setInterval((): void => {
      this.flush(false);
    }, PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

    this.pageTimer = setInterval((): void => {
      this.checkPage(Date.now());
    }, PAGE_CHECK_INTERVAL_MS);

    this.windowRef.document.addEventListener("visibilitychange", this.onHidden);
    this.windowRef.addEventListener("pagehide", this.onPageHide);
    this.windowRef.addEventListener("popstate", this.onRouteEvent);
    this.windowRef.addEventListener("hashchange", this.onRouteEvent);

    debugLog(
      "analytics-started",
      "Product analytics events are on: page views, track() and metric().",
      { userPropertyKeys: this.config.userPropertyKeys.length },
    );
  }

  public track(name: unknown, properties?: unknown): void {
    const eventName: string | null = toProductAnalyticsEventName(name);

    if (!eventName || this.stopReason || this.revoked) {
      return;
    }

    const now: number = Date.now();
    this.checkPage(now);
    this.push({
      kind: ProductAnalyticsEventKind.Custom,
      name: eventName,
      at: now,
      page: this.page,
      properties: this.host.maskProperties(
        sanitizeSessionReplayStringMap(
          properties,
          PRODUCT_ANALYTICS_PROPERTY_LIMITS,
        ),
      ),
    });
  }

  /*
   * metric(name, value, attributes): a number the application measured
   * ("cart.value", 42.5), filed in the metric store under the RUM
   * application. A name outside the instrument-name shape, or one in
   * OneUptime's own namespace, or a value that is not a finite number, is
   * refused here and says why in the diagnostics.
   */
  public metric(name: unknown, value: unknown, attributes?: unknown): void {
    if (this.stopReason || this.revoked) {
      return;
    }

    if (!isProductAnalyticsMetricName(name)) {
      debugWarn(
        "metric-name-refused",
        "metric() needs a name of letters, digits, '_', '.', '-' or '/', starting with a letter, not starting with 'oneuptime.'.",
        { name: typeof name === "string" ? name.slice(0, 100) : typeof name },
      );
      return;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      debugWarn(
        "metric-value-refused",
        "metric() needs a finite number as its value; nothing was sent.",
        { name: name },
      );
      return;
    }

    const now: number = Date.now();
    this.checkSession(now);
    this.metrics.push({
      name: name,
      value: value,
      at: now,
      attributes: this.host.maskProperties(
        sanitizeSessionReplayStringMap(
          attributes,
          PRODUCT_ANALYTICS_PROPERTY_LIMITS,
        ),
      ),
    });

    if (this.metrics.length > PRODUCT_ANALYTICS_MAX_PENDING_EVENTS) {
      this.metrics.shift();
    }

    if (this.metrics.length >= PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH) {
      this.flush(false);
    }
  }

  /*
   * Consent withdrawn: everything held is dropped, the batch on its way
   * too, and nothing is kept or sent until a new grant.
   */
  public forget(): void {
    this.revoked = true;
    this.clear();
  }

  /* Granted: what was held goes now. */
  public onConsentGranted(): void {
    this.revoked = false;
    this.retryAtUnixMs = 0;
    this.checkPage(Date.now());
    this.flush(false);
  }

  private clear(): void {
    this.events = [];
    this.metrics = [];
    this.pending = null;
    this.sessionId = "";
    this.page = "";
  }

  public stop(reason: ProductAnalyticsStopReason = "stopped"): void {
    if (!this.stopReason) {
      this.stopReason = reason;
    }

    this.clear();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pageTimer) {
      clearInterval(this.pageTimer);
      this.pageTimer = null;
    }

    this.windowRef.document.removeEventListener(
      "visibilitychange",
      this.onHidden,
    );
    this.windowRef.removeEventListener("pagehide", this.onPageHide);
    this.windowRef.removeEventListener("popstate", this.onRouteEvent);
    this.windowRef.removeEventListener("hashchange", this.onRouteEvent);
  }

  public getStopReason(): ProductAnalyticsStopReason | null {
    return this.stopReason;
  }

  public getPendingCount(): number {
    return (
      this.events.length +
      this.metrics.length +
      (this.pending
        ? this.pending.events.length + this.pending.metrics.length
        : 0)
    );
  }

  public getDroppedEventCount(): number {
    return this.droppedEvents;
  }

  /* A new session (a rollover, another tab's, a re-grant) starts with its start. */
  private checkSession(now: number): void {
    const sessionId: string = this.host.getSessionId(now);

    if (!sessionId || sessionId === this.sessionId) {
      return;
    }

    this.sessionId = sessionId;
    this.page = "";

    if (readStorage(SESSION_ANNOUNCED_STORAGE_KEY) !== sessionId) {
      writeStorage(SESSION_ANNOUNCED_STORAGE_KEY, sessionId);
      this.push({
        kind: ProductAnalyticsEventKind.Session,
        name: "",
        at: now,
        page: readProductAnalyticsPage(this.windowRef.location),
      });
    }
  }

  private checkPage(now: number): void {
    if (this.stopReason || this.revoked) {
      return;
    }

    this.checkSession(now);

    const page: string = readProductAnalyticsPage(this.windowRef.location);

    if (!page || page === this.page) {
      return;
    }

    this.page = page;
    this.push({
      kind: ProductAnalyticsEventKind.Page,
      name: page,
      at: now,
      page: page,
    });
  }

  private push(event: ProductAnalyticsWireEvent): void {
    this.events.push(event);

    /* Held too long (no consent, no network): the oldest go first. */
    if (this.events.length > PRODUCT_ANALYTICS_MAX_PENDING_EVENTS) {
      this.events.shift();
      this.droppedEvents++;
    }

    if (this.events.length >= PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH) {
      this.flush(false);
    }
  }

  /*
   * The next batch: what is held, up to the per-batch counts and the
   * target size, oldest first.
   */
  private takeBatch(now: number): ProductAnalyticsWireBatch | null {
    if (this.events.length === 0 && this.metrics.length === 0) {
      return null;
    }

    let eventCount: number = Math.min(
      this.events.length,
      PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
    );
    let metricCount: number = Math.min(
      this.metrics.length,
      PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
    );

    const identity: { userRef: string; traits: Record<string, string> | null } =
      this.host.getIdentity();

    const build: () => ProductAnalyticsWireBatch =
      (): ProductAnalyticsWireBatch => {
        const batch: ProductAnalyticsWireBatch = {
          v: PRODUCT_ANALYTICS_WIRE_VERSION,
          batchId: randomHex32(),
          sessionId: this.sessionId || this.host.getSessionId(now),
          visitorId: this.host.getVisitorId(),
          consentState: this.host.getConsentState(),
          sentAt: now,
          context: this.host.context,
          events: this.events.slice(0, eventCount),
          metrics: this.metrics.slice(0, metricCount),
        };

        if (identity.userRef) {
          batch.userRef = identity.userRef;
          batch.userProperties = pickProductAnalyticsUserProperties(
            identity.traits || {},
            this.config.userPropertyKeys,
          );
        }

        return batch;
      };

    let batch: ProductAnalyticsWireBatch = build();

    /* Halve until it fits; one item always does (its parts are capped). */
    while (
      JSON.stringify(batch).length > PRODUCT_ANALYTICS_TARGET_BATCH_BYTES &&
      eventCount + metricCount > 1
    ) {
      eventCount = Math.floor(eventCount / 2);
      metricCount = Math.floor(metricCount / 2);

      if (eventCount + metricCount === 0) {
        eventCount = this.events.length > 0 ? 1 : 0;
        metricCount = eventCount === 0 ? 1 : 0;
      }

      batch = build();
    }

    this.events = this.events.slice(eventCount);
    this.metrics = this.metrics.slice(metricCount);

    return batch;
  }

  /*
   * Send what is held. `final` is the page going away (hidden or closing):
   * the request is a keepalive one, which outlives the page. A page that
   * stays (a tab switched away and back) reads its answer like any other,
   * so a batch the server never got is still sent again.
   */
  public flush(final: boolean): void {
    if (this.stopReason || this.revoked || this.sending) {
      return;
    }

    if (
      this.host.requiresConsent &&
      this.host.getConsentState() !== "Granted"
    ) {
      return;
    }

    const now: number = Date.now();

    if (!final && now < this.retryAtUnixMs) {
      return;
    }

    if (!this.pending) {
      this.checkSession(now);
      this.pending = this.takeBatch(now);
    }

    const batch: ProductAnalyticsWireBatch | null = this.pending;

    if (!batch) {
      return;
    }

    const headers: Record<string, string> = { ...this.host.headers };
    headers["Content-Type"] = PRODUCT_ANALYTICS_CONTENT_TYPE;

    let request: Promise<Response>;

    try {
      request = fetch(this.host.url, {
        method: "POST",
        keepalive: final,
        headers: headers,
        body: JSON.stringify(batch),
        credentials: "omit",
        mode: "cors",
      });
    } catch {
      this.retryLater(now, 0);
      return;
    }

    this.sending = true;

    request
      .then((response: Response): void => {
        this.sending = false;
        this.onAnswer(response, Date.now());
      })
      .catch((): void => {
        this.sending = false;
        this.retryLater(Date.now(), 0);
      });
  }

  private onAnswer(response: Response, now: number): void {
    const status: number = response.status;

    if (status === 202 || status === 200) {
      this.pending = null;
      this.failures = 0;

      if (this.events.length + this.metrics.length > 0) {
        this.flush(false);
      }

      return;
    }

    if (status === 413) {
      /* Never sendable; the next batch is smaller. */
      this.pending = null;
      return;
    }

    if (status === 204 || status === 400 || status === 403) {
      let reason: string = "";

      try {
        reason = response.headers.get("x-oneuptime-replay-reason") || "";
      } catch {
        reason = "";
      }

      debugWarn(
        "analytics-stopped",
        "The server will not file this page's product analytics events; none are sent from it.",
        { status: status, reason: reason },
      );

      this.stop(
        status === 403
          ? "origin-not-allowed"
          : status === 204
            ? "not-enabled"
            : "refused",
      );
      return;
    }

    let retryAfterSeconds: number = 0;

    if (status === 429 || status === 503) {
      try {
        retryAfterSeconds = Number.parseInt(
          response.headers.get("retry-after") || "",
          10,
        );
      } catch {
        retryAfterSeconds = 0;
      }
    }

    /* 409 (consent not given), 429, 5xx: the same batch later. */
    this.retryLater(
      now,
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds, RETRY_AFTER_LIMIT_SECONDS) * 1000
        : 0,
    );
  }

  private retryLater(now: number, delayMs: number): void {
    this.failures++;
    this.retryAtUnixMs =
      now +
      (delayMs > 0
        ? delayMs
        : Math.min(
            MAX_RETRY_DELAY_MS,
            PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * Math.pow(2, this.failures),
          ));
  }
}
