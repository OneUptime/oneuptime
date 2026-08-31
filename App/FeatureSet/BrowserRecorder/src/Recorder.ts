import { record } from "rrweb";
import {
  SESSION_REPLAY_CHECKOUT_INTERVAL_MS,
  SESSION_REPLAY_FLUSH_INTERVAL_MS,
  SESSION_REPLAY_SCHEMA_VERSION,
  SESSION_REPLAY_WIRE_VERSION,
  SessionReplayChunkEnvelope,
  SessionReplayChunkMeta,
  SessionReplayConfigResponse,
  SessionReplayDirective,
  SessionReplayFidelityNotice,
} from "Common/Types/Rum/SessionReplay";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import CommonMasking from "Common/Utils/Rum/Masking";
import {
  SessionRotationDecision,
  SessionRotationReason,
} from "Common/Utils/Rum/SessionIdentity";
import SessionSampling from "Common/Utils/Rum/SessionSampling";
import UrlScrubber from "Common/Utils/Rum/UrlScrubber";
import Chunker, { PendingChunk, utf8ByteLength } from "./Chunker";
import Config, {
  RECORDER_VERSION,
  RRWEB_VERSION,
  RecorderInitOptions,
  getChunkUrl,
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
import Transport from "./Transport";

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
const EVENT_TYPE_FULL_SNAPSHOT: number = 2;
const EVENT_TYPE_INCREMENTAL: number = 3;
const EVENT_TYPE_META: number = 4;

/* rrweb IncrementalSource values referenced here. */
const SOURCE_MUTATION: number = 0;
const SOURCE_INPUT: number = 5;

export const BFCACHE_CUSTOM_EVENT_TAG: string = "oneuptime.bfcache-restore";

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
  "oneuptime.session-rotated";

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

  /* Overridable for tests; production always uses the real globals. */
  windowRef?: Window;
  documentRef?: Document;
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

  private stopRrweb: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private started: boolean = false;
  private stopped: boolean = false;

  /* Upload has begun. Set by the first trigger that survives every gate. */
  private uploading: boolean = false;
  private triggerReason: SessionReplayTriggerReason | null = null;

  /*
   * Set for the duration of a terminal close() so the chunk sink knows to use
   * the synchronous keepalive path. A flag rather than a parameter because
   * the sink is called from deep inside the chunker.
   */
  private isTerminalFlush: boolean = false;

  private hasSentFinalChunk: boolean = false;
  private lastSensitiveScanAtMs: number = 0;
  private droppedEvents: number = 0;
  private userRef: string | null = null;

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
         * requests stay the error path's business (above) so one request
         * never counts as two kinds of bad.
         */
        if (!request.isError) {
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
    });

    this.consoleRecorder = new ConsoleRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        this.emitCustomEvent(tag, payload);
      },
      maskArgument: (value: string): string => {
        return this.masking.maskConsoleArgument(value);
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

    this.visibilityListener = (): void => {
      if (this.documentRef.visibilityState === "hidden") {
        this.flushTerminal(true);
        return;
      }

      /*
       * Re-armed on return so a user who tab-switches several times gets one
       * final chunk per hidden transition rather than one per session.
       */
      this.hasSentFinalChunk = false;
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
         * uploaded and nobody will ever watch.
         */
        this.stop();
      },
    });
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

      this.stopped = true;
      return;
    }

    this.started = true;

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
       * degrades instead of the host application breaking.
       */
      errorHandler: (): boolean => {
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
   * The hot path. Order matters: sanitise before anything else sees the
   * event, so nothing downstream - not the buffer, not a test double, not a
   * future plugin - can observe unmasked content.
   */
  private onRrwebEvent(event: RrwebEvent, isCheckout: boolean): void {
    if (this.stopped) {
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

    if (this.uploading) {
      this.chunker.add(buffered);
      return;
    }

    this.buffer.push(buffered);

    if (this.buffer.hasOverflowed()) {
      this.chunker.addFidelityNotice(
        SessionReplayFidelityNotice.BufferOverflow,
      );
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
       */
      this.rescanSensitiveFields(true);
      return event;
    }

    if (event.type !== EVENT_TYPE_INCREMENTAL) {
      return event;
    }

    const source: unknown = data["source"];

    if (source === SOURCE_MUTATION) {
      this.sanitiseMutation(data);
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
    this.chunker.close(false);
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
    const previousSessionId: string = this.identity.sessionId;

    /*
     * Seal the outgoing session first, while the old chunker still knows its
     * own start offset. close(true) emits a final chunk even with nothing
     * buffered, which is what tells the server this session ended rather than
     * leaving it to expire as idle-timeout ten minutes later.
     */
    if (this.uploading) {
      this.isTerminalFlush = true;

      try {
        this.chunker.close(true);
      } finally {
        this.isTerminalFlush = false;
      }
    }

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

    this.identity = SessionId.resolveSession(nowUnixMs, this.identity.tabId);
    this.chunker = this.createChunker();

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
     * The rotated session must be able to earn its own Performance
     * trigger: reset the emit cap and re-arm a longtask observer that
     * disconnected when the OLD session's stream hit the cap. Without
     * this, a jank-looping SPA that burned the cap in session 1 has
     * performance triggers permanently dead for every later session on
     * the same page load.
     */
    this.performanceRecorder.resetForNewSession();

    debugLog(
      "session-rotated",
      "The session rolled over; a new recording starts here.",
      {
        previousSessionId: previousSessionId,
        sessionId: this.identity.sessionId,
        rotationReason: String(reason || SessionRotationReason.New),
      },
    );

    this.emitCustomEvent(SESSION_ROTATED_CUSTOM_EVENT_TAG, {
      previousSessionId: previousSessionId,
      rotationReason: reason || SessionRotationReason.New,
      rotatedAtUnixMs: nowUnixMs,
    });

    /*
     * Sampling is a pure function of the session id, so a new id is a new
     * draw. Re-evaluated rather than inherited: carrying the old verdict
     * would make the recorder and the ingest gate disagree about the new
     * session, which is silent data loss.
     */
    if (
      SessionSampling.isSampled(
        this.identity.sessionId,
        this.config.samplePercentage,
      )
    ) {
      this.trigger(SessionReplayTriggerReason.Sampled);
    }

    /*
     * rrweb's node ids still describe the old stream. A fresh checkout gives
     * the new session a snapshot of its own to replay from.
     */
    this.takeFullSnapshot();
  }

  /*
   * Terminal flush. Synchronous by construction: the chunk is closed inside
   * the event handler and posted with fetch(keepalive), because a promise
   * chain started here may never resume on a page the browser is discarding.
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

    try {
      this.chunker.close(isFinal);
    } finally {
      this.isTerminalFlush = false;
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

    const refreshed: SessionIdentityState = SessionId.resolveSession(
      Date.now(),
      this.identity.tabId,
    );

    if (refreshed.sessionId !== this.identity.sessionId) {
      /*
       * A rolled-over session is a different recording. Nothing buffered
       * under the previous id may be attributed to the new one.
       */
      this.buffer.clear();
      this.stop();
      return;
    }

    this.hasSentFinalChunk = false;
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

    if (this.isTerminalFlush) {
      this.transport.sendTerminal(envelope, chunk.payload);
      return;
    }

    void this.transport.send(envelope, chunk.payload);
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

    if (chunk.snapshotPart) {
      envelope.snapshotPart = chunk.snapshotPart;
    }

    if (chunk.traceIds.length > 0) {
      envelope.traceIds = chunk.traceIds;
    }

    /*
     * Device metadata rides on the first chunk and the last one only.
     * Repeating it on every frame would be pure waste, and the finalizer
     * reads whichever copy arrived.
     */
    if (chunkIndex === 0 || chunk.isFinal) {
      envelope.meta = this.buildMeta();
    }

    return envelope;
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
    }

    return meta;
  }

  private emitCustomEvent(tag: string, payload: unknown): void {
    if (!this.stopRrweb) {
      return;
    }

    try {
      record.addCustomEvent(tag, payload);
    } catch {
      /*
       * addCustomEvent throws when recording has not started. Losing a
       * custom event is acceptable; throwing into whatever host-page callback
       * we are inside is not.
       */
    }
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
    if (directive === "stop") {
      /*
       * The server has switched this project or application off. Stopping
       * here is what makes "I turned this off" take effect inside one chunk
       * window instead of waiting out the config cache.
       */
      debugWarn(
        "recorder-stopped-by-server",
        "The server told this recorder to stop. Recording has ended.",
        { reason: reason || "not-reported" },
      );

      this.stop();
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
    this.stop();
  }

  public grantConsent(): void {
    this.consent.grant();
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
     * buffer and not for the part that had already been handed on.
     */
    this.buffer.clear();
    this.transport.discardQueue();
    SessionId.clearAll();
    this.stop();
  }

  public identify(userRef: string): void {
    if (typeof userRef === "string" && userRef) {
      this.userRef = userRef;
    }
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

  public stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    debugLog("recorder-stopped", "Recording has stopped.", {
      sessionId: this.identity.sessionId,
      uploaded: this.uploading,
      droppedEvents: this.droppedEvents,
      droppedChunks: this.transport.getDroppedChunkCount(),
      flushFailures: this.transport.getFlushFailureCount(),
    });

    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
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

    /*
     * Nothing will send these once the recorder is stopped, so holding either
     * one is retained end-user content with no purpose. See revokeConsent.
     */
    this.buffer.clear();
    this.transport.discardQueue();
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
