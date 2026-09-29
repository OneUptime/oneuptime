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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * Issue #4116, on the explorers the customer reported it from. A drag across
 * an explorer's volume histogram zooms the explorer, which at once asks for
 * the zoomed window's bars - and a reader who wants the old window back
 * double-clicks at about the moment those bars land. Both shells the
 * explorers are built on are mounted here: TelemetryViewer (Traces,
 * Exceptions, Security events) and Common's LogsViewer (Logs). Each sits
 * under a host that owns its window the way the Dashboard's TracesViewer and
 * DashboardLogsViewer do: it asks for a window's bars whenever its window
 * changes and keeps the bars it has until the answer comes, and the test
 * decides when that is. Recharts is real; only ResponsiveContainer is stood
 * in for, and the pointer goes to the plot at the x recharts drew a bar's
 * tick label at.
 *
 * When new bars come in, recharts re-keys every bar and drops a band a
 * click painted over a bar the new window does not have. Chrome sends no
 * click and no dblclick for a press whose node left the page before its
 * release (measured in Chrome with a Playwright harness), so the events
 * fired below are the ones Chrome sent:
 *
 *   - The answer lands during the second press: no click, no dblclick. The
 *     explorer stayed zoomed, and that release, read against the new bars,
 *     was taken for a drag from an old bar to a new one, so the explorer
 *     jumped to a window nobody picked. The second press is now the zoom-out
 *     itself, and with no dblclick to do it, it happens on the next task.
 *     Failed before the fix.
 *   - The answer lands during the first press: that release, read the same
 *     way, zoomed in once more before the dblclick zoomed out. A press whose
 *     bar changed under a pointer that did not leave it now zooms nowhere.
 *     Failed before the fix.
 *   - The answer lands between the clicks, or before the double-click: the
 *     dblclick arrives and the explorer zooms out once, as it did before.
 */

/*
 * The logs viewer loads services and log attributes on mount; nothing here
 * depends on what comes back.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({ data: {} });
      },
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

/*
 * The real one loads the browser's OpenTelemetry set-up, whose zone.js
 * patches Promise for the whole file.
 */
jest.mock("../../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
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
    ResponsiveContainer: (props: {
      children: React.ReactElement;
    }): React.ReactElement => {
      return react.cloneElement(props.children, { width: 600, height: 300 });
    },
  };
});

// Imported after the mocks so the viewers pick them up.
import TelemetryViewer from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import {
  HistogramBucket as TelemetryHistogramBucket,
  HistogramSeriesOption,
} from "../../../../UI/Components/TelemetryViewer/types";
import LogsViewer, {
  ComponentProps as LogsViewerProps,
} from "../../../../UI/Components/LogsViewer/LogsViewer";
import { HistogramBucket as LogsHistogramBucket } from "../../../../UI/Components/LogsViewer/types";
import useLogsHistogram, {
  LogsHistogramData,
  LogsHistogramState,
} from "../../../../UI/Components/LogsViewer/useLogsHistogram";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";

const MINUTE_MS: number = 60 * 1000;
// One animation frame, as fake timers run them.
const FRAME_MS: number = 16;
// The explorers open on the past hour: 11:00 to 12:00.
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
// Inside the plot, low enough to be over every bar.
const PLOT_Y: number = 200;

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };
const RESET_HINT: string = "Double-click to reset";
const HOST_WINDOW_TEST_ID: string = "host-window";
const TICK_LABEL_SELECTOR: string =
  ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value";

// The hour, in five-minute bars.
const HOUR_BARS: Array<string> = [
  "11:00",
  "11:05",
  "11:10",
  "11:15",
  "11:20",
  "11:25",
  "11:30",
  "11:35",
  "11:40",
  "11:45",
  "11:50",
  "11:55",
];

/*
 * The drag runs from the hour's 11:10 bar to its 11:15 bar, and zooms
 * through the end of the last one. The double-click lands where the drag
 * let go.
 */
const DRAG_FROM: string = "11:10";
const DRAG_TO: string = "11:15";
const ZOOMED_WINDOW: string =
  "2026-09-28T11:10:00.000Z..2026-09-28T11:20:00.000Z";

/*
 * The zoomed ten minutes, in two-minute bars. The hour's 11:15 bar, where
 * the double-click lands, is not one of them, so a click on it that zoomed
 * in after all would show up as a zoom into 11:15..11:20.
 */
const ZOOMED_BARS: Array<string> = [
  "11:10",
  "11:12",
  "11:14",
  "11:16",
  "11:18",
];

const ZOOM_CALL: string = `select ${ZOOMED_WINDOW}`;
const RESET_CALL: string = `change ${TimeRange.PAST_ONE_HOUR}`;

// "Past 1 Hour", or a custom window as start..end.
function describeRange(range: RangeStartAndEndDateTime): string {
  if (range.range !== TimeRange.CUSTOM || !range.startAndEndDate) {
    return range.range;
  }

  return `${new Date(range.startAndEndDate.startValue).toISOString()}..${new Date(
    range.startAndEndDate.endValue,
  ).toISOString()}`;
}

/*
 * The explorers' histogram endpoint, answering only when the test says so.
 * It buckets a window into about a dozen bars, never narrower than two
 * minutes, and labels them the way ClickHouse does.
 */
interface HistogramAnswer {
  bucketStartsMs: Array<number>;
  bucketIntervalMs: number;
}

interface HistogramRequest {
  // The host's window when it asked.
  window: string;
  answer: HistogramAnswer;
  resolve: (answer: HistogramAnswer) => void;
  isAnswered: boolean;
}

const histogramRequests: Array<HistogramRequest> = [];

function answerFor(range: RangeStartAndEndDateTime): HistogramAnswer {
  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(range);
  const startMs: number = new Date(window.startValue).getTime();
  const endMs: number = new Date(window.endValue).getTime();
  const bucketIntervalMs: number =
    Math.max(2, Math.round((endMs - startMs) / MINUTE_MS / 12)) * MINUTE_MS;
  const firstBucketMs: number =
    Math.floor(startMs / bucketIntervalMs) * bucketIntervalMs;
  const count: number = Math.round((endMs - startMs) / bucketIntervalMs);

  return {
    bucketStartsMs: Array.from(
      { length: count },
      (_: unknown, index: number): number => {
        return firstBucketMs + index * bucketIntervalMs;
      },
    ),
    bucketIntervalMs: bucketIntervalMs,
  };
}

function askForHistogram(
  range: RangeStartAndEndDateTime,
): Promise<HistogramAnswer> {
  return new Promise<HistogramAnswer>(
    (resolve: (answer: HistogramAnswer) => void): void => {
      histogramRequests.push({
        window: describeRange(range),
        answer: answerFor(range),
        resolve: resolve,
        isAnswered: false,
      });
    },
  );
}

// The answer still held back comes in, and the host re-renders with it.
async function deliverHeldAnswer(): Promise<void> {
  const held: Array<HistogramRequest> = histogramRequests.filter(
    (request: HistogramRequest): boolean => {
      return !request.isAnswered;
    },
  );
  const request: HistogramRequest | undefined = held[held.length - 1];

  if (!request) {
    throw new Error("no histogram answer is held back");
  }

  await act(async () => {
    request.isAnswered = true;
    request.resolve(request.answer);
  });
}

function requestedWindows(): Array<string> {
  return histogramRequests.map((request: HistogramRequest): string => {
    return request.window;
  });
}

function heldWindows(): Array<string> {
  return histogramRequests
    .filter((request: HistogramRequest): boolean => {
      return !request.isAnswered;
    })
    .map((request: HistogramRequest): string => {
      return request.window;
    });
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// ClickHouse's DateTime rendering: "2026-09-28 11:10:00".
function bucketLabel(startMs: number): string {
  const date: Date = new Date(startMs);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;
}

function countAt(startMs: number): number {
  return 20 + (Math.floor(startMs / MINUTE_MS) % 10);
}

// What each host was asked to do, in order.
const hostCalls: Array<string> = [];

// The windows the host was asked to zoom to.
function zoomCalls(): Array<string> {
  return hostCalls.filter((call: string): boolean => {
    return call.startsWith("select ");
  });
}

interface HostWindow {
  timeRange: RangeStartAndEndDateTime;
  onHistogramTimeRangeSelect: (startTime: Date, endTime: Date) => void;
  onTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void;
}

/*
 * The window an explorer's host owns, as TracesViewer and
 * DashboardLogsViewer own theirs: a drag on the histogram becomes a custom
 * window, and any other range (the picker, the way back out of a zoom) is
 * applied as it comes.
 */
function useHostWindow(): HostWindow {
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(PAST_HOUR);

  return {
    timeRange: timeRange,
    onHistogramTimeRangeSelect: (startTime: Date, endTime: Date): void => {
      const zoomed: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(startTime, endTime),
      };
      hostCalls.push(`select ${describeRange(zoomed)}`);
      setTimeRange(zoomed);
    },
    onTimeRangeChange: (next: RangeStartAndEndDateTime): void => {
      hostCalls.push(`change ${describeRange(next)}`);
      setTimeRange(next);
    },
  };
}

interface TraceRow {
  id: string;
}

const TRACE_SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "Ok", color: "#10b981" },
];

/*
 * The traces explorer's host, as TracesViewer is: it asks for the new
 * window's bars on every window, keeps the bars it has while it waits, and
 * drops an answer to a window it has since left.
 */
const TracesExplorerHost: FunctionComponent = (): ReactElement => {
  const host: HostWindow = useHostWindow();
  const [buckets, setBuckets] = useState<Array<TelemetryHistogramBucket>>([]);
  const [bucketIntervalMs, setBucketIntervalMs] = useState<number | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const latestRequest: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    latestRequest.current += 1;
    const request: number = latestRequest.current;
    setIsLoading(true);

    askForHistogram(host.timeRange).then((answer: HistogramAnswer): void => {
      if (request !== latestRequest.current) {
        return;
      }

      setBuckets(
        answer.bucketStartsMs.map(
          (startMs: number): TelemetryHistogramBucket => {
            return {
              time: bucketLabel(startMs),
              series: "ok",
              count: countAt(startMs),
            };
          },
        ),
      );
      setBucketIntervalMs(answer.bucketIntervalMs);
      setIsLoading(false);
    });
  }, [host.timeRange]);

  return (
    <div>
      <span data-testid={HOST_WINDOW_TEST_ID}>
        {describeRange(host.timeRange)}
      </span>
      <TelemetryViewer<TraceRow>
        items={[]}
        isLoading={false}
        renderRow={(row: TraceRow): ReactElement => {
          return <span>{row.id}</span>;
        }}
        getRowKey={(row: TraceRow): string => {
          return row.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={host.timeRange}
        onTimeRangeChange={host.onTimeRangeChange}
        page={1}
        pageSize={50}
        totalCount={0}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        showHistogram={true}
        histogramBuckets={buckets}
        histogramSeries={TRACE_SERIES}
        histogramTitle="Traces over time"
        histogramLoading={isLoading}
        histogramBucketIntervalMs={bucketIntervalMs}
        onHistogramTimeRangeSelect={host.onHistogramTimeRangeSelect}
      />
    </div>
  );
};

const NO_LOG_FILTER: LogsViewerProps["filterData"] = {};

/*
 * The logs explorer's host, as DashboardLogsViewer is: its bars come
 * through useLogsHistogram, which keeps the bars it has while a new window
 * loads and drops an answer to a window it has since left.
 */
const LogsExplorerHost: FunctionComponent = (): ReactElement => {
  const host: HostWindow = useHostWindow();
  const timeRange: RangeStartAndEndDateTime = host.timeRange;

  const fetchBuckets: () => Promise<LogsHistogramData> =
    useCallback(async (): Promise<LogsHistogramData> => {
      const answer: HistogramAnswer = await askForHistogram(timeRange);
      return {
        buckets: answer.bucketStartsMs.map(
          (startMs: number): LogsHistogramBucket => {
            return {
              time: bucketLabel(startMs),
              severity: LogSeverity.Error,
              count: countAt(startMs),
            };
          },
        ),
        bucketIntervalMs: answer.bucketIntervalMs,
      };
    }, [timeRange]);

  const histogram: LogsHistogramState = useLogsHistogram(fetchBuckets);

  return (
    <div>
      <span data-testid={HOST_WINDOW_TEST_ID}>{describeRange(timeRange)}</span>
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={NO_LOG_FILTER}
        onFilterChanged={(): void => {}}
        histogramBuckets={histogram.buckets}
        histogramLoading={histogram.isLoading}
        histogramBucketIntervalMs={histogram.bucketIntervalMs}
        onHistogramTimeRangeSelect={host.onHistogramTimeRangeSelect}
        timeRange={timeRange}
        onTimeRangeChange={host.onTimeRangeChange}
      />
    </div>
  );
};

interface ExplorerUnderTest {
  name: string;
  host: FunctionComponent;
}

const EXPLORERS: Array<ExplorerUnderTest> = [
  {
    name: "traces explorer (TelemetryViewer)",
    host: TracesExplorerHost,
  },
  {
    name: "logs explorer (LogsViewer)",
    host: LogsExplorerHost,
  },
];

function hostWindow(): string {
  return screen.getByTestId(HOST_WINDOW_TEST_ID).textContent || "";
}

function chartWrapper(): Element {
  const wrapper: Element | null = document.querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("the explorer drew no chart");
  }
  return wrapper;
}

function plotSurface(): Element {
  const surface: Element | null = chartWrapper().querySelector(
    "svg.recharts-surface",
  );
  if (!surface) {
    throw new Error("the chart drew no plot surface");
  }
  return surface;
}

// The bars on the chart, by their tick labels: "11:15 AM" (or "11:15") -> "11:15".
function barLabels(): Array<string> {
  return Array.from(chartWrapper().querySelectorAll(TICK_LABEL_SELECTOR)).map(
    (element: Element): string => {
      const text: string = element.textContent || "";
      const time: RegExpMatchArray | null = text.match(/^\d{1,2}:\d{2}/);
      return time ? time[0] : text;
    },
  );
}

// The pointer x that lands on a bar: the centre of its tick label.
function tickX(label: string): number {
  const tick: Element | undefined = Array.from(
    chartWrapper().querySelectorAll(TICK_LABEL_SELECTOR),
  ).find((element: Element): boolean => {
    return (element.textContent || "").startsWith(label);
  });
  if (!tick) {
    throw new Error(`the chart drew no tick label "${label}"`);
  }
  return Number(tick.getAttribute("x"));
}

function drawnBand(): Element | null {
  return chartWrapper().querySelector(".recharts-reference-area-rect");
}

function covers(element: Element, x: number, y: number): boolean {
  const left: number = Number(element.getAttribute("x"));
  const top: number = Number(element.getAttribute("y"));
  const width: number = Number(element.getAttribute("width"));
  const height: number = Number(element.getAttribute("height"));
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

/*
 * The node under the pointer, as the browser hit-tests it: a band a click
 * painted lies over the bars, and the bars over the plot.
 */
function nodeAt(x: number): Element {
  const band: Element | null = drawnBand();
  if (band && covers(band, x, PLOT_Y)) {
    return band;
  }

  const bar: Element | undefined = Array.from(
    chartWrapper().querySelectorAll(".recharts-bar-rectangle path"),
  ).find((element: Element): boolean => {
    return covers(element, x, PLOT_Y);
  });

  return bar || plotSurface();
}

function commonAncestor(first: Element, second: Element): Element {
  let node: Element | null = first;
  while (node && !node.contains(second)) {
    node = node.parentElement;
  }
  return node || document.body;
}

function pointerAt(
  x: number,
  init: Record<string, number>,
): Record<string, number> {
  return { clientX: x, clientY: PLOT_Y, ...init };
}

function nextFrame(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

// Lets the page's next task run: fake timers run what was set for 0 ms.
function nextTask(): void {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

// Long past the wait a single click on a zoomed chart makes before zooming in.
function outlastDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
  });
}

// The pointer comes to rest at x.
function restAt(x: number): void {
  fireEvent.mouseMove(nodeAt(x), pointerAt(x, { buttons: 0 }));
  nextFrame();
}

// The pointer moves to x with the button held down.
function moveHeldTo(x: number): void {
  fireEvent.mouseMove(nodeAt(x), pointerAt(x, { buttons: 1 }));
}

/*
 * A press at x, `detail` being the browser's click count (2 for the second
 * press of a double-click). Returns the node the press landed on.
 */
function pressAt(x: number, detail: number): Element {
  const node: Element = nodeAt(x);
  fireEvent.mouseDown(
    node,
    pointerAt(x, { button: 0, buttons: 1, detail: detail }),
  );
  return node;
}

function releaseAt(x: number, detail: number): Element {
  const node: Element = nodeAt(x);
  fireEvent.mouseUp(
    node,
    pointerAt(x, { button: 0, buttons: 0, detail: detail }),
  );
  return node;
}

/*
 * The click the browser sends after a release, to the nearest node holding
 * both the node the press landed on and the one the release did. Returns
 * where it went.
 */
function clickAfter(
  pressed: Element,
  released: Element,
  x: number,
  detail: number,
): Element {
  const target: Element = commonAncestor(pressed, released);
  fireEvent.click(target, pointerAt(x, { button: 0, detail: detail }));
  return target;
}

// A click at x that nothing disturbs.
function clickAt(x: number, detail: number): Element {
  const pressed: Element = pressAt(x, detail);
  return clickAfter(pressed, releaseAt(x, detail), x, detail);
}

// A second click at x that nothing disturbs, and the dblclick that follows it.
function secondClickAndDoubleClickAt(x: number): void {
  const clicked: Element = clickAt(x, 2);
  fireEvent.doubleClick(clicked, pointerAt(x, { button: 0, detail: 2 }));
}

// A drag from one bar to another, let go over the chart.
function dragAcross(fromX: number, toX: number): void {
  restAt(fromX);
  pressAt(fromX, 1);
  nextFrame();
  moveHeldTo(toX);
  nextFrame();
  releaseAt(toX, 1);
  fireEvent.click(plotSurface(), pointerAt(toX, { button: 0, detail: 1 }));
}

async function openExplorer(explorer: ExplorerUnderTest): Promise<void> {
  const Host: FunctionComponent = explorer.host;

  await act(async () => {
    render(<Host />);
  });

  expect(heldWindows()).toEqual([TimeRange.PAST_ONE_HOUR]);
  await deliverHeldAnswer();
  expect(barLabels()).toEqual(HOUR_BARS);
}

/*
 * Opens the explorer on the hour and drags across two of its bars. The
 * host moves to the ten minutes the drag covered and asks for their bars,
 * which the test holds back: the chart keeps drawing the hour's bars, and
 * offers the double-click that undoes the zoom. Returns where the drag let
 * go, which is where the double-click lands.
 */
async function openAndZoomByDragging(
  explorer: ExplorerUnderTest,
): Promise<number> {
  await openExplorer(explorer);

  const spot: number = tickX(DRAG_TO);
  dragAcross(tickX(DRAG_FROM), spot);

  expect(hostCalls).toEqual([ZOOM_CALL]);
  expect(hostWindow()).toBe(ZOOMED_WINDOW);
  expect(requestedWindows()).toEqual([TimeRange.PAST_ONE_HOUR, ZOOMED_WINDOW]);
  expect(heldWindows()).toEqual([ZOOMED_WINDOW]);
  expect(barLabels()).toEqual(HOUR_BARS);
  expect(screen.getByText(RESET_HINT)).toBeInTheDocument();

  return spot;
}

// The explorer is back on the hour, by the one way back, and asked for it again.
function expectBackOnTheHourOnce(): void {
  expect(hostWindow()).toBe(TimeRange.PAST_ONE_HOUR);
  expect(hostCalls).toEqual([ZOOM_CALL, RESET_CALL]);
  expect(requestedWindows()).toEqual([
    TimeRange.PAST_ONE_HOUR,
    ZOOMED_WINDOW,
    TimeRange.PAST_ONE_HOUR,
  ]);
  expect(screen.queryByText(RESET_HINT)).toBeNull();
}

beforeEach(() => {
  /*
   * Installed AT the fixed time, not moved there with setSystemTime: fake
   * timers count animation frames from the moment they are installed.
   */
  jest.useFakeTimers({ now: NOW });
  histogramRequests.splice(0, histogramRequests.length);
  hostCalls.splice(0, hostCalls.length);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

for (const explorer of EXPLORERS) {
  describe(`the ${explorer.name}: a double-click right after a drag-zoom, while the zoomed bars are on their way`, () => {
    test("the drag zooms the host to the bars it covered, and the chart keeps the hour's bars while that answer is held back", async () => {
      await openAndZoomByDragging(explorer);

      // Nothing else happens while the answer is out.
      outlastDoubleClickWindow();
      expect(hostCalls).toEqual([ZOOM_CALL]);
      expect(barLabels()).toEqual(HOUR_BARS);

      await deliverHeldAnswer();
      expect(barLabels()).toEqual(ZOOMED_BARS);
      expect(hostWindow()).toBe(ZOOMED_WINDOW);
      expect(screen.getByText(RESET_HINT)).toBeInTheDocument();
    });

    // (i) Failed before the fix: a zoom to 11:15..11:18, and still zoomed.
    test("the answer lands during the second press, which then gets no click and no dblclick: the next task puts the host back on the hour, and nothing zooms in", async () => {
      const spot: number = await openAndZoomByDragging(explorer);

      restAt(spot);
      clickAt(spot, 1);

      /*
       * On a zoomed chart the first click paints its bar while it waits out
       * the double-click window, so the second press lands on that band.
       */
      const band: Element | null = drawnBand();
      expect(band).not.toBeNull();
      const secondPress: Element = pressAt(spot, 2);
      expect(secondPress).toBe(band);

      await deliverHeldAnswer();

      /*
       * The zoomed minutes are drawn, and the band the press landed on is
       * gone with the hour's bars: Chrome sends this press no click and no
       * dblclick, and none is fired.
       */
      expect(barLabels()).toEqual(ZOOMED_BARS);
      expect(secondPress.isConnected).toBe(false);
      releaseAt(spot, 2);
      expect(zoomCalls()).toEqual([ZOOM_CALL]);

      nextTask();

      expectBackOnTheHourOnce();

      // Nor does the first click's zoom into 11:15 come later.
      outlastDoubleClickWindow();
      expect(hostCalls).toEqual([ZOOM_CALL, RESET_CALL]);
    });

    // (ii) Failed before the fix: a zoom to 11:15..11:18 before the zoom-out.
    test("the answer lands during the first press: that release zooms nowhere, and the dblclick puts the host back on the hour once", async () => {
      const spot: number = await openAndZoomByDragging(explorer);

      restAt(spot);
      const firstPress: Element = pressAt(spot, 1);
      expect(firstPress.closest(".recharts-bar-rectangle")).not.toBeNull();

      await deliverHeldAnswer();

      /*
       * The bar the press landed on is gone: Chrome sends this press no
       * click. Its release is over a bar of the new window, at a pointer
       * that never moved.
       */
      expect(barLabels()).toEqual(ZOOMED_BARS);
      expect(firstPress.isConnected).toBe(false);
      releaseAt(spot, 1);
      expect(hostCalls).toEqual([ZOOM_CALL]);

      secondClickAndDoubleClickAt(spot);
      outlastDoubleClickWindow();

      expectBackOnTheHourOnce();
    });

    // (ii) Failed before the fix: the drift read as a drag to 11:12..11:17.
    test("the answer lands during the first press while the hand drifts a couple of pixels: still no zoom, and the dblclick puts the host back on the hour once", async () => {
      const spot: number = await openAndZoomByDragging(explorer);

      restAt(spot);
      pressAt(spot, 1);
      await deliverHeldAnswer();
      expect(barLabels()).toEqual(ZOOMED_BARS);

      /*
       * A hand on a mouse is never quite still. The pointer drifts two
       * pixels, and recharts reads a bar of the new window under it: that
       * is not a drag, and paints nothing.
       */
      const drifted: number = spot + 2;
      moveHeldTo(drifted);
      expect(drawnBand()).toBeNull();
      releaseAt(drifted, 1);
      expect(hostCalls).toEqual([ZOOM_CALL]);

      secondClickAndDoubleClickAt(drifted);
      outlastDoubleClickWindow();

      expectBackOnTheHourOnce();
    });

    // Failed before the fix: a zoom to 11:15..11:18 at the release.
    test("the answer lands during the first press and no second click follows: that click zooms nowhere, and the explorer stays zoomed", async () => {
      const spot: number = await openAndZoomByDragging(explorer);

      restAt(spot);
      const pressed: Element = pressAt(spot, 1);
      await deliverHeldAnswer();
      expect(pressed.isConnected).toBe(false);
      releaseAt(spot, 1);

      /*
       * The bar it pressed is no longer on the chart, so there is nothing
       * to zoom into, then or once the double-click window has passed.
       */
      outlastDoubleClickWindow();
      expect(hostCalls).toEqual([ZOOM_CALL]);
      expect(hostWindow()).toBe(ZOOMED_WINDOW);
      expect(drawnBand()).toBeNull();
      expect(screen.getByText(RESET_HINT)).toBeInTheDocument();
    });

    // (iv) As before the fix; pinned so the new zoom-out path keeps it.
    test("the answer lands between the two clicks: the dblclick puts the host back on the hour once, and the first click never zooms in", async () => {
      const spot: number = await openAndZoomByDragging(explorer);

      restAt(spot);
      clickAt(spot, 1);
      expect(drawnBand()).not.toBeNull();

      await deliverHeldAnswer();
      expect(barLabels()).toEqual(ZOOMED_BARS);

      secondClickAndDoubleClickAt(spot);
      outlastDoubleClickWindow();

      expectBackOnTheHourOnce();
    });

    // (iii) As before the fix; pinned so the new zoom-out path keeps it.
    test("the answer lands before the double-click: the dblclick puts the host back on the hour once", async () => {
      const spot: number = await openAndZoomByDragging(explorer);

      await deliverHeldAnswer();
      expect(barLabels()).toEqual(ZOOMED_BARS);

      restAt(spot);
      clickAt(spot, 1);
      secondClickAndDoubleClickAt(spot);

      /*
       * The dblclick zoomed out at once. The reset the second press armed
       * for the next task stood down, and neither click zooms in later.
       */
      expectBackOnTheHourOnce();
      nextTask();
      outlastDoubleClickWindow();
      expect(hostCalls).toEqual([ZOOM_CALL, RESET_CALL]);
    });
  });
}
