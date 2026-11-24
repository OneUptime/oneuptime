import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import {
  ChartSecondYAxis,
  SECOND_Y_AXIS_ID,
  getCategoryValueFormatter,
  getCategoryYAxisProps,
  getMarkYAxisProps,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/SecondYAxis";
import {
  ChartValueAxes,
  getChartValueAxes,
} from "../../../../UI/Components/Charts/Utils/ValueAxes";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import YAxis, {
  SecondYAxis,
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import {
  Y_AXIS_WIDTH_IN_PX,
  getYAxisWidthInPx,
} from "../../../../UI/Components/Charts/Utils/YAxisWidth";

/*
 * ISSUE #10042: A CHART'S SECOND VALUE AXIS, ON ITS RIGHT.
 *
 * The line, area and bar charts take a second value axis for the series it
 * names (SecondYAxis): drawn on the right, written with its own formatter,
 * as wide as its own ticks, over its own domain, each of its series' lines,
 * areas and bars drawn against it, and a reference line or an exemplar meant
 * for it drawn against it too. A chart with none draws exactly as before.
 * The tooltip writes each series' values as its axis writes its ticks, or as
 * the series asks. Here the chart library draws with recharts given a size.
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

import {
  LineChart,
  ChartTooltip as LineChartTooltip,
} from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import {
  AreaChart,
  ChartTooltip as AreaChartTooltip,
} from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import {
  BarChart,
  ChartTooltip as BarChartTooltip,
} from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";

const ROWS: Array<Record<string, number | string>> = [
  { time: "10:00", cpu: 20, memory: 4e9 },
  { time: "10:10", cpu: 60, memory: 5e9 },
  { time: "10:20", cpu: 40, memory: 4.5e9 },
];

const percent: (value: number) => string = (value: number): string => {
  return `${value}%`;
};

const gigabytes: (value: number) => string = (value: number): string => {
  return `${(value / 1e9).toFixed(1)} GB`;
};

const MEMORY_ON_THE_RIGHT: ChartSecondYAxis = {
  categories: ["memory"],
  valueFormatter: gigabytes,
  width: 72,
  autoMinValue: false,
};

afterEach(() => {
  cleanup();
});

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

describe("the line chart", () => {
  test("draws the second axis on the right, in its own unit, and each line against its axis", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    );

    const [left, right] = valueAxesIn(container);

    expect(valueAxesIn(container)).toHaveLength(2);
    expect(
      left!.every((tick: string): boolean => {
        return tick.endsWith("%");
      }),
    ).toBe(true);
    expect(
      right!.every((tick: string): boolean => {
        return tick.endsWith("GB");
      }),
    ).toBe(true);

    // Each line runs over its own axis: neither is flat.
    const curves: Array<Element> = Array.from(
      container.querySelectorAll("path.recharts-line-curve"),
    );

    expect(curves).toHaveLength(2);
    for (const curve of curves) {
      expect(spanOf(pathYs(curve))).toBeGreaterThan(30);
    }
  });

  test("with no second axis, every line is on the one axis, as before", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        valueFormatter={percent}
        showLegend={false}
      />,
    );

    expect(valueAxesIn(container)).toHaveLength(1);

    // The bytes dwarf the percent: on one axis, the percent line is flat.
    const curves: Array<Element> = Array.from(
      container.querySelectorAll("path.recharts-line-curve"),
    );
    const flattest: number = Math.min(
      ...curves.map((curve: Element): number => {
        return spanOf(pathYs(curve));
      }),
    );

    expect(flattest).toBeLessThan(1);
  });

  test("a reference line meant for the second axis is drawn against it", () => {
    const { container } = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
        referenceLines={[
          {
            value: 6e9,
            color: "#ef4444",
            label: "High memory",
            isOnSecondYAxis: true,
            extendsDomain: true,
          },
          { value: 50, color: "#f59e0b", label: "High CPU" },
        ]}
      />,
    );

    const [left, right] = valueAxesIn(container);

    // The right axis stretches to take its line in; the left stays percent.
    expect(
      right!.some((tick: string): boolean => {
        return tick === "6.0 GB";
      }),
    ).toBe(true);
    for (const tick of left!) {
      expect(Number(tick.replace("%", ""))).toBeLessThanOrEqual(100);
    }
    expect(container).toHaveTextContent("High memory");
    expect(container).toHaveTextContent("High CPU");
  });

  test("its series hidden from the chart, the second axis keeps its room: the plot does not move", () => {
    // The plot's horizontal grid line: where the plot starts and ends.
    const plotEdges: (container: HTMLElement) => Array<string | null> = (
      container: HTMLElement,
    ): Array<string | null> => {
      const line: Element | null = container.querySelector(
        ".recharts-cartesian-grid-horizontal line",
      );

      return [
        line?.getAttribute("x1") || null,
        line?.getAttribute("x2") || null,
      ];
    };

    const shown: Array<string | null> = plotEdges(
      render(
        <LineChart
          data={ROWS}
          index="time"
          categories={["cpu", "memory"]}
          valueFormatter={percent}
          secondYAxis={MEMORY_ON_THE_RIGHT}
          showLegend={false}
        />,
      ).container,
    );
    cleanup();

    const hidden: HTMLElement = render(
      <LineChart
        data={ROWS}
        index="time"
        categories={["cpu"]}
        valueFormatter={percent}
        secondYAxis={{ ...MEMORY_ON_THE_RIGHT, categories: [] }}
        showLegend={false}
      />,
    ).container;

    expect(shown.every(Boolean)).toBe(true);
    expect(plotEdges(hidden)).toEqual(shown);
    // With nothing drawn against it, it writes no ticks.
    expect(valueAxesIn(hidden)).toHaveLength(1);
  });
});

describe("the area chart", () => {
  test("draws the second axis on the right, and each area against its axis", () => {
    const { container } = render(
      <AreaChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    );

    const [left, right] = valueAxesIn(container);

    expect(valueAxesIn(container)).toHaveLength(2);
    expect(
      left!.every((tick: string): boolean => {
        return tick.endsWith("%");
      }),
    ).toBe(true);
    expect(
      right!.every((tick: string): boolean => {
        return tick.endsWith("GB");
      }),
    ).toBe(true);

    for (const curve of Array.from(
      container.querySelectorAll("path.recharts-area-curve"),
    )) {
      expect(spanOf(pathYs(curve))).toBeGreaterThan(30);
    }
  });
});

describe("the bar chart", () => {
  test("draws the second axis on the right for its bars", () => {
    const { container } = render(
      <BarChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    );

    const [left, right] = valueAxesIn(container);

    expect(valueAxesIn(container)).toHaveLength(2);
    expect(
      left!.every((tick: string): boolean => {
        return tick.endsWith("%");
      }),
    ).toBe(true);
    expect(
      right!.every((tick: string): boolean => {
        return tick.endsWith("GB");
      }),
    ).toBe(true);
  });

  test("stacked bars stack only with bars on their own axis", () => {
    const { container } = render(
      <BarChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        type="stacked"
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    );

    // Piled on one stack, the percent bars would be read in gigabytes.
    const [left] = valueAxesIn(container);

    expect(valueAxesIn(container)).toHaveLength(2);
    for (const tick of left!) {
      expect(Number(tick.replace("%", ""))).toBeLessThanOrEqual(100);
    }
  });

  test("a vertical chart, and a chart of shares, draw no second axis", () => {
    const vertical: HTMLElement = render(
      <BarChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        layout="vertical"
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    ).container;

    expect(vertical.querySelectorAll(".recharts-yAxis")).toHaveLength(1);
    cleanup();

    const shares: HTMLElement = render(
      <BarChart
        data={ROWS}
        index="time"
        categories={["cpu", "memory"]}
        type="percent"
        valueFormatter={percent}
        secondYAxis={MEMORY_ON_THE_RIGHT}
        showLegend={false}
      />,
    ).container;

    expect(valueAxesIn(shares)).toHaveLength(1);
  });
});

describe("the tooltip writes each series' value as its axis does", () => {
  const PAYLOAD: Array<Record<string, unknown>> = [
    {
      category: "cpu",
      value: 60,
      index: "10:10",
      color: "blue",
      payload: {},
    },
    {
      category: "memory",
      value: 5e9,
      index: "10:10",
      color: "emerald",
      payload: {},
    },
  ];

  test("in the line, area and bar charts' tooltips", () => {
    const formatOf: (category: string) => (value: number) => string = (
      category: string,
    ): ((value: number) => string) => {
      return getCategoryValueFormatter({
        category: category,
        valueFormatter: percent,
        secondYAxis: MEMORY_ON_THE_RIGHT,
      });
    };

    for (const Tooltip of [
      LineChartTooltip,
      AreaChartTooltip,
      BarChartTooltip,
    ] as unknown as Array<React.ComponentType<Record<string, unknown>>>) {
      const { container } = render(
        <Tooltip
          active={true}
          payload={PAYLOAD}
          label="10:10"
          valueFormatter={percent}
          categoryValueFormatter={formatOf}
        />,
      );

      expect(container).toHaveTextContent("60%");
      expect(container).toHaveTextContent("5.0 GB");
      expect(container).not.toHaveTextContent("5000000000%");
      cleanup();
    }
  });

  test("a tooltip handed no per-series way writes every value as before", () => {
    const { container } = render(
      <LineChartTooltip
        active={true}
        payload={PAYLOAD as never}
        label="10:10"
        valueFormatter={percent}
      />,
    );

    expect(container).toHaveTextContent("5000000000%");
  });
});

describe("which axis a category, a line or an exemplar is drawn against", () => {
  test("a category named by the second axis is on it; any other on the first", () => {
    expect(getCategoryYAxisProps("memory", MEMORY_ON_THE_RIGHT)).toEqual({
      yAxisId: SECOND_Y_AXIS_ID,
    });
    expect(getCategoryYAxisProps("cpu", MEMORY_ON_THE_RIGHT)).toEqual({});
    expect(getCategoryYAxisProps("memory", undefined)).toEqual({});
  });

  test("a mark meant for the second axis is on it only while the chart draws one", () => {
    expect(getMarkYAxisProps(true, MEMORY_ON_THE_RIGHT)).toEqual({
      yAxisId: SECOND_Y_AXIS_ID,
    });
    expect(getMarkYAxisProps(true, undefined)).toEqual({});
    expect(getMarkYAxisProps(false, MEMORY_ON_THE_RIGHT)).toEqual({});
    expect(getMarkYAxisProps(undefined, MEMORY_ON_THE_RIGHT)).toEqual({});
  });

  test("a series' own way of writing its values wins over its axis's", () => {
    const seconds: (value: number) => string = (value: number): string => {
      return `${value} s`;
    };

    expect(
      getCategoryValueFormatter({
        category: "latency",
        valueFormatter: percent,
        secondYAxis: MEMORY_ON_THE_RIGHT,
        categoryValueFormatters: { latency: seconds },
      })(3),
    ).toBe("3 s");
    expect(
      getCategoryValueFormatter({
        category: "memory",
        valueFormatter: percent,
        secondYAxis: MEMORY_ON_THE_RIGHT,
      })(2e9),
    ).toBe("2.0 GB");
    expect(
      getCategoryValueFormatter({
        category: "cpu",
        valueFormatter: percent,
        secondYAxis: MEMORY_ON_THE_RIGHT,
      })(5),
    ).toBe("5%");
  });
});

describe("the wrappers' two axes, each measured over its own series", () => {
  const SERIES: Array<SeriesPoint> = [
    {
      seriesName: "cpu",
      data: [
        { x: new Date(0), y: 20 },
        { x: new Date(1), y: 60 },
      ],
    },
    {
      seriesName: "memory",
      data: [
        { x: new Date(0), y: 4e9 },
        { x: new Date(1), y: 512e9 },
      ],
    },
  ];

  const FIRST: YAxis = {
    legend: "%",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: 100,
      formatter: percent,
      precision: YAxisPrecision.NoDecimals,
    },
  };

  const SECOND: SecondYAxis = {
    legend: "By",
    options: {
      type: YAxisType.Number,
      min: "auto",
      max: "auto",
      formatter: (value: number): string => {
        return `${(value / 1e9).toFixed(3)} gigabytes`;
      },
      precision: YAxisPrecision.NoDecimals,
    },
    seriesNames: ["memory"],
  };

  test("no second axis: the one axis is measured over every series, as before", () => {
    const axes: ChartValueAxes = getChartValueAxes({
      data: SERIES,
      yAxis: FIRST,
    });

    expect(axes.secondYAxis).toBeUndefined();
    expect(axes.firstYAxisWidthInPx).toBe(
      getYAxisWidthInPx({
        data: SERIES,
        formatter: percent,
        min: 0,
        max: 100,
      }),
    );
  });

  test("a second axis: the percent axis keeps its own width, and the bytes axis takes its own", () => {
    const axes: ChartValueAxes = getChartValueAxes({
      data: SERIES,
      yAxis: FIRST,
      secondYAxis: SECOND,
    });

    // The percent ticks are short: the axis keeps its 64 pixels.
    expect(axes.firstYAxisWidthInPx).toBe(Y_AXIS_WIDTH_IN_PX);
    expect(axes.secondYAxis).toEqual({
      categories: ["memory"],
      valueFormatter: SECOND.options.formatter,
      width: getYAxisWidthInPx({
        data: [SERIES[1]!],
        formatter: SECOND.options.formatter,
        min: "auto",
        max: "auto",
      }),
      autoMinValue: true,
      minValue: undefined,
      maxValue: undefined,
    });
    expect(axes.secondYAxis!.width).toBeGreaterThan(Y_AXIS_WIDTH_IN_PX);
  });

  test("a second axis whose series are all hidden is still drawn, with no category", () => {
    const axes: ChartValueAxes = getChartValueAxes({
      data: [SERIES[0]!],
      yAxis: FIRST,
      secondYAxis: SECOND,
    });

    expect(axes.secondYAxis?.categories).toEqual([]);
  });

  test("a second axis naming no series is none", () => {
    expect(
      getChartValueAxes({
        data: SERIES,
        yAxis: FIRST,
        secondYAxis: { ...SECOND, seriesNames: [] },
      }).secondYAxis,
    ).toBeUndefined();
  });

  test("a second axis's own bounds are its domain", () => {
    const axes: ChartValueAxes = getChartValueAxes({
      data: SERIES,
      yAxis: FIRST,
      secondYAxis: {
        ...SECOND,
        options: { ...SECOND.options, min: 0, max: 100 },
      },
    });

    expect(axes.secondYAxis).toMatchObject({
      autoMinValue: false,
      minValue: 0,
      maxValue: 100,
    });
  });
});
