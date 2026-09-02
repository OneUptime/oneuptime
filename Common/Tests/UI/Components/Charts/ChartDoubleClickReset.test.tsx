import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * ResponsiveContainer measures its parent, which is always 0x0 in jsdom, so
 * the chart renders nothing — including no `.recharts-wrapper` for the
 * events below to land on — without a fixed size. Same shim the other chart
 * suites use.
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
 * Drag-to-select on a dashboard panel now retimes the WHOLE dashboard, so
 * every panel needs a way back out of the zoom that does not depend on
 * finding a particular widget: double-clicking any of them.
 *
 * That gesture is wired at the chart library, not at the widget card, for
 * two reasons pinned here: it must reach recharts' own plot surface (the
 * card sits under the edit overlay and the resize handles), and it must be
 * OPT-IN — a chart handed no reset handler has to behave exactly as it did
 * before, because a double-click is also two plain clicks and those still
 * mean "pin this bucket" everywhere else in the product.
 */

const START: Date = new Date("2026-08-10T00:00:00.000Z");
const END: Date = new Date("2026-08-10T01:00:00.000Z");

function buildPoints(): Array<DataPoint> {
  const points: Array<DataPoint> = [];
  for (let index: number = 0; index < 10; index++) {
    points.push({
      x: new Date(START.getTime() + index * 60 * 1000),
      y: 90 + index,
    });
  }
  return points;
}

function buildSeries(): Array<SeriesPoint> {
  return [{ seriesName: "CPU", data: buildPoints() }];
}

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

interface ChartUnderTest {
  name: string;
  render: (onTimeRangeReset: (() => void) | undefined) => React.ReactElement;
}

const CHARTS: Array<ChartUnderTest> = [
  {
    name: "LineChart",
    render: (
      onTimeRangeReset: (() => void) | undefined,
    ): React.ReactElement => {
      return (
        <LineChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={300}
          showLegend={false}
          sync={false}
          syncid="double-click-reset-test"
          onTimeRangeReset={onTimeRangeReset}
        />
      );
    },
  },
  {
    name: "AreaChart",
    render: (
      onTimeRangeReset: (() => void) | undefined,
    ): React.ReactElement => {
      return (
        <AreaChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          curve={ChartCurve.MONOTONE}
          heightInPx={300}
          showLegend={false}
          sync={false}
          syncid="double-click-reset-test"
          onTimeRangeReset={onTimeRangeReset}
        />
      );
    },
  },
  {
    /*
     * A bar panel cannot ORIGINATE a zoom — it has no drag-to-select — but
     * it must still be able to end one, or a board whose only panel under
     * the pointer is a bar chart would be a dead end.
     */
    name: "BarChart",
    render: (
      onTimeRangeReset: (() => void) | undefined,
    ): React.ReactElement => {
      return (
        <BarChartElement
          data={buildSeries()}
          xAxis={X_AXIS}
          yAxis={Y_AXIS}
          heightInPx={300}
          showLegend={false}
          sync={false}
          syncid="double-click-reset-test"
          onTimeRangeReset={onTimeRangeReset}
        />
      );
    },
  },
];

function plotSurface(rendered: RenderResult): Element {
  const surface: Element | null =
    rendered.container.querySelector(".recharts-wrapper");
  if (!surface) {
    throw new Error("chart did not render a plot surface");
  }
  return surface;
}

afterEach(() => {
  cleanup();
});

describe("chart double-click to reset the time range", () => {
  for (const chart of CHARTS) {
    describe(chart.name, () => {
      test("double-clicking the plot calls back exactly once", () => {
        const onTimeRangeReset: MockFunction = getJestMockFunction();
        const rendered: RenderResult = render(
          chart.render(onTimeRangeReset as unknown as () => void),
        );

        fireEvent.doubleClick(plotSurface(rendered));

        expect(onTimeRangeReset.mock.calls.length).toBe(1);
      });

      test("a plain click is not a reset", () => {
        const onTimeRangeReset: MockFunction = getJestMockFunction();
        const rendered: RenderResult = render(
          chart.render(onTimeRangeReset as unknown as () => void),
        );

        fireEvent.click(plotSurface(rendered));

        expect(onTimeRangeReset.mock.calls.length).toBe(0);
      });

      test("a chart with no reset handler still renders and swallows the gesture", () => {
        const rendered: RenderResult = render(chart.render(undefined));

        // No handler wired, so this must be inert rather than throwing.
        fireEvent.doubleClick(plotSurface(rendered));

        expect(
          rendered.container.querySelector(".recharts-wrapper"),
        ).not.toBeNull();
      });
    });
  }
});
