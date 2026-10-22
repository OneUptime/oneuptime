import {
  SessionReplayCustomEventTag,
  SessionReplayInteractionType,
  SessionReplayNavigationType,
  SessionReplayPerformanceBudgetKind,
  SessionReplayPerformanceBudgetPayload,
  SessionReplayWebVitalMetric,
  SessionReplayWebVitalPayload,
  SessionReplayWebVitalRating,
} from "Common/Types/Rum/SessionReplayCustomEvents";

/*
 * Performance observation, two jobs in one module because they share the
 * same PerformanceObserver entries:
 *
 *   1. BUDGETS. LCP and main-thread long tasks via PerformanceObserver,
 *      plus slow instrumented requests reported in by the Recorder (the
 *      network side already lives in NetworkRecorder; observing resource
 *      timings here too would double-count every fetch). A budget of 0
 *      means that trigger is OFF; an over-budget entry is emitted as a
 *      custom event AND handed to onIssue, which the Recorder turns into
 *      the Performance upload trigger.
 *
 *   2. WEB VITALS. LCP, FCP, CLS and TTFB once per page view, and INP
 *      once per VIEW, emitted as kind "web-vital" custom events with the
 *      standard Google ratings. Informational only: a vital NEVER calls
 *      onIssue, so it can never cause an upload, and it is on by default
 *      because "was this page slow for that user" is the first question a
 *      viewer asks. No web-vitals dependency: the recorder ships to
 *      third-party pages under a byte budget, and the subset below (LCP
 *      final candidate, FCP entry, CLS session windows, INP from event
 *      timing, TTFB from navigation timing) is what the library would
 *      compute for the overwhelming majority of pages.
 *
 *      Timed the way the library times them, because the library's number
 *      is the one a customer holds ours against (issue #5181):
 *
 *        - A page the browser PRERENDERED (speculation rules, or Chrome
 *          loading the page it expects to be opened from the address bar)
 *          is measured from when the visitor opened it: FCP, LCP and TTFB
 *          count from the navigation entry's activationStart, clamped at
 *          0, and nothing is observed until the page is activated. Timed
 *          from the prerender's start, a 68 ms FCP read as 2.1 s.
 *        - A page hidden before it painted (opened in a background tab)
 *          reports no FCP or LCP: the browser paints a hidden page only
 *          once it is shown, so the number would time the tab sitting
 *          unseen. Nor CLS, which the library (and CrUX) report only for a
 *          page whose FCP was reported.
 *        - A page restored from the back/forward cache is a new page view
 *          with vitals of its own: TTFB 0, FCP and LCP from the restore to
 *          the frame after it, and CLS and INP from the restore on.
 *
 *      Every vital names the kind of page view it describes
 *      (navigationType), and the LCP budget reads the same LCP.
 *
 *      INP is per view because of single-page apps. The browser's INP
 *      covers the whole document, so an app that routes with pushState
 *      got ONE number for the entire visit, blamed on whichever URL the
 *      tab happened to be showing. Every route change (noteRouteChange)
 *      now closes the current view and opens a new one; an interaction
 *      belongs to the view it STARTED in, so the click that navigated
 *      away is charged to the page it was clicked on, not to the page it
 *      opened. Each report carries the view's URL and the slow
 *      interaction's attribution: its type, a structural target selector
 *      and the input-delay / processing / presentation split.
 *
 * Every event carries occurredAtUnixMs, the wall-clock time the entry
 * HAPPENED (performance.timeOrigin + entry.startTime), never the time the
 * observer delivered it. With buffered:true the LCP callback fires when
 * the recorder boots, seconds after the paint, and longtask entries are
 * batched after the task ends; stamping those with Date.now() drew the
 * stall AFTER the jank it explained. onIssue receives the same clock.
 *
 * Every observer is feature-detected and try/caught: this module runs on
 * other people's pages, where "browser without longtask support" is normal
 * and an exception is a bug we caused. Nothing here reads page content -
 * payloads carry timings and an already-scrubbed URL only.
 */

export const PERFORMANCE_CUSTOM_EVENT_TAG: string =
  SessionReplayCustomEventTag.Performance;

/*
 * Cap on emitted BUDGET events per page load. A page that jank-loops
 * produces an unbounded longtask stream, and 500 identical "the main
 * thread stalled" rows make a worse recording than 50 do. Vitals are not
 * counted: they are bounded by construction (one per metric per page).
 */
export const MAX_PERFORMANCE_EVENTS: number = 50;

export type PerformanceIssueKind = SessionReplayPerformanceBudgetKind;

export interface PerformanceIssue
  extends SessionReplayPerformanceBudgetPayload {
  /*
   * When the entry happened on the wall clock. Absent only for
   * slow-request, whose caller already timestamps the completion.
   */
  occurredAtUnixMs?: number;
}

export interface WebVitalEvent extends SessionReplayWebVitalPayload {
  occurredAtUnixMs: number;
}

/*
 * The thresholds web.dev publishes for each metric: at or under `good` is
 * good, over `poor` is poor, between is needs-improvement. CLS is unitless;
 * everything else is milliseconds.
 */
export const WEB_VITAL_THRESHOLDS: Record<
  SessionReplayWebVitalMetric,
  { good: number; poor: number }
> = {
  LCP: { good: 2500, poor: 4000 },
  FCP: { good: 1800, poor: 3000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  TTFB: { good: 800, poor: 1800 },
};

export function rateWebVital(
  metric: SessionReplayWebVitalMetric,
  value: number,
): SessionReplayWebVitalRating {
  const threshold: { good: number; poor: number } =
    WEB_VITAL_THRESHOLDS[metric];

  if (value <= threshold.good) {
    return "good";
  }

  return value <= threshold.poor ? "needs-improvement" : "poor";
}

/*
 * Event-timing entries under this many milliseconds are not delivered.
 * 40 is what web-vitals asks for: the default of 104 would hide every
 * interaction between "noticeable" and "slow", and INP is the max of
 * what was observed.
 */
export const INP_DURATION_THRESHOLD_MS: number = 40;

/*
 * A closed view waits this long before its INP is reported. Event timing
 * delivers an interaction's entry after the NEXT paint, which is after the
 * handler that called pushState - so at the moment of the route change the
 * interaction that caused it has not been observed yet.
 */
export const INP_VIEW_SETTLE_MS: number = 1000;

/*
 * Per page load. A router that rewrites the URL on every keystroke would
 * otherwise turn each one into a view and an INP event.
 */
export const MAX_INP_REPORTS: number = 100;

/* Closed views awaiting their report; past this the oldest goes at once. */
const MAX_PENDING_INP_VIEWS: number = 10;

/*
 * web-vitals' p98 approximation: keep the ten slowest interactions and
 * skip one per fifty interactions, so a view with 120 interactions
 * reports its third slowest rather than a single outlier.
 */
const INP_LONGEST_KEPT: number = 10;
const INTERACTIONS_PER_SKIPPED_OUTLIER: number = 50;

/*
 * Inputs whose target is remembered, for an entry whose own target is
 * gone: event timing reports target null once the element has left the
 * document, and the interaction that routed away usually removed its own
 * button. Matched to the entry by event.timeStamp, which IS its startTime.
 */
const INTERACTION_TARGET_EVENTS: Array<string> = [
  "pointerdown",
  "click",
  "keydown",
];
const RECENT_TARGETS_KEPT: number = 8;

/*
 * CLS session windows, per the metric's definition: shifts less than 1s
 * apart and within a 5s window are one session; CLS is the largest
 * session's total.
 */
const CLS_SESSION_GAP_MS: number = 1000;
const CLS_SESSION_MAX_MS: number = 5000;

export interface PerformanceRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /* Fires for every recorded BUDGET issue; the Recorder turns this into a trigger. */
  onIssue: (atUnixMs: number, issue: PerformanceIssue) => void;

  /* Milliseconds; 0 disables the corresponding observer/check. */
  lcpBudgetMs: number;
  longTaskBudgetMs: number;
  slowRequestBudgetMs: number;

  /*
   * Emit the web-vital events. Defaults to ON when omitted, so an
   * existing caller that only knows about budgets gets vitals for free;
   * ExtendedConfig turns it off only on an explicit false from the server.
   */
  captureWebVitals?: boolean;

  /*
   * The scrubbed URL the page is showing, for the view an INP is reported
   * against before any route change has named it.
   */
  getCurrentUrl?: () => string;

  /*
   * The structural selector for an interaction's target, built under the
   * same blocking rules as a click's. No selector is sent without it.
   */
  describeTarget?: (target: Element) => string;
}

/* One interaction, merged from every event-timing entry that shares its id. */
interface InpInteraction {
  id: number;
  latencyMs: number;
  /* Of the earliest entry: where the input happened. */
  startTime: number;
  processingStart: number | null;
  processingEnd: number | null;
  /* When the next frame painted, from the longest entry. */
  nextPaintTime: number;
  /* The longest entry's event name (pointerdown, keydown, click...). */
  name: string;
  target: Element | null;
}

/* The stretch of the page between two route changes. */
interface InpView {
  url: string | null;
  navigationType: SessionReplayNavigationType;
  /* performance.now() when it began / ended; end is null while current. */
  startMs: number;
  endMs: number | null;
  /* performance.interactionCount at each end, where the engine has it. */
  countAtStart: number | null;
  countAtEnd: number | null;
  /* Distinct interactions observed, for engines without interactionCount. */
  observedCount: number;
  lastInteractionId: number;
  /* The slowest few, slowest first. */
  longest: Array<InpInteraction>;
  /* What was last emitted, so an unchanged view is not reported twice. */
  reportedId: number | null;
  reportedLatencyMs: number | null;
  /* Given one more settle period because the main thread was blocked. */
  deferred: boolean;
}

type ObserverLike = {
  observe: (options: Record<string, unknown>) => void;
  disconnect: () => void;
  takeRecords?: () => Array<PerformanceEntry>;
};

type ObserverConstructor = new (
  callback: (list: { getEntries: () => Array<PerformanceEntry> }) => void,
) => ObserverLike;

/* The entry types this module knows how to read. */
const LCP_ENTRY: string = "largest-contentful-paint";
const LONGTASK_ENTRY: string = "longtask";
const PAINT_ENTRY: string = "paint";
const LAYOUT_SHIFT_ENTRY: string = "layout-shift";
const EVENT_ENTRY: string = "event";
const FIRST_INPUT_ENTRY: string = "first-input";
const NAVIGATION_ENTRY: string = "navigation";
const VISIBILITY_STATE_ENTRY: string = "visibility-state";

/* Fired at the document when a prerendered page is opened. */
const PRERENDERING_CHANGE_EVENT: string = "prerenderingchange";

/*
 * The user inputs after which the browser stops issuing LCP candidates,
 * which makes them the moment the page's LCP is final. Only the visitor's
 * own (trusted) input counts: the browser goes on issuing candidates after
 * a script's synthetic click, and the web-vitals library ignores one too.
 */
const LCP_FINALISING_INPUTS: Array<string> = [
  "keydown",
  "pointerdown",
  "click",
];

/* An LCP candidate: its value, and when the visitor saw that paint. */
interface LcpCandidate {
  valueMs: number;
  occurredAtUnixMs: number;
}

export default class PerformanceRecorder {
  private readonly options: PerformanceRecorderOptions;
  private readonly captureWebVitals: boolean;

  private started: boolean = false;
  private emittedCount: number = 0;
  private webVitalCount: number = 0;

  /* Budget LCP reports once - it is one number per page load, not a stream. */
  private hasReportedLcp: boolean = false;

  private lcpObserver: ObserverLike | null = null;
  private longTaskObserver: ObserverLike | null = null;
  private paintObserver: ObserverLike | null = null;
  private layoutShiftObserver: ObserverLike | null = null;
  private interactionObserver: ObserverLike | null = null;
  private firstInputObserver: ObserverLike | null = null;

  /* Remembered from start() so resetForNewSession can re-arm observers. */
  private windowRef: Window | null = null;
  private timeOriginMs: number = 0;

  /*
   * The page is being prerendered: nobody has opened it yet, so nothing is
   * observed until prerenderingchange says somebody has.
   */
  private awaitingActivation: boolean = false;

  /*
   * performance.now() when the visitor opened a prerendered page (the
   * navigation entry's activationStart); 0 for every other page. FCP, LCP
   * and TTFB count from here.
   */
  private activationStartMs: number = 0;

  /*
   * performance.now() when the page was first hidden, Infinity while it
   * never has been. A paint at or after it is not reported: a hidden page
   * paints only once it is shown again.
   */
  private firstHiddenMs: number = Infinity;

  /* The kind of page view the page-level vitals describe. */
  private navigationType: SessionReplayNavigationType = "hard";

  /* The load had navigation timing, so a restore reports its TTFB of 0. */
  private hasMeasuredTtfb: boolean = false;

  /*
   * The document load's FCP was reported. CLS is reported only then - for
   * the load and for every restore after it - which is when the web-vitals
   * library starts measuring CLS at all.
   */
  private hasReportedLoadFcp: boolean = false;

  /* Bumped by each restore, so a frame wait that outlived it stands down. */
  private restoreCount: number = 0;

  /* What the engine can observe, read once the page is the visitor's. */
  private supportedEntryTypes: Array<string> = [];

  /* Per-metric latch: a vital is emitted at most once per page view. */
  private reportedVitals: Record<string, boolean> = {};

  /* Latest LCP candidate. */
  private lcpCandidate: LcpCandidate | null = null;

  /* CLS: the running session window and the largest one seen. */
  private clsObserved: boolean = false;
  private clsValue: number = 0;
  private clsOccurredAtMs: number = 0;
  private clsSessionValue: number = 0;
  private clsSessionFirstMs: number = 0;
  private clsSessionLastMs: number = 0;

  /*
   * INP views: every view that can still receive interactions, oldest
   * first. The last one is the view the page is showing; the rest closed
   * at a route change and are waiting out INP_VIEW_SETTLE_MS.
   */
  private inpViews: Array<InpView> = [];
  private inpReportCount: number = 0;
  private inpSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private inpInteractionsRequireId: boolean = true;
  private syntheticInteractionId: number = 0;
  private recentTargets: Array<{ timeStamp: number; target: unknown }> = [];
  private recentTargetIndex: number = 0;

  private readonly lifecycleListener: (event: Event) => void;
  private readonly inputListener: (event: Event) => void;
  private readonly targetListener: (event: Event) => void;
  private readonly activationListener: () => void;

  public constructor(options: PerformanceRecorderOptions) {
    this.options = options;
    this.captureWebVitals = options.captureWebVitals !== false;

    this.lifecycleListener = (event: Event): void => {
      this.onLifecycle(event);
    };

    this.inputListener = (event: Event): void => {
      if (event.isTrusted) {
        this.finaliseLcp();
      }
    };

    this.activationListener = (): void => {
      this.onActivation();
    };

    this.targetListener = (event: Event): void => {
      this.recentTargets[this.recentTargetIndex] = {
        timeStamp: event.timeStamp,
        target: event.target,
      };
      this.recentTargetIndex =
        (this.recentTargetIndex + 1) % RECENT_TARGETS_KEPT;
    };
  }

  public start(windowRef: Window = window): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.windowRef = windowRef;
    this.timeOriginMs = PerformanceRecorder.readTimeOrigin(windowRef);

    if (this.captureWebVitals) {
      this.addLifecycleListeners(windowRef);
    }

    /*
     * A prerendered page runs its scripts - this one included - before
     * anybody opens it, and may never be opened at all. Anything measured
     * now would time the prerender, not the visitor's page, so it all
     * waits for the activation, as the web-vitals library waits.
     */
    if (PerformanceRecorder.isPrerendering(windowRef)) {
      this.awaitingActivation = true;

      try {
        windowRef.document.addEventListener(
          PRERENDERING_CHANGE_EVENT,
          this.activationListener,
          true,
        );
      } catch {
        /* A document that refuses listeners is never measured. */
      }

      return;
    }

    this.observePage(windowRef, false);
  }

  /*
   * The page is the visitor's now: read where its timings start and what
   * it has been through so far, then observe it.
   */
  private observePage(windowRef: Window, wasPrerendered: boolean): void {
    this.activationStartMs = PerformanceRecorder.readActivationStart(windowRef);
    this.navigationType =
      wasPrerendered || this.activationStartMs > 0 ? "prerender" : "hard";
    this.firstHiddenMs = PerformanceRecorder.readFirstHiddenTime(
      windowRef,
      this.activationStartMs,
    );

    if (this.captureWebVitals) {
      this.reportTtfb(windowRef);
    }

    const Observer: ObserverConstructor | null =
      PerformanceRecorder.getObserverConstructor(windowRef);

    if (!Observer) {
      return;
    }

    const supported: Array<string> =
      PerformanceRecorder.getSupportedEntryTypes(Observer);

    this.supportedEntryTypes = supported;

    /*
     * One LCP observer serves both the budget and the vital: the entries
     * are identical and a second observer would only cost the page.
     */
    if (
      (this.options.lcpBudgetMs > 0 || this.captureWebVitals) &&
      supported.indexOf(LCP_ENTRY) >= 0
    ) {
      this.lcpObserver = PerformanceRecorder.tryObserve(
        Observer,
        LCP_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onLcpEntries(entries);
        },
      );
    }

    if (
      this.options.longTaskBudgetMs > 0 &&
      supported.indexOf(LONGTASK_ENTRY) >= 0
    ) {
      this.longTaskObserver = PerformanceRecorder.tryObserve(
        Observer,
        LONGTASK_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onLongTaskEntries(entries);
        },
      );
    }

    if (!this.captureWebVitals) {
      return;
    }

    if (supported.indexOf(PAINT_ENTRY) >= 0) {
      this.paintObserver = PerformanceRecorder.tryObserve(
        Observer,
        PAINT_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onPaintEntries(entries);
        },
      );
    }

    if (supported.indexOf(LAYOUT_SHIFT_ENTRY) >= 0) {
      this.layoutShiftObserver = PerformanceRecorder.tryObserve(
        Observer,
        LAYOUT_SHIFT_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onLayoutShiftEntries(entries);
        },
      );

      /*
       * Observed at all means a final CLS of 0 is a MEASURED zero (no
       * shifts happened), which is worth reporting; an unsupported engine
       * reports nothing rather than a 0 it never measured.
       */
      this.clsObserved = this.layoutShiftObserver !== null;
    }

    /*
     * The document load is the first view. Its interactions count from
     * the time origin, so buffered entries from before the recorder
     * booted land in it. Opened before the observer, which may deliver
     * those entries as soon as it is observing.
     */
    this.inpViews = [this.createInpView(null, this.navigationType, 0, 0)];

    /*
     * Event timing carries every interaction over the duration threshold.
     * first-input is observed beside it, as the web-vitals library does:
     * the browser delivers the first interaction whatever its duration, so
     * a page whose every interaction was quick still has an INP (it had
     * none). It carries the interactionId of its event entries, so it
     * merges into that interaction rather than counting twice. Where event
     * timing is absent first-input is all there is (older Safari), one
     * interaction per entry.
     */
    if (supported.indexOf(EVENT_ENTRY) >= 0) {
      this.interactionObserver = PerformanceRecorder.tryObserve(
        Observer,
        EVENT_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onInteractionEntries(entries);
        },
        { durationThreshold: INP_DURATION_THRESHOLD_MS },
      );

      if (
        this.interactionObserver &&
        supported.indexOf(FIRST_INPUT_ENTRY) >= 0
      ) {
        this.firstInputObserver = PerformanceRecorder.tryObserve(
          Observer,
          FIRST_INPUT_ENTRY,
          (entries: Array<PerformanceEntry>): void => {
            this.onInteractionEntries(entries);
          },
        );
      }
    } else if (supported.indexOf(FIRST_INPUT_ENTRY) >= 0) {
      this.inpInteractionsRequireId = false;
      this.interactionObserver = PerformanceRecorder.tryObserve(
        Observer,
        FIRST_INPUT_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onInteractionEntries(entries);
        },
      );
    }

    if (this.interactionObserver) {
      this.addTargetListeners(windowRef);
    } else {
      this.inpViews = [];
    }
  }

  public stop(): void {
    if (!this.started) {
      return;
    }

    /*
     * The page-level vitals are still pending if the tab was never
     * hidden. Flushed BEFORE the observers go, while the Recorder's own
     * stop sequence can still add the events to the stream.
     */
    if (this.captureWebVitals) {
      this.finaliseVitals();
    }

    this.started = false;
    this.awaitingActivation = false;

    if (this.windowRef) {
      this.removeLifecycleListeners(this.windowRef);
      this.removeActivationListener(this.windowRef);
    }

    this.lcpObserver = PerformanceRecorder.disconnect(this.lcpObserver);
    this.longTaskObserver = PerformanceRecorder.disconnect(
      this.longTaskObserver,
    );
    this.paintObserver = PerformanceRecorder.disconnect(this.paintObserver);
    this.layoutShiftObserver = PerformanceRecorder.disconnect(
      this.layoutShiftObserver,
    );
    this.interactionObserver = PerformanceRecorder.disconnect(
      this.interactionObserver,
    );
    this.firstInputObserver = PerformanceRecorder.disconnect(
      this.firstInputObserver,
    );
    this.cancelInpSettle();
    this.inpViews = [];
  }

  /*
   * The page came back from the back/forward cache. The Recorder calls this
   * from its pageshow handler, once the restored page records as a new tab,
   * with that event's timeStamp - the moment of the restore on the
   * performance clock.
   *
   * To the visitor that is a new page view, and the web-vitals library
   * reports a new set of vitals for it; so does this, each marked
   * "back-forward-cache":
   *
   *   - TTFB 0: nothing was fetched.
   *   - FCP and LCP: from the restore to the frame after it, when the
   *     cached page is back on the screen.
   *   - CLS and INP: from the restore on, in a view of its own. The visit
   *     before the cache was reported at its pagehide.
   */
  public noteBfcacheRestore(pageShowTimeStamp: number): void {
    if (!this.started || !this.captureWebVitals || this.awaitingActivation) {
      return;
    }

    const now: number = this.nowMs();
    const restoredAtMs: number =
      Number.isFinite(pageShowTimeStamp) &&
      pageShowTimeStamp >= 0 &&
      pageShowTimeStamp <= now
        ? pageShowTimeStamp
        : now;

    /* Whatever the visit before the cache had left is final now. */
    this.finaliseVitals();

    this.navigationType = "back-forward-cache";
    this.reportedVitals = {};
    this.lcpCandidate = null;
    this.clsValue = 0;
    this.clsOccurredAtMs = 0;
    this.clsSessionValue = 0;
    this.clsSessionFirstMs = 0;
    this.clsSessionLastMs = 0;

    /* The load's paint entries describe the visit before the cache. */
    this.paintObserver = PerformanceRecorder.disconnect(this.paintObserver);

    if (this.interactionObserver) {
      this.inpViews = [
        this.createInpView(
          null,
          "back-forward-cache",
          restoredAtMs,
          this.readInteractionCount(),
        ),
      ];
    }

    if (this.hasMeasuredTtfb) {
      this.reportVital("TTFB", 0, this.toUnixMs(restoredAtMs));
    }

    const restore: number = ++this.restoreCount;

    this.afterNextFrame((): void => {
      if (!this.started || restore !== this.restoreCount) {
        return;
      }

      const value: number = Math.max(this.nowMs() - restoredAtMs, 0);
      const occurredAtUnixMs: number = this.toUnixMs(restoredAtMs + value);

      if (this.supportedEntryTypes.indexOf(PAINT_ENTRY) >= 0) {
        this.reportVital("FCP", value, occurredAtUnixMs);
      }

      if (this.supportedEntryTypes.indexOf(LCP_ENTRY) >= 0) {
        this.reportVital("LCP", value, occurredAtUnixMs);
      }
    });
  }

  /* The prerendered page was opened: it is the visitor's from here. */
  private onActivation(): void {
    if (!this.started || !this.awaitingActivation || !this.windowRef) {
      return;
    }

    this.awaitingActivation = false;
    this.removeActivationListener(this.windowRef);
    this.observePage(this.windowRef, true);
  }

  /*
   * The recorder is about to pause because nobody is at the page. Reported
   * exactly as a hidden tab reports them, while the stream can still take
   * them: LCP, FCP, TTFB and CLS once, and the current view's INP, which
   * stays open and is reported again only if it changes after the user
   * comes back. Without this, a page whose first hide came while paused -
   * the tab closed by someone who walked away first - lost its vitals.
   */
  public finaliseVitalsNow(): void {
    if (!this.started || !this.captureWebVitals) {
      return;
    }

    this.finaliseVitals();
  }

  /*
   * A single-page-app route change: the current view is closed and a new
   * one opened. Both URLs arrive already scrubbed. The closed view is
   * reported once INP_VIEW_SETTLE_MS has passed, which gives the
   * interaction that caused the navigation time to be delivered and
   * charged to it.
   */
  public noteRouteChange(fromUrl: string, toUrl: string): void {
    const current: InpView | undefined =
      this.inpViews[this.inpViews.length - 1];

    if (!this.started || !current) {
      return;
    }

    const now: number = this.nowMs();
    const count: number | null = this.readInteractionCount();

    current.url = current.url || fromUrl;
    current.endMs = now;
    current.countAtEnd = count;

    this.inpViews.push(this.createInpView(toUrl, "soft", now, count));

    while (this.inpViews.length - 1 > MAX_PENDING_INP_VIEWS) {
      this.reportInpView(this.inpViews.shift() as InpView);
    }

    this.armInpSettle();
  }

  /*
   * Called on session rotation: the rotated session cleared its trigger
   * and must be able to earn its own Performance trigger, so the emit
   * cap resets and a longtask observer disconnected AT the cap is
   * re-armed. LCP and the vitals stay latched — they are one number per
   * page LOAD, and a mid-life rotation does not produce a new contentful
   * paint.
   */
  public resetForNewSession(): void {
    this.emittedCount = 0;

    /* A prerendered page arms its observers once it is opened. */
    if (
      !this.started ||
      this.awaitingActivation ||
      this.longTaskObserver !== null ||
      this.options.longTaskBudgetMs <= 0 ||
      !this.windowRef
    ) {
      return;
    }

    const Observer: ObserverConstructor | null =
      PerformanceRecorder.getObserverConstructor(this.windowRef);

    if (
      Observer &&
      PerformanceRecorder.getSupportedEntryTypes(Observer).indexOf(
        LONGTASK_ENTRY,
      ) >= 0
    ) {
      this.longTaskObserver = PerformanceRecorder.tryObserve(
        Observer,
        LONGTASK_ENTRY,
        (entries: Array<PerformanceEntry>): void => {
          this.onLongTaskEntries(entries);
        },
      );
    }
  }

  /*
   * Called by the Recorder from the network completion path with the
   * ALREADY-SCRUBBED url. Failed requests are not re-reported here - the
   * 5xx/status-0 path is the error trigger's job; this one exists for the
   * request that succeeded slowly.
   */
  public noteRequest(atUnixMs: number, durationMs: number, url: string): void {
    const budget: number = this.options.slowRequestBudgetMs;

    if (budget <= 0 || durationMs < budget) {
      return;
    }

    this.report(atUnixMs, {
      kind: "slow-request",
      durationMs: Math.round(durationMs),
      budgetMs: budget,
      url: url,
    });
  }

  public getEmittedCount(): number {
    return this.emittedCount;
  }

  public getWebVitalCount(): number {
    return this.webVitalCount;
  }

  /* ---- Budget observers ---- */

  /*
   * LCP entries stream as larger candidates render; each entry's startTime
   * is the render time of the current LCP. The budget reports once per
   * page load, on the first candidate over budget - later, larger
   * candidates would only restate it. The vital keeps the LATEST candidate
   * and reports it when the browser stops issuing candidates (first input,
   * or the tab hides). The observer disconnects once neither job has
   * anything left to hear.
   *
   * Both read the same LCP, the web-vitals library's: counted from
   * activation for a prerendered page, and only for a paint made before
   * the page was first hidden - a page opened in a background tab paints
   * once it is shown, so its LCP would time the tab sitting unseen.
   */
  private onLcpEntries(entries: Array<PerformanceEntry>): void {
    if (!this.started) {
      return;
    }

    for (const entry of entries) {
      const renderTimeMs: number = entry.startTime;

      if (
        !Number.isFinite(renderTimeMs) ||
        renderTimeMs >= this.firstHiddenMs
      ) {
        continue;
      }

      const value: number = this.sinceActivation(renderTimeMs);
      const occurredAtUnixMs: number = this.toUnixMs(
        this.activationStartMs + value,
      );

      /* A restored page's LCP is its first frame back, not the load's. */
      if (
        this.captureWebVitals &&
        !this.reportedVitals["LCP"] &&
        this.restoreCount === 0
      ) {
        this.lcpCandidate = {
          valueMs: value,
          occurredAtUnixMs: occurredAtUnixMs,
        };
      }

      if (
        !this.hasReportedLcp &&
        this.options.lcpBudgetMs > 0 &&
        value >= this.options.lcpBudgetMs
      ) {
        this.hasReportedLcp = true;

        this.report(occurredAtUnixMs, {
          kind: "lcp",
          durationMs: Math.round(value),
          budgetMs: this.options.lcpBudgetMs,
          occurredAtUnixMs: occurredAtUnixMs,
        });
      }
    }

    this.releaseLcpObserverIfDone();
  }

  private onLongTaskEntries(entries: Array<PerformanceEntry>): void {
    if (!this.started) {
      return;
    }

    for (const entry of entries) {
      const duration: number = entry.duration;

      /*
       * A task that was over before the visitor opened a prerendered page
       * kept nobody waiting.
       */
      if (
        Number.isFinite(duration) &&
        duration >= this.options.longTaskBudgetMs &&
        !(entry.startTime + duration <= this.activationStartMs)
      ) {
        /*
         * A long task's startTime is when the main thread stalled; that,
         * not the batched delivery a frame or more later, is where the
         * viewer needs the marker.
         */
        const occurredAtUnixMs: number = Number.isFinite(entry.startTime)
          ? this.toUnixMs(entry.startTime)
          : Date.now();

        this.report(occurredAtUnixMs, {
          kind: "long-task",
          durationMs: Math.round(duration),
          budgetMs: this.options.longTaskBudgetMs,
          occurredAtUnixMs: occurredAtUnixMs,
        });
      }
    }
  }

  private report(atUnixMs: number, issue: PerformanceIssue): void {
    /*
     * The cap exists to bound the longtask/slow-request STREAMS. LCP is
     * exempt: hasReportedLcp already guarantees it fires at most once
     * per page load, and a jank-looping page that burned the cap before
     * its LCP settled would otherwise silently lose the page's single
     * most useful performance number.
     */
    if (issue.kind !== "lcp" && this.emittedCount >= MAX_PERFORMANCE_EVENTS) {
      /*
       * Cap reached: stop the unbounded source too, not just the emit.
       * The trigger has long since fired by this point.
       */
      this.longTaskObserver = PerformanceRecorder.disconnect(
        this.longTaskObserver,
      );

      return;
    }

    this.emittedCount++;

    this.options.emitCustomEvent(PERFORMANCE_CUSTOM_EVENT_TAG, issue);
    this.options.onIssue(atUnixMs, issue);
  }

  /* ---- Web vitals ---- */

  /*
   * TTFB comes from navigation timing, which is complete before any
   * script runs, so it is reported as soon as the page is the visitor's.
   * A responseStart of 0 is "not measured" (a synthetic document, a value
   * the browser withheld), not a 0 ms response, and is skipped rather than
   * reported as impossibly fast. A prerendered page counts from its
   * activation: a response that had arrived by the time the visitor opened
   * the page kept them waiting 0 ms, which is what web-vitals reports.
   */
  private reportTtfb(windowRef: Window): void {
    const responseStartMs: number | null =
      PerformanceRecorder.readResponseStart(windowRef);

    if (responseStartMs === null) {
      return;
    }

    const value: number = this.sinceActivation(responseStartMs);

    this.hasMeasuredTtfb = true;
    this.reportVital(
      "TTFB",
      value,
      this.toUnixMs(this.activationStartMs + value),
    );
  }

  /*
   * FCP, timed as onLcpEntries times LCP: from activation, and not at all
   * when the page was hidden before it painted.
   */
  private onPaintEntries(entries: Array<PerformanceEntry>): void {
    if (!this.started || this.restoreCount > 0) {
      return;
    }

    for (const entry of entries) {
      if (
        entry.name === "first-contentful-paint" &&
        Number.isFinite(entry.startTime)
      ) {
        this.paintObserver = PerformanceRecorder.disconnect(this.paintObserver);

        if (entry.startTime < this.firstHiddenMs) {
          const value: number = this.sinceActivation(entry.startTime);

          this.hasReportedLoadFcp = true;
          this.reportVital(
            "FCP",
            value,
            this.toUnixMs(this.activationStartMs + value),
          );
        }

        return;
      }
    }
  }

  private onLayoutShiftEntries(entries: Array<PerformanceEntry>): void {
    if (!this.started) {
      return;
    }

    for (const entry of entries) {
      const record: Record<string, unknown> = entry as unknown as Record<
        string,
        unknown
      >;
      const value: unknown = record["value"];
      const startTime: number = entry.startTime;

      /*
       * Shifts within 500ms of an input are expected (the user asked for
       * the layout to change) and excluded by the metric's definition.
       */
      if (
        record["hadRecentInput"] === true ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !Number.isFinite(startTime)
      ) {
        continue;
      }

      const continuesSession: boolean =
        this.clsSessionValue > 0 &&
        startTime - this.clsSessionLastMs < CLS_SESSION_GAP_MS &&
        startTime - this.clsSessionFirstMs < CLS_SESSION_MAX_MS;

      if (continuesSession) {
        this.clsSessionValue += value;
        this.clsSessionLastMs = startTime;
      } else {
        this.clsSessionValue = value;
        this.clsSessionFirstMs = startTime;
        this.clsSessionLastMs = startTime;
      }

      if (this.clsSessionValue > this.clsValue) {
        this.clsValue = this.clsSessionValue;
        this.clsOccurredAtMs = startTime;
      }
    }
  }

  /*
   * Each entry is one event of one interaction (a tap is pointerdown,
   * pointerup and click). They are merged by interactionId into the view
   * the interaction STARTED in - entry.startTime is the input's own
   * timestamp, so a click that called pushState is charged to the view it
   * was clicked on even though its entry arrives after the route change.
   */
  private onInteractionEntries(entries: Array<PerformanceEntry>): void {
    if (!this.started) {
      return;
    }

    for (const entry of entries) {
      const record: Record<string, unknown> = entry as unknown as Record<
        string,
        unknown
      >;
      let interactionId: unknown = record["interactionId"];

      /*
       * Event-timing also reports non-interaction events (mousemove,
       * hover) with interactionId 0; only discrete interactions count.
       * first-input entries predate interactionId and are one each.
       */
      if (!this.inpInteractionsRequireId) {
        interactionId = ++this.syntheticInteractionId;
      } else if (typeof interactionId !== "number" || interactionId <= 0) {
        continue;
      }

      const duration: number = entry.duration;
      const startTime: number = entry.startTime;

      if (!Number.isFinite(duration) || !Number.isFinite(startTime)) {
        continue;
      }

      const view: InpView | null = this.findInpView(startTime);

      if (view) {
        this.addInteraction(view, interactionId as number, entry, record);
      }
    }
  }

  private addInteraction(
    view: InpView,
    id: number,
    entry: PerformanceEntry,
    record: Record<string, unknown>,
  ): void {
    if (id !== view.lastInteractionId) {
      view.lastInteractionId = id;
      view.observedCount++;
    }

    const processingStart: number | null = PerformanceRecorder.finiteOrNull(
      record["processingStart"],
    );
    const processingEnd: number | null = PerformanceRecorder.finiteOrNull(
      record["processingEnd"],
    );
    let interaction: InpInteraction | undefined = view.longest.find(
      (candidate: InpInteraction): boolean => {
        return candidate.id === id;
      },
    );

    if (!interaction) {
      const slowestKept: InpInteraction | undefined =
        view.longest[INP_LONGEST_KEPT - 1];

      if (slowestKept && entry.duration <= slowestKept.latencyMs) {
        return;
      }

      interaction = {
        id: id,
        latencyMs: entry.duration,
        startTime: entry.startTime,
        processingStart: processingStart,
        processingEnd: processingEnd,
        nextPaintTime: entry.startTime + entry.duration,
        name: String(entry.name || ""),
        target: null,
      };
      view.longest.push(interaction);
    } else {
      if (entry.startTime < interaction.startTime) {
        interaction.startTime = entry.startTime;
        interaction.processingStart = processingStart;
      }

      if (
        processingEnd !== null &&
        (interaction.processingEnd === null ||
          processingEnd > interaction.processingEnd)
      ) {
        interaction.processingEnd = processingEnd;
      }

      if (entry.duration > interaction.latencyMs) {
        interaction.latencyMs = entry.duration;
        interaction.nextPaintTime = entry.startTime + entry.duration;
        interaction.name = String(entry.name || "");
      }
    }

    interaction.target =
      interaction.target ||
      PerformanceRecorder.asElement(record["target"]) ||
      this.recallTarget(entry.startTime);

    view.longest.sort((a: InpInteraction, b: InpInteraction): number => {
      return b.latencyMs - a.latencyMs;
    });
    view.longest.length = Math.min(view.longest.length, INP_LONGEST_KEPT);
  }

  /* The newest view that had begun when the interaction started. */
  private findInpView(startTime: number): InpView | null {
    for (let index: number = this.inpViews.length - 1; index >= 0; index--) {
      const view: InpView = this.inpViews[index] as InpView;

      if (startTime >= view.startMs) {
        return view;
      }
    }

    /* Older than every view still open: its view was already reported. */
    return null;
  }

  private createInpView(
    url: string | null,
    navigationType: SessionReplayNavigationType,
    startMs: number,
    countAtStart: number | null,
  ): InpView {
    return {
      url: url,
      navigationType: navigationType,
      startMs: startMs,
      endMs: null,
      countAtStart: countAtStart,
      countAtEnd: null,
      observedCount: 0,
      lastInteractionId: 0,
      longest: [],
      reportedId: null,
      reportedLatencyMs: null,
      deferred: false,
    };
  }

  /*
   * The view's INP: its slowest interaction, less one outlier for every
   * fifty interactions (web-vitals' p98). The engine's interactionCount
   * counts the fast interactions event timing never delivers; without it
   * the observed count errs towards the slower number.
   */
  private inpCandidate(view: InpView): InpInteraction | null {
    if (view.longest.length === 0) {
      return null;
    }

    let count: number = view.observedCount;
    const endCount: number | null =
      view.endMs === null ? this.readInteractionCount() : view.countAtEnd;

    if (view.countAtStart !== null && endCount !== null) {
      count = Math.max(count, endCount - view.countAtStart);
    }

    const index: number = Math.min(
      view.longest.length - 1,
      Math.floor(count / INTERACTIONS_PER_SKIPPED_OUTLIER),
    );

    return view.longest[index] || null;
  }

  private reportInpView(view: InpView): void {
    const interaction: InpInteraction | null = this.inpCandidate(view);

    if (
      !interaction ||
      (view.reportedId === interaction.id &&
        view.reportedLatencyMs === interaction.latencyMs) ||
      this.inpReportCount >= MAX_INP_REPORTS
    ) {
      return;
    }

    view.reportedId = interaction.id;
    view.reportedLatencyMs = interaction.latencyMs;
    this.inpReportCount++;

    const value: number = Math.round(interaction.latencyMs);
    const event: WebVitalEvent = {
      kind: "web-vital",
      metric: "INP",
      value: value,
      rating: rateWebVital("INP", value),
      occurredAtUnixMs: this.toUnixMs(interaction.startTime),
      navigationType: view.navigationType,
    };

    const url: string | null = view.url || this.readCurrentUrl();

    if (url) {
      view.url = url;
      event.url = url;
    }

    const interactionType: SessionReplayInteractionType | null =
      PerformanceRecorder.classifyInteraction(interaction.name);

    if (interactionType) {
      event.interactionType = interactionType;
    }

    const target: string = this.describeTarget(interaction.target);

    if (target) {
      event.interactionTarget = target;
    }

    if (
      interaction.processingStart !== null &&
      interaction.processingEnd !== null
    ) {
      event.inputDelayMs = Math.round(
        Math.max(0, interaction.processingStart - interaction.startTime),
      );
      event.processingDurationMs = Math.round(
        Math.max(0, interaction.processingEnd - interaction.processingStart),
      );
      event.presentationDelayMs = Math.round(
        Math.max(0, interaction.nextPaintTime - interaction.processingEnd),
      );
    }

    this.emitWebVital(event);
  }

  /*
   * Reports every closed view that has settled. If the timer fired late
   * the main thread was busy - quite possibly still inside the handler
   * that navigated - so each view gets one more period before its INP is
   * taken as final.
   */
  private onInpSettle(armedAtMs: number): void {
    this.drainInteractionRecords();

    const now: number = this.nowMs();
    const blocked: boolean = now - armedAtMs > 2 * INP_VIEW_SETTLE_MS;
    const current: InpView | undefined = this.inpViews.pop();
    const waiting: Array<InpView> = [];

    for (const view of this.inpViews) {
      const settled: boolean =
        view.endMs !== null && now - view.endMs >= INP_VIEW_SETTLE_MS;

      if (settled && (view.deferred || !blocked)) {
        this.reportInpView(view);
      } else {
        view.deferred = view.deferred || blocked;
        waiting.push(view);
      }
    }

    this.inpViews = current ? [...waiting, current] : waiting;

    if (waiting.length > 0) {
      this.armInpSettle();
    }
  }

  private armInpSettle(): void {
    if (this.inpSettleTimer !== null) {
      return;
    }

    const armedAtMs: number = this.nowMs();

    this.inpSettleTimer = setTimeout((): void => {
      this.inpSettleTimer = null;

      if (this.started) {
        this.onInpSettle(armedAtMs);
      }
    }, INP_VIEW_SETTLE_MS);
  }

  private cancelInpSettle(): void {
    if (this.inpSettleTimer !== null) {
      clearTimeout(this.inpSettleTimer);
      this.inpSettleTimer = null;
    }
  }

  /*
   * The page is going away (or the recorder stopping): every view is
   * final now. Entries the engine has queued but not yet delivered are
   * pulled in first, so the interaction that hid the tab still counts.
   * The current view stays open - a tab that comes back keeps adding to
   * it, and is reported again only if its INP changes.
   */
  private finaliseInp(): void {
    this.drainInteractionRecords();
    this.cancelInpSettle();

    for (const view of this.inpViews) {
      this.reportInpView(view);
    }

    this.inpViews = this.inpViews.slice(-1);
  }

  private drainInteractionRecords(): void {
    for (const observer of [
      this.interactionObserver,
      this.firstInputObserver,
    ]) {
      this.drainRecords(observer, (entries: Array<PerformanceEntry>): void => {
        this.onInteractionEntries(entries);
      });
    }
  }

  /* Entries the engine has queued for an observer but not yet delivered. */
  private drainRecords(
    observer: ObserverLike | null,
    onEntries: (entries: Array<PerformanceEntry>) => void,
  ): void {
    if (!observer || typeof observer.takeRecords !== "function") {
      return;
    }

    try {
      onEntries(observer.takeRecords());
    } catch {
      /* Nothing queued we can read. */
    }
  }

  private recallTarget(startTime: number): Element | null {
    for (const recent of this.recentTargets) {
      if (recent && Math.abs(recent.timeStamp - startTime) < 1) {
        return PerformanceRecorder.asElement(recent.target);
      }
    }

    return null;
  }

  private describeTarget(target: Element | null): string {
    if (!target || !this.options.describeTarget) {
      return "";
    }

    try {
      return this.options.describeTarget(target);
    } catch {
      return "";
    }
  }

  private readCurrentUrl(): string | null {
    try {
      return this.options.getCurrentUrl ? this.options.getCurrentUrl() : null;
    } catch {
      return null;
    }
  }

  /*
   * Only pointer and keyboard events carry an interactionId (and
   * first-input is one of them too), so anything that is not a key event
   * was a pointer.
   */
  private static classifyInteraction(
    name: string,
  ): SessionReplayInteractionType | null {
    if (!name) {
      return null;
    }

    return name.indexOf("key") === 0 ? "keyboard" : "pointer";
  }

  private static asElement(value: unknown): Element | null {
    return typeof Element !== "undefined" && value instanceof Element
      ? value
      : null;
  }

  private static finiteOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private reportVital(
    metric: SessionReplayWebVitalMetric,
    value: number,
    occurredAtUnixMs: number,
  ): void {
    if (
      !this.captureWebVitals ||
      this.reportedVitals[metric] ||
      !Number.isFinite(value)
    ) {
      return;
    }

    this.reportedVitals[metric] = true;

    /* CLS keeps its precision; the millisecond metrics are whole numbers. */
    const rounded: number =
      metric === "CLS" ? Math.round(value * 10000) / 10000 : Math.round(value);

    this.emitWebVital({
      kind: "web-vital",
      metric: metric,
      value: rounded,
      rating: rateWebVital(metric, rounded),
      occurredAtUnixMs: occurredAtUnixMs,
      navigationType: this.navigationType,
    });
  }

  private emitWebVital(event: WebVitalEvent): void {
    this.webVitalCount++;

    /* Never onIssue: a vital is information, not a reason to upload. */
    this.options.emitCustomEvent(PERFORMANCE_CUSTOM_EVENT_TAG, event);
  }

  private finaliseLcp(): void {
    const candidate: LcpCandidate | null = this.lcpCandidate;

    if (candidate !== null && !this.reportedVitals["LCP"]) {
      this.reportVital("LCP", candidate.valueMs, candidate.occurredAtUnixMs);
    }

    this.releaseLcpObserverIfDone();

    if (this.windowRef) {
      this.removeInputListeners(this.windowRef);
    }
  }

  /*
   * The page-lifetime vitals (LCP, CLS) and the open views' INP are final
   * only when the page stops: the tab hides, the page unloads, or the
   * recorder stops. Each event still carries the moment it HAPPENED, so
   * the player can draw the largest shift where it shifted rather than at
   * the end.
   */
  private finaliseVitals(): void {
    /* An FCP the observer has not delivered yet happened all the same. */
    this.drainRecords(
      this.paintObserver,
      (entries: Array<PerformanceEntry>): void => {
        this.onPaintEntries(entries);
      },
    );
    this.finaliseLcp();

    /*
     * Only for a page whose FCP was reported, as web-vitals and CrUX
     * report CLS: a page that loaded hidden has neither.
     */
    if (this.clsObserved && this.hasReportedLoadFcp) {
      this.reportVital(
        "CLS",
        this.clsValue,
        this.clsValue > 0 ? this.toUnixMs(this.clsOccurredAtMs) : Date.now(),
      );
    }

    this.finaliseInp();
  }

  private onLifecycle(event: Event): void {
    const isHidden: boolean = PerformanceRecorder.isHidden(this.windowRef);

    if (event.type === "visibilitychange" && isHidden) {
      /* The first hide is where the page's paints stop counting. */
      if (!Number.isFinite(this.firstHiddenMs)) {
        this.firstHiddenMs = this.eventTimeMs(event);
      }

      this.finaliseVitals();
    } else if (event.type === "pagehide") {
      this.finaliseVitals();
    }
  }

  /*
   * When an event happened on the performance clock: its timeStamp, which
   * is exactly that in every engine this records - unless it is plainly
   * not (an engine that stamps the wall clock), when now is the best
   * answer, the listener running as the event is dispatched.
   */
  private eventTimeMs(event: Event): number {
    const now: number = this.nowMs();
    const stamp: number = event.timeStamp;

    return Number.isFinite(stamp) && stamp >= 0 && stamp <= now ? stamp : now;
  }

  /* A paint or response time, counted from when the visitor opened the page. */
  private sinceActivation(performanceTimeMs: number): number {
    return Math.max(performanceTimeMs - this.activationStartMs, 0);
  }

  /*
   * Runs the callback two frames from now, as web-vitals waits after a
   * restore: the first frame is the one the restored page is painted in.
   * Nothing is measured where the engine draws no frames to wait for.
   */
  private afterNextFrame(callback: () => void): void {
    const windowRef: Window | null = this.windowRef;
    const requestFrame: unknown = windowRef
      ? (windowRef as unknown as Record<string, unknown>)[
          "requestAnimationFrame"
        ]
      : null;

    if (typeof requestFrame !== "function") {
      return;
    }

    const next: (frameCallback: () => void) => void = (
      frameCallback: () => void,
    ): void => {
      (requestFrame as (cb: () => void) => number).call(windowRef, (): void => {
        try {
          frameCallback();
        } catch {
          /* Never throw into the host page's frame. */
        }
      });
    };

    try {
      next((): void => {
        next(callback);
      });
    } catch {
      /* No frame, no restore timings. */
    }
  }

  private releaseLcpObserverIfDone(): void {
    const budgetDone: boolean =
      this.options.lcpBudgetMs <= 0 || this.hasReportedLcp;
    const vitalDone: boolean =
      !this.captureWebVitals || this.reportedVitals["LCP"] === true;

    if (budgetDone && vitalDone) {
      this.lcpObserver = PerformanceRecorder.disconnect(this.lcpObserver);
    }
  }

  /* ---- Listeners ---- */

  private addLifecycleListeners(windowRef: Window): void {
    try {
      /*
       * Capture phase, so the vitals are in the stream BEFORE the
       * Recorder's own bubble-phase visibilitychange listener flushes the
       * chunk - otherwise the page's CLS would ride on a chunk that may
       * never get sent.
       */
      windowRef.document.addEventListener(
        "visibilitychange",
        this.lifecycleListener,
        true,
      );
      windowRef.addEventListener("pagehide", this.lifecycleListener, true);

      for (const type of LCP_FINALISING_INPUTS) {
        windowRef.document.addEventListener(type, this.inputListener, true);
      }
    } catch {
      /* A document that refuses listeners simply never finalises early. */
    }
  }

  private removeLifecycleListeners(windowRef: Window): void {
    try {
      windowRef.document.removeEventListener(
        "visibilitychange",
        this.lifecycleListener,
        true,
      );
      windowRef.removeEventListener("pagehide", this.lifecycleListener, true);

      for (const type of INTERACTION_TARGET_EVENTS) {
        windowRef.document.removeEventListener(type, this.targetListener, true);
      }
    } catch {
      /* Already gone. */
    }

    this.recentTargets = [];
    this.removeInputListeners(windowRef);
  }

  private addTargetListeners(windowRef: Window): void {
    try {
      for (const type of INTERACTION_TARGET_EVENTS) {
        windowRef.document.addEventListener(type, this.targetListener, true);
      }
    } catch {
      /* Targets then come from the entries alone. */
    }
  }

  private removeInputListeners(windowRef: Window): void {
    try {
      for (const type of LCP_FINALISING_INPUTS) {
        windowRef.document.removeEventListener(type, this.inputListener, true);
      }
    } catch {
      /* Already gone. */
    }
  }

  private removeActivationListener(windowRef: Window): void {
    try {
      windowRef.document.removeEventListener(
        PRERENDERING_CHANGE_EVENT,
        this.activationListener,
        true,
      );
    } catch {
      /* Already gone. */
    }
  }

  /* ---- Clock ---- */

  private toUnixMs(performanceTimeMs: number): number {
    return Math.round(this.timeOriginMs + performanceTimeMs);
  }

  /* performance.now(), or its reconstruction from the wall clock. */
  private nowMs(): number {
    try {
      const now: number | null = PerformanceRecorder.finiteOrNull(
        (this.windowRef as Window).performance.now(),
      );

      if (now !== null) {
        return now;
      }
    } catch {
      /* Fall through to the wall clock. */
    }

    return Date.now() - this.timeOriginMs;
  }

  /* performance.interactionCount (Chromium), or null where absent. */
  private readInteractionCount(): number | null {
    try {
      return PerformanceRecorder.finiteOrNull(
        (
          (this.windowRef as Window).performance as unknown as Record<
            string,
            unknown
          >
        )["interactionCount"],
      );
    } catch {
      return null;
    }
  }

  /*
   * performance.timeOrigin is the modern answer; performance.timing.
   * navigationStart the legacy one; and failing both, "now minus
   * performance.now()" reconstructs it to within a millisecond.
   */
  private static readTimeOrigin(windowRef: Window): number {
    const perf: Record<string, unknown> | null =
      PerformanceRecorder.readPerformance(windowRef);

    if (!perf) {
      return Date.now();
    }

    const timeOrigin: unknown = perf["timeOrigin"];

    if (
      typeof timeOrigin === "number" &&
      Number.isFinite(timeOrigin) &&
      timeOrigin > 0
    ) {
      return timeOrigin;
    }

    const timing: unknown = perf["timing"];

    if (timing && typeof timing === "object") {
      const navigationStart: unknown = (timing as Record<string, unknown>)[
        "navigationStart"
      ];

      if (
        typeof navigationStart === "number" &&
        Number.isFinite(navigationStart) &&
        navigationStart > 0
      ) {
        return navigationStart;
      }
    }

    const now: unknown = perf["now"];

    try {
      if (typeof now === "function") {
        const elapsed: unknown = (now as () => unknown).call(perf);

        if (typeof elapsed === "number" && Number.isFinite(elapsed)) {
          return Date.now() - elapsed;
        }
      }
    } catch {
      /* A performance object that throws is treated as absent. */
    }

    return Date.now();
  }

  /*
   * performance.getEntriesByType(type), or null where the engine has no
   * performance timeline at all.
   */
  private static readEntries(
    windowRef: Window | null,
    type: string,
  ): Array<Record<string, unknown>> | null {
    const perf: Record<string, unknown> | null = windowRef
      ? PerformanceRecorder.readPerformance(windowRef)
      : null;

    try {
      const getEntriesByType: unknown = perf ? perf["getEntriesByType"] : null;

      if (typeof getEntriesByType !== "function") {
        return null;
      }

      const entries: unknown = (
        getEntriesByType as (entryType: string) => unknown
      ).call(perf, type);

      return Array.isArray(entries)
        ? entries.filter((entry: unknown): boolean => {
            return Boolean(entry) && typeof entry === "object";
          })
        : null;
    } catch {
      /* A timeline that throws is no timeline. */
      return null;
    }
  }

  /*
   * The page's navigation entry, when it can be trusted - web-vitals'
   * getNavigationEntry rule: a responseStart of 0 is a value the browser
   * withheld, and one past now() is a browser bug, and either way nothing
   * in the entry is relied on. undefined where the engine has no
   * navigation timing at all; null where it has, but not usable.
   */
  private static readNavigationEntry(
    windowRef: Window | null,
  ): Record<string, unknown> | null | undefined {
    const entries: Array<Record<string, unknown>> | null =
      PerformanceRecorder.readEntries(windowRef, NAVIGATION_ENTRY);

    if (!entries || entries.length === 0) {
      return undefined;
    }

    const entry: Record<string, unknown> = entries[0] as Record<
      string,
      unknown
    >;
    const responseStart: unknown = entry["responseStart"];
    let now: number = Infinity;

    try {
      now = windowRef ? windowRef.performance.now() : Infinity;
    } catch {
      /* No clock to hold it to. */
    }

    return typeof responseStart === "number" &&
      Number.isFinite(responseStart) &&
      responseStart > 0 &&
      !(responseStart >= now)
      ? entry
      : null;
  }

  /*
   * When the visitor opened a prerendered page, on the performance clock;
   * 0 for a page that was not prerendered, and wherever the engine does
   * not say (the same answer web-vitals' getActivationStart gives).
   */
  private static readActivationStart(windowRef: Window): number {
    const entry: Record<string, unknown> | null | undefined =
      PerformanceRecorder.readNavigationEntry(windowRef);
    const activationStart: unknown = entry ? entry["activationStart"] : 0;

    return typeof activationStart === "number" &&
      Number.isFinite(activationStart) &&
      activationStart > 0
      ? activationStart
      : 0;
  }

  /*
   * When the page was first hidden since it was opened, on the
   * performance clock; Infinity if it has not been. The engine's own
   * visibility history first (Chromium's visibility-state entries, which
   * know about a hide before this script ran), then the page as it is
   * now: one hidden at this point is taken to have been hidden all along,
   * a page opened in a background tab. web-vitals reads it the same way.
   */
  private static readFirstHiddenTime(
    windowRef: Window,
    activationStartMs: number,
  ): number {
    const entries: Array<Record<string, unknown>> =
      PerformanceRecorder.readEntries(windowRef, VISIBILITY_STATE_ENTRY) || [];

    for (const entry of entries) {
      const startTime: unknown = entry["startTime"];

      if (
        entry["name"] === "hidden" &&
        typeof startTime === "number" &&
        startTime >= activationStartMs
      ) {
        return startTime;
      }
    }

    return PerformanceRecorder.isHidden(windowRef) ? 0 : Infinity;
  }

  private static isPrerendering(windowRef: Window): boolean {
    try {
      return (
        (windowRef.document as unknown as Record<string, unknown>)[
          "prerendering"
        ] === true
      );
    } catch {
      return false;
    }
  }

  private static isHidden(windowRef: Window | null): boolean {
    try {
      return windowRef?.document.visibilityState === "hidden";
    } catch {
      return false;
    }
  }

  /*
   * responseStart relative to navigation start, or null when the browser
   * did not measure one. Level 2 navigation timing first, legacy
   * performance.timing second.
   */
  private static readResponseStart(windowRef: Window): number | null {
    const perf: Record<string, unknown> | null =
      PerformanceRecorder.readPerformance(windowRef);

    if (!perf) {
      return null;
    }

    try {
      const entry: Record<string, unknown> | null | undefined =
        PerformanceRecorder.readNavigationEntry(windowRef);

      if (entry !== undefined) {
        return entry ? (entry["responseStart"] as number) : null;
      }

      const timing: unknown = perf["timing"];

      if (timing && typeof timing === "object") {
        const legacy: Record<string, unknown> = timing as Record<
          string,
          unknown
        >;
        const responseStart: unknown = legacy["responseStart"];
        const navigationStart: unknown = legacy["navigationStart"];

        if (
          typeof responseStart === "number" &&
          typeof navigationStart === "number" &&
          responseStart > navigationStart &&
          navigationStart > 0
        ) {
          return responseStart - navigationStart;
        }
      }
    } catch {
      /* Unreadable timing is unmeasured timing. */
    }

    return null;
  }

  private static readPerformance(
    windowRef: Window,
  ): Record<string, unknown> | null {
    const candidate: unknown = (
      windowRef as unknown as Record<string, unknown>
    )["performance"];

    return candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : null;
  }

  /*
   * ---- Observer plumbing ----
   *
   * Every entry handler above checks `started` first: disconnect() does
   * not cancel a batch already queued for delivery in some engines, and a
   * stopped recorder must not report into a stream nobody is flushing.
   */

  private static disconnect(observer: ObserverLike | null): null {
    if (observer) {
      try {
        observer.disconnect();
      } catch {
        /* Already dead. */
      }
    }

    return null;
  }

  private static getObserverConstructor(
    windowRef: Window,
  ): ObserverConstructor | null {
    const candidate: unknown = (
      windowRef as unknown as Record<string, unknown>
    )["PerformanceObserver"];

    return typeof candidate === "function"
      ? (candidate as unknown as ObserverConstructor)
      : null;
  }

  private static getSupportedEntryTypes(
    Observer: ObserverConstructor,
  ): Array<string> {
    const supported: unknown = (Observer as unknown as Record<string, unknown>)[
      "supportedEntryTypes"
    ];

    if (!Array.isArray(supported)) {
      return [];
    }

    return supported.filter((entry: unknown): entry is string => {
      return typeof entry === "string";
    });
  }

  /*
   * observe() throws on unknown entry types in some engines even when the
   * type appears in supportedEntryTypes lookalikes; buffered:true replays
   * entries from before the recorder booted, which for LCP is the whole
   * point (it usually lands before our config round trip finishes).
   */
  private static tryObserve(
    Observer: ObserverConstructor,
    entryType: string,
    onEntries: (entries: Array<PerformanceEntry>) => void,
    extraOptions?: Record<string, unknown>,
  ): ObserverLike | null {
    try {
      const observer: ObserverLike = new Observer(
        (list: { getEntries: () => Array<PerformanceEntry> }): void => {
          try {
            onEntries(list.getEntries());
          } catch {
            /* An entry we cannot read is an entry we do not report. */
          }
        },
      );

      observer.observe({ ...extraOptions, type: entryType, buffered: true });

      return observer;
    } catch {
      return null;
    }
  }
}
