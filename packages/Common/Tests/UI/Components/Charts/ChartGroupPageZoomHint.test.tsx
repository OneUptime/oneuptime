import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * Issue #4105: ChartGroup cards name the drag-to-zoom gesture in their
 * header ("Drag to zoom", and "· double-click to reset" while there is a
 * zoom to undo). With page-wide zoom a chart usually gets its handlers from
 * the page rather than from its host, so the hint must resolve them the same
 * way the chart does - otherwise every card on a zoomable page would hide
 * the gesture it actually has, and bar charts (which can now start a zoom)
 * would never show it.
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import ChartGroup, {
  Chart,
  ChartType,
} from "../../../../UI/Components/Charts/ChartGroup/ChartGroup";
import { TimeRangeZoomProvider } from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import TimeRange from "../../../../Types/Time/TimeRange";

const START: Date = new Date("2026-09-28T10:00:00.000Z");
const END: Date = new Date("2026-09-28T10:30:00.000Z");

const X_AXIS: ChartXAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: START,
    max: END,
    aggregateType: XAxisAggregateType.Average,
  },
};

const Y_AXIS: YAxis = {
  legend: "Count",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

const SERIES: Array<SeriesPoint> = [
  {
    seriesName: "Requests",
    data: [
      { x: new Date("2026-09-28T10:01:00.000Z"), y: 3 },
      { x: new Date("2026-09-28T10:02:00.000Z"), y: 5 },
    ],
  },
];

function chartOf(type: ChartType, extra: Record<string, unknown> = {}): Chart {
  const base: Record<string, unknown> = {
    data: SERIES,
    xAxis: X_AXIS,
    yAxis: Y_AXIS,
    sync: false,
    ...extra,
  };
  if (type !== ChartType.BAR) {
    base["curve"] = ChartCurve.MONOTONE;
  }
  return {
    id: `${type}-chart`,
    title: `${type} chart`,
    type: type,
    props: base as unknown as Chart["props"],
  };
}

function pageZoom(isZoomed: boolean): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    zoomToTimeRange: () => {},
    resetZoom: () => {},
  };
}

afterEach(() => {
  cleanup();
});

describe("ChartGroup drag-to-zoom hint on a zoomable page", () => {
  for (const type of [ChartType.LINE, ChartType.AREA, ChartType.BAR]) {
    test(`a ${type} chart on a zoomable page names the drag gesture`, () => {
      render(
        <TimeRangeZoomProvider zoom={pageZoom(false)}>
          <ChartGroup charts={[chartOf(type)]} />
        </TimeRangeZoomProvider>,
      );

      expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
    });

    test(`a ${type} chart names the reset too while the page is zoomed`, () => {
      render(
        <TimeRangeZoomProvider zoom={pageZoom(true)}>
          <ChartGroup charts={[chartOf(type)]} />
        </TimeRangeZoomProvider>,
      );

      expect(
        screen.getByText("Drag to zoom · double-click to reset"),
      ).toBeInTheDocument();
    });
  }

  test("outside a zoomable page a chart without handlers shows no hint", () => {
    render(<ChartGroup charts={[chartOf(ChartType.LINE)]} />);

    expect(screen.queryByText(/Drag to zoom/)).toBeNull();
  });

  test("a chart that opted out shows no hint, even on a zoomable page", () => {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(true)}>
        <ChartGroup
          charts={[chartOf(ChartType.LINE, { disableTimeRangeZoom: true })]}
        />
      </TimeRangeZoomProvider>,
    );

    expect(screen.queryByText(/Drag to zoom/)).toBeNull();
  });

  test("a host's own select handler still earns the hint off any page", () => {
    render(
      <ChartGroup
        charts={[
          chartOf(ChartType.LINE, {
            onTimeRangeSelect: () => {},
          }),
        ]}
      />,
    );

    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
  });

  test("a host that zooms its own way is not told the page can reset it", () => {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(true)}>
        <ChartGroup
          charts={[
            chartOf(ChartType.LINE, {
              onTimeRangeSelect: () => {},
            }),
          ]}
        />
      </TimeRangeZoomProvider>,
    );

    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
    expect(screen.queryByText(/double-click to reset/)).toBeNull();
  });

  test("the hint shows in the card-less stack too", () => {
    render(
      <TimeRangeZoomProvider zoom={pageZoom(false)}>
        <ChartGroup charts={[chartOf(ChartType.AREA)]} hideCard={true} />
      </TimeRangeZoomProvider>,
    );

    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();
  });
});
