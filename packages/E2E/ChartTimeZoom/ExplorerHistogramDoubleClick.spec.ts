import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";

/*
 * Issue #4116 in a real browser. A drag on an explorer's histogram ("Traces
 * over time", "Log Volume") zooms the explorer, and the histogram then
 * offers "Double-click to reset". The zoom refetches the histogram, and that
 * answer can land at any moment of the double-click that follows. When it
 * lands, recharts redraws the bars (and drops the band a first click
 * painted), so the node a press landed on can leave the page before the
 * press ends, and Chrome dispatches no click and no dblclick for such a
 * press. Every one of these double-clicks must still put the explorer back
 * on its range, without zooming anywhere on the way.
 *
 * The explorers are the production Traces and Logs pages on the offline
 * fixture (Fixture/Fixture.js). The fixture's histogramGate holds the
 * zoomed window's answers until the spec delivers them, so each test picks
 * the moment the data lands:
 *
 *   (a) long before the double-click
 *   (b) after the whole double-click
 *   (c) between the two clicks
 *   (d) during the first press
 *   (e) during the second press
 *
 * each on a bar and on empty plot above the bars, and for (a) also in the
 * chart box's top padding strip, outside recharts' plot. The double-click
 * is a person's: the button held about 55 ms, about 90 ms from the release
 * to the second press, and the second press and release carry click count
 * 2 (MouseEvent.detail 2).
 *
 * The last test does the same on a line chart: the Kubernetes cluster
 * overview's Availability chart (ChartLibrary's LineChart), double-clicked
 * on the line's path while the zoomed aggregates land during the second
 * press.
 *
 * Every test records the pointer events Chrome delivered (capture-phase
 * listeners that change nothing), and whether the node a press landed on
 * was still in the page at its release, and names them in its failure
 * messages.
 */

const PORT: string = "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

/*
 * How long the button stays down for each click of the double-click, and
 * how long from the first release to the second press, on the page's own
 * clock (from the time the page received the mousedown or mouseup).
 */
const PRESS_MS: number = 55;
const GAP_MS: number = 90;
/*
 * A click on a zoomed chart waits this long for a second click before it
 * acts on its own (DOUBLE_CLICK_DISAMBIGUATION_MS). The page must receive
 * the second press well inside it, or the gesture was not a double-click.
 */
const CLICK_WAIT_MS: number = 250;
const LATEST_SECOND_PRESS_MS: number = CLICK_WAIT_MS - 20;
/*
 * A machine too busy to deliver the second press in time gets the whole
 * scenario again, on a fresh page, this many times in all.
 */
const GESTURE_ATTEMPTS: number = 3;
/*
 * After the last release: long enough for a click's wait, a dblclick and
 * any zero-delay work the release scheduled to have run.
 */
const AFTER_GESTURE_MS: number = 3 * CLICK_WAIT_MS;

/*
 * Traces without DOM snapshots or screencast: taking them runs on the
 * page's main thread around every action, between the double-click's
 * events. Failure messages carry the pointer events instead.
 */
test.use({
  trace: { mode: "retain-on-failure", snapshots: false, screenshots: false },
});

const RESET_ZOOM_TEST_ID: string = "reset-time-range-zoom";
const RESET_HINT: string = "Double-click to reset";
// The list's total, "2,120 spans" (TelemetryResultTotal).
const RESULT_TOTAL_TEST_ID: string = "telemetry-result-total";

// Epoch milliseconds.
interface TimeWindow {
  start: number;
  end: number;
}

// A viewport position.
interface Point {
  x: number;
  y: number;
}

interface RecordedWindow {
  start: string | null;
  end: string | null;
}

interface RecordedRequest {
  seq: number;
  kind: string;
  modelName?: string | undefined;
  url?: string | undefined;
  metricName?: string | undefined;
  window?: RecordedWindow | null | undefined;
  // An analytics.count: whether it asked for the exact total, and the answer.
  exact?: boolean | undefined;
  count?: number | undefined;
}

interface HistogramBucket {
  time: string;
  count: number;
}

interface PendingAnswer {
  seq: number;
  url?: string | undefined;
  metricName?: string | undefined;
  window?: RecordedWindow | null | undefined;
  response?: { buckets?: Array<HistogramBucket> | undefined } | null;
}

interface FixtureGate {
  mode: string;
  pending: Array<PendingAnswer>;
  deliver: () => number;
}

interface FixtureState {
  requests: Array<RecordedRequest>;
  unhandled: Array<Record<string, unknown>>;
  histogramGate: FixtureGate;
  aggregateGate: FixtureGate;
}

type GateName = "histogramGate" | "aggregateGate";

// One pointer event Chrome delivered, or the moment the held data landed.
interface PointerRecord {
  type: string;
  detail?: number | undefined;
  target?: string | undefined;
  // On a mouseup: whether the node the press landed on is still in the page.
  pressedNodeConnected?: boolean | null | undefined;
  // performance.now(), rounded.
  at: number;
}

interface SpecWindow {
  __chartTimeZoomFixture: FixtureState;
  __pointerLog?: Array<PointerRecord> | undefined;
  __describeNode?: ((node: EventTarget | null) => string) | undefined;
  __spotKind?: ((x: number, y: number) => string) | undefined;
}

// One column of stacked bars: every series of one bucket.
interface BarColumn {
  center: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface HistogramGeometry {
  columns: Array<BarColumn>;
  // recharts' plot area (its clip rect), in viewport coordinates.
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  // The top of the chart box around recharts (it owns the dblclick handler).
  boxTop: number;
}

// What the landing of held data looked like, from inside the page.
interface Landing {
  delivered: number;
  // Bar columns (or, for a line chart, the first x-axis label) after it.
  shown: string;
  waitedMs: number;
  // What was under the pointer once the new data was drawn.
  under: string;
}

type Moment = "settled" | "before" | "between" | "first-press" | "second-press";
type Spot = "bar" | "empty" | "padding";

interface ExplorerUnderTest {
  name: string;
  path: string;
  // The histogram endpoint, as the request URL ends.
  histogramPath: string;
  // The table the list reads, and what the list's total calls its rows.
  modelName: string;
  itemLabel: string;
  pickerTestId: string;
  initial: { label: string; window: TimeWindow; bucketMs: number };
  // The drag: from the bar of bucket `from` to the bar of bucket `to`.
  drag: { from: string; to: string };
  zoom: { window: TimeWindow; bucketMs: number };
}

// An instant on the fixture's day (UTC): "11:34" or "11:38:30".
function at(clock: string): number {
  const [hours, minutes, seconds]: Array<number> = clock
    .split(":")
    .map((part: string): number => {
      return Number(part);
    });
  return Date.UTC(
    NOW.getUTCFullYear(),
    NOW.getUTCMonth(),
    NOW.getUTCDate(),
    hours || 0,
    minutes || 0,
    seconds || 0,
  );
}

/*
 * Both explorers open on "Past 1 Hour" (11:00 to 12:00 on the pinned
 * clock). The zooms are chosen so the zoomed bars sit over bars of the
 * hour: every third of the Traces explorer's 2-minute bars, every fifth of
 * the Logs explorer's 1-minute bars.
 */
const TRACES_EXPLORER: ExplorerUnderTest = {
  name: "Traces explorer (Traces over time)",
  path: `/dashboard/${PROJECT_ID}/traces`,
  histogramPath: "/telemetry/traces/histogram",
  // Not limited to root spans, every row is a span.
  modelName: "SpanItemV3",
  itemLabel: "spans",
  pickerTestId: "telemetry-time-range-picker-button",
  initial: {
    label: "Past 1 Hour",
    window: { start: at("11:00"), end: at("12:00") },
    /*
     * TracesViewer's computeBucketSizeInMinutes aims at 40 bars and rounds
     * up to whole minutes: 2-minute bars for an hour.
     */
    bucketMs: 2 * MINUTE,
  },
  drag: { from: "11:20", to: "11:28" },
  zoom: { window: { start: at("11:20"), end: at("11:30") }, bucketMs: MINUTE },
};

const LOGS_EXPLORER: ExplorerUnderTest = {
  name: "Logs explorer (Log Volume)",
  path: `/dashboard/${PROJECT_ID}/logs`,
  histogramPath: "/telemetry/logs/histogram",
  modelName: "LogItemV3",
  itemLabel: "logs",
  pickerTestId: "log-time-range-picker-button",
  initial: {
    label: "Past 1 Hour",
    window: { start: at("11:00"), end: at("12:00") },
    // The server's default for an hour (computeDefaultBucketSize).
    bucketMs: MINUTE,
  },
  drag: { from: "11:20", to: "11:31" },
  zoom: { window: { start: at("11:20"), end: at("11:32") }, bucketMs: MINUTE },
};

const MOMENT_TITLES: Record<Moment, string> = {
  settled: "(a) the zoomed data landed long before",
  before: "(b) the zoomed data lands after the double-click",
  between: "(c) the zoomed data lands between the two clicks",
  "first-press": "(d) the zoomed data lands during the first press",
  "second-press": "(e) the zoomed data lands during the second press",
};

const SPOT_TITLES: Record<Spot, string> = {
  bar: "on a bar",
  empty: "on empty plot above the bars",
  padding: "in the chart box's top padding strip",
};

const SCENARIOS: Array<{ moment: Moment; spot: Spot }> = [
  { moment: "settled", spot: "bar" },
  { moment: "settled", spot: "empty" },
  { moment: "settled", spot: "padding" },
  { moment: "before", spot: "bar" },
  { moment: "before", spot: "empty" },
  { moment: "between", spot: "bar" },
  { moment: "between", spot: "empty" },
  { moment: "first-press", spot: "bar" },
  { moment: "first-press", spot: "empty" },
  { moment: "second-press", spot: "bar" },
  { moment: "second-press", spot: "empty" },
];

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __chartTimeZoomFixture?: unknown })
          .__chartTimeZoomFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });
  if (hasFixture) {
    expect(
      await page.evaluate((): Array<Record<string, unknown>> => {
        return JSON.parse(
          JSON.stringify(
            (window as unknown as SpecWindow).__chartTimeZoomFixture.unhandled,
          ),
        ) as Array<Record<string, unknown>>;
      }),
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Time, requests and gates
 * ---------------------------------------------------------------------------
 */

function iso(time: number): string {
  return new Date(time).toISOString();
}

function windowKey(window: TimeWindow): string {
  return `${iso(window.start)} → ${iso(window.end)}`;
}

function recordedKey(window: RecordedWindow | null | undefined): string {
  if (!window || !window.start || !window.end) {
    return "(no window)";
  }
  return `${window.start} → ${window.end}`;
}

function bucketCount(window: TimeWindow, bucketMs: number): number {
  return Math.round((window.end - window.start) / bucketMs);
}

async function requests(page: Page): Promise<Array<RecordedRequest>> {
  return page.evaluate((): Array<RecordedRequest> => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as SpecWindow).__chartTimeZoomFixture.requests,
      ),
    ) as Array<RecordedRequest>;
  });
}

async function requestMark(page: Page): Promise<number> {
  return (await requests(page)).length;
}

// The windows the explorer's histogram asked for since `mark`, in order.
async function histogramWindows(
  page: Page,
  subject: ExplorerUnderTest,
  mark: number,
): Promise<Array<string>> {
  return (await requests(page))
    .slice(mark)
    .filter((request: RecordedRequest): boolean => {
      return (
        request.kind === "api" &&
        Boolean(request.url?.endsWith(subject.histogramPath))
      );
    })
    .map((request: RecordedRequest): string => {
      return recordedKey(request.window);
    });
}

// The counts of the explorer's list total since `mark`, in order.
async function totalCounts(
  page: Page,
  subject: ExplorerUnderTest,
  mark: number,
): Promise<Array<RecordedRequest>> {
  return (await requests(page))
    .slice(mark)
    .filter((request: RecordedRequest): boolean => {
      return (
        request.kind === "analytics.count" &&
        request.modelName === subject.modelName
      );
    });
}

/*
 * The windows the explorer's list total was counted for since `mark`, in
 * order, each marked unless it asked for the exact total.
 */
async function totalCountWindows(
  page: Page,
  subject: ExplorerUnderTest,
  mark: number,
): Promise<Array<string>> {
  return (await totalCounts(page, subject, mark)).map(
    (request: RecordedRequest): string => {
      return `${recordedKey(request.window)}${request.exact ? "" : " (not exact)"}`;
    },
  );
}

/*
 * The distinct windows `metricName`'s aggregates asked for since `mark`, in
 * order (a page's auto-refresh asks for the window it is on again).
 */
async function aggregateWindows(
  page: Page,
  metricName: string,
  mark: number,
): Promise<Array<string>> {
  const windows: Array<string> = (await requests(page))
    .slice(mark)
    .filter((request: RecordedRequest): boolean => {
      return request.kind === "aggregate" && request.metricName === metricName;
    })
    .map((request: RecordedRequest): string => {
      return recordedKey(request.window);
    });
  return windows.filter((key: string, index: number): boolean => {
    return index === 0 || windows[index - 1] !== key;
  });
}

async function setGateMode(
  page: Page,
  gate: GateName,
  mode: "immediate" | "manual",
): Promise<void> {
  await page.evaluate(
    (args: { gate: GateName; mode: string }): void => {
      (window as unknown as SpecWindow).__chartTimeZoomFixture[args.gate].mode =
        args.mode;
    },
    { gate, mode },
  );
}

async function pendingAnswers(
  page: Page,
  gate: GateName,
): Promise<Array<PendingAnswer>> {
  return page.evaluate((name: GateName): Array<PendingAnswer> => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as SpecWindow).__chartTimeZoomFixture[name].pending,
      ),
    ) as Array<PendingAnswer>;
  }, gate);
}

// Answers everything held, and everything asked from now on, at once.
async function openGate(page: Page, gate: GateName): Promise<number> {
  return page.evaluate((name: GateName): number => {
    const target: FixtureGate = (window as unknown as SpecWindow)
      .__chartTimeZoomFixture[name];
    target.mode = "immediate";
    return target.deliver();
  }, gate);
}

/*
 * ---------------------------------------------------------------------------
 * Pointer events
 * ---------------------------------------------------------------------------
 */

/*
 * Capture-phase listeners on the document that record what Chrome
 * delivers. They only read: nothing is prevented or stopped. Also installs
 * two readers the spec uses in the page: how to name a node, and what kind
 * of spot of the explorer's histogram a point is.
 */
async function recordPointerEvents(page: Page): Promise<void> {
  await page.evaluate((): void => {
    const specWindow: SpecWindow = window as unknown as SpecWindow;
    const describe: (node: EventTarget | null) => string = (
      node: EventTarget | null,
    ): string => {
      if (!(node instanceof Element)) {
        return node === document ? "document" : String(node);
      }
      const classes: string = (node.getAttribute("class") || "")
        .split(/\s+/)
        .filter((name: string): boolean => {
          return name.length > 0 && !name.includes(":");
        })
        .slice(0, 3)
        .join(".");
      return `${node.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
    };
    specWindow.__describeNode = describe;
    /*
     * "bar" (a bar of the histogram), "band" (the selection band a click
     * paints), "empty" (the plot with nothing drawn there), "padding" (the
     * chart box around recharts, which owns the dblclick handler).
     */
    specWindow.__spotKind = (x: number, y: number): string => {
      const node: Element | null = document.elementFromPoint(x, y);
      if (!node) {
        return "nothing";
      }
      if (node.closest(".recharts-bar-rectangle")) {
        return "bar";
      }
      if (node.closest(".recharts-reference-area")) {
        return "band";
      }
      if (node.matches(".recharts-wrapper svg.recharts-surface")) {
        return "empty";
      }
      const box: Element | null | undefined = document
        .querySelector(".recharts-wrapper")
        ?.closest(".recharts-responsive-container")?.parentElement;
      if (node === box) {
        return "padding";
      }
      return `other: ${describe(node)}`;
    };
    if (specWindow.__pointerLog) {
      specWindow.__pointerLog.length = 0;
      return;
    }
    const log: Array<PointerRecord> = [];
    specWindow.__pointerLog = log;
    let pressed: EventTarget | null = null;
    const onPointerEvent: (event: Event) => void = (event: Event): void => {
      const entry: PointerRecord = {
        type: event.type,
        detail: (event as MouseEvent).detail,
        target: describe(event.target),
        at: Math.round(performance.now()),
      };
      if (event.type === "mousedown") {
        pressed = event.target;
      }
      if (event.type === "mouseup") {
        entry.pressedNodeConnected =
          pressed instanceof Node ? pressed.isConnected : null;
      }
      log.push(entry);
    };
    for (const type of ["mousedown", "mouseup", "click", "dblclick"]) {
      document.addEventListener(type, onPointerEvent, { capture: true });
    }
  });
}

async function pointerLog(page: Page): Promise<Array<PointerRecord>> {
  return page.evaluate((): Array<PointerRecord> => {
    return JSON.parse(
      JSON.stringify((window as unknown as SpecWindow).__pointerLog || []),
    ) as Array<PointerRecord>;
  });
}

/*
 * "+0ms mousedown(1) on path.recharts-rectangle · +56ms mouseup(1) on …
 * [pressed node still there] · …", times from the first record.
 */
function describePointerLog(log: Array<PointerRecord>): string {
  if (log.length === 0) {
    return "no pointer events recorded";
  }
  const origin: number = log[0]!.at;
  return log
    .map((entry: PointerRecord): string => {
      const time: string = `+${entry.at - origin}ms`;
      if (entry.type === "data landed") {
        return `${time} [data landed: ${entry.target}]`;
      }
      const pressed: string =
        entry.pressedNodeConnected === false
          ? " [pressed node gone]"
          : entry.pressedNodeConnected === true
            ? " [pressed node still there]"
            : "";
      return `${time} ${entry.type}(${entry.detail}) on ${entry.target}${pressed}`;
    })
    .join(" · ");
}

/*
 * Two animation frames: long enough for recharts to have worked out the
 * bucket under the pointer where it now rests.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate((): Promise<void> => {
    return new Promise<void>((resolve: () => void): void => {
      requestAnimationFrame((): void => {
        requestAnimationFrame((): void => {
          resolve();
        });
      });
    });
  });
}

/*
 * Waits, in the page, until `budgetMs` have passed since the page received
 * the latest `type` event (mousedown or mouseup), so the gesture keeps its
 * timing on the page's own clock whatever the round trips cost.
 */
async function holdSince(
  page: Page,
  type: string,
  budgetMs: number,
): Promise<void> {
  await page.evaluate(
    async (args: { type: string; budgetMs: number }): Promise<void> => {
      const log: Array<PointerRecord> =
        (window as unknown as SpecWindow).__pointerLog || [];
      const latest: PointerRecord | undefined = [...log]
        .reverse()
        .find((entry: PointerRecord): boolean => {
          return entry.type === args.type;
        });
      const left: number =
        args.budgetMs - (performance.now() - (latest?.at ?? performance.now()));
      if (left > 0) {
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, left);
        });
      }
    },
    { type, budgetMs },
  );
}

/*
 * A person's double-click at `point`, with the held data landing at
 * `moment` (`land` delivers it and waits until the chart has drawn it).
 * "settled" and "before" land nothing here: the data landed before, or
 * lands after. Returns the landing, if any.
 */
async function doubleClick(
  page: Page,
  point: Point,
  moment: Moment,
  land: () => Promise<Landing>,
): Promise<Landing | null> {
  let landing: Landing | null = null;
  await page.mouse.move(point.x, point.y);
  await settle(page);

  await page.mouse.down({ clickCount: 1 });
  if (moment === "first-press") {
    landing = await land();
  }
  await holdSince(page, "mousedown", PRESS_MS);
  await page.mouse.up({ clickCount: 1 });

  if (moment === "between") {
    landing = await land();
  }
  await holdSince(page, "mouseup", GAP_MS);

  await page.mouse.down({ clickCount: 2 });
  if (moment === "second-press") {
    landing = await land();
  }
  await holdSince(page, "mousedown", PRESS_MS);
  await page.mouse.up({ clickCount: 2 });
  return landing;
}

/*
 * Why the gesture the page received was not the double-click the test
 * means, or null when it was: the second press must reach the page inside
 * the chart's single-click wait, measured on the page's clock. A busy
 * machine can hold an event back past it, and the first click then acts
 * on its own; the scenario is then run again.
 */
function gestureTimingProblem(log: Array<PointerRecord>): string | null {
  const firstRelease: PointerRecord | undefined = log.find(
    (entry: PointerRecord): boolean => {
      return entry.type === "mouseup" && entry.detail === 1;
    },
  );
  const secondPress: PointerRecord | undefined = log.find(
    (entry: PointerRecord): boolean => {
      return entry.type === "mousedown" && entry.detail === 2;
    },
  );
  if (!firstRelease || !secondPress) {
    return `the page did not receive both presses (${describePointerLog(log)})`;
  }
  const gap: number = secondPress.at - firstRelease.at;
  if (gap >= LATEST_SECOND_PRESS_MS) {
    return `the second press reached the page ${gap} ms after the first release, past the chart's ${CLICK_WAIT_MS} ms click wait (${describePointerLog(log)})`;
  }
  return null;
}

// The held data landed exactly when the scenario says, and only then.
function expectLanding(landing: Landing | null, moment: Moment): void {
  if (moment === "settled" || moment === "before") {
    expect(landing, "no data landed during the double-click").toBeNull();
    return;
  }
  expect(landing, `the held data landed ${moment}`).not.toBeNull();
  expect(
    landing!.delivered,
    "held answers delivered mid-gesture",
  ).toBeGreaterThan(0);
}

/*
 * ---------------------------------------------------------------------------
 * The explorers
 * ---------------------------------------------------------------------------
 */

function histogram(page: Page): Locator {
  return page.locator(".recharts-wrapper");
}

async function openExplorer(
  page: Page,
  subject: ExplorerUnderTest,
): Promise<void> {
  // Every fixture value is a function of time; timers keep running.
  await page.clock.setFixedTime(NOW);
  await page.goto(subject.path);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(histogram(page)).toHaveCount(1, { timeout: 30000 });
  await expect
    .poll(
      async (): Promise<number> => {
        return (await histogramGeometry(page)).columns.length;
      },
      { message: "the histogram's bars for the hour", timeout: 30000 },
    )
    .toBe(bucketCount(subject.initial.window, subject.initial.bucketMs));
  await expect(page.getByTestId(subject.pickerTestId)).toHaveText(
    subject.initial.label,
  );
  await expect(page.getByTestId(RESET_ZOOM_TEST_ID)).toHaveCount(0);
  // Lists and facets land after the chart; let the page come to rest.
  await page.waitForTimeout(500);
}

async function histogramGeometry(page: Page): Promise<HistogramGeometry> {
  return histogram(page).evaluate((wrapper: Element): HistogramGeometry => {
    const surface: Element = wrapper.querySelector("svg.recharts-surface")!;
    const surfaceBox: DOMRect = surface.getBoundingClientRect();
    // recharts clips its plot to the chart's offset box.
    const clip: Element | null = surface.querySelector("defs clipPath rect");
    const plotX: number = Number(clip?.getAttribute("x") || 0);
    const plotY: number = Number(clip?.getAttribute("y") || 0);
    const plotWidth: number = Number(clip?.getAttribute("width") || 0);
    const plotHeight: number = Number(clip?.getAttribute("height") || 0);
    const box: Element =
      wrapper.closest(".recharts-responsive-container")?.parentElement ||
      wrapper;

    const columns: Array<BarColumn> = [];
    Array.from(
      wrapper.querySelectorAll(
        ".recharts-bar-rectangle path.recharts-rectangle",
      ),
    )
      .map((path: Element): DOMRect => {
        return path.getBoundingClientRect();
      })
      .filter((rect: DOMRect): boolean => {
        return rect.width > 0 && rect.height > 0;
      })
      .forEach((rect: DOMRect): void => {
        const center: number = rect.left + rect.width / 2;
        const column: BarColumn | undefined = columns.find(
          (candidate: BarColumn): boolean => {
            return Math.abs(candidate.center - center) < 1;
          },
        );
        if (!column) {
          columns.push({
            center,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          });
          return;
        }
        column.left = Math.min(column.left, rect.left);
        column.right = Math.max(column.right, rect.right);
        column.top = Math.min(column.top, rect.top);
        column.bottom = Math.max(column.bottom, rect.bottom);
      });
    columns.sort((left: BarColumn, right: BarColumn): number => {
      return left.center - right.center;
    });

    return {
      columns,
      plotLeft: surfaceBox.left + plotX,
      plotRight: surfaceBox.left + plotX + plotWidth,
      plotTop: surfaceBox.top + plotY,
      plotBottom: surfaceBox.top + plotY + plotHeight,
      boxTop: box.getBoundingClientRect().top,
    };
  });
}

/*
 * A drag from the bar of bucket `subject.drag.from` to the bar of bucket
 * `subject.drag.to`, located from the bars the chart drew: one column per
 * bucket of the initial window, in time order.
 */
async function dragAcrossBars(
  page: Page,
  subject: ExplorerUnderTest,
): Promise<void> {
  const shape: HistogramGeometry = await histogramGeometry(page);
  const indexOf: (clock: string) => number = (clock: string): number => {
    return Math.round(
      (at(clock) - subject.initial.window.start) / subject.initial.bucketMs,
    );
  };
  const from: BarColumn = shape.columns[indexOf(subject.drag.from)]!;
  const to: BarColumn = shape.columns[indexOf(subject.drag.to)]!;
  const y: number = (shape.plotTop + shape.plotBottom) / 2;

  await page.mouse.move(from.center, y);
  await settle(page);
  await page.mouse.down();
  await page.mouse.move(to.center, y, { steps: 12 });
  await settle(page);
  await page.mouse.up();
  // Off the chart, so its tooltip does not sit over the bars.
  await page.mouse.move(2, 2);
}

/*
 * The drag zoomed the explorer: its histogram asked for exactly the zoomed
 * window, and that answer is held. Returns the held buckets.
 */
async function expectZoomHeld(
  page: Page,
  subject: ExplorerUnderTest,
  mark: number,
): Promise<Array<HistogramBucket>> {
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return histogramWindows(page, subject, mark);
      },
      { message: "the drag's zoom asked for its window" },
    )
    .toEqual([windowKey(subject.zoom.window)]);
  const held: Array<PendingAnswer> = (
    await pendingAnswers(page, "histogramGate")
  ).filter((answer: PendingAnswer): boolean => {
    return Boolean(answer.url?.endsWith(subject.histogramPath));
  });
  expect(
    held.map((answer: PendingAnswer): string => {
      return recordedKey(answer.window);
    }),
    "the zoomed window's histogram answer is held",
  ).toEqual([windowKey(subject.zoom.window)]);
  // The zoom is on offer while its data is held.
  await expect(page.getByText(RESET_HINT, { exact: true })).toBeVisible();
  await expect(page.getByTestId(RESET_ZOOM_TEST_ID)).toHaveCount(1);
  return held[0]!.response?.buckets || [];
}

/*
 * Delivers every held answer and waits until the histogram draws
 * `columns` columns of bars, then reports what kind of spot `point` is.
 */
async function landHistogram(
  page: Page,
  columns: number,
  point: Point,
): Promise<Landing> {
  return page.evaluate(
    async (args: {
      columns: number;
      x: number;
      y: number;
    }): Promise<Landing> => {
      const specWindow: SpecWindow = window as unknown as SpecWindow;
      const spotKind: (x: number, y: number) => string =
        specWindow.__spotKind ||
        ((): string => {
          return "unknown";
        });
      const countColumns: () => number = (): number => {
        const centers: Array<number> = [];
        document
          .querySelectorAll(
            ".recharts-wrapper .recharts-bar-rectangle path.recharts-rectangle",
          )
          .forEach((path: Element): void => {
            const rect: DOMRect = path.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
              return;
            }
            const center: number = rect.left + rect.width / 2;
            if (
              !centers.some((known: number): boolean => {
                return Math.abs(known - center) < 1;
              })
            ) {
              centers.push(center);
            }
          });
        return centers.length;
      };
      const started: number = performance.now();
      const delivered: number =
        specWindow.__chartTimeZoomFixture.histogramGate.deliver();
      while (
        countColumns() !== args.columns &&
        performance.now() - started < 5000
      ) {
        await new Promise<void>((resolve: () => void): void => {
          requestAnimationFrame((): void => {
            resolve();
          });
        });
      }
      const landing: Landing = {
        delivered,
        shown: `${countColumns()} bar columns`,
        waitedMs: Math.round(performance.now() - started),
        under: spotKind(args.x, args.y),
      };
      specWindow.__pointerLog?.push({
        type: "data landed",
        target: `${landing.shown} after ${landing.waitedMs}ms, pointer over ${landing.under}`,
        at: Math.round(performance.now()),
      });
      return landing;
    },
    { columns, x: point.x, y: point.y },
  );
}

// What the page reports under `point`.
async function nodeAt(page: Page, point: Point): Promise<string> {
  return page.evaluate((spot: Point): string => {
    const node: Element | null = document.elementFromPoint(spot.x, spot.y);
    const describe: ((node: EventTarget | null) => string) | undefined = (
      window as unknown as SpecWindow
    ).__describeNode;
    return describe ? describe(node) : String(node?.tagName);
  }, point);
}

// What kind of spot of the explorer's histogram `point` is (see __spotKind).
async function spotKind(page: Page, point: Point): Promise<string> {
  return page.evaluate((spot: Point): string => {
    const kind: ((x: number, y: number) => string) | undefined = (
      window as unknown as SpecWindow
    ).__spotKind;
    return kind ? kind(spot.x, spot.y) : "unknown";
  }, point);
}

/*
 * Where to double-click. The x lies inside a bar column both of the chart
 * as drawn now and of the zoomed chart about to land (`incoming`, from the
 * held answer; null when the zoomed chart is the one drawn now), in a
 * column whose bars reach neither the plot's top nor almost nothing:
 *
 * - "bar": 3px above the plot's bottom, inside the column's bars;
 * - "empty": 3px below the plot's top, above the column's bars;
 * - "padding": 4px below the top of the chart box, in its padding strip
 *   above recharts' own area.
 */
async function planSpot(
  page: Page,
  spot: Spot,
  incoming: Array<HistogramBucket> | null,
): Promise<Point> {
  const shape: HistogramGeometry = await histogramGeometry(page);
  const plotHeight: number = shape.plotBottom - shape.plotTop;
  const usable: (column: BarColumn) => boolean = (
    column: BarColumn,
  ): boolean => {
    return (
      column.top > shape.plotTop + 0.12 * plotHeight &&
      column.bottom - column.top > 0.15 * plotHeight
    );
  };

  // The x-ranges the incoming bars will cover, and whether each is usable.
  let incomingRanges: Array<{ left: number; right: number } | null> | null =
    null;
  if (incoming) {
    const totals: Map<string, number> = new Map();
    incoming.forEach((bucket: HistogramBucket): void => {
      totals.set(bucket.time, (totals.get(bucket.time) || 0) + bucket.count);
    });
    const counts: Array<number> = Array.from(totals.values());
    const highest: number = Math.max(...counts);
    const band: number = (shape.plotRight - shape.plotLeft) / counts.length;
    // barCategoryGap 15% and maxBarSize 24, as both histograms draw.
    const halfBar: number = Math.min(24, band * 0.7) / 2;
    /*
     * recharts rounds the y-axis up to a "nice" maximum, so a bar is at
     * most count / highest of the plot's height.
     */
    incomingRanges = counts.map(
      (
        count: number,
        index: number,
      ): { left: number; right: number } | null => {
        const ratio: number = count / highest;
        if (ratio < 0.25 || ratio > 0.85) {
          return null;
        }
        const center: number = shape.plotLeft + (index + 0.5) * band;
        return { left: center - halfBar + 2, right: center + halfBar - 2 };
      },
    );
  }

  const middle: number = (shape.plotLeft + shape.plotRight) / 2;
  const candidates: Array<number> = [];
  for (const column of shape.columns) {
    if (!usable(column)) {
      continue;
    }
    const left: number = column.left + 1.5;
    const right: number = column.right - 1.5;
    if (!incomingRanges) {
      candidates.push(column.center);
      continue;
    }
    for (const range of incomingRanges) {
      if (!range) {
        continue;
      }
      const overlapLeft: number = Math.max(left, range.left);
      const overlapRight: number = Math.min(right, range.right);
      if (overlapRight - overlapLeft >= 4) {
        candidates.push((overlapLeft + overlapRight) / 2);
      }
    }
  }
  candidates.sort((left: number, right: number): number => {
    return Math.abs(left - middle) - Math.abs(right - middle);
  });
  expect(
    candidates.length,
    "a column of bars under both the drawn and the incoming chart",
  ).toBeGreaterThan(0);
  const x: number = candidates[0]!;

  const point: Point =
    spot === "bar"
      ? { x, y: shape.plotBottom - 3 }
      : spot === "empty"
        ? { x, y: shape.plotTop + 3 }
        : { x, y: shape.boxTop + 4 };

  // The pointer rests there during the gesture: check with it there.
  await page.mouse.move(point.x, point.y);
  await settle(page);
  expect(await spotKind(page, point), `the ${spot} spot`).toBe(spot);
  await page.mouse.move(2, 2);
  return point;
}

/*
 * After the gesture: every held answer (the reset's own included) is let
 * through, and the explorer must be back on its initial range, having
 * asked for exactly the zoom and then the initial window.
 */
async function expectBackOnInitialRange(
  page: Page,
  subject: ExplorerUnderTest,
  mark: number,
): Promise<void> {
  await page.waitForTimeout(AFTER_GESTURE_MS);
  // Read now: a click the page was too busy to take at once comes late.
  const events: string = describePointerLog(await pointerLog(page));
  await openGate(page, "histogramGate");

  const check: typeof expect = expect.configure({ soft: true, timeout: 5000 });
  const expected: Array<string> = [
    windowKey(subject.zoom.window),
    windowKey(subject.initial.window),
  ];
  await check
    .poll(
      async (): Promise<Array<string>> => {
        return histogramWindows(page, subject, mark);
      },
      {
        message: `histogram windows asked for after the drag: the zoom, then the initial range, and nothing else. Pointer events: ${events}`,
        timeout: 5000,
      },
    )
    .toEqual(expected);
  await check(
    page.getByTestId(subject.pickerTestId),
    `the toolbar time picker reads the initial preset again. Pointer events: ${events}`,
  ).toHaveText(subject.initial.label);
  await check(
    page.getByTestId(RESET_ZOOM_TEST_ID),
    `"Reset zoom" is gone. Pointer events: ${events}`,
  ).toHaveCount(0);
  await check(
    page.getByText(RESET_HINT, { exact: true }),
    `"${RESET_HINT}" is gone. Pointer events: ${events}`,
  ).toHaveCount(0);
  await check
    .poll(
      async (): Promise<number> => {
        return (await histogramGeometry(page)).columns.length;
      },
      {
        message: "the histogram draws the initial range's bars again",
        timeout: 5000,
      },
    )
    .toBe(bucketCount(subject.initial.window, subject.initial.bucketMs));
  /*
   * The list's total ("2,120 spans", issue #4202) is counted with the
   * list's own query, so it follows the zoom and the reset as the histogram
   * does: counted exactly for the zoom, then for the initial range, whose
   * total the explorer shows again.
   */
  await check
    .poll(
      async (): Promise<Array<string>> => {
        return totalCountWindows(page, subject, mark);
      },
      {
        message: `the list's total was counted for the zoom, then the initial range, each exactly. Pointer events: ${events}`,
        timeout: 5000,
      },
    )
    .toEqual(expected);
  const initialTotal: number | undefined = (
    await totalCounts(page, subject, mark)
  ).pop()?.count;
  await check(
    page.getByTestId(RESULT_TOTAL_TEST_ID),
    `the list's total is the initial range's again. Pointer events: ${events}`,
  ).toHaveText(
    `${(initialTotal ?? NaN).toLocaleString("en-US")} ${subject.itemLabel}`,
  );

  // Nothing late: no zoom fires after the page came back.
  await page.waitForTimeout(AFTER_GESTURE_MS);
  check(
    await histogramWindows(page, subject, mark),
    `no histogram request after the reset. Pointer events: ${events}`,
  ).toEqual(expected);
  check(
    await totalCountWindows(page, subject, mark),
    `no count after the reset. Pointer events: ${events}`,
  ).toEqual(expected);
}

/*
 * One run of a scenario on a fresh page: open the explorer, drag, hold the
 * zoom's answers, double-click with them landing at the scenario's moment.
 * Returns the request mark taken before the drag, and why the gesture the
 * page received was not a double-click (null when it was).
 */
async function doubleClickRightAfterDrag(
  page: Page,
  subject: ExplorerUnderTest,
  scenario: { moment: Moment; spot: Spot },
): Promise<{ mark: number; timingProblem: string | null }> {
  await openExplorer(page, subject);
  await recordPointerEvents(page);
  await setGateMode(page, "histogramGate", "manual");

  const mark: number = await requestMark(page);
  await dragAcrossBars(page, subject);
  const incoming: Array<HistogramBucket> = await expectZoomHeld(
    page,
    subject,
    mark,
  );
  const zoomColumns: number = bucketCount(
    subject.zoom.window,
    subject.zoom.bucketMs,
  );

  let point: Point;
  if (scenario.moment === "settled") {
    // The zoomed bars are drawn and at rest before the double-click.
    const settled: Landing = await landHistogram(page, zoomColumns, {
      x: 2,
      y: 2,
    });
    expect(settled.shown, "the zoomed bars").toBe(`${zoomColumns} bar columns`);
    await page.waitForTimeout(300);
    point = await planSpot(page, scenario.spot, null);
  } else {
    point = await planSpot(page, scenario.spot, incoming);
  }

  await recordPointerEvents(page);
  const landing: Landing | null = await doubleClick(
    page,
    point,
    scenario.moment,
    (): Promise<Landing> => {
      return landHistogram(page, zoomColumns, point);
    },
  );
  const log: Array<PointerRecord> = await pointerLog(page);
  expectLanding(landing, scenario.moment);
  if (landing) {
    expect(landing.shown, `the zoomed bars landed ${scenario.moment}`).toBe(
      `${zoomColumns} bar columns`,
    );
    /*
     * The spot is the same kind of spot on the zoomed bars (a band a first
     * click painted may lie over empty plot).
     */
    expect(
      landing.under,
      `under the pointer once the zoomed bars landed (${describePointerLog(log)})`,
    ).toMatch(scenario.spot === "bar" ? /^bar$/ : /^(empty|band)$/);
  }
  return { mark, timingProblem: gestureTimingProblem(log) };
}

for (const subject of [TRACES_EXPLORER, LOGS_EXPLORER]) {
  test.describe(`${subject.name}: a double-click right after a drag resets the zoom`, () => {
    for (const scenario of SCENARIOS) {
      test(`${MOMENT_TITLES[scenario.moment]}: a double-click ${SPOT_TITLES[scenario.spot]}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        const problems: Array<string> = [];
        for (let attempt: number = 1; attempt <= GESTURE_ATTEMPTS; attempt++) {
          const run: { mark: number; timingProblem: string | null } =
            await doubleClickRightAfterDrag(page, subject, scenario);
          if (run.timingProblem === null) {
            await expectBackOnInitialRange(page, subject, run.mark);
            return;
          }
          problems.push(`attempt ${attempt}: ${run.timingProblem}`);
          test.info().annotations.push({
            type: "gesture re-run",
            description: `attempt ${attempt}: ${run.timingProblem}`,
          });
        }
        throw new Error(
          `The page never received a double-click in time: ${problems.join("; ")}`,
        );
      });
    }
  });
}

/*
 * ---------------------------------------------------------------------------
 * A line chart: the Kubernetes cluster overview's Availability chart
 *
 * ChartLibrary's LineChart, with its transparent 12px click target over the
 * line. It is the overview's one full-width chart: the four below it are
 * 141px wide at this viewport, their buckets under 5px apart, so the dot
 * recharts draws at the hovered bucket covers every spot of their lines.
 * ---------------------------------------------------------------------------
 */

const OVERVIEW_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`;
const OVERVIEW_CHARTS: Array<string> = [
  "Availability",
  "CPU",
  "Memory",
  "Filesystem",
  "Network",
];
const OVERVIEW_INITIAL: { label: string; window: TimeWindow } = {
  label: "Past 30 Minutes",
  window: { start: at("11:30"), end: at("12:00") },
};
const LINE_CHART: string = "Availability";
// Its data: the heartbeat metric, one sample a minute.
const LINE_METRIC: string = "oneuptime.host.heartbeat";
// A drag from bucket 11:34 to bucket 11:40 (1-minute buckets).
const OVERVIEW_DRAG: { from: string; to: string } = {
  from: "11:34",
  to: "11:40",
};
const OVERVIEW_ZOOM: TimeWindow = { start: at("11:34"), end: at("11:41") };

interface Tick {
  label: string;
  // Viewport x of the bucket the label names.
  x: number;
}

interface LineChartGeometry {
  ticks: Array<Tick>;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overviewCharts(page: Page): Locator {
  return page.locator(".recharts-wrapper");
}

// An overview chart's title: the caption of the card that holds only it.
async function overviewChartTitles(page: Page): Promise<Array<string>> {
  return overviewCharts(page).evaluateAll(
    (wrappers: Array<Element>): Array<string> => {
      return wrappers.map((wrapper: Element): string => {
        let node: Element | null = wrapper.parentElement;
        while (
          node &&
          node.querySelectorAll(".recharts-wrapper").length === 1
        ) {
          const caption: Element | null = node.querySelector("span.uppercase");
          if (caption) {
            return (caption.textContent || "").trim();
          }
          node = node.parentElement;
        }
        return "";
      });
    },
  );
}

async function overviewChartIndex(page: Page, title: string): Promise<number> {
  const index: number = (await overviewChartTitles(page)).indexOf(title);
  expect(index, `a chart titled "${title}"`).toBeGreaterThanOrEqual(0);
  return index;
}

async function lineChartGeometry(chart: Locator): Promise<LineChartGeometry> {
  return chart.evaluate((wrapper: Element): LineChartGeometry => {
    const surfaceBox: DOMRect = wrapper
      .querySelector("svg.recharts-surface")!
      .getBoundingClientRect();
    const plot: DOMRect = wrapper
      .querySelector(".recharts-cartesian-grid")!
      .getBoundingClientRect();
    return {
      ticks: Array.from(
        wrapper.querySelectorAll(
          ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
        ),
      ).map((text: Element): Tick => {
        return {
          label: (text.textContent || "").trim(),
          x: surfaceBox.left + Number(text.getAttribute("x")),
        };
      }),
      left: plot.left,
      right: plot.right,
      top: plot.top,
      bottom: plot.bottom,
    };
  });
}

// Where the bucket starting at `time` sits (evenly spaced, one per minute).
function lineBucketX(shape: LineChartGeometry, time: number): number {
  const first: Tick = shape.ticks[0]!;
  const last: Tick = shape.ticks[shape.ticks.length - 1]!;
  const spacing: number =
    (last.x - first.x) / ((at(last.label) - at(first.label)) / MINUTE);
  return first.x + ((time - at(first.label)) / MINUTE) * spacing;
}

/*
 * A spot on a line chart's line, about 55% across: halfway between two of
 * its data points, so the dot recharts draws at the hovered bucket is half
 * a bucket away. With the pointer resting on it, the page must report a
 * curve (the line or its transparent click target), not a dot.
 */
async function linePathPoint(page: Page, chartIndex: number): Promise<Point> {
  const chart: Locator = overviewCharts(page).nth(chartIndex);
  await chart.scrollIntoViewIfNeeded();
  const candidates: Array<Point> = await chart.evaluate(
    (wrapper: Element): Array<Point> => {
      const plot: DOMRect = wrapper
        .querySelector(".recharts-cartesian-grid")!
        .getBoundingClientRect();
      const curve: SVGPathElement | null = wrapper.querySelector(
        "g.recharts-line:not(.cursor-pointer) path.recharts-line-curve",
      );
      const matrix: DOMMatrix | null | undefined = curve?.getScreenCTM();
      if (!curve || !matrix) {
        return [];
      }
      const toScreen: (x: number, y: number) => Point = (
        x: number,
        y: number,
      ): Point => {
        const point: DOMPoint = new DOMPoint(x, y).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      };
      // The data points are where the path's segments end.
      const vertices: Array<Point> = [];
      const commands: Array<string> =
        (curve.getAttribute("d") || "").match(/[MLC][^MLC]*/g) || [];
      for (const command of commands) {
        const numbers: Array<number> = (
          command.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []
        ).map((value: string): number => {
          return Number(value);
        });
        const size: number = command.startsWith("C") ? 6 : 2;
        for (
          let offset: number = 0;
          offset + size <= numbers.length;
          offset += size
        ) {
          vertices.push(
            toScreen(numbers[offset + size - 2]!, numbers[offset + size - 1]!),
          );
        }
      }
      // The curve's height between two data points, read off the path.
      const length: number = curve.getTotalLength();
      const samples: Array<Point> = [];
      for (let step: number = 0; step <= 2000; step++) {
        const local: DOMPoint = curve.getPointAtLength((length * step) / 2000);
        samples.push(toScreen(local.x, local.y));
      }
      const target: number = plot.left + plot.width * 0.55;
      const points: Array<Point> = [];
      for (let index: number = 0; index + 1 < vertices.length; index++) {
        const x: number = (vertices[index]!.x + vertices[index + 1]!.x) / 2;
        let nearest: Point | null = null;
        for (const sample of samples) {
          if (!nearest || Math.abs(sample.x - x) < Math.abs(nearest.x - x)) {
            nearest = sample;
          }
        }
        if (nearest) {
          points.push({ x, y: nearest.y });
        }
      }
      return points.sort((left: Point, right: Point): number => {
        return Math.abs(left.x - target) - Math.abs(right.x - target);
      });
    },
  );
  expect(
    candidates.length,
    "points halfway between the line's data points",
  ).toBeGreaterThan(0);

  for (const candidate of candidates.slice(0, 12)) {
    await page.mouse.move(candidate.x, candidate.y);
    await settle(page);
    const under: string = await page.evaluate((spot: Point): string => {
      const node: Element | null = document.elementFromPoint(spot.x, spot.y);
      if (!node) {
        return "nothing";
      }
      if (node.closest(".recharts-dot, .recharts-active-dot")) {
        return "dot";
      }
      return node.matches("path.recharts-curve") ? "curve" : "other";
    }, candidate);
    if (under === "curve") {
      return candidate;
    }
  }
  throw new Error("No spot on the line is clear of its dots");
}

// "11:34" or "11:34:00": the x-axis label of the minute `clock`.
function minuteLabelPattern(clock: string): string {
  return `^${clock}(:00)?$`;
}

// The chart at `chartIndex`'s first x-axis label.
async function firstTickLabel(page: Page, chartIndex: number): Promise<string> {
  const shape: LineChartGeometry = await lineChartGeometry(
    overviewCharts(page).nth(chartIndex),
  );
  return shape.ticks[0]?.label || "";
}

/*
 * Waits until no chart is still moving: after its data changes, recharts
 * may animate a line from its old points to its new ones.
 */
async function expectChartsSettled(page: Page): Promise<void> {
  let previous: string = "";
  await expect
    .poll(
      async (): Promise<boolean> => {
        const current: string = await page
          .locator(".recharts-wrapper path")
          .evaluateAll((paths: Array<Element>): string => {
            return paths
              .map((item: Element): string => {
                return item.getAttribute("d") || "";
              })
              .join("|");
          });
        const isSettled: boolean = current.length > 0 && current === previous;
        previous = current;
        return isSettled;
      },
      { message: "every chart's lines at rest", intervals: [300] },
    )
    .toBe(true);
}

/*
 * Delivers the held aggregates and waits until the chart at `chartIndex`
 * draws the zoomed window (its first x-axis label matches `labelPattern`).
 */
async function landAggregates(
  page: Page,
  chartIndex: number,
  labelPattern: string,
  point: Point,
): Promise<Landing> {
  return page.evaluate(
    async (args: {
      index: number;
      pattern: string;
      x: number;
      y: number;
    }): Promise<Landing> => {
      const specWindow: SpecWindow = window as unknown as SpecWindow;
      const describe: (node: EventTarget | null) => string =
        specWindow.__describeNode ||
        ((node: EventTarget | null): string => {
          return String(node);
        });
      const label: RegExp = new RegExp(args.pattern);
      const firstTick: () => string = (): string => {
        const wrapper: Element | undefined =
          document.querySelectorAll(".recharts-wrapper")[args.index];
        return (
          wrapper
            ?.querySelector(
              ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
            )
            ?.textContent?.trim() || ""
        );
      };
      const started: number = performance.now();
      const delivered: number =
        specWindow.__chartTimeZoomFixture.aggregateGate.deliver();
      while (!label.test(firstTick()) && performance.now() - started < 5000) {
        await new Promise<void>((resolve: () => void): void => {
          requestAnimationFrame((): void => {
            resolve();
          });
        });
      }
      const landing: Landing = {
        delivered,
        shown: `first x-axis label ${firstTick()}`,
        waitedMs: Math.round(performance.now() - started),
        under: describe(document.elementFromPoint(args.x, args.y)),
      };
      specWindow.__pointerLog?.push({
        type: "data landed",
        target: `${landing.shown} after ${landing.waitedMs}ms, pointer over ${landing.under}`,
        at: Math.round(performance.now()),
      });
      return landing;
    },
    { index: chartIndex, pattern: labelPattern, x: point.x, y: point.y },
  );
}

function overviewPicker(page: Page): Locator {
  return page.getByTestId("telemetry-time-range-picker-button");
}

/*
 * One run on a fresh page: open the overview, zoom with a drag on the line
 * chart, hold the zoom's aggregates, double-click the line's path with them
 * landing during the second press. Returns the request mark taken before
 * the drag, the chart's index, and why the gesture the page received was
 * not a double-click (null when it was).
 */
async function doubleClickLineRightAfterDrag(page: Page): Promise<{
  mark: number;
  chartIndex: number;
  timingProblem: string | null;
}> {
  await page.clock.setFixedTime(NOW);
  await page.goto(OVERVIEW_PATH);
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return overviewChartTitles(page);
      },
      { message: "the overview's charts", timeout: 30000 },
    )
    .toEqual(OVERVIEW_CHARTS);
  await expect(overviewPicker(page)).toHaveText(OVERVIEW_INITIAL.label);
  const chartIndex: number = await overviewChartIndex(page, LINE_CHART);
  // Every chart drawn and at rest on the initial range.
  await expect
    .poll(
      async (): Promise<string> => {
        return firstTickLabel(page, chartIndex);
      },
      { message: `the ${LINE_CHART} chart on the initial range` },
    )
    .toMatch(new RegExp(minuteLabelPattern("11:30")));
  await expectChartsSettled(page);

  await recordPointerEvents(page);
  await setGateMode(page, "aggregateGate", "manual");
  const mark: number = await requestMark(page);

  // The drag, across the chart's buckets.
  const chart: Locator = overviewCharts(page).nth(chartIndex);
  await chart.scrollIntoViewIfNeeded();
  const shape: LineChartGeometry = await lineChartGeometry(chart);
  const middle: number = (shape.top + shape.bottom) / 2;
  await page.mouse.move(lineBucketX(shape, at(OVERVIEW_DRAG.from)), middle);
  await settle(page);
  await page.mouse.down();
  await page.mouse.move(lineBucketX(shape, at(OVERVIEW_DRAG.to)), middle, {
    steps: 12,
  });
  await settle(page);
  await page.mouse.up();
  await page.mouse.move(2, 2);

  // The zoom asked for its window; every aggregate answer is held.
  await expect(overviewPicker(page)).not.toHaveText(OVERVIEW_INITIAL.label);
  await expect(page.getByTestId(RESET_ZOOM_TEST_ID)).toHaveCount(1);
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return (await pendingAnswers(page, "aggregateGate"))
          .filter((answer: PendingAnswer): boolean => {
            return answer.metricName === LINE_METRIC;
          })
          .map((answer: PendingAnswer): string => {
            return recordedKey(answer.window);
          });
      },
      { message: `the ${LINE_CHART} chart's zoomed aggregate is held` },
    )
    .toEqual([windowKey(OVERVIEW_ZOOM)]);

  const point: Point = await linePathPoint(page, chartIndex);
  expect(
    await nodeAt(page, point),
    "with the pointer resting there, it is over the line's path",
  ).toMatch(/^path\.recharts-curve/);

  await recordPointerEvents(page);
  const zoomedLabel: string = minuteLabelPattern(OVERVIEW_DRAG.from);
  const landing: Landing | null = await doubleClick(
    page,
    point,
    "second-press",
    (): Promise<Landing> => {
      return landAggregates(page, chartIndex, zoomedLabel, point);
    },
  );
  const log: Array<PointerRecord> = await pointerLog(page);
  expectLanding(landing, "second-press");
  expect(
    landing!.shown,
    `the zoomed ${LINE_CHART} chart landed during the second press (${describePointerLog(log)})`,
  ).toMatch(new RegExp(`^first x-axis label ${zoomedLabel.slice(1)}`));
  return { mark, chartIndex, timingProblem: gestureTimingProblem(log) };
}

test.describe("Kubernetes cluster overview: a double-click on a line right after a drag", () => {
  test("(e) the zoomed aggregates land during the second press on the Availability chart's line: the page is back on its range", async ({
    page,
  }: {
    page: Page;
  }) => {
    const problems: Array<string> = [];
    for (let attempt: number = 1; attempt <= GESTURE_ATTEMPTS; attempt++) {
      const run: {
        mark: number;
        chartIndex: number;
        timingProblem: string | null;
      } = await doubleClickLineRightAfterDrag(page);
      if (run.timingProblem !== null) {
        problems.push(`attempt ${attempt}: ${run.timingProblem}`);
        test.info().annotations.push({
          type: "gesture re-run",
          description: `attempt ${attempt}: ${run.timingProblem}`,
        });
        continue;
      }

      await page.waitForTimeout(AFTER_GESTURE_MS);
      // Read now: a click the page was too busy to take at once comes late.
      const events: string = describePointerLog(await pointerLog(page));
      await openGate(page, "aggregateGate");

      const check: typeof expect = expect.configure({
        soft: true,
        timeout: 5000,
      });
      await check(
        overviewPicker(page),
        `the time picker reads the initial preset again. Pointer events: ${events}`,
      ).toHaveText(OVERVIEW_INITIAL.label);
      await check(
        page.getByTestId(RESET_ZOOM_TEST_ID),
        `"Reset zoom" is gone. Pointer events: ${events}`,
      ).toHaveCount(0);
      await check
        .poll(
          async (): Promise<Array<string>> => {
            return aggregateWindows(page, LINE_METRIC, run.mark);
          },
          {
            message: `the ${LINE_CHART} chart asked for the zoom, then the initial range, and nothing else. Pointer events: ${events}`,
            timeout: 5000,
          },
        )
        .toEqual([
          windowKey(OVERVIEW_ZOOM),
          windowKey(OVERVIEW_INITIAL.window),
        ]);
      await check
        .poll(
          async (): Promise<string> => {
            return firstTickLabel(page, run.chartIndex);
          },
          {
            message: `the ${LINE_CHART} chart is back on the initial range`,
            timeout: 5000,
          },
        )
        .toMatch(new RegExp(minuteLabelPattern("11:30")));
      return;
    }
    throw new Error(
      `The page never received a double-click in time: ${problems.join("; ")}`,
    );
  });
});
