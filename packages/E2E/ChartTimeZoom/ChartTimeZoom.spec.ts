import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * Issue #4105 in a real browser. On every time-series chart, a drag selects
 * a time slice and that slice becomes the time range of the WHOLE page:
 * every chart re-queries and redraws for it, the page's time picker shows
 * the custom range and a "Reset zoom" button appears beside it. A
 * double-click on ANY chart, or Reset zoom (mouse or keyboard), puts back
 * the range the page had before the zoom, climbing out of nested zooms in
 * one go. Picking a range in the time picker ends the zoom.
 *
 * Renders the real pages against the offline fixture (Fixture/Fixture.js):
 * the Kubernetes cluster Overview and Insights and the Host Overview, each
 * inside its production View layout. Only the data boundary and the
 * signed-in user are synthetic. Every gesture is a real pointer gesture
 * (page.mouse) across a chart's plot, located from the chart's own x-axis.
 * Every test pins the browser clock to the fixture's NOW, puts up a network
 * fence, and fails on an uncaught page error, on a request the fixture does
 * not model and on any request the fence had to abort.
 *
 * Pointer timing: recharts 3 hands the chart's mousedown and mouseup
 * handlers the bucket its mousemove handler recorded, and it runs that
 * handler on the next animation frame. A person's pointer rests on a
 * bucket for longer than a frame before pressing or releasing, so the
 * gestures here let two frames pass before every press and release (see
 * settle()).
 *
 * Where a double-click lands: the reset scenarios double-click a settled
 * chart on a spot of the plot that no series covers (emptyPlotPoint()). A
 * double-click ON a line is its own scenario, because today it never
 * resets (see the "on a line" test).
 */

const PORT: string = "4233";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const HOST_ID: string = "62000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/chart-time-zoom-ui",
);

const RESET_ZOOM_TEST_ID: string = "reset-time-range-zoom";
const PAGE_PICKER_TEST_ID: string = "telemetry-time-range-picker-button";

// TimeRangeZoomHint: a chart card's or section's hint, revealed on hover.
const HINT_TEST_ID: string = "time-range-zoom-hint";
const HINT_TEXT: string = "Drag to zoom";
const HINT_RESET_TEXT: string = "Double-click to reset";
// ChartGroup's always-shown hint line above each MetricView chart.
const GROUP_HINT_RESET_TEXT: string = "Drag to zoom · double-click to reset";

// Epoch milliseconds.
interface TimeWindow {
  start: number;
  end: number;
}

interface RecordedWindow {
  column?: string | undefined;
  start: string | null;
  end: string | null;
}

interface RecordedRequest {
  seq: number;
  kind: string;
  modelName?: string | undefined;
  metricName?: string | undefined;
  window?: RecordedWindow | null | undefined;
  query?: Record<string, unknown> | null | undefined;
  method?: string | undefined;
  url?: string | undefined;
}

interface UnhandledRequest {
  kind: string;
  modelName?: string | undefined;
  metricName?: string | undefined;
  method?: string | undefined;
  url?: string | undefined;
}

interface FixtureState {
  now: string;
  requests: Array<RecordedRequest>;
  unhandled: Array<UnhandledRequest>;
}

interface Tick {
  label: string;
  // Viewport x of the bucket the label names.
  x: number;
}

interface ChartGeometry {
  ticks: Array<Tick>;
  // The plot area (the cartesian grid), in viewport coordinates.
  left: number;
  right: number;
  top: number;
  bottom: number;
  middle: number;
  // The bottom edge of the whole chart, axis labels included.
  chartBottom: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A viewport position.
interface Point {
  x: number;
  y: number;
}

/*
 * A drag from the bucket labelled `from` to the bucket labelled `to`
 * ("HH:mm" or "HH:mm:ss", UTC, on the fixture's day). The page zooms to
 * the start of the first bucket up to the END of the last one.
 */
interface DragPlan {
  chart: string;
  from: string;
  to: string;
}

interface PageUnderTest {
  name: string;
  // Screenshot prefix.
  slug: string;
  path: string;
  // Every time-series chart on the page, in document order.
  charts: Array<string>;
  /*
   * "page": one TelemetryTimeRangePicker in the page header.
   * "card": every EmbeddedMetricCard carries its own picker over the
   * page's shared range.
   */
  picker: "page" | "card";
  initial: { label: string; range: string; window: TimeWindow };
  /*
   * Every aggregate queried over the page's range: after a zoom (or a
   * reset) each must have been asked for exactly the new window, and for
   * no other.
   */
  rangeMetrics: Array<string>;
  /*
   * Of those, the ones MetricView reads through MetricUtil's short-lived
   * result cache. Returning to a window the page already fetched may be
   * served from that cache, so those need not be asked again; with the
   * browser clock pinned the cache never expires.
   */
  cachedMetrics: Array<string>;
  /*
   * Aggregates scoped to the last five minutes of the page's range (the
   * host's Processes tile).
   */
  tileMetrics: Array<string>;
  // List reads scoped to the page's range (exemplars, event overlays).
  rangeLists: Array<string>;
  zoom: DragPlan;
  outside: DragPlan;
  // A second drag inside `zoom`.
  nested: DragPlan;
  // A chart other than zoom.chart, for the double-click.
  otherChart: string;
  // A line chart (ChartLibrary LineChart) for the double-click on a line.
  lineChart: string;
  preset: { option: string; label: string; window: TimeWindow };
  resetButtons: number;
  hints: {
    // TimeRangeZoomHints, each revealed while the pointer is over its card.
    card: number;
    // ChartGroup hint lines, one per MetricView chart, always shown.
    group: number;
    // A chart whose card (or section) hint the spec reveals by hovering it.
    hoverChart: string;
  };
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

const KUBERNETES_OVERVIEW: PageUnderTest = {
  name: "Kubernetes cluster overview",
  slug: "kubernetes-overview",
  path: `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`,
  charts: ["Availability", "CPU", "Memory", "Filesystem", "Network"],
  picker: "page",
  initial: {
    label: "Past 30 Minutes",
    range: "Past 30 Mins",
    window: { start: at("11:30"), end: at("12:00") },
  },
  rangeMetrics: [
    "k8s.node.cpu.utilization",
    "k8s.node.memory.usage",
    "k8s.node.filesystem.usage",
    "k8s.node.filesystem.available",
    "k8s.node.network.io",
    "oneuptime.host.heartbeat",
  ],
  cachedMetrics: [],
  tileMetrics: [],
  rangeLists: [],
  // worker-2's batch spike peaks at 11:43.
  zoom: { chart: "CPU", from: "11:34", to: "11:40" },
  outside: { chart: "Memory", from: "11:42", to: "11:51" },
  nested: { chart: "Availability", from: "11:36:00", to: "11:38:30" },
  otherChart: "Network",
  lineChart: "Network",
  preset: {
    option: "Past 1 Hour",
    label: "Past 1 Hour",
    window: { start: at("11:00"), end: at("12:00") },
  },
  resetButtons: 1,
  // One under each chart card's header.
  hints: { card: 5, group: 0, hoverChart: "CPU" },
};

const HOST_OVERVIEW: PageUnderTest = {
  name: "Host overview",
  slug: "host-overview",
  path: `/dashboard/${PROJECT_ID}/host/${HOST_ID}`,
  charts: ["Availability", "CPU", "Memory", "Disk space", "Network"],
  picker: "page",
  initial: {
    label: "Past 30 Minutes",
    range: "Past 30 Mins",
    window: { start: at("11:30"), end: at("12:00") },
  },
  rangeMetrics: [
    "system.cpu.utilization",
    "system.memory.utilization",
    "system.cpu.load_average.1m",
    "system.processes.count",
    "system.filesystem.usage",
    "system.network.io",
    "oneuptime.host.heartbeat",
  ],
  cachedMetrics: [],
  tileMetrics: ["process.cpu.utilization"],
  rangeLists: [],
  // The gateway's CPU burst peaks at 11:43.
  zoom: { chart: "CPU", from: "11:34", to: "11:40" },
  outside: { chart: "Disk space", from: "11:42", to: "11:51" },
  nested: { chart: "Availability", from: "11:36:00", to: "11:38:30" },
  otherChart: "Memory",
  lineChart: "Network",
  preset: {
    option: "Past 1 Hour",
    label: "Past 1 Hour",
    window: { start: at("11:00"), end: at("12:00") },
  },
  resetButtons: 1,
  // One per section: Availability, and the Resource usage row.
  hints: { card: 2, group: 0, hoverChart: "CPU" },
};

const KUBERNETES_INSIGHTS: PageUnderTest = {
  name: "Kubernetes cluster insights",
  slug: "kubernetes-insights",
  path: `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/insights`,
  charts: [
    "Node CPU Utilization",
    "Node Memory Usage",
    "Node Filesystem Usage",
    "Network",
    "Pod CPU Utilization",
    "Pod Memory Usage",
  ],
  picker: "card",
  initial: {
    label: "Past 1 Hour",
    range: "Past 1 Hour",
    window: { start: at("11:00"), end: at("12:00") },
  },
  rangeMetrics: [
    "k8s.node.cpu.utilization",
    "k8s.node.memory.usage",
    "k8s.node.filesystem.usage",
    "k8s.node.network.io",
    "k8s.pod.cpu.utilization",
    "k8s.pod.memory.usage",
  ],
  cachedMetrics: [
    "k8s.node.cpu.utilization",
    "k8s.node.memory.usage",
    "k8s.node.filesystem.usage",
    "k8s.pod.cpu.utilization",
    "k8s.pod.memory.usage",
  ],
  tileMetrics: [],
  rangeLists: ["MetricItemV3", "Incident", "Alert", "ChangeEventV1"],
  zoom: { chart: "Node CPU Utilization", from: "11:14", to: "11:33" },
  outside: { chart: "Node Memory Usage", from: "11:40", to: "11:52" },
  nested: { chart: "Pod Memory Usage", from: "11:20", to: "11:25" },
  otherChart: "Pod CPU Utilization",
  // KubernetesNetworkThroughputChart: the page's one ChartLibrary line chart.
  lineChart: "Network",
  preset: {
    option: "Past 3 Hours",
    label: "Past 3 Hours",
    window: { start: at("09:00"), end: at("12:00") },
  },
  resetButtons: 3,
  // The network chart's hint row, and ChartGroup's line on the others.
  hints: { card: 1, group: 5, hoverChart: "Network" },
};

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
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Time and labels
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

/*
 * The width of one x-axis bucket for a window: the ladder of
 * XAxisUtil.getPrecision (Charts/Utils/XAxis.ts) for the windows these
 * pages chart.
 */
function bucketMs(window: TimeWindow): number {
  const seconds: number = (window.end - window.start) / SECOND;
  if (seconds <= 15) {
    return SECOND;
  }
  if (seconds <= 75) {
    return 5 * SECOND;
  }
  if (seconds <= 150) {
    return 10 * SECOND;
  }
  if (seconds <= 450) {
    return 30 * SECOND;
  }
  if (seconds <= 3 * 60 * 60) {
    return MINUTE;
  }
  if (seconds <= 12 * 60 * 60) {
    return 5 * MINUTE;
  }
  throw new Error(`No bucket width modelled for a ${seconds}s window`);
}

/*
 * The window a drag zooms to: from the start of the first bucket to the
 * END of the last, never past the end of the range the page was on.
 */
function zoomOf(plan: DragPlan, current: TimeWindow): TimeWindow {
  return {
    start: at(plan.from),
    end: Math.min(at(plan.to) + bucketMs(current), current.end),
  };
}

// "Sep 21, 11:34 AM" — TimeRangePickerDropdown's custom label, en-US.
function shortDateTime(time: number): string {
  const date: Date = new Date(time);
  const hours: number = date.getUTCHours();
  const minutes: string = String(date.getUTCMinutes()).padStart(2, "0");
  const month: string = date.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${month} ${date.getUTCDate()}, ${hours % 12 || 12}:${minutes} ${
    hours < 12 ? "AM" : "PM"
  }`;
}

/*
 * "Sep 21 2026, 11:14:00 AM GMT" — the EmbeddedMetricCard picker's custom
 * label (RangeStartAndEndDateView), en-US. The zone abbreviation is the
 * browser's, so any single word is accepted there.
 */
function longDateTimePattern(time: number): string {
  const date: Date = new Date(time);
  const hours: number = date.getUTCHours();
  const month: string = date.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const pad: (value: number) => string = (value: number): string => {
    return String(value).padStart(2, "0");
  };
  return `${month} ${pad(date.getUTCDate())} ${date.getUTCFullYear()}, ${pad(
    hours % 12 || 12,
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${
    hours < 12 ? "AM" : "PM"
  } \\S+`;
}

function customLabel(
  subject: PageUnderTest,
  window: TimeWindow,
): string | RegExp {
  if (subject.picker === "page") {
    return `${shortDateTime(window.start)} – ${shortDateTime(window.end)}`;
  }
  return new RegExp(
    `^${longDateTimePattern(window.start)} - ${longDateTimePattern(
      window.end,
    )}$`,
  );
}

const TICK_LABEL: RegExp = /^\d{2}:\d{2}(:\d{2})?$/;

// An x-axis label ("11:34", "11:34:30") as an instant on the fixture's day.
function tickTime(label: string): number {
  if (!TICK_LABEL.test(label)) {
    throw new Error(`Unexpected x-axis label "${label}"`);
  }
  return at(label);
}

/*
 * ---------------------------------------------------------------------------
 * Fixture and request log
 * ---------------------------------------------------------------------------
 */

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __chartTimeZoomFixture: FixtureState })
          .__chartTimeZoomFixture,
      ),
    ) as FixtureState;
  });
}

async function requestMark(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (window as unknown as { __chartTimeZoomFixture: FixtureState })
      .__chartTimeZoomFixture.requests.length;
  });
}

async function requestsSince(
  page: Page,
  mark: number,
): Promise<Array<RecordedRequest>> {
  return (await fixture(page)).requests.slice(mark);
}

/*
 * The distinct windows each metric's aggregates asked for since `mark`,
 * sorted. A metric not asked for maps to an empty list.
 */
function aggregateWindows(
  requests: Array<RecordedRequest>,
  metrics: Array<string>,
): Record<string, Array<string>> {
  const windows: Record<string, Array<string>> = {};
  for (const metric of metrics) {
    windows[metric] = Array.from(
      new Set(
        requests
          .filter((request: RecordedRequest): boolean => {
            return (
              request.kind === "aggregate" && request.metricName === metric
            );
          })
          .map((request: RecordedRequest): string => {
            return recordedKey(request.window);
          }),
      ),
    ).sort();
  }
  return windows;
}

// The distinct windows of the range-scoped list reads since `mark`.
function listWindows(
  requests: Array<RecordedRequest>,
  models: Array<string>,
): Record<string, Array<string>> {
  const windows: Record<string, Array<string>> = {};
  for (const model of models) {
    windows[model] = Array.from(
      new Set(
        requests
          .filter((request: RecordedRequest): boolean => {
            return (
              (request.kind === "getList" ||
                request.kind === "analytics.getList") &&
              request.modelName === model
            );
          })
          .map((request: RecordedRequest): string => {
            return recordedKey(request.window);
          }),
      ),
    ).sort();
  }
  return windows;
}

/*
 * Every query behind the page's charts asked for `window` since `mark`,
 * and none asked for any other window. `returning` is set when the page
 * goes back to a window it has already fetched: MetricView may then serve
 * its charts from its short result cache instead of asking again.
 */
async function expectRangeQueries(
  page: Page,
  subject: PageUnderTest,
  mark: number,
  window: TimeWindow,
  options: { returning?: boolean } = {},
): Promise<void> {
  const expected: string = windowKey(window);
  const optional: Set<string> = new Set(
    options.returning ? subject.cachedMetrics : [],
  );

  await expect
    .poll(
      async (): Promise<Record<string, Array<string>>> => {
        const windows: Record<string, Array<string>> = aggregateWindows(
          await requestsSince(page, mark),
          subject.rangeMetrics,
        );
        // A cache hit is no request at all; report it as the window.
        for (const metric of optional) {
          if (windows[metric]?.length === 0) {
            windows[metric] = [expected];
          }
        }
        return windows;
      },
      {
        message: `every chart query asks for ${expected} and nothing else`,
      },
    )
    .toEqual(
      Object.fromEntries(
        subject.rangeMetrics.map((metric: string): [string, Array<string>] => {
          return [metric, [expected]];
        }),
      ),
    );

  if (subject.tileMetrics.length > 0) {
    const tile: string = windowKey({
      start: window.end - 5 * MINUTE,
      end: window.end,
    });
    await expect
      .poll(
        async (): Promise<Record<string, Array<string>>> => {
          return aggregateWindows(
            await requestsSince(page, mark),
            subject.tileMetrics,
          );
        },
        { message: `the tiles read the last five minutes of ${expected}` },
      )
      .toEqual(
        Object.fromEntries(
          subject.tileMetrics.map((metric: string): [string, Array<string>] => {
            return [metric, [tile]];
          }),
        ),
      );
  }

  if (subject.rangeLists.length > 0) {
    await expect
      .poll(
        async (): Promise<Record<string, Array<string>>> => {
          return listWindows(
            await requestsSince(page, mark),
            subject.rangeLists,
          );
        },
        {
          message: `exemplar and event-marker reads ask for ${expected}`,
        },
      )
      .toEqual(
        Object.fromEntries(
          subject.rangeLists.map((model: string): [string, Array<string>] => {
            return [model, [expected]];
          }),
        ),
      );
  }
}

// No chart query at all since `mark`, after giving one the time to arrive.
async function expectNoRangeQueries(
  page: Page,
  subject: PageUnderTest,
  mark: number,
): Promise<void> {
  // A double-click is resolved at once; queries follow within a render.
  await page.waitForTimeout(750);
  const windows: Record<string, Array<string>> = aggregateWindows(
    await requestsSince(page, mark),
    subject.rangeMetrics,
  );
  expect(
    Object.values(windows).flat(),
    "chart queries after a gesture that should change nothing",
  ).toEqual([]);
}

/*
 * ---------------------------------------------------------------------------
 * Page, picker, charts
 * ---------------------------------------------------------------------------
 */

async function open(page: Page, subject: PageUnderTest): Promise<void> {
  // Every fixture value is a function of time; timers keep running.
  await page.clock.setFixedTime(NOW);
  await page.goto(subject.path);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(charts(page)).toHaveCount(subject.charts.length, {
    timeout: 30000,
  });
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return chartTitles(page);
      },
      { message: "the page's charts", timeout: 30000 },
    )
    .toEqual(subject.charts);
  await expectUnzoomed(page, subject, subject.initial.window, 0);
}

function charts(page: Page): Locator {
  return page.locator(".recharts-wrapper");
}

/*
 * Each chart's title: the ChartGroup heading of a MetricView chart, the
 * caption of an overview chart card, or the heading of the card that
 * holds nothing but this chart.
 */
async function chartTitles(page: Page): Promise<Array<string>> {
  return charts(page).evaluateAll((wrappers: Array<Element>): Array<string> => {
    return wrappers.map((wrapper: Element): string => {
      const plot: Element | null = wrapper.closest(
        "[data-testid='chart-group-plot']",
      );
      const titled: Element | null | undefined =
        plot?.parentElement?.querySelector("[title]");
      if (titled) {
        return titled.getAttribute("title") || "";
      }
      let node: Element | null = wrapper.parentElement;
      while (node && node.querySelectorAll(".recharts-wrapper").length === 1) {
        const caption: Element | null = node.querySelector("span.uppercase");
        if (caption) {
          return (caption.textContent || "").trim();
        }
        if (node.getAttribute("data-testid") === "card") {
          const heading: Element | null = node.querySelector(
            "[data-testid='card-details-heading'] span > div > span",
          );
          return (heading?.textContent || "").trim();
        }
        node = node.parentElement;
      }
      return "";
    });
  });
}

async function chartByTitle(page: Page, title: string): Promise<Locator> {
  const index: number = (await chartTitles(page)).indexOf(title);
  expect(index, `a chart titled "${title}"`).toBeGreaterThanOrEqual(0);
  return charts(page).nth(index);
}

// Every chart's x-axis labels, chart by chart.
async function tickLabels(page: Page): Promise<Array<Array<string>>> {
  return charts(page).evaluateAll(
    (wrappers: Array<Element>): Array<Array<string>> => {
      return wrappers.map((wrapper: Element): Array<string> => {
        return Array.from(
          wrapper.querySelectorAll(
            ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
          ),
        ).map((text: Element): string => {
          return (text.textContent || "").trim();
        });
      });
    },
  );
}

/*
 * "ok" when a chart's axis starts at the window's start and every label
 * lies inside the window; otherwise what is wrong, for the failure message.
 */
function describeAxis(labels: Array<string>, window: TimeWindow): string {
  if (labels.length === 0) {
    return "no x-axis labels";
  }
  const times: Array<number> = labels.map((label: string): number => {
    return tickTime(label);
  });
  if (times[0] !== window.start) {
    return `starts at ${labels[0]}: ${labels.join(" ")}`;
  }
  const outside: Array<string> = labels.filter(
    (_label: string, index: number): boolean => {
      return times[index]! < window.start || times[index]! > window.end;
    },
  );
  return outside.length > 0
    ? `labels outside the window: ${outside.join(" ")}`
    : "ok";
}

async function expectChartsShow(
  page: Page,
  subject: PageUnderTest,
  window: TimeWindow,
): Promise<void> {
  await expect
    .poll(
      async (): Promise<Array<string>> => {
        return (await tickLabels(page)).map((labels: Array<string>): string => {
          return describeAxis(labels, window);
        });
      },
      { message: `every chart's x-axis inside ${windowKey(window)}` },
    )
    .toEqual(
      subject.charts.map((): string => {
        return "ok";
      }),
    );
}

function resetButtons(page: Page): Locator {
  return page.getByTestId(RESET_ZOOM_TEST_ID);
}

// The label of every time picker on the page (one, or one per card).
function pickerLabels(page: Page, subject: PageUnderTest): Locator {
  if (subject.picker === "page") {
    return page.getByTestId(PAGE_PICKER_TEST_ID);
  }
  return page
    .getByTestId("card")
    .locator("button > span.text-xs.text-gray-500");
}

async function expectPickers(
  page: Page,
  subject: PageUnderTest,
  label: string | RegExp,
): Promise<void> {
  const labels: Locator = pickerLabels(page, subject);
  const count: number = subject.picker === "page" ? 1 : subject.resetButtons;
  await expect(labels).toHaveCount(count);
  for (let index: number = 0; index < count; index++) {
    await expect(labels.nth(index)).toHaveText(label);
  }
}

async function expectNoTextSelected(page: Page): Promise<void> {
  expect(
    await page.evaluate((): string => {
      return window.getSelection()?.toString() || "";
    }),
    "text selected on the page",
  ).toBe("");
}

function cardHints(page: Page): Locator {
  return page.getByTestId(HINT_TEST_ID);
}

function groupHints(page: Page): Locator {
  return page
    .locator(`span:not([data-testid='${HINT_TEST_ID}'])`)
    .filter({ hasText: /^Drag to zoom( · double-click to reset)?$/ });
}

/*
 * Every chart names the gesture: "Drag to zoom", and while the page is
 * zoomed, the way back ("Double-click to reset" on a card's hint,
 * ChartGroup's longer line on a MetricView chart).
 */
async function expectHints(
  page: Page,
  subject: PageUnderTest,
  zoomed: boolean,
): Promise<void> {
  await expect(cardHints(page)).toHaveCount(subject.hints.card);
  for (let index: number = 0; index < subject.hints.card; index++) {
    await expect(cardHints(page).nth(index)).toHaveText(
      zoomed ? HINT_RESET_TEXT : HINT_TEXT,
    );
  }
  await expect(groupHints(page)).toHaveCount(subject.hints.group);
  for (let index: number = 0; index < subject.hints.group; index++) {
    await expect(groupHints(page).nth(index)).toHaveText(
      zoomed ? GROUP_HINT_RESET_TEXT : HINT_TEXT,
    );
  }
}

/*
 * A card's hint is revealed while the pointer is over the card (its named
 * `group/zoomhint`), and hidden again when the pointer leaves.
 */
async function expectHintRevealedOnHover(
  page: Page,
  subject: PageUnderTest,
  text: string,
): Promise<void> {
  const chart: Locator = await chartByTitle(page, subject.hints.hoverChart);
  const index: number = await chart.evaluate(
    (wrapper: Element, testId: string): number => {
      const hint: Element | null | undefined = wrapper
        .closest("[class*='group/zoomhint']")
        ?.querySelector(`[data-testid='${testId}']`);
      return hint
        ? Array.from(
            document.querySelectorAll(`[data-testid='${testId}']`),
          ).indexOf(hint)
        : -1;
    },
    HINT_TEST_ID,
  );
  expect(
    index,
    `the hint of the "${subject.hints.hoverChart}" chart`,
  ).toBeGreaterThanOrEqual(0);
  const hint: Locator = cardHints(page).nth(index);
  /*
   * The hint also shows while focus is inside its card (for keyboard
   * users), and a mouse drag leaves focus on the chart (recharts focuses
   * the plot on mousedown). Move focus away first, as clicking elsewhere
   * on the page would.
   */
  await page.evaluate((): void => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.mouse.move(2, 2);
  await expect(hint).toHaveCSS("opacity", "0");
  await chart.scrollIntoViewIfNeeded();
  const shape: ChartGeometry = await geometry(chart);
  await page.mouse.move((shape.left + shape.right) / 2, shape.middle);
  await expect(hint).toHaveCSS("opacity", "1");
  await expect(hint).toHaveText(text);
  await page.mouse.move(2, 2);
  await expect(hint).toHaveCSS("opacity", "0");
}

async function expectUnzoomed(
  page: Page,
  subject: PageUnderTest,
  window: TimeWindow,
  mark: number,
  options: { returning?: boolean; label?: string } = {},
): Promise<void> {
  await expectRangeQueries(page, subject, mark, window, options);
  await expectPickers(page, subject, options.label || subject.initial.label);
  await expect(resetButtons(page)).toHaveCount(0);
  await expectChartsShow(page, subject, window);
  await expectHints(page, subject, false);
}

async function expectZoomed(
  page: Page,
  subject: PageUnderTest,
  zoom: TimeWindow,
  mark: number,
): Promise<void> {
  await expectRangeQueries(page, subject, mark, zoom);
  await expectPickers(page, subject, customLabel(subject, zoom));
  await expect(resetButtons(page)).toHaveCount(subject.resetButtons);
  for (let index: number = 0; index < subject.resetButtons; index++) {
    const button: Locator = resetButtons(page).nth(index);
    await expect(button).toBeVisible();
    await expect(button).toHaveText("Reset zoom");
    await expect(button).toHaveAttribute("aria-label", "Reset zoom");
    // However deep the zoom, it goes back to the range before the first one.
    await expect(button).toHaveAttribute(
      "title",
      `Go back to ${subject.initial.range}, the time range before the zoom`,
    );
  }
  await expectResetBesidePickers(page, subject);
  await expectChartsShow(page, subject, zoom);
  await expectHints(page, subject, true);
  // The selection band never outlives the gesture.
  await expect(page.locator(".recharts-reference-area")).toHaveCount(0);
}

/*
 * Reset zoom sits beside the picker it undoes: in the page picker's own
 * row, or in the header of every card that has a picker.
 */
async function expectResetBesidePickers(
  page: Page,
  subject: PageUnderTest,
): Promise<void> {
  if (subject.picker === "page") {
    const sharesRow: boolean = await resetButtons(page)
      .first()
      .evaluate((button: Element, pickerTestId: string): boolean => {
        const picker: Element | null = document.querySelector(
          `[data-testid='${pickerTestId}']`,
        );
        return Boolean(
          picker &&
            button.parentElement &&
            picker.parentElement?.parentElement === button.parentElement,
        );
      }, PAGE_PICKER_TEST_ID);
    expect(sharesRow, "Reset zoom sits in the time picker's row").toBe(true);
    return;
  }
  await expect(
    page.getByTestId("card").filter({
      has: page.getByTestId(RESET_ZOOM_TEST_ID),
    }),
  ).toHaveCount(subject.resetButtons);
}

/*
 * ---------------------------------------------------------------------------
 * Gestures
 * ---------------------------------------------------------------------------
 */

/*
 * Two animation frames: long enough for recharts to have run its
 * mousemove handler for where the pointer now rests.
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

async function geometry(chart: Locator): Promise<ChartGeometry> {
  return chart.evaluate((wrapper: Element): ChartGeometry => {
    const surface: Element = wrapper.querySelector("svg.recharts-surface")!;
    const surfaceBox: DOMRect = surface.getBoundingClientRect();
    const plot: Element = wrapper.querySelector(".recharts-cartesian-grid")!;
    const plotBox: DOMRect = plot.getBoundingClientRect();
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
      left: plotBox.left,
      right: plotBox.right,
      top: plotBox.top,
      bottom: plotBox.bottom,
      middle: plotBox.top + plotBox.height / 2,
      chartBottom: wrapper.getBoundingClientRect().bottom,
    };
  });
}

/*
 * Where the bucket starting at `time` sits on the chart: the x-axis is one
 * evenly spaced category per bucket, so the first and last labels give
 * the spacing.
 */
function bucketSpacing(chart: ChartGeometry, bucket: number): number {
  expect(chart.ticks.length, "x-axis labels to measure").toBeGreaterThan(1);
  const first: Tick = chart.ticks[0]!;
  const last: Tick = chart.ticks[chart.ticks.length - 1]!;
  const buckets: number =
    (tickTime(last.label) - tickTime(first.label)) / bucket;
  return (last.x - first.x) / buckets;
}

function bucketX(chart: ChartGeometry, time: number, bucket: number): number {
  const first: Tick = chart.ticks[0]!;
  const x: number =
    first.x +
    ((time - tickTime(first.label)) / bucket) * bucketSpacing(chart, bucket);
  expect(x, `bucket ${iso(time)} on the plot`).toBeGreaterThanOrEqual(
    chart.left,
  );
  expect(x, `bucket ${iso(time)} on the plot`).toBeLessThanOrEqual(chart.right);
  return x;
}

interface DragOptions {
  // Leave the chart downwards before letting go.
  releaseOutside?: boolean | undefined;
  /*
   * At a reader's pace rather than a careful one: the press comes in the
   * same frame the pointer reaches the first bucket, and the release in
   * the same frame it reaches the last.
   */
  quick?: boolean | undefined;
  // Runs while the button is still down, the pointer on the last bucket.
  whileHolding?: ((from: number, to: number) => Promise<void>) | undefined;
}

/*
 * Presses on the bucket `plan.from`, sweeps to the bucket `plan.to` and lets
 * go, on the chart titled `plan.chart`, which currently shows `current`.
 */
async function drag(
  page: Page,
  plan: DragPlan,
  current: TimeWindow,
  options: DragOptions = {},
): Promise<void> {
  const chart: Locator = await chartByTitle(page, plan.chart);
  await chart.scrollIntoViewIfNeeded();
  const shape: ChartGeometry = await geometry(chart);
  const bucket: number = bucketMs(current);
  const from: number = bucketX(shape, at(plan.from), bucket);
  const to: number = bucketX(shape, at(plan.to), bucket);

  if (options.quick) {
    // Come in from the side and press on arrival.
    await page.mouse.move(Math.max(shape.left + 1, from - 40), shape.middle);
    await settle(page);
    await page.mouse.move(from, shape.middle);
    await page.mouse.down();
    await page.mouse.move((from + to) / 2, shape.middle, { steps: 4 });
    await settle(page);
    // Reach the last bucket and let go in the same frame.
    await page.mouse.move(to, shape.middle, { steps: 3 });
    await page.mouse.up();
    await page.mouse.move(2, 2);
    return;
  }

  await page.mouse.move(from, shape.middle);
  await settle(page);
  await page.mouse.down();
  await page.mouse.move(to, shape.middle, { steps: 12 });
  await settle(page);
  if (options.whileHolding) {
    await options.whileHolding(from, to);
  }
  if (options.releaseOutside) {
    await page.mouse.move(to, shape.chartBottom + 60, { steps: 4 });
    await settle(page);
  }
  await page.mouse.up();
  // Off the charts, so no synced tooltip hides a plot.
  await page.mouse.move(2, 2);
}

/*
 * Waits until no chart is still moving. After its data changes, recharts
 * animates a line from its old points to its new ones (the line chart's
 * transparent click targets for about a second and a half), so a spot that
 * is empty now may be covered a moment later.
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
 * A spot on the plot that no series covers: halfway between two buckets
 * (clear of the hover cursor and dots), and clear of every line, dot and
 * area the chart draws, the transparent click targets included. Searched
 * from 55% across and half-way down, outwards.
 */
async function emptyPlotPoint(
  page: Page,
  title: string,
  current: TimeWindow,
): Promise<Point> {
  const chart: Locator = await chartByTitle(page, title);
  await chart.scrollIntoViewIfNeeded();
  const shape: ChartGeometry = await geometry(chart);
  const first: Tick = shape.ticks[0]!;
  const spacing: number = bucketSpacing(shape, bucketMs(current));
  const nearest: number = Math.round(
    (shape.left + (shape.right - shape.left) * 0.55 - first.x) / spacing - 0.5,
  );
  const columns: Array<number> = [];
  for (let offset: number = 0; offset < 8; offset++) {
    for (const index of offset === 0
      ? [nearest]
      : [nearest + offset, nearest - offset]) {
      const x: number = first.x + (index + 0.5) * spacing;
      if (x > shape.left + 2 && x < shape.right - 2) {
        columns.push(x);
      }
    }
  }
  const point: Point | null = await page.evaluate(
    (area: {
      columns: Array<number>;
      top: number;
      bottom: number;
    }): Point | null => {
      const middle: number = (area.top + area.bottom) / 2;
      for (const x of area.columns) {
        for (let step: number = 0; step < middle - area.top; step += 3) {
          for (const y of step === 0
            ? [middle]
            : [middle - step, middle + step]) {
            if (y <= area.top + 3 || y >= area.bottom - 3) {
              continue;
            }
            const element: Element | null = document.elementFromPoint(x, y);
            if (
              element &&
              (element.matches("svg.recharts-surface") ||
                element.closest(".recharts-cartesian-grid"))
            ) {
              return { x, y };
            }
          }
        }
      }
      return null;
    },
    { columns: columns, top: shape.top, bottom: shape.bottom },
  );
  expect(
    point,
    `a spot on the "${title}" plot no series covers`,
  ).not.toBeNull();
  return point!;
}

/*
 * A spot on one of the chart's drawn lines, about 55% across: where a
 * reader double-clicks "the line". Read off the visible curve itself.
 */
async function linePoint(page: Page, title: string): Promise<Point> {
  const chart: Locator = await chartByTitle(page, title);
  await chart.scrollIntoViewIfNeeded();
  const point: Point | null = await chart.evaluate(
    (wrapper: Element): Point | null => {
      const plot: DOMRect = wrapper
        .querySelector(".recharts-cartesian-grid")!
        .getBoundingClientRect();
      const curve: SVGPathElement | null = wrapper.querySelector(
        "g.recharts-line:not(.cursor-pointer) path.recharts-line-curve",
      );
      const matrix: DOMMatrix | null | undefined = curve?.getScreenCTM();
      if (!curve || !matrix) {
        return null;
      }
      const target: number = plot.left + plot.width * 0.55;
      const length: number = curve.getTotalLength();
      let best: Point | null = null;
      for (let step: number = 0; step <= 200; step++) {
        const local: DOMPoint = curve.getPointAtLength((length * step) / 200);
        const screen: DOMPoint = new DOMPoint(local.x, local.y).matrixTransform(
          matrix,
        );
        if (!best || Math.abs(screen.x - target) < Math.abs(best.x - target)) {
          best = { x: screen.x, y: screen.y };
        }
      }
      return best;
    },
  );
  expect(point, `a point on a line of the "${title}" chart`).not.toBeNull();
  // recharts 3 draws a line's dots in a layer of their own.
  const onLine: boolean = await page.evaluate((spot: Point): boolean => {
    const element: Element | null = document.elementFromPoint(spot.x, spot.y);
    return Boolean(element?.closest(".recharts-line, .recharts-line-dots"));
  }, point!);
  expect(onLine, "the spot is on the chart's line").toBe(true);
  return point!;
}

async function doubleClickAt(page: Page, point: Point): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await settle(page);
  await page.mouse.dblclick(point.x, point.y);
  await page.mouse.move(2, 2);
}

// Double-clicks an empty spot of the chart titled `title`, once it is at rest.
async function doubleClick(
  page: Page,
  title: string,
  current: TimeWindow,
): Promise<void> {
  await expectChartsSettled(page);
  await doubleClickAt(page, await emptyPlotPoint(page, title, current));
}

// The selection band while the button is down, spanning the dragged buckets.
async function expectSelectionBand(
  page: Page,
  plan: DragPlan,
  from: number,
  to: number,
): Promise<void> {
  const chart: Locator = await chartByTitle(page, plan.chart);
  const band: Locator = chart.locator(".recharts-reference-area");
  await expect(band).toHaveCount(1);
  await expect(page.locator(".recharts-reference-area")).toHaveCount(1);
  const box: Box | null = await band.boundingBox();
  expect(box, "the selection band's box").not.toBeNull();
  // The band runs from bucket to bucket, give or take its 1px stroke.
  expect(Math.abs(box!.x - Math.min(from, to))).toBeLessThanOrEqual(3);
  expect(
    Math.abs(box!.x + box!.width - Math.max(from, to)),
  ).toBeLessThanOrEqual(3);
  await expectNoTextSelected(page);
}

async function screenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const fullPage: boolean = options.fullPage !== false;
  if (fullPage) {
    // From the top, so the sticky side menu is captured where it belongs.
    await page.evaluate((): void => {
      window.scrollTo(0, 0);
    });
  }
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: fullPage,
    animations: "disabled",
  });
}

// Zooms with `plan` from the page's initial range and checks it landed.
async function zoomIn(
  page: Page,
  subject: PageUnderTest,
  plan: DragPlan = subject.zoom,
  current: TimeWindow = subject.initial.window,
): Promise<TimeWindow> {
  const zoom: TimeWindow = zoomOf(plan, current);
  const mark: number = await requestMark(page);
  await drag(page, plan, current);
  await expectZoomed(page, subject, zoom, mark);
  return zoom;
}

// The (first) time picker's button: the page's, or the first card's.
function pickerButton(page: Page, subject: PageUnderTest): Locator {
  if (subject.picker === "page") {
    return page.getByTestId(PAGE_PICKER_TEST_ID);
  }
  return page
    .getByTestId("card")
    .locator("button:has(> span.text-xs.text-gray-500)")
    .first();
}

async function openPreset(page: Page, subject: PageUnderTest): Promise<void> {
  await pickerButton(page, subject).click();
  if (subject.picker === "page") {
    await page
      .getByTestId("telemetry-time-range-picker-dropdown")
      .getByRole("button", { name: subject.preset.option, exact: true })
      .click();
    return;
  }
  await page
    .getByRole("radio", { name: subject.preset.option, exact: true })
    .click();
}

/*
 * ---------------------------------------------------------------------------
 * Scenarios, page by page
 * ---------------------------------------------------------------------------
 */

for (const subject of [
  KUBERNETES_OVERVIEW,
  HOST_OVERVIEW,
  KUBERNETES_INSIGHTS,
]) {
  test.describe(subject.name, () => {
    test("a drag zooms every chart, every chart query and the time picker", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      await expectHintRevealedOnHover(page, subject, HINT_TEXT);

      const zoom: TimeWindow = zoomOf(subject.zoom, subject.initial.window);
      const mark: number = await requestMark(page);
      await drag(page, subject.zoom, subject.initial.window, {
        whileHolding: async (from: number, to: number): Promise<void> => {
          await expectSelectionBand(page, subject.zoom, from, to);
          // Nothing is committed while the button is down.
          expect(
            aggregateWindows(await requestsSince(page, mark), [
              subject.rangeMetrics[0]!,
            ]),
          ).toEqual({ [subject.rangeMetrics[0]!]: [] });
          await screenshot(page, `${subject.slug}-selecting`, {
            fullPage: false,
          });
        },
      });
      await expectZoomed(page, subject, zoom, mark);
      await expectNoTextSelected(page);
      await expectHintRevealedOnHover(page, subject, HINT_RESET_TEXT);
      await screenshot(page, `${subject.slug}-zoomed`);
    });

    test("a quick drag zooms exactly the buckets it pressed and released on", async ({
      page,
    }: {
      page: Page;
    }) => {
      /*
       * recharts works out the bucket under the pointer a frame after each
       * mousemove but delivers mousedown and mouseup at once. A press on
       * arrival used to start a bucket early or be dropped (the move queued
       * before it, with no button held, landed after it and abandoned the
       * drag), and a release on arrival lost the buckets its last move
       * crossed. Charts that offer a drag now take mousemove unthrottled.
       */
      await open(page, subject);
      const zoom: TimeWindow = zoomOf(subject.zoom, subject.initial.window);
      const mark: number = await requestMark(page);
      await drag(page, subject.zoom, subject.initial.window, { quick: true });
      await expectZoomed(page, subject, zoom, mark);
      await expectNoTextSelected(page);
    });

    test("a drag released outside the chart still zooms", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      const zoom: TimeWindow = zoomOf(subject.outside, subject.initial.window);
      const mark: number = await requestMark(page);
      await drag(page, subject.outside, subject.initial.window, {
        releaseOutside: true,
      });
      await expectZoomed(page, subject, zoom, mark);
      await expectNoTextSelected(page);
    });

    test("a double-click on another chart puts the page back on its range", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      const zoom: TimeWindow = await zoomIn(page, subject);

      const mark: number = await requestMark(page);
      await doubleClick(page, subject.otherChart, zoom);
      await expectUnzoomed(page, subject, subject.initial.window, mark, {
        returning: true,
      });
      await expectNoTextSelected(page);
    });

    test("a double-click on a line itself puts the page back on its range", async ({
      page,
    }: {
      page: Page;
    }) => {
      /*
       * A press used to re-render the chart (useChartRangeSelection set
       * React state on mousedown), recharts 3 then remounted the line's
       * path and dots (keyed by an id that changes with the line's
       * points), the pressed node was gone by mouseup, and Chrome
       * dispatched no click and no dblclick, so the reset never ran. The
       * line chart's transparent 12px click targets cover every line, so
       * that was any double-click on or near a line.
       */
      await open(page, subject);
      await zoomIn(page, subject);
      await expectChartsSettled(page);

      const mark: number = await requestMark(page);
      await doubleClickAt(page, await linePoint(page, subject.lineChart));
      await expect(resetButtons(page)).toHaveCount(0, { timeout: 5000 });
      await expectUnzoomed(page, subject, subject.initial.window, mark, {
        returning: true,
      });
      await expectNoTextSelected(page);
    });

    test("nested zooms: one double-click climbs all the way out", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      const first: TimeWindow = await zoomIn(page, subject);
      const second: TimeWindow = await zoomIn(
        page,
        subject,
        subject.nested,
        first,
      );
      expect(second.end - second.start).toBeLessThan(first.end - first.start);
      await screenshot(page, `${subject.slug}-nested`);

      const mark: number = await requestMark(page);
      await doubleClick(page, subject.zoom.chart, second);
      await expectUnzoomed(page, subject, subject.initial.window, mark, {
        returning: true,
      });
      await expectNoTextSelected(page);
    });

    test("Reset zoom puts the page back on its range", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      await zoomIn(page, subject);

      const mark: number = await requestMark(page);
      await resetButtons(page).last().click();
      await expectUnzoomed(page, subject, subject.initial.window, mark, {
        returning: true,
      });
    });

    test("Reset zoom works from the keyboard", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      await zoomIn(page, subject);

      // Tab from the time picker lands on Reset zoom, right beside it.
      await pickerButton(page, subject).focus();
      await page.keyboard.press("Tab");
      await expect(resetButtons(page).first()).toBeFocused();
      const mark: number = await requestMark(page);
      await page.keyboard.press("Enter");
      await expectUnzoomed(page, subject, subject.initial.window, mark, {
        returning: true,
      });
    });

    test("picking a range in the time picker ends the zoom", async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, subject);
      await zoomIn(page, subject);

      let mark: number = await requestMark(page);
      await openPreset(page, subject);
      await expectUnzoomed(page, subject, subject.preset.window, mark, {
        label: subject.preset.label,
      });

      // The zoom is over: a double-click has nothing left to undo.
      mark = await requestMark(page);
      await doubleClick(page, subject.otherChart, subject.preset.window);
      await expectNoRangeQueries(page, subject, mark);
      await expectPickers(page, subject, subject.preset.label);
      await expect(resetButtons(page)).toHaveCount(0);
    });
  });
}
