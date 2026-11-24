import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import {
  ChartOwnScale,
  ChartSecondYAxis,
  SECOND_Y_AXIS_ID,
  getCategoryOwnScale,
  getCategoryValueFormatter,
  getCategoryYAxisProps,
  getMarkYAxisProps,
  getOwnScaleYAxisId,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/SecondYAxis";
import {
  ChartValueAxes,
  getChartValueAxes,
} from "../../../../UI/Components/Charts/Utils/ValueAxes";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import YAxis, {
  OwnScaleYAxis,
  SecondYAxis,
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

/*
 * ISSUE #10080: A SCALE OF ITS OWN, WITH NO AXIS.
 *
 * A series in a unit neither of a chart's value axes can say (a third kind of
 * unit: milliseconds on a chart in percent and bytes) was drawn against the
 * first axis and stretched it. The line, area and bar charts take scales of
 * their own now (ChartOwnScale): each one's categories are drawn against a
 * hidden value axis of their own, so their line keeps its shape over the
 * plot, the axes keep theirs, and no third axis is drawn. Its reference lines
 * and exemplars are drawn to it, its bars stack apart, and the tooltip writes
 * its values with its formatter. Here the chart library draws with recharts
 * given a size.
 */

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement;
    }): React.ReactElement => {
      return react.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";

afterEach(() => {
  cleanup();
});

const ROWS: Array<Record<string, number | string>> = [
  { time: "10:00", cpu: 20, memory: 4e9, latency: 120 },
  { time: "10:10", cpu: 60, memory: 5e9, latency: 240 },
  { time: "10:20", cpu: 40, memory: 4.5e9, latency: 180 },
];

const percent: (value: number) => string = (value: number): string => {
  return `${value}%`;
};

const gigabytes: (value: number) => string = (value: number): string => {
  return `${(value / 1e9).toFixed(1)} GB`;
};

const milliseconds: (value: number) => string = (value: number): string => {
  return `${value} ms`;
};

const MEMORY_ON_THE_RIGHT: ChartSecondYAxis = {
  categories: ["memory"],
  valueFormatter: gigabytes,
  width: 72,
  autoMinValue: false,
};

const LATENCY_ON_ITS_OWN: ChartOwnScale = {
  id: "latency",
  categories: ["latency"],
  valueFormatter: milliseconds,
  autoMinValue: true,
};

// The value axes drawn: how many write ticks.
function drawnValueAxes(container: HTMLElement): number {
  return container.querySelectorAll(".recharts-yAxis-tick-labels").length;
}

// Every tick the value axes write.
function valueTicks(container: HTMLElement): Array<string> {
  return Array.from(
    container.querySelectorAll(
      ".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value",
    ),
  ).map((tick: Element): string => {
    return (tick.textContent || "").trim();
  });
}

// The y of each point a path draws through, top of the chart at 0.
function pathYs(path: Element | null): Array<number> {
  const numbers: Array<number> = (
    (path?.getAttribute("d") || "").match(/-?\d+(\.\d+)?/g) || []
  ).map(Number);

  return numbers.filter((_value: number, index: number): boolean => {
    return index % 2 === 1;
  });
}

function spanOf(ys: Array<number>): number {
  return ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0;
}

// A line's curve by its category.
function curveOf(container: HTMLElement, category: string): Element | null {
  return container.querySelector(
    `path.recharts-line-curve[name="${category}"]:not([stroke="transparent"])`,
  );
}

describe("the line chart draws a scale of its own", () => {
  test("no third axis is drawn, and every line keeps its shape over its own scale", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory", "latency"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        ownScales={[LATENCY_ON_ITS_OWN]}
        showLegend={false}
      />,
    );

    expect(drawnValueAxes(container)).toBe(2);
    // No tick is written in the own scale's unit.
    for (const tick of valueTicks(container)) {
      expect(tick).not.toMatch(/ms$/);
    }
    for (const category of ["cpu", "memory", "latency"]) {
      expect(spanOf(pathYs(curveOf(container, category)))).toBeGreaterThan(30);
    }
  });

  test("before: drawn against the first axis, the latency stretched it past its percent", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory", "latency"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    );

    const leftTicks: Array<number> = valueTicks(container)
      .filter((tick: string): boolean => {
        return tick.endsWith("%");
      })
      .map((tick: string): number => {
        return Number(tick.replace("%", ""));
      });

    expect(Math.max(...leftTicks)).toBeGreaterThanOrEqual(240);
  });

  test("with a scale of its own, the first axis keeps to its own series' values", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory", "latency"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        ownScales={[LATENCY_ON_ITS_OWN]}
        showLegend={false}
      />,
    );

    const leftTicks: Array<number> = valueTicks(container)
      .filter((tick: string): boolean => {
        return tick.endsWith("%");
      })
      .map((tick: string): number => {
        return Number(tick.replace("%", ""));
      });

    expect(Math.max(...leftTicks)).toBeLessThanOrEqual(70);
  });

  test("a reference line meant for the scale is drawn to it, and neither axis takes it in", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory", "latency"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        ownScales={[LATENCY_ON_ITS_OWN]}
        showLegend={false}
        referenceLines={[
          {
            value: 900,
            color: "#ef4444",
            label: "Warning: 900 ms",
            ownScaleId: "latency",
            extendsDomain: true,
          },
        ]}
      />,
    );

    expect(container).toHaveTextContent("Warning: 900 ms");
    for (const tick of valueTicks(container)) {
      expect(tick).not.toMatch(/^(900|1000)/);
    }
  });

  test("a series hidden from the chart keeps no room: a scale draws nothing that is not there", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu"]}
        valueFormatter={percent}
        ownScales={[{ ...LATENCY_ON_ITS_OWN, categories: [] }]}
        showLegend={false}
      />,
    );

    expect(drawnValueAxes(container)).toBe(1);
    expect(curveOf(container, "latency")).toBeNull();
  });
});

describe("the area and bar charts draw it too", () => {
  test("the area chart: two axes drawn, the latency's area on its own scale", () => {
    const { container } = render(
      <AreaChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory", "latency"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        ownScales={[LATENCY_ON_ITS_OWN]}
        showLegend={false}
      />,
    );

    expect(drawnValueAxes(container)).toBe(2);
    for (const tick of valueTicks(container)) {
      expect(tick).not.toMatch(/ms$/);
    }
  });

  test("the bar chart: its bars stack only with bars on their own scale", () => {
    const { container } = render(
      <BarChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory", "latency"]}
        type="stacked"
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        ownScales={[LATENCY_ON_ITS_OWN]}
        showLegend={false}
      />,
    );

    expect(drawnValueAxes(container)).toBe(2);
    // The percent axis reaches the percent bars alone, never 240 ms on them.
    const leftTicks: Array<number> = valueTicks(container)
      .filter((tick: string): boolean => {
        return tick.endsWith("%");
      })
      .map((tick: string): number => {
        return Number(tick.replace("%", ""));
      });

    expect(Math.max(...leftTicks)).toBeLessThanOrEqual(70);
  });

  test("a vertical bar chart draws no scale of its own, as it draws no second axis", () => {
    const { container } = render(
      <BarChart
        data={ROWS}
        index="time"
        categories={["cpu", "latency"]}
        layout="vertical"
        valueFormatter={percent}
        ownScales={[LATENCY_ON_ITS_OWN]}
        showLegend={false}
      />,
    );

    // No hidden own axis was asked of recharts.
    expect(container.innerHTML).not.toContain("own-scale-latency");
    // And the scale is never spread onto the chart's root as an attribute.
    expect(container.querySelector("[ownscales]")).toBeNull();
    expect(container.querySelector("[secondyaxis]")).toBeNull();
  });
});

describe("which axis a category and a mark are drawn against", () => {
  test("a category of a scale of its own is drawn to it, before any second axis", () => {
    expect(
      getCategoryYAxisProps("latency", MEMORY_ON_THE_RIGHT, [
        LATENCY_ON_ITS_OWN,
      ]),
    ).toEqual({ yAxisId: getOwnScaleYAxisId("latency") });
    expect(
      getCategoryYAxisProps("memory", MEMORY_ON_THE_RIGHT, [
        LATENCY_ON_ITS_OWN,
      ]),
    ).toEqual({ yAxisId: SECOND_Y_AXIS_ID });
    expect(
      getCategoryYAxisProps("cpu", MEMORY_ON_THE_RIGHT, [LATENCY_ON_ITS_OWN]),
    ).toEqual({});
    expect(getCategoryOwnScale("latency", [LATENCY_ON_ITS_OWN])).toBe(
      LATENCY_ON_ITS_OWN,
    );
    expect(getCategoryOwnScale("cpu", undefined)).toBeUndefined();
  });

  test("a mark names its scale, and is drawn to it only while the chart draws it", () => {
    expect(
      getMarkYAxisProps(undefined, undefined, "latency", [LATENCY_ON_ITS_OWN]),
    ).toEqual({ yAxisId: getOwnScaleYAxisId("latency") });
    // A scale the chart does not draw: the mark falls back as it always did.
    expect(getMarkYAxisProps(undefined, undefined, "latency", [])).toEqual({});
    expect(
      getMarkYAxisProps(true, MEMORY_ON_THE_RIGHT, "gone", [
        LATENCY_ON_ITS_OWN,
      ]),
    ).toEqual({ yAxisId: SECOND_Y_AXIS_ID });
  });

  test("the tooltip writes a scale's series with its formatter, unless the series asks otherwise", () => {
    expect(
      getCategoryValueFormatter({
        category: "latency",
        valueFormatter: percent,
        secondYAxis: MEMORY_ON_THE_RIGHT,
        ownScales: [LATENCY_ON_ITS_OWN],
      })(120),
    ).toBe("120 ms");
    expect(
      getCategoryValueFormatter({
        category: "latency",
        valueFormatter: percent,
        ownScales: [LATENCY_ON_ITS_OWN],
        categoryValueFormatters: {
          latency: (value: number): string => {
            return `${value} own`;
          },
        },
      })(120),
    ).toBe("120 own");
  });
});

describe("the wrappers' value axes and scales of their own", () => {
  const percentAxis: YAxis = {
    legend: "%",
    options: {
      type: YAxisType.Number,
      min: "auto",
      max: "auto",
      formatter: percent,
      precision: YAxisPrecision.NoDecimals,
    },
  };
  const bytesAxis: SecondYAxis = {
    ...percentAxis,
    legend: "By",
    options: { ...percentAxis.options, formatter: gigabytes },
    seriesNames: ["memory"],
  };
  const latencyScale: OwnScaleYAxis = {
    ...percentAxis,
    legend: "ms",
    id: "latency",
    options: { ...percentAxis.options, formatter: milliseconds, min: 0 },
    seriesNames: ["latency", "latency (previous)"],
  };

  function series(name: string, values: Array<number>): SeriesPoint {
    return {
      seriesName: name,
      data: values.map((value: number, index: number) => {
        return { x: new Date(Date.UTC(2026, 10, 19, 10, index)), y: value };
      }),
    };
  }

  test("each scale names the series of its that are drawn, its formatter and its domain", () => {
    const axes: ChartValueAxes = getChartValueAxes({
      data: [
        series("cpu", [20, 60]),
        series("memory", [4e9, 5e9]),
        series("latency", [120, 2400000]),
      ],
      yAxis: percentAxis,
      secondYAxis: bytesAxis,
      ownScaleYAxes: [latencyScale],
    });

    expect(axes.ownScales).toEqual([
      {
        id: "latency",
        categories: ["latency"],
        valueFormatter: milliseconds,
        autoMinValue: false,
        minValue: 0,
        maxValue: undefined,
      },
    ]);
    expect(axes.secondYAxis?.categories).toEqual(["memory"]);
  });

  test("the first axis is measured over its own series, never a scale's", () => {
    const withLatency: ChartValueAxes = getChartValueAxes({
      data: [series("cpu", [20, 60]), series("latency", [120, 2400000])],
      yAxis: percentAxis,
      ownScaleYAxes: [latencyScale],
    });
    const cpuAlone: ChartValueAxes = getChartValueAxes({
      data: [series("cpu", [20, 60])],
      yAxis: percentAxis,
    });

    expect(withLatency.firstYAxisWidthInPx).toBe(cpuAlone.firstYAxisWidthInPx);
  });

  test("no scales: none", () => {
    expect(
      getChartValueAxes({
        data: [series("cpu", [20, 60])],
        yAxis: percentAxis,
      }).ownScales,
    ).toEqual([]);
  });
});
