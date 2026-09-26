import { isSessionReplayWebVitalPayload } from "Common/Types/Rum/SessionReplayCustomEvents";
import ClickRecorder from "../src/ClickRecorder";
import PerformanceRecorder, {
  INP_VIEW_SETTLE_MS,
  MAX_INP_REPORTS,
  PerformanceRecorderOptions,
  WebVitalEvent,
} from "../src/PerformanceRecorder";

/*
 * INP per VIEW, for single-page apps (issue #3975). The browser's INP
 * covers the whole document, so an app that routes with pushState used to
 * get one number for the whole visit, blamed on whatever URL the tab
 * showed at the end. These cases pin the per-view behaviour: every route
 * change is a new view, an interaction belongs to the view it STARTED in,
 * and each report says where it happened and why it was slow.
 *
 * The window here is a stand-in with a controllable clock, so a route
 * change lands at an exact performance.now() and the settle timer can be
 * advanced without real waiting.
 */

type EntriesCallback = (list: {
  getEntries: () => Array<PerformanceEntry>;
}) => void;

interface FakeObserver {
  entryType: string | null;
  /* Delivered now, as an observer callback. */
  emit: (entries: Array<Record<string, unknown>>) => void;
  /* Queued but not delivered: only takeRecords() hands these over. */
  queue: (entries: Array<Record<string, unknown>>) => void;
}

interface FakePage {
  windowRef: Window;
  observers: Array<FakeObserver>;
  setNow: (ms: number) => void;
  setInteractionCount: (count: number) => void;
}

const TIME_ORIGIN: number = 1_800_000_000_000;

function makePage(supported: Array<string>): FakePage {
  const observers: Array<FakeObserver> = [];
  let now: number = 0;

  const performance: Record<string, unknown> = {
    timeOrigin: TIME_ORIGIN,
    now: (): number => {
      return now;
    },
  };

  class FakePerformanceObserver {
    public static supportedEntryTypes: Array<string> = supported;

    private readonly handle: FakeObserver;
    private pending: Array<Record<string, unknown>> = [];

    public constructor(callback: EntriesCallback) {
      this.handle = {
        entryType: null,
        emit: (entries: Array<Record<string, unknown>>): void => {
          callback({
            getEntries: (): Array<PerformanceEntry> => {
              return entries as unknown as Array<PerformanceEntry>;
            },
          });
        },
        queue: (entries: Array<Record<string, unknown>>): void => {
          this.pending.push(...entries);
        },
      };

      observers.push(this.handle);
    }

    public observe(options: Record<string, unknown>): void {
      this.handle.entryType = String(options["type"]);
    }

    public disconnect(): void {
      this.pending = [];
    }

    public takeRecords(): Array<PerformanceEntry> {
      const taken: Array<Record<string, unknown>> = this.pending;
      this.pending = [];
      return taken as unknown as Array<PerformanceEntry>;
    }
  }

  const windowRef: Record<string, unknown> = {
    document: document,
    performance: performance,
    PerformanceObserver: FakePerformanceObserver,
    addEventListener: (type: string, listener: EventListener): void => {
      window.addEventListener(type, listener);
    },
    removeEventListener: (type: string, listener: EventListener): void => {
      window.removeEventListener(type, listener);
    },
  };

  return {
    windowRef: windowRef as unknown as Window,
    observers: observers,
    setNow: (ms: number): void => {
      now = ms;
    },
    setInteractionCount: (count: number): void => {
      performance["interactionCount"] = count;
    },
  };
}

function eventObserver(page: FakePage): FakeObserver {
  const observer: FakeObserver | undefined = page.observers.find(
    (candidate: FakeObserver): boolean => {
      return candidate.entryType === "event";
    },
  );

  if (!observer) {
    throw new Error("no event-timing observer was created");
  }

  return observer;
}

/* One event-timing entry of an interaction. */
function interaction(data: {
  id: number;
  start: number;
  duration: number;
  name?: string;
  processingStart?: number;
  processingEnd?: number;
  target?: unknown;
}): Record<string, unknown> {
  return {
    interactionId: data.id,
    startTime: data.start,
    duration: data.duration,
    name: data.name || "pointerdown",
    processingStart: data.processingStart,
    processingEnd: data.processingEnd,
    target: data.target === undefined ? null : data.target,
  };
}

function hideTab(): void {
  window.dispatchEvent(new Event("pagehide"));
}

describe("PerformanceRecorder - INP per view", (): void => {
  let events: Array<unknown> = [];
  let currentUrl: string = "https://shop.example.com/products";
  let recorder: PerformanceRecorder | null = null;

  function start(
    page: FakePage,
    extra: {
      captureWebVitals?: boolean;
      describeTarget?: (target: Element) => string;
    } = {},
  ): PerformanceRecorder {
    const options: PerformanceRecorderOptions = {
      emitCustomEvent: (_tag: string, payload: unknown): void => {
        events.push(payload);
      },
      onIssue: (): void => {},
      lcpBudgetMs: 0,
      longTaskBudgetMs: 0,
      slowRequestBudgetMs: 0,
      getCurrentUrl: (): string => {
        return currentUrl;
      },
    };

    if (extra.captureWebVitals !== undefined) {
      options.captureWebVitals = extra.captureWebVitals;
    }

    if (extra.describeTarget) {
      options.describeTarget = extra.describeTarget;
    }

    recorder = new PerformanceRecorder(options);
    recorder.start(page.windowRef);
    return recorder;
  }

  function inps(): Array<WebVitalEvent> {
    return events.filter((payload: unknown): payload is WebVitalEvent => {
      return (
        isSessionReplayWebVitalPayload(payload) && payload.metric === "INP"
      );
    });
  }

  /* A route change the way the Recorder reports one. */
  function navigate(
    page: FakePage,
    atMs: number,
    from: string,
    to: string,
  ): void {
    page.setNow(atMs);
    currentUrl = to;
    recorder?.noteRouteChange(from, to);
  }

  /* Lets the settle timer fire with the clock moved on by the same amount. */
  function settle(page: FakePage, nowMs: number): void {
    page.setNow(nowMs);
    jest.advanceTimersByTime(INP_VIEW_SETTLE_MS);
  }

  beforeEach((): void => {
    jest.useFakeTimers();
    events = [];
    currentUrl = "https://shop.example.com/products";
    document.body.innerHTML = "";
  });

  afterEach((): void => {
    recorder?.stop();
    recorder = null;
    jest.useRealTimers();
  });

  it("reports one INP per route, each charged to the view it happened in", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    eventObserver(page).emit([
      interaction({ id: 7, start: 1000, duration: 120 }),
    ]);

    navigate(
      page,
      5000,
      "https://shop.example.com/products",
      "https://shop.example.com/cart",
    );

    eventObserver(page).emit([
      interaction({ id: 21, start: 6000, duration: 640 }),
    ]);

    /* Nothing yet: the closed view is waiting out its settle period. */
    expect(inps()).toHaveLength(0);

    settle(page, 6000);

    expect(inps()).toHaveLength(1);
    expect(inps()[0]).toMatchObject({
      value: 120,
      rating: "good",
      url: "https://shop.example.com/products",
      navigationType: "hard",
      occurredAtUnixMs: TIME_ORIGIN + 1000,
    });

    hideTab();

    expect(inps()).toHaveLength(2);
    expect(inps()[1]).toMatchObject({
      value: 640,
      rating: "poor",
      url: "https://shop.example.com/cart",
      navigationType: "soft",
      occurredAtUnixMs: TIME_ORIGIN + 6000,
    });
  });

  /*
   * The point of the settle period. The click that called pushState is
   * delivered after the next paint, i.e. after the route change - but it
   * STARTED on the page it was clicked on, and that page is what was slow.
   */
  it("charges the interaction that navigated to the page it was clicked on", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    navigate(
      page,
      2000,
      "https://shop.example.com/products",
      "https://shop.example.com/products/:id",
    );

    eventObserver(page).emit([
      interaction({
        id: 14,
        start: 1990,
        duration: 480,
        name: "click",
        processingStart: 1995,
        processingEnd: 2300,
      }),
    ]);

    settle(page, 3000);
    hideTab();

    expect(inps()).toHaveLength(1);
    expect(inps()[0]).toMatchObject({
      value: 480,
      url: "https://shop.example.com/products",
      navigationType: "hard",
      interactionType: "pointer",
      inputDelayMs: 5,
      processingDurationMs: 305,
      presentationDelayMs: 170,
    });
  });

  it("merges an interaction's entries into one latency and one phase split", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    eventObserver(page).emit([
      interaction({
        id: 3,
        start: 1000,
        duration: 96,
        name: "keydown",
        processingStart: 1030,
        processingEnd: 1050,
      }),
      interaction({
        id: 3,
        start: 1010,
        duration: 250,
        name: "keyup",
        processingStart: 1060,
        processingEnd: 1200,
      }),
    ]);

    hideTab();

    expect(inps()).toHaveLength(1);
    expect(inps()[0]).toMatchObject({
      value: 250,
      interactionType: "keyboard",
      /* From the first entry to the last handler, then to the paint. */
      inputDelayMs: 30,
      processingDurationMs: 170,
      presentationDelayMs: 60,
    });
  });

  it("names the target the way a click is named", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page, {
      describeTarget: (target: Element): string => {
        return ClickRecorder.buildSelector(target);
      },
    });

    document.body.innerHTML =
      '<div id="checkout"><button class="pay primary" data-card="4242">Pay</button></div>';
    const button: Element = document.querySelector("button") as Element;

    eventObserver(page).emit([
      interaction({ id: 1, start: 500, duration: 300, target: button }),
    ]);
    hideTab();

    expect(inps()[0]?.interactionTarget).toBe(
      "div#checkout > button.pay.primary",
    );
    /* Structure only: never an attribute value or the button's text. */
    expect(JSON.stringify(inps()[0])).not.toContain("4242");
    expect(JSON.stringify(inps()[0])).not.toContain("Pay<");
  });

  /*
   * Event timing reports target null once the element has left the
   * document, and in a single-page app the button that navigated has
   * usually just been replaced by the next route. The recorder remembers
   * recent input targets by timestamp, which IS the entry's startTime.
   */
  it("still names a target that the navigation removed from the page", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page, {
      describeTarget: (target: Element): string => {
        return ClickRecorder.buildSelector(target);
      },
    });

    document.body.innerHTML =
      '<nav><a class="product-link" href="/products/1">Shoe</a></nav>';
    const link: Element = document.querySelector("a") as Element;
    const pointerdown: Event = new Event("pointerdown", { bubbles: true });
    link.dispatchEvent(pointerdown);

    /* The router swaps the whole navigation out for the next page. */
    document.querySelector("nav")?.remove();

    eventObserver(page).emit([
      interaction({
        id: 5,
        start: pointerdown.timeStamp,
        duration: 350,
        target: null,
      }),
    ]);
    hideTab();

    expect(inps()[0]?.interactionTarget).toBe("nav > a.product-link");
  });

  it("sends no target when no selector builder was provided", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    document.body.innerHTML = "<button>Go</button>";

    eventObserver(page).emit([
      interaction({
        id: 1,
        start: 100,
        duration: 300,
        target: document.querySelector("button"),
      }),
    ]);
    hideTab();

    expect(inps()[0]).toBeDefined();
    expect(inps()[0]?.interactionTarget).toBeUndefined();
  });

  /*
   * web-vitals' p98 approximation: one outlier is skipped per fifty
   * interactions, so a busy view reports a representative slow
   * interaction rather than its single worst.
   */
  it("skips one outlier per fifty interactions", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    const entries: Array<Record<string, unknown>> = [];

    for (let id: number = 1; id <= 120; id++) {
      entries.push(interaction({ id: id, start: id * 100, duration: 40 + id }));
    }

    eventObserver(page).emit(entries);
    hideTab();

    /* 120 interactions: skip two, report the third slowest (40 + 118). */
    expect(inps()[0]?.value).toBe(158);
  });

  it("counts the fast interactions event timing never delivers", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    /* Only three slow ones were delivered, but 100 happened. */
    page.setInteractionCount(100);
    eventObserver(page).emit([
      interaction({ id: 1, start: 100, duration: 900 }),
      interaction({ id: 2, start: 200, duration: 700 }),
      interaction({ id: 3, start: 300, duration: 300 }),
    ]);
    hideTab();

    expect(inps()[0]?.value).toBe(300);
  });

  it("reports nothing for a view nobody interacted with", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    navigate(page, 1000, "https://a.example/one", "https://a.example/two");
    settle(page, 2000);
    hideTab();

    expect(inps()).toHaveLength(0);
  });

  it("does not repeat an unchanged view, and reports it again if it gets slower", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    eventObserver(page).emit([
      interaction({ id: 1, start: 100, duration: 300 }),
    ]);

    hideTab();
    hideTab();

    expect(inps()).toHaveLength(1);

    /* The tab came back and the same view got slower. */
    eventObserver(page).emit([
      interaction({ id: 9, start: 900, duration: 700 }),
    ]);
    hideTab();

    expect(
      inps().map((event: WebVitalEvent): number => {
        return event.value;
      }),
    ).toEqual([300, 700]);
  });

  it("pulls in queued entries before reporting on hide", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    eventObserver(page).queue([
      interaction({ id: 4, start: 400, duration: 520 }),
    ]);
    hideTab();

    expect(inps()[0]?.value).toBe(520);
  });

  /*
   * A settle timer that fires far later than it was due means the main
   * thread was busy - possibly still inside the handler that navigated,
   * whose entry cannot have been delivered yet. The view gets one more
   * period instead of being reported without its slowest interaction.
   */
  it("waits one more period when the main thread was blocked", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    navigate(page, 1000, "https://a.example/list", "https://a.example/item");

    /* The timer fires 4s late. */
    settle(page, 1000 + INP_VIEW_SETTLE_MS * 5);
    expect(inps()).toHaveLength(0);

    eventObserver(page).emit([
      interaction({ id: 2, start: 990, duration: 4200, name: "click" }),
    ]);

    settle(page, 1000 + INP_VIEW_SETTLE_MS * 6);

    expect(inps()).toHaveLength(1);
    expect(inps()[0]).toMatchObject({
      value: 4200,
      url: "https://a.example/list",
    });
  });

  it("reports the oldest views at once when routes change faster than they settle", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    for (let index: number = 0; index < 12; index++) {
      eventObserver(page).emit([
        interaction({ id: index + 1, start: index * 10 + 1, duration: 100 }),
      ]);
      navigate(
        page,
        index * 10 + 5,
        `https://a.example/${index}`,
        `https://a.example/${index + 1}`,
      );
    }

    /* Twelve closed views, ten allowed to wait: two went already. */
    expect(
      inps().map((event: WebVitalEvent): string | undefined => {
        return event.url;
      }),
    ).toEqual(["https://a.example/0", "https://a.example/1"]);
  });

  it("caps INP reports per page load", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    for (let index: number = 0; index < MAX_INP_REPORTS + 20; index++) {
      const at: number = index * 10_000;

      eventObserver(page).emit([
        interaction({ id: index + 1, start: at + 100, duration: 250 }),
      ]);
      navigate(
        page,
        at + 200,
        `https://a.example/${index}`,
        `https://a.example/${index + 1}`,
      );
      settle(page, at + 200 + INP_VIEW_SETTLE_MS);
    }

    hideTab();

    expect(inps()).toHaveLength(MAX_INP_REPORTS);
  });

  it("drops a late entry whose view was already reported", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    navigate(page, 1000, "https://a.example/a", "https://a.example/b");
    settle(page, 2000);

    eventObserver(page).emit([
      interaction({ id: 1, start: 500, duration: 900 }),
    ]);
    hideTab();

    expect(inps()).toHaveLength(0);
  });

  it("keeps first-input engines working, one interaction per entry", (): void => {
    const page: FakePage = makePage(["first-input"]);
    start(page);

    const firstInput: FakeObserver | undefined = page.observers.find(
      (candidate: FakeObserver): boolean => {
        return candidate.entryType === "first-input";
      },
    );

    firstInput?.emit([{ name: "pointerdown", startTime: 300, duration: 64 }]);
    hideTab();

    expect(inps()).toHaveLength(1);
    expect(inps()[0]).toMatchObject({
      value: 64,
      rating: "good",
      navigationType: "hard",
      url: "https://shop.example.com/products",
    });
  });

  it("ignores route changes when vitals are off, and after stop", (): void => {
    const off: FakePage = makePage(["event"]);
    start(off, { captureWebVitals: false });

    expect((): void => {
      navigate(off, 1000, "https://a.example/a", "https://a.example/b");
    }).not.toThrow();
    recorder?.stop();

    const page: FakePage = makePage(["event"]);
    start(page);
    recorder?.stop();

    navigate(page, 1000, "https://a.example/a", "https://a.example/b");
    jest.advanceTimersByTime(INP_VIEW_SETTLE_MS * 2);

    expect(inps()).toHaveLength(0);
  });

  it("reports every open view when the recorder stops", (): void => {
    const page: FakePage = makePage(["event"]);
    start(page);

    eventObserver(page).emit([
      interaction({ id: 1, start: 100, duration: 210 }),
    ]);
    navigate(page, 500, "https://a.example/a", "https://a.example/b");
    eventObserver(page).emit([
      interaction({ id: 2, start: 600, duration: 90 }),
    ]);

    recorder?.stop();

    expect(
      inps().map((event: WebVitalEvent): string => {
        return `${event.url}:${event.value}`;
      }),
    ).toEqual(["https://a.example/a:210", "https://a.example/b:90"]);

    /* The settle timer died with the recorder. */
    jest.advanceTimersByTime(INP_VIEW_SETTLE_MS * 2);
    expect(inps()).toHaveLength(2);
  });
});
