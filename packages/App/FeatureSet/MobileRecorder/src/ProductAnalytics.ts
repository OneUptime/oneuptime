import { ReplayConnectivity, ReplayFetch, ReplayFetchResponse } from "./Config";
import { SessionReplayConsentState } from "./Contract";
import {
  PRODUCT_ANALYTICS_CONTENT_TYPE,
  PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PENDING_EVENTS,
  PRODUCT_ANALYTICS_TARGET_BATCH_BYTES,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsEventKind,
  ProductAnalyticsRecorderConfig,
  ProductAnalyticsWireBatch,
  ProductAnalyticsWireContext,
  ProductAnalyticsWireEvent,
  ProductAnalyticsWireMetric,
  isProductAnalyticsMetricName,
  toProductAnalyticsEventName,
} from "./ProductAnalyticsContract";
import RetryAfter from "./RetryAfter";
import { byteLength } from "./Sanitize";
import { generateReplayId, ReplayStorage } from "./Storage";

/*
 * Product analytics events from a React Native app (issue #6629): the
 * session's start, each screen it shows (a page view, named by the route
 * setRoute() was given), the app's track() events and its metric() points,
 * sent as small JSON batches to PRODUCT_ANALYTICS_EVENTS_PATH - the same
 * batches, limits and answers as the browser recorder's
 * (BrowserRecorder/src/ProductAnalytics.ts), from every session the
 * application's replay policy lets the recorder run in, recorded or not.
 *
 * A second, light channel beside the recording, not a second recorder: the
 * session, the visitor, consent and who signed in come from the replay
 * recorder (the host), so an event and a recording of the same visit carry
 * the same ids. What the host decides, this channel only asks about.
 *
 * Where it parts from the browser's, and why:
 *
 *   - Every item it holds keeps the session and the person it happened
 *     under, and a batch holds one session's and one person's items. A
 *     phone holds items longer than a tab (offline, waiting for consent),
 *     and a mobile session changes under them more often - a sign-in or a
 *     sign-out starts a new one - so filing a batch under whoever is signed
 *     in when it is sent would give one person's events to another.
 *   - Before consent there is no session to name: the recorder's session is
 *     a throwaway until the person agrees. Items are held unnamed, and the
 *     grant files them, and the session's start ahead of them, under the
 *     session the grant opens.
 *   - Requests time out (a phone's connection can hang a request for
 *     minutes), the device's own connectivity source and its return to the
 *     foreground send what is held at once, and nothing is tried while the
 *     device says it is offline.
 *   - Which session the device last announced is kept in the app's storage,
 *     not a browser's: a session that carries on across a relaunch (the
 *     replay's own session store) is announced once.
 *   - What it has not sent yet is kept in the app's storage too (issue
 *     #9577), as the replay outbox keeps unsent chunks: an app used offline
 *     and then killed, or stopped by the system in the background, sends
 *     those events and metric points on its next start(), under the session
 *     and the person they happened under. A tab that closes loses its
 *     unsent ones; a phone is much more often offline for a while and then
 *     stopped. Nothing held before consent is written - it has no session
 *     yet - and withdrawing consent, or a policy that starts waiting for
 *     it, removes what was written.
 *
 * Property, attribute and user property values arrive masked, as the
 * recorder masks all text (the host's toProperties and traits): event
 * names, keys and metric values are sent as written.
 */

/* How long a request may take before it is given up and tried again later. */
export const PRODUCT_ANALYTICS_REQUEST_TIMEOUT_MS: number = 10_000;

/* The longest the recorder waits before trying a failed batch again. */
export const PRODUCT_ANALYTICS_MAX_RETRY_DELAY_MS: number = 5 * 60 * 1000;

const RETRY_AFTER_LIMIT_SECONDS: number = 300;

const REPLAY_ID_PATTERN: RegExp = /^[0-9a-f]{32}$/u;

/* Where the device keeps the session it last announced, per namespace. */
export function productAnalyticsSessionKey(namespace: string): string {
  return `@oneuptime/replay/${namespace}/analytics-session`;
}

/*
 * Where the device keeps what has not been sent yet, per namespace (issue
 * #9577): the events and metric points held, and the batch on its way.
 */
export function productAnalyticsQueueKey(namespace: string): string {
  return `@oneuptime/replay/${namespace}/analytics-queue`;
}

/* The stored queue's layout. A value of any other is read as nothing. */
export const PRODUCT_ANALYTICS_STORED_QUEUE_VERSION: number = 1;

/*
 * The most the stored queue takes, as UTF-8 bytes. AsyncStorage's database
 * on Android is 6 MB by default, shared with the app and with the replay
 * outbox (3 MB), and a value past 2 MB cannot be read back there at all.
 * The cap of 500 events and 500 metric points is reached long before this
 * with ordinary events; with very large ones the oldest are left out of the
 * stored copy - still sent while the app runs, lost only if it is killed.
 */
export const PRODUCT_ANALYTICS_MAX_STORED_BYTES: number = 512 * 1024;

/*
 * How long a change waits before it is written, so a burst of track()
 * calls is one write. The app leaving the foreground, when the system may
 * stop it, writes at once.
 */
export const PRODUCT_ANALYTICS_STORE_DELAY_MS: number = 1000;

/*
 * The writes to each stored key, in order, per storage: a channel that
 * starts while the one before it is still writing what it held (a policy
 * refresh, a restart of the recorder) reads only after that write.
 */
const storeWrites: WeakMap<
  ReplayStorage,
  Map<string, Promise<void>>
> = new WeakMap<ReplayStorage, Map<string, Promise<void>>>();

function writesOf(storage: ReplayStorage): Map<string, Promise<void>> {
  let writes: Map<string, Promise<void>> | undefined = storeWrites.get(storage);

  if (!writes) {
    writes = new Map<string, Promise<void>>();
    storeWrites.set(storage, writes);
  }

  return writes;
}

function enqueueStoreWrite(
  storage: ReplayStorage,
  key: string,
  write: () => Promise<void>,
): Promise<void> {
  const writes: Map<string, Promise<void>> = writesOf(storage);
  const run: () => Promise<void> = async (): Promise<void> => {
    try {
      await write();
    } catch {
      /* Storage full or unavailable: the items are still held in memory. */
    }
  };
  const next: Promise<void> = (writes.get(key) ?? Promise.resolve()).then(
    run,
    run,
  );

  writes.set(key, next);

  return next;
}

/* Resolves once every write to the key queued so far has been made. */
async function storeWritesSettled(
  storage: ReplayStorage,
  key: string,
): Promise<void> {
  try {
    await writesOf(storage).get(key);
  } catch {
    /* The writes never reject; nothing to wait for. */
  }
}

/*
 * Consent withdrawn, or a policy that now waits for consent: what the device
 * kept for product analytics is removed, whether or not a channel is
 * running - one a previous launch left behind included.
 */
export async function clearStoredProductAnalytics(
  storage: ReplayStorage,
  namespace: string,
): Promise<void> {
  await Promise.all([
    enqueueStoreWrite(
      storage,
      productAnalyticsQueueKey(namespace),
      async (): Promise<void> => {
        await storage.removeItem(productAnalyticsQueueKey(namespace));
      },
    ),
    enqueueStoreWrite(
      storage,
      productAnalyticsSessionKey(namespace),
      async (): Promise<void> => {
        await storage.removeItem(productAnalyticsSessionKey(namespace));
      },
    ),
  ]);
}

/* React Native's AppState, as the channel listens to it. */
export interface ProductAnalyticsAppState {
  currentState: string | null;
  addEventListener(
    type: "change",
    listener: (state: string) => void,
  ): { remove(): void };
}

export interface ProductAnalyticsIdentity {
  /* "" while nobody is signed in, or the application captures no identity. */
  userRef: string;
  traits: Record<string, string> | null;
}

export interface MobileProductAnalyticsHost {
  url: string;
  headers: Record<string, string>;
  fetch: ReplayFetch;
  now: () => number;
  storage: ReplayStorage;
  /* The replay's storage namespace (getReplayStorageNamespace). */
  namespace: string;
  appState?: ProductAnalyticsAppState | null | undefined;
  connectivity?: ReplayConnectivity | undefined;
  /*
   * The session an event that happens now belongs to - the event is
   * activity, so a session the replay does not record is kept alive or
   * rolled over by it. "" when there is none to name: before consent (the
   * items are then held until the grant names one), or when the recorder
   * has none at all.
   */
  getSessionId: (nowUnixMs: number) => string;
  /*
   * The same session, only looked at: the timer and the lifecycle look at
   * it without counting as activity, so an app nobody uses lets its
   * session go idle.
   */
  peekSessionId: () => string;
  /* The anonymous visitor's id; "" while there is none to send. */
  getVisitorId: () => string;
  getConsentState: () => SessionReplayConsentState;
  /* Whether the application's policy waits for an explicit consent. */
  requiresConsent: () => boolean;
  /* Who is signed in, and their traits, only with identity capture on. */
  getIdentity: () => ProductAnalyticsIdentity;
  /*
   * A track() call's properties or a metric() point's attributes as the
   * recorder keeps them: capped, and masked as it masks all text.
   */
  toProperties: (value: unknown) => Record<string, string>;
  /* The device type, system and app version the batches say. */
  getContext: () => ProductAnalyticsWireContext;
  onDiagnostic: (code: string, details?: Record<string, unknown>) => void;
}

/* Why the channel stopped, for the diagnostics. */
export type ProductAnalyticsStopReason =
  | "stopped"
  | "not-enabled"
  | "refused"
  | "origin-not-allowed";

export interface ProductAnalyticsDiagnostics {
  /* "off" when the application has them off, "on" while sent, else why they stopped. */
  state: "off" | "on" | ProductAnalyticsStopReason;
  pending: number;
  dropped: number;
}

/*
 * The session and the person an item happened under. sessionId is "" for
 * an item held before consent, until the grant names its session.
 */
interface ProductAnalyticsScope {
  sessionId: string;
  userRef: string;
  userProperties: Record<string, string> | null;
}

interface HeldItem {
  scope: ProductAnalyticsScope;
  event?: ProductAnalyticsWireEvent;
  metric?: ProductAnalyticsWireMetric;
}

/*
 * The queue as the device keeps it: each distinct scope once, each item
 * pointing at its scope, and the batch on its way, which goes again under
 * its own id - the server files a batch id once.
 */
interface StoredQueue {
  v: number;
  scopes: Array<ProductAnalyticsScope>;
  items: Array<StoredItem>;
  pending: ProductAnalyticsWireBatch | null;
}

interface StoredItem {
  s: number;
  e?: ProductAnalyticsWireEvent;
  m?: ProductAnalyticsWireMetric;
}

/* What a stored queue holds, once read back and checked. */
interface RestoredQueue {
  items: Array<HeldItem>;
  pending: ProductAnalyticsWireBatch | null;
}

const EVENT_KINDS: ReadonlyArray<string> = [
  ProductAnalyticsEventKind.Session,
  ProductAnalyticsEventKind.Page,
  ProductAnalyticsEventKind.Custom,
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.keys(value).every((key: string): boolean => {
      return typeof value[key] === "string";
    })
  );
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/* Read back from the device: a value of the shape this file writes, or null. */
function readStoredEvent(value: unknown): ProductAnalyticsWireEvent | null {
  if (
    !isPlainRecord(value) ||
    typeof value["kind"] !== "string" ||
    EVENT_KINDS.indexOf(value["kind"]) === -1 ||
    typeof value["name"] !== "string" ||
    !isFiniteTime(value["at"]) ||
    (value["page"] !== undefined && typeof value["page"] !== "string") ||
    (value["properties"] !== undefined && !isStringMap(value["properties"]))
  ) {
    return null;
  }

  const event: ProductAnalyticsWireEvent = {
    kind: value["kind"] as ProductAnalyticsEventKind,
    name: value["name"],
    at: value["at"],
  };

  if (typeof value["page"] === "string") {
    event.page = value["page"];
  }

  if (isStringMap(value["properties"])) {
    event.properties = value["properties"];
  }

  return event;
}

function readStoredMetric(value: unknown): ProductAnalyticsWireMetric | null {
  if (
    !isPlainRecord(value) ||
    !isProductAnalyticsMetricName(value["name"]) ||
    !isFiniteTime(value["value"]) ||
    !isFiniteTime(value["at"]) ||
    (value["attributes"] !== undefined && !isStringMap(value["attributes"]))
  ) {
    return null;
  }

  const metric: ProductAnalyticsWireMetric = {
    name: value["name"],
    value: value["value"],
    at: value["at"],
  };

  if (isStringMap(value["attributes"])) {
    metric.attributes = value["attributes"];
  }

  return metric;
}

function readStoredScope(value: unknown): ProductAnalyticsScope | null {
  if (
    !isPlainRecord(value) ||
    typeof value["sessionId"] !== "string" ||
    !REPLAY_ID_PATTERN.test(value["sessionId"]) ||
    typeof value["userRef"] !== "string" ||
    (value["userProperties"] !== null && !isStringMap(value["userProperties"]))
  ) {
    return null;
  }

  return {
    sessionId: value["sessionId"],
    userRef: value["userRef"],
    userProperties: value["userProperties"] as Record<string, string> | null,
  };
}

function readStoredBatch(value: unknown): ProductAnalyticsWireBatch | null {
  if (
    !isPlainRecord(value) ||
    value["v"] !== PRODUCT_ANALYTICS_WIRE_VERSION ||
    typeof value["batchId"] !== "string" ||
    !REPLAY_ID_PATTERN.test(value["batchId"]) ||
    typeof value["sessionId"] !== "string" ||
    !REPLAY_ID_PATTERN.test(value["sessionId"]) ||
    typeof value["visitorId"] !== "string" ||
    typeof value["consentState"] !== "string" ||
    !isFiniteTime(value["sentAt"]) ||
    !isStringMap(value["context"]) ||
    !Array.isArray(value["events"]) ||
    !Array.isArray(value["metrics"]) ||
    value["events"].length > PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH ||
    value["metrics"].length > PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH ||
    (value["userRef"] !== undefined && typeof value["userRef"] !== "string") ||
    (value["userProperties"] !== undefined &&
      !isStringMap(value["userProperties"]))
  ) {
    return null;
  }

  const events: Array<ProductAnalyticsWireEvent> = [];
  const metrics: Array<ProductAnalyticsWireMetric> = [];

  for (const entry of value["events"] as Array<unknown>) {
    const event: ProductAnalyticsWireEvent | null = readStoredEvent(entry);

    if (!event) {
      return null;
    }

    events.push(event);
  }

  for (const entry of value["metrics"] as Array<unknown>) {
    const metric: ProductAnalyticsWireMetric | null = readStoredMetric(entry);

    if (!metric) {
      return null;
    }

    metrics.push(metric);
  }

  const context: Record<string, string> = value["context"];
  const batch: ProductAnalyticsWireBatch = {
    v: PRODUCT_ANALYTICS_WIRE_VERSION,
    batchId: value["batchId"],
    sessionId: value["sessionId"],
    visitorId: value["visitorId"],
    consentState: value["consentState"],
    sentAt: value["sentAt"],
    context: {
      deviceType: context["deviceType"] ?? "",
      browserName: context["browserName"] ?? "",
      osName: context["osName"] ?? "",
      appVersion: context["appVersion"] ?? "",
    },
    events: events,
    metrics: metrics,
  };

  if (typeof value["userRef"] === "string") {
    batch.userRef = value["userRef"];
    batch.userProperties = isStringMap(value["userProperties"])
      ? value["userProperties"]
      : {};
  }

  return batch;
}

/*
 * The stored queue read back, or null when there is none or it is not one
 * this file wrote - a damaged value is never half-read: an item whose scope
 * or shape is wrong is left out alone, a layout of another version is
 * nothing at all.
 */
function readStoredQueue(raw: string | null): RestoredQueue | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !isPlainRecord(parsed) ||
    parsed["v"] !== PRODUCT_ANALYTICS_STORED_QUEUE_VERSION ||
    !Array.isArray(parsed["scopes"]) ||
    !Array.isArray(parsed["items"])
  ) {
    return null;
  }

  const scopes: Array<ProductAnalyticsScope | null> = (
    parsed["scopes"] as Array<unknown>
  ).map(readStoredScope);
  const items: Array<HeldItem> = [];

  for (const entry of parsed["items"] as Array<unknown>) {
    if (!isPlainRecord(entry) || typeof entry["s"] !== "number") {
      continue;
    }

    const scope: ProductAnalyticsScope | null | undefined = scopes[entry["s"]];

    if (!scope) {
      continue;
    }

    if (entry["e"] !== undefined) {
      const event: ProductAnalyticsWireEvent | null = readStoredEvent(
        entry["e"],
      );

      if (event) {
        items.push({ scope: scope, event: event });
      }

      continue;
    }

    const metric: ProductAnalyticsWireMetric | null = readStoredMetric(
      entry["m"],
    );

    if (metric) {
      items.push({ scope: scope, metric: metric });
    }
  }

  return {
    items: items,
    pending:
      parsed["pending"] === null || parsed["pending"] === undefined
        ? null
        : readStoredBatch(parsed["pending"]),
  };
}

function scopeKey(scope: ProductAnalyticsScope): string {
  return JSON.stringify([scope.sessionId, scope.userRef, scope.userProperties]);
}

/*
 * The queue as the device keeps it, or null when there is nothing to keep:
 * the batch on its way, then the newest items that fit under
 * PRODUCT_ANALYTICS_MAX_STORED_BYTES, in the order they were held. An item
 * with no session yet - held for a consent not given - is never written.
 */
function buildStoredQueue(
  items: ReadonlyArray<HeldItem>,
  pending: ProductAnalyticsWireBatch | null,
): string | null {
  const named: Array<HeldItem> = items.filter((item: HeldItem): boolean => {
    return item.scope.sessionId !== "";
  });

  if (named.length === 0 && !pending) {
    return null;
  }

  const build: (from: number) => string = (from: number): string => {
    const scopes: Array<ProductAnalyticsScope> = [];
    const scopeIndex: Map<string, number> = new Map<string, number>();
    const stored: Array<StoredItem> = [];

    for (const item of named.slice(from)) {
      const key: string = scopeKey(item.scope);
      let index: number | undefined = scopeIndex.get(key);

      if (index === undefined) {
        index = scopes.length;
        scopes.push(item.scope);
        scopeIndex.set(key, index);
      }

      if (item.event) {
        stored.push({ s: index, e: item.event });
      } else if (item.metric) {
        stored.push({ s: index, m: item.metric });
      }
    }

    const queue: StoredQueue = {
      v: PRODUCT_ANALYTICS_STORED_QUEUE_VERSION,
      scopes: scopes,
      items: stored,
      pending: pending,
    };

    return JSON.stringify(queue);
  };

  let from: number = 0;
  let value: string = build(from);

  if (byteLength(value) <= PRODUCT_ANALYTICS_MAX_STORED_BYTES) {
    return value;
  }

  /*
   * Too large: the fewest of the oldest left out until it fits, found by
   * halving - a handful of builds, however many items are held.
   */
  let low: number = 1;
  let high: number = named.length;

  while (low < high) {
    const middle: number = Math.floor((low + high) / 2);

    if (byteLength(build(middle)) <= PRODUCT_ANALYTICS_MAX_STORED_BYTES) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  from = low;
  value = build(from);

  return byteLength(value) <= PRODUCT_ANALYTICS_MAX_STORED_BYTES ? value : null;
}

function itemAt(item: HeldItem): number {
  return item.event ? item.event.at : item.metric?.at ?? 0;
}

function sameScope(
  left: ProductAnalyticsScope,
  right: ProductAnalyticsScope,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.userRef === right.userRef &&
    JSON.stringify(left.userProperties) === JSON.stringify(right.userProperties)
  );
}

/*
 * The traits an event may carry: those the application listed, matched as
 * written (Common's pickProductAnalyticsUserProperties, over traits the
 * recorder already capped and masked).
 */
export function pickProductAnalyticsUserProperties(
  traits: Record<string, string> | null,
  allowedKeys: ReadonlyArray<string>,
): Record<string, string> {
  const picked: Record<string, string> = {};

  if (!traits) {
    return picked;
  }

  for (const key of allowedKeys) {
    if (
      Object.prototype.hasOwnProperty.call(traits, key) &&
      typeof traits[key] === "string"
    ) {
      picked[key] = traits[key] as string;
    }
  }

  return picked;
}

export default class MobileProductAnalytics {
  private readonly host: MobileProductAnalyticsHost;
  private config: ProductAnalyticsRecorderConfig;

  private items: Array<HeldItem> = [];
  private eventCount: number = 0;
  private metricCount: number = 0;

  /*
   * The batch on its way, kept until the server says what became of it, so
   * a retry sends the same batch id and the server files it once.
   */
  private pending: ProductAnalyticsWireBatch | null = null;
  private sending: boolean = false;
  private sendGeneration: number = 0;
  private retryAtUnixMs: number = 0;
  private failures: number = 0;

  /* The session items are filed under now, and the screen shown in it. */
  private sessionId: string = "";
  private shownPage: string = "";
  /* The last screen the app named, in any session. */
  private route: string = "";
  /* The session this device last announced; null until read. */
  private announcedSessionId: string | null = null;

  private droppedEvents: number = 0;
  private started: boolean = false;
  private stopReason: ProductAnalyticsStopReason | null = null;
  private revoked: boolean = false;
  /* The connectivity source said the device is offline. */
  private offline: boolean = false;

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: { remove(): void } | null = null;
  private unsubscribeConnectivity: (() => void) | null = null;

  /*
   * The stored queue (issue #9577). Written only once what a previous run
   * left there has been read back, so a channel that never got that far
   * can never overwrite it with nothing.
   */
  private restored: boolean = false;
  private storeTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    host: MobileProductAnalyticsHost,
    config: ProductAnalyticsRecorderConfig,
  ) {
    this.host = host;
    this.config = config;
  }

  /*
   * Reads which session this device last announced, then starts: the
   * session's start (unless announced already), the timer, and the app's
   * lifecycle and connectivity. Items before this resolves are not taken.
   */
  public async start(): Promise<void> {
    if (this.started || this.stopReason) {
      return;
    }

    let stored: string | null = null;
    let storedQueue: string | null = null;
    const queueKey: string = productAnalyticsQueueKey(this.host.namespace);

    /* What a channel before this one is still writing comes first. */
    await storeWritesSettled(this.host.storage, queueKey);

    try {
      stored = await this.host.storage.getItem(
        productAnalyticsSessionKey(this.host.namespace),
      );
    } catch {
      stored = null;
    }

    try {
      storedQueue = await this.host.storage.getItem(queueKey);
    } catch {
      storedQueue = null;
    }

    if (this.started || this.stopReason) {
      return;
    }

    this.announcedSessionId =
      typeof stored === "string" && REPLAY_ID_PATTERN.test(stored)
        ? stored
        : null;
    this.started = true;
    this.restored = true;

    /* Consent withdrawn while the queue was being read: nothing comes back. */
    if (!this.revoked) {
      this.restoreQueue(storedQueue, this.host.now());
    }

    this.enterCurrentSession(this.host.now(), false);

    this.flushTimer = setInterval((): void => {
      this.flush(false);
    }, PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS);

    this.listenToLifecycle();

    this.host.onDiagnostic("analytics-started", {
      userPropertyKeys: this.config.userPropertyKeys.length,
    });
  }

  /* A refreshed policy's keys; whether it waits for consent is asked live. */
  public setConfig(config: ProductAnalyticsRecorderConfig): void {
    this.config = config;
  }

  public isStarted(): boolean {
    return this.started && !this.stopReason;
  }

  public track(name: unknown, properties?: unknown): void {
    const eventName: string | null = toProductAnalyticsEventName(name);

    if (!eventName || !this.accepts()) {
      return;
    }

    const now: number = this.host.now();
    const scope: ProductAnalyticsScope | null = this.scopeNow(now);

    if (!scope) {
      return;
    }

    const event: ProductAnalyticsWireEvent = {
      kind: ProductAnalyticsEventKind.Custom,
      name: eventName,
      at: now,
      properties: this.host.toProperties(properties),
    };

    if (this.shownPage) {
      event.page = this.shownPage;
    } else if (this.route) {
      event.page = this.route;
    }

    this.pushEvent(scope, event);
  }

  /*
   * A screen the app moved to (setRoute(), already scrubbed as the replay
   * keeps a route): a page view, unless it is the screen already shown in
   * this session.
   */
  public page(route: string): void {
    if (!route || !this.accepts()) {
      return;
    }

    this.route = route;

    const now: number = this.host.now();
    const scope: ProductAnalyticsScope | null = this.scopeNow(now);

    if (!scope || route === this.shownPage) {
      return;
    }

    this.shownPage = route;
    this.pushEvent(scope, {
      kind: ProductAnalyticsEventKind.Page,
      name: route,
      at: now,
      page: route,
    });
  }

  /*
   * metric(name, value, attributes): a number the app measured
   * ("cart.value", 42.5), filed in the metric store under the RUM
   * application. A name outside the instrument-name shape, or in
   * OneUptime's own namespace, or a value that is not a finite number, is
   * refused here and says why in the diagnostics.
   */
  public metric(name: unknown, value: unknown, attributes?: unknown): void {
    if (!this.accepts()) {
      return;
    }

    if (!isProductAnalyticsMetricName(name)) {
      this.host.onDiagnostic("metric-name-refused", {
        name: typeof name === "string" ? name.slice(0, 100) : typeof name,
      });
      return;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.host.onDiagnostic("metric-value-refused", { name: name });
      return;
    }

    const now: number = this.host.now();
    const scope: ProductAnalyticsScope | null = this.scopeNow(now);

    if (!scope) {
      return;
    }

    this.items.push({
      scope: scope,
      metric: {
        name: name,
        value: value,
        at: now,
        attributes: this.host.toProperties(attributes),
      },
    });
    this.metricCount++;

    /* Held too long (no consent, no network): the oldest go first. */
    if (this.metricCount > PRODUCT_ANALYTICS_MAX_PENDING_EVENTS) {
      this.dropOldest("metric");
    }

    this.scheduleStore();

    if (this.metricCount >= PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH) {
      this.flush(false);
    }
  }

  /*
   * Send what is held. `final` is the app leaving the foreground: sent at
   * once, whatever a retry was waiting for, while the system still lets
   * the app use the network.
   */
  public flush(final: boolean): void {
    if (!this.started || this.stopReason || this.revoked || this.sending) {
      return;
    }

    if (this.isAwaitingConsent() || this.offline) {
      return;
    }

    const now: number = this.host.now();

    if (!final && now < this.retryAtUnixMs) {
      return;
    }

    if (!this.pending) {
      this.enterCurrentSession(now, false);
      this.pending = this.takeBatch(now);
    }

    const batch: ProductAnalyticsWireBatch | null = this.pending;

    if (!batch) {
      return;
    }

    this.send(batch);
  }

  /*
   * Consent withdrawn: everything held is dropped, the batch on its way
   * too, the session this device announced is forgotten, and nothing is
   * kept or sent until a new grant.
   */
  public forget(): void {
    this.revoked = true;
    this.clear();
    this.forgetStoredQueue();
    this.forgetAnnouncedSession();
  }

  /*
   * The policy now waits for a consent this run has not been given: what
   * was held, and the device's record, go as on a withdrawal, but what
   * happens from now on is held for the grant, as before any consent.
   */
  public reset(): void {
    this.clear();
    this.forgetStoredQueue();
    this.forgetAnnouncedSession();
  }

  /* Granted: what was held is filed under the session the grant opened, and goes now. */
  public onConsentGranted(): void {
    this.revoked = false;
    this.retryAtUnixMs = 0;
    this.enterCurrentSession(this.host.now(), false);
    this.scheduleStore();
    this.flush(false);
  }

  /*
   * The recorder's session may have changed under the channel - a policy
   * refreshed, a session named after consent: what was held for it is
   * filed under it, and what can go, goes.
   */
  public refresh(): void {
    if (!this.accepts()) {
      return;
    }

    this.enterCurrentSession(this.host.now(), false);
    this.scheduleStore();
    this.flush(false);
  }

  public stop(reason: ProductAnalyticsStopReason = "stopped"): void {
    const isFirstStop: boolean = !this.stopReason;

    if (!this.stopReason) {
      this.stopReason = reason;
    }

    /*
     * Stopped by the app or a restart of the recorder: what is held is
     * written, for the next start() to send. Stopped by the server - the
     * application has product analytics off, or will not take this app's
     * batches - it would only refuse them again, so they go.
     */
    if (isFirstStop && this.restored) {
      if (reason === "stopped") {
        this.storeNow();
      } else {
        this.forgetStoredQueue();
      }
    }

    this.clear();
    this.cancelStoreTimer();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.appStateSubscription?.remove();
    this.appStateSubscription = null;

    const unsubscribe: (() => void) | null = this.unsubscribeConnectivity;
    this.unsubscribeConnectivity = null;

    try {
      unsubscribe?.();
    } catch {
      /* The host's unsubscribe must not break teardown. */
    }
  }

  public getStopReason(): ProductAnalyticsStopReason | null {
    return this.stopReason;
  }

  public getPendingCount(): number {
    return (
      this.items.length +
      (this.pending
        ? this.pending.events.length + this.pending.metrics.length
        : 0)
    );
  }

  public getDroppedEventCount(): number {
    return this.droppedEvents;
  }

  public getDiagnostics(): ProductAnalyticsDiagnostics {
    return {
      state: this.stopReason || "on",
      pending: this.getPendingCount(),
      dropped: this.droppedEvents,
    };
  }

  private accepts(): boolean {
    return this.started && !this.stopReason && !this.revoked;
  }

  private isAwaitingConsent(): boolean {
    return (
      this.host.requiresConsent() && this.host.getConsentState() !== "Granted"
    );
  }

  private clear(): void {
    this.items = [];
    this.eventCount = 0;
    this.metricCount = 0;
    this.pending = null;
    /* An answer still on its way belongs to nothing held any more. */
    this.sendGeneration++;
    this.sending = false;
    this.sessionId = "";
    this.shownPage = "";
  }

  private forgetAnnouncedSession(): void {
    this.announcedSessionId = null;
    void this.host.storage
      .removeItem(productAnalyticsSessionKey(this.host.namespace))
      .catch((): void => {
        /* Best-effort privacy cleanup. */
      });
  }

  private announce(sessionId: string): void {
    this.announcedSessionId = sessionId;
    void this.host.storage
      .setItem(productAnalyticsSessionKey(this.host.namespace), sessionId)
      .catch((): void => {
        /* Not kept: a relaunch may announce the session again. */
      });
  }

  private makeScope(sessionId: string): ProductAnalyticsScope {
    const identity: ProductAnalyticsIdentity = this.host.getIdentity();

    return {
      sessionId: sessionId,
      userRef: identity.userRef,
      userProperties: identity.userRef
        ? pickProductAnalyticsUserProperties(
            identity.traits,
            this.config.userPropertyKeys,
          )
        : null,
    };
  }

  /*
   * The scope of an item that happens now, or null when it has none to be
   * filed under (no session, and no consent being waited for).
   */
  private scopeNow(now: number): ProductAnalyticsScope | null {
    const sessionId: string = this.enterCurrentSession(now, true);

    if (sessionId) {
      return this.makeScope(sessionId);
    }

    return this.isAwaitingConsent() ? this.makeScope("") : null;
  }

  /*
   * Follows the host's session: a new one starts with its start (once per
   * session on this device) and the screen the app shows, and items held
   * before consent are filed under the first session there is to name.
   * Returns the session, or "" when there is none to name. Only an item
   * that happens now is activity (isActivity); the timer only looks.
   */
  private enterCurrentSession(now: number, isActivity: boolean): string {
    const sessionId: string = isActivity
      ? this.host.getSessionId(now)
      : this.host.peekSessionId();

    if (!sessionId) {
      return "";
    }

    const firstUnnamed: number = this.items.findIndex(
      (item: HeldItem): boolean => {
        return item.scope.sessionId === "";
      },
    );

    if (sessionId === this.sessionId && firstUnnamed < 0) {
      return sessionId;
    }

    const isNewSession: boolean = sessionId !== this.sessionId;
    this.sessionId = sessionId;

    /*
     * What was held before consent: this session's, from its start. Their
     * screen views are this session's, so the screen is not shown again.
     */
    let startedAt: number = now;
    let startPage: string = this.route;
    let startScope: ProductAnalyticsScope = this.makeScope(sessionId);

    if (firstUnnamed >= 0) {
      const first: HeldItem = this.items[firstUnnamed] as HeldItem;

      startedAt = Math.min(now, itemAt(first));
      startPage = first.event?.page || this.route;
      startScope = { ...first.scope, sessionId: sessionId };

      for (const item of this.items) {
        if (item.scope.sessionId === "") {
          item.scope = { ...item.scope, sessionId: sessionId };
        }
      }
    } else if (isNewSession) {
      this.shownPage = "";
    }

    if (this.announcedSessionId !== sessionId) {
      const start: ProductAnalyticsWireEvent = {
        kind: ProductAnalyticsEventKind.Session,
        name: "",
        at: startedAt,
      };

      if (startPage) {
        start.page = startPage;
      }

      const item: HeldItem = { scope: startScope, event: start };

      if (firstUnnamed >= 0) {
        this.items.splice(firstUnnamed, 0, item);
      } else {
        this.items.push(item);
      }

      this.eventCount++;
      this.announce(sessionId);
      this.trimEvents();
      this.scheduleStore();
    }

    /* The screen the app shows is this new session's first page view. */
    if (firstUnnamed < 0 && isNewSession && this.route) {
      this.shownPage = this.route;
      this.items.push({
        scope: this.makeScope(sessionId),
        event: {
          kind: ProductAnalyticsEventKind.Page,
          name: this.route,
          at: now,
          page: this.route,
        },
      });
      this.eventCount++;
      this.trimEvents();
      this.scheduleStore();
    }

    return sessionId;
  }

  private pushEvent(
    scope: ProductAnalyticsScope,
    event: ProductAnalyticsWireEvent,
  ): void {
    this.items.push({ scope: scope, event: event });
    this.eventCount++;
    this.trimEvents();
    this.scheduleStore();

    if (this.eventCount >= PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH) {
      this.flush(false);
    }
  }

  /* Held too long (no consent, no network): the oldest go first, counted. */
  private trimEvents(): void {
    while (this.eventCount > PRODUCT_ANALYTICS_MAX_PENDING_EVENTS) {
      this.dropOldest("event");
      this.droppedEvents++;
    }
  }

  private dropOldest(kind: "event" | "metric"): void {
    const index: number = this.items.findIndex((item: HeldItem): boolean => {
      return kind === "event" ? Boolean(item.event) : Boolean(item.metric);
    });

    if (index < 0) {
      return;
    }

    this.items.splice(index, 1);

    if (kind === "event") {
      this.eventCount--;
    } else {
      this.metricCount--;
    }
  }

  /*
   * The next batch: the oldest items of one session and one person, up to
   * the per-batch counts and the target size. Items the server would drop
   * for their age are dropped here instead.
   */
  private takeBatch(now: number): ProductAnalyticsWireBatch | null {
    this.dropTooOld(now);

    const first: HeldItem | undefined = this.items[0];

    if (!first || first.scope.sessionId === "") {
      return null;
    }

    const scope: ProductAnalyticsScope = first.scope;
    let count: number = 0;
    let events: number = 0;
    let metrics: number = 0;

    for (const item of this.items) {
      if (!sameScope(item.scope, scope)) {
        break;
      }

      if (item.event) {
        if (events >= PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH) {
          break;
        }

        events++;
      } else {
        if (metrics >= PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH) {
          break;
        }

        metrics++;
      }

      count++;
    }

    const build: (taken: number) => ProductAnalyticsWireBatch = (
      taken: number,
    ): ProductAnalyticsWireBatch => {
      const slice: Array<HeldItem> = this.items.slice(0, taken);
      const batch: ProductAnalyticsWireBatch = {
        v: PRODUCT_ANALYTICS_WIRE_VERSION,
        batchId: generateReplayId(),
        sessionId: scope.sessionId,
        visitorId: this.host.getVisitorId(),
        consentState: this.host.getConsentState(),
        sentAt: now,
        context: this.host.getContext(),
        events: slice
          .filter((item: HeldItem): boolean => {
            return Boolean(item.event);
          })
          .map((item: HeldItem): ProductAnalyticsWireEvent => {
            return item.event as ProductAnalyticsWireEvent;
          }),
        metrics: slice
          .filter((item: HeldItem): boolean => {
            return Boolean(item.metric);
          })
          .map((item: HeldItem): ProductAnalyticsWireMetric => {
            return item.metric as ProductAnalyticsWireMetric;
          }),
      };

      if (scope.userRef) {
        batch.userRef = scope.userRef;
        batch.userProperties = scope.userProperties || {};
      }

      return batch;
    };

    let batch: ProductAnalyticsWireBatch = build(count);

    /* Halve until it fits; one item always does (its parts are capped). */
    while (
      JSON.stringify(batch).length > PRODUCT_ANALYTICS_TARGET_BATCH_BYTES &&
      count > 1
    ) {
      count = Math.floor(count / 2);
      batch = build(count);
    }

    this.items.splice(0, count);
    this.eventCount -= batch.events.length;
    this.metricCount -= batch.metrics.length;
    this.scheduleStore();

    return batch;
  }

  private dropTooOld(now: number): void {
    const oldest: number = now - PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS;
    const kept: Array<HeldItem> = [];

    for (const item of this.items) {
      if (itemAt(item) >= oldest) {
        kept.push(item);
        continue;
      }

      if (item.event) {
        this.eventCount--;
        this.droppedEvents++;
      } else {
        this.metricCount--;
      }
    }

    if (kept.length !== this.items.length) {
      this.scheduleStore();
    }

    this.items = kept;
  }

  /*
   * What a previous run left in the device's storage (issue #9577), taken
   * back before anything new: the items under the sessions and people they
   * happened under, the batch that was on its way under its own id. What
   * the server would no longer keep (PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS) is
   * left out, and the caps apply as to anything held: past them the oldest
   * events go, counted in the diagnostics' dropped.
   */
  private restoreQueue(raw: string | null, now: number): void {
    if (!raw) {
      return;
    }

    const queue: RestoredQueue | null = readStoredQueue(raw);

    if (!queue) {
      this.host.onDiagnostic("analytics-store-unreadable");
      this.forgetStoredQueue();
      return;
    }

    const oldest: number = now - PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS;
    const droppedBefore: number = this.droppedEvents;
    let tooOld: number = 0;

    /* The batch on its way goes again, unless everything in it is too old. */
    const pending: ProductAnalyticsWireBatch | null = queue.pending;

    if (pending) {
      const isLive: boolean = [...pending.events, ...pending.metrics].some(
        (item: { at: number }): boolean => {
          return item.at >= oldest;
        },
      );

      if (isLive) {
        this.pending = pending;
      } else {
        this.droppedEvents += pending.events.length;
        tooOld += pending.events.length + pending.metrics.length;
      }
    }

    this.items = queue.items.filter((item: HeldItem): boolean => {
      if (itemAt(item) >= oldest) {
        return true;
      }

      if (item.event) {
        this.droppedEvents++;
      }

      tooOld++;
      return false;
    });
    this.eventCount = this.items.filter((item: HeldItem): boolean => {
      return Boolean(item.event);
    }).length;
    this.metricCount = this.items.length - this.eventCount;

    const droppedTooOld: number = this.droppedEvents - droppedBefore;

    this.trimEvents();

    while (this.metricCount > PRODUCT_ANALYTICS_MAX_PENDING_EVENTS) {
      this.dropOldest("metric");
    }

    this.host.onDiagnostic("analytics-restored", {
      events: this.eventCount + (this.pending?.events.length ?? 0),
      metrics: this.metricCount + (this.pending?.metrics.length ?? 0),
      droppedTooOld: droppedTooOld,
      droppedOverCap: this.droppedEvents - droppedBefore - droppedTooOld,
    });

    /* What was left out is left out of the stored copy too. */
    if (tooOld > 0 || this.items.length < queue.items.length) {
      this.scheduleStore();
    }
  }

  /* A change to what is held: written once the burst it belongs to is over. */
  private scheduleStore(): void {
    if (!this.restored || this.stopReason || this.storeTimer) {
      return;
    }

    this.storeTimer = setTimeout((): void => {
      this.storeTimer = null;
      this.storeNow();
    }, PRODUCT_ANALYTICS_STORE_DELAY_MS);
  }

  /* What is held, written now, in the order the writes were asked for. */
  private storeNow(): void {
    this.cancelStoreTimer();

    if (!this.restored || this.revoked) {
      return;
    }

    const storage: ReplayStorage = this.host.storage;
    const key: string = productAnalyticsQueueKey(this.host.namespace);
    const value: string | null = buildStoredQueue(this.items, this.pending);

    void enqueueStoreWrite(storage, key, async (): Promise<void> => {
      if (value === null) {
        await storage.removeItem(key);
      } else {
        await storage.setItem(key, value);
      }
    });
  }

  private forgetStoredQueue(): void {
    this.cancelStoreTimer();

    const storage: ReplayStorage = this.host.storage;
    const key: string = productAnalyticsQueueKey(this.host.namespace);

    void enqueueStoreWrite(storage, key, async (): Promise<void> => {
      await storage.removeItem(key);
    });
  }

  private cancelStoreTimer(): void {
    if (this.storeTimer) {
      clearTimeout(this.storeTimer);
      this.storeTimer = null;
    }
  }

  private send(batch: ProductAnalyticsWireBatch): void {
    const generation: number = this.sendGeneration;
    const controller: AbortController | null =
      typeof AbortController === "undefined" ? null : new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;

    /*
     * sentAt is when this request goes, not when the batch was first built:
     * the server moves every time in the batch by the gap between it and
     * its own clock (receivedAt - sentAt), so a batch sent again after a
     * back-off, an hour offline or a relaunch, under the old sentAt, would
     * be filed as if it all happened at the moment it finally arrived.
     */
    const init: NonNullable<Parameters<ReplayFetch>[1]> = {
      method: "POST",
      headers: {
        ...this.host.headers,
        "Content-Type": PRODUCT_ANALYTICS_CONTENT_TYPE,
      },
      body: JSON.stringify({ ...batch, sentAt: this.host.now() }),
    };

    if (controller) {
      init.signal = controller.signal;
    }

    let request: Promise<ReplayFetchResponse>;

    try {
      request = this.host.fetch(this.host.url, init);
    } catch {
      this.retryLater(this.host.now(), 0);
      return;
    }

    const deadline: Promise<never> = new Promise<never>(
      (
        _resolve: (value: never | PromiseLike<never>) => void,
        reject: (reason?: unknown) => void,
      ): void => {
        timeout = setTimeout((): void => {
          controller?.abort();
          reject(new Error("analytics-request-timeout"));
        }, PRODUCT_ANALYTICS_REQUEST_TIMEOUT_MS);
      },
    );

    this.sending = true;

    Promise.race([request, deadline])
      .then((response: ReplayFetchResponse): void => {
        if (generation !== this.sendGeneration) {
          return;
        }

        this.sending = false;
        this.onAnswer(response, this.host.now());
      })
      .catch((): void => {
        if (generation !== this.sendGeneration) {
          return;
        }

        this.sending = false;
        this.retryLater(this.host.now(), 0);
      })
      .finally((): void => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
  }

  private onAnswer(response: ReplayFetchResponse, now: number): void {
    const status: number = response.status;

    if (status === 202 || status === 200) {
      this.pending = null;
      this.failures = 0;
      this.scheduleStore();

      if (this.items.length > 0) {
        this.flush(false);
      }

      return;
    }

    if (status === 413) {
      /* Never sendable; the next batch is smaller. */
      this.pending = null;
      this.scheduleStore();
      return;
    }

    if (status === 204 || status === 400 || status === 403) {
      let reason: string = "";

      try {
        reason = response.headers?.get("x-oneuptime-replay-reason") || "";
      } catch {
        reason = "";
      }

      this.host.onDiagnostic("analytics-stopped", {
        status: status,
        reason: reason.slice(0, 100),
      });

      this.stop(
        status === 403
          ? "origin-not-allowed"
          : status === 204
            ? "not-enabled"
            : "refused",
      );
      return;
    }

    /*
     * A 429's or a 503's Retry-After, as RFC 9110 writes it (RetryAfter):
     * whole seconds or an HTTP date, from one second to
     * RETRY_AFTER_LIMIT_SECONDS. Anything else is none, and the doubling
     * applies.
     */
    const retryAfterMs: number =
      status === 429 || status === 503
        ? RetryAfter.msFromHeaders(response.headers, {
            maxMs: RETRY_AFTER_LIMIT_SECONDS * 1000,
            nowMs: now,
          }) ?? 0
        : 0;

    /* 409 (consent not given), 429, 5xx: the same batch later. */
    this.retryLater(now, retryAfterMs);
  }

  private retryLater(now: number, delayMs: number): void {
    this.failures++;
    this.retryAtUnixMs =
      now +
      (delayMs > 0
        ? delayMs
        : Math.min(
            PRODUCT_ANALYTICS_MAX_RETRY_DELAY_MS,
            PRODUCT_ANALYTICS_FLUSH_INTERVAL_MS * Math.pow(2, this.failures),
          ));
  }

  /*
   * The app leaving the foreground sends what is held while it still can;
   * coming back, or the device saying it is online again, sends a batch
   * that waited at once, rather than when its retry was due.
   */
  private listenToLifecycle(): void {
    const appState: ProductAnalyticsAppState | null | undefined =
      this.host.appState;

    if (appState && typeof appState.addEventListener === "function") {
      try {
        this.appStateSubscription = appState.addEventListener(
          "change",
          (state: string): void => {
            if (state === "active") {
              this.retryAtUnixMs = 0;
              this.flush(false);
              return;
            }

            this.flush(true);
            /*
             * In the background the system may stop the app at any moment:
             * what was not sent is written now, not after the usual wait.
             */
            this.storeNow();
          },
        );
      } catch {
        this.appStateSubscription = null;
      }
    }

    const connectivity: ReplayConnectivity | undefined = this.host.connectivity;

    if (!connectivity) {
      return;
    }

    try {
      const unsubscribe: unknown = connectivity.subscribe(
        (isConnected: boolean | null): void => {
          if (isConnected === false) {
            this.offline = true;
            return;
          }

          if (isConnected === true) {
            const wasOffline: boolean = this.offline;
            this.offline = false;

            if (wasOffline) {
              this.retryAtUnixMs = 0;
              this.flush(false);
            }
          }
        },
      );

      this.unsubscribeConnectivity =
        typeof unsubscribe === "function" ? (unsubscribe as () => void) : null;
    } catch {
      /* A throwing connectivity source only costs the early send. */
      this.unsubscribeConnectivity = null;
    }
  }
}
