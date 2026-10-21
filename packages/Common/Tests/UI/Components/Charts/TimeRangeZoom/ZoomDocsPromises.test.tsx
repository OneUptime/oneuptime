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
import React, { FunctionComponent, ReactElement, useState } from "react";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../../../MockType";

/*
 * The promises of the "Zooming Into a Time Range" docs page (issue #4105),
 * each checked against the rendered product: the page says it, and the
 * charts do it. A behaviour change that leaves the page behind - a reset
 * that climbs out one level at a time, a click on a line chart that zooms,
 * a hint in new words - fails here, next to the sentence it broke.
 *
 * The words on screen and the pure zoom rules are also checked, statically,
 * in App's Tests/FeatureSet/Docs/ChartTimeRangeZoomDocs.test.ts.
 *
 * Only recharts' chart ROOTS are stood in for: jsdom has no layout, so a
 * real pointer could never be resolved to a bucket. The stand-in records
 * the chart-level handlers, and the tests call them with the chart state
 * recharts would pass (activeTooltipIndex on the line, area and bar
 * charts; activeLabel, the bucket's label, on the volume histograms).
 * Everything above that - the chart wrappers, both selection hooks, the
 * page zoom, the picker and its Reset zoom, the hints - is the product.
 */

type ChartRootHandlers = {
  data?: Array<Record<string, unknown>>;
  onMouseDown?: (
    state: Record<string, unknown>,
    event?: Record<string, unknown>,
  ) => void;
  onMouseMove?: (
    state: Record<string, unknown>,
    event: Record<string, unknown>,
  ) => void;
  onMouseUp?: (state?: Record<string, unknown> | null) => void;
  onClick?: (state: Record<string, unknown>) => void;
  onDoubleClick?: () => void;
};

// Keyed by syncId, or "<kind>-unsynced" for a chart that has none.
const mockChartRoots: Map<string, ChartRootHandlers> = new Map();

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  const react: typeof React = jest.requireActual("react") as typeof React;

  const makeRoot: (
    kind: string,
  ) => (props: Record<string, unknown>) => ReactElement | null = (
    kind: string,
  ) => {
    return (props: Record<string, unknown>): ReactElement | null => {
      /*
       * React calls a component bare, with no props, to describe the
       * component stack for a dev warning. That is not a render.
       */
      if (!props) {
        return null;
      }
      const key: string =
        props["syncId"] !== undefined
          ? String(props["syncId"])
          : `${kind}-unsynced`;
      mockChartRoots.set(key, props as ChartRootHandlers);
      return react.createElement("div", {
        "data-testid": `chart-root-${key}`,
      });
    };
  };

  return {
    ...actual,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return props.children;
    },
    LineChart: makeRoot("line"),
    AreaChart: makeRoot("area"),
    BarChart: makeRoot("bar"),
  };
});

// Imported after the mock so the charts pick the stand-in up.
import LineChartElement from "../../../../../UI/Components/Charts/Line/LineChart";
import AreaChartElement from "../../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../../UI/Components/Charts/Bar/BarChart";
import ChartGroup, {
  Chart,
  ChartType,
} from "../../../../../UI/Components/Charts/ChartGroup/ChartGroup";
import { SparkAreaChart } from "../../../../../UI/Components/Charts/ChartLibrary/SparkChart/SparkChart";
import { CHART_DATA_POINT_DATE_KEY } from "../../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import ChartCurve from "../../../../../UI/Components/Charts/Types/ChartCurve";
import DataPoint from "../../../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "../../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import {
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomHint, {
  TIME_RANGE_ZOOM_HINT_GROUP_CLASS,
  TIME_RANGE_ZOOM_HINT_TEST_ID,
} from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TelemetryTimeRangePicker from "../../../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import LogsHistogram from "../../../../../UI/Components/LogsViewer/components/LogsHistogram";
import TelemetryHistogram from "../../../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import { HistogramBucket as LogsHistogramBucket } from "../../../../../UI/Components/LogsViewer/types";
import {
  HistogramBucket as TelemetryHistogramBucket,
  HistogramSeriesOption,
} from "../../../../../UI/Components/TelemetryViewer/types";
import LogSeverity from "../../../../../Types/Log/LogSeverity";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../../Types/Time/TimeRange";

const ZOOM_DOCS_PATH: string = path.resolve(
  __dirname,
  "../../../../../../App/FeatureSet/Docs/Content/en/telemetry/charts-and-time-ranges.md",
);

/*
 * The page as a reader takes it in: a phrase the markdown wraps over two
 * lines still reads as one.
 */
function docsProse(): string {
  return fs.readFileSync(ZOOM_DOCS_PATH, "utf8").replace(/\s+/g, " ");
}

// What the page quotes in bold, lower-cased: how it names words on screen.
function docsBoldPhrases(): Array<string> {
  return Array.from(
    docsProse().matchAll(/\*\*([^*]+)\*\*/g),
    (match: RegExpMatchArray): string => {
      return (match[1] || "").trim().toLowerCase();
    },
  );
}

function expectDocsToSay(sentence: string): void {
  expect(docsProse()).toContain(sentence);
}

function unique(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

const MINUTE_MS: number = 60 * 1000;

// Half a minute into a bucket: the newest bucket is still filling up.
const NOW: Date = new Date("2026-09-28T12:00:30.000Z");

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

const Y_AXIS: YAxis = {
  legend: "%",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: 100,
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return `${value}%`;
    },
  },
};

// One point on every minute of the window, the newest bucket included.
function seriesFor(window: InBetween<Date>, name: string): Array<SeriesPoint> {
  const points: Array<DataPoint> = [];
  for (
    let at: number =
      Math.ceil(window.startValue.getTime() / MINUTE_MS) * MINUTE_MS;
    at <= window.endValue.getTime();
    at += MINUTE_MS
  ) {
    points.push({ x: new Date(at), y: 40 + ((at / MINUTE_MS) % 20) });
  }
  return [{ seriesName: name, data: points }];
}

function xAxisFor(window: InBetween<Date>): ChartXAxis {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: window.startValue,
      max: window.endValue,
      aggregateType: XAxisAggregateType.Average,
      precision: XAxisPrecision.EVERY_MINUTE,
    },
  };
}

const rangeChanges: MockFunction = getJestMockFunction();
const fetchWindow: MockFunction = getJestMockFunction();
const bucketClick: MockFunction = getJestMockFunction();

interface ZoomablePageProps {
  initialRange?: RangeStartAndEndDateTime | undefined;
}

/*
 * A page shaped like the resource overviews: it owns its range, hands the
 * same setter to its picker and to its zoom, re-queries whenever the
 * resolved window moves, and draws a line, an area and a bar chart from
 * it, plus a chart-card hint. The tick button stands for an auto-refresh
 * tick: a render that resolves the range against the clock again.
 */
const ZoomablePage: FunctionComponent<ZoomablePageProps> = (
  props: ZoomablePageProps,
): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.initialRange || PAST_HOUR,
  );
  const [ticks, setTicks] = useState<number>(0);
  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

  React.useEffect(() => {
    fetchWindow(window.startValue.toISOString(), window.endValue.toISOString());
  }, [window.startValue.getTime(), window.endValue.getTime()]);

  const changeRange: (next: RangeStartAndEndDateTime) => void = (
    next: RangeStartAndEndDateTime,
  ): void => {
    rangeChanges(next);
    setTimeRange(next);
  };

  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={changeRange}>
      <TelemetryTimeRangePicker value={timeRange} onChange={changeRange} />
      <button
        type="button"
        data-testid="auto-refresh-tick"
        onClick={() => {
          setTicks(ticks + 1);
        }}
      >
        Tick
      </button>
      <span data-testid="window">
        {`${window.startValue.toISOString()}/${window.endValue.toISOString()}`}
      </span>
      <span data-testid="range-kind">{timeRange.range}</span>
      <div className={TIME_RANGE_ZOOM_HINT_GROUP_CLASS}>
        <TimeRangeZoomHint revealOnHover={true} />
        <LineChartElement
          data={seriesFor(window, "CPU")}
          xAxis={xAxisFor(window)}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          sync={true}
          syncid="cpu"
          heightInPx={180}
          onBucketClick={
            bucketClick as unknown as (
              bucketStart: Date,
              bucketEnd: Date,
              valuesAtBucket: Record<string, number | string>,
            ) => void
          }
        />
      </div>
      <AreaChartElement
        data={seriesFor(window, "Memory")}
        xAxis={xAxisFor(window)}
        yAxis={Y_AXIS}
        curve={ChartCurve.MONOTONE}
        sync={true}
        syncid="memory"
        heightInPx={180}
      />
      <BarChartElement
        data={seriesFor(window, "Requests")}
        xAxis={xAxisFor(window)}
        yAxis={Y_AXIS}
        sync={true}
        syncid="requests"
        heightInPx={180}
      />
    </TimeRangeZoomScope>
  );
};

const CHARTS: Array<string> = ["cpu", "memory", "requests"];

function root(key: string): ChartRootHandlers {
  const handlers: ChartRootHandlers | undefined = mockChartRoots.get(key);
  if (!handlers) {
    throw new Error(`chart ${key} has not rendered`);
  }
  return handlers;
}

// The row of a chart that draws the bucket starting at `iso`.
function rowAt(key: string, iso: string): number {
  const rows: Array<Record<string, unknown>> = root(key).data || [];
  const index: number = rows.findIndex(
    (row: Record<string, unknown>): boolean => {
      return row[CHART_DATA_POINT_DATE_KEY] === new Date(iso).getTime();
    },
  );
  if (index < 0) {
    throw new Error(`chart ${key} draws no bucket at ${iso}`);
  }
  return index;
}

// Press on one bucket, sweep to another, let go: a reader's drag.
function drag(key: string, fromIso: string, toIso: string): void {
  const from: number = rowAt(key, fromIso);
  const to: number = rowAt(key, toIso);
  act(() => {
    root(key).onMouseDown?.({ activeTooltipIndex: from });
  });
  act(() => {
    root(key).onMouseMove?.({ activeTooltipIndex: to }, { buttons: 1 });
  });
  act(() => {
    root(key).onMouseUp?.({ activeTooltipIndex: to });
  });
}

// A press and release on one bucket, then the click the browser sends.
function plainClick(key: string, iso: string): void {
  const at: number = rowAt(key, iso);
  act(() => {
    root(key).onMouseDown?.({ activeTooltipIndex: at });
  });
  act(() => {
    root(key).onMouseUp?.({ activeTooltipIndex: at });
  });
  act(() => {
    root(key).onClick?.({ activeTooltipIndex: at });
  });
}

function doubleClick(key: string): void {
  act(() => {
    root(key).onDoubleClick?.();
  });
}

function windowText(): string {
  return screen.getByTestId("window").textContent || "";
}

function windowOf(start: string, end: string): string {
  return `${new Date(start).toISOString()}/${new Date(end).toISOString()}`;
}

function pastHourAt(now: Date): string {
  return `${new Date(now.getTime() - 60 * MINUTE_MS).toISOString()}/${now.toISOString()}`;
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function hintText(): string {
  return screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID).textContent || "";
}

function advanceClock(ms: number): void {
  act(() => {
    jest.setSystemTime(new Date(Date.now() + ms));
  });
  fireEvent.click(screen.getByTestId("auto-refresh-tick"));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockChartRoots.clear();
  rangeChanges.mockReset();
  fetchWindow.mockReset();
  bucketClick.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the page's two gestures, on a page that zooms", () => {
  test("a drag moves the page's range exactly as picking that window in the picker would", () => {
    expectDocsToSay(
      "**Drag across the spike** on any chart. The page's time range moves to the window you dragged out, exactly as if you had picked it in the time-range picker. Every chart, and every tile or table worked out from the page's time range, re-queries for it, so you read one moment across all of them.",
    );

    render(<ZoomablePage />);
    fetchWindow.mockReset();

    drag("cpu", "2026-09-28T11:10:00.000Z", "2026-09-28T11:19:00.000Z");

    // The page's own setter got a custom range, as a custom pick hands it.
    expect(rangeChanges).toHaveBeenCalledTimes(1);
    const zoomed: RangeStartAndEndDateTime = rangeChanges.mock
      .calls[0]![0] as RangeStartAndEndDateTime;
    expect(zoomed.range).toBe(TimeRange.CUSTOM);
    expect(windowText()).toBe(
      windowOf("2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z"),
    );

    // Everything worked out from the range re-queried once, for that window.
    expect(fetchWindow).toHaveBeenCalledTimes(1);
    for (const chart of CHARTS) {
      expect(root(chart).data?.[0]?.[CHART_DATA_POINT_DATE_KEY]).toBe(
        new Date("2026-09-28T11:10:00.000Z").getTime(),
      );
    }

    // The picker reads exactly as it does when that window is picked in it.
    const pickerLabel: string =
      screen.getByTestId("telemetry-time-range-picker-button").textContent ||
      "";
    cleanup();
    render(<ZoomablePage initialRange={zoomed} />);
    expect(
      screen.getByTestId("telemetry-time-range-picker-button").textContent,
    ).toBe(pickerLabel);
  });

  test("a double-click on any chart returns the range from before the zoom", () => {
    expectDocsToSay(
      "**Double-click any chart** to go back. The page returns to the time range it had before you started zooming.",
    );

    for (const target of CHARTS) {
      cleanup();
      mockChartRoots.clear();
      render(<ZoomablePage />);

      drag("cpu", "2026-09-28T11:30:00.000Z", "2026-09-28T11:40:00.000Z");
      doubleClick(target);

      expect(windowText()).toBe(pastHourAt(NOW));
      expect(screen.getByTestId("range-kind")).toHaveTextContent(
        TimeRange.PAST_ONE_HOUR,
      );
    }
  });

  test("Reset zoom shows beside the picker only while zoomed, and does what a double-click does", () => {
    expectDocsToSay(
      "While a zoom is active, a **Reset zoom** button appears next to the page's time-range picker. It does the same thing as a double-click, and it is the way back for keyboard users and on touch screens.",
    );

    render(<ZoomablePage />);
    expect(resetButton()).toBeNull();

    drag("memory", "2026-09-28T11:05:00.000Z", "2026-09-28T11:15:00.000Z");

    const button: HTMLElement = screen.getByRole("button", {
      name: "Reset zoom",
    });
    expect(button).toBe(resetButton());
    // Beside the picker, in the picker's own row.
    expect(button.parentElement).toContainElement(
      screen.getByTestId("telemetry-time-range-picker-button"),
    );

    fireEvent.click(button);

    expect(windowText()).toBe(pastHourAt(NOW));
    expect(resetButton()).toBeNull();
  });
});

describe("How zooming behaves", () => {
  test("zoom as deep as you like; one reset climbs all the way out", () => {
    expectDocsToSay(
      '**Zoom as deep as you like; one reset climbs all the way out.** After drilling from "Past 1 Hour" into ten minutes and then into one, a single double-click (or **Reset zoom**) returns the whole hour rather than one level at a time.',
    );

    render(<ZoomablePage />);

    drag("cpu", "2026-09-28T11:30:00.000Z", "2026-09-28T11:39:00.000Z");
    drag("memory", "2026-09-28T11:34:00.000Z", "2026-09-28T11:34:00.000Z");
    // A press that never left its bucket is not a zoom: still ten minutes.
    expect(windowText()).toBe(
      windowOf("2026-09-28T11:30:00.000Z", "2026-09-28T11:40:00.000Z"),
    );
    drag("memory", "2026-09-28T11:34:00.000Z", "2026-09-28T11:35:00.000Z");
    expect(windowText()).toBe(
      windowOf("2026-09-28T11:34:00.000Z", "2026-09-28T11:36:00.000Z"),
    );

    doubleClick("requests");

    expect(windowText()).toBe(pastHourAt(NOW));
    expect(screen.getByTestId("range-kind")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(resetButton()).toBeNull();
  });

  test("any chart can reset any zoom: it is the page that is zoomed", () => {
    expectDocsToSay(
      "**Any chart can reset any zoom.** Drag on the CPU chart, double-click the memory chart — it is the page that is zoomed, not the chart.",
    );

    render(<ZoomablePage />);

    drag("cpu", "2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z");
    for (const chart of CHARTS) {
      expect(root(chart).onDoubleClick).toBeInstanceOf(Function);
    }

    doubleClick("memory");

    expect(windowText()).toBe(pastHourAt(NOW));
  });

  test("picking a range yourself starts over", () => {
    expectDocsToSay(
      "**Picking a range yourself starts over.** Choosing a preset or a custom range in the picker is a new starting point: the zoom is over and **Reset zoom** goes away.",
    );

    render(<ZoomablePage />);

    drag("cpu", "2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z");
    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(screen.getByText("Past 1 Day"));

    expect(resetButton()).toBeNull();
    for (const chart of CHARTS) {
      expect(root(chart).onDoubleClick).toBeUndefined();
    }
    expect(hintText()).toBe("Drag to zoom");

    // The next zoom goes back to the day, not to the hour it started from.
    drag("cpu", "2026-09-28T10:00:00.000Z", "2026-09-28T11:00:00.000Z");
    doubleClick("cpu");

    expect(screen.getByTestId("range-kind")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
  });

  test("a zoomed window is fixed: it stops rolling, and a reset rolls again", () => {
    expectDocsToSay(
      '**A zoomed window is fixed.** "Past 30 Minutes" rolls forward with the clock; a zoom is a fixed window, so it stops rolling while auto-refresh is on. Reset the zoom to start rolling again.',
    );

    render(<ZoomablePage />);

    // Before any zoom, a tick five minutes on moves the window along.
    advanceClock(5 * MINUTE_MS);
    expect(windowText()).toBe(
      pastHourAt(new Date(NOW.getTime() + 5 * MINUTE_MS)),
    );

    drag("cpu", "2026-09-28T11:20:00.000Z", "2026-09-28T11:29:00.000Z");
    const zoomedWindow: string = windowText();

    advanceClock(5 * MINUTE_MS);
    expect(windowText()).toBe(zoomedWindow);

    doubleClick("cpu");
    expect(windowText()).toBe(
      pastHourAt(new Date(NOW.getTime() + 10 * MINUTE_MS)),
    );
  });

  test("a zoom never runs past now: a drag onto the newest bucket is cut at the current time", () => {
    expectDocsToSay(
      "**A zoom never runs past now.** The newest bucket of a chart is usually still filling up; a drag that ends on it is cut at the current time.",
    );

    render(<ZoomablePage />);

    // The 12:00 bucket runs to 12:01, but it is only 12:00:30.
    drag("requests", "2026-09-28T11:55:00.000Z", "2026-09-28T12:00:00.000Z");

    expect(windowText()).toBe(
      windowOf("2026-09-28T11:55:00.000Z", NOW.toISOString()),
    );
  });

  test("you can let go of the mouse outside the chart: the drag still counts", () => {
    expectDocsToSay(
      "**You can let go of the mouse outside the chart** — the drag still counts.",
    );

    render(<ZoomablePage />);
    const from: number = rowAt("memory", "2026-09-28T11:40:00.000Z");
    const to: number = rowAt("memory", "2026-09-28T11:44:00.000Z");

    act(() => {
      root("memory").onMouseDown?.({ activeTooltipIndex: from });
    });
    act(() => {
      root("memory").onMouseMove?.({ activeTooltipIndex: to }, { buttons: 1 });
    });
    // Released past the chart's edge: only the window hears it.
    act(() => {
      fireEvent.mouseUp(window);
    });

    expect(windowText()).toBe(
      windowOf("2026-09-28T11:40:00.000Z", "2026-09-28T11:45:00.000Z"),
    );
  });

  test("double-clicking a page that isn't zoomed does nothing", () => {
    expectDocsToSay(
      "**Double-clicking a page that isn't zoomed does nothing.**",
    );

    render(<ZoomablePage />);

    // No chart even takes a double-click while there is nothing to undo.
    for (const chart of CHARTS) {
      expect(root(chart).onDoubleClick).toBeUndefined();
      fireEvent.doubleClick(screen.getByTestId(`chart-root-${chart}`));
    }

    // And once a zoom is undone, a second double-click finds nothing to do.
    drag("cpu", "2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z");
    doubleClick("cpu");
    rangeChanges.mockReset();
    for (const chart of CHARTS) {
      doubleClick(chart);
    }

    expect(rangeChanges).not.toHaveBeenCalled();
    expect(windowText()).toBe(pastHourAt(NOW));
  });
});

describe("Clicks and drags", () => {
  test("on line, area and bar charts, a plain click is not a zoom", () => {
    expectDocsToSay(
      "**On line, area and bar charts, a plain click is not a zoom.** That covers most charts: metric cards and the metric explorer, resource overviews, SLOs, monitors and every chart on a dashboard. Only a drag across buckets zooms, so clicking a point, a bar or a legend entry keeps doing what it did before.",
    );

    render(<ZoomablePage />);
    fetchWindow.mockReset();

    for (const chart of CHARTS) {
      plainClick(chart, "2026-09-28T11:30:00.000Z");
    }
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });

    expect(rangeChanges).not.toHaveBeenCalled();
    expect(fetchWindow).not.toHaveBeenCalled();
    expect(windowText()).toBe(pastHourAt(NOW));

    // The click kept its meaning: the line chart's bucket click, at once.
    expect(bucketClick).toHaveBeenCalledTimes(1);
    expect((bucketClick.mock.calls[0]![0] as Date).toISOString()).toBe(
      "2026-09-28T11:30:00.000Z",
    );
  });

  test("while a zoom is active, a click on the plot takes effect a moment later, so a double-click is not two clicks", () => {
    expectDocsToSay(
      "While a zoom is active, a click on a chart's plot takes effect a moment later, so that it can be told apart from the double-click that resets.",
    );

    render(<ZoomablePage />);
    drag("cpu", "2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z");
    /*
     * The drag's own trailing click is swallowed until the moment passes;
     * the reader's next click comes after it.
     */
    act(() => {
      jest.advanceTimersByTime(0);
    });

    plainClick("cpu", "2026-09-28T11:12:00.000Z");
    expect(bucketClick).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });
    expect(bucketClick).toHaveBeenCalledTimes(1);
    // Still zoomed: the click was a click.
    expect(windowText()).toBe(
      windowOf("2026-09-28T11:10:00.000Z", "2026-09-28T11:21:00.000Z"),
    );

    // Both clicks of a double-click are dropped; the reset is all it does.
    bucketClick.mockReset();
    plainClick("cpu", "2026-09-28T11:12:00.000Z");
    plainClick("cpu", "2026-09-28T11:12:00.000Z");
    doubleClick("cpu");
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
    });

    expect(bucketClick).not.toHaveBeenCalled();
    // Back on the rolling hour: the double-click reset the zoom.
    expect(screen.getByTestId("range-kind")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
    expect(resetButton()).toBeNull();
  });

  test("a small sparkline takes no part, even on a zoomed page", () => {
    expectDocsToSay(
      "the small trend sparklines in metric lists, where a click opens the metric",
    );
    expectDocsToSay(
      "small sparklines with a fixed window of their own, such as a network device's round-trip time over the past hour",
    );

    const zoomedPage: TimeRangeZoom = {
      isZoomed: true,
      rangeBeforeZoom: PAST_HOUR,
      zoomToTimeRange: getJestMockFunction() as unknown as (
        startTime: Date,
        endTime: Date,
      ) => void,
      resetZoom: getJestMockFunction() as unknown as () => void,
    };

    render(
      <TimeRangeZoomProvider zoom={zoomedPage}>
        <SparkAreaChart
          data={[
            { time: "11:00", value: 3 },
            { time: "11:01", value: 5 },
          ]}
          index="time"
          categories={["value"]}
        />
      </TimeRangeZoomProvider>,
    );

    const sparkline: ChartRootHandlers = root("area-unsynced");
    expect(sparkline.onMouseDown).toBeUndefined();
    expect(sparkline.onMouseUp).toBeUndefined();
    expect(sparkline.onDoubleClick).toBeUndefined();
  });
});

// Three ClickHouse-style bucket labels, one minute apart (UTC).
const BAR_A: string = "2026-09-28 11:15:00";
const BAR_B: string = "2026-09-28 11:16:00";
const BAR_C: string = "2026-09-28 11:17:00";

const LOG_BUCKETS: Array<LogsHistogramBucket> = [
  { time: BAR_A, severity: LogSeverity.Error, count: 3 },
  { time: BAR_B, severity: LogSeverity.Warning, count: 5 },
  { time: BAR_C, severity: LogSeverity.Error, count: 7 },
];

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#34d399" },
  { key: "error", label: "Error", color: "#f87171" },
];

const TELEMETRY_BUCKETS: Array<TelemetryHistogramBucket> = [
  { time: BAR_A, series: "ok", count: 3 },
  { time: BAR_B, series: "error", count: 5 },
  { time: BAR_C, series: "ok", count: 7 },
];

interface VolumeChartProps {
  onTimeRangeSelect: (startTime: Date, endTime: Date) => void;
  onZoomOut?: (() => void) | undefined;
  bucketIntervalMs?: number | undefined;
}

interface VolumeChart {
  name: string;
  render: (props: VolumeChartProps) => ReactElement;
}

// The explorers' two volume charts, which share the click-or-drag hook.
const VOLUME_CHARTS: Array<VolumeChart> = [
  {
    name: "the logs explorer's volume chart",
    render: (props: VolumeChartProps): ReactElement => {
      return (
        <LogsHistogram buckets={LOG_BUCKETS} isLoading={false} {...props} />
      );
    },
  },
  {
    name: "the trace, exception and security-event explorers' volume chart",
    render: (props: VolumeChartProps): ReactElement => {
      return (
        <TelemetryHistogram
          buckets={TELEMETRY_BUCKETS}
          series={SERIES}
          isLoading={false}
          {...props}
        />
      );
    },
  },
];

function pressBar(label: string): void {
  act(() => {
    root("bar-unsynced").onMouseDown?.({ activeLabel: label });
  });
}

function releaseBar(label: string): void {
  act(() => {
    root("bar-unsynced").onMouseUp?.({ activeLabel: label });
  });
}

function selectedWindow(select: MockFunction): string {
  expect(select).toHaveBeenCalledTimes(1);
  const [start, end] = select.mock.calls[0] as [Date, Date];
  return `${start.toISOString()}/${end.toISOString()}`;
}

describe("the explorers' volume charts: a click on one bar zooms into it", () => {
  for (const chart of VOLUME_CHARTS) {
    test(`${chart.name}: a click on one bar zooms into that bar, and the chart says so`, () => {
      expectDocsToSay(
        "**On the explorers' volume charts, a click on one bar zooms into that bar.** The volume charts of the log, trace, exception and security-event explorers, and the log and trace analytics charts, zoom into the bars you drag across, or into the single bar you click. These charts say **Click or drag to zoom**.",
      );

      const select: MockFunction = getJestMockFunction();
      render(
        chart.render({
          onTimeRangeSelect: select as unknown as (
            startTime: Date,
            endTime: Date,
          ) => void,
          bucketIntervalMs: MINUTE_MS,
        }),
      );

      expect(screen.getByText("Click or drag to zoom")).toBeVisible();

      pressBar(BAR_B);
      releaseBar(BAR_B);

      expect(selectedWindow(select)).toBe(
        windowOf("2026-09-28T11:16:00.000Z", "2026-09-28T11:17:00.000Z"),
      );
    });

    test(`${chart.name}: a drag zooms into the bars dragged across, the last one whole`, () => {
      const select: MockFunction = getJestMockFunction();
      render(
        chart.render({
          onTimeRangeSelect: select as unknown as (
            startTime: Date,
            endTime: Date,
          ) => void,
          bucketIntervalMs: MINUTE_MS,
        }),
      );

      pressBar(BAR_A);
      act(() => {
        root("bar-unsynced").onMouseMove?.({ activeLabel: BAR_C }, {});
      });
      // Let go outside the chart.
      act(() => {
        fireEvent.mouseUp(window);
      });

      expect(selectedWindow(select)).toBe(
        windowOf("2026-09-28T11:15:00.000Z", "2026-09-28T11:18:00.000Z"),
      );
    });

    test(`${chart.name}: while zoomed, the click waits out the double-click, which resets instead`, () => {
      const select: MockFunction = getJestMockFunction();
      const zoomOut: MockFunction = getJestMockFunction();
      render(
        chart.render({
          onTimeRangeSelect: select as unknown as (
            startTime: Date,
            endTime: Date,
          ) => void,
          onZoomOut: zoomOut as unknown as () => void,
          bucketIntervalMs: MINUTE_MS,
        }),
      );

      expect(screen.getByText("Double-click to reset")).toBeVisible();

      pressBar(BAR_C);
      releaseBar(BAR_C);
      expect(select).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
      });
      expect(selectedWindow(select)).toBe(
        windowOf("2026-09-28T11:17:00.000Z", "2026-09-28T11:18:00.000Z"),
      );

      select.mockReset();
      pressBar(BAR_A);
      releaseBar(BAR_A);
      fireEvent.doubleClick(screen.getByTestId("chart-root-bar-unsynced"));
      act(() => {
        jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
      });

      expect(select).not.toHaveBeenCalled();
      expect(zoomOut).toHaveBeenCalledTimes(1);
    });

    test(`${chart.name}: without the bucket width - how the drag-only charts use the hook - a click is not a zoom`, () => {
      expectDocsToSay(
        "The error-pattern timeline in Logs Insights and an exception's Occurrence Trend also zoom on a drag only.",
      );

      const select: MockFunction = getJestMockFunction();
      render(
        chart.render({
          onTimeRangeSelect: select as unknown as (
            startTime: Date,
            endTime: Date,
          ) => void,
        }),
      );

      expect(screen.getByText("Drag to zoom")).toBeVisible();
      expect(screen.queryByText("Click or drag to zoom")).toBeNull();

      pressBar(BAR_B);
      releaseBar(BAR_B);
      act(() => {
        jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
      });
      expect(select).not.toHaveBeenCalled();

      pressBar(BAR_A);
      releaseBar(BAR_C);
      expect(select).toHaveBeenCalledTimes(1);
    });
  }
});

function splitHint(text: string): Array<string> {
  return text
    .split("·")
    .map((part: string): string => {
      return part.trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    });
}

const NOT_ZOOMED: TimeRangeZoom = {
  isZoomed: false,
  rangeBeforeZoom: null,
  zoomToTimeRange: (): void => {},
  resetZoom: (): void => {},
};

const ZOOMED: TimeRangeZoom = {
  isZoomed: true,
  rangeBeforeZoom: PAST_HOUR,
  zoomToTimeRange: (): void => {},
  resetZoom: (): void => {},
};

function metricChart(): Chart {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date("2026-09-28T11:00:00.000Z"),
    new Date("2026-09-28T11:30:00.000Z"),
  );
  return {
    id: "cpu-chart",
    title: "CPU",
    type: ChartType.LINE,
    props: {
      data: seriesFor(window, "CPU"),
      xAxis: xAxisFor(window),
      yAxis: Y_AXIS,
      curve: ChartCurve.MONOTONE,
      sync: false,
    } as unknown as Chart["props"],
  };
}

// The header hint of a metric chart card (ChartGroup): the span naming the drag.
function metricChartHint(): HTMLElement {
  return screen.getByText((content: string, element: Element | null) => {
    return element?.tagName === "SPAN" && content.startsWith("Drag to zoom");
  });
}

describe("the hints the charts show", () => {
  test("every hint a chart renders is quoted on the page", () => {
    const shown: Array<string> = [];
    const collect: (text: string | null | undefined) => void = (
      text: string | null | undefined,
    ): void => {
      shown.push(...splitHint(text || ""));
    };

    // A chart card's hint, before and during a zoom.
    for (const zoom of [NOT_ZOOMED, ZOOMED]) {
      render(
        <TimeRangeZoomProvider zoom={zoom}>
          <TimeRangeZoomHint />
        </TimeRangeZoomProvider>,
      );
      collect(hintText());
      cleanup();
    }

    // A metric chart card's header hint, before and during a zoom.
    for (const zoom of [NOT_ZOOMED, ZOOMED]) {
      render(
        <TimeRangeZoomProvider zoom={zoom}>
          <ChartGroup charts={[metricChart()]} />
        </TimeRangeZoomProvider>,
      );
      collect(metricChartHint().textContent);
      cleanup();
    }

    // The volume charts, with and without the width, before and during a zoom.
    for (const chart of VOLUME_CHARTS) {
      for (const bucketIntervalMs of [MINUTE_MS, undefined]) {
        const { container } = render(
          chart.render({
            onTimeRangeSelect: (): void => {},
            onZoomOut: (): void => {},
            bucketIntervalMs: bucketIntervalMs,
          }),
        );
        container
          .querySelectorAll("span.text-\\[10px\\]")
          .forEach((span: Element) => {
            collect(span.textContent);
          });
        cleanup();
      }
    }

    expect(unique(shown).sort()).toEqual(
      [
        "Click or drag to zoom",
        "Double-click to reset",
        "Drag to zoom",
        "double-click to reset",
      ].sort(),
    );

    const quoted: Array<string> = docsBoldPhrases();
    for (const hint of unique(shown)) {
      expect({ hint, quoted: quoted.includes(hint.toLowerCase()) }).toEqual({
        hint,
        quoted: true,
      });
    }
  });

  test("the metric charts and the volume charts always show theirs; a chart card's waits to be pointed at", () => {
    expectDocsToSay(
      "Metric cards, the metric explorer and the explorers' volume charts always show the hint. On the chart cards of resource overviews and SLOs, and on some dashboard widgets, it appears only while you point at the card or tab into it.",
    );

    render(
      <TimeRangeZoomProvider zoom={NOT_ZOOMED}>
        <ChartGroup charts={[metricChart()]} />
      </TimeRangeZoomProvider>,
    );
    expect(metricChartHint()).not.toHaveClass("opacity-0");
    cleanup();

    render(
      <LogsHistogram
        buckets={LOG_BUCKETS}
        isLoading={false}
        onTimeRangeSelect={(): void => {}}
        bucketIntervalMs={MINUTE_MS}
      />,
    );
    expect(screen.getByText("Click or drag to zoom")).not.toHaveClass(
      "opacity-0",
    );
    cleanup();

    render(<ZoomablePage />);
    const cardHint: HTMLElement = screen.getByTestId(
      TIME_RANGE_ZOOM_HINT_TEST_ID,
    );
    expect(cardHint).toHaveClass("opacity-0");
    expect(cardHint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(cardHint).toHaveClass(
      "group-has-[:focus-visible]/zoomhint:opacity-100",
    );
  });

  test("a chart card's hint names the double-click once there is a zoom to undo", () => {
    expectDocsToSay(
      "Most charts that zoom name the gesture above the plot — **Drag to zoom**, or **Click or drag to zoom** — and, while a zoom is active, remind you to **double-click to reset**.",
    );

    render(<ZoomablePage />);
    expect(hintText()).toBe("Drag to zoom");

    drag("cpu", "2026-09-28T11:10:00.000Z", "2026-09-28T11:20:00.000Z");
    expect(hintText()).toBe("Double-click to reset");

    doubleClick("cpu");
    expect(hintText()).toBe("Drag to zoom");
  });
});
