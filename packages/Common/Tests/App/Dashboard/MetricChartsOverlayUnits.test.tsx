import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #9961: AN OVERLAID QUERY IS READ IN ITS CHART'S UNIT.
 *
 * A chart has one value axis, in its first query's unit. Each query's values
 * arrive in its own display unit, so a query in megabytes overlaid on a
 * chart in gigabytes drew a thousand times too high. MetricCharts now hands
 * each chart an overlaid query's values, its warning and critical lines, a
 * monitor rule's line on it and its previous-period line in the chart's
 * unit when the two units are of one kind, and leaves them as they are when
 * they are not, for the chart's warning to say.
 *
 * The real MetricCharts builds the charts; ChartGroup, which would draw
 * them, is stood in for by one that keeps what it was handed.
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
      return react.createElement(
        "div",
        { "data-testid": "chart-group" },
        (props.charts as Array<{ seriesControls?: React.ReactElement }>).map(
          (chart: { seriesControls?: React.ReactElement }, index: number) => {
            return react.createElement(
              "div",
              { key: index, "data-testid": "chart-group-chart" },
              chart.seriesControls || null,
            );
          },
        ),
      );
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
          return new Promise(() => {
            // Exemplars are not under test: they never arrive.
          });
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

import MetricCharts, {
  OVERLAY_UNIT_MISMATCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import { MetricChartThreshold } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricChartThresholds";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { Chart } from "../../../UI/Components/Charts/ChartGroup/ChartGroup";

const WINDOW_START: Date = new Date("2026-11-18T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-18T11:00:00.000Z");
const WINDOW_MS: number = WINDOW_END.getTime() - WINDOW_START.getTime();

function metricType(name: string, unit: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  type.unit = unit;
  return type;
}

interface QueryOptions {
  unit?: string | undefined;
  overlay?: boolean | undefined;
  warning?: number | undefined;
  critical?: number | undefined;
}

function query(
  variable: string,
  metricName: string,
  options: QueryOptions = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: metricName,
      description: undefined,
      legend: metricName,
      legendUnit: options.unit,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    chartType: MetricChartType.LINE,
    ...(options.overlay ? { overlayWithPreviousQuery: true } : {}),
    ...(options.warning !== undefined
      ? { warningThreshold: options.warning }
      : {}),
    ...(options.critical !== undefined
      ? { criticalThreshold: options.critical }
      : {}),
  } as MetricQueryConfigData;
}

function resultOf(
  values: Array<number>,
  offsetMs: number = 0,
): AggregatedResult {
  return {
    data: values.map((value: number, step: number) => {
      return {
        timestamp: new Date(
          WINDOW_START.getTime() + step * 10 * 60 * 1000 - offsetMs,
        ),
        value: value,
      };
    }),
    truncated: false,
  } as unknown as AggregatedResult;
}

function viewOf(queryConfigs: Array<MetricQueryConfigData>): MetricViewData {
  return {
    queryConfigs: queryConfigs,
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  };
}

interface DrawOptions {
  metricTypes?: Array<MetricType> | undefined;
  thresholds?: Array<MetricChartThreshold> | undefined;
  previous?: Array<AggregatedResult> | undefined;
}

function drawCharts(
  queryConfigs: Array<MetricQueryConfigData>,
  results: Array<AggregatedResult>,
  options: DrawOptions = {},
): Array<Chart> {
  render(
    <MetricCharts
      metricViewData={viewOf(queryConfigs)}
      metricResults={results}
      metricTypes={options.metricTypes || []}
      thresholds={options.thresholds}
      metricResultsPrevious={options.previous}
      compareOffsetMs={options.previous ? WINDOW_MS : undefined}
    />,
  );

  const calls: Array<Array<unknown>> = chartGroupMock.mock.calls;

  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { charts: Array<Chart> }).charts;
}

interface DrawnSeries {
  seriesName: string;
  data: Array<{ x: Date; y: number }>;
}

// Each series' values, by its name.
function valuesOf(chart: Chart): Record<string, Array<number>> {
  const values: Record<string, Array<number>> = {};

  for (const series of chart.props.data as Array<DrawnSeries>) {
    values[series.seriesName] = series.data.map(
      (point: { x: Date; y: number }): number => {
        return point.y;
      },
    );
  }

  return values;
}

function lineValuesOf(chart: Chart): Array<number> {
  return (chart.props.referenceLines || [])
    .map((line: { value: number }): number => {
      return line.value;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });
}

function expectClose(actual: Array<number>, expected: Array<number>): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value: number, index: number): void => {
    expect(value).toBeCloseTo(expected[index]!, 9);
  });
}

beforeEach(() => {
  chartGroupMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the same unit: drawn as fetched", () => {
  test("bytes overlaid on bytes keep their values", () => {
    const [chart, ...rest] = drawCharts(
      [
        query("a", "mem_used", { unit: "By" }),
        query("b", "mem_total", { unit: "By", overlay: true }),
      ],
      [resultOf([4e9, 5e9]), resultOf([8e9, 8e9])],
    );

    expect(rest).toHaveLength(0);
    expect(valuesOf(chart!)).toEqual({
      mem_used: [4e9, 5e9],
      mem_total: [8e9, 8e9],
    });
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("B beside By, two spellings of bytes, are one unit: no warning", () => {
    drawCharts(
      [
        query("a", "mem_used", { unit: "B" }),
        query("b", "mem_total", { unit: "By", overlay: true }),
      ],
      [resultOf([1]), resultOf([2])],
    );

    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("two counts, requests beside errors, are drawn bare: no warning", () => {
    const [chart] = drawCharts(
      [
        query("a", "http.requests", { unit: "{requests}" }),
        query("b", "http.errors", { unit: "{errors}", overlay: true }),
      ],
      [resultOf([120, 140]), resultOf([3, 5])],
    );

    expect(valuesOf(chart!)).toEqual({
      "http.requests": [120, 140],
      "http.errors": [3, 5],
    });
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });
});

describe("another unit of the same kind: converted into the chart's unit", () => {
  test("megabytes on a chart in gigabytes", () => {
    const [chart] = drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([8, 8]), resultOf([4200, 4600])],
    );

    const values: Record<string, Array<number>> = valuesOf(chart!);

    expect(values["mem_total"]).toEqual([8, 8]);
    expectClose(values["mem_used"]!, [4.2, 4.6]);
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("seconds on a chart in milliseconds", () => {
    const [chart] = drawCharts(
      [
        query("a", "http.server.duration", { unit: "ms" }),
        query("b", "http.server.request.duration", {
          unit: "s",
          overlay: true,
        }),
      ],
      [resultOf([120, 180]), resultOf([0.125, 0.2])],
    );

    expect(valuesOf(chart!)["http.server.request.duration"]).toEqual([
      125, 200,
    ]);
  });

  test("a percent on a chart of a 0-1 fraction, and a fraction on a chart in percent", () => {
    const fractionTypes: Array<MetricType> = [
      metricType("system.cpu.utilization", "1"),
      metricType("container.cpu.percent", "%"),
    ];

    const [onFraction] = drawCharts(
      [
        query("a", "system.cpu.utilization"),
        query("b", "container.cpu.percent", { overlay: true }),
      ],
      [resultOf([0.2, 0.4]), resultOf([25, 50])],
      { metricTypes: fractionTypes },
    );

    expectClose(valuesOf(onFraction!)["container.cpu.percent"]!, [0.25, 0.5]);
    cleanup();
    chartGroupMock.mockReset();

    const [onPercent] = drawCharts(
      [
        query("a", "container.cpu.percent"),
        query("b", "system.cpu.utilization", { overlay: true }),
      ],
      [resultOf([25, 50]), resultOf([0.2, 0.4])],
      { metricTypes: fractionTypes },
    );

    expectClose(valuesOf(onPercent!)["system.cpu.utilization"]!, [20, 40]);
  });

  test("the unit is the metric's own when the query sets none", () => {
    const [chart] = drawCharts(
      [query("a", "mem_total"), query("b", "mem_used", { overlay: true })],
      [resultOf([8]), resultOf([4096])],
      {
        metricTypes: [
          metricType("mem_total", "GiBy"),
          metricType("mem_used", "MiBy"),
        ],
      },
    );

    expect(valuesOf(chart!)["mem_used"]).toEqual([4]);
  });

  test("its warning and critical lines are drawn in the chart's unit too", () => {
    const [chart] = drawCharts(
      [
        query("a", "mem_total", { unit: "GB", warning: 7 }),
        query("b", "mem_used", {
          unit: "MB",
          overlay: true,
          warning: 6000,
          critical: 7500,
        }),
      ],
      [resultOf([8]), resultOf([4200])],
    );

    expectClose(lineValuesOf(chart!), [6, 7, 7.5]);
  });

  test("a monitor rule's line on it, written in its own unit, is drawn in the chart's", () => {
    const [chart] = drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([8]), resultOf([4200])],
      {
        thresholds: [
          {
            metricVariable: "b",
            value: 5000,
            name: "High memory",
            filterType: FilterType.GreaterThan,
            color: "#ef4444",
          },
          {
            metricVariable: "b",
            value: 6,
            unit: "GB",
            name: "Very high memory",
            filterType: FilterType.GreaterThan,
            color: "#991b1b",
          },
        ],
      },
    );

    expectClose(lineValuesOf(chart!), [5, 6]);
  });

  test("its previous period's line is converted as its own line is", () => {
    const [chart] = drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([8, 8]), resultOf([4200, 4600])],
      {
        previous: [
          resultOf([8, 8], WINDOW_MS),
          resultOf([3000, 3500], WINDOW_MS),
        ],
      },
    );

    const values: Record<string, Array<number>> = valuesOf(chart!);
    const ghost: string | undefined = Object.keys(values).find(
      (name: string): boolean => {
        return name.startsWith("mem_used") && name !== "mem_used";
      },
    );

    expect(ghost).toBeDefined();
    expectClose(values[ghost!]!, [3, 3.5]);
    expectClose(values["mem_used"]!, [4.2, 4.6]);
  });
});

describe("a unit of another kind: drawn as it is, and said", () => {
  test("bytes on a chart in percent keep their values, and the chart names both units", () => {
    const [chart] = drawCharts(
      [
        query("a", "cpu", { unit: "%", warning: 80 }),
        query("b", "mem_used", { unit: "By", overlay: true, warning: 6e9 }),
      ],
      [resultOf([20, 40]), resultOf([4e9, 5e9])],
    );

    expect(valuesOf(chart!)).toEqual({ cpu: [20, 40], mem_used: [4e9, 5e9] });
    expect(lineValuesOf(chart!)).toEqual([80, 6e9]);
    expect(screen.getByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toHaveTextContent(
      "Overlaid queries use different units (Percent, Bytes)",
    );
  });

  test("three queries: only the units that cannot be read are named, each once", () => {
    drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
        query("c", "cpu", { unit: "%", overlay: true }),
        query("d", "cpu_2", { unit: "%", overlay: true }),
      ],
      [resultOf([8]), resultOf([4200]), resultOf([20]), resultOf([30])],
    );

    // Named as the chart's unit badge names them: "GB" as written.
    expect(screen.getByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toHaveTextContent(
      "Overlaid queries use different units (GB, Percent) — they share one axis",
    );
  });
});

describe("queries that are not overlaid are never converted", () => {
  test("each on its own chart, in its own unit, with no warning", () => {
    const charts: Array<Chart> = drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB" }),
      ],
      [resultOf([8]), resultOf([4200])],
    );

    expect(charts).toHaveLength(2);
    expect(valuesOf(charts[0]!)).toEqual({ mem_total: [8] });
    expect(valuesOf(charts[1]!)).toEqual({ mem_used: [4200] });
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("a query after one with no result starts a chart of its own, in its own unit", () => {
    const charts: Array<Chart> = drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
      ],
      [undefined as unknown as AggregatedResult, resultOf([4200])],
    );

    expect(charts).toHaveLength(1);
    expect(valuesOf(charts[0]!)).toEqual({ mem_used: [4200] });
  });
});
