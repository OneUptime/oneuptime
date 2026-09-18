/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  HistogramBucket,
  HistogramSeriesOption,
} from "../../../UI/Components/TelemetryViewer/types";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A zero-count bucket is how a caller keeps a quiet stretch on the time axis:
 * without it the bars either side of an empty hour close up and the chart
 * lies about when things happened. Such a bucket is not a sighting of its
 * series, though - it draws nothing, so it must not put the series in the
 * legend (or draw a Bar for it).
 *
 * recharts is stood in for, as in TelemetryHistogramDragTooltip.test.tsx, so
 * the rows the chart is handed and the Bars it declares can be read directly.
 */
jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
    [series: string]: number | string;
  }

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { data: Array<StubRow>; children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": "chart-row",
            "data-time": row.time,
            "data-row": JSON.stringify(row),
          });
        }),
        props.children,
      );
    },
    Bar: (props: { dataKey: string }) => {
      return react.createElement("div", {
        "data-testid": "bar",
        "data-key": props.dataKey,
      });
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

import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";

const SERIES: Array<HistogramSeriesOption> = [
  { key: "critical", label: "Critical", color: "#dc2626" },
  { key: "high", label: "High", color: "#ea580c" },
  { key: "low", label: "Low", color: "#3b82f6" },
];

function barKeys(): Array<string> {
  return screen.queryAllByTestId("bar").map((bar: HTMLElement): string => {
    return bar.getAttribute("data-key") || "";
  });
}

function rowTimes(): Array<string> {
  return screen
    .queryAllByTestId("chart-row")
    .map((row: HTMLElement): string => {
      return row.getAttribute("data-time") || "";
    });
}

afterEach(() => {
  cleanup();
});

describe("TelemetryHistogram with zero-count buckets", () => {
  test("keeps every bucket on the time axis, empty ones included", () => {
    const buckets: Array<HistogramBucket> = [
      { time: "2026-09-17T10:00:00Z", series: "high", count: 4 },
      { time: "2026-09-17T11:00:00Z", series: "critical", count: 0 },
      { time: "2026-09-17T12:00:00Z", series: "critical", count: 0 },
      { time: "2026-09-17T13:00:00Z", series: "low", count: 2 },
    ];

    render(
      <TelemetryHistogram
        buckets={buckets}
        series={SERIES}
        isLoading={false}
      />,
    );

    expect(rowTimes()).toEqual([
      "2026-09-17T10:00:00Z",
      "2026-09-17T11:00:00Z",
      "2026-09-17T12:00:00Z",
      "2026-09-17T13:00:00Z",
    ]);
  });

  test("a series seen only in zero-count buckets is neither legended nor drawn", () => {
    render(
      <TelemetryHistogram
        buckets={[
          { time: "2026-09-17T10:00:00Z", series: "high", count: 4 },
          { time: "2026-09-17T11:00:00Z", series: "critical", count: 0 },
        ]}
        series={SERIES}
        isLoading={false}
      />,
    );

    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByText("Critical")).toBeNull();
    expect(barKeys()).toEqual(["high"]);
  });

  test("a series with a real count somewhere is legended even if other buckets hold zero for it", () => {
    render(
      <TelemetryHistogram
        buckets={[
          { time: "2026-09-17T10:00:00Z", series: "critical", count: 0 },
          { time: "2026-09-17T11:00:00Z", series: "critical", count: 1 },
        ]}
        series={SERIES}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(barKeys()).toEqual(["critical"]);
  });

  test("legend and bars keep the series' declared order", () => {
    render(
      <TelemetryHistogram
        buckets={[
          { time: "2026-09-17T10:00:00Z", series: "low", count: 1 },
          { time: "2026-09-17T10:00:00Z", series: "critical", count: 1 },
        ]}
        series={SERIES}
        isLoading={false}
      />,
    );

    expect(barKeys()).toEqual(["critical", "low"]);
  });

  test("an all-zero window still draws its axis, with no bars and no legend", () => {
    render(
      <TelemetryHistogram
        buckets={[
          { time: "2026-09-17T10:00:00Z", series: "critical", count: 0 },
          { time: "2026-09-17T11:00:00Z", series: "critical", count: 0 },
        ]}
        series={SERIES}
        isLoading={false}
        title="Security Event Volume"
      />,
    );

    expect(screen.getByText("Security Event Volume")).toBeInTheDocument();
    expect(rowTimes()).toHaveLength(2);
    expect(barKeys()).toEqual([]);
    for (const option of SERIES) {
      expect(screen.queryByText(option.label)).toBeNull();
    }
  });
});
