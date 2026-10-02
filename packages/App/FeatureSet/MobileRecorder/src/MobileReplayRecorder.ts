import { AppState, Keyboard } from "react-native";
import ReplayChunkBuffer, {
  BufferedReplaySegment,
  RollingReplayBuffer,
} from "./ChunkBuffer";
import {
  CUSTOM_EVENT_TAG,
  ERROR_CUSTOM_EVENT_TAG,
  IDENTIFY_CUSTOM_EVENT_TAG,
  IDLE_PAUSED_CUSTOM_EVENT_TAG,
  IDLE_RESUMED_CUSTOM_EVENT_TAG,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MOBILE_CAPTURE_INTERVAL_MS,
  MOBILE_RECORDER_KIND,
  RECORDER_VERSION,
  ROUTE_CUSTOM_EVENT_TAG,
  SESSION_REPLAY_CHECKOUT_INTERVAL_MS,
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_PAUSE_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SESSION_ROTATED_CUSTOM_EVENT_TAG,
  SYNTHETIC_RRWEB_VERSION,
  TAGS_CUSTOM_EVENT_TAG,
  TOUCH_CUSTOM_EVENT_TAG,
  VISIBILITY_CUSTOM_EVENT_TAG,
  RrwebEvent,
  SessionReplayCaptureTrigger,
  SessionReplayChunkEnvelope,
  SessionReplayChunkMeta,
  SessionReplayConsentMode,
  SessionReplayConsentState,
  SessionReplayDirective,
  SessionReplayIdlePausedPayload,
  SessionReplayIdleResumedPayload,
  SessionReplayTriggerReason,
} from "./Contract";
import {
  fetchReplayConfig,
  forgetReplayConfig,
  loadCachedReplayConfig,
  MobileReplayStartOptions,
  ResolvedReplayConfig,
  saveReplayConfig,
  ValidatedStartOptions,
  validateStartOptions,
} from "./Config";
import {
  createCustomEvent,
  createTouchEvent,
  RecordedTouch,
  sanitizeRecordedTouch,
} from "./Events";
import {
  defaultNativeViewTreeAdapter,
  getViewport,
  NativeAppMetadata,
  NativeViewTreeAdapter,
  NativeViewTreeNode,
} from "./NativeViewTree";
import ReplayOutbox from "./Outbox";
import {
  MAX_CAPTURE_REASON_LENGTH,
  MAX_CUSTOM_EVENT_NAME_LENGTH,
  MAX_TAG_KEY_LENGTH,
  MAX_TAG_VALUE_LENGTH,
  MAX_USER_REFERENCE_LENGTH,
  maskStringMapValues,
  maskTextValue,
  sanitizeEventProperties,
  sanitizeRoute,
  sanitizeTags,
  sanitizeTraits,
  toAppUrl,
  truncate,
} from "./Sanitize";
import ReplaySessionStore, {
  defaultReplayStorage,
  generateReplayId,
  ReplaySessionIdentity,
  ReplayStorage,
} from "./Storage";
import ReplayTransport from "./Transport";
import {
  CONSERVATIVE_TOUCH_PRIVACY_MAP,
  deriveTouchPrivacyMap,
  isTouchPrivate,
  TouchPrivacyMap,
} from "./TouchPrivacy";
import ViewTreeSerializer, { SerializedCapture } from "./ViewTreeSerializer";

/*
 * "paused" is a recording recorder that nobody has touched for
 * SESSION_REPLAY_IDLE_PAUSE_MS: it captures nothing until the next touch or
 * the app's return to the foreground (see idlePause).
 */
export type MobileReplayStatus =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "background"
  | "consent-required"
  | "disabled"
  | "stopped"
  | "consent-revoked";

export interface MobileReplayDiagnosticEvent {
  code: string;
  atUnixMs: number;
  details?: Record<string, unknown>;
}

export interface MobileReplayDiagnostics {
  status: MobileReplayStatus;
  sessionId: string | null;
  recorderKind: "rn-view-tree";
  configEpoch: number;
  sampled: boolean;
  triggered: boolean;
  consentState: SessionReplayConsentState;
  pendingEvents: number;
  events: Array<MobileReplayDiagnosticEvent>;
}

export type MobileReplaySessionChangeListener = (
  sessionId: string | null,
) => void;

interface AppStateSubscription {
  remove(): void;
}

export interface ReplayAppState {
  currentState: string | null;
  addEventListener(
    type: "change",
    listener: (state: string) => void,
  ): AppStateSubscription;
}

interface KeyboardSubscription {
  remove(): void;
}

/*
 * The soft keyboard, as React Native's Keyboard module reports it. Typing
 * on it never reaches the replay root as a touch - the keyboard is a window
 * of its own - so its showing and hiding are what say someone is typing.
 * The Did events, because Android reports no Will events. isVisible() (React
 * Native 0.71+) says whether it was already up when recording started.
 */
export interface ReplayKeyboard {
  addListener(
    eventName: "keyboardDidShow" | "keyboardDidHide",
    listener: () => void,
  ): KeyboardSubscription;
  isVisible?(): boolean;
}

export interface MobileReplayRecorderDependencies {
  storage?: ReplayStorage;
  nativeViewTree?: NativeViewTreeAdapter;
  appState?: ReplayAppState;
  keyboard?: ReplayKeyboard;
  now?: () => number;
}

type GlobalErrorHandler = (error: Error, isFatal?: boolean) => void;

interface GlobalErrorUtils {
  getGlobalHandler?(): GlobalErrorHandler | undefined;
  setGlobalHandler?(handler: GlobalErrorHandler): void;
}

const MAX_DIAGNOSTIC_EVENTS: number = 100;
const TOUCH_MOVE_SAMPLE_MS: number = 50;
export const MOBILE_POLICY_REFRESH_INTERVAL_MS: number = 5 * 60_000;
type SessionRotationReason = "duration" | "idle" | "chunk-cap" | "identity";
type PolicyRefreshReason = "consent" | "foreground" | "identity" | "periodic";
type ChunkAppendOptions = NonNullable<
  Parameters<ReplayChunkBuffer["append"]>[1]
>;

/*
 * Capture stopped because nobody touched the app for
 * SESSION_REPLAY_IDLE_PAUSE_MS. Kept from the pause until the snapshot
 * that resumes it is in the buffer, or until the session rotates.
 */
interface IdlePause {
  /*
   * The stream the pause belongs to. Only that session and tab are owed
   * the matching idle-resumed marker, and only its seal is dated at the
   * pause: an identity swapped underneath (a consent decision) never had
   * the pause in its stream.
   */
  sessionId: string;
  tabId: string;
  idleSinceUnixMs: number;
  pausedAtUnixMs: number;
  /*
   * The idle-paused marker went out in an uploading stream. A recorder
   * holding its pre-roll in memory marks nothing and drops the pre-roll
   * instead (see pauseForIdle), so its resume owes no marker and its seal
   * sends nothing.
   */
  marked: boolean;
  /*
   * Set when the session ended while paused - its idle window ran out, it
   * reached the duration cap, or the app changed users - with the reason
   * the next session will rotate under. Nothing more is sent for it, and
   * its successor begins with the person's next input rather than a
   * session of nobody (see sealIdlePausedSession).
   */
  sealedReason: SessionRotationReason | null;
}

/* An event recorded between an input that ended a pause and its snapshot. */
interface HeldReplayEvent {
  event: RrwebEvent;
  options: ChunkAppendOptions;
}

/*
 * The resuming snapshot normally follows its input within one native
 * capture. This bounds what can pile up when it cannot - a replay root
 * unmounted during the pause leaves nothing to capture until it is back.
 */
const MAX_EVENTS_HELD_FOR_RESUME: number = 500;

/*
 * What a touch or a return to the foreground did to an idle pause:
 * nothing (there was none), resumed the paused session, or found that the
 * paused session has ended, so the input starts the next one.
 */
type IdleInputOutcome = "none" | "resumed" | "session-ended";

const SAFE_ERROR_NAMES: ReadonlySet<string> = new Set<string>([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

function defaultNow(): number {
  return Date.now();
}

function deterministicSample(sessionId: string, percentage: number): boolean {
  if (percentage >= 100) {
    return true;
  }
  if (percentage <= 0) {
    return false;
  }

  let hash: number = 2_166_136_261;
  for (let index: number = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) % 10_000 < Math.round(percentage * 100);
}

function hashNamespaceSecret(value: string): string {
  const seeds: Array<number> = [
    2_166_136_261, 2_654_435_761, 1_013_904_223, 3_747_611_933,
  ];
  return seeds
    .map((seed: number): string => {
      let hash: number = seed;
      for (let index: number = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
}

export function getReplayStorageNamespace(
  options: Pick<
    ValidatedStartOptions,
    "host" | "token" | "appIdentifier" | "mobileAppIdentifier"
  >,
): string {
  const scope: string = [
    options.host,
    options.appIdentifier,
    options.mobileAppIdentifier,
    hashNamespaceSecret(options.token),
  ].join("\u0000");
  return `v1-${hashNamespaceSecret(scope)}`;
}

function safeMetadataValue(
  value: unknown,
  fallback: string,
  maximumLength: number = 100,
): string {
  return typeof value === "string" && value.trim()
    ? truncate(value.trim(), maximumLength)
    : fallback;
}

function isRetryablePolicyFailure(config: ResolvedReplayConfig): boolean {
  if (config.disabledReason === "config-fetch-failed") {
    return true;
  }
  const match: RegExpMatchArray | null =
    config.disabledReason?.match(/^config-http-(\d{3})$/u) ?? null;
  if (!match) {
    return false;
  }
  const status: number = Number(match[1]);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export default class MobileReplayRecorder {
  private readonly storage: ReplayStorage;
  private readonly nativeViewTree: NativeViewTreeAdapter;
  private readonly appState: ReplayAppState;
  private readonly keyboard: ReplayKeyboard | null;
  private readonly now: () => number;
  private readonly serializer: ViewTreeSerializer = new ViewTreeSerializer();
  private readonly chunkBuffer: ReplayChunkBuffer = new ReplayChunkBuffer();
  private readonly rollingBuffer: RollingReplayBuffer =
    new RollingReplayBuffer();
  private diagnosticsStatus: MobileReplayStatus = "idle";
  private diagnosticsEvents: Array<MobileReplayDiagnosticEvent> = [];
  private options: ValidatedStartOptions | null = null;
  private config: ResolvedReplayConfig | null = null;
  private sessionStore: ReplaySessionStore | null = null;
  private identity: ReplaySessionIdentity | null = null;
  private outbox: ReplayOutbox | null = null;
  private transport: ReplayTransport | null = null;
  private metadata: NativeAppMetadata = {
    appName: "React Native",
    appVersion: "unknown",
    osName: "unknown",
    osVersion: "unknown",
  };
  private rootTag: number | null = null;
  private route: string = "/";
  private entryUrl: string = "";
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: AppStateSubscription | null = null;

  /*
   * Offline mode: the host app's connectivity source (start option
   * `connectivity`), and what it last said, which a transport created later
   * - after a consent or identity change - starts from.
   */
  private unsubscribeConnectivity: (() => void) | null = null;
  private lastConnectivity: boolean | null = null;

  /*
   * The policy in force is the cached one an offline launch started with,
   * or the last refresh could not reach the server. Refreshed the moment the
   * connection is back rather than on the five-minute schedule, so a policy
   * changed while the device was offline takes effect before its backlog
   * has finished uploading.
   */
  private policyStale: boolean = false;
  private captureGeneration: number | null = null;
  private running: boolean = false;
  private foreground: boolean = true;
  private forceFullSnapshot: boolean = true;
  private lastFullSnapshotAtUnixMs: number = 0;
  private sampled: boolean = false;
  private triggered: boolean = false;
  private uploadActive: boolean = false;
  private consentGranted: boolean = false;
  private triggerReason: SessionReplayTriggerReason =
    SessionReplayTriggerReason.Sampled;
  private userRef: string | null = null;
  private traits: Record<string, string> = {};
  private tags: Record<string, string> = {};
  private metaDirty: boolean = true;
  private droppedEvents: number = 0;
  private closeQueue: Promise<void> = Promise.resolve();
  private lastTouchMoveAtUnixMs: number = 0;
  private previousGlobalErrorHandler: GlobalErrorHandler | null = null;
  private installedGlobalErrorHandler: GlobalErrorHandler | null = null;
  private globalErrorUtils: GlobalErrorUtils | null = null;
  private lifecycleGeneration: number = 0;
  private lifecycleCancellationEpoch: number = 0;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private pendingStart: {
    generation: number;
    promise: Promise<boolean>;
  } | null = null;
  private pendingStartCancellation: {
    generation: number;
    cancel: () => void;
  } | null = null;
  private identityPersisted: boolean = false;
  private sessionLastActivityUnixMs: number = 0;
  private rotatingSession: boolean = false;
  private rotationPromise: Promise<void> | null = null;
  private appStateQueue: Promise<void> = Promise.resolve();
  private acceptingEvents: boolean = false;
  private lastPolicyRefreshAtUnixMs: number = 0;
  private policyRefreshPromise: Promise<boolean> | null = null;
  private identityQueue: Promise<void> = Promise.resolve();
  private identityCancellationEpoch: number = 0;
  private pendingIdentityOperations: number = 0;
  private readonly sessionChangeListeners: Set<MobileReplaySessionChangeListener> =
    new Set<MobileReplaySessionChangeListener>();
  private lastNotifiedSessionId: string | null = null;
  private touchPrivacyMap: TouchPrivacyMap = CONSERVATIVE_TOUCH_PRIVACY_MAP;
  private touchQueue: Promise<void> = Promise.resolve();
  private readonly suppressedTouchPointers: Set<string> = new Set<string>();
  private unidentifiedTouchCount: number = 0;
  private unidentifiedTouchPrivate: boolean = false;

  /*
   * When the person last did something: a touch (any touch - one inside a
   * ReplayMask is still someone using the app, even though it is never
   * recorded), the app coming back to the foreground, or the app starting.
   * Not sessionLastActivityUnixMs, which every recorded event moves: a
   * route change, a track() call or a JS error the app raises by itself is
   * the app, not the person, and a polling screen would otherwise never
   * look idle.
   */
  private lastInputUnixMs: number = 0;

  /*
   * The idle pause (SESSION_REPLAY_IDLE_PAUSE_MS, #4208). Set when the
   * capture tick finds nobody has touched the app for that long: the open
   * chunk closes with an idle-paused marker as its last event, the capture
   * timer stops, and from then on nothing is recorded - no view-tree
   * sample, no checkout, no chunk, and every event the app emits is
   * dropped rather than queued. The 15-second flush timer is the only one
   * left, and all it does is end the session if nobody comes back inside
   * SESSION_REPLAY_IDLE_ROLLOVER_MS.
   *
   * It exists because the recorder used to go on sampling the view tree
   * every 500 ms, with a full checkout every minute, for the whole half
   * hour before the idle rollover - the phone's CPU and battery and the
   * customer's upload and storage, all spent on footage of nobody.
   *
   * The next touch, or the app returning to the foreground, resumes the
   * same session and tab on a fresh full snapshot with an idle-resumed
   * marker directly behind it (idleResumeBacklog), at the next chunk index.
   */
  private idlePause: IdlePause | null = null;

  /*
   * Non-null from the input that ends an idle pause until the snapshot it
   * resumes on is in the buffer. What is recorded meanwhile - the touch
   * that woke the recorder, the screen it opened, a track() it caused - is
   * held here and appended behind that snapshot and the idle-resumed
   * marker, so the chunk after a pause always opens on its snapshot.
   */
  private idleResumeBacklog: Array<HeldReplayEvent> | null = null;

  /*
   * The soft keyboard is up. Keystrokes reach no view the recorder can see,
   * so someone writing a long message - a chat, a form, a review - would
   * otherwise look exactly like nobody touching the app. While it is up the
   * idle pause waits, and its showing and hiding are input
   * (onKeyboardChange). The 30-minute rollover does not look at it.
   */
  private softKeyboardVisible: boolean = false;
  private keyboardSubscriptions: Array<KeyboardSubscription> = [];

  public constructor(dependencies: MobileReplayRecorderDependencies = {}) {
    this.storage = dependencies.storage ?? defaultReplayStorage;
    this.nativeViewTree =
      dependencies.nativeViewTree ?? defaultNativeViewTreeAdapter;
    this.appState =
      dependencies.appState ?? (AppState as unknown as ReplayAppState);
    /* Absent where React Native has no Keyboard module: no typing signal. */
    this.keyboard =
      dependencies.keyboard ??
      (Keyboard as unknown as ReplayKeyboard | undefined) ??
      null;
    this.now = dependencies.now ?? defaultNow;
  }

  public start(options: MobileReplayStartOptions): Promise<boolean> {
    if (
      this.pendingStart &&
      this.pendingStart.generation === this.lifecycleCancellationEpoch
    ) {
      return this.pendingStart.promise;
    }

    const requestGeneration: number = this.lifecycleCancellationEpoch;
    const identityBarrier: Promise<void> = this.identityQueue;
    const promise: Promise<boolean> = this.enqueueLifecycleOperation(
      async (): Promise<boolean> => {
        await identityBarrier;
        if (requestGeneration !== this.lifecycleCancellationEpoch) {
          return false;
        }
        return await this.startNow(options);
      },
    );
    this.pendingStart = { generation: requestGeneration, promise };
    void promise.then(
      (): void => {
        if (this.pendingStart?.promise === promise) {
          this.pendingStart = null;
        }
      },
      (): void => {
        if (this.pendingStart?.promise === promise) {
          this.pendingStart = null;
        }
      },
    );
    return promise;
  }

  private async startNow(options: MobileReplayStartOptions): Promise<boolean> {
    if (this.running) {
      return true;
    }
    const generation: number = this.lifecycleGeneration + 1;
    this.lifecycleGeneration = generation;
    let cancelStart: () => void = (): void => {
      return undefined;
    };
    const cancellation: Promise<boolean> = new Promise<boolean>(
      (resolve: (value: boolean | PromiseLike<boolean>) => void): void => {
        cancelStart = (): void => {
          resolve(false);
        };
      },
    );
    this.pendingStartCancellation = { generation, cancel: cancelStart };
    const work: Promise<boolean> = this.startInternal(options, generation);
    try {
      return await Promise.race([work, cancellation]);
    } finally {
      if (this.pendingStartCancellation?.generation === generation) {
        this.pendingStartCancellation = null;
      }
    }
  }

  private async startInternal(
    options: MobileReplayStartOptions,
    generation: number,
  ): Promise<boolean> {
    this.acceptingEvents = false;
    this.diagnosticsStatus = "starting";
    this.serializer.reset();
    this.chunkBuffer.clear();
    this.rollingBuffer.clear();
    this.closeQueue = Promise.resolve();
    this.appStateQueue = Promise.resolve();
    this.rotationPromise = null;
    this.rotatingSession = false;
    this.policyRefreshPromise = null;
    this.lastPolicyRefreshAtUnixMs = 0;
    this.forceFullSnapshot = true;
    this.lastFullSnapshotAtUnixMs = 0;
    this.touchPrivacyMap = CONSERVATIVE_TOUCH_PRIVACY_MAP;
    this.touchQueue = Promise.resolve();
    this.resetTouchSequences();
    this.idlePause = null;
    this.idleResumeBacklog = null;
    const validated: ValidatedStartOptions | null =
      validateStartOptions(options);
    if (!validated) {
      this.disable("invalid-start-options");
      return false;
    }

    if (validated.userRef) {
      this.userRef = truncate(validated.userRef, MAX_USER_REFERENCE_LENGTH);
    }
    this.options = this.userRef
      ? { ...validated, userRef: this.userRef }
      : validated;
    if (this.nativeViewTree.isAvailable?.() === false) {
      this.disable("native-module-unavailable", {
        expoGoUnsupported: true,
      });
      return false;
    }

    const namespace: string = getReplayStorageNamespace(validated);
    let config: ResolvedReplayConfig = await fetchReplayConfig(this.options);
    if (!this.isCurrentGeneration(generation)) {
      return false;
    }

    /*
     * Offline mode. An app launched without a connection cannot fetch its
     * policy; failing closed there meant nothing was recorded on exactly the
     * launches offline mode exists for. The last policy the server gave is
     * used instead - only when the request got no usable answer, never when
     * the server answered that replay is off - and the periodic refresh
     * replaces it the moment the server can be reached.
     */
    let configFromCache: boolean = false;
    if (isRetryablePolicyFailure(config)) {
      const cached: ResolvedReplayConfig | null = await loadCachedReplayConfig(
        this.storage,
        namespace,
        this.now(),
      );
      if (!this.isCurrentGeneration(generation)) {
        return false;
      }
      if (cached) {
        this.diagnostic("config-from-cache", {
          reason: config.disabledReason ?? "not-reported",
        });
        config = cached;
        configFromCache = true;
      }
    } else if (this.mayPersistUnder(config)) {
      await saveReplayConfig(this.storage, namespace, config, this.now());
    }

    if (
      !configFromCache &&
      config.enabled &&
      this.userRef &&
      (config.consentMode === SessionReplayConsentMode.NotRequired ||
        this.consentGranted)
    ) {
      config = await this.refreshTargetingConfig(config);
      if (!this.isCurrentGeneration(generation)) {
        return false;
      }
    }
    this.config = config;
    if (!config.enabled) {
      this.disable("config-disabled", {
        reason: config.disabledReason ?? "not-reported",
      });
      return false;
    }
    /* A cached policy is refreshed at the first chance, not in five minutes. */
    this.lastPolicyRefreshAtUnixMs = configFromCache ? 0 : this.now();
    this.policyStale = configFromCache;

    const sessionStore: ReplaySessionStore = new ReplaySessionStore(
      this.storage,
      namespace,
    );
    this.sessionStore = sessionStore;
    const nowUnixMs: number = this.now();
    const awaitingConsent: boolean =
      config.consentMode === SessionReplayConsentMode.RequireExplicit &&
      !this.consentGranted;
    if (awaitingConsent) {
      this.identity = this.ephemeralIdentity(nowUnixMs);
      this.identityPersisted = false;
      this.sampled = false;
    } else {
      const identity: ReplaySessionIdentity =
        await sessionStore.resolve(nowUnixMs);
      if (
        !this.isCurrentGeneration(generation) ||
        this.sessionStore !== sessionStore
      ) {
        return false;
      }
      this.identity = identity;
      this.identityPersisted = true;
      this.sampled = deterministicSample(
        this.identity.sessionId,
        config.samplePercentage,
      );
    }
    this.sessionLastActivityUnixMs = nowUnixMs;
    /*
     * Starting is itself the person: the app was just opened. Without this
     * an app nobody touches after launch would be judged idle from epoch 0
     * and pause on its very first capture.
     */
    this.lastInputUnixMs = nowUnixMs;
    if (
      !awaitingConsent &&
      config.captureTrigger === SessionReplayCaptureTrigger.Always &&
      !this.sampled &&
      !config.isTargeted
    ) {
      this.disable("not-sampled");
      return false;
    }

    this.outbox = new ReplayOutbox(this.storage, namespace, this.now);
    this.transport = this.createTransport(validated, this.outbox);
    this.subscribeConnectivity(validated);

    try {
      const nativeMetadata: NativeAppMetadata =
        await this.nativeViewTree.getAppMetadata();
      if (!this.isCurrentGeneration(generation)) {
        return false;
      }
      this.metadata = {
        appName: safeMetadataValue(
          validated.appName,
          safeMetadataValue(nativeMetadata?.appName, "React Native"),
        ),
        appVersion: safeMetadataValue(
          validated.appVersion,
          safeMetadataValue(nativeMetadata?.appVersion, "unknown"),
        ),
        osName: safeMetadataValue(nativeMetadata?.osName, "unknown"),
        osVersion: safeMetadataValue(nativeMetadata?.osVersion, "unknown"),
      };
    } catch {
      if (!this.isCurrentGeneration(generation)) {
        return false;
      }
      this.diagnostic("native-metadata-unavailable");
    }

    this.route = "/";
    this.entryUrl = toAppUrl(validated.mobileAppIdentifier, this.route);
    this.running = true;
    this.acceptingEvents = true;
    this.triggered = config.isTargeted;
    this.triggerReason = config.isTargeted
      ? SessionReplayTriggerReason.Manual
      : SessionReplayTriggerReason.Sampled;
    const hasConsent: boolean =
      config.consentMode === SessionReplayConsentMode.NotRequired ||
      this.consentGranted;
    this.uploadActive =
      hasConsent && (this.sampled || config.isTargeted || this.triggered);
    this.foreground = this.appState.currentState === "active";
    this.diagnosticsStatus = hasConsent
      ? this.foreground
        ? "recording"
        : "background"
      : "consent-required";
    this.notifySessionChange();
    this.installLifecycle();
    this.installGlobalErrorHandler();
    if (this.foreground) {
      this.startTimers();
      await this.captureTick(true);
    }
    if (!this.running) {
      return false;
    }
    if (this.uploadActive) {
      await this.transport.restore();
    }
    if (!this.isCurrentGeneration(generation) || !this.running) {
      return false;
    }
    this.diagnostic("recorder-started", {
      sampled: this.sampled,
      consentState: this.consentState(),
    });
    return true;
  }

  public stop(): Promise<void> {
    const identityBarrier: Promise<void> = this.identityQueue;
    this.lifecycleGeneration += 1;
    this.lifecycleCancellationEpoch += 1;
    this.pendingStartCancellation?.cancel();
    this.acceptingEvents = false;
    this.quiesceCapture();
    return this.enqueueLifecycleOperation(async (): Promise<void> => {
      await identityBarrier;
      await this.stopInternal();
    });
  }

  private async stopInternal(): Promise<void> {
    if (!this.running) {
      this.diagnosticsStatus = "stopped";
      return;
    }

    if (this.rotationPromise) {
      await this.rotationPromise;
    }
    if (!this.running) {
      this.diagnosticsStatus = "stopped";
      return;
    }

    const pause: IdlePause | null = this.idlePause;
    if (pause === null) {
      this.appendCustom(
        VISIBILITY_CUSTOM_EVENT_TAG,
        { state: "stopped" },
        undefined,
        true,
      );
    } else if (pause.sealedReason === null && this.isPauseInStream(pause)) {
      /*
       * Stopped while paused for idle: the session's footage ended at the
       * pause, so its final chunk is dated there. Dated now, the session
       * would run on over the whole stretch nobody recorded. An input that
       * came back without its snapshot yet recorded nothing either. A
       * session already sealed while paused sent its final chunk then.
       */
      this.idleResumeBacklog = null;
      this.appendMarker(
        VISIBILITY_CUSTOM_EVENT_TAG,
        { state: "stopped" },
        pause.pausedAtUnixMs,
      );
    }
    /* Quiesce first so no timer or AppState callback can append after final. */
    this.haltCapture();
    await this.closeCurrent(true);
    if (this.uploadActive) {
      await this.transport?.drain();
    } else {
      this.rollingBuffer.clear();
    }
    this.transport?.destroy();
    this.diagnosticsStatus = "stopped";
    this.diagnostic("recorder-stopped");
  }

  public grantConsent(): Promise<void> {
    const identityBarrier: Promise<void> = this.identityQueue;
    return this.enqueueLifecycleOperation(async (): Promise<void> => {
      await identityBarrier;
      await this.grantConsentInternal();
    });
  }

  private async grantConsentInternal(): Promise<void> {
    this.consentGranted = true;
    if (!this.running && this.options) {
      const options: ValidatedStartOptions = this.options;
      await this.startNow(options);
      return;
    }
    if (!this.running || !this.config) {
      return;
    }

    const generation: number = this.lifecycleGeneration;
    const refreshed: boolean = await this.refreshRuntimePolicy(
      generation,
      true,
      "consent",
    );
    if (
      !refreshed ||
      !this.running ||
      !this.consentGranted ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }
    this.diagnosticsStatus = this.foreground ? "recording" : "background";
    this.diagnostic("consent-granted");
  }

  public revokeConsent(): Promise<void> {
    this.lifecycleGeneration += 1;
    this.lifecycleCancellationEpoch += 1;
    this.identityCancellationEpoch += 1;
    this.pendingStartCancellation?.cancel();
    this.consentGranted = false;
    this.acceptingEvents = false;
    this.haltCapture();
    this.transport?.destroy();
    return this.enqueueLifecycleOperation(async (): Promise<void> => {
      return this.revokeConsentInternal();
    });
  }

  private async revokeConsentInternal(): Promise<void> {
    this.haltCapture();
    this.transport?.destroy();
    this.chunkBuffer.clear();
    this.rollingBuffer.clear();
    this.serializer.reset();
    await this.closeQueue.catch((): void => {
      return undefined;
    });
    await this.outbox?.clear();
    await this.sessionStore?.clear();
    await this.forgetCachedConfig();
    this.identity = null;
    this.userRef = null;
    this.traits = {};
    this.tags = {};
    this.uploadActive = false;
    this.triggered = false;
    this.diagnosticsStatus = "consent-revoked";
    this.diagnostic("consent-revoked");
  }

  public identify(userRef: string, traits?: Record<string, unknown>): void {
    const trimmedRef: string =
      typeof userRef === "string" ? userRef.trim() : "";
    const ref: string | null = trimmedRef
      ? truncate(trimmedRef, MAX_USER_REFERENCE_LENGTH)
      : null;
    const sanitizedTraits: Record<string, string> | null =
      traits === undefined ? null : maskStringMapValues(sanitizeTraits(traits));
    const identityEpoch: number = this.identityCancellationEpoch;
    const lifecycleBarrier: Promise<void> = this.lifecycleQueue;
    this.pendingIdentityOperations += 1;
    const operation: Promise<void> = this.identityQueue.then(
      async (): Promise<void> => {
        await lifecycleBarrier;
        await this.applyIdentityChange(ref, sanitizedTraits, identityEpoch);
      },
    );
    this.identityQueue = operation.then(
      (): void => {
        this.pendingIdentityOperations = Math.max(
          0,
          this.pendingIdentityOperations - 1,
        );
      },
      (): void => {
        this.pendingIdentityOperations = Math.max(
          0,
          this.pendingIdentityOperations - 1,
        );
        this.diagnostic("identity-change-failed");
      },
    );
  }

  public setTags(tags: Record<string, unknown>): void {
    const sanitizedTags: Record<string, string> = sanitizeTags(tags);
    this.runExternalActivity(this.now(), (): void => {
      this.tags = sanitizedTags;
      this.metaDirty = true;
      this.appendCustom(TAGS_CUSTOM_EVENT_TAG, { ...this.tags });
    });
  }

  public addTag(key: string, value: string | number | boolean): void {
    if (typeof key !== "string") {
      return;
    }
    const safeKey: string = truncate(key.trim(), MAX_TAG_KEY_LENGTH);
    if (!safeKey) {
      return;
    }
    const safeValue: string = truncate(String(value), MAX_TAG_VALUE_LENGTH);
    this.runExternalActivity(this.now(), (): void => {
      this.tags = sanitizeTags({
        ...this.tags,
        [safeKey]: safeValue,
      });
      this.metaDirty = true;
      this.appendCustom(TAGS_CUSTOM_EVENT_TAG, { ...this.tags });
    });
  }

  public track(name: string, properties?: Record<string, unknown>): void {
    const eventName: string =
      typeof name === "string"
        ? truncate(name.trim(), MAX_CUSTOM_EVENT_NAME_LENGTH)
        : "";
    if (!eventName) {
      return;
    }

    const sanitizedProperties: Record<string, string> = maskStringMapValues(
      sanitizeEventProperties(properties),
    );
    this.runExternalActivity(this.now(), (): void => {
      this.appendCustom(
        CUSTOM_EVENT_TAG,
        { name: eventName, properties: sanitizedProperties },
        "customEventCount",
      );
    });
  }

  public async setRoute(route: string): Promise<void> {
    await this.identityQueue;
    /*
     * Paused for idle, the route the app moves to on its own is not
     * recorded (nor counted) - only remembered, so the snapshot the resume
     * takes is on the screen the app is actually showing.
     */
    if (this.running && (!this.acceptingEvents || this.isIdlePaused())) {
      this.route = sanitizeRoute(route);
      return;
    }
    await this.maybeRotateSession(this.now());
    if (!this.options) {
      this.route = sanitizeRoute(route);
      return;
    }

    const previous: string = this.route;
    const next: string = sanitizeRoute(route);
    if (previous === next) {
      return;
    }

    this.route = next;
    this.appendCustom(
      ROUTE_CUSTOM_EVENT_TAG,
      {
        from: toAppUrl(this.options.mobileAppIdentifier, previous),
        to: toAppUrl(this.options.mobileAppIdentifier, next),
        kind: "manual",
      },
      "routeCount",
    );
    await this.closeCurrent(false);
    this.forceFullSnapshot = true;
    await this.captureTick(true);
  }

  public async captureSession(reason: string = "manual"): Promise<void> {
    await this.identityQueue;
    if (!this.running || !this.acceptingEvents) {
      return;
    }
    /*
     * The app asked for this moment to be recorded. Paused for idle,
     * capture resumes at once, on a snapshot of what is on screen now, with
     * the idle-resumed marker and then this marker behind it. A session that
     * ended while paused is followed by the next one first, the way input
     * would start it, so the marker lands there. Not input, though:
     * lastInputUnixMs stays where the person left it, so the next pause
     * check pauses again unless someone is actually there - as the browser
     * recorder does. In the background nothing can be captured; the pause
     * stands, and only the trigger applies.
     */
    const resume: IdleInputOutcome = this.foreground
      ? this.endIdlePause(this.now())
      : "none";
    if (resume !== "none") {
      this.startTimers();
    }
    await this.maybeRotateSession(this.now());
    if (resume !== "none") {
      /*
       * The snapshot first, and without the pause check that follows a
       * sample, which would pause again before this marker is in. Under an
       * error trigger the upload below then opens on that snapshot.
       */
      await this.captureTick(true, false);
      if (!this.running || !this.acceptingEvents) {
        return;
      }
    }
    const safeReason: string = truncate(
      (typeof reason === "string" ? reason.trim() : "") || "manual",
      MAX_CAPTURE_REASON_LENGTH,
    );
    this.appendCustom(CUSTOM_EVENT_TAG, {
      name: "oneuptime.capture",
      properties: { reason: maskTextValue(safeReason) },
    });
    await this.trigger(SessionReplayTriggerReason.Manual);
  }

  public async captureError(error: unknown): Promise<void> {
    await this.identityQueue;
    if (!this.running || !this.acceptingEvents) {
      return;
    }
    /*
     * Nobody is using the app. A background poll's failure says nothing
     * about what the user went through: it is neither recorded (nothing is,
     * while paused) nor allowed to trigger an upload of a session whose
     * footage ended minutes before it.
     */
    if (this.isIdlePaused()) {
      return;
    }
    await this.maybeRotateSession(this.now());
    const rawName: string =
      error instanceof Error && typeof error.name === "string"
        ? error.name.trim()
        : "";
    const name: string = SAFE_ERROR_NAMES.has(rawName) ? rawName : "Error";
    /* Error text and stacks can quote end-user data; mobile v1 never sends them. */
    this.appendCustom(
      ERROR_CUSTOM_EVENT_TAG,
      { kind: "error", name, message: "[masked]" },
      "errorCount",
    );
    await this.trigger(SessionReplayTriggerReason.Error);
  }

  public recordTouch(touch: RecordedTouch): void {
    const sanitizedTouch: RecordedTouch | null = sanitizeRecordedTouch(
      touch,
      this.now(),
    );
    if (!sanitizedTouch) {
      this.diagnostic("invalid-touch-event");
      return;
    }
    if (!this.running || !this.acceptingEvents || !this.foreground) {
      return;
    }
    const input: IdleInputOutcome = this.noteUserInput(this.now());
    let resumeCapture: Promise<void> | null = null;
    if (input !== "none") {
      this.startTimers();
    }
    if (input === "resumed") {
      /*
       * The capture that resumes the session starts now, and this touch
       * waits for it: recorded behind the snapshot and the idle-resumed
       * marker, and checked against the privacy map that snapshot derives
       * rather than the one from before the pause, which may describe a
       * screen the app has since left. A touch that finds the session
       * ended goes on as it always has: dropped while the next session
       * starts (recordTouchAfterPrivacyCheck).
       */
      resumeCapture = this.captureTick(true);
    }
    const generation: number = this.lifecycleGeneration;
    const operation: Promise<void> = this.touchQueue.then(
      async (): Promise<void> => {
        if (resumeCapture) {
          await resumeCapture;
        }
        await this.recordTouchAfterPrivacyCheck(sanitizedTouch, generation);
      },
    );
    this.touchQueue = operation.catch((): void => {
      this.diagnostic("touch-privacy-check-failed");
    });
  }

  private async recordTouchAfterPrivacyCheck(
    touch: RecordedTouch,
    generation: number,
  ): Promise<void> {
    if (
      !this.running ||
      !this.acceptingEvents ||
      !this.foreground ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }
    const pointIsPrivate: boolean = await this.isCurrentTouchPrivate(touch);
    if (
      !this.running ||
      !this.acceptingEvents ||
      !this.foreground ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }
    if (this.updateTouchSuppression(touch, pointIsPrivate)) {
      this.diagnostic("touch-suppressed-private-region");
      return;
    }
    if (
      touch.phase === "move" &&
      touch.timestamp - this.lastTouchMoveAtUnixMs < TOUCH_MOVE_SAMPLE_MS
    ) {
      return;
    }
    if (touch.phase === "move") {
      this.lastTouchMoveAtUnixMs = touch.timestamp;
    }

    const nowUnixMs: number = this.now();
    if (this.rotatingSession || this.rotationReason(nowUnixMs)) {
      this.diagnostic("touch-dropped-session-rotation");
      void this.maybeRotateSession(nowUnixMs);
      return;
    }

    this.appendEvent(
      createTouchEvent(touch),
      touch.phase === "start" ? "clickCount" : undefined,
    );
    if (touch.phase === "start") {
      this.appendCustom(TOUCH_CUSTOM_EVENT_TAG, {
        phase: "start",
        x: touch.x,
        y: touch.y,
      });
    }
  }

  public setRootTag(rootTag: number | null): void {
    this.rootTag =
      typeof rootTag === "number" &&
      Number.isSafeInteger(rootTag) &&
      rootTag > 0
        ? rootTag
        : null;
    this.forceFullSnapshot = true;
    this.touchPrivacyMap = CONSERVATIVE_TOUCH_PRIVACY_MAP;
    this.resetTouchSequences();
    if (
      this.rootTag &&
      this.running &&
      this.acceptingEvents &&
      this.foreground
    ) {
      void this.captureTick(true);
    }
  }

  public getDiagnostics(): MobileReplayDiagnostics {
    /*
     * Derived rather than stored: the policy, consent and identity paths
     * all write "recording" without knowing about the pause, and a paused
     * recorder that reported "recording" is exactly the question a support
     * ticket asks.
     */
    const status: MobileReplayStatus =
      this.diagnosticsStatus === "recording" &&
      this.running &&
      this.foreground &&
      this.isIdlePaused()
        ? "paused"
        : this.diagnosticsStatus;
    return {
      status,
      sessionId: this.identity?.sessionId ?? null,
      recorderKind: MOBILE_RECORDER_KIND,
      configEpoch: this.config?.configEpoch ?? 0,
      sampled: this.sampled,
      triggered: this.triggered,
      consentState: this.consentState(),
      pendingEvents:
        this.rollingBuffer.length + (this.chunkBuffer.isEmpty() ? 0 : 1),
      events: this.diagnosticsEvents.map(
        (event: MobileReplayDiagnosticEvent): MobileReplayDiagnosticEvent => {
          const copied: MobileReplayDiagnosticEvent = {
            code: event.code,
            atUnixMs: event.atUnixMs,
          };
          if (event.details) {
            copied.details = { ...event.details };
          }
          return copied;
        },
      ),
    };
  }

  /** Current consented replay session for host trace/log correlation. */
  public getSessionId(): string | null {
    /*
     * None while a session that ended during an idle pause waits for its
     * successor: it is over, and after an identity change it belongs to
     * the previous user, so nothing the app does meanwhile may be filed
     * under it. The next input starts the next session and announces it.
     */
    const endedWhilePaused: boolean =
      this.idlePause !== null && this.idlePause.sealedReason !== null;
    return this.running && this.identityPersisted && !endedWhilePaused
      ? this.identity?.sessionId ?? null
      : null;
  }

  /** Fires immediately when a session exists and again on rotate/clear. */
  public onSessionChange(
    listener: MobileReplaySessionChangeListener,
  ): () => void {
    if (typeof listener !== "function") {
      return (): void => {
        return undefined;
      };
    }
    this.sessionChangeListeners.add(listener);
    const sessionId: string | null = this.getSessionId();
    if (sessionId) {
      try {
        listener(sessionId);
      } catch {
        /* Host observers cannot interrupt capture. */
      }
    }
    return (): void => {
      this.sessionChangeListeners.delete(listener);
    };
  }

  private async trigger(reason: SessionReplayTriggerReason): Promise<void> {
    if (
      !this.running ||
      !this.acceptingEvents ||
      this.triggered ||
      this.uploadActive ||
      this.sampled ||
      this.config?.isTargeted
    ) {
      return;
    }

    this.triggered = true;
    this.triggerReason = reason;
    this.diagnostic("capture-triggered", { reason });
    if (this.consentState() !== "Unknown") {
      await this.activateUpload(this.lifecycleGeneration);
    }
  }

  private async activateUpload(generation: number): Promise<void> {
    if (
      !this.running ||
      !this.acceptingEvents ||
      this.uploadActive ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }

    await this.closeCurrent(false);
    if (
      !this.running ||
      !this.acceptingEvents ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }
    this.uploadActive = true;
    const buffered: Array<BufferedReplaySegment> = this.rollingBuffer.drain();
    for (const segment of buffered) {
      if (
        !this.running ||
        !this.acceptingEvents ||
        !this.isCurrentGeneration(generation)
      ) {
        return;
      }
      await this.uploadSegment(segment, false);
    }
    if (
      !this.running ||
      !this.acceptingEvents ||
      !this.isCurrentGeneration(generation)
    ) {
      return;
    }
    await this.transport?.restore();
  }

  /*
   * mayPauseForIdle is false only for the snapshot captureSession() takes
   * while paused, whose marker must be in before the pause check runs.
   */
  private async captureTick(
    force: boolean = false,
    mayPauseForIdle: boolean = true,
  ): Promise<void> {
    const generation: number = this.lifecycleGeneration;
    if (
      !this.running ||
      !this.acceptingEvents ||
      !this.foreground ||
      !this.rootTag ||
      this.captureGeneration === generation ||
      !this.options
    ) {
      return;
    }
    /*
     * Paused for idle: no sample, no checkout, and not the periodic policy
     * refresh either. Nothing happens on a tick until input resumes it.
     */
    if (this.isIdlePaused()) {
      return;
    }

    this.captureGeneration = generation;
    try {
      const nowUnixMs: number = this.now();
      const policyReady: boolean = await this.refreshRuntimePolicy(
        generation,
        false,
        "periodic",
      );
      if (!policyReady) {
        return;
      }
      await this.maybeRotateSession(nowUnixMs);
      if (
        !this.running ||
        !this.acceptingEvents ||
        !this.foreground ||
        !this.isCurrentGeneration(generation)
      ) {
        return;
      }
      /*
       * Paused again meanwhile, or the person came back to a session that
       * has ended while its successor is not in place yet (a seal was still
       * finishing): the next tick starts that one. Nothing is captured into
       * a session that is over.
       */
      if (
        this.isIdlePaused() ||
        (this.idlePause !== null && this.rotationReason(nowUnixMs) !== null)
      ) {
        return;
      }
      const capturedSessionId: string | undefined = this.identity?.sessionId;
      const tree: NativeViewTreeNode =
        await this.nativeViewTree.captureViewTree(this.rootTag);
      if (
        !this.running ||
        !this.acceptingEvents ||
        !this.foreground ||
        !this.isCurrentGeneration(generation) ||
        this.rotatingSession ||
        !capturedSessionId ||
        this.identity?.sessionId !== capturedSessionId
      ) {
        return;
      }
      this.touchPrivacyMap = deriveTouchPrivacyMap(tree);
      const size: { width: number; height: number } = getViewport();
      const shouldForce: boolean =
        force ||
        this.forceFullSnapshot ||
        nowUnixMs - this.lastFullSnapshotAtUnixMs >=
          SESSION_REPLAY_CHECKOUT_INTERVAL_MS;
      if (shouldForce && !this.chunkBuffer.isEmpty()) {
        await this.closeCurrent(false);
      }
      if (
        !this.running ||
        !this.acceptingEvents ||
        !this.foreground ||
        !this.isCurrentGeneration(generation) ||
        this.identity?.sessionId !== capturedSessionId
      ) {
        return;
      }

      const capture: SerializedCapture = this.serializer.capture(tree, {
        timestamp: nowUnixMs,
        url: toAppUrl(this.options.mobileAppIdentifier, this.route),
        viewportWidth: size.width,
        viewportHeight: size.height,
        forceFullSnapshot: shouldForce,
      });
      this.droppedEvents += capture.droppedNodes;
      this.chunkBuffer.appendMany(capture.events, {
        route: toAppUrl(this.options.mobileAppIdentifier, this.route),
        fidelityNotices: capture.fidelityNotices,
      });
      if (capture.hasFullSnapshot) {
        this.lastFullSnapshotAtUnixMs = nowUnixMs;
        this.forceFullSnapshot = false;
        this.completeIdleResume(nowUnixMs);
      }
      if (this.chunkBuffer.shouldFlush()) {
        await this.closeCurrent(false);
      }
      /*
       * Nobody has touched the app for the pause window: stop capturing.
       * Checked after this tick's sample, so the chunk the pause closes ends
       * on the screen as it was when capture stopped. Never while the soft
       * keyboard is up: someone typing touches nothing the recorder sees,
       * so the check waits until it goes away (which is input itself).
       */
      if (
        mayPauseForIdle &&
        !this.softKeyboardVisible &&
        nowUnixMs - this.lastInputUnixMs >= SESSION_REPLAY_IDLE_PAUSE_MS
      ) {
        await this.pauseForIdle(nowUnixMs, generation);
      }
    } catch (error) {
      if (this.running && this.isCurrentGeneration(generation)) {
        this.disable("native-capture-failed", {
          name: error instanceof Error ? error.name : "Error",
        });
        this.haltCapture();
      }
    } finally {
      if (this.captureGeneration === generation) {
        this.captureGeneration = null;
      }
    }
  }

  /*
   * The person did something: a touch, the soft keyboard showing or
   * hiding, or the app coming back to the foreground. It ends an idle
   * pause. Inside the session's idle window the same session resumes, on
   * the snapshot of the next capture. Past it - or once the session was
   * sealed while paused - the session is over, and this input starts the
   * next one exactly as input after the rollover always has (the rotation
   * in maybeRotateSession, which is no longer held off once someone is
   * back). Either way the caller starts the capture: a touch or the
   * keyboard at once, a return to the foreground after its policy refresh.
   */
  private noteUserInput(nowUnixMs: number): IdleInputOutcome {
    this.lastInputUnixMs = Math.max(this.lastInputUnixMs, nowUnixMs);
    return this.endIdlePause(nowUnixMs);
  }

  /*
   * The pause-ending half of noteUserInput, on its own for captureSession(),
   * which resumes capture without being input: the idle clock keeps
   * counting from the person's last touch.
   */
  private endIdlePause(nowUnixMs: number): IdleInputOutcome {
    if (!this.isIdlePaused()) {
      return "none";
    }
    this.idleResumeBacklog = [];
    this.forceFullSnapshot = true;
    if (this.rotationReason(nowUnixMs) !== null) {
      return "session-ended";
    }
    /* The return is activity: the session's idle window starts over. */
    this.sessionLastActivityUnixMs = Math.max(
      this.sessionLastActivityUnixMs,
      nowUnixMs,
    );
    return "resumed";
  }

  /* Paused for idle with nobody back yet: nothing is captured or recorded. */
  private isIdlePaused(): boolean {
    return this.idlePause !== null && this.idleResumeBacklog === null;
  }

  /*
   * Whether the pause's marker is in the stream being recorded now, which
   * is what owes it the idle-resumed marker and dates a seal at it.
   */
  private isPauseInStream(pause: IdlePause): boolean {
    return (
      pause.marked &&
      this.identity?.sessionId === pause.sessionId &&
      this.identity?.tabId === pause.tabId
    );
  }

  /*
   * Stop capturing: nobody has touched the app for the pause window.
   *
   * In this order: the idle-paused marker goes in as the last event of the
   * open chunk, that chunk goes out through the ordinary path, and the
   * sampler stops. So the last thing the recording holds before the
   * stretch nobody recorded says so, and a session the person never comes
   * back to ends right there - every seal while paused is dated at the
   * pause.
   *
   * A recorder holding its pre-roll in memory (error-triggered, or waiting
   * for consent) has nothing to mark and nothing to send. Its pre-roll is
   * dropped instead: a trigger once the person is back must not upload a
   * minute of nobody in front of a snapshot taken after an unrecorded gap.
   */
  private async pauseForIdle(
    nowUnixMs: number,
    generation: number,
  ): Promise<void> {
    if (
      !this.running ||
      !this.acceptingEvents ||
      !this.foreground ||
      !this.isCurrentGeneration(generation) ||
      this.idlePause !== null ||
      !this.identity
    ) {
      return;
    }

    const paused: SessionReplayIdlePausedPayload = {
      /*
       * Never before the session began: one that started with nobody there
       * (the chunk cap rolled it over) was not idle before it existed.
       */
      idleSinceUnixMs: Math.min(
        nowUnixMs,
        Math.max(this.lastInputUnixMs, this.identity.sessionStartUnixMs),
      ),
      pausedAtUnixMs: nowUnixMs,
    };
    const marked: boolean = this.uploadActive;
    this.idlePause = {
      sessionId: this.identity.sessionId,
      tabId: this.identity.tabId,
      idleSinceUnixMs: paused.idleSinceUnixMs,
      pausedAtUnixMs: paused.pausedAtUnixMs,
      marked,
      sealedReason: null,
    };
    this.stopCaptureTimer();
    this.diagnostic("idle-paused", {
      idleForMs: nowUnixMs - paused.idleSinceUnixMs,
    });

    if (!marked) {
      this.chunkBuffer.clear();
      this.rollingBuffer.clear();
      return;
    }
    this.appendMarker(IDLE_PAUSED_CUSTOM_EVENT_TAG, paused, nowUnixMs);
    await this.closeCurrent(false);
  }

  /*
   * The snapshot the session resumes on is in the buffer: the idle-resumed
   * marker goes directly behind it, then whatever was recorded since the
   * input that woke the recorder. Same session, same tab and - the pause
   * having closed its chunk - the next chunk index.
   */
  private completeIdleResume(nowUnixMs: number): void {
    const pause: IdlePause | null = this.idlePause;
    const held: Array<HeldReplayEvent> | null = this.idleResumeBacklog;
    if (pause === null || held === null) {
      return;
    }
    this.idlePause = null;
    this.idleResumeBacklog = null;

    const resumedAtUnixMs: number = Math.max(pause.pausedAtUnixMs, nowUnixMs);
    if (this.isPauseInStream(pause)) {
      const resumed: SessionReplayIdleResumedPayload = {
        pausedAtUnixMs: pause.pausedAtUnixMs,
        resumedAtUnixMs,
      };
      this.appendMarker(
        IDLE_RESUMED_CUSTOM_EVENT_TAG,
        resumed,
        resumedAtUnixMs,
      );
    }
    this.releaseHeldEvents(held);
    this.diagnostic("idle-resumed", {
      pausedForMs: resumedAtUnixMs - pause.pausedAtUnixMs,
    });
  }

  /*
   * The paused session ended with nobody back: its idle window ran out, it
   * reached the duration cap, or the app changed users. It ends where its
   * footage ended - its final chunk is dated at the pause - and its
   * successor waits for the person's next input instead of beginning now,
   * as a session of nobody. Nothing is left to wait for, so the heartbeat
   * stops as well, and the stored record goes, so a relaunch meanwhile
   * starts afresh instead of continuing a session that is over.
   */
  private async sealIdlePausedSession(
    reason: SessionRotationReason,
  ): Promise<void> {
    const pause: IdlePause | null = this.idlePause;
    if (pause === null || pause.sealedReason !== null) {
      return;
    }
    pause.sealedReason = reason;
    this.clearTimers();
    this.notifySessionChange();
    this.diagnostic("idle-session-ended", { reason });

    if (this.isPauseInStream(pause)) {
      this.appendMarker(
        SESSION_ROTATED_CUSTOM_EVENT_TAG,
        { reason },
        pause.pausedAtUnixMs,
      );
      await this.closeCurrent(true);
      await this.closeQueue;
      if (!this.running) {
        return;
      }
      if (this.uploadActive) {
        await this.transport?.drain();
      }
    }
    if (this.running && this.identityPersisted) {
      await this.sessionStore?.end();
    }
  }

  /*
   * A marker the recorder writes about itself - the idle pause and resume,
   * and a seal while paused - straight into the open chunk, stamped with
   * the moment it stands for. None of them is activity (the idle rollover
   * must not move for them), and none is "now": a seal while paused is
   * dated at the pause.
   */
  private appendMarker(tag: string, payload: unknown, timestamp: number): void {
    const options: ChunkAppendOptions = {};
    if (this.options) {
      options.route = toAppUrl(this.options.mobileAppIdentifier, this.route);
    }
    if (
      !this.chunkBuffer.append(
        createCustomEvent(tag, payload, timestamp),
        options,
      )
    ) {
      this.droppedEvents += 1;
    }
  }

  /* What was held for a resume, in the order it was recorded. */
  private releaseHeldEvents(held: Array<HeldReplayEvent>): void {
    for (const entry of held) {
      if (!this.chunkBuffer.append(entry.event, entry.options)) {
        this.droppedEvents += 1;
      }
    }
  }

  private appendCustom(
    tag: string,
    payload: unknown,
    signal?: "errorCount" | "routeCount" | "customEventCount",
    allowWhenQuiesced: boolean = false,
  ): void {
    this.appendEvent(
      createCustomEvent(tag, payload, this.now()),
      signal,
      allowWhenQuiesced,
    );
  }

  private appendEvent(
    event: RrwebEvent,
    signal?: "errorCount" | "routeCount" | "clickCount" | "customEventCount",
    allowWhenQuiesced: boolean = false,
  ): void {
    if (!this.running || (!this.acceptingEvents && !allowWhenQuiesced)) {
      return;
    }
    if (!Number.isFinite(event.timestamp)) {
      this.droppedEvents += 1;
      this.diagnostic("invalid-event-timestamp");
      return;
    }

    /*
     * Paused for idle: nothing is recorded. Dropped, not queued - held
     * until the resume, a route the app changed or a track() it fired
     * twenty minutes earlier would be stamped after the person came back -
     * and neither counted in the chunk's signals nor taken as activity, so
     * an app that keeps raising events cannot hold the idle rollover off.
     */
    if (this.isIdlePaused()) {
      return;
    }

    const appendOptions: ChunkAppendOptions = {};
    if (this.options) {
      appendOptions.route = toAppUrl(
        this.options.mobileAppIdentifier,
        this.route,
      );
    }
    if (signal) {
      appendOptions.signal = signal;
    }

    /*
     * The person is back but the snapshot the session resumes on is not in
     * the buffer yet: held, to land behind it (completeIdleResume). Not
     * activity either - a session that ended while paused must still read
     * as ended until its successor starts, and a resumed one already took
     * the input that woke it as activity.
     */
    if (this.idleResumeBacklog !== null) {
      if (this.idleResumeBacklog.length < MAX_EVENTS_HELD_FOR_RESUME) {
        this.idleResumeBacklog.push({ event, options: appendOptions });
      } else {
        this.droppedEvents += 1;
      }
      return;
    }

    this.sessionLastActivityUnixMs = Math.max(
      this.sessionLastActivityUnixMs,
      event.timestamp,
    );

    const accepted: boolean = this.chunkBuffer.append(event, appendOptions);
    if (!accepted) {
      this.droppedEvents += 1;
    }
    if (this.chunkBuffer.shouldFlush()) {
      void this.closeCurrent(false);
    }
  }

  private async closeCurrent(isFinal: boolean): Promise<void> {
    const closesFinalChunkSlot: boolean =
      !isFinal &&
      !this.rotatingSession &&
      this.uploadActive &&
      this.sessionStore?.getNextChunkIndex() ===
        MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1;
    if (closesFinalChunkSlot) {
      this.rotatingSession = true;
      const rotationOptions: NonNullable<
        Parameters<ReplayChunkBuffer["append"]>[1]
      > = {};
      if (this.options) {
        rotationOptions.route = toAppUrl(
          this.options.mobileAppIdentifier,
          this.route,
        );
      }
      this.chunkBuffer.append(
        createCustomEvent(
          SESSION_ROTATED_CUSTOM_EVENT_TAG,
          { reason: "chunk-cap" },
          this.now(),
        ),
        rotationOptions,
      );
    }
    const segment: BufferedReplaySegment | null = this.chunkBuffer.take();
    if (!segment) {
      if (closesFinalChunkSlot) {
        this.rotatingSession = false;
      }
      return;
    }

    const operation: Promise<void> = this.closeQueue.then(
      async (): Promise<void> => {
        return this.processSegment(segment, isFinal || closesFinalChunkSlot);
      },
    );
    if (closesFinalChunkSlot) {
      const rotation: Promise<void> = operation.then(
        async (): Promise<void> => {
          if (this.running) {
            await this.completeSessionIdentityRotation(this.now(), "chunk-cap");
          }
        },
      );
      this.rotationPromise = rotation;
      this.closeQueue = rotation.catch((): void => {
        this.diagnostic("chunk-close-failed");
      });
      try {
        await rotation;
      } finally {
        if (this.rotationPromise === rotation) {
          this.rotationPromise = null;
        }
        this.rotatingSession = false;
      }
      return;
    }
    this.closeQueue = operation.catch((): void => {
      this.diagnostic("chunk-close-failed");
    });
    return await operation;
  }

  private async processSegment(
    segment: BufferedReplaySegment,
    isFinal: boolean,
  ): Promise<void> {
    if (!this.uploadActive) {
      this.rollingBuffer.push(segment, this.now());
      return;
    }

    await this.uploadSegment(segment, isFinal);
  }

  private async uploadSegment(
    segment: BufferedReplaySegment,
    isFinal: boolean,
  ): Promise<void> {
    if (
      !this.options ||
      !this.config ||
      !this.identity ||
      !this.sessionStore ||
      !this.transport ||
      !this.identityPersisted
    ) {
      return;
    }

    const chunkIndex: number = await this.sessionStore.takeChunkIndex(
      this.now(),
    );
    if (chunkIndex >= MAX_SESSION_REPLAY_CHUNKS_PER_SESSION) {
      this.diagnostic("session-chunk-cap-race", { chunkIndex });
      if (this.running) {
        await this.completeSessionIdentityRotation(this.now(), "chunk-cap");
        await this.uploadSegment(segment, isFinal);
      }
      return;
    }

    const includeMeta: boolean = chunkIndex === 0 || isFinal || this.metaDirty;
    const envelope: SessionReplayChunkEnvelope = {
      v: SESSION_REPLAY_WIRE_VERSION,
      appIdentifier: this.options.appIdentifier,
      sessionId: this.identity.sessionId,
      tabId: this.identity.tabId,
      chunkIndex,
      sessionStartUnixMs: this.identity.sessionStartUnixMs,
      clientSendUnixMs: this.now(),
      chunkStartOffsetMs: Math.max(
        0,
        segment.startUnixMs - this.identity.sessionStartUnixMs,
      ),
      chunkEndOffsetMs: Math.max(
        0,
        segment.endUnixMs - this.identity.sessionStartUnixMs,
      ),
      eventCount: segment.eventCount,
      hasFullSnapshot: segment.hasFullSnapshot,
      isFinal,
      recorderKind: MOBILE_RECORDER_KIND,
      schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
      rrwebVersion: SYNTHETIC_RRWEB_VERSION,
      recorderVersion: RECORDER_VERSION,
      maskingMode: this.config.maskingMode,
      consentState: this.consentState(),
      triggerReason: this.triggerReason,
      payloadEncoding: "gzip",
      payloadBytes: 0,
      url: toAppUrl(this.options.mobileAppIdentifier, this.route),
      routes: segment.routes,
      signals: segment.signals,
      fidelityNotices: segment.fidelityNotices,
      droppedEvents: segment.droppedEvents + this.droppedEvents,
      flushFailures: this.transport.getFlushFailures(),
    };
    if (includeMeta) {
      envelope.meta = this.buildMeta();
    }
    if (chunkIndex === 0) {
      envelope.capabilities = Array.from(
        SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
      );
    }
    this.metaDirty = false;
    this.droppedEvents = 0;
    await this.transport.enqueue(envelope, segment.payload);
  }

  private buildMeta(): SessionReplayChunkMeta {
    const size: { width: number; height: number } = getViewport();
    const captureIdentity: boolean = this.config?.captureUserIdentity === true;
    const meta: SessionReplayChunkMeta = {
      entryUrl: this.entryUrl,
      browserName: this.metadata.appName,
      browserVersion: this.metadata.appVersion,
      osName: `${this.metadata.osName} ${this.metadata.osVersion}`.trim(),
      deviceType: this.metadata.osName.toLowerCase().includes("ios")
        ? "ios"
        : "android",
      viewportWidth: size.width,
      viewportHeight: size.height,
    };
    if (this.identity?.visitorId) {
      meta.visitorId = this.identity.visitorId;
    }
    if (captureIdentity && this.userRef) {
      meta.identifiedUserRef = this.userRef;
    }
    if (captureIdentity && Object.keys(this.traits).length > 0) {
      meta.identifiedUserTraits = { ...this.traits };
    }
    if (Object.keys(this.tags).length > 0) {
      meta.tags = { ...this.tags };
    }
    return meta;
  }

  private consentState(): SessionReplayConsentState {
    if (this.config?.consentMode === SessionReplayConsentMode.NotRequired) {
      return "NotRequired";
    }

    return this.consentGranted ? "Granted" : "Unknown";
  }

  private installLifecycle(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = this.appState.addEventListener(
      "change",
      (state: string): void => {
        const generation: number = this.lifecycleGeneration;
        const operation: Promise<void> = this.appStateQueue.then(
          async (): Promise<void> => {
            await this.onAppStateChange(state, generation);
          },
        );
        this.appStateQueue = operation.catch((): void => {
          this.diagnostic("app-state-transition-failed");
        });
      },
    );
    this.installKeyboardListeners();
  }

  private installKeyboardListeners(): void {
    this.removeKeyboardListeners();
    const keyboard: ReplayKeyboard | null = this.keyboard;
    this.softKeyboardVisible = false;
    if (!keyboard || typeof keyboard.addListener !== "function") {
      return;
    }
    try {
      /* Already up when recording started: someone is typing. */
      this.softKeyboardVisible = keyboard.isVisible?.() === true;
    } catch {
      this.softKeyboardVisible = false;
    }
    try {
      this.keyboardSubscriptions.push(
        keyboard.addListener("keyboardDidShow", (): void => {
          this.onKeyboardChange(true);
        }),
        keyboard.addListener("keyboardDidHide", (): void => {
          this.onKeyboardChange(false);
        }),
      );
    } catch {
      /* A keyboard module that cannot be observed costs only this signal. */
      this.removeKeyboardListeners();
      this.softKeyboardVisible = false;
      this.diagnostic("keyboard-subscribe-failed");
    }
  }

  private removeKeyboardListeners(): void {
    const subscriptions: Array<KeyboardSubscription> =
      this.keyboardSubscriptions;
    this.keyboardSubscriptions = [];
    for (const subscription of subscriptions) {
      try {
        subscription.remove();
      } catch {
        /* The host's keyboard module must not break teardown. */
      }
    }
  }

  /*
   * The soft keyboard came up or went away. That is the person - a field
   * tapped, a message sent - so it counts as input and resumes a paused
   * recording the way a touch does; and while it is up the idle pause
   * waits, since what is typed on it reaches no view the recorder sees.
   */
  private onKeyboardChange(visible: boolean): void {
    this.softKeyboardVisible = visible;
    if (!this.running || !this.acceptingEvents || !this.foreground) {
      return;
    }
    if (this.noteUserInput(this.now()) !== "none") {
      this.startTimers();
      void this.captureTick(true);
    }
  }

  private async onAppStateChange(
    state: string,
    generation: number,
  ): Promise<void> {
    if (!this.running || !this.isCurrentGeneration(generation)) {
      return;
    }

    const isActive: boolean = state === "active";
    if (!isActive && this.foreground) {
      this.foreground = false;
      this.clearTimers();
      this.diagnosticsStatus = "background";
      if (this.rotationPromise) {
        await this.rotationPromise;
      }
      if (this.policyRefreshPromise) {
        await this.policyRefreshPromise;
      }
      if (!this.running || !this.isCurrentGeneration(generation)) {
        return;
      }
      if (this.idlePause !== null) {
        /*
         * Paused for idle - or a touch had just ended the pause and its
         * snapshot never came, which leaves the session paused where it
         * was. Nothing is recorded, not even this: the stream still says
         * "visible" from before the pause, and the return will read as the
         * idle-resumed marker. What the outbox already holds - the pause's
         * own chunk, if its upload failed - is still worth one try before
         * the OS suspends the app.
         */
        this.idleResumeBacklog = null;
        if (this.uploadActive) {
          await this.transport?.drain();
        }
        return;
      }
      this.appendCustom(VISIBILITY_CUSTOM_EVENT_TAG, { state: "hidden" });
      await this.closeCurrent(false);
      if (this.uploadActive) {
        await this.transport?.drain();
      }
      return;
    }

    if (isActive && !this.foreground) {
      this.foreground = true;
      /*
       * Coming back to the app is the person coming back: like a touch, it
       * ends an idle pause. The capture below takes the snapshot the
       * session resumes on.
       */
      const sessionIdBeforeReturn: string | undefined =
        this.identity?.sessionId;
      const input: IdleInputOutcome = this.noteUserInput(this.now());
      const policyReady: boolean = await this.refreshRuntimePolicy(
        generation,
        true,
        "foreground",
      );
      if (!policyReady) {
        return;
      }
      await this.maybeRotateSession(this.now());
      if (!this.running || !this.isCurrentGeneration(generation)) {
        return;
      }
      /*
       * A return that resumes the paused session records no visibility
       * change: none was recorded when the app left, and the idle-resumed
       * marker is what the return looks like. A return that starts a new
       * session opens it as it always has.
       */
      if (
        input !== "resumed" ||
        this.identity?.sessionId !== sessionIdBeforeReturn
      ) {
        this.appendCustom(VISIBILITY_CUSTOM_EVENT_TAG, { state: "visible" });
      }
      this.forceFullSnapshot = true;
      this.startTimers();
      this.diagnosticsStatus =
        this.consentState() === "Unknown" ? "consent-required" : "recording";
      await this.captureTick(true);

      /*
       * Offline mode: returning to the app is the most likely moment the
       * connection is back (the train left the tunnel while the phone was in
       * a pocket), so the backlog is tried now rather than on its timer.
       */
      if (this.uploadActive && this.running) {
        this.transport?.resume();
      }
    }
  }

  private startTimers(): void {
    this.clearTimers();
    const intervalMs: number = Math.max(
      250,
      Math.min(
        5_000,
        typeof this.options?.captureIntervalMs === "number" &&
          Number.isFinite(this.options.captureIntervalMs)
          ? this.options.captureIntervalMs
          : MOBILE_CAPTURE_INTERVAL_MS,
      ),
    );
    this.captureTimer = setInterval((): void => {
      void this.captureTick();
    }, intervalMs);
    this.flushTimer = setInterval((): void => {
      /*
       * Paused for idle, this is the only timer left running, and all it
       * does is end a session nobody came back to: maybeRotateSession seals
       * it once its idle window runs out (see sealIdlePausedSession).
       */
      if (this.isIdlePaused()) {
        if (this.acceptingEvents) {
          void this.maybeRotateSession(this.now());
        }
        return;
      }
      if (this.acceptingEvents) {
        void this.closeCurrent(false);
      }
    }, SESSION_REPLAY_FLUSH_INTERVAL_MS);
  }

  /*
   * The sampler alone. An idle pause stops it - every tick is a native
   * traversal of the whole view tree, which is what a pause is for not
   * paying - and keeps the 15-second flush timer as its heartbeat, rather
   * than waking the JS thread twice a second to find nothing to do.
   */
  private stopCaptureTimer(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopCaptureTimer();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private installGlobalErrorHandler(): void {
    const globals: Record<string, unknown> = globalThis as unknown as Record<
      string,
      unknown
    >;
    const errorUtils: GlobalErrorUtils | undefined = globals["ErrorUtils"] as
      | GlobalErrorUtils
      | undefined;
    const previous: GlobalErrorHandler | undefined =
      errorUtils?.getGlobalHandler?.();
    if (!errorUtils?.setGlobalHandler || typeof previous !== "function") {
      return;
    }

    this.globalErrorUtils = errorUtils;
    this.previousGlobalErrorHandler = previous;
    const handlerGeneration: number = this.lifecycleGeneration;
    const installedHandler: GlobalErrorHandler = (
      error: Error,
      isFatal?: boolean,
    ): void => {
      if (
        this.installedGlobalErrorHandler === installedHandler &&
        this.lifecycleGeneration === handlerGeneration
      ) {
        void this.captureError(error);
      }
      try {
        previous?.(error, isFatal);
      } catch {
        /* A pre-existing handler remains isolated from the recorder. */
      }
    };
    this.installedGlobalErrorHandler = installedHandler;
    errorUtils.setGlobalHandler(installedHandler);
  }

  private restoreGlobalErrorHandler(): void {
    if (
      this.globalErrorUtils?.setGlobalHandler &&
      this.globalErrorUtils.getGlobalHandler?.() ===
        this.installedGlobalErrorHandler &&
      this.previousGlobalErrorHandler
    ) {
      this.globalErrorUtils.setGlobalHandler(this.previousGlobalErrorHandler);
    }
    this.globalErrorUtils = null;
    this.previousGlobalErrorHandler = null;
    this.installedGlobalErrorHandler = null;
  }

  private createTransport(
    startOptions: ValidatedStartOptions,
    outbox: ReplayOutbox,
  ): ReplayTransport {
    const transport: ReplayTransport = new ReplayTransport({
      startOptions,
      outbox,
      onDirective: (
        directive: SessionReplayDirective,
        reason: string | null,
      ): void => {
        this.onDirective(directive, reason);
      },
      onDiagnostic: (code: string, details?: Record<string, unknown>): void => {
        this.diagnostic(code, details);
        if (code === "back-online") {
          this.onBackOnline();
        }
      },
    });
    if (this.lastConnectivity !== null) {
      transport.setConnectivity(this.lastConnectivity);
    }
    return transport;
  }

  private onDirective(
    directive: SessionReplayDirective,
    reason: string | null,
  ): void {
    this.diagnostic("server-directive", { directive, reason });
    if (directive === "stop") {
      this.disable("server-stopped", { reason });
      this.haltCapture();
      this.chunkBuffer.clear();
      this.rollingBuffer.clear();
      this.serializer.reset();
      this.touchPrivacyMap = CONSERVATIVE_TOUCH_PRIVACY_MAP;
      this.resetTouchSequences();
      this.uploadActive = false;
      this.transport?.destroy();
    }
  }

  private haltCapture(): void {
    this.running = false;
    this.acceptingEvents = false;
    this.quiesceCapture();
    this.notifySessionChange();
  }

  private notifySessionChange(): void {
    const sessionId: string | null = this.getSessionId();
    if (sessionId === this.lastNotifiedSessionId) {
      return;
    }
    this.lastNotifiedSessionId = sessionId;
    for (const listener of this.sessionChangeListeners) {
      try {
        listener(sessionId);
      } catch {
        /* Host observers cannot interrupt capture. */
      }
    }
  }

  private quiesceCapture(): void {
    this.clearTimers();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.removeKeyboardListeners();
    this.stopConnectivity();
    this.restoreGlobalErrorHandler();
  }

  /*
   * Whether this device may be written to under a policy. Nothing is stored
   * before an explicit consent the policy requires - the cached policy
   * included, even though it holds no user data - except a removal: a
   * policy that says replay is off always deletes the cached one.
   */
  /*
   * The cached policy goes with everything else when consent does: it holds
   * no user data, but "nothing of the recorder stays on the device" is the
   * promise, and the next consented policy fetch writes it again.
   */
  private async forgetCachedConfig(): Promise<void> {
    if (this.options) {
      await forgetReplayConfig(
        this.storage,
        getReplayStorageNamespace(this.options),
      );
    }
  }

  private mayPersistUnder(config: ResolvedReplayConfig): boolean {
    return (
      !config.enabled ||
      config.consentMode === SessionReplayConsentMode.NotRequired ||
      this.consentGranted
    );
  }

  private subscribeConnectivity(options: ValidatedStartOptions): void {
    this.stopConnectivity();
    this.lastConnectivity = null;
    if (!options.connectivity) {
      return;
    }

    try {
      const unsubscribe: unknown = options.connectivity.subscribe(
        (isConnected: boolean | null): void => {
          const connected: boolean | null =
            typeof isConnected === "boolean" ? isConnected : null;
          if (connected === this.lastConnectivity) {
            return;
          }
          this.lastConnectivity = connected;
          if (connected !== null) {
            this.diagnostic(connected ? "network-online" : "network-offline");
          }
          this.transport?.setConnectivity(connected);
          if (connected === true) {
            this.onBackOnline();
            /*
             * The backlog goes now - but only while uploading is allowed. A
             * consent this run has not been given does not become one
             * because the network came back.
             */
            if (this.uploadActive && this.running) {
              this.transport?.resume();
            }
          }
        },
      );
      this.unsubscribeConnectivity =
        typeof unsubscribe === "function" ? (unsubscribe as () => void) : null;
    } catch {
      /* A throwing connectivity source only costs the early drain. */
      this.diagnostic("connectivity-subscribe-failed");
    }
  }

  /* The next capture tick refreshes a stale policy (see policyStale). */
  private onBackOnline(): void {
    if (this.policyStale) {
      this.lastPolicyRefreshAtUnixMs = 0;
    }
  }

  private stopConnectivity(): void {
    const unsubscribe: (() => void) | null = this.unsubscribeConnectivity;
    this.unsubscribeConnectivity = null;
    try {
      unsubscribe?.();
    } catch {
      /* The host's unsubscribe must not break teardown. */
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.lifecycleGeneration;
  }

  private enqueueLifecycleOperation<T>(action: () => Promise<T>): Promise<T> {
    const operation: Promise<T> = this.lifecycleQueue.then(action, action);
    this.lifecycleQueue = operation.then(
      (): void => {
        return undefined;
      },
      (): void => {
        this.diagnostic("lifecycle-operation-failed");
      },
    );
    return operation;
  }

  private async isCurrentTouchPrivate(touch: RecordedTouch): Promise<boolean> {
    if (
      !this.rootTag ||
      !touch.targetTag ||
      typeof this.nativeViewTree.isTouchTargetPrivate !== "function"
    ) {
      return true;
    }
    try {
      const privateAncestry: boolean =
        await this.nativeViewTree.isTouchTargetPrivate(
          touch.targetTag,
          this.rootTag,
        );
      if (privateAncestry) {
        return true;
      }
      return isTouchPrivate(this.touchPrivacyMap, touch.x, touch.y);
    } catch {
      return true;
    }
  }

  private updateTouchSuppression(
    touch: RecordedTouch,
    pointIsPrivate: boolean,
  ): boolean {
    if (touch.pointerId !== undefined) {
      const pointerKey: string = `${typeof touch.pointerId}:${String(
        touch.pointerId,
      )}`;
      if (pointIsPrivate) {
        this.suppressedTouchPointers.add(pointerKey);
      }
      const suppressed: boolean = this.suppressedTouchPointers.has(pointerKey);
      if (touch.phase === "end") {
        this.suppressedTouchPointers.delete(pointerKey);
      }
      return suppressed;
    }

    if (touch.phase === "start") {
      this.unidentifiedTouchCount += 1;
    }
    if (pointIsPrivate) {
      this.unidentifiedTouchPrivate = true;
    }
    const suppressed: boolean = this.unidentifiedTouchPrivate;
    if (touch.phase === "end") {
      this.unidentifiedTouchCount = Math.max(
        0,
        this.unidentifiedTouchCount - 1,
      );
      if (this.unidentifiedTouchCount === 0) {
        this.unidentifiedTouchPrivate = false;
      }
    }
    return suppressed;
  }

  private resetTouchSequences(): void {
    this.suppressedTouchPointers.clear();
    this.unidentifiedTouchCount = 0;
    this.unidentifiedTouchPrivate = false;
  }

  private async applyIdentityChange(
    ref: string | null,
    traits: Record<string, string> | null,
    identityEpoch: number,
  ): Promise<void> {
    if (identityEpoch !== this.identityCancellationEpoch) {
      return;
    }
    if (!this.running) {
      this.applyIdentityValues(ref, traits, true);
      return;
    }

    if (ref === this.userRef) {
      this.applyIdentityValues(ref, traits, false);
      return;
    }

    const wasAcceptingEvents: boolean = this.acceptingEvents;
    this.acceptingEvents = false;
    try {
      if (this.policyRefreshPromise) {
        await this.policyRefreshPromise;
      }
      if (!this.running || identityEpoch !== this.identityCancellationEpoch) {
        return;
      }

      if (this.rotationPromise) {
        await this.rotationPromise;
      } else {
        this.rotatingSession = true;
        const rotation: Promise<void> = this.performSessionRotation(
          this.now(),
          "identity",
        );
        this.rotationPromise = rotation;
        try {
          await rotation;
        } finally {
          if (this.rotationPromise === rotation) {
            this.rotationPromise = null;
          }
          this.rotatingSession = false;
        }
      }
      if (identityEpoch !== this.identityCancellationEpoch) {
        return;
      }
      this.acceptingEvents = this.running && wasAcceptingEvents;
      /* A trigger belongs to one user/session and cannot cross accounts. */
      this.triggered = false;
      this.triggerReason = SessionReplayTriggerReason.Sampled;
      this.uploadActive = this.consentState() !== "Unknown" && this.sampled;
      this.applyIdentityValues(ref, traits, true);
      const generation: number = this.lifecycleGeneration;
      const policyReady: boolean = await this.refreshRuntimePolicy(
        generation,
        true,
        "identity",
      );
      if (
        !policyReady ||
        !this.running ||
        !this.isCurrentGeneration(generation) ||
        identityEpoch !== this.identityCancellationEpoch
      ) {
        return;
      }
      if (this.running && this.foreground) {
        this.forceFullSnapshot = true;
        void this.captureTick(true);
      }
    } finally {
      if (this.running && identityEpoch === this.identityCancellationEpoch) {
        this.acceptingEvents = wasAcceptingEvents;
      }
    }
  }

  private applyIdentityValues(
    ref: string | null,
    traits: Record<string, string> | null,
    clearTraitsWhenMissing: boolean,
  ): void {
    const changed: boolean = ref !== this.userRef;
    this.userRef = ref;
    if (traits) {
      this.traits = traits;
    } else if (clearTraitsWhenMissing && changed) {
      this.traits = {};
    }
    if (this.options) {
      const currentOptions: ValidatedStartOptions = { ...this.options };
      if (ref) {
        currentOptions.userRef = ref;
      } else {
        delete currentOptions.userRef;
      }
      this.options = currentOptions;
    }
    this.metaDirty = true;
    this.appendCustom(IDENTIFY_CUSTOM_EVENT_TAG, {
      identified: ref !== null,
      traitKeys: Object.keys(this.traits),
    });
  }

  private async refreshTargetingConfig(
    baseConfig: ResolvedReplayConfig,
    forceRefresh: boolean = false,
  ): Promise<ResolvedReplayConfig> {
    if (!this.options || (!forceRefresh && !this.userRef)) {
      return baseConfig;
    }
    const currentOptions: ValidatedStartOptions = { ...this.options };
    if (this.userRef) {
      currentOptions.userRef = this.userRef;
    } else {
      delete currentOptions.userRef;
    }
    const targetedConfig: ResolvedReplayConfig = await fetchReplayConfig(
      currentOptions,
      Boolean(this.userRef),
      forceRefresh,
    );
    return targetedConfig;
  }

  private async refreshRuntimePolicy(
    generation: number,
    forceRefresh: boolean,
    reason: PolicyRefreshReason,
  ): Promise<boolean> {
    if (
      !this.running ||
      !this.config ||
      !this.options ||
      !this.isCurrentGeneration(generation)
    ) {
      return false;
    }

    if (this.policyRefreshPromise) {
      const existingResult: boolean = await this.policyRefreshPromise;
      if (!forceRefresh || !existingResult) {
        return existingResult;
      }
    }

    const nowUnixMs: number = this.now();
    if (
      !forceRefresh &&
      nowUnixMs - this.lastPolicyRefreshAtUnixMs <
        MOBILE_POLICY_REFRESH_INTERVAL_MS
    ) {
      return true;
    }

    const operation: Promise<boolean> = this.performRuntimePolicyRefresh(
      generation,
      reason,
      nowUnixMs,
    );
    this.policyRefreshPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.policyRefreshPromise === operation) {
        this.policyRefreshPromise = null;
      }
    }
  }

  private async performRuntimePolicyRefresh(
    generation: number,
    reason: PolicyRefreshReason,
    nowUnixMs: number,
  ): Promise<boolean> {
    if (!this.options || !this.config) {
      return false;
    }
    const previousConfig: ResolvedReplayConfig = this.config;
    const previousConsentState: SessionReplayConsentState = this.consentState();
    const wasAcceptingEvents: boolean = this.acceptingEvents;
    this.acceptingEvents = false;
    try {
      let currentOptions: ValidatedStartOptions = this.currentStartOptions();
      const maySendUserRef: boolean =
        previousConsentState !== "Unknown" && Boolean(currentOptions.userRef);
      let freshConfig: ResolvedReplayConfig = await fetchReplayConfig(
        currentOptions,
        maySendUserRef,
        true,
      );
      if (!this.running || !this.isCurrentGeneration(generation)) {
        return false;
      }

      if (
        freshConfig.enabled &&
        !maySendUserRef &&
        freshConfig.consentMode === SessionReplayConsentMode.NotRequired &&
        this.userRef
      ) {
        currentOptions = this.currentStartOptions();
        freshConfig = await fetchReplayConfig(currentOptions, true, true);
        if (!this.running || !this.isCurrentGeneration(generation)) {
          return false;
        }
      }

      this.lastPolicyRefreshAtUnixMs = nowUnixMs;
      if (
        !isRetryablePolicyFailure(freshConfig) &&
        this.mayPersistUnder(freshConfig)
      ) {
        /* What the next offline launch records under (see startInternal). */
        await saveReplayConfig(
          this.storage,
          getReplayStorageNamespace(currentOptions),
          freshConfig,
          nowUnixMs,
        );
        if (!this.running || !this.isCurrentGeneration(generation)) {
          return false;
        }
      }
      if (!freshConfig.enabled) {
        if (reason !== "consent" && isRetryablePolicyFailure(freshConfig)) {
          this.diagnostic("policy-refresh-failed-using-last-config", {
            reason,
          });
          this.policyStale = true;
          return true;
        }
        this.config = freshConfig;
        await this.discardForPolicyStop(
          reason === "consent"
            ? "config-disabled-after-consent"
            : "config-disabled-after-refresh",
          freshConfig.disabledReason ?? "not-reported",
        );
        return false;
      }

      this.policyStale = false;
      return await this.applyRuntimePolicy(
        previousConfig,
        freshConfig,
        previousConsentState,
        wasAcceptingEvents,
        generation,
      );
    } catch (error) {
      if (!this.running || !this.isCurrentGeneration(generation)) {
        return false;
      }
      this.lastPolicyRefreshAtUnixMs = nowUnixMs;
      if (reason !== "consent") {
        this.diagnostic("policy-refresh-failed-using-last-config", {
          reason,
          name: error instanceof Error ? error.name : "Error",
        });
        return true;
      }
      await this.discardForPolicyStop(
        "config-disabled-after-consent",
        "config-fetch-failed",
      );
      return false;
    } finally {
      if (this.running && this.isCurrentGeneration(generation)) {
        this.acceptingEvents = wasAcceptingEvents;
      }
    }
  }

  private async applyRuntimePolicy(
    _previousConfig: ResolvedReplayConfig,
    freshConfig: ResolvedReplayConfig,
    previousConsentState: SessionReplayConsentState,
    wasAcceptingEvents: boolean,
    generation: number,
  ): Promise<boolean> {
    this.config = freshConfig;
    this.metaDirty = true;
    const hasConsent: boolean =
      freshConfig.consentMode === SessionReplayConsentMode.NotRequired ||
      this.consentGranted;

    if (!hasConsent) {
      const mustWithdrawPersistedState: boolean =
        this.identityPersisted ||
        this.uploadActive ||
        previousConsentState !== "Unknown";
      if (mustWithdrawPersistedState) {
        this.transport?.destroy();
        this.chunkBuffer.clear();
        this.rollingBuffer.clear();
        this.serializer.reset();
        await this.closeQueue.catch((): void => {
          return undefined;
        });
        await this.outbox?.clear();
        await this.sessionStore?.clear();
        await this.forgetCachedConfig();
        if (!this.running || !this.isCurrentGeneration(generation)) {
          return false;
        }
        const nowUnixMs: number = this.now();
        this.identity = this.ephemeralIdentity(nowUnixMs);
        this.identityPersisted = false;
        this.notifySessionChange();
        this.sessionLastActivityUnixMs = nowUnixMs;
        this.sampled = false;
        this.uploadActive = false;
        this.forceFullSnapshot = true;
        this.touchPrivacyMap = CONSERVATIVE_TOUCH_PRIVACY_MAP;
        this.resetTouchSequences();
        this.recreateTransport();
      }
      this.triggered = freshConfig.isTargeted;
      this.triggerReason = freshConfig.isTargeted
        ? SessionReplayTriggerReason.Manual
        : SessionReplayTriggerReason.Sampled;
      this.diagnosticsStatus = "consent-required";
      this.acceptingEvents = wasAcceptingEvents;
      this.diagnostic("policy-now-requires-consent");
      return true;
    }

    if (!this.identityPersisted && this.sessionStore) {
      const sessionStore: ReplaySessionStore = this.sessionStore;
      const identity: ReplaySessionIdentity = await sessionStore.resolve(
        this.now(),
      );
      if (
        !this.running ||
        !this.isCurrentGeneration(generation) ||
        this.sessionStore !== sessionStore
      ) {
        return false;
      }
      this.identity = identity;
      this.identityPersisted = true;
      this.notifySessionChange();
      this.sessionLastActivityUnixMs = this.now();
    }

    if (!this.identity) {
      return false;
    }
    this.sampled = deterministicSample(
      this.identity.sessionId,
      freshConfig.samplePercentage,
    );
    if (freshConfig.isTargeted) {
      this.triggered = true;
      this.triggerReason = SessionReplayTriggerReason.Manual;
    } else if (!this.triggered) {
      this.triggerReason = SessionReplayTriggerReason.Sampled;
    }

    if (
      freshConfig.captureTrigger === SessionReplayCaptureTrigger.Always &&
      !this.sampled &&
      !freshConfig.isTargeted
    ) {
      await this.discardForPolicyStop(
        "not-sampled-after-config-refresh",
        "not-sampled",
      );
      return false;
    }

    const shouldUpload: boolean =
      this.sampled || this.triggered || freshConfig.isTargeted;
    if (!shouldUpload && this.uploadActive) {
      this.transport?.destroy();
      this.chunkBuffer.clear();
      this.rollingBuffer.clear();
      await this.closeQueue.catch((): void => {
        return undefined;
      });
      await this.outbox?.clear();
      if (!this.running || !this.isCurrentGeneration(generation)) {
        return false;
      }
      this.uploadActive = false;
      this.recreateTransport();
    }

    this.acceptingEvents = wasAcceptingEvents;
    if (shouldUpload && !this.uploadActive) {
      await this.activateUpload(generation);
    }
    if (!this.running || !this.isCurrentGeneration(generation)) {
      return false;
    }
    this.diagnosticsStatus = this.foreground ? "recording" : "background";
    this.diagnostic("policy-refreshed", {
      configEpoch: freshConfig.configEpoch,
    });
    return true;
  }

  private currentStartOptions(): ValidatedStartOptions {
    const currentOptions: ValidatedStartOptions = {
      ...(this.options as ValidatedStartOptions),
    };
    if (this.userRef) {
      currentOptions.userRef = this.userRef;
    } else {
      delete currentOptions.userRef;
    }
    return currentOptions;
  }

  private recreateTransport(): void {
    if (this.options && this.outbox) {
      this.transport = this.createTransport(this.options, this.outbox);
    }
  }

  private async discardForPolicyStop(
    code: string,
    reason: string,
  ): Promise<void> {
    this.disable(code, { reason });
    this.haltCapture();
    this.transport?.destroy();
    this.chunkBuffer.clear();
    this.rollingBuffer.clear();
    this.serializer.reset();
    this.touchPrivacyMap = CONSERVATIVE_TOUCH_PRIVACY_MAP;
    this.resetTouchSequences();
    this.uploadActive = false;
    await this.closeQueue.catch((): void => {
      return undefined;
    });
    await this.outbox?.clear();
  }

  private ephemeralIdentity(nowUnixMs: number): ReplaySessionIdentity {
    return {
      sessionId: generateReplayId(),
      tabId: generateReplayId(),
      visitorId: generateReplayId(),
      sessionStartUnixMs: nowUnixMs,
      chunkIndex: 0,
    };
  }

  private rotationReason(nowUnixMs: number): SessionRotationReason | null {
    if (!this.identity) {
      return null;
    }
    /*
     * A session that ended while paused for idle stays ended whatever the
     * clock says, and its successor - begun by the next input - rotates
     * under the reason it ended for.
     */
    if (this.idlePause !== null && this.idlePause.sealedReason !== null) {
      return this.idlePause.sealedReason;
    }
    if (
      nowUnixMs - this.identity.sessionStartUnixMs >=
      SESSION_REPLAY_MAX_SESSION_MS
    ) {
      return "duration";
    }
    if (
      nowUnixMs - this.sessionLastActivityUnixMs >=
      SESSION_REPLAY_IDLE_ROLLOVER_MS
    ) {
      return "idle";
    }
    return null;
  }

  private runExternalActivity(nowUnixMs: number, action: () => void): void {
    if (this.pendingIdentityOperations > 0) {
      const identityBarrier: Promise<void> = this.identityQueue;
      const lifecycleEpoch: number = this.lifecycleCancellationEpoch;
      const identityEpoch: number = this.identityCancellationEpoch;
      const wasRunning: boolean = this.running;
      void identityBarrier.then((): void => {
        if (
          lifecycleEpoch !== this.lifecycleCancellationEpoch ||
          identityEpoch !== this.identityCancellationEpoch
        ) {
          return;
        }
        if (
          (this.running && this.acceptingEvents) ||
          (!wasRunning && this.diagnosticsStatus === "idle")
        ) {
          action();
        }
      });
      return;
    }
    if (!this.running) {
      action();
      return;
    }

    const shouldDefer: boolean =
      this.rotatingSession || this.rotationReason(nowUnixMs) !== null;
    if (!shouldDefer) {
      action();
      return;
    }

    const generation: number = this.lifecycleGeneration;
    void this.maybeRotateSession(nowUnixMs).then((): void => {
      if (this.running && this.isCurrentGeneration(generation)) {
        action();
      }
    });
  }

  private async maybeRotateSession(nowUnixMs: number): Promise<void> {
    if (this.rotationPromise) {
      await this.rotationPromise;
      return;
    }
    if (
      !this.running ||
      this.rotatingSession ||
      !this.identity ||
      !this.config ||
      !this.sessionStore ||
      !this.options
    ) {
      return;
    }

    const reason: SessionRotationReason | null = this.rotationReason(nowUnixMs);
    if (!reason) {
      return;
    }

    this.rotatingSession = true;
    const operation: Promise<void> = this.performSessionRotation(
      nowUnixMs,
      reason,
    );
    this.rotationPromise = operation;
    try {
      await operation;
    } finally {
      if (this.rotationPromise === operation) {
        this.rotationPromise = null;
      }
      this.rotatingSession = false;
    }
  }

  private async performSessionRotation(
    nowUnixMs: number,
    reason: SessionRotationReason,
  ): Promise<void> {
    const pause: IdlePause | null = this.idlePause;
    /*
     * Nobody is using the app: the session ends where its footage ended
     * and the next one waits for the person to come back - rather than a
     * session of nobody that would pause straight away, run out and roll
     * over again for every half hour the phone sits there.
     */
    if (pause !== null && this.idleResumeBacklog === null) {
      await this.sealIdlePausedSession(reason);
      return;
    }
    if (pause === null) {
      this.appendCustom(
        SESSION_ROTATED_CUSTOM_EVENT_TAG,
        { reason },
        undefined,
        true,
      );
    } else if (pause.sealedReason === null && this.isPauseInStream(pause)) {
      /*
       * The person came back after the paused session ran out. Its final
       * chunk is dated at the pause, where its footage ended: dated now,
       * the session would run on over the whole stretch nobody recorded.
       * A session sealed while paused already sent its final chunk.
       */
      this.appendMarker(
        SESSION_ROTATED_CUSTOM_EVENT_TAG,
        { reason },
        pause.pausedAtUnixMs,
      );
    }
    await this.closeCurrent(true);
    await this.closeQueue;
    if (!this.running) {
      return;
    }
    if (this.uploadActive) {
      await this.transport?.drain();
    } else {
      this.rollingBuffer.clear();
    }
    if (!this.running) {
      return;
    }

    await this.completeSessionIdentityRotation(nowUnixMs, reason);
  }

  private async completeSessionIdentityRotation(
    nowUnixMs: number,
    reason: SessionRotationReason,
  ): Promise<void> {
    if (!this.sessionStore || !this.config || !this.options) {
      return;
    }
    this.identity = this.identityPersisted
      ? await this.sessionStore!.rotate(nowUnixMs)
      : this.ephemeralIdentity(nowUnixMs);
    /*
     * An idle pause belongs to the session that just ended. Cleared before
     * the new id is announced, which a session sealed while paused had
     * withheld (getSessionId).
     */
    const wasIdlePaused: boolean = this.idlePause !== null;
    const endedWhilePaused: boolean =
      this.idlePause !== null && this.idlePause.sealedReason !== null;
    const heldSinceInput: Array<HeldReplayEvent> | null =
      this.idleResumeBacklog;
    this.idlePause = null;
    this.idleResumeBacklog = null;
    this.notifySessionChange();
    this.sampled = this.identityPersisted
      ? deterministicSample(
          this.identity.sessionId,
          this.config.samplePercentage,
        )
      : false;
    this.triggered = this.config.isTargeted;
    this.triggerReason = this.config.isTargeted
      ? SessionReplayTriggerReason.Manual
      : SessionReplayTriggerReason.Sampled;
    this.uploadActive =
      this.consentState() !== "Unknown" &&
      (this.sampled || this.config.isTargeted);
    this.serializer.reset();
    this.chunkBuffer.clear();
    this.rollingBuffer.clear();
    this.forceFullSnapshot = true;
    this.lastFullSnapshotAtUnixMs = 0;
    this.sessionLastActivityUnixMs = nowUnixMs;
    this.metaDirty = true;
    this.entryUrl = toAppUrl(this.options.mobileAppIdentifier, this.route);
    this.diagnostic("session-rotated", { reason });

    /*
     * What the person did after coming back opens the next session, as
     * events after a rotation always have - unless this rotation is itself
     * an identity change, which nothing recorded before it may cross. A
     * session an earlier identity change sealed while paused was come back
     * to under the new identity, so what was held since belongs to it.
     */
    if (
      heldSinceInput !== null &&
      (reason !== "identity" || endedWhilePaused)
    ) {
      this.releaseHeldEvents(heldSinceInput);
    }

    if (
      this.config.captureTrigger === SessionReplayCaptureTrigger.Always &&
      this.identityPersisted &&
      !this.sampled &&
      !this.config.isTargeted
    ) {
      this.disable("not-sampled");
      this.haltCapture();
      return;
    }

    /*
     * The pause had stopped the sampler. The new session captures on its
     * own snapshot - and, if nobody is there (a rotation nobody's input
     * caused, such as the chunk cap reached by the pause's own chunk),
     * pauses again on its own.
     */
    if (wasIdlePaused && this.running && this.foreground) {
      this.startTimers();
    }
  }

  private disable(code: string, details?: Record<string, unknown>): void {
    this.diagnosticsStatus = "disabled";
    this.diagnostic(code, details);
  }

  private diagnostic(code: string, details?: Record<string, unknown>): void {
    const event: MobileReplayDiagnosticEvent = {
      code,
      atUnixMs: this.now(),
    };
    if (details) {
      event.details = details;
    }
    this.diagnosticsEvents.push(event);
    if (this.diagnosticsEvents.length > MAX_DIAGNOSTIC_EVENTS) {
      this.diagnosticsEvents.shift();
    }
    if (this.options?.debug) {
      // eslint-disable-next-line no-console
      console.info(`[OneUptime Replay] ${code}`, details ?? {});
    }
  }
}

export { deterministicSample };
