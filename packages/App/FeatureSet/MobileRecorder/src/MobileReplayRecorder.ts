import { AppState } from "react-native";
import ReplayChunkBuffer, {
  BufferedReplaySegment,
  RollingReplayBuffer,
} from "./ChunkBuffer";
import {
  CUSTOM_EVENT_TAG,
  ERROR_CUSTOM_EVENT_TAG,
  IDENTIFY_CUSTOM_EVENT_TAG,
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MOBILE_CAPTURE_INTERVAL_MS,
  MOBILE_RECORDER_KIND,
  RECORDER_VERSION,
  ROUTE_CUSTOM_EVENT_TAG,
  SESSION_REPLAY_CHECKOUT_INTERVAL_MS,
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_IDLE_ROLLOVER_MS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
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

export type MobileReplayStatus =
  | "idle"
  | "starting"
  | "recording"
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

export interface MobileReplayRecorderDependencies {
  storage?: ReplayStorage;
  nativeViewTree?: NativeViewTreeAdapter;
  appState?: ReplayAppState;
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

  public constructor(dependencies: MobileReplayRecorderDependencies = {}) {
    this.storage = dependencies.storage ?? defaultReplayStorage;
    this.nativeViewTree =
      dependencies.nativeViewTree ?? defaultNativeViewTreeAdapter;
    this.appState =
      dependencies.appState ?? (AppState as unknown as ReplayAppState);
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

    this.appendCustom(
      VISIBILITY_CUSTOM_EVENT_TAG,
      { state: "stopped" },
      undefined,
      true,
    );
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
    if (this.running && !this.acceptingEvents) {
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
    await this.maybeRotateSession(this.now());
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
    const generation: number = this.lifecycleGeneration;
    const operation: Promise<void> = this.touchQueue.then(
      async (): Promise<void> => {
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
    return {
      status: this.diagnosticsStatus,
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
    return this.running && this.identityPersisted
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

  private async captureTick(force: boolean = false): Promise<void> {
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
      }
      if (this.chunkBuffer.shouldFlush()) {
        await this.closeCurrent(false);
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

    this.sessionLastActivityUnixMs = Math.max(
      this.sessionLastActivityUnixMs,
      event.timestamp,
    );

    const appendOptions: NonNullable<
      Parameters<ReplayChunkBuffer["append"]>[1]
    > = {};
    if (this.options) {
      appendOptions.route = toAppUrl(
        this.options.mobileAppIdentifier,
        this.route,
      );
    }
    if (signal) {
      appendOptions.signal = signal;
    }
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
          "oneuptime.session-rotated",
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
      this.appendCustom(VISIBILITY_CUSTOM_EVENT_TAG, { state: "hidden" });
      await this.closeCurrent(false);
      if (this.uploadActive) {
        await this.transport?.drain();
      }
      return;
    }

    if (isActive && !this.foreground) {
      this.foreground = true;
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
      this.appendCustom(VISIBILITY_CUSTOM_EVENT_TAG, { state: "visible" });
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
      if (this.acceptingEvents) {
        void this.closeCurrent(false);
      }
    }, SESSION_REPLAY_FLUSH_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
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
    this.appendCustom("oneuptime.session-rotated", { reason }, undefined, true);
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

    if (
      this.config.captureTrigger === SessionReplayCaptureTrigger.Always &&
      this.identityPersisted &&
      !this.sampled &&
      !this.config.isTargeted
    ) {
      this.disable("not-sampled");
      this.haltCapture();
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
