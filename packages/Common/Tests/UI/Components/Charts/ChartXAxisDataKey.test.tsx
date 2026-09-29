import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so
 * the chart renders nothing without a fixed size. Same shim as
 * AxisTickColor.test.tsx — anything that asserts on rendered GEOMETRY needs
 * it, because a 0x0 chart draws no marks either and would make every one of
 * these assertions pass for the wrong reason.
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

import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import { CHART_DATA_POINT_X_AXIS_KEY } from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
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

/*
 * The three chart wrappers hand recharts a FIXED x-axis dataKey, while the
 * rows they hand it are built by DataPointUtil. Those two used to agree only
 * by convention: the util keyed each row by the caller's `xAxis.legend`, and
 * every caller but one happened to pass the literal "Time".
 *
 * The one that did not — the SLO dashboard widget, which passed "" — got a
 * chart with axes, grid and tooltip but no line: recharts looked up "Time" on
 * every row, found nothing, and drew no path. Nothing failed, nothing logged;
 * the widget just rendered an empty frame on public and private dashboards
 * alike.
 *
 * These tests hold the axis key on both sides of that seam: whatever legend a
 * caller passes, the marks get drawn.
 */

const START: Date = new Date("2026-08-10T00:00:00.000Z");
const END: Date = new Date("2026-08-10T01:00:00.000Z");

/* An hour window buckets at one minute, so these land on distinct buckets. */
type BuildPointsFunction = () => Array<DataPoint>;

const buildPoints: BuildPointsFunction = (): Array<DataPoint> => {
  const points: Array<DataPoint> = [];

  for (let index: number = 0; index < 10; index++) {
    points.push({
      x: new Date(START.getTime() + index * 60 * 1000),
      y: 90 + index,
    });
  }

  return points;
};

type BuildXAxisFunction = (legend: string) => ChartXAxis;

const buildXAxis: BuildXAxisFunction = (legend: string): ChartXAxis => {
  return {
    legend: legend,
    options: {
      type: XAxisType.Time,
      min: START,
      max: END,
      aggregateType: XAxisAggregateType.Average,
    },
  };
};

const Y_AXIS: YAxis = {
  legend: "%",
  options: {
    type: YAxisType.Number,
    min: "auto",
    max: 100,
    precision: YAxisPrecision.TwoDecimals,
    formatter: (value: number): string => {
      return `${value}%`;
    },
  },
};

const SERIES_NAME: string = "SLI";

type BuildSeriesFunction = () => Array<SeriesPoint>;

const buildSeries: BuildSeriesFunction = (): Array<SeriesPoint> => {
  return [{ seriesName: SERIES_NAME, data: buildPoints() }];
};

/*
 * Legends worth covering: the canonical one every other caller passes, the
 * empty string the SLO widget passed (the reported bug), and an arbitrary
 * label, which is what a future caller is most likely to reach for.
 */
const LEGENDS: Array<[string, string]> = [
  ['the canonical "Time"', "Time"],
  ["an empty legend", ""],
  ["an arbitrary legend", "Timestamp"],
  ["a legend with markup-ish characters", "Time (UTC) <>"],
];

interface ChartUnderTest {
  name: string;
  /** CSS selector for the SVG geometry this chart type draws per series. */
  markSelector: string;
  render: (xAxis: ChartXAxis) => React.ReactElement;
}

const CHARTS: Array<ChartUnderTest> = [
  {
    name: "LineChart",
    markSelector: "path.recharts-line-curve",
    render: (xAxis: ChartXAxis): React.ReactElement => {
      return (
        <LineChartElement
          data={buildSeries()}
          xAxis={xAxis}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={300}
          showLegend={false}
          sync={false}
          syncid="x-axis-key-test"
        />
      );
    },
  },
  {
    name: "AreaChart",
    markSelector: "path.recharts-area-area",
    render: (xAxis: ChartXAxis): React.ReactElement => {
      return (
        <AreaChartElement
          data={buildSeries()}
          xAxis={xAxis}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={300}
          showLegend={false}
          sync={false}
          syncid="x-axis-key-test"
        />
      );
    },
  },
  {
    /*
     * Bars are drawn through a custom `shape` renderer, so the mark is a bare
     * <path> under recharts' own rectangle group rather than a classed one.
     */
    name: "BarChart",
    markSelector: "g.recharts-bar-rectangle path",
    render: (xAxis: ChartXAxis): React.ReactElement => {
      return (
        <BarChartElement
          data={buildSeries()}
          xAxis={xAxis}
          yAxis={Y_AXIS}
          heightInPx={300}
          showLegend={false}
          sync={false}
          syncid="x-axis-key-test"
        />
      );
    },
  },
];

afterEach((): void => {
  cleanup();
});

describe("Chart x-axis data key", () => {
  test("the canonical key is the literal recharts reads", (): void => {
    /*
     * Pinned, not derived. The wrappers and DataPointUtil both import this
     * constant, so a rename would keep them agreeing with each other while
     * silently changing the shape handed to recharts.
     */
    expect(CHART_DATA_POINT_X_AXIS_KEY).toBe("Time");
  });

  for (const chart of CHARTS) {
    describe(chart.name, () => {
      test.each(LEGENDS)(
        `draws its series with %s`,
        (_label: string, legend: string): void => {
          const { container } = render(chart.render(buildXAxis(legend)));

          const marks: Array<Element> = Array.from(
            container.querySelectorAll(chart.markSelector),
          );

          expect(marks.length).toBeGreaterThan(0);

          /*
           * Present-but-empty geometry is the exact failure mode here: a
           * <path> with no `d` renders nothing at all, so the element count
           * alone would not have caught the bug.
           */
          for (const mark of marks) {
            expect(mark.getAttribute("d")).toBeTruthy();
          }
        },
      );

      test("draws the same geometry whatever the legend says", (): void => {
        const canonical: RenderResultContainer = render(
          chart.render(buildXAxis("Time")),
        );
        const canonicalPaths: Array<string | null> = Array.from(
          canonical.container.querySelectorAll(chart.markSelector),
        ).map((element: Element) => {
          return element.getAttribute("d");
        });

        cleanup();

        const other: RenderResultContainer = render(
          chart.render(buildXAxis("")),
        );
        const otherPaths: Array<string | null> = Array.from(
          other.container.querySelectorAll(chart.markSelector),
        ).map((element: Element) => {
          return element.getAttribute("d");
        });

        expect(otherPaths).toEqual(canonicalPaths);
      });
    });
  }
});

interface RenderResultContainer {
  container: HTMLElement;
}
