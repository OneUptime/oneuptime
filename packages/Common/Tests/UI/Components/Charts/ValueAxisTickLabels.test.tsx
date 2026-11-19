import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import ValueFormatter from "../../../../Utils/ValueFormatter";
import {
  ValueAxisFormatter,
  ValueAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import { ChartSecondYAxis } from "../../../../UI/Components/Charts/ChartLibrary/Utils/SecondYAxis";
import {
  Y_AXIS_WIDTH_IN_PX,
  getYAxisWidthForLabelsInPx,
} from "../../../../UI/Components/Charts/Utils/YAxisWidth";
import { getNiceTickValues } from "recharts";

/*
 * ISSUE #10079, DRAWN: THE TICKS A VALUE AXIS DRAWS READ APART.
 *
 * The line, area and bar charts, drawn by recharts at a size: a series that
 * moves over a range small beside its values (a filesystem at 17.2 GB, give
 * or take a few megabytes) wrote "17.2 GB" on every tick of its axis. Now each
 * axis reads apart, on either side of the chart, its tooltip writes the
 * series' values to the same figures, and the axis is as wide as its widest
 * tick. An axis whose ticks already read apart draws exactly the ticks and
 * the width it always had.
 */

// The chart's root, as recharts is handed it: its clicks, for a bucket's.
const chartRootProps: { current: Record<string, unknown> } = { current: {} };

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  const react: typeof React = jest.requireActual("react") as typeof React;
  const RealLineChart: React.ComponentType<Record<string, unknown>> = actual[
    "LineChart"
  ] as React.ComponentType<Record<string, unknown>>;

  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement;
    }): React.ReactElement => {
      return react.cloneElement(children, {
        width: 640,
        height: 320,
      } as Record<string, unknown>);
    },
    LineChart: (props: Record<string, unknown>): React.ReactElement => {
      chartRootProps.current = props;
      return react.createElement(RealLineChart, props);
    },
  };
});

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

const NBSP: string = "\u00A0";

afterEach(() => {
  cleanup();
});

function unitFormatter(unit: string, language?: string): ValueAxisFormatter {
  return (value: number, precision?: ValueAxisPrecision): string => {
    return ValueFormatter.formatValue(value, unit, {
      language: language,
      step: precision?.step,
    });
  };
}

// Rows a minute apart, each holding the values of `series` at its time.
function rowsOf(
  series: Record<string, Array<number>>,
): Array<Record<string, number | string>> {
  const length: number = Math.max(
    ...Object.values(series).map((values: Array<number>): number => {
      return values.length;
    }),
  );
  const rows: Array<Record<string, number | string>> = [];

  for (let index: number = 0; index < length; index++) {
    const time: Date = new Date(Date.UTC(2026, 10, 19, 10, index));
    const row: Record<string, number | string> = {
      [CHART_DATA_POINT_X_AXIS_KEY]: `10:${String(index).padStart(2, "0")}`,
      [CHART_DATA_POINT_DATE_KEY]: time.getTime(),
    };

    for (const [name, values] of Object.entries(series)) {
      if (values[index] !== undefined) {
        row[name] = values[index] as number;
      }
    }

    rows.push(row);
  }

  return rows;
}

// A filesystem at 17.2 GB, give or take a few megabytes.
const FILESYSTEM: Array<number> = [
  17.2013e9, 17.2021e9, 17.2034e9, 17.2047e9, 17.2039e9, 17.2026e9,
];
// A CPU on a host that is busy and stays busy: its own two decimals read apart.
const CPU_PERCENT: Array<number> = [91.2, 91.3, 91.25, 91.31, 91.28, 91.22];
// One that holds still: its two decimals would read "91.25%" on every tick.
const STILL_CPU_PERCENT: Array<number> = [
  91.251, 91.2525, 91.254, 91.2515, 91.253, 91.252,
];
// A CPU's load, from 12% to 64%: an axis that reads apart already.
const WIDE_PERCENT: Array<number> = [12, 30, 64, 41, 22, 50];

// The value axes drawn, left first: what each one's ticks say.
function valueAxesIn(container: HTMLElement): Array<Array<string>> {
  return Array.from(container.querySelectorAll(".recharts-yAxis-tick-labels"))
    .map((axis: Element): { x: number; ticks: Array<string> } => {
      const ticks: Array<Element> = Array.from(
        axis.querySelectorAll(".recharts-cartesian-axis-tick-value"),
      );

      return {
        x: Math.min(
          ...ticks.map((tick: Element): number => {
            return Number(tick.getAttribute("x") || 0);
          }),
        ),
        ticks: ticks.map((tick: Element): string => {
          return (tick.textContent || "").trim();
        }),
      };
    })
    .sort(
      (
        a: { x: number; ticks: Array<string> },
        b: { x: number; ticks: Array<string> },
      ): number => {
        return a.x - b.x;
      },
    )
    .map((axis: { x: number; ticks: Array<string> }): Array<string> => {
      return axis.ticks;
    });
}

// Where the plot starts and ends: its horizontal grid line.
function plotEdges(container: HTMLElement): { left: number; right: number } {
  const line: Element | null = container.querySelector(
    ".recharts-cartesian-grid-horizontal line",
  );

  return {
    left: Number(line?.getAttribute("x1") || 0),
    right: Number(line?.getAttribute("x2") || 0),
  };
}

function expectApart(ticks: Array<string>): void {
  expect(ticks.length).toBeGreaterThanOrEqual(3);
  for (let index: number = 1; index < ticks.length; index++) {
    expect(ticks[index]).not.toBe(ticks[index - 1]);
  }
}

describe("a single axis over a narrow range", () => {
  test("the line chart: its ticks read apart, to the figures their step needs", () => {
    const { container } = render(
      <LineChart
        data={rowsOf({ used: FILESYSTEM })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["used"]}
        valueFormatter={unitFormatter("By")}
        autoMinValue={true}
        showLegend={false}
      />,
    );

    const [ticks] = valueAxesIn(container);

    expect(ticks).toEqual([
      `17.201${NBSP}GB`,
      `17.202${NBSP}GB`,
      `17.203${NBSP}GB`,
      `17.204${NBSP}GB`,
      `17.205${NBSP}GB`,
    ]);
  });

  test("the area chart", () => {
    const { container } = render(
      <AreaChart
        data={rowsOf({ used: FILESYSTEM })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["used"]}
        valueFormatter={unitFormatter("By")}
        autoMinValue={true}
        showLegend={false}
      />,
    );

    expectApart(valueAxesIn(container)[0]!);
    expect(valueAxesIn(container)[0]).toContain(`17.203${NBSP}GB`);
  });

  test("the bar chart, a percent near zero from its zero", () => {
    const { container } = render(
      <BarChart
        data={rowsOf({ errors: [0.0011, 0.0024, 0.0017] })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["errors"]}
        valueFormatter={unitFormatter("%")}
        showLegend={false}
      />,
    );

    const [ticks] = valueAxesIn(container);

    expectApart(ticks!);
    // Ticks a thousandth of a percent apart, from the bars' zero.
    expect(ticks).toEqual(["0.000%", "0.001%", "0.002%", "0.003%", "0.004%"]);
  });

  test("stacked bars: the axis reaches the stacks' sums, and reads apart", () => {
    const { container } = render(
      <BarChart
        data={rowsOf({
          a: [0.0011, 0.0012, 0.0013],
          b: [0.0009, 0.0011, 0.001],
        })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["a", "b"]}
        type="stacked"
        valueFormatter={unitFormatter("%")}
        showLegend={false}
      />,
    );

    const [ticks] = valueAxesIn(container);

    expectApart(ticks!);
    const top: number = Number(ticks![ticks!.length - 1]!.replace("%", ""));
    expect(top).toBeGreaterThanOrEqual(0.0023);
  });

  test.each([
    ["de", "17,201", "17,205"],
    ["fa", "۱۷٫۲۰۱", "۱۷٫۲۰۵"],
  ])(
    "%s: in the reader's digits",
    (language: string, first: string, last: string) => {
      const { container } = render(
        <LineChart
          data={rowsOf({ used: FILESYSTEM })}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["used"]}
          valueFormatter={unitFormatter("By", language)}
          autoMinValue={true}
          showLegend={false}
        />,
      );

      const [ticks] = valueAxesIn(container);

      expectApart(ticks!);
      expect(ticks![0]).toContain(first);
      expect(ticks![ticks!.length - 1]).toContain(last);
    },
  );

  test("the axis is as wide as its widest tick: the plot starts after it", () => {
    const { container } = render(
      <LineChart
        data={rowsOf({ used: FILESYSTEM })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["used"]}
        valueFormatter={unitFormatter("By")}
        autoMinValue={true}
        showLegend={false}
        yAxisWidth={Y_AXIS_WIDTH_IN_PX}
      />,
    );

    const [ticks] = valueAxesIn(container);
    const widest: number = getYAxisWidthForLabelsInPx({ labels: ticks! });

    expect(widest).toBeGreaterThan(Y_AXIS_WIDTH_IN_PX);
    expect(plotEdges(container).left).toBeGreaterThanOrEqual(widest);
  });
});

describe("an axis whose ticks already read apart draws as it always has", () => {
  test("recharts' own ticks, in the formatter's own figures, at the host's width", () => {
    const formatter: ValueAxisFormatter = unitFormatter("%");
    const { container } = render(
      <LineChart
        data={rowsOf({ cpu: WIDE_PERCENT })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["cpu"]}
        valueFormatter={formatter}
        autoMinValue={true}
        showLegend={false}
        yAxisWidth={Y_AXIS_WIDTH_IN_PX}
      />,
    );

    expect(valueAxesIn(container)[0]).toEqual(
      getNiceTickValues([12, 64], 5, true, "adaptive").map(
        (tick: number): string => {
          return formatter(tick);
        },
      ),
    );
    // The plot starts where it always did: after the host's 64 pixels.
    expect(plotEdges(container).left).toBe(Y_AXIS_WIDTH_IN_PX);
  });
});

describe("both axes over narrow ranges", () => {
  const filesystemOnTheRight: ChartSecondYAxis = {
    categories: ["used"],
    valueFormatter: unitFormatter("By"),
    width: Y_AXIS_WIDTH_IN_PX,
    autoMinValue: true,
  };

  test.each([
    ["line", LineChart],
    ["area", AreaChart],
    ["bar", BarChart],
  ])(
    "the %s chart: each axis reads apart, in its own unit",
    (
      kind: string,
      Chart: typeof LineChart | typeof AreaChart | typeof BarChart,
    ) => {
      const ChartElement: React.ElementType = Chart as React.ElementType;
      const { container } = render(
        <ChartElement
          data={rowsOf({ cpu: STILL_CPU_PERCENT, used: FILESYSTEM })}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["cpu", "used"]}
          valueFormatter={unitFormatter("%")}
          autoMinValue={true}
          secondYAxis={filesystemOnTheRight}
          showLegend={false}
        />,
      );

      const [left, right] = valueAxesIn(container);

      expect(kind).toBeTruthy();
      expect(valueAxesIn(container)).toHaveLength(2);
      expectApart(right!);
      for (const tick of right!) {
        expect(tick).toMatch(/GB$/);
      }
      expectApart(left!);
      for (const tick of left!) {
        expect(tick).toMatch(/^91\.\d{3}%$/);
      }
    },
  );

  test("bars that stand on zero: each axis from zero reads apart as it always did", () => {
    const { container } = render(
      <BarChart
        data={rowsOf({ cpu: STILL_CPU_PERCENT, used: FILESYSTEM })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["cpu", "used"]}
        valueFormatter={unitFormatter("%")}
        secondYAxis={{ ...filesystemOnTheRight, autoMinValue: false }}
        showLegend={false}
      />,
    );

    const [left, right] = valueAxesIn(container);

    expect(left![0]).toBe("0.00%");
    expect(right![0]).toBe(`0${NBSP}B`);
    expectApart(left!);
    expectApart(right!);
  });

  test("a narrow left axis beside a wide right one: only the left is stepped", () => {
    const formatter: ValueAxisFormatter = unitFormatter("By");
    const { container } = render(
      <LineChart
        data={rowsOf({
          cpu: STILL_CPU_PERCENT,
          used: [1e9, 9e9, 4e9, 12e9, 2e9, 7e9],
        })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["cpu", "used"]}
        valueFormatter={unitFormatter("%")}
        autoMinValue={true}
        secondYAxis={{
          ...filesystemOnTheRight,
          valueFormatter: formatter,
        }}
        showLegend={false}
      />,
    );

    const [left, right] = valueAxesIn(container);

    expectApart(left!);
    expect(right).toEqual(
      getNiceTickValues([1e9, 12e9], 5, true, "adaptive").map(
        (tick: number): string => {
          return formatter(tick);
        },
      ),
    );
  });
});

describe("a clicked moment's values and the tooltip write the axis's figures", () => {
  test("the bucket click hands the host the tooltip's writing, per category and axis", () => {
    const clicks: Array<{
      values: Record<string, number | string>;
      formatValue: (category: string, value: number) => string;
    }> = [];

    render(
      <LineChart
        data={rowsOf({
          cpu: STILL_CPU_PERCENT,
          used: FILESYSTEM,
          reserved: [17.2015e9, 17.2025e9, 17.2035e9],
        })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["cpu", "used", "reserved"]}
        valueFormatter={unitFormatter("%")}
        autoMinValue={true}
        secondYAxis={{
          categories: ["used", "reserved"],
          valueFormatter: unitFormatter("By"),
          width: Y_AXIS_WIDTH_IN_PX,
          autoMinValue: true,
        }}
        categoryValueFormatters={{
          reserved: (value: number): string => {
            return `${value} reserved`;
          },
        }}
        showLegend={false}
        onBucketClick={(
          _start: Date,
          _end: Date,
          values: Record<string, number | string>,
          formatValue: (category: string, value: number) => string,
        ): void => {
          clicks.push({ values: values, formatValue: formatValue });
        }}
      />,
    );

    act(() => {
      (
        chartRootProps.current["onClick"] as (
          state: Record<string, unknown>,
        ) => void
      )({ activeTooltipIndex: 2 });
    });

    expect(clicks).toHaveLength(1);
    const { formatValue } = clicks[0]!;

    // The right axis's series, to the right axis's figures.
    expect(formatValue("used", 17.2034e9)).toBe(`17.203${NBSP}GB`);
    // The left axis's series, to the left axis's figures.
    expect(formatValue("cpu", 91.2534)).toBe("91.253%");
    // A series with its own writing keeps it.
    expect(formatValue("reserved", 5)).toBe("5 reserved");
  });

  test("a chart whose axis reads apart already hands its values over as they always read", () => {
    const clicks: Array<(category: string, value: number) => string> = [];

    render(
      <LineChart
        data={rowsOf({ cpu: CPU_PERCENT })}
        index={CHART_DATA_POINT_X_AXIS_KEY}
        categories={["cpu"]}
        valueFormatter={unitFormatter("%")}
        autoMinValue={true}
        showLegend={false}
        onBucketClick={(
          _start: Date,
          _end: Date,
          _values: Record<string, number | string>,
          formatValue: (category: string, value: number) => string,
        ): void => {
          clicks.push(formatValue);
        }}
      />,
    );

    act(() => {
      (
        chartRootProps.current["onClick"] as (
          state: Record<string, unknown>,
        ) => void
      )({ activeTooltipIndex: 1 });
    });

    expect(clicks[0]!("cpu", 91.25)).toBe("91.25%");
  });
});
