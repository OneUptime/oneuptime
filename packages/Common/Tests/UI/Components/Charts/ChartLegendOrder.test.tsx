import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { AvailableChartColorsKeys } from "../../../../UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * A CHART'S LEGEND NAMES ITS SERIES IN THE ORDER THE PAGE GIVES THEM
 * (issue #6562).
 *
 * recharts 3 sorts legend items by their label unless told otherwise, so
 * Product Analytics' Active users chart, handed Daily, Weekly and Monthly
 * active users, read "Daily active users, Monthly active users, Weekly
 * active users" - and, its names being translated before they are drawn, in
 * another order in each language. Every line, area and bar chart now ranks
 * its legend items by their series' place in `categories`.
 *
 * Real recharts draws the legend here; only ResponsiveContainer is stood in
 * for, as jsdom measures every box at 0x0.
 */

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const ACTIVE_USERS: Array<string> = [
  "Daily active users",
  "Weekly active users",
  "Monthly active users",
];

// The same three, as a German page names them: alphabetically M, T, W.
const ACTIVE_USERS_IN_GERMAN: Array<string> = [
  "Täglich aktive Nutzer",
  "Wöchentlich aktive Nutzer",
  "Monatlich aktive Nutzer",
];

// Backwards from the alphabet, so any sort by name gets every place wrong.
const BACKWARDS: Array<string> = ["Zulu", "Mike", "Alpha"];

const COLORS: Array<AvailableChartColorsKeys> = ["blue", "emerald", "violet"];

type Row = Record<string, string | number>;

function rowsFor(categories: Array<string>): Array<Row> {
  return ["a", "b", "c"].map((time: string, rowIndex: number): Row => {
    const row: Row = { time: time };
    categories.forEach((category: string, place: number): void => {
      row[category] = (rowIndex + 1) * (place + 1);
    });
    return row;
  });
}

// The legend's items, as the reader sees them, first to last.
function legendNames(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("li")).map(
    (item: Element): string => {
      return item.textContent || "";
    },
  );
}

// The colour swatch of each legend item, first to last.
function legendSwatches(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("li > span")).map(
    (swatch: Element): string => {
      return (
        Array.from(swatch.classList).find((name: string): boolean => {
          return name.startsWith("bg-");
        }) || ""
      );
    },
  );
}

afterEach(() => {
  cleanup();
});

type LibraryChart = typeof LineChart | typeof AreaChart | typeof BarChart;

describe.each([
  ["Line chart", LineChart],
  ["Area chart", AreaChart],
  ["Bar chart", BarChart],
] as Array<[string, LibraryChart]>)(
  "%s legend",
  (_name: string, Chart: LibraryChart) => {
    function draw(
      categories: Array<string>,
      extra?: Record<string, unknown>,
    ): HTMLElement {
      const { container } = render(
        <Chart
          data={rowsFor(categories)}
          index="time"
          categories={categories}
          colors={COLORS}
          showLegend={true}
          {...extra}
        />,
      );
      return container;
    }

    test("names Daily, Weekly and Monthly active users in that order", () => {
      expect(legendNames(draw(ACTIVE_USERS))).toEqual(ACTIVE_USERS);
    });

    test("keeps the page's order when the alphabet runs the other way", () => {
      expect(legendNames(draw(BACKWARDS))).toEqual(BACKWARDS);
    });

    test("keeps the page's order in the reader's language", () => {
      expect(legendNames(draw(ACTIVE_USERS_IN_GERMAN))).toEqual(
        ACTIVE_USERS_IN_GERMAN,
      );
    });

    test("each name keeps its own colour, in the palette's order", () => {
      const container: HTMLElement = draw(ACTIVE_USERS);

      expect(legendSwatches(container)).toEqual([
        "bg-blue-500",
        "bg-emerald-500",
        "bg-violet-500",
      ]);
    });

    test("a series the page adds first goes first, and the order holds across renders", () => {
      const { container, rerender } = render(
        <Chart
          data={rowsFor(ACTIVE_USERS)}
          index="time"
          categories={[...ACTIVE_USERS]}
          colors={COLORS}
          showLegend={true}
        />,
      );

      // The same series in a new array, as a page hands them each render.
      rerender(
        <Chart
          data={rowsFor(ACTIVE_USERS)}
          index="time"
          categories={[...ACTIVE_USERS]}
          colors={COLORS}
          showLegend={true}
        />,
      );
      expect(legendNames(container)).toEqual(ACTIVE_USERS);

      const withNew: Array<string> = ["New users", ...ACTIVE_USERS];

      rerender(
        <Chart
          data={rowsFor(withNew)}
          index="time"
          categories={withNew}
          colors={COLORS}
          showLegend={true}
        />,
      );
      expect(legendNames(container)).toEqual(withNew);

      // Reordered by the page: the legend follows.
      const reordered: Array<string> = [...ACTIVE_USERS].reverse();

      rerender(
        <Chart
          data={rowsFor(reordered)}
          index="time"
          categories={reordered}
          colors={COLORS}
          showLegend={true}
        />,
      );
      expect(legendNames(container)).toEqual(reordered);
    });

    test("a chart whose series can be clicked names each series once, in order", () => {
      /*
       * A clickable line chart draws an invisible wide line under each
       * series (legendType "none"): the legend never names those.
       */
      const container: HTMLElement = draw(ACTIVE_USERS, {
        onValueChange: (): void => {},
      });

      expect(legendNames(container)).toEqual(ACTIVE_USERS);
    });

    test("no legend is drawn when the page asks for none", () => {
      const container: HTMLElement = draw(ACTIVE_USERS, { showLegend: false });

      expect(legendNames(container)).toEqual([]);
    });
  },
);

describe("an area chart with an expected range", () => {
  test("names its series in order, and never the range's band", () => {
    const categories: Array<string> = ["p95", "Lower", "Upper"];
    const { container } = render(
      <AreaChart
        data={rowsFor(categories)}
        index="time"
        categories={["p95"]}
        colors={COLORS}
        showLegend={true}
        anomalyBandLowerKey="Lower"
        anomalyBandUpperKey="Upper"
      />,
    );

    expect(legendNames(container)).toEqual(["p95"]);
  });
});

/*
 * The charts every page draws (ChartCard, the metric charts, widgets) hand
 * their series to the chart library in the order they were given.
 */
const DAY_MS: number = 24 * 60 * 60 * 1000;
const FIRST_DAY: Date = new Date("2026-11-07T00:00:00.000Z");

const X_AXIS: XAxis = {
  legend: "Time",
  options: {
    type: XAxisType.Time,
    min: FIRST_DAY,
    max: new Date(FIRST_DAY.getTime() + 2 * DAY_MS),
    aggregateType: XAxisAggregateType.Average,
    precision: XAxisPrecision.EVERY_DAY,
  },
};

const Y_AXIS: YAxis = {
  legend: "",
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

function seriesFor(names: Array<string>): Array<SeriesPoint> {
  return names.map((name: string, place: number): SeriesPoint => {
    return {
      seriesName: name,
      data: [0, 1, 2].map((day: number) => {
        return {
          x: new Date(FIRST_DAY.getTime() + day * DAY_MS),
          y: (day + 1) * (place + 1),
        };
      }),
    };
  });
}

describe("the charts pages draw", () => {
  test("a line chart's legend follows its series", () => {
    const { container } = render(
      <LineChartElement
        data={seriesFor(ACTIVE_USERS)}
        xAxis={X_AXIS}
        yAxis={Y_AXIS}
        curve={ChartCurve.MONOTONE}
        sync={false}
        syncid="legend-order"
        heightInPx={176}
        showLegend={true}
      />,
    );

    expect(legendNames(container)).toEqual(ACTIVE_USERS);
  });

  test("an area chart's legend follows its series", () => {
    const { container } = render(
      <AreaChartElement
        data={seriesFor(BACKWARDS)}
        xAxis={X_AXIS}
        yAxis={Y_AXIS}
        curve={ChartCurve.MONOTONE}
        sync={false}
        syncid="legend-order"
        heightInPx={176}
        showLegend={true}
      />,
    );

    expect(legendNames(container)).toEqual(BACKWARDS);
  });

  test("a bar chart's legend follows its series", () => {
    const { container } = render(
      <BarChartElement
        data={seriesFor(ACTIVE_USERS_IN_GERMAN)}
        xAxis={X_AXIS}
        yAxis={Y_AXIS}
        sync={false}
        syncid="legend-order"
        heightInPx={176}
        showLegend={true}
      />,
    );

    expect(legendNames(container)).toEqual(ACTIVE_USERS_IN_GERMAN);
  });
});
