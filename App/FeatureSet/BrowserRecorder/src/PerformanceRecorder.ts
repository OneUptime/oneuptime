/*
 * Performance-budget observation: LCP and main-thread long tasks via
 * PerformanceObserver, plus slow instrumented requests reported in by the
 * Recorder (the network side already lives in NetworkRecorder; observing
 * resource timings here too would double-count every fetch).
 *
 * A budget of 0 means that trigger is OFF, and every observer is feature-
 * detected and try/caught: this module runs on other people's pages, where
 * "browser without longtask support" is normal and an exception is a bug
 * we caused. Nothing here reads page content — payloads carry timings and
 * an already-scrubbed URL only.
 */

export const PERFORMANCE_CUSTOM_EVENT_TAG: string = "oneuptime.performance";

/*
 * Cap on emitted performance events per page load. A page that jank-loops
 * produces an unbounded longtask stream, and 500 identical "the main
 * thread stalled" rows make a worse recording than 50 do.
 */
export const MAX_PERFORMANCE_EVENTS: number = 50;

export type PerformanceIssueKind = "lcp" | "long-task" | "slow-request";

export interface PerformanceIssue {
  kind: PerformanceIssueKind;

  /* For lcp this is the render time from navigation start. */
  durationMs: number;

  /* The budget that was exceeded, so playback can show both numbers. */
  budgetMs: number;

  /* Scrubbed URL for slow-request; absent otherwise. */
  url?: string;
}

export interface PerformanceRecorderOptions {
  emitCustomEvent: (tag: string, payload: unknown) => void;

  /* Fires for every recorded issue; the Recorder turns this into a trigger. */
  onIssue: (atUnixMs: number, issue: PerformanceIssue) => void;

  /* Milliseconds; 0 disables the corresponding observer/check. */
  lcpBudgetMs: number;
  longTaskBudgetMs: number;
  slowRequestBudgetMs: number;
}

type ObserverLike = {
  observe: (options: Record<string, unknown>) => void;
  disconnect: () => void;
};

type ObserverConstructor = new (
  callback: (list: { getEntries: () => Array<PerformanceEntry> }) => void,
) => ObserverLike;

export default class PerformanceRecorder {
  private readonly options: PerformanceRecorderOptions;

  private started: boolean = false;
  private emittedCount: number = 0;

  /* LCP reports once - it is one number per page load, not a stream. */
  private hasReportedLcp: boolean = false;

  private lcpObserver: ObserverLike | null = null;
  private longTaskObserver: ObserverLike | null = null;

  /* Remembered from start() so resetForNewSession can re-arm observers. */
  private windowRef: Window | null = null;

  public constructor(options: PerformanceRecorderOptions) {
    this.options = options;
  }

  public start(windowRef: Window = window): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.windowRef = windowRef;

    const Observer: ObserverConstructor | null =
      PerformanceRecorder.getObserverConstructor(windowRef);

    if (!Observer) {
      return;
    }

    const supported: Array<string> =
      PerformanceRecorder.getSupportedEntryTypes(Observer);

    if (
      this.options.lcpBudgetMs > 0 &&
      supported.indexOf("largest-contentful-paint") >= 0
    ) {
      this.lcpObserver = PerformanceRecorder.tryObserve(
        Observer,
        "largest-contentful-paint",
        (entries: Array<PerformanceEntry>): void => {
          this.onLcpEntries(entries);
        },
      );
    }

    if (
      this.options.longTaskBudgetMs > 0 &&
      supported.indexOf("longtask") >= 0
    ) {
      this.longTaskObserver = PerformanceRecorder.tryObserve(
        Observer,
        "longtask",
        (entries: Array<PerformanceEntry>): void => {
          this.onLongTaskEntries(entries);
        },
      );
    }
  }

  public stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    if (this.lcpObserver) {
      try {
        this.lcpObserver.disconnect();
      } catch {
        /* Already dead. */
      }
      this.lcpObserver = null;
    }

    if (this.longTaskObserver) {
      try {
        this.longTaskObserver.disconnect();
      } catch {
        /* Already dead. */
      }
      this.longTaskObserver = null;
    }
  }

  /*
   * Called on session rotation: the rotated session cleared its trigger
   * and must be able to earn its own Performance trigger, so the emit
   * cap resets and a longtask observer disconnected AT the cap is
   * re-armed. LCP stays latched — it is one number per page LOAD, and a
   * mid-life rotation does not produce a new contentful paint.
   */
  public resetForNewSession(): void {
    this.emittedCount = 0;

    if (
      !this.started ||
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
        "longtask",
      ) >= 0
    ) {
      this.longTaskObserver = PerformanceRecorder.tryObserve(
        Observer,
        "longtask",
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

  /*
   * LCP entries stream as larger candidates render; each entry's startTime
   * is the current LCP value. One report per page load, on the first
   * candidate over budget - later, larger candidates would only restate it,
   * and the observer has nothing further to say, so it disconnects.
   */
  private onLcpEntries(entries: Array<PerformanceEntry>): void {
    if (this.hasReportedLcp) {
      return;
    }

    for (const entry of entries) {
      const value: number = entry.startTime;

      if (Number.isFinite(value) && value >= this.options.lcpBudgetMs) {
        this.hasReportedLcp = true;

        this.report(Date.now(), {
          kind: "lcp",
          durationMs: Math.round(value),
          budgetMs: this.options.lcpBudgetMs,
        });

        if (this.lcpObserver) {
          try {
            this.lcpObserver.disconnect();
          } catch {
            /* Nothing to release. */
          }
          this.lcpObserver = null;
        }

        return;
      }
    }
  }

  private onLongTaskEntries(entries: Array<PerformanceEntry>): void {
    for (const entry of entries) {
      const duration: number = entry.duration;

      if (
        Number.isFinite(duration) &&
        duration >= this.options.longTaskBudgetMs
      ) {
        this.report(Date.now(), {
          kind: "long-task",
          durationMs: Math.round(duration),
          budgetMs: this.options.longTaskBudgetMs,
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
      if (this.longTaskObserver) {
        try {
          this.longTaskObserver.disconnect();
        } catch {
          /* Nothing to release. */
        }
        this.longTaskObserver = null;
      }

      return;
    }

    this.emittedCount++;

    this.options.emitCustomEvent(PERFORMANCE_CUSTOM_EVENT_TAG, issue);
    this.options.onIssue(atUnixMs, issue);
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

      observer.observe({ type: entryType, buffered: true });

      return observer;
    } catch {
      return null;
    }
  }
}
