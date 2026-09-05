import { record } from "rrweb";
import {
  SESSION_REPLAY_CHECKOUT_INTERVAL_MS,
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES,
  SESSION_REPLAY_MAX_CAPTURE_REASON_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_EVENTS_PER_CHUNK,
  SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH,
  SESSION_REPLAY_MAX_CUSTOM_EVENT_PROPERTY_KEYS,
  SESSION_REPLAY_MAX_TAG_KEYS,
  SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_KEYS,
  SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayChunkMeta,
  SessionReplayConfigResponse,
  SessionReplayConsentState,
  SessionReplayDirective,
  SessionReplayFidelityNotice,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import {
  SessionReplayClickPayload,
  SessionReplayCustomDroppedPayload,
  SessionReplayCustomEventTag,
  SessionReplayCustomPayload,
  SessionReplayIdentifyPayload,
  SessionReplaySessionRotatedPayload,
  SessionReplayTagsPayload,
  SessionReplayVisibilityPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import CommonMasking from "Common/Utils/Rum/Masking";
import {
  SessionRotationDecision,
  SessionRotationReason,
} from "Common/Utils/Rum/SessionIdentity";
import {
  SessionReplayStringMapLimits,
  mergeSessionReplayStringMaps,
  sanitizeSessionReplayStringMap,
} from "Common/Utils/Rum/SessionReplayStringMap";
import SessionSampling from "Common/Utils/Rum/SessionSampling";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import Chunker, { PendingChunk, utf8ByteLength } from "./Chunker";
import ClickRecorder from "./ClickRecorder";
import Config, {
  RECORDER_VERSION,
  RRWEB_VERSION,
  RecorderInitOptions,
  getChunkUrl,
  getRecorderCapabilities,
} from "./Config";
import Consent from "./Consent";
import ConsoleRecorder, { RecordedConsoleEntry } from "./ConsoleRecorder";
import { debugLog, debugWarn } from "./Debug";
import { EarlyErrorRecord } from "./EarlyErrors";
import ErrorRecorder, {
  CompiledIgnorePatterns,
  RecordedError,
} from "./ErrorRecorder";
import { ExtendedReplayConfig, readExtendedConfig } from "./ExtendedConfig";
import FrustrationDetector, { FrustrationSignal } from "./FrustrationDetector";
import Masking, { MaskInputOptionsShape } from "./Masking";
import NetworkRecorder, { RecordedRequest } from "./NetworkRecorder";
import PerformanceRecorder, { PerformanceIssue } from "./PerformanceRecorder";
import RollingBuffer, { BufferedEvent } from "./RollingBuffer";
import RouteRecorder, { RecordedRoute } from "./RouteRecorder";
import SessionId, { SessionIdentityState } from "./SessionId";
import Transport, { TerminalChunk } from "./Transport";

/*
 * The recorder: everything above is wired together here.
 *
 * Two design rules run through this file and explain most of its shape.
 *
 * 1. NEITHER "unload" NOR "beforeunload" IS EVER REGISTERED. Both disqualify
 *    the customer's page from the back/forward cache, which would mean a RUM
 *    vendor measurably degrading its own customer's Core Web Vitals in order
 *    to collect data about them. Terminal flushes hang off visibilitychange
 *    and pagehide instead, branching on event.persisted. There is a
 *    source-level test asserting the two strings never appear.
 *
 * 2. The recorder always RECORDS into a bounded ring buffer, and separately
 *    decides whether it may UPLOAD. Consent, sampling and the trigger all
 *    gate upload only, so the seconds leading up to an error survive a
 *    cookie banner without anything leaving the device.
 */

/* rrweb EventType values referenced here. */
const EVENT_TYPE_DOM_CONTENT_LOADED: number = 0;
const EVENT_TYPE_LOAD: number = 1;
const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_INCREMENTAL: number = 3;
const EVENT_TYPE_META: number = 4;

/* rrweb IncrementalSource values referenced here. */
const SOURCE_MUTATION: number = 0;
const SOURCE_INPUT: number = 5;

export const BFCACHE_CUSTOM_EVENT_TAG: string =
  SessionReplayCustomEventTag.BfcacheRestore;

/*
 * Emitted as the first thing in a rolled-over session, carrying the id it
 * replaced and why.
 *
 * SessionId.resolveSession has always computed previousSessionId and
 * rotationReason, but the chunk envelope has no field for either, so the one
 * diagnostic they exist for - telling "the user went to lunch" from "the
 * recorder lost its state" across two adjacent sessions - was unreachable
 * server-side. A custom rrweb event puts it in the payload, which needs no
 * wire-version bump; the envelope fields remain the better home once Common's
 * shared type can be changed.
 */
export const SESSION_ROTATED_CUSTOM_EVENT_TAG: string =
  SessionReplayCustomEventTag.SessionRotated;

/*
 * Another tab rotated the shared session and this tab adopted its id. Not a
 * member of SessionRotationReason (that enum describes why a NEW id was
 * minted); reported through the same custom event so the two sessions can
 * still be lined up server-side.
 */
export const SESSION_ADOPTED_ROTATION_REASON: string = "adopted";

/*
 * Disclosed once rrweb's own error handler has fired this many times. One
 * error is a hiccup the fresh checkout below papers over; several mean the
 * mutation observer or the serializer is failing on this page and the
 * replay will freeze or skip, which the viewer must be told rather than
 * shown a recording that claims full fidelity.
 */
export const RECORDER_ERROR_NOTICE: string = "recorder-error";
const RRWEB_ERROR_NOTICE_THRESHOLD: number = 3;

/*
 * After an rrweb error the node ids may no longer describe the DOM, so a
 * fresh checkout is taken - but at most this often, because a page that
 * throws on every mutation would otherwise snapshot on every mutation.
 */
const RRWEB_ERROR_CHECKOUT_INTERVAL_MS: number = 60 * 1000;

/*
 * Custom events raised before rrweb has taken its first snapshot are held
 * here and replayed right after it. rrweb refuses addCustomEvent until
 * init() has run, and on a page still parsing that is deferred to the load
 * event - which is exactly when a startup crash, the first route and the
 * first requests happen. Bounded so a page that never finishes loading
 * cannot grow it without limit.
 */
const MAX_PENDING_CUSTOM_EVENTS: number = 200;

/*
 * What a keepalive request may carry for the PAYLOAD. The browser caps a
 * keepalive body at 64 KB; the transport enforces 56 KB on the whole frame,
 * and the envelope line is under 8 KB by the server's own rule, so a payload
 * cut at this size always fits one frame. Also the open-chunk size past
 * which a HIDDEN tab flushes early through the ordinary path, so that by the
 * time pagehide arrives there is rarely more than this left to send.
 */
const KEEPALIVE_PAYLOAD_BUDGET_BYTES: number =
  SESSION_REPLAY_KEEPALIVE_MAX_BYTES - 8 * 1024;

/*
 * What the envelope JSON may weigh.
 *
 * The ingest parser refuses a frame whose envelope JSON exceeds 8 KB before
 * it parses anything (SessionReplayEnvelopeParser.MAX_ENVELOPE_JSON_BYTES),
 * and the refusal costs the WHOLE frame: chunk 0 - the one carrying the
 * opening snapshot, the meta and the capabilities - answers 400, the
 * transport counts it as a per-chunk refusal, and the session has no header
 * row at all. The documented maxima can reach it on their own: 20 tags at
 * 32+128 plus 20 traits at 40+200 is 9.5 KB of meta before a single trace id.
 *
 * 7 KB rather than 8: the transport rewrites payloadEncoding, payloadBytes
 * and flushFailures on the way out, so what is measured here is not
 * byte-identical to what is posted. Anything over sheds optional fields
 * rather than losing the frame (fitEnvelope).
 */
const MAX_ENVELOPE_JSON_BYTES: number = 7 * 1024;

const TRAIT_LIMITS: SessionReplayStringMapLimits = {
  maxKeys: SESSION_REPLAY_MAX_TRAIT_KEYS,
  maxKeyLength: SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  maxValueLength: SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
};

const TAG_LIMITS: SessionReplayStringMapLimits = {
  maxKeys: SESSION_REPLAY_MAX_TAG_KEYS,
  maxKeyLength: SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  maxValueLength: SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
};

/* track() properties share the trait caps for key and value length. */
const CUSTOM_EVENT_PROPERTY_LIMITS: SessionReplayStringMapLimits = {
  maxKeys: SESSION_REPLAY_MAX_CUSTOM_EVENT_PROPERTY_KEYS,
  maxKeyLength: SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  maxValueLength: SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
};

/*
 * Where the recorder is in its life. "not-sampled" is a terminal state of
 * its own because it is the one the most support tickets are about: the
 * recorder loaded, decided not to record, and will decide the same on every
 * reload of the same session.
 */
export type RecorderState =
  | "not-started"
  | "recording"
  | "uploading"
  | "not-sampled"
  | "stopped";

/* Why a recorder stopped. Stable strings: getDiagnostics() reports them. */
export type RecorderStopReason =
  | "api"
  | "server-directive"
  | "transport-failure"
  | "chunk-cap";

/*
 * What start() decided, as a stable word. Distinct from RecorderState in
 * that it never changes afterwards: it is the answer to "what happened when
 * the page loaded", which a support ticket needs long after the state moved
 * on.
 */
export type RecorderStartDecision =
  | "not-started"
  | "not-sampled"
  | "recording-and-uploading"
  | "recording-into-memory";

/*
 * Every gate between "recording" and "uploading", answered so that a
 * customer reading getDiagnostics() sees WHY nothing is being sent rather
 * than only that nothing is.
 */
export interface RecorderDecisions {
  isSampled: boolean;
  captureTrigger: string;
  consentMode: string;
  consentState: SessionReplayConsentState;
  uploadsAllowed: boolean;
  uploadBlockedBy: "consent" | "transport" | null;
  lastDirective: SessionReplayDirective | null;
  lastDirectiveReason: string | null;
  startDecision: RecorderStartDecision;
}

export type SessionChangeListener = (sessionId: string, tabId: string) => void;

/*
 * Re-scanning the document for sensitive fields is a full querySelectorAll,
 * so it is rate limited. 1s is short enough that a dynamically inserted
 * password field is marked long before a user can type into it, and long
 * enough that a page mutating continuously does not pay for a scan per batch.
 */
const SENSITIVE_RESCAN_INTERVAL_MS: number = 1000;

/*
 * User-agent patterns, hoisted to module scope. Named constants rather than
 * inline literals so the matching order is readable in one place, and so the
 * regexes are compiled once instead of on every chunk-0 envelope.
 */
const BROWSER_NAME_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Edge", pattern: /Edg\// },
  { name: "Opera", pattern: /OPR\/|Opera/ },
  { name: "Firefox", pattern: /Firefox\// },
  { name: "Chrome", pattern: /Chrome\// },
  { name: "Safari", pattern: /Safari\// },
];

const BROWSER_VERSION_PATTERNS: Array<RegExp> = [
  /Edg\/([0-9.]+)/,
  /OPR\/([0-9.]+)/,
  /Firefox\/([0-9.]+)/,
  /Chrome\/([0-9.]+)/,
  /Version\/([0-9.]+).*Safari/,
];

const OS_NAME_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Windows", pattern: /Windows/ },
  { name: "Android", pattern: /Android/ },
  { name: "iOS", pattern: /iPhone|iPad|iPod/ },
  { name: "macOS", pattern: /Mac OS X/ },
  { name: "Linux", pattern: /Linux/ },
];

const TABLET_PATTERN: RegExp = /iPad|Tablet/;
const MOBILE_PATTERN: RegExp = /Mobi|Android|iPhone/;

interface RrwebEvent {
  type: number;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface RecorderRuntimeOptions {
  initOptions: RecorderInitOptions;
  config: SessionReplayConfigResponse;

  /*
   * Errors the loader stub's pre-load buffer caught before this module
   * existed. Replayed through the ErrorRecorder's masking path at start,
   * so a startup crash still triggers capture.
   */
  earlyErrors?: Array<EarlyErrorRecord>;

  /*
   * Told whenever this recorder starts on a session id other than the one
   * it had: rotation, adoption of another tab's session, a re-grant after
   * revoke. The public onSessionChange() is built on it.
   */
  onSessionChange?: SessionChangeListener;

  /* Overridable for tests; production always uses the real globals. */
  windowRef?: Window;
  documentRef?: Document;
}

interface PendingCustomEvent {
  tag: string;
  payload: unknown;
}

export default class Recorder {
  private readonly initOptions: RecorderInitOptions;
  private readonly config: SessionReplayConfigResponse;
  private readonly windowRef: Window;
  private readonly documentRef: Document;

  private readonly masking: Masking;
  private readonly consent: Consent;
  private readonly buffer: RollingBuffer;
  private readonly transport: Transport;

  /*
   * Mutable: both are replaced wholesale when the session rolls over. A
   * rotated session is a different recording with its own start time and its
   * own chunk sequence, so it needs a fresh Chunker rather than a reset one.
   */
  private identity: SessionIdentityState;
  private chunker: Chunker;

  private readonly errorRecorder: ErrorRecorder;
  private readonly networkRecorder: NetworkRecorder;
  private readonly performanceRecorder: PerformanceRecorder;

  /*
   * The artifact-normalised view of the config fields the loader passes
   * through unvalidated. Resolved once; see ExtendedConfig.ts.
   */
  private readonly extendedConfig: ExtendedReplayConfig;
  private readonly consoleRecorder: ConsoleRecorder;
  private readonly routeRecorder: RouteRecorder;
  private readonly frustrationDetector: FrustrationDetector;
  private readonly clickRecorder: ClickRecorder;

  private stopRrweb: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeSessionChanges: (() => void) | null = null;

  private started: boolean = false;
  private stopped: boolean = false;
  private stopReason: RecorderStopReason | null = null;
  private startDecision: RecorderStartDecision = "not-started";
  private isSampled: boolean = false;

  /* Upload has begun. Set by the first trigger that survives every gate. */
  private uploading: boolean = false;
  private triggerReason: SessionReplayTriggerReason | null = null;

  /*
   * Set for the duration of a terminal close() so the chunk sink knows to use
   * the synchronous keepalive path. A flag rather than a parameter because
   * the sink is called from deep inside the chunker.
   */
  private isTerminalFlush: boolean = false;

  /*
   * The pieces a terminal flush produced, collected while isTerminalFlush is
   * set and posted as ONE keepalive request. Posting each piece as it closed
   * issued one keepalive fetch per piece against a quota the browser counts
   * per ORIGIN (64 KB combined), so the later requests - which is where the
   * sealing piece is - were the ones the browser rejected.
   */
  private terminalChunks: Array<TerminalChunk> = [];

  private hasSentFinalChunk: boolean = false;
  private lastSensitiveScanAtMs: number = 0;
  private droppedEvents: number = 0;
  private userRef: string | null = null;

  /*
   * identify() traits and setTags() tags, already sanitised and masked.
   * Both ride the chunk meta; metaDirty asks the next flushed chunk to
   * carry meta even though it is neither chunk 0 nor final, which is how an
   * identify() after login reaches the header at all.
   */
  private traits: Record<string, string> | null = null;
  private tags: Record<string, string> = {};
  private metaDirty: boolean = false;

  /* Per-chunk window for track() events, mirroring ClickRecorder's. */
  private customEventsInChunk: number = 0;
  private customEventsDroppedInChunk: number = 0;

  /*
   * rrweb's first FullSnapshot has been seen on this page. Until then
   * addCustomEvent throws, so custom events wait in pendingCustomEvents.
   */
  private hasSeenFullSnapshot: boolean = false;
  private pendingCustomEvents: Array<PendingCustomEvent> = [];

  private rrwebErrorCount: number = 0;
  private lastRrwebErrorCheckoutAtMs: number = 0;

  /* document.visibilityState === "hidden", tracked for the early flush. */
  private isHidden: boolean = false;

  private lastDirective: SessionReplayDirective | null = null;
  private lastDirectiveReason: string | null = null;

  private readonly sessionChangeListener: SessionChangeListener | null;

  /*
   * Last time the END USER did something, and the last value written through
   * to storage.
   *
   * The flush timer used to call SessionId.touch(Date.now()) every 15 s
   * unconditionally, which bumped lastActivityUnixMs even for a completely
   * idle tab - so the idle rollover could never fire while the recorder was
   * alive. Activity is now sourced from rrweb's own interaction events and
   * only written through when it actually advanced.
   */
  private lastUserActivityUnixMs: number = 0;
  private lastTouchedUnixMs: number = 0;

  /*
   * Scrubbed URL this recorder started on. Set once in start() so the
   * envelope's meta.entryUrl stays the ENTRY url even on the final chunk,
   * which is also built from meta.
   */
  private entryUrl: string = "";

  /* Drained into the ErrorRecorder once, at the end of start(). */
  private earlyErrors: Array<EarlyErrorRecord>;

  public constructor(options: RecorderRuntimeOptions) {
    this.earlyErrors = options.earlyErrors || [];
    this.initOptions = options.initOptions;
    this.config = options.config;
    this.windowRef = options.windowRef || window;
    this.documentRef = options.documentRef || document;
    this.sessionChangeListener = options.onSessionChange || null;

    if (this.initOptions.userRef !== undefined) {
      this.userRef = this.initOptions.userRef;
    }

    this.extendedConfig = readExtendedConfig(this.config);

    this.masking = new Masking(
      this.config.maskingMode,
      this.config.maskSelectors,
    );

    this.consent = new Consent(this.config.consentMode);

    this.buffer = new RollingBuffer();

    /*
     * The tab id is minted fresh on every init BEFORE the session is
     * resolved, because a duplicated tab must not inherit the copied
     * sessionStorage value and the chunk counter is scoped to it.
     */
    const tabId: string = SessionId.rotateTabId();

    this.identity = SessionId.resolveSession(Date.now(), tabId);

    this.chunker = this.createChunker();

    this.transport = new Transport({
      url: getChunkUrl(this.initOptions),
      headers: Config.getIngestHeaders(this.initOptions),
      onDirective: (
        directive: SessionReplayDirective,
        reason: string | null,
      ): void => {
        this.onDirective(directive, reason);
      },
      onPermanentFailure: (reason: string): void => {
        this.onPermanentFailure(reason);
      },
      onChunkTooLarge: (): void => {
        /*
         * The chunk could not be posted at all, so the viewer is told on the
         * next one: a snapshot the player is warned about is strictly better
         * than a hole nothing reports.
         */
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.SnapshotTooLarge,
        );
      },
    });

    const compiledIgnorePatterns: CompiledIgnorePatterns =
      ErrorRecorder.compileIgnorePatterns(
        this.config.ignoreErrorPatterns || [],
      );

    if (compiledIgnorePatterns.discardedCount > 0) {
      this.chunker.addFidelityNotice(
        SessionReplayFidelityNotice.IgnorePatternsDiscarded,
      );
    }

    this.errorRecorder = new ErrorRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      maskMessage: (message: string): string => {
        return this.masking.maskConsoleArgument(message);
      },
      scrubUrl: (url: string): string => {
        return this.scrubUrl(url);
      },
      ignorePatterns: compiledIgnorePatterns.patterns,
      onCapReached: (): void => {
        this.onSignalCapReached();
      },
      onError: (
        atUnixMs: number,
        _error: RecordedError,
        isTriggerWorthy: boolean,
      ): void => {
        this.chunker.countSignal("errorCount");

        /*
         * Recorded but not necessarily uploaded-over: stackless
         * cross-origin "Script error." noise and pattern-ignored errors
         * must not convert error-triggered capture into always-on upload.
         * That includes the FRUSTRATION door — notifyError feeds the
         * error-click detector, whose signal triggers an upload too, so an
         * ignored error thrown from a third-party tag's click handler
         * would otherwise re-open the exact hole the suppression closes.
         */
        if (isTriggerWorthy) {
          this.frustrationDetector.notifyError(atUnixMs);
          this.trigger(SessionReplayTriggerReason.Error);
        }
      },
    });

    this.networkRecorder = new NetworkRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      scrubUrl: (url: string): string => {
        return this.scrubUrl(url);
      },
      isSelfRequest: (url: string): boolean => {
        return url.indexOf(this.initOptions.host) === 0;
      },
      onActivity: (atUnixMs: number): void => {
        this.frustrationDetector.notifyActivity(atUnixMs);
      },
      onCapReached: (): void => {
        this.onSignalCapReached();
      },
      onRequestComplete: (
        atUnixMs: number,
        request: RecordedRequest,
        traceId: string | null,
      ): void => {
        if (traceId) {
          this.chunker.addTraceId(traceId);
        }

        /*
         * A 5xx is a server-side failure the user experienced, which is
         * exactly the class of session worth having a recording of - even
         * though no JavaScript error was thrown.
         */
        if (request.status >= 500) {
          this.trigger(SessionReplayTriggerReason.Error);
          return;
        }

        /*
         * The request that SUCCEEDED slowly is the performance trigger's
         * half; url is already scrubbed by the NetworkRecorder. Failed
         * requests stay the error path's business (above), a request the
         * page itself cancelled was never slow in any sense the user felt,
         * and a 4xx is the page's own mistake rather than a slow success -
         * so none of them count, and one request never counts as two kinds
         * of bad.
         */
        if (!request.isError && !request.aborted && request.status < 400) {
          this.performanceRecorder.noteRequest(
            atUnixMs,
            request.durationMs,
            request.url,
          );
        }
      },
      tracePropagationOrigins: this.extendedConfig.tracePropagationOrigins,
    });

    this.performanceRecorder = new PerformanceRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      onIssue: (_atUnixMs: number, _issue: PerformanceIssue): void => {
        this.trigger(SessionReplayTriggerReason.Performance);
      },
      lcpBudgetMs: this.extendedConfig.lcpBudgetMs,
      longTaskBudgetMs: this.extendedConfig.longTaskBudgetMs,
      slowRequestBudgetMs: this.extendedConfig.slowRequestBudgetMs,
      captureWebVitals: this.extendedConfig.captureWebVitals,
    });

    this.consoleRecorder = new ConsoleRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      maskArgument: (value: string): string => {
        return this.masking.maskConsoleArgument(value);
      },
      onCapReached: (): void => {
        this.onSignalCapReached();
      },
      onConsole: (_atUnixMs: number, _entry: RecordedConsoleEntry): void => {
        /*
         * Deliberately not a trigger. console.error is used for expected,
         * handled conditions on a great many sites; treating it as a failure
         * would upload most sessions and quietly undo the central bet.
         */
      },
    });

    this.routeRecorder = new RouteRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      scrubUrl: (url: string): string => {
        return this.scrubUrl(url);
      },
      onCapReached: (): void => {
        this.onSignalCapReached();
      },
      onRouteChange: (atUnixMs: number, route: RecordedRoute): void => {
        this.chunker.countSignal("routeCount");
        /*
         * The destination, already scrubbed by RouteRecorder. This is what
         * turns the session header's routes[] column from "the URL of
         * whichever chunk happened to be first" into the list of pages the
         * user actually visited.
         */
        this.chunker.addRoute(route.to);
        this.frustrationDetector.notifyActivity(atUnixMs);
      },
      requestFullSnapshot: (): void => {
        this.takeFullSnapshot();
      },
    });

    this.frustrationDetector = new FrustrationDetector({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      onSignal: (signal: FrustrationSignal): void => {
        this.onFrustrationSignal(signal);
      },
    });

    this.clickRecorder = new ClickRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      masking: this.masking,

      /*
       * The same list rrweb gets as blockSelector. Without it the click
       * label was the one thing that could carry text out of a region the
       * customer excluded from recording entirely.
       */
      blockSelectors: this.config.blockSelectors,
      onClick: (atUnixMs: number, _click: SessionReplayClickPayload): void => {
        this.chunker.countSignal("clickCount");
        this.lastUserActivityUnixMs = atUnixMs;
      },
    });

    this.visibilityListener = (): void => {
      const hidden: boolean = this.documentRef.visibilityState === "hidden";

      this.isHidden = hidden;

      /*
       * Disclosed in-band so the player can draw "tab in background" bands
       * and the inactivity map can tell a user who left from a page that
       * stalled.
       */
      const visibility: SessionReplayVisibilityPayload = {
        state: hidden ? "hidden" : "visible",
        atUnixMs: Date.now(),
      };

      this.emitCustomEvent(SessionReplayCustomEventTag.Visibility, visibility);

      if (hidden) {
        this.onHidden();
      }
    };

    this.pageHideListener = (event: PageTransitionEvent): void => {
      /*
       * persisted === true means the page is going into the back/forward
       * cache and may come back with its JavaScript state intact. Flushing
       * WITHOUT isFinal keeps the session open, so returning to it continues
       * the same recording instead of orphaning it as truncated.
       */
      this.flushTerminal(event.persisted !== true);
    };

    this.pageShowListener = (event: PageTransitionEvent): void => {
      if (event.persisted !== true) {
        return;
      }

      this.onBfcacheRestore();
    };

    this.focusInListener = (event: Event): void => {
      const target: EventTarget | null = event.target;

      if (target && target instanceof Element) {
        this.masking.markIfSensitive(target);
      }
    };
  }

  /*
   * A Chunker is bound to one session's start time, so rotation builds a new
   * one rather than resetting the old one. The sink and the truncation
   * callback are re-created with it; both only ever touch `this`, so they
   * stay correct across rotations.
   */
  private createChunker(): Chunker {
    return new Chunker({
      sessionStartUnixMs: this.identity.sessionStartUnixMs,
      sink: (chunk: PendingChunk): void => {
        this.onChunkClosed(chunk);
      },
      onTruncated: (): void => {
        /*
         * The session hit the per-session chunk cap and has just sent its
         * disclosure chunk. Keeping rrweb running past this point costs the
         * customer's page CPU and memory to produce events that will never be
         * uploaded and nobody will ever watch. The disclosure chunk WAS the
         * final chunk, so there is nothing left to seal.
         */
        this.shutdown("chunk-cap", false);
      },
    });
  }

  /*
   * A per-session cap on console lines, errors, requests or routes was hit.
   * The module already put an in-band marker in the stream; the notice on
   * the envelope is what tells the viewer, before decoding anything, that
   * the rail is incomplete from here on.
   */
  private onSignalCapReached(): void {
    this.chunker.addFidelityNotice(
      SessionReplayFidelityNotice.SignalCapReached,
    );
  }

  private readonly visibilityListener: () => void;
  private readonly pageHideListener: (event: PageTransitionEvent) => void;
  private readonly pageShowListener: (event: PageTransitionEvent) => void;
  private readonly focusInListener: (event: Event) => void;

  public start(): void {
    if (this.started || this.stopped) {
      return;
    }

    const isSampled: boolean = SessionSampling.isSampled(
      this.identity.sessionId,
      this.config.samplePercentage,
    );

    this.isSampled = isSampled;

    /*
     * In Always mode the sample percentage is the ONLY thing that decides
     * whether a session is uploaded, so an unsampled session has no reachable
     * trigger. Not starting rrweb at all is both cheaper for the customer's
     * page and strictly better for their end user: nothing is recorded, so
     * there is no buffer of page content to leak.
     */
    if (
      this.config.captureTrigger === SessionReplayCaptureTrigger.Always &&
      !isSampled
    ) {
      /*
       * The hardest no-op in the package to diagnose from outside: no
       * listener is installed, no chunk is built, no request is made, and it
       * looks exactly like a broken script tag. Sampling is deterministic in
       * the session id, so this is not bad luck the customer can reload
       * their way out of - the same session will never be sampled.
       */
      debugWarn(
        "not-sampled",
        "Not selected by the sample percentage. Nothing is recorded.",
        {
          samplePercentage: this.config.samplePercentage,
          sessionId: this.identity.sessionId,
        },
      );

      this.startDecision = "not-sampled";
      this.stopped = true;
      return;
    }

    this.started = true;
    this.isHidden = this.documentRef.visibilityState === "hidden";

    /*
     * Captured once, here. Everything downstream that says "where did this
     * recording begin" reads it, and the answer has to KEEP being true after
     * the page navigates - which is why it is not re-read from
     * location.href, and why rotateSession re-captures it for the new
     * session rather than sharing this one.
     */
    this.entryUrl = this.scrubUrl(this.windowRef.location.href);

    /*
     * Seeds routes[] with the landing page. Without it a session that never
     * navigates would report an empty route list while pageCount said 0 -
     * technically consistent, and useless for "which pages did this person
     * see".
     */
    this.chunker.addRoute(this.entryUrl);

    /*
     * A page load is itself activity. Without this seed a tab that loads and
     * is then never touched would be judged idle from epoch 0 and roll over
     * on its very first flush tick.
     */
    this.lastUserActivityUnixMs = Date.now();
    this.lastTouchedUnixMs = this.lastUserActivityUnixMs;

    /*
     * Marked BEFORE rrweb takes its first snapshot: a field must already be
     * in the sticky set when a show-password toggle can fire, not once rrweb
     * happens to call maskInputFn on it.
     */
    this.masking.markSensitiveFieldsIn(this.documentRef);

    this.detectFidelityNotices();

    const refreshRageCount: number = SessionId.recordPageLoad(
      this.windowRef.location.href,
      Date.now(),
    );

    this.errorRecorder.start(this.windowRef);
    this.networkRecorder.start(this.windowRef);
    this.performanceRecorder.start(this.windowRef);
    this.consoleRecorder.start();
    this.routeRecorder.start(this.windowRef);
    this.frustrationDetector.start(this.documentRef);
    this.clickRecorder.start(this.documentRef);

    /*
     * Another tab rotating the shared session is learned about the moment
     * it happens, not on the next 15 s tick: the storage event fires in
     * every OTHER tab when the session key changes, which is exactly the tab
     * that must stop posting under an id its sibling just sealed.
     */
    this.unsubscribeSessionChanges = SessionId.subscribeToSessionChanges(
      (): void => {
        this.maybeRotateSession(Date.now());
      },
      this.windowRef,
    );

    this.documentRef.addEventListener(
      "visibilitychange",
      this.visibilityListener,
    );

    /*
     * pagehide and visibilitychange ONLY. See the class comment: unload and
     * beforeunload would cost the customer their bfcache eligibility.
     */
    this.windowRef.addEventListener(
      "pagehide",
      this.pageHideListener as EventListener,
    );
    this.windowRef.addEventListener(
      "pageshow",
      this.pageShowListener as EventListener,
    );
    this.documentRef.addEventListener("focusin", this.focusInListener, {
      capture: true,
      passive: true,
    });

    this.startRrweb();

    this.flushTimer = setInterval((): void => {
      this.onFlushTimer();
    }, SESSION_REPLAY_FLUSH_INTERVAL_MS);

    /*
     * A deterministically sampled session uploads from its first event, with
     * no failure required. Decided from the session id alone so the ingest
     * gate reaches the same answer.
     */
    if (isSampled) {
      this.trigger(SessionReplayTriggerReason.Sampled);
    }

    if (SessionId.isRefreshRage(refreshRageCount)) {
      this.frustrationDetector.reportRefreshRage(refreshRageCount, Date.now());
    }

    /*
     * The single most useful line in this whole file.
     *
     * Under the default policy - OnErrorOrFrustration with a 0% sample - a
     * perfectly healthy recorder makes exactly ONE request per page load
     * (the config fetch) and never posts a chunk unless something goes
     * wrong. That is the entire design, and from a Network tab it is
     * indistinguishable from an installation that does not work, which is
     * why "I see no data going to OneUptime" is the most common report
     * against a recorder that is behaving perfectly.
     */
    debugLog(
      "recording",
      this.uploading
        ? "Recording and uploading."
        : "Recording into memory. Nothing uploads until a trigger fires - call OneUptimeReplay.captureSession() to force one.",
      {
        sessionId: this.identity.sessionId,
        tabId: this.identity.tabId,
        captureTrigger: this.config.captureTrigger,
        samplePercentage: this.config.samplePercentage,
        isSampled: isSampled,
        consentMode: this.config.consentMode,
        consentState: this.consent.getState(),
        uploading: this.uploading,
        isTargeted: this.extendedConfig.isTargeted,
      },
    );

    /*
     * A dashboard user asked for this end user's next session by name.
     * Same reason as an explicit captureSession() call - a human decided -
     * so it shares the Manual label. It is a TRIGGER, not an override:
     * consent and the transport kill switch still gate the upload.
     */
    if (this.extendedConfig.isTargeted) {
      this.trigger(SessionReplayTriggerReason.Manual);
    }

    this.replayEarlyErrors();

    this.startDecision = this.uploading
      ? "recording-and-uploading"
      : "recording-into-memory";
  }

  /*
   * Replay whatever the loader stub's pre-load buffer caught, through the
   * SAME masking, scrubbing, counting and trigger path a live error takes
   * — which is the entire reason the stub buffers raw records instead of
   * acting on them: the stub has no masking code and must never decide
   * what leaves the page. Runs at the very end of start(), so a trigger
   * fired by a replayed startup crash finds a fully armed recorder with
   * rrweb's first snapshot already in the buffer.
   */
  private replayEarlyErrors(): void {
    const records: Array<EarlyErrorRecord> = this.earlyErrors;
    this.earlyErrors = [];

    for (const record of records) {
      const error: RecordedError = {
        kind: record.kind,
        message: record.message,
        ...(record.source !== undefined ? { source: record.source } : {}),
        ...(record.lineNumber !== undefined
          ? { lineNumber: record.lineNumber }
          : {}),
        ...(record.columnNumber !== undefined
          ? { columnNumber: record.columnNumber }
          : {}),
        ...(record.stack !== undefined ? { stack: record.stack } : {}),
      };

      this.errorRecorder.record(error, record.atUnixMs);
    }
  }

  private startRrweb(): void {
    const maskingOptions: {
      maskAllInputs: boolean;
      maskInputOptions: Readonly<MaskInputOptionsShape>;
      maskTextClass: string;
      maskTextSelector: string;
      ignoreClass: string;
    } = this.masking.getRrwebMaskingOptions();

    const stop: (() => void) | undefined = record<RrwebEvent>({
      emit: (event: RrwebEvent, isCheckout?: boolean): void => {
        this.onRrwebEvent(event, isCheckout === true);
      },

      /*
       * One seek anchor per minute. Independent of the flush interval on
       * purpose - the chunk boundary follows the isCheckout flag rather than
       * a matching timer, which is the only construction that guarantees a
       * chunk opens on a snapshot.
       */
      checkoutEveryNms: SESSION_REPLAY_CHECKOUT_INTERVAL_MS,

      maskAllInputs: maskingOptions.maskAllInputs,
      maskInputOptions: maskingOptions.maskInputOptions,
      maskTextClass: maskingOptions.maskTextClass,
      ignoreClass: maskingOptions.ignoreClass,

      /*
       * An empty selector string is not the same as no selector: rrweb hands
       * it to querySelector, which throws on "". In MaskAllText mode this is
       * "*", which is how rrweb 2.1.1 expresses mask-every-text-node - there
       * is no maskAllText option. See Masking.getMaskTextSelector.
       */
      ...(maskingOptions.maskTextSelector
        ? { maskTextSelector: maskingOptions.maskTextSelector }
        : {}),
      ...(this.config.blockSelectors.length > 0
        ? { blockSelector: this.config.blockSelectors.join(",") }
        : {}),

      maskInputFn: this.masking.maskInput,
      maskTextFn: this.masking.maskText,

      blockClass: "oneuptime-block",

      inlineStylesheet: true,

      /*
       * inlineImages and collectFonts would multiply the payload by a large
       * factor for marginal fidelity, and inlined images can carry end-user
       * content (an uploaded avatar, a generated document preview).
       */
      inlineImages: false,
      collectFonts: false,

      recordCanvas: this.config.recordCanvas,

      /*
       * Cross-origin iframes require injecting the recorder into the child
       * frame. Keeping a payment provider's frame a black box is a feature,
       * not a gap.
       */
      recordCrossOriginIframes: false,

      slimDOMOptions: {
        script: true,
        comment: true,
        headFavicon: true,
        headWhitespace: true,
        headMetaSocial: true,
        headMetaRobots: true,
        headMetaHttpEquiv: true,
        headMetaVerification: true,
      },

      sampling: {
        mousemove: 100,
        mouseInteraction: true,
        scroll: 150,
        input: "last",
      },

      /*
       * An exception thrown inside rrweb must not surface on the customer's
       * page. Returning true tells rrweb we have handled it; the recording
       * degrades instead of the host application breaking - but no longer
       * silently, see onRrwebError.
       */
      errorHandler: (error: unknown): boolean => {
        this.onRrwebError(error);
        return true;
      },
    });

    if (stop === undefined) {
      /*
       * rrweb declines to start rather than throwing (no document, an
       * environment it cannot serialise). Nothing downstream works after
       * this: no snapshot, no events, no chunks, no custom events.
       */
      debugWarn(
        "rrweb-did-not-start",
        "rrweb declined to start; no DOM will be captured.",
      );
    }

    this.stopRrweb = stop === undefined ? null : stop;
  }

  /*
   * rrweb's own errorHandler. Used to swallow every failure with no counter
   * and no notice, so a mutation observer or serializer failure produced a
   * replay that froze mid-session while the envelope claimed full fidelity,
   * and support could not tell a frozen page from a broken recorder.
   *
   * Now: counted, named once in the diagnostics (the error's NAME only,
   * never its message, which can quote page content), a fresh checkout
   * scheduled so playback can recover past the point the node ids went
   * stale, and a fidelity notice once it is clearly not a one-off.
   */
  private onRrwebError(error: unknown): void {
    this.rrwebErrorCount++;

    if (this.rrwebErrorCount === 1) {
      debugWarn(
        "rrweb-error",
        "rrweb reported an internal error; the recording may skip or freeze around this point.",
        { name: Recorder.errorName(error) },
      );
    }

    if (this.rrwebErrorCount === RRWEB_ERROR_NOTICE_THRESHOLD) {
      this.chunker.addFidelityNotice(RECORDER_ERROR_NOTICE);
    }

    const now: number = Date.now();

    if (
      now - this.lastRrwebErrorCheckoutAtMs >=
      RRWEB_ERROR_CHECKOUT_INTERVAL_MS
    ) {
      this.lastRrwebErrorCheckoutAtMs = now;

      /*
       * Deferred: the handler runs inside rrweb's own observer callback,
       * and asking it to snapshot from in there would re-enter the code
       * that just failed.
       */
      setTimeout((): void => {
        this.takeFullSnapshot();
      }, 0);
    }
  }

  private static errorName(error: unknown): string {
    if (error && typeof error === "object") {
      const name: unknown = (error as Record<string, unknown>)["name"];

      if (typeof name === "string" && name) {
        return name;
      }
    }

    return "Error";
  }

  public getRrwebErrorCount(): number {
    return this.rrwebErrorCount;
  }

  /*
   * The hot path. Order matters: sanitise before anything else sees the
   * event, so nothing downstream - not the buffer, not a test double, not a
   * future plugin - can observe unmasked content.
   */
  private onRrwebEvent(event: RrwebEvent, isCheckout: boolean): void {
    if (this.stopped) {
      return;
    }

    /*
     * DomContentLoaded / Load carry nothing the player uses, and on a page
     * still parsing they arrive BEFORE the first snapshot - where the
     * chunker would take them for content and deny chunk 0 its seek anchor.
     * Not counted as dropped: nothing replayable was lost.
     */
    if (
      event &&
      (event.type === EVENT_TYPE_DOM_CONTENT_LOADED ||
        event.type === EVENT_TYPE_LOAD)
    ) {
      return;
    }

    const sanitised: RrwebEvent | null = this.sanitiseEvent(event);

    if (!sanitised) {
      this.droppedEvents++;
      return;
    }

    this.notifyDetectorsOf(sanitised);

    let json: string = "";

    try {
      json = JSON.stringify(sanitised);
    } catch {
      /*
       * A non-serialisable event cannot be uploaded, and guessing at a
       * repair would put unvalidated content on the wire.
       */
      this.droppedEvents++;
      return;
    }

    const buffered: BufferedEvent = {
      json: json,

      /*
       * UTF-8 bytes, not UTF-16 code units. Every downstream limit - the
       * chunk flush threshold, the 2 MiB request cap, the keepalive quota -
       * is counted in bytes, so a non-ASCII page's nominal 256 KB chunk used
       * to be up to 3x that on the wire.
       */
      bytes: utf8ByteLength(json),
      timestampMs:
        typeof sanitised.timestamp === "number"
          ? sanitised.timestamp
          : Date.now(),
      isCheckout: isCheckout,
      type: sanitised.type,
    };

    /*
     * The first snapshot is the moment rrweb starts accepting custom
     * events; everything queued before it goes in now, directly behind it,
     * so a startup crash caught by the loader lands in the stream after all.
     * Flushed AFTER this event is routed so the snapshot precedes them.
     */
    const isFirstSnapshot: boolean =
      !this.hasSeenFullSnapshot && sanitised.type === EVENT_TYPE_FULL_SNAPSHOT;

    if (isFirstSnapshot) {
      this.hasSeenFullSnapshot = true;
    }

    if (this.uploading) {
      this.chunker.add(buffered);

      /*
       * A hidden tab may be about to go away, and a terminal flush can
       * only carry a keepalive-sized body. Flushing early through the
       * ordinary path while the page is still alive keeps what is left for
       * pagehide small enough to send in one keepalive request.
       */
      if (
        this.isHidden &&
        this.chunker.getOpenByteSize() >= KEEPALIVE_PAYLOAD_BUDGET_BYTES
      ) {
        this.chunker.close(false);
      }
    } else {
      this.buffer.push(buffered);

      if (this.buffer.hasOverflowed()) {
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.BufferOverflow,
        );
      }

      /*
       * The buffer lost incremental events to its byte cap and asks for a
       * new checkout, so the damaged segment becomes evictable whole and
       * the pre-roll is intact again from the next snapshot on.
       */
      if (this.buffer.needsFreshCheckout()) {
        this.scheduleFreshCheckout();
      }
    }

    if (isFirstSnapshot) {
      /*
       * Deferred a tick: rrweb emits the snapshot from inside init() and
       * only THEN marks itself as recording, so a custom event pushed from
       * here, synchronously, would still be refused.
       */
      setTimeout((): void => {
        this.flushPendingCustomEvents();
      }, 0);
    }
  }

  private sanitiseEvent(event: RrwebEvent): RrwebEvent | null {
    if (!event || typeof event.type !== "number") {
      return null;
    }

    const data: Record<string, unknown> =
      event.data && typeof event.data === "object" ? event.data : {};

    if (event.type === EVENT_TYPE_META) {
      const href: unknown = data["href"];

      if (typeof href === "string") {
        data["href"] = this.scrubUrl(href);
      }

      return event;
    }

    if (event.type === EVENT_TYPE_FULL_SNAPSHOT) {
      /*
       * A fresh snapshot means the DOM may be entirely new, so anything
       * sensitive in it has to be marked before the next mutation arrives.
       * The snapshot's own attributes (alt, title, aria-label, hrefs...) go
       * through the masking walk here: rrweb has no hook for them.
       */
      this.rescanSensitiveFields(true);
      this.masking.sanitiseEventData(data);
      return event;
    }

    if (event.type !== EVENT_TYPE_INCREMENTAL) {
      return event;
    }

    const source: unknown = data["source"];

    if (source === SOURCE_MUTATION) {
      this.sanitiseMutation(data);
      this.masking.sanitiseEventData(data);
      this.rescanSensitiveFields(false);
      return event;
    }

    if (source === SOURCE_INPUT) {
      /*
       * A masked field still leaks inter-keystroke timing, which is a
       * published side channel for inferring what was typed. Quantising the
       * timestamp removes the signal; 250 ms buckets keep playback looking
       * like typing.
       */
      event.timestamp = CommonMasking.quantiseTimestamp(event.timestamp);
      return event;
    }

    return event;
  }

  /*
   * Strip attribute mutations that would expose a sticky sensitive field.
   *
   * This is where the show-password toggle is neutralised: rrweb has no hook
   * for filtering an attribute mutation, so the suppression has to happen on
   * the emitted event, resolving the mutation's node id back through rrweb's
   * own mirror.
   */
  private sanitiseMutation(data: Record<string, unknown>): void {
    const attributes: unknown = data["attributes"];

    if (!Array.isArray(attributes) || attributes.length === 0) {
      return;
    }

    const kept: Array<unknown> = [];

    for (const entry of attributes) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const mutation: Record<string, unknown> = entry as Record<
        string,
        unknown
      >;
      const id: unknown = mutation["id"];
      const values: unknown = mutation["attributes"];

      if (typeof id !== "number" || !values || typeof values !== "object") {
        kept.push(entry);
        continue;
      }

      const node: Node | null = this.getNodeById(id);

      const sanitised: Record<string, unknown> | null =
        this.masking.sanitiseAttributeMutation(
          node,
          values as Record<string, unknown>,
        );

      if (sanitised === null) {
        continue;
      }

      mutation["attributes"] = sanitised;
      kept.push(mutation);
    }

    data["attributes"] = kept;
  }

  private getNodeById(id: number): Node | null {
    try {
      const mirror: { getNode: (nodeId: number) => Node | null } =
        record.mirror;

      return mirror.getNode(id);
    } catch {
      return null;
    }
  }

  private rescanSensitiveFields(force: boolean): void {
    const now: number = Date.now();

    if (
      !force &&
      now - this.lastSensitiveScanAtMs < SENSITIVE_RESCAN_INTERVAL_MS
    ) {
      return;
    }

    this.lastSensitiveScanAtMs = now;
    this.masking.markSensitiveFieldsIn(this.documentRef);
  }

  private notifyDetectorsOf(event: RrwebEvent): void {
    if (event.type !== EVENT_TYPE_INCREMENTAL) {
      return;
    }

    /*
     * Every incremental source EXCEPT mutation is the end user doing
     * something: moving the mouse, clicking, scrolling, typing, touching,
     * using a media control. Mutation is excluded deliberately - a page with
     * a carousel or a polling widget mutates forever with nobody at the
     * keyboard, and counting that as activity is what would re-create the
     * "idle rollover never fires" bug in a subtler form.
     */
    if (event.data["source"] !== SOURCE_MUTATION) {
      this.lastUserActivityUnixMs =
        typeof event.timestamp === "number" ? event.timestamp : Date.now();
      return;
    }

    /*
     * rrweb's mutation observer doubles as the dead-click detector's "did the
     * page do anything" source, which is why the detector does not install a
     * second document-wide MutationObserver of its own.
     */
    this.frustrationDetector.notifyActivity(
      typeof event.timestamp === "number" ? event.timestamp : Date.now(),
    );
  }

  private onFrustrationSignal(signal: FrustrationSignal): void {
    if (signal.kind === "rage-click") {
      this.chunker.countSignal("rageClickCount");
    } else if (signal.kind === "dead-click") {
      this.chunker.countSignal("deadClickCount");
    } else if (signal.kind === "error-click") {
      this.chunker.countSignal("errorClickCount");
    } else {
      this.chunker.countSignal("refreshRageCount");
    }

    this.trigger(SessionReplayTriggerReason.Frustration);
  }

  /*
   * Something worth keeping happened. The first reason wins: a session that
   * rage-clicked and then threw is more usefully labelled by what happened
   * first, and re-labelling would make the reason non-deterministic across
   * chunks.
   */
  public trigger(reason: SessionReplayTriggerReason): void {
    if (this.stopped) {
      return;
    }

    if (this.triggerReason === null) {
      this.triggerReason = reason;

      debugLog(
        "trigger",
        "A capture trigger fired; this session may upload now.",
        { reason: reason, sessionId: this.identity.sessionId },
      );
    }

    this.startUploadingIfAllowed();
  }

  private startUploadingIfAllowed(): void {
    if (this.uploading || this.triggerReason === null) {
      return;
    }

    if (!this.consent.isUploadAllowed()) {
      /*
       * A trigger fired and the recording is being held rather than sent.
       * Under RequireExplicit this is a page that never called
       * grantConsent(), which records forever and uploads nothing - correct,
       * and until now completely invisible.
       */
      debugWarn(
        "upload-blocked-consent",
        "Triggered, but consent was never granted. Call OneUptimeReplay.grantConsent().",
        {
          consentMode: this.config.consentMode,
          consentState: this.consent.getState(),
          isRevoked: this.consent.isRevoked(),
        },
      );

      return;
    }

    if (this.transport.isDisabled()) {
      debugWarn(
        "upload-blocked-transport",
        "Triggered, but uploading is already disabled for this page.",
        { reason: this.transport.getDisabledReason() },
      );

      return;
    }

    this.uploading = true;

    debugLog(
      "upload-started",
      "Uploading; the buffered pre-roll is being flushed.",
      {
        sessionId: this.identity.sessionId,
        triggerReason: this.triggerReason,
      },
    );

    /*
     * The pre-roll becomes the front of the upload. Flushed immediately
     * rather than waiting out the interval: the whole point of holding it was
     * to have it when something went wrong, and it is most useful in the
     * seconds right after.
     */
    this.chunker.addMany(this.buffer.drain());

    if (this.chunker.hasOpenFullSnapshot()) {
      this.chunker.close(false);
      return;
    }

    /*
     * No snapshot at the front of the pre-roll. Either rrweb has not taken
     * its first one yet (a page still parsing defers it to the load event),
     * in which case there is nothing to flush and chunk 0 will open on that
     * snapshot when it comes - or the buffer holds footage that lost its
     * anchor. Closing that as chunk 0 would ship a recording nothing can
     * seek into; a checkout first gives the session an anchor immediately
     * behind whatever pre-roll survived.
     */
    if (this.chunker.getOpenEventCount() > 0) {
      this.takeFullSnapshot();
      this.chunker.close(false);
    }
  }

  private onFlushTimer(): void {
    const now: number = Date.now();

    this.writeThroughActivity();

    if (this.maybeRotateSession(now)) {
      /*
       * Rotation already sealed the outgoing session with a final chunk and
       * opened a new one. Closing again here would emit an empty chunk into
       * a session that is one event old.
       */
      return;
    }

    if (!this.uploading) {
      return;
    }

    this.chunker.close(false);
  }

  /*
   * Persist real user activity, and only real user activity.
   *
   * Writing on every tick regardless (which is what SessionId.touch(now())
   * did) made lastActivityUnixMs a heartbeat rather than an activity
   * timestamp, so SessionIdentity could never see an idle gap. Skipping the
   * write when nothing advanced also keeps an idle tab from doing a
   * localStorage write every 15 seconds.
   */
  private writeThroughActivity(): void {
    if (this.lastUserActivityUnixMs <= this.lastTouchedUnixMs) {
      return;
    }

    /*
     * Nothing is written to the visitor's storage while consent is
     * withdrawn. revokeConsent() cleared the record on purpose; touching it
     * back into existence 15 seconds later would re-create the identifier
     * the withdrawal removed.
     */
    if (this.consent.isRevoked()) {
      return;
    }

    SessionId.touch(this.lastUserActivityUnixMs);
    this.lastTouchedUnixMs = this.lastUserActivityUnixMs;
  }

  /*
   * Enforce the idle rollover and the duration cap on a LIVE recorder.
   *
   * Both decisions live in Common/Utils/Rum/SessionIdentity, but until now
   * they were only ever consulted at construction and on a bfcache restore,
   * so neither could fire in a tab that simply stayed open. Returns true when
   * the session was rotated.
   */
  private maybeRotateSession(nowUnixMs: number): boolean {
    if (this.stopped || !this.started) {
      return false;
    }

    /*
     * A withdrawn consent has no session to roll over. SessionId.clearAll()
     * emptied the store, so shouldRotate() reads "no session at all" and
     * answers New - and rotating would MINT one: a fresh id written to the
     * visitor's localStorage, a session-change callback telling the host
     * page's OpenTelemetry resource to tag its traces with an id that will
     * never have a recording, and an upload-blocked-consent warning on a tab
     * the user deliberately opted out of. grantConsent() is the one place a
     * post-revoke session is minted.
     */
    if (this.consent.isRevoked()) {
      return false;
    }

    /*
     * Another tab may already have moved the shared session on. Adopting
     * its id comes BEFORE asking whether to rotate: the sibling's rotation
     * wrote fresh activity, so shouldRotate would answer "no" and this tab
     * would keep posting under an id the sibling just sealed - a "final"
     * session that keeps growing, and the other tab's footage in a session
     * of its own.
     *
     * The outgoing session is sealed BEFORE storage is consulted, because
     * both syncWithStorage and resolveSession reset this tab's chunk
     * counter as a side effect of moving it onto the new id - and a final
     * chunk minted after that reset would take index 0 away from the new
     * session's first chunk. A stored id that differs from ours means one
     * of the two rotations below is certain, so sealing early never
     * orphans a session.
     */
    const storedSessionId: string | null = SessionId.readStoredSessionId();

    if (
      storedSessionId !== null &&
      storedSessionId !== this.identity.sessionId
    ) {
      this.sealCurrentSession();

      const adopted: SessionIdentityState | null = SessionId.syncWithStorage(
        this.identity.sessionId,
        nowUnixMs,
        this.identity.tabId,
      );

      if (adopted) {
        this.switchSession(nowUnixMs, adopted, SESSION_ADOPTED_ROTATION_REASON);
        return true;
      }
    }

    const decision: SessionRotationDecision = SessionId.shouldRotate(nowUnixMs);

    if (!decision.shouldRotate) {
      return false;
    }

    this.rotateSession(nowUnixMs, decision.reason);

    return true;
  }

  private rotateSession(
    nowUnixMs: number,
    reason: SessionRotationReason | undefined,
  ): void {
    /* Before resolveSession resets the chunk counter; see maybeRotateSession. */
    this.sealCurrentSession();

    /*
     * Compare-and-set on the stored record: if another tab won the race to
     * rotate between our decision and this write, its id is adopted rather
     * than a third one minted for the same person.
     */
    const next: SessionIdentityState = SessionId.resolveSession(
      nowUnixMs,
      this.identity.tabId,
      this.identity.sessionId,
    );

    this.switchSession(
      nowUnixMs,
      next,
      String(next.rotationReason || reason || SessionRotationReason.New),
    );
  }

  /*
   * Seal the outgoing session, once, while its chunker still knows its own
   * start offset. close(true) emits a final chunk even with nothing
   * buffered, which is what tells the server this session ended rather than
   * leaving it to expire as idle-timeout ten minutes later. Through the
   * ORDINARY send, not the keepalive one: the page is alive, and the
   * keepalive path can only carry 56 KB.
   */
  private sealCurrentSession(): void {
    if (!this.uploading || this.hasSentFinalChunk) {
      return;
    }

    this.hasSentFinalChunk = true;
    this.chunker.close(true);
  }

  /*
   * Move this recorder onto a different session id: seal the outgoing
   * session, reset everything that is per session, and open the new one on
   * a snapshot of its own. Shared by the idle/duration rollover, adoption
   * of a sibling tab's session, the bfcache restore and a consent re-grant.
   */
  private switchSession(
    nowUnixMs: number,
    next: SessionIdentityState,
    rotationReason: string,
  ): void {
    const previousSessionId: string = this.identity.sessionId;

    this.sealCurrentSession();

    /*
     * Nothing buffered under the old id may be attributed to the new one, and
     * nothing already queued in the transport belongs to the new session
     * either - but the queue is left alone deliberately, because those chunks
     * carry the OLD session id in their envelopes and are still valid.
     */
    this.buffer.clear();

    this.uploading = false;
    this.triggerReason = null;
    this.hasSentFinalChunk = false;
    this.droppedEvents = 0;
    this.customEventsInChunk = 0;
    this.customEventsDroppedInChunk = 0;

    this.identity = next;
    this.chunker = this.createChunker();
    this.detectFidelityNotices();

    /*
     * The ROTATED session began here, not where the page originally loaded.
     *
     * entryUrl is captured once in start() so the final chunk cannot
     * overwrite the session header with the exit url - but a rollover mints
     * a genuinely new session, and carrying the original page load's URL
     * into it would report every rotated session as starting on a page its
     * user left hours ago. The new chunker is re-seeded for the same reason:
     * its routes list starts empty.
     */
    this.entryUrl = this.scrubUrl(this.windowRef.location.href);
    this.chunker.addRoute(this.entryUrl);

    this.lastUserActivityUnixMs = nowUnixMs;
    this.lastTouchedUnixMs = nowUnixMs;

    /*
     * Every per-session cap starts over. The rotated session must be able
     * to earn its own triggers and fill its own rail: without this, a SPA
     * that burned the console, error, route, request or longtask budget in
     * session 1 had those signals permanently dead for every later session
     * on the same page load.
     */
    this.performanceRecorder.resetForNewSession();
    this.errorRecorder.resetForNewSession();
    this.consoleRecorder.resetForNewSession();
    this.routeRecorder.resetForNewSession();
    this.networkRecorder.resetForNewSession();
    this.clickRecorder.resetForNewSession();

    debugLog(
      "session-rotated",
      "The session rolled over; a new recording starts here.",
      {
        previousSessionId: previousSessionId,
        sessionId: this.identity.sessionId,
        rotationReason: rotationReason,
      },
    );

    this.isSampled = SessionSampling.isSampled(
      this.identity.sessionId,
      this.config.samplePercentage,
    );

    /*
     * The snapshot FIRST, then the rotation marker, then the trigger. The
     * new session's chunk 0 is whatever the buffer holds when the trigger
     * drains it, and it is only a seek anchor if the snapshot leads. The
     * old order (marker, trigger, snapshot) shipped a one-event chunk 0 with
     * no DOM in it for every rotated session.
     */
    this.takeFullSnapshot();

    const rotated: SessionReplaySessionRotatedPayload = {
      previousSessionId: previousSessionId,
      rotationReason: rotationReason as SessionRotationReason,
      rotatedAtUnixMs: nowUnixMs,
    };

    this.emitCustomEvent(SESSION_ROTATED_CUSTOM_EVENT_TAG, rotated);

    this.notifySessionChange();

    /*
     * Sampling is a pure function of the session id, so a new id is a new
     * draw. Re-evaluated rather than inherited: carrying the old verdict
     * would make the recorder and the ingest gate disagree about the new
     * session, which is silent data loss.
     */
    if (this.isSampled) {
      this.trigger(SessionReplayTriggerReason.Sampled);
    }

    if (this.extendedConfig.isTargeted) {
      this.trigger(SessionReplayTriggerReason.Manual);
    }
  }

  private notifySessionChange(): void {
    if (!this.sessionChangeListener) {
      return;
    }

    try {
      this.sessionChangeListener(this.identity.sessionId, this.identity.tabId);
    } catch {
      /* A host-page listener that throws must not break the recorder. */
    }
  }

  /*
   * The page went to the background - which on Chrome is also the FIRST
   * half of every same-tab navigation: visibilitychange(hidden) and
   * pagehide are dispatched in the same synchronous unload sequence.
   *
   * That is why the open chunk goes out on the keepalive path here, not
   * final (the tab may well come back, and sealing a live session on every
   * tab switch made the server believe a session was over while its chunks
   * kept arriving). Handing it to the ordinary gzip path instead lost it
   * outright on a navigation: Transport.send awaits CompressionStream
   * before it issues any fetch, so the request was never made - while its
   * chunk index had already been minted, leaving the player a missing chunk
   * and a recording that ends up to 15 s early, on precisely the sessions
   * that end at a link click, a form submit or a reload.
   *
   * Above the keepalive budget the ordinary path is still the only one that
   * can carry the chunk at all, so an oversized chunk keeps it and takes
   * its chances with a tab that stays alive. Every event added while hidden
   * flushes early at the same budget (see onRrwebEvent), so this is the
   * chunk that grew large while the tab was VISIBLE.
   */
  private onHidden(): void {
    if (this.stopped || !this.uploading) {
      return;
    }

    if (this.chunker.getOpenByteSize() <= KEEPALIVE_PAYLOAD_BUDGET_BYTES) {
      this.flushTerminal(false);
      return;
    }

    this.chunker.close(false);
  }

  /*
   * Terminal flush: pagehide, and a hidden tab whose open chunk still fits
   * the keepalive budget. Synchronous by construction - the chunk is closed
   * inside the event handler and posted with fetch(keepalive), because a
   * promise chain started here may never resume on a page the browser is
   * discarding. Cut into keepalive-sized pieces so a large open chunk is
   * sent in parts rather than dropped whole, and the pieces are handed to
   * the transport TOGETHER: they share one request, because the keepalive
   * quota is combined per origin and one fetch per piece is how the sealing
   * piece gets refused.
   */
  private flushTerminal(isFinal: boolean): void {
    if (this.stopped || !this.uploading) {
      return;
    }

    if (isFinal && this.hasSentFinalChunk) {
      return;
    }

    if (isFinal) {
      this.hasSentFinalChunk = true;
    }

    this.isTerminalFlush = true;
    this.terminalChunks = [];

    const droppedBefore: number = this.chunker.getDroppedEventCount();

    try {
      /*
       * Per PIECE and in TOTAL: the browser counts the keepalive quota
       * across every in-flight request to an origin, so what the page can
       * still send is one request's worth however it is cut up. Anything
       * older than that is dropped here, counted, and reported on the
       * envelope as droppedEvents - not minted a chunk index and handed to a
       * request the browser will refuse.
       */
      this.chunker.closeSplit(
        isFinal,
        KEEPALIVE_PAYLOAD_BUDGET_BYTES,
        KEEPALIVE_PAYLOAD_BUDGET_BYTES,
      );
    } finally {
      this.isTerminalFlush = false;
    }

    const droppedEvents: number =
      this.chunker.getDroppedEventCount() - droppedBefore;

    if (droppedEvents > 0) {
      debugWarn(
        "final-flush-truncated",
        "More was open than one keepalive request may carry; the oldest events were dropped.",
        {
          droppedEvents: droppedEvents,
          budgetBytes: KEEPALIVE_PAYLOAD_BUDGET_BYTES,
        },
      );
    }

    const chunks: Array<TerminalChunk> = this.terminalChunks;

    this.terminalChunks = [];

    if (chunks.length > 0) {
      this.transport.sendTerminal(chunks);
    }
  }

  private onBfcacheRestore(): void {
    /*
     * The page came back from the back/forward cache with its JavaScript
     * state intact but an unknown amount of wall-clock time elapsed. The
     * session may have aged out, the URL may have changed, and rrweb's node
     * ids no longer describe what is on screen - so re-evaluate identity,
     * disclose the discontinuity, and take a fresh snapshot.
     */
    this.chunker.addFidelityNotice(SessionReplayFidelityNotice.BfcacheRestore);
    this.emitCustomEvent(BFCACHE_CUSTOM_EVENT_TAG, {
      restoredAtUnixMs: Date.now(),
    });

    const now: number = Date.now();

    this.isHidden = this.documentRef.visibilityState === "hidden";
    this.hasSentFinalChunk = false;

    /*
     * A session that changed while the page was away is a different
     * recording - and this used to STOP the recorder for the rest of the
     * page's life, so a user coming Back after lunch got no recording at
     * all. Now it rotates (or adopts a sibling tab's session) exactly as the
     * flush timer would.
     */
    if (this.maybeRotateSession(now)) {
      this.routeRecorder.handle("popstate", this.windowRef);
      return;
    }

    /* Returning is activity; written through on the next tick. */
    this.lastUserActivityUnixMs = now;

    this.routeRecorder.handle("popstate", this.windowRef);
    this.takeFullSnapshot();
  }

  private onChunkClosed(chunk: PendingChunk): void {
    if (!this.consent.isUploadAllowed()) {
      /*
       * A fully built chunk, discarded. Not re-queued, not counted in
       * droppedEvents, and the chunker has already reset its per-chunk
       * signals - so from the outside this is simply a gap.
       *
       * Defensive rather than routine: every path that closes a chunk is
       * already gated on this.uploading, which can only be set after
       * isUploadAllowed() returned true, and the one public way to withdraw
       * consent (revokeConsent) stops the recorder outright. So this fires
       * only if a future change lets consent flip underneath a live
       * recorder - and a chunk of end-user content vanishing silently is
       * exactly the failure that would be worth knowing about if it did.
       */
      debugWarn(
        "chunk-discarded-consent",
        "A chunk was built but consent does not allow uploading; discarded.",
        {
          eventCount: chunk.eventCount,
          consentState: this.consent.getState(),
        },
      );

      return;
    }

    const chunkIndex: number = SessionId.getNextChunkIndex(this.identity.tabId);
    const envelope: SessionReplayChunkEnvelope = this.buildEnvelope(
      chunk,
      chunkIndex,
    );

    /*
     * The chunk boundary for the per-chunk caps. The chunker has already
     * detached the closed chunk, so a dropped-marker emitted here lands at
     * the very start of the next one - at the boundary it describes.
     */
    this.clickRecorder.startNewChunk();
    this.startNewCustomEventWindow();

    if (this.isTerminalFlush) {
      this.terminalChunks.push({ envelope: envelope, payload: chunk.payload });
      return;
    }

    void this.transport.send(envelope, chunk.payload);
  }

  private startNewCustomEventWindow(): void {
    if (this.customEventsDroppedInChunk > 0) {
      const marker: SessionReplayCustomDroppedPayload = {
        count: this.customEventsDroppedInChunk,
      };

      this.emitCustomEvent(SessionReplayCustomEventTag.CustomDropped, marker);
    }

    this.customEventsInChunk = 0;
    this.customEventsDroppedInChunk = 0;
  }

  private buildEnvelope(
    chunk: PendingChunk,
    chunkIndex: number,
  ): SessionReplayChunkEnvelope {
    const envelope: SessionReplayChunkEnvelope = {
      v: SESSION_REPLAY_WIRE_VERSION,
      appIdentifier: this.initOptions.appIdentifier,
      sessionId: this.identity.sessionId,
      tabId: this.identity.tabId,
      chunkIndex: chunkIndex,
      sessionStartUnixMs: this.identity.sessionStartUnixMs,
      clientSendUnixMs: Date.now(),
      chunkStartOffsetMs: chunk.chunkStartOffsetMs,
      chunkEndOffsetMs: chunk.chunkEndOffsetMs,
      eventCount: chunk.eventCount,
      hasFullSnapshot: chunk.hasFullSnapshot,
      isFinal: chunk.isFinal,
      recorderKind: "dom",
      schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
      rrwebVersion: RRWEB_VERSION,
      recorderVersion: RECORDER_VERSION,
      maskingMode: this.config.maskingMode,
      consentState: this.consent.getState(),
      triggerReason: this.triggerReason || SessionReplayTriggerReason.Manual,

      /* Overwritten by the transport once the payload is actually encoded. */
      payloadEncoding: "identity",
      payloadBytes: chunk.rawBytes,

      url: this.routeRecorder.getCurrentUrl(),
      routes: chunk.routes,
      signals: chunk.signals,
      fidelityNotices: chunk.fidelityNotices,
      droppedEvents:
        this.droppedEvents +
        this.buffer.getDroppedEventCount() +
        this.chunker.getDroppedEventCount(),
      flushFailures: this.transport.getFlushFailureCount(),
    };

    /*
     * snapshotPart is deliberately never set any more. The chunker no longer
     * cuts an oversized snapshot into fragments, because nothing on the
     * receiving side ever reassembled them - see Chunker.emitOversizedEvent.
     * The wire field stays on SessionReplayChunkEnvelope so the server can
     * still recognise, and refuse cleanly, a frame from a recorder built
     * before this.
     */

    if (chunk.traceIds.length > 0) {
      envelope.traceIds = chunk.traceIds;
    }

    /*
     * Device metadata rides on the first chunk and the last one - and on
     * the next chunk after identify() / setTags() changed it (metaDirty),
     * which is how a user identified after login reaches the session header
     * at all. Repeating it on every frame would be pure waste.
     */
    if (chunkIndex === 0 || chunk.isFinal || this.metaDirty) {
      envelope.meta = this.buildMeta();
      this.metaDirty = false;
    }

    /*
     * What this build can capture, on chunk 0 only. Purely informational:
     * it lets the player say "this recording predates click labels" rather
     * than show an empty tab for an artifact cached before they existed.
     */
    if (chunkIndex === 0) {
      envelope.capabilities = this.getCapabilities();
    }

    this.fitEnvelope(envelope);

    return envelope;
  }

  /*
   * Keep the envelope JSON under the server's ceiling by shedding optional
   * fields, least valuable first: the trace ids (the requests they point at
   * are in the payload in-band anyway), then the routes (routeCount still
   * reports how many there were, and the scalar url still says where the
   * chunk was flushed from), then the identified user's traits, then the
   * tags. Everything shed is named in the diagnostics: a customer whose
   * tags stopped appearing must be able to find out why.
   *
   * Nothing load-bearing is ever shed - ids, indexes, offsets, versions,
   * the masking mode and the consent state all stay - so a trimmed envelope
   * is a complete one with less on it.
   */
  private fitEnvelope(envelope: SessionReplayChunkEnvelope): void {
    if (Recorder.envelopeBytes(envelope) <= MAX_ENVELOPE_JSON_BYTES) {
      return;
    }

    const shed: Array<string> = [];

    if (envelope.traceIds) {
      delete envelope.traceIds;
      shed.push("traceIds");
    }

    if (
      Recorder.envelopeBytes(envelope) > MAX_ENVELOPE_JSON_BYTES &&
      envelope.routes
    ) {
      delete envelope.routes;
      shed.push("routes");
    }

    if (
      Recorder.envelopeBytes(envelope) > MAX_ENVELOPE_JSON_BYTES &&
      envelope.meta &&
      envelope.meta.identifiedUserTraits
    ) {
      delete envelope.meta.identifiedUserTraits;
      shed.push("traits");
    }

    if (
      Recorder.envelopeBytes(envelope) > MAX_ENVELOPE_JSON_BYTES &&
      envelope.meta &&
      envelope.meta.tags
    ) {
      delete envelope.meta.tags;
      shed.push("tags");
    }

    if (
      Recorder.envelopeBytes(envelope) > MAX_ENVELOPE_JSON_BYTES &&
      envelope.fidelityNotices.length > 0
    ) {
      /*
       * Emptied rather than removed: the field is required on the wire, and
       * an empty list is the honest "nothing disclosed on this frame".
       */
      envelope.fidelityNotices = [];
      shed.push("fidelityNotices");
    }

    debugWarn(
      "envelope-trimmed",
      "The chunk envelope was over the server's size limit; optional fields were dropped.",
      {
        chunkIndex: envelope.chunkIndex,
        shed: shed.join(","),
        bytes: Recorder.envelopeBytes(envelope),
        maxBytes: MAX_ENVELOPE_JSON_BYTES,
      },
    );
  }

  private static envelopeBytes(envelope: SessionReplayChunkEnvelope): number {
    return utf8ByteLength(JSON.stringify(envelope));
  }

  public getCapabilities(): Array<string> {
    return getRecorderCapabilities({
      captureWebVitals: this.extendedConfig.captureWebVitals,
    });
  }

  private buildMeta(): SessionReplayChunkMeta {
    const userAgent: string = this.windowRef.navigator
      ? this.windowRef.navigator.userAgent || ""
      : "";

    const meta: SessionReplayChunkMeta = {
      /*
       * The URL this recording STARTED on, captured once in start().
       *
       * This used to read location.href at build time, and meta rides both
       * chunk 0 AND the final chunk - so on any page that navigates, the
       * final chunk overwrote the session header's entryUrl with the EXIT
       * url, and a session that began on "/" was filed as beginning wherever
       * the user happened to stop.
       */
      entryUrl: this.entryUrl,
      browserName: Recorder.getBrowserName(userAgent),
      browserVersion: Recorder.getBrowserVersion(userAgent),
      osName: Recorder.getOsName(userAgent),
      deviceType: Recorder.getDeviceType(userAgent),
      viewportWidth: this.windowRef.innerWidth || 0,
      viewportHeight: this.windowRef.innerHeight || 0,
    };

    /*
     * Only sent when the application has user-identity capture switched on.
     * Otherwise the server never receives the raw reference at all, so there
     * is nothing to leak from the wider session-metadata ACL.
     */
    if (this.config.captureUserIdentity && this.userRef) {
      meta.identifiedUserRef = this.userRef;

      /*
       * Traits describe the identified person, so they follow the same
       * switch as the reference itself and never leave the page without it.
       */
      if (this.traits && Object.keys(this.traits).length > 0) {
        meta.identifiedUserTraits = { ...this.traits };
      }
    }

    if (Object.keys(this.tags).length > 0) {
      meta.tags = { ...this.tags };
    }

    return meta;
  }

  private emitCustomEvent(tag: string, payload: unknown): void {
    if (this.stopped) {
      return;
    }

    /*
     * rrweb refuses custom events until its first snapshot, which on a page
     * still parsing is deferred to the load event. Everything raised before
     * then - a startup crash, the first route, the first requests - is held
     * and replayed directly behind that snapshot instead of being lost.
     */
    if (!this.stopRrweb || !this.hasSeenFullSnapshot) {
      this.queueCustomEvent(tag, payload);
      return;
    }

    /*
     * Anything still waiting goes first, so the stream keeps the order the
     * events happened in. Self-draining: if the deferred flush after the
     * first snapshot found rrweb not yet ready, the next event drains it.
     */
    if (this.pendingCustomEvents.length > 0 && !this.isFlushingPending) {
      this.flushPendingCustomEvents();
    }

    try {
      record.addCustomEvent(tag, payload);
    } catch {
      /*
       * Still possible if rrweb's own state disagrees with ours; queued
       * rather than thrown into whatever host-page callback we are inside.
       */
      this.queueCustomEvent(tag, payload);
    }
  }

  private isFlushingPending: boolean = false;

  private queueCustomEvent(tag: string, payload: unknown): void {
    if (this.pendingCustomEvents.length >= MAX_PENDING_CUSTOM_EVENTS) {
      this.droppedEvents++;
      return;
    }

    this.pendingCustomEvents.push({ tag: tag, payload: payload });
  }

  private flushPendingCustomEvents(): void {
    if (this.isFlushingPending || !this.stopRrweb || this.stopped) {
      return;
    }

    const pending: Array<PendingCustomEvent> = this.pendingCustomEvents;

    this.pendingCustomEvents = [];
    this.isFlushingPending = true;

    try {
      for (const event of pending) {
        this.emitCustomEvent(event.tag, event.payload);
      }
    } finally {
      this.isFlushingPending = false;
    }
  }

  public getPendingCustomEventCount(): number {
    return this.pendingCustomEvents.length;
  }

  private takeFullSnapshot(): void {
    if (!this.stopRrweb) {
      return;
    }

    try {
      record.takeFullSnapshot(true);
    } catch {
      /* See emitCustomEvent. */
    }
  }

  private freshCheckoutScheduled: boolean = false;

  /*
   * A checkout requested from INSIDE rrweb's emit callback is deferred a
   * tick: asking rrweb to snapshot while it is delivering an event re-enters
   * its serializer. Coalesced so a burst of events after an overflow asks
   * once.
   */
  private scheduleFreshCheckout(): void {
    if (this.freshCheckoutScheduled) {
      return;
    }

    this.freshCheckoutScheduled = true;

    setTimeout((): void => {
      this.freshCheckoutScheduled = false;

      if (!this.stopped && this.buffer.needsFreshCheckout()) {
        this.takeFullSnapshot();
      }
    }, 0);
  }

  /*
   * Everything the recorder knows it could not capture, declared up front so
   * the player can say "this region was not recorded" instead of showing a
   * blank rectangle. In a tool that presents evidence, an unexplained gap is
   * worse than an acknowledged one.
   */
  private detectFidelityNotices(): void {
    try {
      if (
        !this.config.recordCanvas &&
        this.documentRef.querySelector("canvas")
      ) {
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.CanvasNotRecorded,
        );
      }

      if (this.documentRef.querySelector("video, audio")) {
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.MediaNotReplayable,
        );
      }

      if (Recorder.hasCrossOriginIframe(this.documentRef)) {
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.CrossOriginIframe,
        );
      }

      if (Recorder.hasInaccessibleStylesheet(this.documentRef)) {
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.StylesheetInaccessible,
        );
      }

      const adopted: unknown = (
        this.documentRef as unknown as Record<string, unknown>
      )["adoptedStyleSheets"];

      if (Array.isArray(adopted) && adopted.length > 0) {
        this.chunker.addFidelityNotice(
          SessionReplayFidelityNotice.AdoptedStylesheet,
        );
      }

      const fonts: unknown = (
        this.documentRef as unknown as Record<string, unknown>
      )["fonts"];

      if (fonts && typeof fonts === "object") {
        const size: unknown = (fonts as Record<string, unknown>)["size"];

        if (typeof size === "number" && size > 0) {
          this.chunker.addFidelityNotice(
            SessionReplayFidelityNotice.FontsOmitted,
          );
        }
      }
    } catch {
      /* Probing must never break startup. */
    }
  }

  private static hasCrossOriginIframe(documentRef: Document): boolean {
    const iframes: NodeListOf<HTMLIFrameElement> =
      documentRef.querySelectorAll("iframe");

    for (let i: number = 0; i < iframes.length; i++) {
      const iframe: HTMLIFrameElement | null = iframes.item(i);

      if (!iframe) {
        continue;
      }

      const src: string = iframe.getAttribute("src") || "";

      if (!src || src.indexOf("//") === -1) {
        continue;
      }

      try {
        const url: URL = new URL(src, documentRef.location.href);

        if (url.origin !== documentRef.location.origin) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  /*
   * A cross-origin stylesheet throws on cssRules, so rrweb keeps the <link
   * href> and the player's CSP refuses to load it. Detected here so the
   * viewer gets a banner rather than an unstyled replay they assume is real.
   */
  private static hasInaccessibleStylesheet(documentRef: Document): boolean {
    const sheets: StyleSheetList = documentRef.styleSheets;

    for (let i: number = 0; i < sheets.length; i++) {
      const sheet: CSSStyleSheet | null = sheets.item(i);

      if (!sheet) {
        continue;
      }

      try {
        void sheet.cssRules;
      } catch {
        return true;
      }
    }

    return false;
  }

  private onDirective(
    directive: SessionReplayDirective,
    reason: string | null,
  ): void {
    this.lastDirective = directive;
    this.lastDirectiveReason = reason;

    if (directive === "stop") {
      /*
       * The server has switched this project or application off. Stopping
       * here is what makes "I turned this off" take effect inside one chunk
       * window instead of waiting out the config cache. Nothing is sealed:
       * the server that said stop would refuse the final chunk anyway.
       */
      debugWarn(
        "recorder-stopped-by-server",
        "The server told this recorder to stop. Recording has ended.",
        { reason: reason || "not-reported" },
      );

      this.shutdown("server-directive", false);
      return;
    }

    if (directive === "throttle") {
      /*
       * Recognised, deliberately not acted on beyond the transport's own
       * Retry-After handling - but no longer invisible. A throttled recorder
       * looks exactly like a broken one from the network tab.
       */
      debugWarn(
        "recorder-throttled-by-server",
        "The server asked this recorder to slow down.",
        { reason: reason || "not-reported" },
      );
    }
  }

  private onPermanentFailure(reason: string): void {
    /*
     * The circuit breaker tripped. Release the buffer as well as stopping:
     * holding end-user content we will never upload is pure liability.
     *
     * The reason used to be an unused parameter, which meant a wrong
     * ingestion token could shut the whole recorder down with nothing
     * printed anywhere at all.
     */
    debugWarn(
      "recorder-stopped-transport",
      "Uploading failed for good. Recording has stopped.",
      { reason: reason },
    );

    this.buffer.clear();
    this.shutdown("transport-failure", false);
  }

  public grantConsent(): void {
    const wasRevoked: boolean = this.consent.isRevoked();

    this.consent.grant();

    /*
     * A grant after a revoke is a NEW consent: the withdrawn session's id
     * was cleared, so the recording continues under a fresh identity with
     * nothing from before the revoke attached to it - a new session, a new
     * chunk sequence, a snapshot of its own, and a new sampling draw.
     */
    if (wasRevoked && this.started && !this.stopped) {
      this.switchSession(
        Date.now(),
        SessionId.resolveSession(Date.now(), this.identity.tabId),
        SessionRotationReason.New,
      );
    }

    this.startUploadingIfAllowed();
  }

  public revokeConsent(): void {
    this.consent.revoke();

    /*
     * Everything held locally goes, including the session identity: a user
     * who withdraws consent must not be re-linked to the same session id if
     * they come back.
     *
     * The transport's retry queue counts as "held locally". It can hold up to
     * MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST fully serialised chunks of page
     * content, and revoke does not go through Transport.disable(), so without
     * this the contract "revokeConsent() drops the buffer" held for the ring
     * buffer and not for the part that had already been handed on. The open
     * chunk is dropped with them.
     *
     * Recording itself continues into the ring buffer - consent gates
     * UPLOAD - so a later grantConsent() can pick up from a fresh session
     * instead of finding a recorder that stopped for good.
     */
    this.buffer.clear();
    this.transport.discardQueue();
    SessionId.clearAll();

    this.chunker = this.createChunker();
    this.detectFidelityNotices();
    this.uploading = false;
    this.triggerReason = null;
    this.hasSentFinalChunk = false;
  }

  /*
   * identify(userRef, traits). The reference is what it always was; the
   * traits are stringified, capped and masked here, and both ride the
   * chunk meta - on chunk 0 and the final chunk as before, and on the NEXT
   * flushed chunk when this is called after chunk 0 already went, which
   * is the normal SPA login flow and used to lose the identity entirely.
   * The in-band marker never carries the reference or the traits.
   */
  public identify(
    userRef: string,
    traits?: Record<string, string | number | boolean>,
  ): void {
    if (typeof userRef !== "string" || !userRef) {
      return;
    }

    this.userRef = userRef;

    if (traits !== undefined) {
      this.traits = this.maskStringMap(
        sanitizeSessionReplayStringMap(traits, TRAIT_LIMITS),
      );
    }

    this.metaDirty = true;

    const marker: SessionReplayIdentifyPayload = {
      hasTraits: this.traits !== null && Object.keys(this.traits).length > 0,
    };

    this.emitCustomEvent(SessionReplayCustomEventTag.Identify, marker);
  }

  public hasTraits(): boolean {
    return this.traits !== null && Object.keys(this.traits).length > 0;
  }

  /*
   * track(name, properties): a business event from the host page, as an
   * in-band marker the rail and timeline can show. Capped per chunk with
   * one disclosure per chunk past the cap, counted on the envelope so the
   * list can say "12 custom events" without decoding anything.
   */
  public track(
    name: string,
    properties?: Record<string, string | number | boolean>,
  ): void {
    if (this.stopped || typeof name !== "string" || !name.trim()) {
      return;
    }

    if (
      this.customEventsInChunk >= SESSION_REPLAY_MAX_CUSTOM_EVENTS_PER_CHUNK
    ) {
      this.customEventsDroppedInChunk++;
      return;
    }

    this.customEventsInChunk++;

    const payload: SessionReplayCustomPayload = {
      name: name.trim().slice(0, SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH),
    };

    if (properties !== undefined) {
      const sanitised: Record<string, string> = this.maskStringMap(
        sanitizeSessionReplayStringMap(
          properties,
          CUSTOM_EVENT_PROPERTY_LIMITS,
        ),
      );

      if (Object.keys(sanitised).length > 0) {
        payload.properties = sanitised;
      }
    }

    this.chunker.countSignal("customEventCount");
    this.emitCustomEvent(SessionReplayCustomEventTag.Custom, payload);
  }

  /*
   * captureSession(reason): the explicit trigger, with the page's own word
   * for why, recorded as a custom event so the rail can show it at the
   * moment it was asked for.
   */
  public captureSession(reason?: string): void {
    if (typeof reason === "string" && reason.trim()) {
      this.track("captureSession", {
        reason: reason
          .trim()
          .slice(0, SESSION_REPLAY_MAX_CAPTURE_REASON_LENGTH),
      });
    }

    this.trigger(SessionReplayTriggerReason.Manual);
  }

  /* Replace the session's tag map. */
  public setTags(tags: Record<string, string | number | boolean>): void {
    this.applyTags(sanitizeSessionReplayStringMap(tags, TAG_LIMITS));
  }

  /* Add or overwrite one tag, keeping the rest. */
  public addTag(key: string, value: string | number | boolean): void {
    if (typeof key !== "string" || !key) {
      return;
    }

    const patch: Record<string, string | number | boolean> = {};

    patch[key] = value;

    this.applyTags(mergeSessionReplayStringMaps(this.tags, patch, TAG_LIMITS));
  }

  private applyTags(next: Record<string, string> | null): void {
    if (!next) {
      return;
    }

    if (Recorder.areStringMapsEqual(this.tags, next)) {
      return;
    }

    this.tags = next;
    this.metaDirty = true;

    const payload: SessionReplayTagsPayload = { tags: { ...next } };

    this.emitCustomEvent(SessionReplayCustomEventTag.Tags, payload);
  }

  public getTags(): Record<string, string> {
    return { ...this.tags };
  }

  private static areStringMapsEqual(
    left: Record<string, string>,
    right: Record<string, string>,
  ): boolean {
    const leftKeys: Array<string> = Object.keys(left);
    const rightKeys: Array<string> = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key: string): boolean => {
      return (
        Object.prototype.hasOwnProperty.call(right, key) &&
        left[key] === right[key]
      );
    });
  }

  /*
   * Values the host page hands us are page content by another route, so
   * under MaskAllText they get the text mask exactly as a console argument
   * does. Keys are the page's own vocabulary ("plan", "tenant") and stay.
   */
  private maskStringMap(map: Record<string, string>): Record<string, string> {
    const masked: Record<string, string> = {};

    for (const key of Object.keys(map)) {
      masked[key] = this.masking.maskConsoleArgument(map[key] as string);
    }

    return masked;
  }

  public getSessionId(): string {
    return this.identity.sessionId;
  }

  public getTabId(): string {
    return this.identity.tabId;
  }

  public isUploading(): boolean {
    return this.uploading;
  }

  public getTriggerReason(): SessionReplayTriggerReason | null {
    return this.triggerReason;
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  public getStopReason(): RecorderStopReason | null {
    return this.stopReason;
  }

  public getState(): RecorderState {
    if (this.startDecision === "not-sampled") {
      return "not-sampled";
    }

    if (this.stopped) {
      return "stopped";
    }

    if (!this.started) {
      return "not-started";
    }

    return this.uploading ? "uploading" : "recording";
  }

  /*
   * Every gate between recording and uploading, answered. This is what a
   * support ticket needs: not "is it uploading" but "which gate is closed".
   */
  public getDecisions(): RecorderDecisions {
    const consentAllows: boolean = this.consent.isUploadAllowed();
    const transportAllows: boolean = !this.transport.isDisabled();

    let uploadBlockedBy: "consent" | "transport" | null = null;

    if (!consentAllows) {
      uploadBlockedBy = "consent";
    } else if (!transportAllows) {
      uploadBlockedBy = "transport";
    }

    return {
      isSampled: this.isSampled,
      captureTrigger: this.config.captureTrigger,
      consentMode: this.config.consentMode,
      consentState: this.consent.getState(),
      /* A stopped recorder uploads nothing whatever the gates say. */
      uploadsAllowed: consentAllows && transportAllows && !this.stopped,
      uploadBlockedBy: uploadBlockedBy,
      lastDirective: this.lastDirective,
      lastDirectiveReason: this.lastDirectiveReason,
      startDecision: this.startDecision,
    };
  }

  /*
   * The documented stop, for the host page: seal the session so the server
   * knows it ended here, then tear down. What was already handed to the
   * transport still goes out - the page asked to stop recording, not to
   * destroy what it recorded. Internal stops (a server directive, the
   * breaker, the chunk cap) come through shutdown() and discard instead.
   */
  public stop(): void {
    this.shutdown("api", true);
  }

  private shutdown(reason: RecorderStopReason, seal: boolean): void {
    if (this.stopped) {
      return;
    }

    /*
     * Sealed BEFORE stopped is set, through the ordinary path: the page is
     * alive. stop() used to throw the open chunk away and never seal, so a
     * customer's logout call lost up to 15 s of footage and left the session
     * to expire as idle-timeout ten minutes later.
     */
    if (seal && this.uploading && !this.hasSentFinalChunk) {
      this.hasSentFinalChunk = true;

      try {
        this.clickRecorder.stop(this.documentRef);
        this.chunker.close(true);
      } catch {
        /* Sealing is best effort; the teardown below must still run. */
      }
    }

    this.stopped = true;
    this.stopReason = reason;

    debugLog("recorder-stopped", "Recording has stopped.", {
      sessionId: this.identity.sessionId,
      reason: reason,
      uploaded: this.uploading,
      droppedEvents: this.droppedEvents,
      droppedChunks: this.transport.getDroppedChunkCount(),
      flushFailures: this.transport.getFlushFailureCount(),
    });

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.unsubscribeSessionChanges) {
      this.unsubscribeSessionChanges();
      this.unsubscribeSessionChanges = null;
    }

    if (this.stopRrweb) {
      try {
        this.stopRrweb();
      } catch {
        /* rrweb's teardown must not throw into the host page. */
      }

      this.stopRrweb = null;
    }

    this.errorRecorder.stop(this.windowRef);
    this.networkRecorder.stop(this.windowRef);
    this.performanceRecorder.stop();
    this.consoleRecorder.stop();
    this.routeRecorder.stop(this.windowRef);
    this.frustrationDetector.stop(this.documentRef);
    this.clickRecorder.stop(this.documentRef);

    this.documentRef.removeEventListener(
      "visibilitychange",
      this.visibilityListener,
    );
    this.windowRef.removeEventListener(
      "pagehide",
      this.pageHideListener as EventListener,
    );
    this.windowRef.removeEventListener(
      "pageshow",
      this.pageShowListener as EventListener,
    );
    this.documentRef.removeEventListener("focusin", this.focusInListener, true);

    this.pendingCustomEvents = [];

    /*
     * The ring buffer holds end-user content nothing will ever send: gone
     * in every case. The transport's queue goes too, EXCEPT after a seal:
     * those chunks are the recording the page just asked to finish.
     */
    this.buffer.clear();

    if (!seal) {
      this.transport.discardQueue();
    }
  }

  private scrubUrl(url: string): string {
    return UrlScrubber.scrub(url, this.config.urlAllowlist);
  }

  /*
   * Deliberately tiny UA parsing rather than a UA library: the recorder
   * budget is ~50 KB gzip and the server can always re-derive more detail
   * from the request's own User-Agent header.
   */
  public static getBrowserName(userAgent: string): string {
    /*
     * Order matters: Edge and Opera both advertise Chrome, and Chrome
     * advertises Safari.
     */
    for (const candidate of BROWSER_NAME_PATTERNS) {
      if (candidate.pattern.test(userAgent)) {
        return candidate.name;
      }
    }

    return "Unknown";
  }

  public static getBrowserVersion(userAgent: string): string {
    for (const pattern of BROWSER_VERSION_PATTERNS) {
      const match: RegExpExecArray | null = pattern.exec(userAgent);
      const version: string | undefined = match ? match[1] : undefined;

      if (version !== undefined) {
        return version;
      }
    }

    return "";
  }

  public static getOsName(userAgent: string): string {
    for (const candidate of OS_NAME_PATTERNS) {
      if (candidate.pattern.test(userAgent)) {
        return candidate.name;
      }
    }

    return "Unknown";
  }

  public static getDeviceType(userAgent: string): string {
    if (TABLET_PATTERN.test(userAgent)) {
      return "tablet";
    }

    if (MOBILE_PATTERN.test(userAgent)) {
      return "mobile";
    }

    return "desktop";
  }
}
