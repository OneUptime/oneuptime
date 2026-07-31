import PerformanceRecorder, {
  MAX_PERFORMANCE_EVENTS,
  PERFORMANCE_CUSTOM_EVENT_TAG,
  PerformanceIssue,
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
  isDisconnected: boolean;
  emit: (entries: Array<Partial<PerformanceEntry>>) => void;
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
        isDisconnected: false,
        emit: (entries: Array<Partial<PerformanceEntry>>): void => {
          this.callback({
            getEntries: (): Array<PerformanceEntry> => {
              return entries as Array<PerformanceEntry>;
            },
          });
        },
      };

      handles.push(this.handle);
    }

    public observe(options: Record<string, unknown>): void {
      this.handle.entryType = String(options["type"]);
      this.handle.buffered = options["buffered"] === true;
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

describe("PerformanceRecorder", (): void => {
  let issues: Array<PerformanceIssue> = [];
  let customEvents: Array<{ tag: string; payload: unknown }> = [];
  let recorder: PerformanceRecorder;

  const makeRecorder: (budgets: {
    lcp?: number;
    longTask?: number;
    slowRequest?: number;
  }) => PerformanceRecorder = (budgets: {
    lcp?: number;
    longTask?: number;
    slowRequest?: number;
  }): PerformanceRecorder => {
    issues = [];
    customEvents = [];

    return new PerformanceRecorder({
      emitCustomEvent: (tag: string, payload: unknown): void => {
        customEvents.push({ tag: tag, payload: payload });
      },
      onIssue: (_atUnixMs: number, issue: PerformanceIssue): void => {
        issues.push(issue);
      },
      lcpBudgetMs: budgets.lcp || 0,
      longTaskBudgetMs: budgets.longTask || 0,
      slowRequestBudgetMs: budgets.slowRequest || 0,
    });
  };

  afterEach((): void => {
    if (recorder) {
      recorder.stop();
    }

    removeObserver(window);
  });

  it("survives a browser with no PerformanceObserver at all", (): void => {
    recorder = makeRecorder({ lcp: 1000, longTask: 100 });

    expect((): void => {
      recorder.start(window);
      recorder.stop();
    }).not.toThrow();

    expect(issues).toHaveLength(0);
  });

  it("creates no observers while every budget is 0", (): void => {
    const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
      "largest-contentful-paint",
      "longtask",
    ]);

    recorder = makeRecorder({});
    recorder.start(window);

    expect(handles).toHaveLength(0);
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

  describe("LCP", (): void => {
    it("reports ONCE on the first over-budget candidate, buffered, then disconnects", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      recorder = makeRecorder({ lcp: 2000 });
      recorder.start(window);

      /* buffered:true is what catches an LCP that landed pre-boot. */
      expect(handles[0]?.buffered).toBe(true);

      handles[0]?.emit([{ startTime: 900 }, { startTime: 2600 }]);
      handles[0]?.emit([{ startTime: 4100 }]);

      expect(issues).toEqual([
        { kind: "lcp", durationMs: 2600, budgetMs: 2000 },
      ]);
      expect(handles[0]?.isDisconnected).toBe(true);
      expect(customEvents[0]?.tag).toBe(PERFORMANCE_CUSTOM_EVENT_TAG);
    });

    it("stays silent while LCP is within budget", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "largest-contentful-paint",
      ]);

      recorder = makeRecorder({ lcp: 4000 });
      recorder.start(window);

      handles[0]?.emit([{ startTime: 1200 }, { startTime: 3999 }]);

      expect(issues).toHaveLength(0);
      expect(handles[0]?.isDisconnected).toBe(false);
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
        { duration: 80 },
        { duration: 200 },
        { duration: 350.6 },
      ]);

      expect(issues).toEqual([
        { kind: "long-task", durationMs: 200, budgetMs: 200 },
        { kind: "long-task", durationMs: 351, budgetMs: 200 },
      ]);
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

      recorder = makeRecorder({ longTask: 100 });
      recorder.start(window);

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS + 10; i++) {
        handles[0]?.emit([{ duration: 500 }]);
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

      recorder = makeRecorder({ lcp: 1000, longTask: 100 });
      recorder.start(window);

      const longTaskHandle: FakeObserverHandle | undefined = handles.find(
        (handle: FakeObserverHandle): boolean => {
          return handle.entryType === "longtask";
        },
      );
      const lcpHandle: FakeObserverHandle | undefined = handles.find(
        (handle: FakeObserverHandle): boolean => {
          return handle.entryType === "largest-contentful-paint";
        },
      );

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS; i++) {
        longTaskHandle?.emit([{ duration: 500 }]);
      }

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS);

      lcpHandle?.emit([{ startTime: 4200 }]);

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS + 1);
      expect(issues[issues.length - 1]?.kind).toBe("lcp");
    });
  });

  describe("resetForNewSession", (): void => {
    it("resets the cap and re-arms a longtask observer disconnected at the cap", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 100 });
      recorder.start(window);

      for (let i: number = 0; i < MAX_PERFORMANCE_EVENTS + 5; i++) {
        handles[0]?.emit([{ duration: 500 }]);
      }

      expect(handles[0]?.isDisconnected).toBe(true);

      recorder.resetForNewSession();

      /* A NEW observer was armed (the fake registers each construction). */
      expect(handles).toHaveLength(2);
      expect(handles[1]?.entryType).toBe("longtask");
      expect(recorder.getEmittedCount()).toBe(0);

      handles[1]?.emit([{ duration: 300 }]);

      expect(issues).toHaveLength(MAX_PERFORMANCE_EVENTS + 1);
      expect(issues[issues.length - 1]?.durationMs).toBe(300);
    });

    it("does nothing after stop, and does not double-arm a live observer", (): void => {
      const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
        "longtask",
      ]);

      recorder = makeRecorder({ longTask: 100 });
      recorder.start(window);

      /* Observer still connected: reset must not stack a second one. */
      recorder.resetForNewSession();
      expect(handles).toHaveLength(1);

      recorder.stop();
      recorder.resetForNewSession();
      expect(handles).toHaveLength(1);
    });
  });

  it("disconnects every observer on stop and never reports after", (): void => {
    const handles: Array<FakeObserverHandle> = installFakeObserver(window, [
      "largest-contentful-paint",
      "longtask",
    ]);

    recorder = makeRecorder({ lcp: 1000, longTask: 100 });
    recorder.start(window);

    expect(handles).toHaveLength(2);

    recorder.stop();

    expect(
      handles.every((handle: FakeObserverHandle): boolean => {
        return handle.isDisconnected;
      }),
    ).toBe(true);
  });
});
