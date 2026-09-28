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
import getJestMockFunction, { MockFunction } from "../../../../MockType";

/*
 * Issue #4105, end to end through the real chart stack: a page wraps itself
 * in TimeRangeZoomScope, renders line, area and bar charts through the
 * ordinary wrappers WITHOUT passing any zoom handler, and
 *
 *   - a drag on any one of them retimes the page, so every chart (and
 *     anything else keyed on the range) moves to the window dragged out;
 *   - a double-click on any of them puts the page back where it was;
 *   - the page's time picker offers "Reset zoom" while zoomed.
 *
 * Only recharts' chart ROOTS are stood in for. jsdom has no layout, so a
 * real pointer could never be resolved to a bucket; the stand-in records
 * the chart-level handlers the chart library attaches, and the tests call
 * them with the chart state recharts would pass (activeTooltipIndex = the
 * bucket under the pointer). Everything above that - the wrappers, the
 * chart library's selection logic, the page zoom and its context - is the
 * production code.
 */

type ChartRootHandlers = {
  data?: Array<Record<string, unknown>>;
  onMouseDown?: (state: Record<string, unknown>) => void;
  onMouseMove?: (
    state: Record<string, unknown>,
    event: Record<string, unknown>,
  ) => void;
  onMouseUp?: (state?: Record<string, unknown> | null) => void;
  onClick?: (state: Record<string, unknown>) => void;
  onDoubleClick?: () => void;
};

const mockChartRoots: Map<string, ChartRootHandlers> = new Map();

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual(
    "recharts",
  ) as Record<string, any>;
  const react: typeof React = jest.requireActual("react") as typeof React;

  const makeRoot: (kind: string) => (props: Record<string, any>) => any = (
    kind: string,
  ) => {
    return (props: Record<string, any>) => {
      mockChartRoots.set(String(props["syncId"]), props as ChartRootHandlers);
      return react.createElement("div", {
        "data-testid": `chart-root-${String(props["syncId"])}`,
        "data-kind": kind,
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

import LineChartElement from "../../../../../UI/Components/Charts/Line/LineChart";
import AreaChartElement from "../../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../../UI/Components/Charts/Bar/BarChart";
import ChartCurve from "../../../../../UI/Components/Charts/Types/ChartCurve";
import DataPoint from "../../../../../UI/Components/Charts/Types/DataPoint";
import SeriesPoint from "../../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import XAxisPrecision from "../../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import YAxis, {
  YAxisPrecision,
} from "../../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import { CHART_DATA_POINT_DATE_KEY } from "../../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import { TimeRangeZoomScope } from "../../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TelemetryTimeRangePicker from "../../../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

const PAGE_START: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T10:00:00.000Z"),
    new Date("2026-09-28T10:30:00.000Z"),
  ),
};

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

// One point a minute across the window, like a golden-metrics query.
function seriesFor(window: InBetween<Date>, name: string): Array<SeriesPoint> {
  const points: Array<DataPoint> = [];
  for (
    let at: number = window.startValue.getTime();
    at < window.endValue.getTime();
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

const fetchWindow: MockFunction = getJestMockFunction();
const explicitSelect: MockFunction = getJestMockFunction();

/*
 * A page shaped like the resource overviews: it owns its range, re-queries
 * whenever it changes, and renders its charts from the result.
 */
const OverviewPage: FunctionComponent<{
  withExplicitChart?: boolean;
  withOptedOutChart?: boolean;
}> = (props: {
  withExplicitChart?: boolean;
  withOptedOutChart?: boolean;
}): ReactElement => {
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(PAGE_START);
  const window: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

  React.useEffect(() => {
    fetchWindow(window.startValue.toISOString(), window.endValue.toISOString());
  }, [window.startValue.getTime(), window.endValue.getTime()]);

  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <TelemetryTimeRangePicker value={timeRange} onChange={setTimeRange} />
      <span data-testid="window">
        {`${window.startValue.toISOString()}/${window.endValue.toISOString()}`}
      </span>
      <LineChartElement
        data={seriesFor(window, "CPU")}
        xAxis={xAxisFor(window)}
        yAxis={Y_AXIS}
        curve={ChartCurve.MONOTONE}
        sync={true}
        syncid="cpu"
        heightInPx={180}
      />
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
      {props.withExplicitChart ? (
        <LineChartElement
          data={seriesFor(window, "Explicit")}
          xAxis={xAxisFor(window)}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          sync={true}
          syncid="explicit"
          onTimeRangeSelect={
            explicitSelect as unknown as (
              startTime: Date,
              endTime: Date,
            ) => void
          }
        />
      ) : null}
      {props.withOptedOutChart ? (
        <LineChartElement
          data={seriesFor(window, "Opted out")}
          xAxis={xAxisFor(window)}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          sync={true}
          syncid="opted-out"
          disableTimeRangeZoom={true}
        />
      ) : null}
    </TimeRangeZoomScope>
  );
};

function root(syncId: string): ChartRootHandlers {
  const handlers: ChartRootHandlers | undefined = mockChartRoots.get(syncId);
  if (!handlers) {
    throw new Error(`chart ${syncId} has not rendered`);
  }
  return handlers;
}

function bucketStart(syncId: string, rowIndex: number): number {
  const row: Record<string, unknown> | undefined =
    root(syncId).data?.[rowIndex];
  const at: unknown = row?.[CHART_DATA_POINT_DATE_KEY];
  if (typeof at !== "number") {
    throw new Error(`chart ${syncId} has no bucket ${rowIndex}`);
  }
  return at;
}

// Press on one bucket, sweep to another, let go: what a reader's drag does.
function drag(syncId: string, fromIndex: number, toIndex: number): void {
  act(() => {
    root(syncId).onMouseDown?.({ activeTooltipIndex: fromIndex });
  });
  act(() => {
    root(syncId).onMouseMove?.({ activeTooltipIndex: toIndex }, { buttons: 1 });
  });
  act(() => {
    root(syncId).onMouseUp?.({ activeTooltipIndex: toIndex });
  });
}

function doubleClick(syncId: string): void {
  act(() => {
    root(syncId).onDoubleClick?.();
  });
}

function windowText(): string {
  return screen.getByTestId("window").textContent || "";
}

const ORIGINAL_WINDOW: string =
  "2026-09-28T10:00:00.000Z/2026-09-28T10:30:00.000Z";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockChartRoots.clear();
  fetchWindow.mockReset();
  explicitSelect.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("page-wide drag-to-zoom through the real chart stack", () => {
  test("every time-series chart on the page can start a zoom, none offers a reset yet", () => {
    render(<OverviewPage />);

    for (const chart of ["cpu", "memory", "requests"]) {
      expect(root(chart).onMouseDown).toBeInstanceOf(Function);
      expect(root(chart).onMouseMove).toBeInstanceOf(Function);
      expect(root(chart).onMouseUp).toBeInstanceOf(Function);
      expect(root(chart).onDoubleClick).toBeUndefined();
    }

    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("dragging across the CPU line chart retimes the whole page to that window", () => {
    render(<OverviewPage />);
    const from: number = bucketStart("cpu", 5);
    const lastBucket: number = bucketStart("cpu", 9);
    const bucketWidth: number = bucketStart("cpu", 9) - bucketStart("cpu", 8);

    fetchWindow.mockReset();
    drag("cpu", 5, 9);

    const expectedStart: string = new Date(from).toISOString();
    const expectedEnd: string = new Date(
      lastBucket + bucketWidth,
    ).toISOString();
    expect(windowText()).toBe(`${expectedStart}/${expectedEnd}`);
    expect(expectedStart).toBe("2026-09-28T10:05:00.000Z");
    expect(expectedEnd).toBe("2026-09-28T10:10:00.000Z");

    // The page re-queried the new window once, for every chart at once.
    expect(fetchWindow).toHaveBeenCalledTimes(1);
    expect(fetchWindow).toHaveBeenCalledWith(expectedStart, expectedEnd);

    // And every chart now plots only that window.
    for (const chart of ["cpu", "memory", "requests"]) {
      expect(bucketStart(chart, 0)).toBe(from);
    }
  });

  test("a right-to-left drag selects the same window", () => {
    render(<OverviewPage />);

    drag("memory", 9, 5);

    expect(windowText()).toBe(
      "2026-09-28T10:05:00.000Z/2026-09-28T10:10:00.000Z",
    );
  });

  test("the bar chart starts a page zoom too", () => {
    render(<OverviewPage />);

    drag("requests", 20, 24);

    expect(windowText()).toBe(
      "2026-09-28T10:20:00.000Z/2026-09-28T10:25:00.000Z",
    );
  });

  test("a bar drag released without a last move still covers the bar under the pointer", () => {
    render(<OverviewPage />);

    act(() => {
      root("requests").onMouseDown?.({ activeTooltipIndex: 2 });
    });
    act(() => {
      root("requests").onMouseUp?.({ activeTooltipIndex: 4 });
    });

    expect(windowText()).toBe(
      "2026-09-28T10:02:00.000Z/2026-09-28T10:05:00.000Z",
    );
  });

  test("a click that never leaves its bucket does not zoom", () => {
    render(<OverviewPage />);
    fetchWindow.mockReset();

    for (const chart of ["cpu", "memory", "requests"]) {
      drag(chart, 7, 7);
    }

    expect(windowText()).toBe(ORIGINAL_WINDOW);
    expect(fetchWindow).not.toHaveBeenCalled();
  });

  test("once zoomed, every chart offers the double-click reset and the picker offers Reset zoom", () => {
    render(<OverviewPage />);

    drag("cpu", 5, 9);

    for (const chart of ["cpu", "memory", "requests"]) {
      expect(root(chart).onDoubleClick).toBeInstanceOf(Function);
    }
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("double-clicking a DIFFERENT chart than the one dragged resets the page", () => {
    render(<OverviewPage />);

    drag("cpu", 5, 9);
    fetchWindow.mockReset();
    doubleClick("requests");

    expect(windowText()).toBe(ORIGINAL_WINDOW);
    expect(fetchWindow).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    for (const chart of ["cpu", "memory", "requests"]) {
      expect(root(chart).onDoubleClick).toBeUndefined();
    }
  });

  test("zooming twice and double-clicking once goes all the way back", () => {
    render(<OverviewPage />);

    drag("cpu", 5, 20);
    drag("memory", 2, 6);
    expect(windowText()).not.toBe(ORIGINAL_WINDOW);

    doubleClick("memory");

    expect(windowText()).toBe(ORIGINAL_WINDOW);
  });

  test("the picker's Reset zoom does what a double-click does", () => {
    render(<OverviewPage />);

    drag("memory", 3, 8);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    expect(windowText()).toBe(ORIGINAL_WINDOW);
  });

  test("a chart with its own zoom handler keeps it; the page is not retimed by it", () => {
    render(<OverviewPage withExplicitChart={true} />);

    drag("explicit", 1, 3);

    expect(explicitSelect).toHaveBeenCalledTimes(1);
    expect(windowText()).toBe(ORIGINAL_WINDOW);

    // And it does not take the page's reset either.
    drag("cpu", 5, 9);
    expect(root("explicit").onDoubleClick).toBeUndefined();
  });

  test("a chart that opted out neither zooms nor resets the page", () => {
    render(<OverviewPage withOptedOutChart={true} />);

    expect(root("opted-out").onMouseDown).toBeUndefined();

    drag("cpu", 5, 9);
    expect(root("opted-out").onDoubleClick).toBeUndefined();
  });

  test("a chart rendered outside any zoomable page is untouched", () => {
    const window: InBetween<Date> = new InBetween<Date>(
      new Date("2026-09-28T10:00:00.000Z"),
      new Date("2026-09-28T10:30:00.000Z"),
    );
    render(
      <LineChartElement
        data={seriesFor(window, "Standalone")}
        xAxis={xAxisFor(window)}
        yAxis={Y_AXIS}
        curve={ChartCurve.MONOTONE}
        sync={true}
        syncid="standalone"
      />,
    );

    expect(root("standalone").onMouseDown).toBeUndefined();
    expect(root("standalone").onDoubleClick).toBeUndefined();
  });

  test("the drag affordance (crosshair) shows on every zoomable chart", () => {
    render(<OverviewPage withOptedOutChart={true} />);

    for (const chart of ["cpu", "memory", "requests"]) {
      expect(
        screen.getByTestId(`chart-root-${chart}`).closest(".cursor-crosshair"),
      ).not.toBeNull();
    }
    expect(
      screen.getByTestId("chart-root-opted-out").closest(".cursor-crosshair"),
    ).toBeNull();
  });

  test("picking a range in the picker after a zoom starts over: no reset is offered", () => {
    render(<OverviewPage />);

    drag("cpu", 5, 9);
    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(screen.getByText("Past 1 Hour"));

    expect(windowText()).toBe(
      `${new Date(NOW.getTime() - 60 * MINUTE_MS).toISOString()}/${NOW.toISOString()}`,
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(root("cpu").onDoubleClick).toBeUndefined();
  });
});
