import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";

/*
 * A LINE CHART FOLLOWED BY A LEGEND: NO BLANK BAND UNDER ITS TIME AXIS.
 *
 * A line chart keeps 24px under its time axis. The axis's own 30px band
 * already holds the tick labels, so those 24px are blank - and a reference
 * line legend under the chart (the SLO burn-down's "At risk (25%)", a
 * dashboard SLO widget's "Target 99.9%") sat 39px under the labels, twice
 * as far as the labels sit from the plot, so it read as a part of the card
 * of its own rather than the chart's key. With a legend following
 * (isFollowedByLegend) the chart keeps no band there: the legend's own
 * margin is the gap. Every other chart keeps the band it had.
 *
 * recharts' chart root is stood in for, to read the margin it is handed
 * (jsdom has no layout).
 */

type CapturedChartProps = {
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
};

const mockChartPropsRef: { current: CapturedChartProps } = { current: {} };

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  const react: typeof React = jest.requireActual("react") as typeof React;
  const root: (props: Record<string, unknown>) => React.ReactElement | null = (
    props: Record<string, unknown>,
  ): React.ReactElement | null => {
    // React describes a component stack by calling it bare: not a render.
    if (!props) {
      return null;
    }
    mockChartPropsRef.current = props as CapturedChartProps;
    return react.createElement(
      "div",
      { "data-testid": "chart-root" },
      props["children"] as React.ReactNode,
    );
  };
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return children;
    },
    LineChart: root,
  };
});

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

const FIRST_BUCKET: number = Date.parse("2026-09-28T10:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

const ROWS: Array<Record<string, number | string>> = Array.from(
  { length: 6 },
  (_: unknown, index: number): Record<string, number | string> => {
    return {
      [CHART_DATA_POINT_X_AXIS_KEY]: `${10 + index}:00`,
      [CHART_DATA_POINT_DATE_KEY]: FIRST_BUCKET + index * HOUR_MS,
      Budget: 80 - index * 10,
    };
  },
);

type LineChartProps = React.ComponentProps<typeof LineChart>;

// The bottom margin the chart hands recharts.
function bottomMargin(props: Partial<LineChartProps>): number | undefined {
  mockChartPropsRef.current = {};

  render(
    <LineChart
      data={ROWS}
      index={CHART_DATA_POINT_X_AXIS_KEY}
      categories={["Budget"]}
      showLegend={false}
      {...props}
    />,
  );

  const bottom: number | undefined = mockChartPropsRef.current.margin?.bottom;

  cleanup();

  return bottom;
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the band under a line chart's time axis", () => {
  test("none when a legend follows the chart: the legend's margin is the gap", () => {
    expect(bottomMargin({ isFollowedByLegend: true })).toBe(0);
  });

  test("24px, as before, when nothing follows", () => {
    expect(bottomMargin({})).toBe(24);
    expect(bottomMargin({ isFollowedByLegend: false })).toBe(24);
  });

  test("an axis title keeps its room and a hidden axis its 8px, legend or not", () => {
    for (const isFollowedByLegend of [false, true]) {
      expect(bottomMargin({ xAxisLabel: "Time", isFollowedByLegend })).toBe(40);
      expect(bottomMargin({ showXAxis: false, isFollowedByLegend })).toBe(8);
    }
  });

  test("the prop is the chart's own: it is never handed on to the page's markup", () => {
    const errors: Array<string> = [];

    jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>) => {
        errors.push(args.map(String).join(" "));
      });

    const { container } = render(
      <LineChart
        data={ROWS}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["Budget"]}
        showLegend={false}
        isFollowedByLegend={true}
      />,
    );

    expect(container.innerHTML).not.toMatch(/isfollowedbylegend/i);
    expect(
      errors.filter((error: string): boolean => {
        return /isFollowedByLegend/i.test(error);
      }),
    ).toEqual([]);
  });
});
