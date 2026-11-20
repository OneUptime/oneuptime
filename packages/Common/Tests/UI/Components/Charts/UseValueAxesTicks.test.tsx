import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, renderHook } from "@testing-library/react";
import * as React from "react";
import ValueFormatter from "../../../../Utils/ValueFormatter";
import {
  ValueAxisFormatter,
  ValueAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import {
  ChartSecondYAxis,
  SECOND_Y_AXIS_ID,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/SecondYAxis";
import {
  ChartValueAxesPlan,
  useValueAxesTicks,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/UseValueAxesTicks";

/*
 * THE VALUE AXES' TICKS AND TICK FORMATTERS STAY THE SAME OBJECTS WHILE WHAT
 * THEY ARE WORKED OUT FROM STAYS (issue #10079).
 *
 * recharts reads a value axis again whenever its ticks or its tick formatter
 * are new objects. Before the axes were stepped, a chart handed recharts its
 * host's own formatter, the same function at every drawing. A chart now hands
 * it the ticks and the tick formatter useValueAxesTicks works out: they too
 * stay the same objects while the ticks are the same numbers and the axis's
 * formatter and step stay: when the chart is drawn again because its legend
 * was hovered, and when its host draws it again with new arrays holding the
 * same values. A new formatter, or values or an end of an axis that give new
 * ticks, give new ones.
 */

// Every axis recharts is handed, as it is handed it, in order.
const axesHanded: Array<{
  kind: "XAxis" | "YAxis";
  props: Record<string, unknown>;
}> = [];

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  const react: typeof React = jest.requireActual("react") as typeof React;
  const RealXAxis: React.ComponentType<Record<string, unknown>> = actual[
    "XAxis"
  ] as React.ComponentType<Record<string, unknown>>;
  const RealYAxis: React.ComponentType<Record<string, unknown>> = actual[
    "YAxis"
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
    XAxis: (props: Record<string, unknown>): React.ReactElement => {
      axesHanded.push({ kind: "XAxis", props: props });
      return react.createElement(RealXAxis, props);
    },
    YAxis: (props: Record<string, unknown>): React.ReactElement => {
      axesHanded.push({ kind: "YAxis", props: props });
      return react.createElement(RealYAxis, props);
    },
  };
});

import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import { CHART_DATA_POINT_X_AXIS_KEY } from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";

afterEach(() => {
  cleanup();
  axesHanded.length = 0;
});

type AxesInput = Parameters<typeof useValueAxesTicks>[0];

// As recharts calls a tick formatter: with the tick's index after its value.
type RechartsTickFormatter = (value: number, index: number) => string;

function unitFormatter(unit: string): ValueAxisFormatter {
  return (value: number, precision?: ValueAxisPrecision): string => {
    return ValueFormatter.formatValue(value, unit, {
      step: precision?.step,
    });
  };
}

const BYTES: ValueAxisFormatter = unitFormatter("By");
const PERCENT: ValueAxisFormatter = unitFormatter("%");

// A filesystem at 17.2 GB, give or take a few megabytes: its axis is stepped.
const FILESYSTEM: Array<number> = [
  17.2013e9, 17.2021e9, 17.2034e9, 17.2047e9, 17.2039e9, 17.2026e9,
];
// A CPU that holds still around 91.25%: its axis is stepped too.
const STILL_CPU_PERCENT: Array<number> = [
  91.251, 91.2525, 91.254, 91.2515, 91.253, 91.252,
];
// A load from 12% to 64%: an axis that reads apart already.
const WIDE_PERCENT: Array<number> = [12, 30, 64, 41, 22, 50];

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
    const row: Record<string, number | string> = {
      [CHART_DATA_POINT_X_AXIS_KEY]: `10:${String(index).padStart(2, "0")}`,
    };

    for (const [name, values] of Object.entries(series)) {
      row[name] = values[index] as number;
    }

    rows.push(row);
  }

  return rows;
}

const ROWS: Array<Record<string, number | string>> = rowsOf({
  used: FILESYSTEM,
  cpu: STILL_CPU_PERCENT,
});
const CATEGORIES: Array<string> = ["used", "cpu"];
const CPU_ON_THE_RIGHT: ChartSecondYAxis = {
  categories: ["cpu"],
  valueFormatter: PERCENT,
  width: 56,
  autoMinValue: true,
};

/*
 * What a chart hands the hook at a drawing: the same rows, categories,
 * formatter and second axis as the drawing before, and its axes' ends as
 * new arrays holding the same ends, as getYAxisDomain writes them.
 */
function inputAt(overrides: Partial<AxesInput> = {}): AxesInput {
  return {
    data: ROWS,
    categories: CATEGORIES,
    secondYAxis: CPU_ON_THE_RIGHT,
    referenceLines: undefined,
    firstDomain: ["auto", "auto"],
    secondDomain: ["auto", "auto"],
    allowDecimals: true,
    valueFormatter: BYTES,
    yAxisWidth: 56,
    ...overrides,
  };
}

function drawPlan(initialInput: AxesInput): {
  plan: () => ChartValueAxesPlan;
  drawAgain: (input: AxesInput) => void;
} {
  const { result, rerender } = renderHook(
    (input: AxesInput): ChartValueAxesPlan => {
      return useValueAxesTicks(input);
    },
    { initialProps: initialInput },
  );

  return {
    plan: (): ChartValueAxesPlan => {
      return result.current;
    },
    drawAgain: (input: AxesInput): void => {
      rerender(input);
    },
  };
}

describe("the plan, drawn again over the same values", () => {
  test("a stepped axis keeps its ticks and its tick formatter, on either side", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();

    // Both axes are stepped: their default ticks would read alike.
    expect(before.first.ticks.precision).toBeDefined();
    expect(before.second?.ticks.precision).toBeDefined();

    drawAgain(inputAt());
    drawAgain(inputAt());

    const after: ChartValueAxesPlan = plan();

    expect(after.first.ticks.ticks).toBe(before.first.ticks.ticks);
    expect(after.first.tickFormatter).toBe(before.first.tickFormatter);
    expect(after.first.width).toBe(before.first.width);
    expect(after.second?.ticks.ticks).toBe(before.second?.ticks.ticks);
    expect(after.second?.tickFormatter).toBe(before.second?.tickFormatter);
    expect(after.second?.width).toBe(before.second?.width);
  });

  test("a host that hands new arrays holding the same values: the same ticks and tick formatters", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();

    drawAgain(
      inputAt({
        data: ROWS.map(
          (
            row: Record<string, number | string>,
          ): Record<string, number | string> => {
            return { ...row };
          },
        ),
        categories: [...CATEGORIES],
        secondYAxis: { ...CPU_ON_THE_RIGHT },
      }),
    );

    expect(plan().first.ticks.ticks).toBe(before.first.ticks.ticks);
    expect(plan().first.tickFormatter).toBe(before.first.tickFormatter);
    expect(plan().second?.ticks.ticks).toBe(before.second?.ticks.ticks);
    expect(plan().second?.tickFormatter).toBe(before.second?.tickFormatter);
  });

  test("new values that give the same ticks: the ticks handed before", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();
    // One value moves by 100 kB, inside the axis's ticks.
    const nudged: Array<number> = [...FILESYSTEM];

    nudged[2] = (nudged[2] as number) + 1e5;
    drawAgain(
      inputAt({ data: rowsOf({ used: nudged, cpu: STILL_CPU_PERCENT }) }),
    );

    expect(plan().first.ticks.ticks).toEqual(before.first.ticks.ticks);
    expect(plan().first.ticks.ticks).toBe(before.first.ticks.ticks);
    expect(plan().first.tickFormatter).toBe(before.first.tickFormatter);
  });

  test("an axis that reads apart already keeps the one tick formatter", () => {
    const rows: Array<Record<string, number | string>> = rowsOf({
      load: WIDE_PERCENT,
    });
    const { plan, drawAgain } = drawPlan(
      inputAt({
        data: rows,
        categories: ["load"],
        secondYAxis: undefined,
        valueFormatter: PERCENT,
        firstDomain: [0, "auto"],
      }),
    );
    const before: ChartValueAxesPlan = plan();

    expect(before.first.ticks.precision).toBeUndefined();
    expect(before.first.ticks.ticks).toBeUndefined();
    expect(before.second).toBeUndefined();

    drawAgain(
      inputAt({
        data: rows,
        categories: ["load"],
        secondYAxis: undefined,
        valueFormatter: PERCENT,
        firstDomain: [0, "auto"],
      }),
    );

    expect(plan().first.tickFormatter).toBe(before.first.tickFormatter);
    expect(plan().first.ticks.ticks).toBeUndefined();
  });

  test("the tick formatter hands the host's formatter the step, never recharts' tick index", () => {
    const calls: Array<Array<unknown>> = [];
    const recording: ValueAxisFormatter = (
      ...args: [number, ValueAxisPrecision?]
    ): string => {
      calls.push(args);
      return BYTES(...args);
    };
    const stepped: ChartValueAxesPlan = drawPlan(
      inputAt({ valueFormatter: recording, secondYAxis: undefined }),
    ).plan();

    calls.length = 0;
    (stepped.first.tickFormatter as unknown as RechartsTickFormatter)(
      17.202e9,
      3,
    );
    expect(calls).toEqual([[17.202e9, stepped.first.ticks.precision]]);

    const apart: ChartValueAxesPlan = drawPlan(
      inputAt({
        data: rowsOf({ load: WIDE_PERCENT }),
        categories: ["load"],
        valueFormatter: recording,
        secondYAxis: undefined,
        firstDomain: [0, "auto"],
      }),
    ).plan();

    calls.length = 0;
    (apart.first.tickFormatter as unknown as RechartsTickFormatter)(30, 2);
    expect(calls).toEqual([[30]]);
  });
});

describe("the plan, worked out again when what it is worked out from changes", () => {
  test("a new formatter: a new tick formatter, which writes with it", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();
    const inGigabytes: ValueAxisFormatter = (
      value: number,
      precision?: ValueAxisPrecision,
    ): string => {
      return `${BYTES(value, precision)} (new)`;
    };

    drawAgain(inputAt({ valueFormatter: inGigabytes }));

    expect(plan().first.tickFormatter).not.toBe(before.first.tickFormatter);
    expect(plan().first.tickFormatter(17.202e9)).toMatch(/ \(new\)$/);
    expect(before.first.tickFormatter(17.202e9)).not.toMatch(/ \(new\)$/);
  });

  test("new values: new ticks, over the new values", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();
    const moved: Array<Record<string, number | string>> = rowsOf({
      used: FILESYSTEM.map((value: number): number => {
        return value + 1e9;
      }),
      cpu: STILL_CPU_PERCENT,
    });

    drawAgain(inputAt({ data: moved }));

    const ticks: Array<number> = plan().first.ticks.ticks || [];

    expect(plan().first.ticks.ticks).not.toBe(before.first.ticks.ticks);
    expect(ticks.length).toBeGreaterThan(2);
    expect(Math.min(...ticks)).toBeGreaterThan(18e9);
  });

  test("a new end of the first axis: worked out from it", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();

    // From zero, the filesystem's axis reads 0 to 20 GB: apart already.
    drawAgain(inputAt({ firstDomain: [0, "auto"] }));

    expect(plan().first.ticks.ticks).toBeUndefined();
    expect(plan().first.ticks.precision).toBeUndefined();
    expect(plan().first.tickFormatter).not.toBe(before.first.tickFormatter);
  });

  test("a new end of the second axis, or its formatter: the second axis is worked out again", () => {
    const { plan, drawAgain } = drawPlan(inputAt());
    const before: ChartValueAxesPlan = plan();

    drawAgain(inputAt({ secondDomain: [0, "auto"] }));

    expect(plan().second?.ticks.ticks).toBeUndefined();
    expect(plan().second?.ticks.precision).toBeUndefined();
    expect(plan().second?.tickFormatter).not.toBe(before.second?.tickFormatter);
    // The first axis, whose ends and formatter stay, is handed as before.
    expect(plan().first.ticks.ticks).toBe(before.first.ticks.ticks);
    expect(plan().first.tickFormatter).toBe(before.first.tickFormatter);

    drawAgain(
      inputAt({
        secondYAxis: {
          ...CPU_ON_THE_RIGHT,
          valueFormatter: unitFormatter("%"),
        },
      }),
    );

    expect(plan().second?.tickFormatter).not.toBe(before.second?.tickFormatter);
    expect(plan().second?.ticks.precision).toEqual(
      before.second?.ticks.precision,
    );
  });
});

/*
 * The charts, drawn again with the same props: every value axis recharts is
 * handed carries the same ticks and tick formatter as at the drawing before.
 */
type ChartComponent = React.ComponentType<Record<string, unknown>>;

interface DrawnChart {
  name: string;
  chart: ChartComponent;
  props: Record<string, unknown>;
  // Which axis of the chart reads its values, and whether it is stepped.
  valueAxis: "XAxis" | "YAxis";
  isStepped: boolean;
  hasSecondAxis: boolean;
}

const COMMON_PROPS: Record<string, unknown> = {
  data: ROWS,
  index: CHART_DATA_POINT_X_AXIS_KEY,
  categories: CATEGORIES,
  valueFormatter: BYTES,
  autoMinValue: true,
  secondYAxis: CPU_ON_THE_RIGHT,
  showLegend: false,
};

const CHARTS: Array<DrawnChart> = [
  {
    name: "the line chart",
    chart: LineChart as unknown as ChartComponent,
    props: COMMON_PROPS,
    valueAxis: "YAxis",
    isStepped: true,
    hasSecondAxis: true,
  },
  {
    name: "the area chart",
    chart: AreaChart as unknown as ChartComponent,
    props: COMMON_PROPS,
    valueAxis: "YAxis",
    isStepped: true,
    hasSecondAxis: true,
  },
  {
    name: "the bar chart",
    chart: BarChart as unknown as ChartComponent,
    props: COMMON_PROPS,
    valueAxis: "YAxis",
    isStepped: true,
    hasSecondAxis: true,
  },
  {
    name: "the vertical bar chart, whose values run along its bottom",
    chart: BarChart as unknown as ChartComponent,
    props: {
      ...COMMON_PROPS,
      layout: "vertical",
      secondYAxis: undefined,
    },
    valueAxis: "XAxis",
    isStepped: false,
    hasSecondAxis: false,
  },
];

// The props recharts was last handed for an axis.
function lastHanded(
  kind: "XAxis" | "YAxis",
  yAxisId: string | undefined,
): Record<string, unknown> | undefined {
  for (let index: number = axesHanded.length - 1; index >= 0; index--) {
    const handed: { kind: "XAxis" | "YAxis"; props: Record<string, unknown> } =
      axesHanded[index]!;

    if (handed.kind === kind && handed.props["yAxisId"] === yAxisId) {
      return handed.props;
    }
  }

  return undefined;
}

describe("the charts, drawn again with the same props", () => {
  test.each(CHARTS)(
    "$name hands recharts the same value axes",
    ({ chart, props, valueAxis, isStepped, hasSecondAxis }: DrawnChart) => {
      const { rerender } = render(React.createElement(chart, props));
      const first: Record<string, unknown> | undefined = lastHanded(
        valueAxis,
        undefined,
      );
      const second: Record<string, unknown> | undefined = lastHanded(
        "YAxis",
        SECOND_Y_AXIS_ID,
      );
      const handedBefore: number = axesHanded.length;

      expect(first).toBeDefined();
      expect(typeof first?.["tickFormatter"]).toBe("function");
      expect(Array.isArray(first?.["ticks"])).toBe(isStepped);
      expect(second !== undefined).toBe(hasSecondAxis);

      // Drawn again as it was, then with new arrays holding the same values.
      const drawings: Array<Record<string, unknown>> = [
        { ...props },
        {
          ...props,
          data: ROWS.map(
            (
              row: Record<string, number | string>,
            ): Record<string, number | string> => {
              return { ...row };
            },
          ),
          categories: [...CATEGORIES],
          secondYAxis: props["secondYAxis"]
            ? { ...(props["secondYAxis"] as ChartSecondYAxis) }
            : undefined,
        },
      ];

      for (const drawing of drawings) {
        rerender(React.createElement(chart, drawing));

        // The chart was drawn again, and handed recharts its axes again.
        expect(axesHanded.length).toBeGreaterThan(handedBefore);

        const firstAgain: Record<string, unknown> | undefined = lastHanded(
          valueAxis,
          undefined,
        );

        expect(firstAgain).not.toBe(first);
        expect(firstAgain?.["tickFormatter"]).toBe(first?.["tickFormatter"]);
        expect(firstAgain?.["ticks"]).toBe(first?.["ticks"]);
        expect(firstAgain?.["domain"]).toEqual(first?.["domain"]);

        if (hasSecondAxis) {
          const secondAgain: Record<string, unknown> | undefined = lastHanded(
            "YAxis",
            SECOND_Y_AXIS_ID,
          );

          expect(secondAgain?.["tickFormatter"]).toBe(
            second?.["tickFormatter"],
          );
          expect(secondAgain?.["ticks"]).toBe(second?.["ticks"]);
        }
      }
    },
  );

  test("the vertical bar chart's value axis writes with the host's formatter, never with recharts' tick index", () => {
    const calls: Array<Array<unknown>> = [];
    const recording: ValueAxisFormatter = (
      ...args: [number, ValueAxisPrecision?]
    ): string => {
      calls.push(args);
      return BYTES(...args);
    };

    render(
      React.createElement(BarChart as unknown as ChartComponent, {
        ...COMMON_PROPS,
        layout: "vertical",
        secondYAxis: undefined,
        valueFormatter: recording,
      }),
    );

    const tickFormatter: RechartsTickFormatter = lastHanded(
      "XAxis",
      undefined,
    )?.["tickFormatter"] as RechartsTickFormatter;

    calls.length = 0;
    tickFormatter(17.2e9, 4);
    expect(calls).toEqual([[17.2e9]]);
  });

  test("a host that hands a new formatter has its axis written with it", () => {
    const { rerender } = render(
      React.createElement(LineChart as unknown as ChartComponent, COMMON_PROPS),
    );
    const before: Record<string, unknown> | undefined = lastHanded(
      "YAxis",
      undefined,
    );
    const marked: ValueAxisFormatter = (
      value: number,
      precision?: ValueAxisPrecision,
    ): string => {
      return `${BYTES(value, precision)} (new)`;
    };

    rerender(
      React.createElement(LineChart as unknown as ChartComponent, {
        ...COMMON_PROPS,
        valueFormatter: marked,
      }),
    );

    const after: Record<string, unknown> | undefined = lastHanded(
      "YAxis",
      undefined,
    );

    expect(after?.["tickFormatter"]).not.toBe(before?.["tickFormatter"]);
    expect(
      (after?.["tickFormatter"] as (value: number) => string)(17.202e9),
    ).toMatch(/ \(new\)$/);
  });
});
