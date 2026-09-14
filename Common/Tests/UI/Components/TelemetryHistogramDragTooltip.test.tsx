/** @timezone UTC */

import {
  HistogramBucket,
  HistogramSeriesOption,
} from "../../../UI/Components/TelemetryViewer/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The traces / exceptions volume chart is the same chart as the log volume
 * one, drawn from a different signal — so it carries the same drag-to-zoom
 * behaviour and needs the same cover. See LogsHistogramDragTooltip.test.tsx
 * for why recharts is stood in for here.
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
    Tooltip: (props: { active?: boolean }) => {
      return react.createElement("div", {
        "data-testid": "tooltip",
        "data-active": String(props.active),
      });
    },
    ReferenceArea: (props: { x1?: string; x2?: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
    },
  };
});

// Imported after the mock so the chart picks the stand-in up.
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";

const FIRST_BUCKET: string = "2026-08-05T11:58:00Z";
const LAST_BUCKET: string = "2026-08-05T12:00:00Z";

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#34d399" },
  { key: "error", label: "Error", color: "#f87171" },
];

const BUCKETS: Array<HistogramBucket> = [
  { time: FIRST_BUCKET, series: "ok", count: 12 },
  { time: "2026-08-05T11:59:00Z", series: "error", count: 4 },
  { time: LAST_BUCKET, series: "ok", count: 9 },
];

const ZOOM_OUT_HINT: string = "Double-click to zoom out";

function bucketAt(time: string): HTMLElement {
  return screen.getByTestId(`bucket-${time}`);
}

function tooltipActiveProp(): string | null {
  return screen.getByTestId("tooltip").getAttribute("data-active");
}

interface RenderedHistogram {
  onTimeRangeSelect: MockFunction;
  onZoomOut: MockFunction;
}

function renderHistogram(
  options: { canZoomOut?: boolean } = {},
): RenderedHistogram {
  const onTimeRangeSelect: MockFunction = getJestMockFunction();
  const onZoomOut: MockFunction = getJestMockFunction();

  render(
    <TelemetryHistogram
      buckets={BUCKETS}
      series={SERIES}
      isLoading={false}
      onTimeRangeSelect={onTimeRangeSelect}
      {...(options.canZoomOut ? { onZoomOut: onZoomOut } : {})}
    />,
  );

  return { onTimeRangeSelect: onTimeRangeSelect, onZoomOut: onZoomOut };
}

describe("TelemetryHistogram — dragging out a time range", () => {
  afterEach(() => {
    cleanup();
  });

  test("holds the tooltip shut for the length of the drag", () => {
    renderHistogram();

    expect(tooltipActiveProp()).toBe("undefined");

    fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
    fireEvent.mouseMove(bucketAt(LAST_BUCKET));

    expect(tooltipActiveProp()).toBe("false");
  });

  test("gives the tooltip back when the reader lets go", () => {
    renderHistogram();

    fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
    fireEvent.mouseMove(bucketAt(LAST_BUCKET));
    fireEvent.mouseUp(bucketAt(LAST_BUCKET));

    expect(tooltipActiveProp()).toBe("undefined");
  });

  test("gives the tooltip back when the pointer is released off the chart", () => {
    renderHistogram();

    fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
    fireEvent.mouseMove(bucketAt(LAST_BUCKET));
    fireEvent.mouseUp(document.body);

    expect(tooltipActiveProp()).toBe("undefined");
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("reports the dragged window once", () => {
    const { onTimeRangeSelect } = renderHistogram();

    fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
    fireEvent.mouseMove(bucketAt(LAST_BUCKET));
    fireEvent.mouseUp(bucketAt(LAST_BUCKET));

    expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeRangeSelect.mock.calls[0] as [Date, Date];
    expect(start.toISOString()).toBe(new Date(FIRST_BUCKET).toISOString());
    expect(end.toISOString()).toBe(new Date(LAST_BUCKET).toISOString());
  });

  test("zooms back out on a double-click", () => {
    const { onZoomOut } = renderHistogram({ canZoomOut: true });

    expect(screen.queryByText(ZOOM_OUT_HINT)).not.toBeNull();

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  test("offers no way out while the chart is on its original window", () => {
    renderHistogram();

    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();

    fireEvent.doubleClick(screen.getByTestId("bar-chart"));

    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();
  });
});
