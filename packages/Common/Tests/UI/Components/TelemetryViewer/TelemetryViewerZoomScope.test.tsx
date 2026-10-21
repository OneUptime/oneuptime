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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4105 on the telemetry shell behind the traces, exceptions and
 * security events explorers. The shell offers its zoom to everything it
 * renders: the volume histogram, the analytics view a host renders in its
 * place (mainContentOverride), and the picker's "Reset zoom" - the only way
 * back for keyboard users. A zoom made anywhere is undone from anywhere.
 *
 * Recharts is stood in for; see LogsHistogramDragTooltip.test.tsx for why.
 */
jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: StubChartProps) => {
      return react.createElement(
        "div",
        { "data-testid": "volume-chart" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    },
    Bar: () => {
      return null;
    },
    XAxis: () => {
      return null;
    },
    YAxis: () => {
      return null;
    },
    Tooltip: () => {
      return null;
    },
    ReferenceArea: () => {
      return null;
    },
  };
});

// Imported after the mock so the chart picks the stand-in up.
import TelemetryViewer from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomProvider,
  useChartTimeRangeZoom,
} from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../../UI/Components/Date/TimeRangePickerDropdown";
import {
  HistogramBucket,
  HistogramSeriesOption,
} from "../../../../UI/Components/TelemetryViewer/types";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";

interface Item {
  id: string;
}

const NOW: Date = new Date("2026-09-17T11:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

const BAR_A: string = "2026-09-17 10:15:00";
const BAR_B: string = "2026-09-17 10:16:00";
const BAR_C: string = "2026-09-17 10:17:00";

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#34d399" },
];

const BUCKETS: Array<HistogramBucket> = [BAR_A, BAR_B, BAR_C].map(
  (time: string): HistogramBucket => {
    return { time, series: "ok", count: 3 };
  },
);

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

const PAST_HOUR: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

/*
 * A stand-in for an analytics chart a host renders in the histogram's place
 * (TracesAnalyticsView): it zooms whatever it finds in context.
 */
const StandInAnalyticsChart: FunctionComponent = (): ReactElement => {
  const zoom: ChartTimeRangeZoomContextValue | null = useChartTimeRangeZoom();

  return (
    <div data-testid="analytics-chart">
      <span data-testid="analytics-has-zoom">{String(Boolean(zoom))}</span>
      <span data-testid="analytics-is-zoomed">
        {String(Boolean(zoom?.isZoomed))}
      </span>
      <button
        type="button"
        onClick={() => {
          zoom?.onTimeRangeSelect(
            new Date("2026-09-17T10:30:00.000Z"),
            new Date("2026-09-17T10:40:00.000Z"),
          );
        }}
      >
        Drag on analytics
      </button>
      <button
        type="button"
        onClick={() => {
          zoom?.onTimeRangeReset?.();
        }}
      >
        Double-click analytics
      </button>
    </div>
  );
};

const hostSelectSpy: MockFunction = getJestMockFunction();
const hostChangeSpy: MockFunction = getJestMockFunction();

function describeWindow(range: RangeStartAndEndDateTime): string {
  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }
  return `${range.startAndEndDate!.startValue.toISOString()}..${range.startAndEndDate!.endValue.toISOString()}`;
}

interface HostProps {
  analytics?: boolean;
  noHistogramSelect?: boolean;
}

// Owns the window the way TracesViewer, ExceptionsViewer and SecurityEventsViewer do.
const Host: FunctionComponent<HostProps> = (props: HostProps): ReactElement => {
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(PAST_HOUR);

  return (
    <div>
      <span data-testid="host-window">{describeWindow(timeRange)}</span>
      <button
        type="button"
        onClick={() => {
          setTimeRange({ range: TimeRange.PAST_ONE_DAY });
        }}
      >
        Restore saved view
      </button>
      <TelemetryViewer<Item>
        items={[]}
        isLoading={false}
        renderRow={(item: Item): ReactElement => {
          return <span>{item.id}</span>;
        }}
        getRowKey={(item: Item): string => {
          return item.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={timeRange}
        onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
          hostChangeSpy(next);
          setTimeRange(next);
        }}
        page={1}
        pageSize={50}
        totalCount={0}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        showHistogram={true}
        histogramBuckets={BUCKETS}
        histogramSeries={SERIES}
        histogramBucketIntervalMs={MINUTE_MS}
        onHistogramTimeRangeSelect={
          props.noHistogramSelect
            ? undefined
            : (startTime: Date, endTime: Date): void => {
                hostSelectSpy(startTime, endTime);
                setTimeRange({
                  range: TimeRange.CUSTOM,
                  startAndEndDate: new InBetween<Date>(startTime, endTime),
                });
              }
        }
        mainContentOverride={
          props.analytics ? <StandInAnalyticsChart /> : undefined
        }
      />
    </div>
  );
};

function pickerLabel(): string {
  return (
    screen.getByTestId("telemetry-time-range-picker-button").textContent || ""
  ).trim();
}

function dragHistogram(): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${BAR_A}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${BAR_B}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${BAR_B}`));
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  hostSelectSpy.mockReset();
  hostChangeSpy.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the picker's Reset zoom follows the viewer's own zoom", () => {
  test("it appears once the histogram has zoomed the viewer, beside a Custom picker", () => {
    render(<Host />);

    expect(resetButton()).toBeNull();
    expect(pickerLabel()).toBe("Past 1 Hour");

    dragHistogram();

    expect(screen.getByTestId("host-window")).toHaveTextContent(
      "2026-09-17T10:15:00.000Z..2026-09-17T10:17:00.000Z",
    );
    expect(pickerLabel()).toBe(
      getTimeRangeButtonLabel(
        custom("2026-09-17T10:15:00.000Z", "2026-09-17T10:17:00.000Z"),
      ),
    );
    expect(resetButton()).toBeInTheDocument();
    expect(resetButton()).toHaveAttribute(
      "title",
      "Go back to Past 1 Hour, the time range before the zoom",
    );
  });

  test("it puts the window back and goes away", () => {
    render(<Host />);

    dragHistogram();
    fireEvent.click(resetButton()!);

    expect(hostChangeSpy).toHaveBeenCalledWith(PAST_HOUR);
    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(resetButton()).toBeNull();
  });

  test("a double-click on the histogram does the same", () => {
    render(<Host />);

    dragHistogram();
    fireEvent.doubleClick(
      screen.getByTestId("volume-chart").parentElement!.parentElement!,
    );

    expect(hostChangeSpy).toHaveBeenCalledWith(PAST_HOUR);
    expect(resetButton()).toBeNull();
  });

  test("a saved view restored behind the viewer's back ends the zoom", () => {
    render(<Host />);

    dragHistogram();
    fireEvent.click(screen.getByText("Restore saved view"));

    expect(resetButton()).toBeNull();
    expect(screen.queryByText("Double-click to reset")).toBeNull();
  });

  test("a range picked from the picker ends the zoom", () => {
    render(<Host />);

    dragHistogram();
    fireEvent.click(screen.getByTestId("telemetry-time-range-picker-button"));
    fireEvent.click(
      within(
        screen.getByTestId("telemetry-time-range-picker-dropdown"),
      ).getByText("Past 1 Day"),
    );

    expect(hostChangeSpy).toHaveBeenCalledWith({
      range: TimeRange.PAST_ONE_DAY,
    });
    expect(resetButton()).toBeNull();
  });
});

describe("content a host renders in the histogram's place shares the zoom", () => {
  test("it is handed the viewer's zoom", () => {
    render(<Host analytics={true} />);

    // Analytics mode: the histogram is not rendered, the stand-in is.
    expect(screen.queryByTestId("volume-chart")).toBeNull();
    expect(screen.getByTestId("analytics-has-zoom")).toHaveTextContent("true");
    expect(screen.getByTestId("analytics-is-zoomed")).toHaveTextContent(
      "false",
    );
  });

  test("its drag retimes the viewer through the host's zoom handler", () => {
    render(<Host analytics={true} />);

    fireEvent.click(screen.getByText("Drag on analytics"));

    expect(hostSelectSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("host-window")).toHaveTextContent(
      "2026-09-17T10:30:00.000Z..2026-09-17T10:40:00.000Z",
    );
    expect(screen.getByTestId("analytics-is-zoomed")).toHaveTextContent("true");
    expect(resetButton()).toBeInTheDocument();
  });

  test("its double-click, and the picker's Reset zoom, put the window back", () => {
    render(<Host analytics={true} />);

    fireEvent.click(screen.getByText("Drag on analytics"));
    fireEvent.click(screen.getByText("Double-click analytics"));

    expect(hostChangeSpy).toHaveBeenCalledWith(PAST_HOUR);
    expect(screen.getByTestId("analytics-is-zoomed")).toHaveTextContent(
      "false",
    );

    fireEvent.click(screen.getByText("Drag on analytics"));
    fireEvent.click(resetButton()!);

    expect(hostChangeSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("host-window")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
  });
});

describe("the viewer's zoom and a page's zoom around it", () => {
  function pageZoom(): {
    zoom: TimeRangeZoom;
    select: MockFunction;
    reset: MockFunction;
  } {
    const select: MockFunction = getJestMockFunction();
    const reset: MockFunction = getJestMockFunction();
    return {
      select,
      reset,
      zoom: {
        isZoomed: true,
        rangeBeforeZoom: { range: TimeRange.PAST_ONE_WEEK },
        zoomToTimeRange: (startTime: Date, endTime: Date): void => {
          select(startTime, endTime);
        },
        resetZoom: (): void => {
          reset();
        },
      },
    };
  }

  test("the viewer shadows it: a drag in the viewer never retimes the page", () => {
    const page: ReturnType<typeof pageZoom> = pageZoom();

    render(
      <TimeRangeZoomProvider zoom={page.zoom}>
        <Host analytics={true} />
      </TimeRangeZoomProvider>,
    );

    // The page is zoomed, the viewer is not: no Reset zoom for the page here.
    expect(resetButton()).toBeNull();
    expect(screen.getByTestId("analytics-is-zoomed")).toHaveTextContent(
      "false",
    );

    fireEvent.click(screen.getByText("Drag on analytics"));
    fireEvent.click(screen.getByText("Double-click analytics"));

    expect(page.select).not.toHaveBeenCalled();
    expect(page.reset).not.toHaveBeenCalled();
    expect(hostSelectSpy).toHaveBeenCalledTimes(1);
    expect(hostChangeSpy).toHaveBeenCalledWith(PAST_HOUR);
  });

  test("a host that cannot zoom leaves the page's zoom in place, as before", () => {
    const page: ReturnType<typeof pageZoom> = pageZoom();

    render(
      <TimeRangeZoomProvider zoom={page.zoom}>
        <Host analytics={true} noHistogramSelect={true} />
      </TimeRangeZoomProvider>,
    );

    expect(screen.getByTestId("analytics-is-zoomed")).toHaveTextContent("true");
    expect(resetButton()).toBeInTheDocument();

    fireEvent.click(resetButton()!);
    expect(page.reset).toHaveBeenCalledTimes(1);
  });

  test("a host that cannot zoom, with no page around it, offers no zoom at all", () => {
    render(<Host analytics={true} noHistogramSelect={true} />);

    expect(screen.getByTestId("analytics-has-zoom")).toHaveTextContent("false");
    expect(resetButton()).toBeNull();
  });
});
