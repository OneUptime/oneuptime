import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import ValueFormatter from "../../../../Utils/ValueFormatter";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";

/*
 * ISSUE #10118: THE LINE, BAR AND AREA CHARTS HAND THEIR LIBRARY CHART THE
 * UNIT OF TIME OF EACH VALUE AXIS.
 *
 * A host names an axis's unit of time on its YAxis options
 * (durationUnitInSeconds, from ValueFormatter.getDurationUnitInSeconds) and
 * on its second axis's; the chart hands both to the chart library, which
 * steps each in natural units of time. An axis that names none steps in
 * round decimal steps, as every other axis does.
 */

// What each library chart was last handed.
const handed: { current: Record<string, unknown> } = { current: {} };

function recordingChart(props: Record<string, unknown>): ReactElement {
  handed.current = props;
  return <div data-testid="chart-library" />;
}

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart",
  () => {
    return { __esModule: true, LineChart: recordingChart };
  },
);

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart",
  () => {
    return { __esModule: true, BarChart: recordingChart };
  },
);

jest.mock(
  "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart",
  () => {
    return { __esModule: true, AreaChart: recordingChart };
  },
);

import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  SecondYAxis,
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import {
  ChartValueAxes,
  getChartValueAxes,
} from "../../../../UI/Components/Charts/Utils/ValueAxes";
import { ChartSecondYAxis } from "../../../../UI/Components/Charts/ChartLibrary/Utils/SecondYAxis";

afterEach(() => {
  cleanup();
  handed.current = {};
});

const X_AXIS: XAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: new Date(Date.UTC(2026, 10, 15, 12, 0)),
    max: new Date(Date.UTC(2026, 10, 15, 12, 30)),
    aggregateType: XAxisAggregateType.Average,
  },
};

function yAxis(unit: string): YAxis {
  return {
    legend: unit,
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      precision: YAxisPrecision.NoDecimals,
      formatter: (value: number): string => {
        return ValueFormatter.formatValue(value, unit);
      },
      durationUnitInSeconds: ValueFormatter.getDurationUnitInSeconds(unit),
    },
  };
}

const DATA: Array<SeriesPoint> = [
  {
    seriesName: "Job",
    data: [
      { x: new Date(Date.UTC(2026, 10, 15, 12, 1)), y: 900 },
      { x: new Date(Date.UTC(2026, 10, 15, 12, 2)), y: 5400 },
    ],
  },
  {
    seriesName: "Latency",
    data: [
      { x: new Date(Date.UTC(2026, 10, 15, 12, 1)), y: 250 },
      { x: new Date(Date.UTC(2026, 10, 15, 12, 2)), y: 1200 },
    ],
  },
];

// The latency, in milliseconds, against a second axis of its own.
const LATENCY_ON_THE_RIGHT: SecondYAxis = {
  ...yAxis("ms"),
  seriesNames: ["Latency"],
};

describe("the line, bar and area charts", () => {
  test.each([
    ["line", LineChartElement],
    ["bar", BarChartElement],
    ["area", AreaChartElement],
  ])(
    "the %s chart hands its library chart each axis's unit of time",
    (_name: string, Chart: unknown) => {
      const Element: React.FunctionComponent<Record<string, unknown>> =
        Chart as React.FunctionComponent<Record<string, unknown>>;

      render(
        <Element
          data={DATA}
          xAxis={X_AXIS}
          yAxis={yAxis("s")}
          secondYAxis={LATENCY_ON_THE_RIGHT}
          curve={ChartCurve.MONOTONE}
          sync={false}
          syncid="durations"
        />,
      );

      expect(handed.current["valueDurationUnitInSeconds"]).toBe(1);
      expect(
        (handed.current["secondYAxis"] as ChartSecondYAxis)
          .durationUnitInSeconds,
      ).toBe(0.001);
    },
  );

  test.each([
    ["line", LineChartElement],
    ["bar", BarChartElement],
    ["area", AreaChartElement],
  ])(
    "the %s chart of bytes names no unit of time: its axis steps in decimals",
    (_name: string, Chart: unknown) => {
      const Element: React.FunctionComponent<Record<string, unknown>> =
        Chart as React.FunctionComponent<Record<string, unknown>>;

      render(
        <Element
          data={DATA}
          xAxis={X_AXIS}
          yAxis={yAxis("By")}
          curve={ChartCurve.MONOTONE}
          sync={false}
          syncid="bytes"
        />,
      );

      expect(handed.current["valueDurationUnitInSeconds"]).toBeUndefined();
      expect(handed.current["secondYAxis"]).toBeUndefined();
    },
  );
});

describe("getChartValueAxes", () => {
  test("the second axis carries its unit of time, and one with none carries none", () => {
    const withTime: ChartValueAxes = getChartValueAxes({
      data: DATA,
      yAxis: yAxis("By"),
      secondYAxis: LATENCY_ON_THE_RIGHT,
    });

    expect(withTime.secondYAxis?.durationUnitInSeconds).toBe(0.001);

    const withNone: ChartValueAxes = getChartValueAxes({
      data: DATA,
      yAxis: yAxis("s"),
      secondYAxis: { ...yAxis("By"), seriesNames: ["Latency"] },
    });

    expect(withNone.secondYAxis?.durationUnitInSeconds).toBeUndefined();
  });
});
