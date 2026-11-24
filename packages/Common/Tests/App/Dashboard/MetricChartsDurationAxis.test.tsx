import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #10118: A METRIC CHART TELLS ITS DURATION AXES THEIR UNIT OF TIME.
 *
 * A metric in seconds, milliseconds, microseconds, nanoseconds or minutes
 * is a span of time. The chart names its unit on the axis it is drawn
 * against (YAxisOptions' durationUnitInSeconds), on the left or on the
 * right, so the axis steps in natural units of time, and writes each tick
 * with the axis's step and largest tick (ValueFormatter's step and
 * largestTick), so it reads "1 h 30 min" or "1:30:02", never "1.5003
 * hours". A formula in a unit of time does the same. An axis in any other
 * unit, or one a page writes with its own formatter, names none.
 *
 * The real MetricCharts builds the charts; ChartGroup is stood in for by
 * one that keeps what it was handed.
 */

const chartGroupMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/ChartGroup/ChartGroup", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Charts/ChartGroup/ChartGroup",
  ) as Record<string, unknown>;
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    ...actual,
    __esModule: true,
    default: (props: { charts: Array<unknown> }): React.ReactElement => {
      chartGroupMock(props);
      return react.createElement("div", { "data-testid": "chart-group" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchExemplars: () => {
          return Promise.resolve([]);
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
      },
    };
  },
);

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { Chart } from "../../../UI/Components/Charts/ChartGroup/ChartGroup";
import YAxis, {
  SecondYAxis,
} from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import { NBSP } from "../../Helpers/AxisTickLabels";

const WINDOW_START: Date = new Date("2026-11-18T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-18T11:00:00.000Z");

afterEach(() => {
  cleanup();
  chartGroupMock.mockClear();
});

function query(
  variable: string,
  metricName: string,
  unit: string,
  options: {
    overlay?: boolean;
    yAxisValueFormatter?: (value: number) => string;
  } = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: metricName,
      description: undefined,
      legend: metricName,
      legendUnit: unit,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    chartType: MetricChartType.LINE,
    ...(options.overlay ? { overlayWithPreviousQuery: true } : {}),
    ...(options.yAxisValueFormatter
      ? { yAxisValueFormatter: options.yAxisValueFormatter }
      : {}),
  } as MetricQueryConfigData;
}

function resultOf(values: Array<number>): AggregatedResult {
  return {
    data: values.map((value: number, step: number) => {
      return {
        timestamp: new Date(WINDOW_START.getTime() + step * 10 * 60 * 1000),
        value: value,
      };
    }),
    truncated: false,
  } as unknown as AggregatedResult;
}

async function drawCharts(
  queryConfigs: Array<MetricQueryConfigData>,
  results: Array<AggregatedResult>,
  formulaConfigs: Array<MetricFormulaConfigData> = [],
): Promise<Array<Chart>> {
  const metricViewData: MetricViewData = {
    queryConfigs: queryConfigs,
    formulaConfigs: formulaConfigs,
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  };

  render(
    <MetricCharts
      metricViewData={metricViewData}
      metricResults={results}
      metricTypes={[]}
    />,
  );

  await act(async () => {
    await Promise.resolve();
  });

  const calls: Array<Array<unknown>> = chartGroupMock.mock.calls;

  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { charts: Array<Chart> }).charts;
}

function firstAxisOf(chart: Chart): YAxis {
  return (chart.props as unknown as { yAxis: YAxis }).yAxis;
}

function secondAxisOf(chart: Chart): SecondYAxis | undefined {
  return (chart.props as unknown as { secondYAxis?: SecondYAxis }).secondYAxis;
}

// A label as it is drawn: every space a no-break one.
function nb(text: string): string {
  return text.replace(/ /g, NBSP);
}

const JOB: Array<number> = [900, 2400, 4000, 7000, 5200, 3100];

describe("a query in a unit of time names it on its axis", () => {
  test.each([
    ["s", 1],
    ["seconds", 1],
    ["ms", 0.001],
    ["us", 0.000001],
    ["ns", 0.000000001],
    ["min", 60],
  ])("%s: %s seconds a value", async (unit: string, inSeconds: number) => {
    const [chart] = await drawCharts(
      [query("a", "batch.job.duration", unit)],
      [resultOf(JOB)],
    );

    expect(firstAxisOf(chart!).options.durationUnitInSeconds).toBe(inSeconds);
  });

  test.each(["By", "%", "1", "{requests}", "ms/s", "Cel"])(
    "%s: no unit of time, round decimal steps",
    async (unit: string) => {
      const [chart] = await drawCharts(
        [query("a", "some.metric", unit)],
        [resultOf(JOB)],
      );

      expect(firstAxisOf(chart!).options.durationUnitInSeconds).toBeUndefined();
    },
  );

  test("a page that writes its query's figures itself names none", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "batch.job.duration", "s", {
          yAxisValueFormatter: (value: number): string => {
            return `${value} s`;
          },
        }),
      ],
      [resultOf(JOB)],
    );

    expect(firstAxisOf(chart!).options.durationUnitInSeconds).toBeUndefined();
  });
});

describe("the axis writes its ticks with its step and its largest tick", () => {
  test("in units of time: 1 h 30 min on an axis stepping half an hour", async () => {
    const [chart] = await drawCharts(
      [query("a", "batch.job.duration", "s")],
      [resultOf(JOB)],
    );
    const formatter: YAxis["options"]["formatter"] = firstAxisOf(chart!).options
      .formatter;

    expect(formatter(5400, { step: 1800, largestTick: 7200 })).toBe(
      nb("1 h 30 min"),
    );
    // The issue's job: a second's step near an hour and a half.
    expect(formatter(5401, { step: 1, largestTick: 5402 })).toBe("1:30:01");
    // Every tick of an axis that reaches an hour, those under it too.
    expect(formatter(3599, { step: 1, largestTick: 3602 })).toBe("0:59:59");
    // Without a step, as it always read.
    expect(formatter(5400)).toBe(`1.5${NBSP}hours`);
  });

  test("milliseconds: a clock past an hour, ms under a second", async () => {
    const [chart] = await drawCharts(
      [query("a", "http.server.request.duration", "ms")],
      [resultOf([120, 480, 900])],
    );
    const formatter: YAxis["options"]["formatter"] = firstAxisOf(chart!).options
      .formatter;

    expect(formatter(250, { step: 250, largestTick: 1000 })).toBe(nb("250 ms"));
    expect(formatter(5401000, { step: 1000, largestTick: 5402000 })).toBe(
      "1:30:01",
    );
  });
});

describe("overlaid queries: each axis in its own unit of time", () => {
  test("percent on the left, seconds on the right: only the right names a unit of time", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "system.cpu.utilization", "1"),
        query("b", "batch.job.duration", "s", { overlay: true }),
      ],
      [resultOf([0.2, 0.4, 0.6]), resultOf(JOB)],
    );
    const second: SecondYAxis | undefined = secondAxisOf(chart!);

    expect(second).toBeDefined();
    expect(firstAxisOf(chart!).options.durationUnitInSeconds).toBeUndefined();
    expect(second!.options.durationUnitInSeconds).toBe(1);
    expect(
      second!.options.formatter(5400, { step: 1800, largestTick: 7200 }),
    ).toBe(nb("1 h 30 min"));
  });

  test("milliseconds overlaid on seconds share the left axis, in seconds", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "batch.job.duration", "s"),
        query("b", "batch.step.duration", "ms", { overlay: true }),
      ],
      [resultOf(JOB), resultOf([120000, 480000, 900000])],
    );

    expect(secondAxisOf(chart!)).toBeUndefined();
    expect(firstAxisOf(chart!).options.durationUnitInSeconds).toBe(1);
  });
});

describe("a formula in a unit of time", () => {
  test("names its unit of time on its axis, and writes its ticks in it", async () => {
    const formula: MetricFormulaConfigData = {
      metricAliasData: {
        metricVariable: "c",
        title: "Total",
        description: undefined,
        legend: "Total",
        legendUnit: "s",
      },
      metricFormulaData: {
        metricFormula: "a + b",
      },
    } as unknown as MetricFormulaConfigData;
    const charts: Array<Chart> = await drawCharts(
      [
        query("a", "batch.job.duration", "s"),
        query("b", "batch.step.duration", "s"),
      ],
      // The formula's result follows the queries' (Metrics.fetchResults).
      [resultOf(JOB), resultOf(JOB), resultOf([1800, 4800, 8000])],
      [formula],
    );
    const formulaChart: Chart | undefined = charts.find(
      (chart: Chart): boolean => {
        return chart.title === "Total";
      },
    );

    expect(formulaChart).toBeDefined();
    expect(firstAxisOf(formulaChart!).options.durationUnitInSeconds).toBe(1);
    expect(
      firstAxisOf(formulaChart!).options.formatter(5401, {
        step: 1,
        largestTick: 5402,
      }),
    ).toBe("1:30:01");
  });
});
