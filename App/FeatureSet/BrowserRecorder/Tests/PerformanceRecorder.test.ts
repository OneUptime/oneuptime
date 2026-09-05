import {
  SessionReplayCustomEventTag,
  SessionReplayWebVitalMetric,
  isSessionReplayWebVitalPayload,
} from "Common/Types/Rum/SessionReplayCustomEvents";
import PerformanceRecorder, {
  INP_DURATION_THRESHOLD_MS,
  MAX_PERFORMANCE_EVENTS,
  PERFORMANCE_CUSTOM_EVENT_TAG,
  PerformanceIssue,
  WEB_VITAL_THRESHOLDS,
  WebVitalEvent,
  rateWebVital,
} from "../src/PerformanceRecorder";

/*
 * A controllable PerformanceObserver stand-in. jsdom has no
 * PerformanceObserver at all, which is itself the first case worth
 * testing - the recorder must survive a browser without one.
 */

type EntriesCallback = (list: {
  getEntries: () => Array<PerformanceEntry>;
}) => void;

interface FakeObserverHandle {
  entryType: string | null;
  buffered: boolean | null;
  observeOptions: Record<string, unknown> | null;
  isDisconnected: boolean;
  emit: (entries: Array<Record<string, unknown>>) => void;
}

function installFakeObserver(
  windowRef: Window,
  supportedEntryTypes: Array<string>,
): Array<FakeObserverHandle> {
  const handles: Array<FakeObserverHandle> = [];

  class FakePerformanceObserver {
    private readonly callback: EntriesCallback;
    private readonly handle: FakeObserverHandle;

    public static supportedEntryTypes: Array<string> = supportedEntryTypes;

    public constructor(callback: EntriesCallback) {
      this.callback = callback;

      this.handle = {
        entryType: null,
        buffered: null,
        observeOptions: null,
        isDisconnected: false,
        emit: (entries: Array<Record<string, unknown>>): void => {
          this.callback({
            getEntries: (): Array<PerformanceEntry> => {
              return entries as unknown as Array<PerformanceEntry>;
            },
          });
        },
      };

      handles.push(this.handle);
    }

    public observe(options: Record<string, unknown>): void {
      this.handle.entryType = String(options["type"]);
      this.handle.buffered = options["buffered"] === true;
      this.handle.observeOptions = options;
    }

    public disconnect(): void {
      this.handle.isDisconnected = true;
    }
  }

  (windowRef as unknown as Record<string, unknown>)["PerformanceObserver"] =
    FakePerformanceObserver;

  return handles;
}

function removeObserver(windowRef: Window): void {
  delete (windowRef as unknown as Record<string, unknown>)[
    "PerformanceObserver"
  ];
}

function handleFor(
  handles: Array<FakeObserverHandle>,
  entryType: string,
): FakeObserverHandle | undefined {
  return handles.find((handle: FakeObserverHandle): boolean => {
    return handle.entryType === entryType;
  });
}

/* The wall-clock the recorder must stamp a performance-timeline entry with. */
function atOrigin(performanceTimeMs: number): number {
  return Math.round(window.performance.timeOrigin + performanceTimeMs);
}

/*
 * A window whose `performance` is entirely under the test's control, for
 * the navigation-timing (TTFB) and clock cases. Listeners go to the real
 * document so lifecycle events can still be dispatched.
 */
function windowWithPerformance(performance: Record<string, unknown>): Window {
  const fake: Record<string, unknown> = {
    document: document,
    performance: performance,
    addEventListener: (type: string, listener: EventListener): void => {
      window.addEventListener(type, listener);
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      window.removeEventListener(type, listener);
    },
  };

  return fake as unknown as Window;
}

const ALL_ENTRY_TYPES: Array<string> = [
  "largest-contentful-paint",
  "longtask",
  "paint",
  "layout-shift",
  "event",
  "first-input",
];

describe("PerformanceRecorder", (): void => {
  let issues: Array<PerformanceIssue> = [];
  let issueTimes: Array<number> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let recorder: PerformanceRecorder;

  const makeRecorder: (budgets: {
    lcp?: number;
    longTask?: number;
    slowRequest?: number;
    webVitals?: boolean;
  }) => PerformanceRecorder = (budgets: {
    lcp?: number;
    longTask?: number;
    slowRequest?: number;
    webVitals?: boolean;
  }): PerformanceRecorder => {
    issues = [];
    issueTimes = [];
    customEvents = [];

    const options: {
      emitCustomEvent: (tag: string, payload: unknown) => void;
      onIssue: (atUnixMs: number, issue: PerformanceIssue) => void;
      lcpBudgetMs: number;
      longTaskBudgetMs: number;
      slowRequestBudgetMs: number;
      captureWebVitals?: boolean;
    } = {
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      onIssue: (atUnixMs: number, issue: PerformanceIssue): void => {
        issues.push(issue);
        issueTimes.push(atUnixMs);
      },
      lcpBudgetMs: budgets.lcp || 0,
      longTaskBudgetMs: budgets.longTask || 0,
      slowRequestBudgetMs: budgets.slowRequest || 0,
    };

    if (budgets.webVitals !== undefined) {
      options.captureWebVitals = budgets.webVitals;
    }

    return new PerformanceRecorder(options);
  };

  function vitals(): Array<WebVitalEvent> {
    return customEvents
      .map((event: { tag: string; payload: unknown }): unknown => {
        return event.payload;
      })
      .filter((payload: unknown): payload is WebVitalEvent => {
        return isSessionReplayWebVitalPayload(payload);
      });
  }

  function vital(metric: SessionReplayWebVitalMetric): WebVitalEvent | null {
    return (
      vitals().find((event: WebVitalEvent): boolean => {
        return event.metric === metric;
      }) || null
    );
  }

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
    }

    removeObserver(window);
    jest.restoreAllMocks();
  });

  it("emits under the shared custom-event tag, not a private spelling", (): void => {
    expect(PERFORMANCE_CUSTOM_EVENT_TAG).toBe(
      SessionReplayCustomEventTag.Performance,
    );
  });

  it("survives a browser with no PerformanceObserver at all", (): void => {
    recorder = makeRecorder({ lcp: 1000, longTask: 100 });

    expect((): void => {
      recorder.start(window);
      recorder.stop();
    }).not.toThrow();

    expect(issues).toHaveLength(0);
  });

  it("creates no observers while every budget is 0 and vitals are off", (): void => {
    const handles: Array<FakeObserverHandle> = installFakeObserver(
      window,
      ALL_ENTRY_TYPES,
    );

    recorder = makeRecorder({ webVitals: false });
    recorder.start(window);

    expect(handles).toHaveLength(0);
  });

  /*
   * The product wants vitals on every recording, budgets or not: a fresh
   * install with no budgets configured used to capture no performance
   * data whatsoever.
   */
  it("arms the vital observers by default with every budget 0", (): void => {
    const handles: Array<FakeObserverHandle> = installFakeObserver(
      window,
      ALL_ENTRY_TYPES,
    );

    recorder = makeRecorder({});
    recorder.start(window);

    expect(
      handles
        .map((handle: FakeObserverHandle): string | null => {
          return handle.entryType;
        })
        .sort(),
    ).toEqual(["event", "largest-contentful-paint", "layout-shift", "paint"]);

    /* No longtask observer: that one is a budget, and the budget is 0. */
    expect(handleFor(handles, "longtask")).toBeUndefined();
  });

  it("skips entry types the engine does not support", (): void => {
    const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
      "longtask",
    ]);

    recorder = makeRecorder({ lcp: 1000, longTask: 100 });
    recorder.start(window);

    /* Only the longtask observer exists; no LCP observe() was attempted. */
    expect(handles).toHaveLength(1);
    expect(handles[0]?.entryType).toBe("longtask");
  });

  describe("LCP budget", (): void => {
    it("reports ONCE on the first over-budget candidate, buffered, then disconnects", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      recorder = makeRecorder({ lcp: 2000, webVitals: false });
      recorder.start(window);

      /* buffered:true is what catches an LCP that landed pre-boot. */
      expect(handles[0]?.buffered).toBe(true);

      handles[0]?.emit([{ startTime: 900 }, { startTime: 2600 }]);
      handles[0]?.emit([{ startTime: 4100 }]);

      expect(issues).toEqual([
        {
          kind: "lcp",
          durationMs: 2600,
          budgetMs: 2000,
          occurredAtUnixMs: atOrigin(2600),
        },
      ]);
      expect(handles[0]?.isDisconnected).toBe(true);
      expect(customEvents[0]?.tag).toBe(PERFORMANCE_CUSTOM_EVENT_TAG);
    });

    it("stays silent while LCP is within budget", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      recorder = makeRecorder({ lcp: 4000, webVitals: false });
      recorder.start(window);

      handles[0]?.emit([{ startTime: 1200 }, { startTime: 3999 }]);

      expect(issues).toHaveLength(0);
      expect(handles[0]?.isDisconnected).toBe(false);
    });

    /*
     * recorder-signals-21: with buffered:true the callback fires when
     * the recorder boots, seconds after the paint. The event must say
     * when the paint HAPPENED, or the player draws the LCP marker at
     * recorder start.
     */
    it("timestamps the LCP at the paint, not at observer delivery", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      /* Delivery is "much later" than the paint. */
      const deliveredAt: number = window.performance.timeOrigin + 60_000;
      jest.spyOn(Date, "now").mockReturnValue(deliveredAt);

      recorder = makeRecorder({ lcp: 2000, webVitals: false });
      recorder.start(window);

      handles[0]?.emit([{ startTime: 2600 }]);

      expect(issueTimes).toEqual([atOrigin(2600)]);
      expect(issues[0]?.occurredAtUnixMs).toBe(atOrigin(2600));
      expect(issueTimes[0]).not.toBe(deliveredAt);
    });

    it("keeps the observer open for the vital after the budget fired", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      recorder = makeRecorder({ lcp: 2000 });
      recorder.start(window);

      handles[0]?.emit([{ startTime: 2600 }]);

      expect(issues).toHaveLength(1);
      expect(handles[0]?.isDisconnected).toBe(false);

      /* A later, larger candidate is the page's real LCP. */
      handles[0]?.emit([{ startTime: 3100 }]);
      document.dispatchEvent(new Event("pointerdown"));

      expect(vital("LCP")?.value).toBe(3100);
      expect(handles[0]?.isDisconnected).toBe(true);

      /* The budget still fired exactly once. */
      expect(issues).toHaveLength(1);
    });
  });

  describe("long tasks", (): void => {
    it("reports every over-budget task and ignores the rest", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 200 });
      recorder.start(window);

      handles[0]?.emit([
        { duration: 80, startTime: 100 },
        { duration: 200, startTime: 500 },
        { duration: 350.6, startTime: 900 },
      ]);

      expect(issues).toEqual([
        {
          kind: "long-task",
          durationMs: 200,
          budgetMs: 200,
          occurredAtUnixMs: atOrigin(500),
        },
        {
          kind: "long-task",
          durationMs: 351,
          budgetMs: 200,
          occurredAtUnixMs: atOrigin(900),
        },
      ]);
    });

    /*
     * recorder-signals-21: longtask entries are batched and delivered
     * after the task ends. The marker belongs where the stall started.
     */
    it("timestamps a long task at its start, not at batched delivery", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      const deliveredAt: number = window.performance.timeOrigin + 60_000;
      jest.spyOn(Date, "now").mockReturnValue(deliveredAt);

      recorder = makeRecorder({ longTask: 100 });
      recorder.start(window);

      handles[0]?.emit([{ duration: 480, startTime: 12_000 }]);

      expect(issueTimes).toEqual([atOrigin(12_000)]);
      expect(issues[0]?.occurredAtUnixMs).toBe(atOrigin(12_000));
    });

    it("ignores entries with unreadable durations", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 100 });
      recorder.start(window);

      handles[0]?.emit([
        { duration: NaN },
        { duration: undefined as unknown as number },
      ]);

      expect(issues).toHaveLength(0);
    });
  });

  describe("slow requests", (): void => {
    it("reports a request at or over budget with its scrubbed url", (): void => {
      recorder = makeRecorder({ slowRequest: 3000 });

      recorder.noteRequest(1, 3000, "https://api.example.com/orders");
      recorder.noteRequest(2, 8000.4, "https://api.example.com/search");

      expect(issues).toEqual([
        {
          kind: "slow-request",
          durationMs: 3000,
          budgetMs: 3000,
          url: "https://api.example.com/orders",
        },
        {
          kind: "slow-request",
          durationMs: 8000,
          budgetMs: 3000,
          url: "https://api.example.com/search",
        },
      ]);
      expect(issueTimes).toEqual([1, 2]);
    });

    it("stays silent under budget and while the budget is 0", (): void => {
      recorder = makeRecorder({ slowRequest: 3000 });
      recorder.noteRequest(1, 2999, "https://api.example.com/x");

      expect(issues).toHaveLength(0);

      recorder = makeRecorder({});
      recorder.noteRequest(1, 999999, "https://api.example.com/x");

      expect(issues).toHaveLength(0);
    });
  });

  describe("event cap", (): void => {
    it("stops emitting AND disconnects the unbounded source at the cap", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 100, webVitals: false });
      recorder.start(window);

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS + 10; i++) {
        handles[0]?.emit([{ duration: 500, startTime: i * 1000 }]);
      }

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS);
      expect(customEvents).toHaveLength(MAX_PERFORMANCE_EVENTS);
      expect(handles[0]?.isDisconnected).toBe(true);
      expect(recorder.getEmittedCount()).toBe(MAX_PERFORMANCE_EVENTS);
    });

    /*
     * The cap bounds the longtask STREAM; LCP is one number per page
     * load, latched by hasReportedLcp, and a jank-looping page that
     * burned the cap before its LCP settled must not lose the page's
     * single most useful performance number.
     */
    it("still reports the one LCP after the cap is burned", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
        "longtask",
      ]);

      recorder = makeRecorder({ lcp: 1000, longTask: 100, webVitals: false });
      recorder.start(window);

      const longTaskHandle: FakeObserverHandle | undefined = handleFor(
        handles,
        "longtask",
      );
      const lcpHandle: FakeObserverHandle | undefined = handleFor(
        handles,
        "largest-contentful-paint",
      );

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS; i++) {
        longTaskHandle?.emit([{ duration: 500, startTime: i * 1000 }]);
      }

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS);

      lcpHandle?.emit([{ startTime: 4200 }]);

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS + 1);
      expect(issues[issues.length - 1]?.kind).toBe("lcp");
    });

    /*
     * Vitals are bounded by construction (one per metric per page) and
     * are the events a viewer most wants, so a burned budget cap must not
     * take them down with it - nor may they eat into the cap.
     */
    it("neither counts vitals against the cap nor loses them to it", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
        "paint",
      ]);

      recorder = makeRecorder({ longTask: 100 });
      recorder.start(window);

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS + 5; i++) {
        handleFor(handles, "longtask")?.emit([
          { duration: 500, startTime: i * 1000 },
        ]);
      }

      handleFor(handles, "paint")?.emit([
        { name: "first-contentful-paint", startTime: 1400 },
      ]);

      expect(vital("FCP")?.value).toBe(1400);
      expect(recorder.getEmittedCount()).toBe(MAX_PERFORMANCE_EVENTS);
      expect(recorder.getWebVitalCount()).toBe(1);
    });
  });

  describe("resetForNewSession", (): void => {
    it("resets the cap and re-arms a longtask observer disconnected at the cap", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 100, webVitals: false });
      recorder.start(window);

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS + 5; i++) {
        handles[0]?.emit([{ duration: 500, startTime: i * 1000 }]);
      }

      expect(handles[0]?.isDisconnected).toBe(true);

      recorder.resetForNewSession();

      /* A NEW observer was armed (the fake registers each construction). */
      expect(handles).toHaveLength(2);
      expect(handles[1]?.entryType).toBe("longtask");
      expect(recorder.getEmittedCount()).toBe(0);

      handles[1]?.emit([{ duration: 300, startTime: 99_000 }]);

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS + 1);
      expect(issues[issues.length - 1]?.durationMs).toBe(300);
    });

    it("does nothing after stop, and does not double-arm a live observer", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 100, webVitals: false });
      recorder.start(window);

      /* Observer still connected: reset must not stack a second one. */
      recorder.resetForNewSession();
      expect(handles).toHaveLength(1);

      recorder.stop();
      recorder.resetForNewSession();
      expect(handles).toHaveLength(1);
    });

    /* Vitals are per page LOAD; a rotation is not a new page. */
    it("does not re-emit a vital already reported for this page load", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "paint",
      ]);

      recorder = makeRecorder({});
      recorder.start(window);

      handles[0]?.emit([{ name: "first-contentful-paint", startTime: 1000 }]);
      recorder.resetForNewSession();
      handles[0]?.emit([{ name: "first-contentful-paint", startTime: 1000 }]);

      expect(vitals()).toHaveLength(1);
    });
  });

  it("disconnects every observer on stop and never reports after", (): void => {
    const handles: Array<FakeObserverHandle> = installFakeObserver(
      window,
      ALL_ENTRY_TYPES,
    );

    recorder = makeRecorder({ lcp: 1000, longTask: 100 });
    recorder.start(window);

    /* lcp, longtask, paint, layout-shift, event (first-input is the fallback). */
    expect(handles).toHaveLength(5);

    recorder.stop();

    expect(
      handles.every((handle: FakeObserverHandle): boolean => {
        return handle.isDisconnected;
      }),
    ).toBe(true);

    const emittedAtStop: number = customEvents.length;

    handleFor(handles, "longtask")?.emit([{ duration: 900, startTime: 5000 }]);
    window.dispatchEvent(new Event("pagehide"));

    /* A disconnected fake still calls back; the recorder must ignore it. */
    expect(issues).toHaveLength(0);
    expect(customEvents.length).toBe(emittedAtStop);
  });

  describe("web vitals", (): void => {
    it("rates by the published thresholds", (): void => {
      for (const metric of Object.keys(WEB_VITAL_THRESHOLDS)) {
        const key: SessionReplayWebVitalMetric =
          metric as SessionReplayWebVitalMetric;
        const threshold: { good: number; poor: number } =
          WEB_VITAL_THRESHOLDS[key];

        expect(rateWebVital(key, threshold.good)).toBe("good");
        expect(rateWebVital(key, threshold.good + 0.0001)).toBe(
          "needs-improvement",
        );
        expect(rateWebVital(key, threshold.poor)).toBe("needs-improvement");
        expect(rateWebVital(key, threshold.poor + 0.0001)).toBe("poor");
      }

      expect(WEB_VITAL_THRESHOLDS).toEqual({
        LCP: { good: 2500, poor: 4000 },
        FCP: { good: 1800, poor: 3000 },
        CLS: { good: 0.1, poor: 0.25 },
        INP: { good: 200, poor: 500 },
        TTFB: { good: 800, poor: 1800 },
      });
    });

    describe("TTFB", (): void => {
      it("reports responseStart from navigation timing at start, on the wall clock", (): void => {
        const fakeWindow: Window = windowWithPerformance({
          timeOrigin: 1_700_000_000_000,
          getEntriesByType: (type: string): Array<unknown> => {
            return type === "navigation" ? [{ responseStart: 640.4 }] : [];
          },
        });

        recorder = makeRecorder({});
        recorder.start(fakeWindow);

        expect(vitals()).toEqual([
          {
            kind: "web-vital",
            metric: "TTFB",
            value: 640,
            rating: "good",
            occurredAtUnixMs: 1_700_000_000_640,
          },
        ]);

        /* Information only: never a trigger. */
        expect(issues).toHaveLength(0);
      });

      it("falls back to legacy performance.timing", (): void => {
        const fakeWindow: Window = windowWithPerformance({
          timing: {
            navigationStart: 1_700_000_000_000,
            responseStart: 1_700_000_001_900,
          },
        });

        recorder = makeRecorder({});
        recorder.start(fakeWindow);

        expect(vital("TTFB")).toEqual({
          kind: "web-vital",
          metric: "TTFB",
          value: 1900,
          rating: "poor",
          occurredAtUnixMs: 1_700_000_001_900,
        });
      });

      /* A 0 is "not measured" (bfcache restore, synthetic document), never a 0ms response. */
      it("reports nothing when responseStart is 0 or absent", (): void => {
        for (const entries of [[{ responseStart: 0 }], [], [{}]]) {
          recorder = makeRecorder({});
          recorder.start(
            windowWithPerformance({
              timeOrigin: 1_700_000_000_000,
              getEntriesByType: (): Array<unknown> => {
                return entries;
              },
            }),
          );
          recorder.stop();

          expect(vital("TTFB")).toBeNull();
        }
      });

      it("survives a performance object that throws", (): void => {
        recorder = makeRecorder({});

        expect((): void => {
          recorder.start(
            windowWithPerformance({
              getEntriesByType: (): Array<unknown> => {
                throw new Error("nope");
              },
            }),
          );
        }).not.toThrow();

        expect(vitals()).toHaveLength(0);
      });
    });

    describe("FCP", (): void => {
      it("reports the first-contentful-paint entry once and releases the observer", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "paint",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        handles[0]?.emit([
          { name: "first-paint", startTime: 900 },
          { name: "first-contentful-paint", startTime: 1900.4 },
        ]);
        handles[0]?.emit([{ name: "first-contentful-paint", startTime: 2500 }]);

        expect(vitals()).toEqual([
          {
            kind: "web-vital",
            metric: "FCP",
            value: 1900,
            rating: "needs-improvement",
            occurredAtUnixMs: atOrigin(1900.4),
          },
        ]);
        expect(handles[0]?.isDisconnected).toBe(true);
        expect(issues).toHaveLength(0);
      });
    });

    describe("LCP", (): void => {
      it("reports the LATEST candidate when the first input arrives", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "largest-contentful-paint",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        handles[0]?.emit([{ startTime: 1200 }, { startTime: 2600 }]);

        /* Nothing yet: the browser may still issue a larger candidate. */
        expect(vitals()).toHaveLength(0);

        document.dispatchEvent(new Event("keydown"));

        expect(vitals()).toEqual([
          {
            kind: "web-vital",
            metric: "LCP",
            value: 2600,
            rating: "needs-improvement",
            occurredAtUnixMs: atOrigin(2600),
          },
        ]);
        expect(handles[0]?.isDisconnected).toBe(true);

        /* Once per page: neither a second input nor a hide adds another. */
        document.dispatchEvent(new Event("click"));
        window.dispatchEvent(new Event("pagehide"));

        expect(vitals()).toHaveLength(1);
      });

      it("reports when the tab hides instead, if no input ever came", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "largest-contentful-paint",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        handles[0]?.emit([{ startTime: 4300 }]);

        const descriptor: PropertyDescriptor | undefined =
          Object.getOwnPropertyDescriptor(document, "visibilityState");

        Object.defineProperty(document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });

        try {
          document.dispatchEvent(new Event("visibilitychange"));
        } finally {
          if (descriptor) {
            Object.defineProperty(document, "visibilityState", descriptor);
          } else {
            delete (document as unknown as Record<string, unknown>)[
              "visibilityState"
            ];
          }
        }

        expect(vital("LCP")).toEqual({
          kind: "web-vital",
          metric: "LCP",
          value: 4300,
          rating: "poor",
          occurredAtUnixMs: atOrigin(4300),
        });
      });

      it("reports nothing when no candidate was ever observed", (): void => {
        installFakeObserver(window, ["largest-contentful-paint"]);

        recorder = makeRecorder({});
        recorder.start(window);

        window.dispatchEvent(new Event("pagehide"));

        expect(vital("LCP")).toBeNull();
      });
    });

    describe("CLS", (): void => {
      it("sums shifts within a session window, takes the largest window, and reports it where it shifted", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "layout-shift",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        handles[0]?.emit([
          { value: 0.05, startTime: 1000, hadRecentInput: false },
          /* 500ms later: same session -> 0.09. */
          { value: 0.04, startTime: 1500, hadRecentInput: false },
          /* The user caused this one; excluded by definition. */
          { value: 0.5, startTime: 1600, hadRecentInput: true },
          /* 1.5s gap: a new, smaller session. */
          { value: 0.02, startTime: 3000, hadRecentInput: false },
        ]);

        /* Still open: CLS is a page-lifetime number. */
        expect(vital("CLS")).toBeNull();

        window.dispatchEvent(new Event("pagehide"));

        expect(vital("CLS")).toEqual({
          kind: "web-vital",
          metric: "CLS",
          value: 0.09,
          rating: "good",
          occurredAtUnixMs: atOrigin(1500),
        });
      });

      it("starts a new window after 5 seconds even without a gap", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "layout-shift",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        const shifts: Array<Record<string, unknown>> = [];

        /* 0.03 every 800ms for 8s: one window can hold at most 5s of them. */
        for (let i: number = 0; i < 11; i++) {
          shifts.push({
            value: 0.03,
            startTime: i * 800,
            hadRecentInput: false,
          });
        }

        handles[0]?.emit(shifts);
        window.dispatchEvent(new Event("pagehide"));

        /* 7 shifts fit under 5s (0..4800ms): 0.21, not 0.33. */
        expect(vital("CLS")?.value).toBe(0.21);
        expect(vital("CLS")?.rating).toBe("needs-improvement");
      });

      it("reports a measured 0 when shifts were observable but none happened", (): void => {
        installFakeObserver(window, ["layout-shift"]);

        recorder = makeRecorder({});
        recorder.start(window);

        window.dispatchEvent(new Event("pagehide"));

        expect(vital("CLS")?.value).toBe(0);
        expect(vital("CLS")?.rating).toBe("good");
      });

      it("reports nothing on an engine that cannot observe shifts", (): void => {
        installFakeObserver(window, ["paint"]);

        recorder = makeRecorder({});
        recorder.start(window);

        window.dispatchEvent(new Event("pagehide"));

        expect(vital("CLS")).toBeNull();
      });
    });

    describe("INP", (): void => {
      it("asks event timing for interactions from 40ms and reports the slowest", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "event",
          "first-input",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        const handle: FakeObserverHandle | undefined = handleFor(
          handles,
          "event",
        );

        expect(handle?.observeOptions?.["durationThreshold"]).toBe(
          INP_DURATION_THRESHOLD_MS,
        );
        expect(handle?.buffered).toBe(true);

        /* first-input is the fallback only; never both. */
        expect(handleFor(handles, "first-input")).toBeUndefined();

        handle?.emit([
          /* Not an interaction (hover, mousemove): excluded. */
          { interactionId: 0, duration: 900, startTime: 100 },
          { interactionId: 12, duration: 120, startTime: 5000 },
          { interactionId: 13, duration: 260.4, startTime: 8000 },
          { interactionId: 14, duration: 90, startTime: 9000 },
        ]);

        window.dispatchEvent(new Event("pagehide"));

        expect(vital("INP")).toEqual({
          kind: "web-vital",
          metric: "INP",
          value: 260,
          rating: "needs-improvement",
          occurredAtUnixMs: atOrigin(8000),
        });
      });

      it("falls back to first-input when event timing is missing", (): void => {
        const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
          "first-input",
        ]);

        recorder = makeRecorder({});
        recorder.start(window);

        handles[0]?.emit([{ duration: 90, startTime: 100 }]);
        window.dispatchEvent(new Event("pagehide"));

        expect(vital("INP")?.value).toBe(90);
        expect(vital("INP")?.rating).toBe("good");
      });

      /* No interaction means no INP - not an INP of 0. */
      it("reports nothing without an interaction", (): void => {
        installFakeObserver(window, ["event"]);

        recorder = makeRecorder({});
        recorder.start(window);

        window.dispatchEvent(new Event("pagehide"));

        expect(vital("INP")).toBeNull();
      });
    });

    it("flushes the page-lifetime vitals on stop", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
        "layout-shift",
        "event",
      ]);

      recorder = makeRecorder({});
      recorder.start(window);

      handleFor(handles, "largest-contentful-paint")?.emit([
        { startTime: 1500 },
      ]);
      handleFor(handles, "layout-shift")?.emit([
        { value: 0.3, startTime: 2000, hadRecentInput: false },
      ]);
      handleFor(handles, "event")?.emit([
        { interactionId: 1, duration: 700, startTime: 2500 },
      ]);

      recorder.stop();

      expect(
        vitals().map((event: WebVitalEvent): string => {
          return `${event.metric}:${event.value}:${event.rating}`;
        }),
      ).toEqual(["LCP:1500:good", "CLS:0.3:poor", "INP:700:poor"]);
      expect(recorder.getWebVitalCount()).toBe(3);
      expect(issues).toHaveLength(0);
    });

    it("never calls onIssue for a vital, whatever its rating", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(
        window,
        ALL_ENTRY_TYPES,
      );

      recorder = makeRecorder({});
      recorder.start(window);

      handleFor(handles, "largest-contentful-paint")?.emit([
        { startTime: 9000 },
      ]);
      handleFor(handles, "paint")?.emit([
        { name: "first-contentful-paint", startTime: 7000 },
      ]);
      handleFor(handles, "layout-shift")?.emit([
        { value: 2, startTime: 100, hadRecentInput: false },
      ]);
      handleFor(handles, "event")?.emit([
        { interactionId: 1, duration: 5000, startTime: 200 },
      ]);

      window.dispatchEvent(new Event("pagehide"));

      expect(vitals().length).toBe(4);
      expect(
        vitals().every((event: WebVitalEvent): boolean => {
          return event.rating === "poor";
        }),
      ).toBe(true);
      expect(issues).toHaveLength(0);
    });

    it("emits nothing and listens to nothing when switched off", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(
        window,
        ALL_ENTRY_TYPES,
      );

      recorder = makeRecorder({ lcp: 2000, webVitals: false });
      recorder.start(
        windowWithPerformance({
          timeOrigin: 1_700_000_000_000,
          getEntriesByType: (): Array<unknown> => {
            return [{ responseStart: 500 }];
          },
        }),
      );

      /* Only the observer the budget needs - and the fake lives on window. */
      expect(handles).toHaveLength(0);

      window.dispatchEvent(new Event("pagehide"));
      recorder.stop();

      expect(vitals()).toHaveLength(0);
      expect(recorder.getWebVitalCount()).toBe(0);
    });

    it("stops listening to the page after stop", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      recorder = makeRecorder({});
      recorder.start(window);
      recorder.stop();

      /* A candidate delivered late by a fake that ignores disconnect. */
      handles[0]?.emit([{ startTime: 3000 }]);
      document.dispatchEvent(new Event("pointerdown"));
      window.dispatchEvent(new Event("pagehide"));

      expect(vital("LCP")).toBeNull();
    });
  });
});
