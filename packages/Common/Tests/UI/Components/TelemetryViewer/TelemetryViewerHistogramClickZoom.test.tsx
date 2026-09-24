/** @timezone UTC */

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";
import {
  HistogramBucket,
  HistogramSeriesOption,
} from "../../../../UI/Components/TelemetryViewer/types";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The traces, exceptions and security events explorers all draw their
 * volume chart through this shell, so this is where the bucket width a host
 * knows has to reach the chart (issue #3914: without it a click on one bar
 * opened a window zero seconds wide), and where the zoom it produces is kept
 * inside the window it zooms out of. The chart's own click / drag rules are
 * in HistogramClickToZoom.test.tsx.
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
        { "data-testid": "bar-chart" },
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

interface Item {
  id: string;
}

const MINUTE_MS: number = 60 * 1000;

const BAR_A: string = "2026-09-17 10:15:00";
const BAR_B: string = "2026-09-17 10:16:00";
const BAR_C: string = "2026-09-17 10:17:00";

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#34d399" },
  { key: "error", label: "Error", color: "#f87171" },
];

const BUCKETS: Array<HistogramBucket> = [
  { time: BAR_A, series: "ok", count: 3 },
  { time: BAR_B, series: "error", count: 5 },
  { time: BAR_C, series: "ok", count: 7 },
];

// A fixed window whose end falls part-way through the newest bar.
const ORIGINAL_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-17T09:17:30.000Z"),
    new Date("2026-09-17T10:17:30.000Z"),
  ),
};

interface RenderedViewer {
  onHistogramTimeRangeSelect: MockFunction;
  onTimeRangeChange: MockFunction;
}

function renderViewer(
  options: { histogramBucketIntervalMs?: number | undefined } = {},
): RenderedViewer {
  const onHistogramTimeRangeSelect: MockFunction = getJestMockFunction();
  const onTimeRangeChange: MockFunction = getJestMockFunction();

  render(
    <TelemetryViewer<Item>
      items={[]}
      isLoading={false}
      renderRow={(item: Item): React.ReactElement => {
        return <span>{item.id}</span>;
      }}
      getRowKey={(item: Item): string => {
        return item.id;
      }}
      searchValue=""
      onSearchChange={(): void => {}}
      onSearchSubmit={(): void => {}}
      timeRange={ORIGINAL_WINDOW}
      onTimeRangeChange={onTimeRangeChange}
      page={1}
      pageSize={50}
      totalCount={0}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      showHistogram={true}
      histogramBuckets={BUCKETS}
      histogramSeries={SERIES}
      histogramBucketIntervalMs={
        "histogramBucketIntervalMs" in options
          ? options.histogramBucketIntervalMs
          : MINUTE_MS
      }
      onHistogramTimeRangeSelect={onHistogramTimeRangeSelect}
    />,
  );

  return {
    onHistogramTimeRangeSelect: onHistogramTimeRangeSelect,
    onTimeRangeChange: onTimeRangeChange,
  };
}

function click(label: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${label}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${label}`));
}

function selectedWindows(mock: MockFunction): Array<[string, string]> {
  return mock.mock.calls.map((call: Array<unknown>): [string, string] => {
    return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
  });
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("TelemetryViewer hands the chart the width of its bars", () => {
  test("a click on one bar reaches the host as that bar's whole bucket", () => {
    const { onHistogramTimeRangeSelect } = renderViewer();

    click(BAR_B);

    expect(selectedWindows(onHistogramTimeRangeSelect)).toEqual([
      ["2026-09-17T10:16:00.000Z", "2026-09-17T10:17:00.000Z"],
    ]);
  });

  test("a drag reaches the host through the end of the last bar", () => {
    const { onHistogramTimeRangeSelect } = renderViewer();

    fireEvent.mouseDown(screen.getByTestId(`bucket-${BAR_A}`));
    fireEvent.mouseMove(screen.getByTestId(`bucket-${BAR_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bucket-${BAR_B}`));

    expect(selectedWindows(onHistogramTimeRangeSelect)).toEqual([
      ["2026-09-17T10:15:00.000Z", "2026-09-17T10:17:00.000Z"],
    ]);
  });

  test("the newest bar is cut at the end of the window it zooms out of", () => {
    const { onHistogramTimeRangeSelect } = renderViewer();

    click(BAR_C);

    expect(selectedWindows(onHistogramTimeRangeSelect)).toEqual([
      ["2026-09-17T10:17:00.000Z", "2026-09-17T10:17:30.000Z"],
    ]);
  });

  test("says a click works", () => {
    renderViewer();

    expect(screen.getByText("Click or drag to zoom")).toBeInTheDocument();
  });

  test("a host that does not know the width gets no click-to-zoom", () => {
    const { onHistogramTimeRangeSelect } = renderViewer({
      histogramBucketIntervalMs: undefined,
    });

    click(BAR_B);

    expect(onHistogramTimeRangeSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
  });

  /*
   * After a click has zoomed in, the chart offers "double-click to zoom
   * out". That double-click arrives as two more clicks first; they must not
   * zoom in again on the way back out.
   */
  test("a double-click after a click-zoom goes back to the original window without zooming in again", () => {
    jest.useFakeTimers();
    const { onHistogramTimeRangeSelect, onTimeRangeChange } = renderViewer();

    click(BAR_B);
    expect(onHistogramTimeRangeSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Double-click to zoom out")).toBeInTheDocument();

    click(BAR_A);
    click(BAR_A);
    fireEvent.doubleClick(screen.getByTestId(`bucket-${BAR_A}`));

    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    expect(onHistogramTimeRangeSelect).toHaveBeenCalledTimes(1);
    expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
    expect(onTimeRangeChange).toHaveBeenCalledWith(ORIGINAL_WINDOW);
  });
});
