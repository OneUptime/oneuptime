/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4116, the placeholders (commits 7f6df1c28c and b6ec899df4). Right
 * after a zoom a chart often has no bars to double-click: the zoomed window
 * is still loading, or it turned out to hold nothing. That is exactly when
 * a reader double-clicks to undo the zoom, so the loader and the empty box
 * standing where the bars were take the double-click as the bars do - and
 * are select-none, so the double-click does not also select a word of them.
 *
 * The bars can also land in the middle of that double-click - the #4116
 * race once more - and take the placeholder's place between its second
 * press and that press's release. The browser then sends the chart no
 * dblclick: the node the press went down on is gone, or React kept it for
 * the chart without the placeholder's handlers, and a dblclick sent to it
 * bubbles away from the chart's own. So a placeholder takes the second
 * press itself (placeholderProps): its release - over the chart that took
 * the placeholder's place, or anywhere on the page - zooms out in the next
 * task, once, and a dblclick that does reach the chart still zooms out only
 * once. Only a main-button press on a zoomed chart counts.
 *
 * - The explorers' volume histograms (TelemetryHistogram - traces,
 *   exceptions, security events - and LogsHistogram): a zoomed chart's
 *   loader zooms out; a zoomed chart whose window is empty keeps its card,
 *   and its empty box zooms out. A zoomed chart keeps its card - title,
 *   the way back - while its window loads or reloads too, the loader in
 *   the box the bars will take, and says nothing of zooming in ("Click or
 *   drag to zoom", "Drag to zoom") while it has no bars. Unzoomed nothing
 *   changes: the loader is a bare box that ignores the double-click, and an
 *   empty histogram with no header controls renders nothing. A click on a
 *   bar still waiting out the double-click window when the bars go away
 *   does not zoom in once a double-click on the placeholder zooms out.
 * - The log and trace analytics views swap their chart for a loader on
 *   every refetch. The timeseries' loader zooms out, through the chart's
 *   own selection, so a click on a bucket still waiting to zoom in when the
 *   loader came up zooms nowhere; the top list's and the table's loaders do
 *   not zoom out - they are no time charts, even when a host hands the view
 *   zoom handlers of its own.
 * - An exception's Occurrence Trend clears its bars for a zoom's refetch;
 *   the loader in their place goes back to the preset window.
 *
 * Before commit b6ec899df4, every case in which the chart takes a
 * placeholder's place mid-double-click stayed zoomed, a zoomed histogram
 * with no bars offered "Click or drag to zoom", and one loading its window
 * - its first bars, or an empty window again - stood as the bare loader
 * box, its card gone.
 *
 * Everything is real, recharts included - only ResponsiveContainer is
 * stood in for, as in HistogramDoubleClickResetRealRecharts.test.tsx, since
 * jsdom lays nothing out - down to the data boundary: API and ModelAPI are
 * mocked as in LogsAnalyticsViewZoom.test.tsx, TracesAnalyticsViewZoom.test.tsx
 * and ExceptionOccurrenceTrendZoom.test.tsx, and a request can be held
 * open to keep a loader on screen.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error?.message || "Failed";
      },
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  // One map for every render: the views memoise their series on it.
  const noNames: Map<string, string> = new Map();
  return {
    __esModule: true,
    default: () => {
      return noNames;
    },
  };
});

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return react.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

// Imported after the mocks so the components pick them up.
import LogsHistogram from "../../../../UI/Components/LogsViewer/components/LogsHistogram";
import { HistogramBucket as LogsHistogramBucket } from "../../../../UI/Components/LogsViewer/types";
import TelemetryHistogram from "../../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import {
  HistogramBucket as TelemetryHistogramBucket,
  HistogramSeriesOption,
} from "../../../../UI/Components/TelemetryViewer/types";
import LogsAnalyticsView, {
  LOGS_ANALYTICS_TIMESERIES_TEST_ID,
} from "../../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import TracesAnalyticsView, {
  TRACES_ANALYTICS_TIMESERIES_TEST_ID,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import ExceptionOccurrenceTrend from "../../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrenceTrend";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TimeRangeZoomProvider } from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;
// One animation frame, as fake timers run them.
const FRAME_MS: number = 16;
// Inside every plot below: under its top edge and above its x-axis.
const POINTER_Y: number = 120;

type SelectHandler = (startTime: Date, endTime: Date) => void;

/* Pointer and page */

interface PointerSpot {
  clientX: number;
  clientY: number;
}

// One animation frame passes: fake timers run the frame's callbacks.
function nextFrame(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

// Long past the double-click window: a click still waiting to zoom in has.
function waitOutTheDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
  });
}

// The browser moves on to the next task: a timeout set for 0ms runs.
function nextTask(): void {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

// Every timer still pending runs, however far off.
function runEveryPendingTimer(): void {
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

// The pointer comes to rest at `spot` over a chart root.
function restAt(chartRoot: Element, spot: PointerSpot): void {
  fireEvent.mouseMove(chartRoot, { ...spot, buttons: 0 });
  nextFrame();
}

/*
 * The main button goes down at `spot`. `clickCount` is the browser's own
 * count (MouseEvent.detail): 2 for the second press of a double-click.
 */
function press(
  chartRoot: Element,
  spot: PointerSpot,
  clickCount: number,
): void {
  fireEvent.mouseDown(chartRoot, {
    ...spot,
    button: 0,
    buttons: 1,
    detail: clickCount,
  });
}

// The pointer moves to `spot` with the button held.
function moveHeld(chartRoot: Element, spot: PointerSpot): void {
  fireEvent.mouseMove(chartRoot, { ...spot, buttons: 1 });
}

function release(
  chartRoot: Element,
  spot: PointerSpot,
  clickCount: number,
): void {
  fireEvent.mouseUp(chartRoot, {
    ...spot,
    button: 0,
    buttons: 0,
    detail: clickCount,
  });
}

/*
 * What a browser delivers for a double-click on an element that stays on
 * the page: two presses, counted, each with its release and its click,
 * and then the dblclick.
 */
function doubleClickOn(target: Element): void {
  for (const clickCount of [1, 2]) {
    fireEvent.mouseDown(target, { button: 0, buttons: 1, detail: clickCount });
    fireEvent.mouseUp(target, { button: 0, buttons: 0, detail: clickCount });
    fireEvent.click(target, { button: 0, detail: clickCount });
  }
  fireEvent.doubleClick(target, { button: 0, detail: 2 });
}

/*
 * Runs `gesture` and returns whatever it threw. An error thrown by a
 * handler does not come back out of the event's dispatch: the page reports
 * it as uncaught, so that is where this listens too.
 */
function errorsThrownBy(gesture: () => void): Array<unknown> {
  const errors: Array<unknown> = [];
  const onError: (event: ErrorEvent) => void = (event: ErrorEvent): void => {
    errors.push(event.error);
  };
  window.addEventListener("error", onError);
  try {
    gesture();
  } catch (error: unknown) {
    errors.push(error);
  } finally {
    window.removeEventListener("error", onError);
  }
  return errors;
}

/*
 * The loader's box: what stands where the chart will be while it loads,
 * around the spinner.
 */
function loaderBox(): HTMLElement {
  const box: HTMLElement | null =
    screen.getByTestId("component-loader").parentElement;
  if (!box) {
    throw new Error("the loader stands in no box");
  }
  return box;
}

// The chart root recharts listens on for the pointer, inside `scope`.
function chartRootIn(scope: ParentNode): Element {
  const wrapper: Element | null = scope.querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("recharts drew no chart");
  }
  return wrapper;
}

interface DrawnTick {
  label: string;
  x: number;
}

// The x-axis tick labels recharts drew inside `scope`, left to right.
function drawnTicks(scope: ParentNode): Array<DrawnTick> {
  return Array.from(
    scope.querySelectorAll(
      ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
    ),
  ).map((tick: Element): DrawnTick => {
    return {
      label: tick.textContent || "",
      x: Number(tick.getAttribute("x")),
    };
  });
}

/*
 * Where the pointer lands on the bucket whose tick reads `label` ("10:04";
 * the labels are local times, "10:04 AM" on a 12-hour clock).
 */
function spotOnTick(scope: ParentNode, label: string): PointerSpot {
  const tick: DrawnTick | undefined = drawnTicks(scope).find(
    (drawn: DrawnTick): boolean => {
      return drawn.label.startsWith(label);
    },
  );
  if (!tick) {
    throw new Error(`recharts drew no tick label "${label}"`);
  }
  return { clientX: tick.x, clientY: POINTER_Y };
}

// A single click on a chart: its press, its release, the browser's click.
function clickChartAt(chartRoot: Element, spot: PointerSpot): void {
  restAt(chartRoot, spot);
  press(chartRoot, spot, 1);
  release(chartRoot, spot, 1);
  fireEvent.click(chartRoot, { ...spot, button: 0, detail: 1 });
}

/* The data boundary */

interface PostRequest {
  url: { toString: () => string };
  data: Record<string, unknown>;
}

interface HeldRequest {
  request: PostRequest;
  answer: () => void;
}

const LOGS_ANALYTICS_ROUTE: string = "/telemetry/logs/analytics";
const TRACES_ANALYTICS_ROUTE: string = "/telemetry/traces/analytics";
const EXCEPTIONS_HISTOGRAM_ROUTE: string = "/telemetry/exceptions/histogram";

// ClickHouse's bucket labels for the analytics views: UTC, no zone marker.
const ANALYTICS_BUCKETS: Array<string> = [
  "2026-09-28 11:10:00",
  "2026-09-28 11:11:00",
  "2026-09-28 11:12:00",
];

// While set, a request waits for answerHeldRequests().
let isHoldingRequests: boolean = false;
const heldRequests: Array<HeldRequest> = [];

function logsAnalyticsAnswer(body: Record<string, unknown>): unknown {
  if (body["chartType"] === "toplist") {
    return { data: { data: [{ value: "Error", count: 4 }] } };
  }
  if (body["chartType"] === "table") {
    return {
      data: { data: [{ groupValues: { severityText: "Error" }, count: 4 }] },
    };
  }
  return {
    data: {
      data: ANALYTICS_BUCKETS.map(
        (time: string, index: number): Record<string, unknown> => {
          return { time: time, count: index + 1, groupValues: {} };
        },
      ),
    },
  };
}

function tracesAnalyticsAnswer(body: Record<string, unknown>): unknown {
  if (body["chartType"] === "toplist") {
    return { data: { data: [{ value: "GET /", metricValue: 4, count: 4 }] } };
  }
  if (body["chartType"] === "table") {
    return {
      data: {
        data: [
          {
            groupValues: { name: "GET /" },
            count: 4,
            errorCount: 0,
            avgDurationMs: 1,
            p50DurationMs: 1,
            p90DurationMs: 1,
            p95DurationMs: 1,
            p99DurationMs: 1,
            minDurationMs: 1,
            maxDurationMs: 1,
          },
        ],
      },
    };
  }
  return {
    data: {
      data: ANALYTICS_BUCKETS.map((time: string): Record<string, unknown> => {
        return { time: time, value: 3, groupValues: { name: "GET /" } };
      }),
    },
  };
}

/*
 * Occurrences in every bucket the exception histogram is asked for, so a
 * zoomed window always has bars to draw.
 */
function exceptionHistogramAnswer(body: Record<string, unknown>): unknown {
  const startMs: number = new Date(String(body["startTime"])).getTime();
  const endMs: number = new Date(String(body["endTime"])).getTime();
  const bucketMs: number = Number(body["bucketSizeInMinutes"]) * MINUTE_MS;
  const buckets: Array<Record<string, unknown>> = [];

  for (
    let timeMs: number = Math.floor(startMs / bucketMs) * bucketMs;
    timeMs < endMs;
    timeMs += bucketMs
  ) {
    buckets.push({
      time: new Date(timeMs).toISOString(),
      series: "unhandled",
      count: 2,
    });
  }

  return { data: { buckets: buckets } };
}

function answerFor(request: PostRequest): unknown {
  const url: string = request.url.toString();

  if (url.includes(LOGS_ANALYTICS_ROUTE)) {
    return logsAnalyticsAnswer(request.data);
  }
  if (url.includes(TRACES_ANALYTICS_ROUTE)) {
    return tracesAnalyticsAnswer(request.data);
  }
  if (url.includes(EXCEPTIONS_HISTOGRAM_ROUTE)) {
    return exceptionHistogramAnswer(request.data);
  }
  throw new Error(`nothing answers ${url}`);
}

function holdRequests(): void {
  isHoldingRequests = true;
}

// Every held request gets its answer, and requests are answered at once again.
async function answerHeldRequests(): Promise<void> {
  isHoldingRequests = false;
  await act(async () => {
    for (const held of heldRequests.splice(0)) {
      held.answer();
    }
  });
}

// The bodies of every request made to `route`, oldest first.
function requestsTo(route: string): Array<Record<string, unknown>> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostRequest => {
      return call[0] as PostRequest;
    })
    .filter((request: PostRequest): boolean => {
      return request.url.toString().includes(route);
    })
    .map((request: PostRequest): Record<string, unknown> => {
      return request.data;
    });
}

// The bodies of the requests to `route` still waiting for an answer.
function heldBodies(route: string): Array<Record<string, unknown>> {
  return heldRequests
    .filter((held: HeldRequest): boolean => {
      return held.request.url.toString().includes(route);
    })
    .map((held: HeldRequest): Record<string, unknown> => {
      return held.request.data;
    });
}

let histogramOnScreen: HistogramOnScreen | null = null;

beforeEach(() => {
  /*
   * Installed AT the fixed time, not moved there with setSystemTime: fake
   * timers count animation frames from the moment they are installed.
   */
  jest.useFakeTimers({ now: NOW });
  isHoldingRequests = false;
  heldRequests.length = 0;
  postMock.mockReset();
  postMock.mockImplementation((request: PostRequest): Promise<unknown> => {
    if (!isHoldingRequests) {
      return Promise.resolve(answerFor(request));
    }
    return new Promise((resolve: (value: unknown) => void): void => {
      heldRequests.push({
        request: request,
        answer: (): void => {
          resolve(answerFor(request));
        },
      });
    });
  });
});

afterEach(() => {
  cleanup();
  histogramOnScreen = null;
  heldRequests.length = 0;
  jest.useRealTimers();
});

/* The explorers' volume histograms */

interface Bar {
  time: string;
  count: number;
}

// What the zoomed chart shows: ten one-minute bars, 10:00 to 10:09.
const SHOWN_BARS: Array<Bar> = Array.from(
  { length: 10 },
  (_: unknown, index: number): Bar => {
    return {
      time: new Date(
        Date.parse("2026-09-28T10:00:00.000Z") + index * MINUTE_MS,
      ).toISOString(),
      count: 5 + index,
    };
  },
);

const TELEMETRY_SERIES: Array<HistogramSeriesOption> = [
  { key: "error", label: "Error", color: "#dc2626" },
];

// The traces explorer's header control: which metric the histogram charts.
const CHART_METRIC_PICKER: React.ReactElement = (
  <select title="Chart metric" defaultValue="count">
    <option value="count">Count</option>
    <option value="p95">P95 response time</option>
  </select>
);

// Every message an empty histogram card can show.
const EMPTY_TEXTS: Array<string> = [
  "No data in the selected range",
  "No data for this metric in the selected range",
  "No logs in the selected range",
];

interface HistogramProps {
  bars: Array<Bar>;
  isLoading: boolean;
  onTimeRangeSelect?: SelectHandler | undefined;
  // Set only while the chart shows a window dragged out of it.
  onZoomOut?: (() => void) | undefined;
  /*
   * Handed no bucket interval, the chart can only zoom by a drag ("Drag
   * to zoom"); with one (as by default here), by a click too.
   */
  withoutBucketInterval?: boolean | undefined;
}

function bucketIntervalFor(props: HistogramProps): number | undefined {
  return props.withoutBucketInterval ? undefined : MINUTE_MS;
}

interface HistogramUnderTest {
  name: string;
  title: string;
  // What its empty box says.
  emptyText: string;
  /*
   * Header controls (the traces explorer's metric picker) keep the card on
   * screen through any empty window, zoomed or not.
   */
  hasHeaderActions: boolean;
  render: (props: HistogramProps) => React.ReactElement;
}

function telemetryBuckets(bars: Array<Bar>): Array<TelemetryHistogramBucket> {
  return bars.map((bar: Bar): TelemetryHistogramBucket => {
    return { time: bar.time, series: "error", count: bar.count };
  });
}

function logsBuckets(bars: Array<Bar>): Array<LogsHistogramBucket> {
  return bars.map((bar: Bar): LogsHistogramBucket => {
    return { time: bar.time, severity: "Error", count: bar.count };
  });
}

const HISTOGRAMS: Array<HistogramUnderTest> = [
  {
    name: "telemetry histogram (the exceptions explorer's)",
    title: "Exceptions over time",
    emptyText: "No data in the selected range",
    hasHeaderActions: false,
    render: (props: HistogramProps): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={telemetryBuckets(props.bars)}
          isLoading={props.isLoading}
          series={TELEMETRY_SERIES}
          title="Exceptions over time"
          onTimeRangeSelect={props.onTimeRangeSelect}
          onZoomOut={props.onZoomOut}
          bucketIntervalMs={bucketIntervalFor(props)}
        />
      );
    },
  },
  {
    name: "telemetry histogram with a metric picker (the traces explorer's)",
    title: "Traces over time",
    emptyText: "No data for this metric in the selected range",
    hasHeaderActions: true,
    render: (props: HistogramProps): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={telemetryBuckets(props.bars)}
          isLoading={props.isLoading}
          series={TELEMETRY_SERIES}
          title="Traces over time"
          onTimeRangeSelect={props.onTimeRangeSelect}
          onZoomOut={props.onZoomOut}
          bucketIntervalMs={bucketIntervalFor(props)}
          headerActions={CHART_METRIC_PICKER}
        />
      );
    },
  },
  {
    name: "logs histogram",
    title: "Log Volume",
    emptyText: "No logs in the selected range",
    hasHeaderActions: false,
    render: (props: HistogramProps): React.ReactElement => {
      return (
        <LogsHistogram
          buckets={logsBuckets(props.bars)}
          isLoading={props.isLoading}
          onTimeRangeSelect={props.onTimeRangeSelect}
          onZoomOut={props.onZoomOut}
          bucketIntervalMs={bucketIntervalFor(props)}
        />
      );
    },
  },
];

interface HistogramOnScreen {
  histogram: HistogramUnderTest;
  props: HistogramProps;
  rendered: RenderResult;
}

function showHistogram(
  histogram: HistogramUnderTest,
  props: HistogramProps,
): HTMLElement {
  const rendered: RenderResult = render(histogram.render(props));
  histogramOnScreen = {
    histogram: histogram,
    props: props,
    rendered: rendered,
  };
  return rendered.container;
}

function shownHistogram(): HistogramOnScreen {
  if (!histogramOnScreen) {
    throw new Error("no histogram rendered");
  }
  return histogramOnScreen;
}

// The host re-renders the chart: new bars, or a new loading state.
function rerenderHistogram(changes: Partial<HistogramProps>): void {
  const chart: HistogramOnScreen = shownHistogram();
  chart.props = { ...chart.props, ...changes };
  chart.rendered.rerender(chart.histogram.render(chart.props));
}

// The band a click on one bar paints while it waits to zoom in, if drawn.
function drawnBand(): Element | null {
  return shownHistogram().rendered.container.querySelector(
    ".recharts-reference-area-rect",
  );
}

// A single click on the bar whose tick reads `label`.
function clickBar(label: string): void {
  const container: HTMLElement = shownHistogram().rendered.container;
  clickChartAt(chartRootIn(container), spotOnTick(container, label));
}

/*
 * Where the pointer rests through a whole double-click on a placeholder:
 * over the box, and over the plot of the chart that takes its place.
 */
const STILL_POINTER: PointerSpot = { clientX: 300, clientY: 60 };

/*
 * The first click of a double-click on `target` - press, release, click -
 * and the second press: what the browser sends before the chart comes.
 */
function clickThenPressAgain(target: Element): void {
  press(target, STILL_POINTER, 1);
  release(target, STILL_POINTER, 1);
  fireEvent.click(target, { ...STILL_POINTER, button: 0, detail: 1 });
  press(target, STILL_POINTER, 2);
}

/*
 * The same with the right button, which the browser counts too, but which
 * opens a context menu rather than clicking.
 */
function rightClickThenPressAgain(target: Element): void {
  const rightButton: PointerSpot & { button: number } = {
    ...STILL_POINTER,
    button: 2,
  };
  fireEvent.mouseDown(target, { ...rightButton, buttons: 2, detail: 1 });
  fireEvent.mouseUp(target, { ...rightButton, buttons: 0, detail: 1 });
  fireEvent.contextMenu(target, rightButton);
  fireEvent.mouseDown(target, { ...rightButton, buttons: 2, detail: 2 });
}

/*
 * A second press of `button` let go over the chart drawn inside
 * `chartArea`: returns the node the release lands on.
 */
function releaseOverTheChart(chartArea: ParentNode, button: number): Element {
  const chartRoot: Element = chartRootIn(chartArea);
  fireEvent.mouseUp(chartRoot, {
    ...STILL_POINTER,
    button: button,
    buttons: 0,
    detail: 2,
  });
  return chartRoot;
}

// The same, let go off the chart, where only the page hears it.
function releaseOffTheChart(button: number): Element {
  fireEvent.mouseUp(document.body, {
    ...STILL_POINTER,
    button: button,
    buttons: 0,
    detail: 2,
  });
  return document.body;
}

/*
 * What the browser sends after the release of a double-click's second
 * press: its click and the dblclick, to the nearest node the press and the
 * release share - or nothing at all once the node the press went down on
 * has left the page.
 */
function browserSendsTheClicks(pressed: Element, released: Element): void {
  if (!pressed.isConnected) {
    return;
  }
  let shared: Element | null = pressed;
  while (shared && !shared.contains(released)) {
    shared = shared.parentElement;
  }
  if (!shared) {
    return;
  }
  fireEvent.click(shared, { ...STILL_POINTER, button: 0, detail: 2 });
  fireEvent.doubleClick(shared, { ...STILL_POINTER, button: 0, detail: 2 });
}

/*
 * Each way a double-click on a loader can end once the chart has taken its
 * place: where its second press went down, and where it is let go. The
 * spinner goes with the loader. The box around it goes too, or React keeps
 * it for the chart - the analytics views' and the Occurrence Trend's charts
 * render into the very div their loader did - without the loader's
 * handlers; the click and the dblclick the browser then sends that box
 * bubble away from the chart's own dblclick handler.
 */
interface LoaderRaceEnding {
  name: string;
  // What the second press goes down on.
  pressTarget: () => HTMLElement;
  // Its release, of `button`: returns the node it lands on.
  release: (chartArea: HTMLElement, button: number) => Element;
}

function spinner(): HTMLElement {
  return screen.getByTestId("component-loader");
}

const LOADER_RACE_ENDINGS: Array<LoaderRaceEnding> = [
  {
    name: "pressed on its spinner and let go over the chart",
    pressTarget: spinner,
    release: releaseOverTheChart,
  },
  {
    name: "pressed on its spinner and let go off the chart, where only the page hears it",
    pressTarget: spinner,
    release: (_chartArea: HTMLElement, button: number): Element => {
      return releaseOffTheChart(button);
    },
  },
  {
    name: "pressed on the box around its spinner and let go over the chart",
    pressTarget: loaderBox,
    release: releaseOverTheChart,
  },
];

// The chart took the loader's place: the spinner is gone, the chart drawn.
function expectChartInTheLoadersPlace(chartArea: HTMLElement): void {
  expect(screen.queryByTestId("component-loader")).toBeNull();
  expect(chartRootIn(chartArea)).toBeInTheDocument();
}

// The zoom hints a histogram's header can show.
const ZOOM_IN_HINTS: Array<string> = ["Click or drag to zoom", "Drag to zoom"];

function zoomInHintsShown(): Array<string> {
  return ZOOM_IN_HINTS.filter((hint: string): boolean => {
    return screen.queryByText(hint) !== null;
  });
}

interface Placeholder {
  name: string;
  // Whether the chart's next window is still loading when its bars go.
  isLoading: boolean;
  find: (histogram: HistogramUnderTest) => HTMLElement;
}

const PLACEHOLDERS: Array<Placeholder> = [
  {
    name: "empty box",
    isLoading: false,
    find: (histogram: HistogramUnderTest): HTMLElement => {
      return screen.getByText(histogram.emptyText);
    },
  },
  {
    name: "loader",
    isLoading: true,
    find: (): HTMLElement => {
      return loaderBox();
    },
  },
];

for (const histogram of HISTOGRAMS) {
  describe(`the ${histogram.name}`, () => {
    describe("loading its first bars", () => {
      test("zoomed: the loader is not selectable, and a double-click on it zooms out once", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        const onZoomOut: MockFunction = getJestMockFunction();
        showHistogram(histogram, {
          bars: [],
          isLoading: true,
          onTimeRangeSelect: onTimeRangeSelect,
          onZoomOut: onZoomOut,
        });

        const box: HTMLElement = loaderBox();
        // The double-click must not also select anything around the spinner.
        expect(box).toHaveClass("select-none");
        /*
         * A zoomed chart keeps its card while its window loads - its title
         * and the way back - with the loader in the box the bars will take,
         * so the double-click stays where the reader's pointer already is.
         */
        expect(screen.getByText(histogram.title)).toBeInTheDocument();
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();

        doubleClickOn(box);
        expect(onZoomOut).toHaveBeenCalledTimes(1);

        waitOutTheDoubleClickWindow();
        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      test("not zoomed: a double-click on the loader does nothing, and throws nothing", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        showHistogram(histogram, {
          bars: [],
          isLoading: true,
          onTimeRangeSelect: onTimeRangeSelect,
        });

        expect(
          errorsThrownBy((): void => {
            doubleClickOn(loaderBox());
          }),
        ).toEqual([]);

        waitOutTheDoubleClickWindow();
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
        expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      });

      test("with no zoom offered at all: a double-click on the loader throws nothing", () => {
        showHistogram(histogram, { bars: [], isLoading: true });

        expect(
          errorsThrownBy((): void => {
            doubleClickOn(loaderBox());
            waitOutTheDoubleClickWindow();
          }),
        ).toEqual([]);
        expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      });
    });

    describe("with an empty window", () => {
      test("zoomed: the card stays - its title and the reset hint - and its empty box takes the double-click", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        const onZoomOut: MockFunction = getJestMockFunction();
        const container: HTMLElement = showHistogram(histogram, {
          bars: [],
          isLoading: false,
          onTimeRangeSelect: onTimeRangeSelect,
          onZoomOut: onZoomOut,
        });

        expect(screen.getByText(histogram.title)).toBeInTheDocument();
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
        if (histogram.hasHeaderActions) {
          expect(screen.getByTitle("Chart metric")).toBeInTheDocument();
        }
        // Its own message, and only that one; no chart over an empty window.
        expect(
          EMPTY_TEXTS.filter((text: string): boolean => {
            return screen.queryByText(text) !== null;
          }),
        ).toEqual([histogram.emptyText]);
        expect(container.querySelector(".recharts-wrapper")).toBeNull();

        const emptyBox: HTMLElement = screen.getByText(histogram.emptyText);
        // The double-click must not also select a word of the message.
        expect(emptyBox).toHaveClass("select-none");

        doubleClickOn(emptyBox);
        expect(onZoomOut).toHaveBeenCalledTimes(1);

        waitOutTheDoubleClickWindow();
        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      if (histogram.hasHeaderActions) {
        test("not zoomed: the card stays for its metric picker, and a double-click on its empty box does nothing", () => {
          const onTimeRangeSelect: MockFunction = getJestMockFunction();
          showHistogram(histogram, {
            bars: [],
            isLoading: false,
            onTimeRangeSelect: onTimeRangeSelect,
          });

          expect(screen.getByTitle("Chart metric")).toBeInTheDocument();
          expect(screen.queryByText("Double-click to reset")).toBeNull();

          expect(
            errorsThrownBy((): void => {
              doubleClickOn(screen.getByText(histogram.emptyText));
              waitOutTheDoubleClickWindow();
            }),
          ).toEqual([]);
          expect(onTimeRangeSelect).not.toHaveBeenCalled();
        });
      } else {
        test("not zoomed: it still renders nothing at all", () => {
          const container: HTMLElement = showHistogram(histogram, {
            bars: [],
            isLoading: false,
            onTimeRangeSelect: getJestMockFunction(),
          });

          expect(container).toBeEmptyDOMElement();
        });
      }
    });

    describe("a click on a bar still waiting to zoom in when the bars go away", () => {
      for (const placeholder of PLACEHOLDERS) {
        test(`a double-click on the ${placeholder.name} that takes their place zooms out once, and the click never zooms in`, () => {
          const onTimeRangeSelect: MockFunction = getJestMockFunction();
          const onZoomOut: MockFunction = getJestMockFunction();
          showHistogram(histogram, {
            bars: SHOWN_BARS,
            isLoading: false,
            onTimeRangeSelect: onTimeRangeSelect,
            onZoomOut: onZoomOut,
          });

          clickBar("10:04");
          // The click waits out the double-click window, its bar banded.
          expect(drawnBand()).not.toBeNull();
          expect(onTimeRangeSelect).not.toHaveBeenCalled();

          // The chart's next window lands (or starts loading) with no bars.
          rerenderHistogram({ bars: [], isLoading: placeholder.isLoading });
          expect(
            shownHistogram().rendered.container.querySelector(
              ".recharts-wrapper",
            ),
          ).toBeNull();

          const box: HTMLElement = placeholder.find(histogram);
          expect(box).toHaveClass("select-none");
          doubleClickOn(box);
          expect(onZoomOut).toHaveBeenCalledTimes(1);

          waitOutTheDoubleClickWindow();
          expect(onTimeRangeSelect).not.toHaveBeenCalled();
          expect(onZoomOut).toHaveBeenCalledTimes(1);
        });
      }
    });

    /*
     * The zoomed window lands in the middle of the double-click: its bars
     * take the loader's place between the second press and its release.
     * No dblclick reaches the chart - the node the press went down on is
     * gone, or kept without a dblclick handler - and before commit
     * b6ec899df4 the chart stayed zoomed.
     */
    describe("a double-click on the loader whose second press the bars land under", () => {
      for (const ending of LOADER_RACE_ENDINGS) {
        test(`zoomed: ${ending.name}, it zooms out once, in the next task`, () => {
          const onTimeRangeSelect: MockFunction = getJestMockFunction();
          const onZoomOut: MockFunction = getJestMockFunction();
          const container: HTMLElement = showHistogram(histogram, {
            bars: [],
            isLoading: true,
            onTimeRangeSelect: onTimeRangeSelect,
            onZoomOut: onZoomOut,
          });
          const pressed: HTMLElement = ending.pressTarget();

          clickThenPressAgain(pressed);
          rerenderHistogram({ bars: SHOWN_BARS, isLoading: false });
          expectChartInTheLoadersPlace(container);

          browserSendsTheClicks(pressed, ending.release(container, 0));

          // No dblclick reached the chart: the zoom-out waits for the next task.
          expect(onZoomOut).not.toHaveBeenCalled();

          nextTask();
          expect(onZoomOut).toHaveBeenCalledTimes(1);

          waitOutTheDoubleClickWindow();
          runEveryPendingTimer();
          expect(onZoomOut).toHaveBeenCalledTimes(1);
          expect(onTimeRangeSelect).not.toHaveBeenCalled();
        });
      }

      test("zoomed: when the browser does send the click and the dblclick, to the box around the new chart, it zooms out exactly once", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        const onZoomOut: MockFunction = getJestMockFunction();
        const container: HTMLElement = showHistogram(histogram, {
          bars: [],
          isLoading: true,
          onTimeRangeSelect: onTimeRangeSelect,
          onZoomOut: onZoomOut,
        });

        clickThenPressAgain(loaderBox());
        rerenderHistogram({ bars: SHOWN_BARS, isLoading: false });
        const chartRoot: Element = chartRootIn(container);
        release(chartRoot, STILL_POINTER, 2);
        const chartBox: HTMLElement | null = chartRoot.parentElement;
        if (!chartBox) {
          throw new Error("the chart has no box around it");
        }
        fireEvent.click(chartBox, { ...STILL_POINTER, button: 0, detail: 2 });
        fireEvent.doubleClick(chartBox, {
          ...STILL_POINTER,
          button: 0,
          detail: 2,
        });

        expect(onZoomOut).toHaveBeenCalledTimes(1);

        nextTask();
        waitOutTheDoubleClickWindow();
        runEveryPendingTimer();
        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      for (const ending of LOADER_RACE_ENDINGS) {
        test(`not zoomed: ${ending.name}, it zooms nothing in and throws nothing, and a click on a bar then zooms in as ever`, () => {
          const onTimeRangeSelect: MockFunction = getJestMockFunction();
          const container: HTMLElement = showHistogram(histogram, {
            bars: [],
            isLoading: true,
            onTimeRangeSelect: onTimeRangeSelect,
          });
          const pressed: HTMLElement = ending.pressTarget();

          expect(
            errorsThrownBy((): void => {
              clickThenPressAgain(pressed);
              rerenderHistogram({ bars: SHOWN_BARS, isLoading: false });
              browserSendsTheClicks(pressed, ending.release(container, 0));
              nextTask();
              waitOutTheDoubleClickWindow();
            }),
          ).toEqual([]);
          expect(onTimeRangeSelect).not.toHaveBeenCalled();

          clickBar("10:04");
          expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
        });
      }

      for (const ending of LOADER_RACE_ENDINGS) {
        test(`zoomed: the same with the right button - ${ending.name} - zooms nothing out`, () => {
          const onTimeRangeSelect: MockFunction = getJestMockFunction();
          const onZoomOut: MockFunction = getJestMockFunction();
          const container: HTMLElement = showHistogram(histogram, {
            bars: [],
            isLoading: true,
            onTimeRangeSelect: onTimeRangeSelect,
            onZoomOut: onZoomOut,
          });

          rightClickThenPressAgain(ending.pressTarget());
          rerenderHistogram({ bars: SHOWN_BARS, isLoading: false });
          // A right-button release: a context menu, no click.
          ending.release(container, 2);
          nextTask();
          waitOutTheDoubleClickWindow();
          runEveryPendingTimer();

          expect(onZoomOut).not.toHaveBeenCalled();
          expect(onTimeRangeSelect).not.toHaveBeenCalled();
        });
      }
    });

    /*
     * The header says how to zoom in only when there are bars to click or
     * drag; with none, "Click or drag to zoom" pointed at nothing, and only
     * the way back applies (commit b6ec899df4).
     */
    describe("its header's zoom hints", () => {
      const INTERVALS: Array<{
        name: string;
        withoutBucketInterval: boolean;
        zoomInHint: string;
      }> = [
        {
          name: "a bar can be clicked",
          withoutBucketInterval: false,
          zoomInHint: "Click or drag to zoom",
        },
        {
          name: "only a drag zooms (no bucket interval)",
          withoutBucketInterval: true,
          zoomInHint: "Drag to zoom",
        },
      ];

      for (const interval of INTERVALS) {
        test(`where ${interval.name}: zoomed with no bars, loaded or loading, only "Double-click to reset"; the zoom-in hint comes back with the bars`, () => {
          showHistogram(histogram, {
            bars: [],
            isLoading: false,
            onTimeRangeSelect: getJestMockFunction(),
            onZoomOut: getJestMockFunction(),
            withoutBucketInterval: interval.withoutBucketInterval,
          });

          expect(zoomInHintsShown()).toEqual([]);
          expect(screen.getByText("Double-click to reset")).toBeInTheDocument();

          // The empty window loads again.
          rerenderHistogram({ isLoading: true });

          expect(zoomInHintsShown()).toEqual([]);
          expect(screen.getByText("Double-click to reset")).toBeInTheDocument();

          // Its bars land.
          rerenderHistogram({ bars: SHOWN_BARS, isLoading: false });

          expect(zoomInHintsShown()).toEqual([interval.zoomInHint]);
          expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
        });

        test(`where ${interval.name}: not zoomed, with bars, the zoom-in hint alone`, () => {
          showHistogram(histogram, {
            bars: SHOWN_BARS,
            isLoading: false,
            onTimeRangeSelect: getJestMockFunction(),
            withoutBucketInterval: interval.withoutBucketInterval,
          });

          expect(zoomInHintsShown()).toEqual([interval.zoomInHint]);
          expect(screen.queryByText("Double-click to reset")).toBeNull();
        });
      }
    });

    describe("reloading an empty window", () => {
      /*
       * Before commit b6ec899df4 a zoomed chart with no bars swapped its
       * whole card for the bare loader box whenever it loaded: the title
       * and the way back went, and the box under the pointer changed
       * height (h-32 for h-[120px]) - just as the reader double-clicked.
       */
      test("zoomed: the card stays - its title and the way back - and the loader comes up in its empty box, which takes the double-click", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        const onZoomOut: MockFunction = getJestMockFunction();
        const container: HTMLElement = showHistogram(histogram, {
          bars: [],
          isLoading: false,
          onTimeRangeSelect: onTimeRangeSelect,
          onZoomOut: onZoomOut,
        });
        const card: HTMLElement | null =
          container.firstElementChild as HTMLElement | null;
        const title: HTMLElement = screen.getByText(histogram.title);
        const emptyBox: HTMLElement = screen.getByText(histogram.emptyText);

        // A filter changes, say: the zoomed window loads again.
        rerenderHistogram({ isLoading: true });

        // The very same card and box, not a bare loader in their place.
        expect(container.firstElementChild).toBe(card);
        expect(title.isConnected).toBe(true);
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
        expect(screen.queryByText(histogram.emptyText)).toBeNull();

        const box: HTMLElement = loaderBox();
        expect(box).toBe(emptyBox);
        expect(card).toContainElement(box);
        expect(box).toHaveClass("h-[120px]", "select-none");
        expect(box).not.toHaveClass("h-32");

        doubleClickOn(box);
        expect(onZoomOut).toHaveBeenCalledTimes(1);

        waitOutTheDoubleClickWindow();
        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      test("not zoomed: loading with no bars is still the bare loader box, with no card around it", () => {
        const container: HTMLElement = showHistogram(histogram, {
          bars: [],
          isLoading: true,
          onTimeRangeSelect: getJestMockFunction(),
        });

        const box: HTMLElement = loaderBox();
        expect(container.firstElementChild).toBe(box);
        expect(box).toHaveClass("h-32");
        expect(screen.queryByText(histogram.title)).toBeNull();
        expect(screen.queryByText("Double-click to reset")).toBeNull();
      });
    });
  });
}

/* The log and trace analytics views */

type WindowName = "wide" | "zoomed";

// The viewer's window before the zoom (six hours), and the zoomed hour.
const WINDOWS: Record<WindowName, { startTime: string; endTime: string }> = {
  wide: {
    startTime: "2026-09-28T06:00:00.000Z",
    endTime: "2026-09-28T12:00:00.000Z",
  },
  zoomed: {
    startTime: "2026-09-28T11:00:00.000Z",
    endTime: "2026-09-28T12:00:00.000Z",
  },
};

/*
 * Each window's props, built once: the views refetch whenever the object
 * they are handed changes, as a viewer's does when its window does.
 */
const LOGS_TIME_RANGES: Record<WindowName, RangeStartAndEndDateTime> = {
  wide: {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(WINDOWS.wide.startTime),
      new Date(WINDOWS.wide.endTime),
    ),
  },
  zoomed: {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(WINDOWS.zoomed.startTime),
      new Date(WINDOWS.zoomed.endTime),
    ),
  },
};

const TRACES_BASE_FILTERS: Record<WindowName, JSONObject> = {
  wide: { ...WINDOWS.wide },
  zoomed: { ...WINDOWS.zoomed },
};

const NO_FACET_FILTERS: Map<string, Set<string>> = new Map();
// The logs viewer's severity filter, narrowed to errors.
const ERRORS_ONLY: Map<string, Set<string>> = new Map([
  ["severityText", new Set(["Error"])],
]);
const NO_ATTRIBUTES: Array<string> = [];
const NO_SERVICE_NAMES: Record<string, string> = {};

interface HostZoomHandlers {
  onTimeRangeSelect?: SelectHandler | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

interface AnalyticsViewUnderTest {
  name: string;
  route: string;
  timeseriesTestId: string;
  // What the top list and the table show once they land.
  groupText: string;
  /*
   * The view on `window`. `refetched` asks it for its window again without
   * moving it: the logs viewer's filter changes, the traces explorer's
   * Refresh button bumps its tick.
   */
  render: (
    window: WindowName,
    handlers: HostZoomHandlers,
    refetched?: boolean,
  ) => React.ReactElement;
}

const ANALYTICS_VIEWS: Array<AnalyticsViewUnderTest> = [
  {
    name: "LogsAnalyticsView",
    route: LOGS_ANALYTICS_ROUTE,
    timeseriesTestId: LOGS_ANALYTICS_TIMESERIES_TEST_ID,
    groupText: "Error",
    render: (
      window: WindowName,
      handlers: HostZoomHandlers,
      refetched?: boolean,
    ): React.ReactElement => {
      return (
        <LogsAnalyticsView
          timeRange={LOGS_TIME_RANGES[window]}
          appliedFacetFilters={refetched ? ERRORS_ONLY : NO_FACET_FILTERS}
          logAttributes={NO_ATTRIBUTES}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onTimeRangeReset={handlers.onTimeRangeReset}
        />
      );
    },
  },
  {
    name: "TracesAnalyticsView",
    route: TRACES_ANALYTICS_ROUTE,
    timeseriesTestId: TRACES_ANALYTICS_TIMESERIES_TEST_ID,
    groupText: "GET /",
    render: (
      window: WindowName,
      handlers: HostZoomHandlers,
      refetched?: boolean,
    ): React.ReactElement => {
      return (
        <TracesAnalyticsView
          baseFilters={TRACES_BASE_FILTERS[window]}
          attributeKeys={NO_ATTRIBUTES}
          serviceNameMap={NO_SERVICE_NAMES}
          refreshTick={refetched ? 1 : 0}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onTimeRangeReset={handlers.onTimeRangeReset}
        />
      );
    },
  },
];

interface SpyZoom {
  zoom: TimeRangeZoom;
  zoomToTimeRange: MockFunction;
  resetZoom: MockFunction;
}

// The zoom a viewer offers the charts inside it, with its two gestures spied on.
function spyZoom(isZoomed: boolean): SpyZoom {
  const zoomToTimeRange: MockFunction = getJestMockFunction();
  const resetZoom: MockFunction = getJestMockFunction();
  return {
    zoomToTimeRange: zoomToTimeRange,
    resetZoom: resetZoom,
    zoom: {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? LOGS_TIME_RANGES.wide : null,
      zoomToTimeRange: (startTime: Date, endTime: Date): void => {
        zoomToTimeRange(startTime, endTime);
      },
      resetZoom: (): void => {
        resetZoom();
      },
    },
  };
}

function inViewer(
  zoom: TimeRangeZoom,
  view: React.ReactElement,
): React.ReactElement {
  return <TimeRangeZoomProvider zoom={zoom}>{view}</TimeRangeZoomProvider>;
}

async function waitForTimeseries(view: AnalyticsViewUnderTest): Promise<void> {
  await waitFor(() => {
    expect(
      chartRootIn(screen.getByTestId(view.timeseriesTestId)),
    ).toBeInTheDocument();
  });
}

// The reader picks another chart in the view's "Chart" control.
function switchChartTo(chartType: string): void {
  fireEvent.change(screen.getByDisplayValue("Timeseries"), {
    target: { value: chartType },
  });
}

const NOT_TIME_CHARTS: Array<[string, string]> = [
  ["top list", "toplist"],
  ["table", "table"],
];

for (const view of ANALYTICS_VIEWS) {
  describe(`${view.name}: the loader standing in for the chart while it refetches`, () => {
    test("timeseries, zoomed by the viewer around it: a double-click on the loader of the zoom's refetch zooms out once", async () => {
      const beforeTheZoom: SpyZoom = spyZoom(false);
      const zoomed: SpyZoom = spyZoom(true);
      const { rerender } = render(
        inViewer(beforeTheZoom.zoom, view.render("wide", {})),
      );
      await waitForTimeseries(view);

      // The reader zoomed: the viewer is on the zoomed hour, and refetches.
      holdRequests();
      rerender(inViewer(zoomed.zoom, view.render("zoomed", {})));
      expect(heldBodies(view.route)).toEqual([
        expect.objectContaining({
          chartType: "timeseries",
          startTime: WINDOWS.zoomed.startTime,
          endTime: WINDOWS.zoomed.endTime,
        }),
      ]);
      expect(screen.queryByTestId(view.timeseriesTestId)).toBeNull();

      const box: HTMLElement = loaderBox();
      expect(box).toHaveClass("select-none");
      doubleClickOn(box);
      expect(zoomed.resetZoom).toHaveBeenCalledTimes(1);

      waitOutTheDoubleClickWindow();
      expect(zoomed.resetZoom).toHaveBeenCalledTimes(1);
      expect(zoomed.zoomToTimeRange).not.toHaveBeenCalled();
      expect(beforeTheZoom.resetZoom).not.toHaveBeenCalled();
      expect(beforeTheZoom.zoomToTimeRange).not.toHaveBeenCalled();

      await answerHeldRequests();
      await waitForTimeseries(view);
    });

    test("timeseries, zoomed by its host: a double-click on the loader zooms out through the host's reset, once", async () => {
      const hostSelect: MockFunction = getJestMockFunction();
      const hostReset: MockFunction = getJestMockFunction();
      const { rerender } = render(
        view.render("wide", { onTimeRangeSelect: hostSelect }),
      );
      await waitForTimeseries(view);

      holdRequests();
      rerender(
        view.render("zoomed", {
          onTimeRangeSelect: hostSelect,
          onTimeRangeReset: hostReset,
        }),
      );
      expect(heldBodies(view.route)).toEqual([
        expect.objectContaining({
          chartType: "timeseries",
          startTime: WINDOWS.zoomed.startTime,
        }),
      ]);

      doubleClickOn(loaderBox());
      expect(hostReset).toHaveBeenCalledTimes(1);

      waitOutTheDoubleClickWindow();
      expect(hostReset).toHaveBeenCalledTimes(1);
      expect(hostSelect).not.toHaveBeenCalled();

      await answerHeldRequests();
      await waitForTimeseries(view);
    });

    /*
     * The loader takes the double-click as the chart does - through the
     * chart's own selection, which also drops the first click's zoom-in -
     * not by resetting the zoom behind the selection's back.
     */
    test("timeseries: a click on a bucket still waiting to zoom in when a refetch swaps the chart for the loader - a double-click on the loader drops it, and zooms out once", async () => {
      const zoomed: SpyZoom = spyZoom(true);
      const { rerender } = render(
        inViewer(zoomed.zoom, view.render("zoomed", {})),
      );
      await waitForTimeseries(view);

      const plot: HTMLElement = screen.getByTestId(view.timeseriesTestId);
      expect(plot.querySelector(".recharts-reference-area")).toBeNull();
      clickChartAt(chartRootIn(plot), spotOnTick(plot, "11:11"));
      /*
       * The click waits out the double-click window, its bucket banded. (On
       * the logs view's area chart a one-bucket band has no width, so
       * recharts draws the band's layer and no rectangle in it.)
       */
      expect(plot.querySelector(".recharts-reference-area")).not.toBeNull();
      expect(zoomed.zoomToTimeRange).not.toHaveBeenCalled();

      holdRequests();
      rerender(inViewer(zoomed.zoom, view.render("zoomed", {}, true)));
      expect(heldBodies(view.route)).toEqual([
        expect.objectContaining({
          chartType: "timeseries",
          startTime: WINDOWS.zoomed.startTime,
        }),
      ]);

      doubleClickOn(loaderBox());
      expect(zoomed.resetZoom).toHaveBeenCalledTimes(1);

      waitOutTheDoubleClickWindow();
      expect(zoomed.zoomToTimeRange).not.toHaveBeenCalled();
      expect(zoomed.resetZoom).toHaveBeenCalledTimes(1);

      await answerHeldRequests();
      await waitForTimeseries(view);
    });

    /*
     * The zoom's refetch lands in the middle of the double-click on its
     * loader: the chart takes the loader's place between the second press
     * and its release, and no dblclick reaches the chart - the view keeps
     * the loader's box for the chart, without its handlers. Before commit
     * b6ec899df4 the loader took only the dblclick, and the view stayed
     * zoomed.
     */
    for (const ending of LOADER_RACE_ENDINGS) {
      test(`timeseries, zoomed by the viewer: a double-click on the loader whose second press the chart lands under - ${ending.name} - zooms out once, in the next task`, async () => {
        const beforeTheZoom: SpyZoom = spyZoom(false);
        const zoomed: SpyZoom = spyZoom(true);
        const { rerender } = render(
          inViewer(beforeTheZoom.zoom, view.render("wide", {})),
        );
        await waitForTimeseries(view);

        holdRequests();
        rerender(inViewer(zoomed.zoom, view.render("zoomed", {})));
        const pressed: HTMLElement = ending.pressTarget();

        clickThenPressAgain(pressed);
        await answerHeldRequests();
        await waitForTimeseries(view);

        const chartArea: HTMLElement = screen.getByTestId(
          view.timeseriesTestId,
        );
        expectChartInTheLoadersPlace(chartArea);
        expect(zoomed.resetZoom).not.toHaveBeenCalled();

        browserSendsTheClicks(pressed, ending.release(chartArea, 0));

        // No dblclick reached the chart: the reset waits for the next task.
        expect(zoomed.resetZoom).not.toHaveBeenCalled();

        nextTask();
        expect(zoomed.resetZoom).toHaveBeenCalledTimes(1);

        waitOutTheDoubleClickWindow();
        runEveryPendingTimer();
        expect(zoomed.resetZoom).toHaveBeenCalledTimes(1);
        expect(zoomed.zoomToTimeRange).not.toHaveBeenCalled();
        expect(beforeTheZoom.resetZoom).not.toHaveBeenCalled();
      });
    }

    for (const [chartName, chartType] of NOT_TIME_CHARTS) {
      test(`the ${chartName} is no time chart: zoomed by the viewer, a double-click on its loader zooms nothing out`, async () => {
        const zoomed: SpyZoom = spyZoom(true);
        render(inViewer(zoomed.zoom, view.render("zoomed", {})));
        await waitForTimeseries(view);

        holdRequests();
        switchChartTo(chartType);
        expect(heldBodies(view.route)).toEqual([
          expect.objectContaining({ chartType: chartType }),
        ]);

        const box: HTMLElement = loaderBox();
        expect(
          errorsThrownBy((): void => {
            doubleClickOn(box);
            waitOutTheDoubleClickWindow();
          }),
        ).toEqual([]);
        expect(zoomed.resetZoom).not.toHaveBeenCalled();
        expect(zoomed.zoomToTimeRange).not.toHaveBeenCalled();

        await answerHeldRequests();
        await waitFor(() => {
          expect(screen.getByText(view.groupText)).toBeInTheDocument();
        });
      });

      /*
       * A host's handlers reach the view whatever chart it shows (see
       * resolveChartTimeRangeZoom), so here only the loader itself keeps the
       * double-click from the host's reset.
       */
      test(`the ${chartName} is no time chart: zoomed by its host, a double-click on its loader does not reach the host's reset`, async () => {
        const hostSelect: MockFunction = getJestMockFunction();
        const hostReset: MockFunction = getJestMockFunction();
        render(
          view.render("zoomed", {
            onTimeRangeSelect: hostSelect,
            onTimeRangeReset: hostReset,
          }),
        );
        await waitForTimeseries(view);

        holdRequests();
        switchChartTo(chartType);
        expect(heldBodies(view.route)).toEqual([
          expect.objectContaining({ chartType: chartType }),
        ]);

        doubleClickOn(loaderBox());
        waitOutTheDoubleClickWindow();
        expect(hostReset).not.toHaveBeenCalled();
        expect(hostSelect).not.toHaveBeenCalled();

        await answerHeldRequests();
        await waitFor(() => {
          expect(screen.getByText(view.groupText)).toBeInTheDocument();
        });
      });
    }
  });
}

/* An exception's Occurrence Trend */

const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";

function trendRequests(): Array<Record<string, unknown>> {
  return requestsTo(EXCEPTIONS_HISTOGRAM_ROUTE);
}

function spanOf(body: Record<string, unknown> | undefined): number {
  if (!body) {
    throw new Error("no such request");
  }
  return (
    new Date(String(body["endTime"])).getTime() -
    new Date(String(body["startTime"])).getTime()
  );
}

function trendResetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function renderTrend(): void {
  render(
    <ExceptionOccurrenceTrend
      fingerprint={FINGERPRINT}
      primaryEntityId={new ObjectID(SERVICE_ID)}
    />,
  );
}

async function waitForTrendBars(): Promise<void> {
  await waitFor(() => {
    expect(
      chartRootIn(screen.getByTestId("exception-trend-plot")),
    ).toBeInTheDocument();
  });
}

/*
 * A drag on the real chart, from the bar under one drawn tick label to the
 * bar under the next: the card zooms into those two bars.
 */
function dragAcrossTwoBars(): void {
  const plot: HTMLElement = screen.getByTestId("exception-trend-plot");
  const chartRoot: Element = chartRootIn(plot);
  const ticks: Array<DrawnTick> = drawnTicks(plot);
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  const from: PointerSpot = { clientX: ticks[0]!.x, clientY: POINTER_Y };
  const to: PointerSpot = { clientX: ticks[1]!.x, clientY: POINTER_Y };

  restAt(chartRoot, from);
  press(chartRoot, from, 1);
  nextFrame();
  moveHeld(chartRoot, to);
  nextFrame();
  release(chartRoot, to, 1);
}

describe("an exception's Occurrence Trend: the loader standing in for its bars", () => {
  test("after a zoom, a double-click on the loader of the zoomed window goes back to the preset, once", async () => {
    renderTrend();
    await waitForTrendBars();
    expect(trendRequests()).toHaveLength(1);
    expect(spanOf(trendRequests()[0])).toBe(DAY_MS);

    // The zoom clears the bars and asks for the dragged window.
    holdRequests();
    dragAcrossTwoBars();
    expect(trendRequests()).toHaveLength(2);
    expect(spanOf(trendRequests()[1])).toBeLessThan(DAY_MS);
    expect(heldBodies(EXCEPTIONS_HISTOGRAM_ROUTE)).toEqual([
      trendRequests()[1],
    ]);
    expect(trendResetButton()).toBeInTheDocument();
    expect(
      screen.getByText("Loading occurrences for the selected window…"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("exception-trend-plot")).toBeNull();

    const box: HTMLElement = loaderBox();
    expect(box).toHaveClass("select-none");
    doubleClickOn(box);

    // Back on the whole preset: one request for the last 24 hours.
    expect(trendRequests()).toHaveLength(3);
    expect(spanOf(trendRequests()[2])).toBe(DAY_MS);
    expect(trendResetButton()).toBeNull();
    expect(
      screen.getByText("Loading occurrences for the last 24 hours…"),
    ).toBeInTheDocument();

    waitOutTheDoubleClickWindow();
    expect(trendRequests()).toHaveLength(3);

    await answerHeldRequests();
    await waitForTrendBars();
    expect(
      screen.getByText(/occurrences in the last 24 hours$/),
    ).toBeInTheDocument();
    expect(trendRequests()).toHaveLength(3);
  });

  /*
   * The zoomed window's bars land in the middle of the double-click on
   * the loader: they take its place between the second press and its
   * release, and no dblclick reaches them - the card keeps the loader's
   * box for them, without its handlers. Before commit b6ec899df4 the
   * loader took only the dblclick, and the card stayed on the zoomed
   * window.
   */
  for (const ending of LOADER_RACE_ENDINGS) {
    test(`after a zoom, a double-click on the loader whose second press the bars land under - ${ending.name} - goes back to the preset once, in the next task`, async () => {
      renderTrend();
      await waitForTrendBars();

      holdRequests();
      dragAcrossTwoBars();
      expect(trendRequests()).toHaveLength(2);
      const pressed: HTMLElement = ending.pressTarget();

      clickThenPressAgain(pressed);
      await answerHeldRequests();
      await waitForTrendBars();

      const chartArea: HTMLElement = screen.getByTestId("exception-trend-plot");
      expectChartInTheLoadersPlace(chartArea);
      expect(trendResetButton()).toBeInTheDocument();

      browserSendsTheClicks(pressed, ending.release(chartArea, 0));

      // No dblclick reached the bars: the reset waits for the next task.
      expect(trendRequests()).toHaveLength(2);

      nextTask();

      // Back on the whole preset: one request for the last 24 hours.
      expect(trendRequests()).toHaveLength(3);
      expect(spanOf(trendRequests()[2])).toBe(DAY_MS);
      expect(trendResetButton()).toBeNull();

      waitOutTheDoubleClickWindow();
      runEveryPendingTimer();
      await waitForTrendBars();
      expect(trendRequests()).toHaveLength(3);
      expect(
        screen.getByText(/occurrences in the last 24 hours$/),
      ).toBeInTheDocument();
    });
  }

  test("before any zoom, a double-click on the first load's loader asks for nothing and throws nothing", async () => {
    holdRequests();
    renderTrend();
    expect(trendRequests()).toHaveLength(1);

    const box: HTMLElement = loaderBox();
    expect(
      errorsThrownBy((): void => {
        doubleClickOn(box);
        waitOutTheDoubleClickWindow();
      }),
    ).toEqual([]);
    expect(trendRequests()).toHaveLength(1);
    expect(trendResetButton()).toBeNull();

    await answerHeldRequests();
    await waitForTrendBars();
    expect(trendRequests()).toHaveLength(1);
  });
});
