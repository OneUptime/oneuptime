import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #10042: A SECOND VALUE AXIS FOR OVERLAID QUERIES IN ANOTHER KIND OF
 * UNIT.
 *
 * A chart's first value axis, on its left, is in its first query's unit. An
 * overlaid query in a unit of another kind - bytes on a chart in percent -
 * was drawn on that axis, flat at zero or far off the top, its tooltip and
 * legend values written in percent, under a warning. It is drawn against a
 * second axis now, on the right, written in its own unit:
 *
 *   - which series goes on which axis, a grouped query's every series, and
 *     the axis kept while its series are hidden;
 *   - another unit of the same kind converted into its axis's unit, on
 *     either side;
 *   - its warning and critical lines, a monitor rule's lines, its previous
 *     period's line and its exemplars on its axis, in its axis's unit;
 *   - a percent's soft scale on whichever side it is;
 *   - a third kind of unit, which fits neither axis: on the left as it is,
 *     its values written in its own unit, and said;
 *   - the legend: each axis's unit, each series' axis, each value in its
 *     own unit, and a moment's values the same way.
 *
 * The real MetricCharts builds the charts; ChartGroup, which would draw
 * them, is stood in for by one that keeps what it was handed and draws each
 * chart's legend (its series controls). ChartWidgetSecondAxisDrawn.test.tsx
 * draws them with the real charts.
 */

const chartGroupMock: MockFunction = getJestMockFunction();
const exemplarsByMetric: Record<string, Array<unknown>> = {};

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
        fetchExemplars: (input: { metricName: string }) => {
          return Promise.resolve(exemplarsByMetric[input.metricName] || []);
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
  CHART_AXIS_UNIT_TEST_ID,
  OVERLAY_UNIT_MISMATCH_TEST_ID,
  SERIES_CHIP_AXIS_TEST_ID,
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
import { ComponentProps as LineChartProps } from "../../../UI/Components/Charts/Line/LineChart";
import ChartReferenceLineProps from "../../../UI/Components/Charts/Types/ReferenceLineProps";
import ExemplarPoint from "../../../UI/Components/Charts/Types/ExemplarPoint";
import { SecondYAxis } from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import { PREVIOUS_PERIOD_SERIES_SUFFIX } from "../../../UI/Components/Charts/ChartLibrary/Utils/TooltipEntries";
import ValueFormatter from "../../../Utils/ValueFormatter";

const WINDOW_START: Date = new Date("2026-11-18T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-18T11:00:00.000Z");
const WINDOW_MS: number = WINDOW_END.getTime() - WINDOW_START.getTime();

interface QueryOptions {
  unit?: string | undefined;
  overlay?: boolean | undefined;
  warning?: number | undefined;
  critical?: number | undefined;
  groupBy?: Array<string> | undefined;
  chartType?: MetricChartType | undefined;
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
      ...(options.groupBy ? { groupByAttributeKeys: options.groupBy } : {}),
    },
    chartType: options.chartType || MetricChartType.LINE,
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

// One series per host: each row carries the host it was read on.
function groupedResultOf(
  valuesByHost: Record<string, Array<number>>,
): AggregatedResult {
  const data: Array<Record<string, unknown>> = [];

  for (const [host, values] of Object.entries(valuesByHost)) {
    values.forEach((value: number, step: number): void => {
      data.push({
        timestamp: new Date(WINDOW_START.getTime() + step * 10 * 60 * 1000),
        value: value,
        attributes: { "host.name": host },
      });
    });
  }

  return { data: data, truncated: false } as unknown as AggregatedResult;
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

async function drawCharts(
  queryConfigs: Array<MetricQueryConfigData>,
  results: Array<AggregatedResult>,
  options: DrawOptions = {},
): Promise<Array<Chart>> {
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

  // The exemplars' reads settle.
  await act(async () => {
    await Promise.resolve();
  });

  return lastCharts();
}

function lastCharts(): Array<Chart> {
  const calls: Array<Array<unknown>> = chartGroupMock.mock.calls;

  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { charts: Array<Chart> }).charts;
}

interface DrawnSeries {
  seriesName: string;
  data: Array<{ x: Date; y: number }>;
}

interface ChartAxes {
  secondYAxis?: SecondYAxis | undefined;
  seriesValueFormatters?: Record<string, (value: number) => string> | undefined;
}

function axesOf(chart: Chart): ChartAxes {
  return chart.props as unknown as ChartAxes;
}

function secondAxisSeries(chart: Chart): Array<string> | undefined {
  return axesOf(chart).secondYAxis?.seriesNames;
}

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

function linesOf(chart: Chart): Array<ChartReferenceLineProps> {
  return chart.props.referenceLines || [];
}

// A line by its label's start ("Warning", "Critical", a rule's name).
function lineNamed(chart: Chart, labelStart: string): ChartReferenceLineProps {
  const line: ChartReferenceLineProps | undefined = linesOf(chart).find(
    (candidate: ChartReferenceLineProps): boolean => {
      return Boolean(candidate.label?.startsWith(labelStart));
    },
  );

  expect(line).toBeDefined();
  return line!;
}

function expectClose(actual: Array<number>, expected: Array<number>): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value: number, index: number): void => {
    expect(value).toBeCloseTo(expected[index]!, 9);
  });
}

function written(value: number, unit: string): string {
  return ValueFormatter.formatValue(value, unit, { language: "en" });
}

// The same, as a page's text reads it: its spaces, whichever, as one.
function shown(value: number, unit: string): string {
  return written(value, unit).replace(/\s+/g, " ");
}

// A series' chip in the legend, by its name.
function chipOf(seriesName: string): HTMLElement {
  return screen.getByTitle(`${seriesName} — click to hide`);
}

function chipAxis(seriesName: string): string | null {
  const badge: HTMLElement | null = within(chipOf(seriesName)).queryByTestId(
    SERIES_CHIP_AXIS_TEST_ID,
  );

  return badge ? badge.textContent : null;
}

const PERCENT_AND_BYTES: Array<MetricQueryConfigData> = [
  query("a", "cpu", { unit: "%" }),
  query("b", "mem_used", { unit: "By", overlay: true }),
];

beforeEach(() => {
  chartGroupMock.mockReset();
  for (const key of Object.keys(exemplarsByMetric)) {
    delete exemplarsByMetric[key];
  }
});

afterEach(() => {
  cleanup();
});

describe("which series goes on which axis", () => {
  test("bytes overlaid on percent: percent on the left, bytes on the right, each in its own unit", async () => {
    const [chart, ...rest] = await drawCharts(PERCENT_AND_BYTES, [
      resultOf([20, 40]),
      resultOf([4e9, 5e9]),
    ]);

    expect(rest).toHaveLength(0);
    expect(secondAxisSeries(chart!)).toEqual(["mem_used"]);
    // Each keeps its values: nothing is converted across kinds.
    expect(valuesOf(chart!)).toEqual({ cpu: [20, 40], mem_used: [4e9, 5e9] });
    // Each axis writes its ticks in its own unit.
    expect(chart!.props.yAxis.options.formatter(50)).toBe(written(50, "%"));
    expect(axesOf(chart!).secondYAxis!.options.formatter(4e9)).toBe(
      written(4e9, "By"),
    );
    expect(written(4e9, "By")).not.toBe(written(4e9, "%"));
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("percent overlaid on bytes: the other way round", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "mem_used", { unit: "By" }),
        query("b", "cpu", { unit: "%", overlay: true }),
      ],
      [resultOf([4e9]), resultOf([40])],
    );

    expect(secondAxisSeries(chart!)).toEqual(["cpu"]);
    expect(chart!.props.yAxis.options.formatter(4e9)).toBe(written(4e9, "By"));
    expect(axesOf(chart!).secondYAxis!.options.formatter(40)).toBe(
      written(40, "%"),
    );
  });

  test("a grouped query on the right: every one of its series is on the right", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_used", {
          unit: "By",
          overlay: true,
          groupBy: ["host.name"],
        }),
      ],
      [
        resultOf([20]),
        groupedResultOf({ "web-1": [4e9], "web-2": [5e9], "web-3": [6e9] }),
      ],
    );

    expect([...secondAxisSeries(chart!)!].sort()).toEqual([
      "host.name=web-1",
      "host.name=web-2",
      "host.name=web-3",
    ]);
    expect(secondAxisSeries(chart!)).not.toContain("cpu");
  });

  test("queries of one kind keep the one axis: no second axis", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([8]), resultOf([4200])],
    );

    expect(axesOf(chart!).secondYAxis).toBeUndefined();
    expectClose(valuesOf(chart!)["mem_used"]!, [4.2]);
  });

  test("queries on charts of their own each keep one axis", async () => {
    const charts: Array<Chart> = await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_used", { unit: "By" }),
      ],
      [resultOf([20]), resultOf([4e9])],
    );

    expect(charts).toHaveLength(2);
    for (const chart of charts) {
      expect(axesOf(chart).secondYAxis).toBeUndefined();
    }
  });

  test("bar and area charts take the second axis too", async () => {
    for (const chartType of [MetricChartType.BAR, MetricChartType.AREA]) {
      cleanup();
      chartGroupMock.mockReset();

      const [chart] = await drawCharts(
        [
          query("a", "cpu", { unit: "%", chartType }),
          query("b", "mem_used", { unit: "By", overlay: true, chartType }),
        ],
        [resultOf([20]), resultOf([4e9])],
      );

      expect({ chartType, second: secondAxisSeries(chart!) }).toEqual({
        chartType,
        second: ["mem_used"],
      });
    }
  });
});

describe("another unit of the same kind is converted into its axis's unit, on either side", () => {
  test("megabytes overlaid after gigabytes on the right are read in gigabytes there", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_total", { unit: "GB", overlay: true }),
        query("c", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([20]), resultOf([8, 8]), resultOf([4200, 4600])],
    );

    expect(secondAxisSeries(chart!)).toEqual(["mem_total", "mem_used"]);
    expect(valuesOf(chart!)["mem_total"]).toEqual([8, 8]);
    expectClose(valuesOf(chart!)["mem_used"]!, [4.2, 4.6]);
    expect(axesOf(chart!).secondYAxis!.options.formatter(8)).toBe(
      written(8, "GB"),
    );
  });

  test("seconds after milliseconds stay on the left, converted; bytes go right", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "http.server.duration", { unit: "ms" }),
        query("b", "mem_used", { unit: "By", overlay: true }),
        query("c", "http.server.request.duration", {
          unit: "s",
          overlay: true,
        }),
      ],
      [resultOf([120]), resultOf([4e9]), resultOf([0.25])],
    );

    expect(secondAxisSeries(chart!)).toEqual(["mem_used"]);
    expect(valuesOf(chart!)["http.server.request.duration"]).toEqual([250]);
  });
});

describe("lines follow their own query's axis, in its axis's unit", () => {
  test("warning and critical lines: the percent query's on the left, the bytes query's on the right", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "cpu", { unit: "%", warning: 80, critical: 95 }),
        query("b", "mem_used", {
          unit: "By",
          overlay: true,
          warning: 6e9,
          critical: 7e9,
        }),
      ],
      [resultOf([20]), resultOf([4e9])],
    );

    const lines: Array<ChartReferenceLineProps> = linesOf(chart!);
    const leftLines: Array<number> = lines
      .filter((line: ChartReferenceLineProps): boolean => {
        return !line.isOnSecondYAxis;
      })
      .map((line: ChartReferenceLineProps): number => {
        return line.value;
      });
    const rightLines: Array<number> = lines
      .filter((line: ChartReferenceLineProps): boolean => {
        return Boolean(line.isOnSecondYAxis);
      })
      .map((line: ChartReferenceLineProps): number => {
        return line.value;
      });

    expect(leftLines.sort()).toEqual([80, 95]);
    expect(rightLines.sort()).toEqual([6e9, 7e9]);
    // Each labelled in its own axis's unit.
    expect(
      lines.find((line: ChartReferenceLineProps): boolean => {
        return line.value === 6e9;
      })!.label,
    ).toBe(`Warning: ${written(6e9, "By")}`);
    expect(
      lines.find((line: ChartReferenceLineProps): boolean => {
        return line.value === 80;
      })!.label,
    ).toBe(`Warning: ${written(80, "%")}`);
  });

  test("a converted query's lines on the right are converted with it", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_total", { unit: "GB", overlay: true }),
        query("c", "mem_used", {
          unit: "MB",
          overlay: true,
          warning: 6000,
          critical: 7500,
        }),
      ],
      [resultOf([20]), resultOf([8]), resultOf([4200])],
    );

    const warning: ChartReferenceLineProps = lineNamed(chart!, "Warning");
    const critical: ChartReferenceLineProps = lineNamed(chart!, "Critical");

    expect(warning.value).toBeCloseTo(6, 9);
    expect(critical.value).toBeCloseTo(7.5, 9);
    expect(warning.isOnSecondYAxis).toBe(true);
    expect(critical.isOnSecondYAxis).toBe(true);
    expect(warning.label).toBe(`Warning: ${written(6, "GB")}`);
  });

  test("a monitor rule's lines on a query on the right are drawn on the right, in its unit", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_total", { unit: "GB", overlay: true }),
        query("c", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([20]), resultOf([8]), resultOf([4200])],
      {
        thresholds: [
          {
            metricVariable: "c",
            value: 5000,
            name: "High memory",
            filterType: FilterType.GreaterThan,
            color: "#ef4444",
          },
          {
            metricVariable: "c",
            value: 6,
            unit: "GB",
            name: "Very high memory",
            filterType: FilterType.GreaterThan,
            color: "#991b1b",
          },
          {
            metricVariable: "a",
            value: 90,
            name: "High CPU",
            filterType: FilterType.GreaterThan,
            color: "#f59e0b",
          },
        ],
      },
    );

    const highMemory: ChartReferenceLineProps = lineNamed(
      chart!,
      "High memory",
    );
    const veryHighMemory: ChartReferenceLineProps = lineNamed(
      chart!,
      "Very high memory",
    );
    const highCpu: ChartReferenceLineProps = lineNamed(chart!, "High CPU");

    expect(highMemory.value).toBeCloseTo(5, 9);
    expect(veryHighMemory.value).toBeCloseTo(6, 9);
    expect(highMemory.isOnSecondYAxis).toBe(true);
    expect(veryHighMemory.isOnSecondYAxis).toBe(true);
    expect(highCpu.value).toBe(90);
    expect(highCpu.isOnSecondYAxis).toBeFalsy();
  });

  test("a previous period's line is on its live line's axis, converted as it is", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_total", { unit: "GB", overlay: true }),
        query("c", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([20, 30]), resultOf([8, 8]), resultOf([4200, 4600])],
      {
        previous: [
          resultOf([10, 15], WINDOW_MS),
          resultOf([8, 8], WINDOW_MS),
          resultOf([3000, 3500], WINDOW_MS),
        ],
      },
    );

    const cpuGhost: string = `cpu${PREVIOUS_PERIOD_SERIES_SUFFIX}`;
    const memGhost: string = `mem_used${PREVIOUS_PERIOD_SERIES_SUFFIX}`;

    expect(secondAxisSeries(chart!)).toContain(memGhost);
    expect(secondAxisSeries(chart!)).toContain(
      `mem_total${PREVIOUS_PERIOD_SERIES_SUFFIX}`,
    );
    expect(secondAxisSeries(chart!)).not.toContain(cpuGhost);
    expectClose(valuesOf(chart!)[memGhost]!, [3, 3.5]);
    expect(valuesOf(chart!)[cpuGhost]).toEqual([10, 15]);
  });

  test("a query's exemplars are drawn on its axis, in its axis's unit", async () => {
    exemplarsByMetric["mem_used"] = [
      { x: WINDOW_START, y: 4096, traceId: "trace-mem" },
    ];
    exemplarsByMetric["cpu"] = [
      { x: WINDOW_START, y: 42, traceId: "trace-cpu" },
    ];

    await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_total", { unit: "GB", overlay: true }),
        query("c", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([20]), resultOf([8]), resultOf([4200])],
    );

    const exemplars: Array<ExemplarPoint> =
      lastCharts()[0]!.exemplarPoints || [];
    const memory: ExemplarPoint | undefined = exemplars.find(
      (point: ExemplarPoint): boolean => {
        return point.traceId === "trace-mem";
      },
    );
    const cpu: ExemplarPoint | undefined = exemplars.find(
      (point: ExemplarPoint): boolean => {
        return point.traceId === "trace-cpu";
      },
    );

    expect(memory?.isOnSecondYAxis).toBe(true);
    expect(memory?.y).toBeCloseTo(4.096, 9);
    expect(cpu?.isOnSecondYAxis).toBeFalsy();
    expect(cpu?.y).toBe(42);
  });
});

describe("a percent axis keeps its scale on either side", () => {
  test("percent on the right runs to 100% while its values sit under it", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "mem_used", { unit: "By" }),
        query("b", "cpu", { unit: "%", overlay: true }),
      ],
      [resultOf([4e9, 5e9]), resultOf([40, 60])],
    );

    const second: SecondYAxis = axesOf(chart!).secondYAxis!;

    expect(second.options.min).toBe(0);
    expect(second.options.max).toBe(100);
    // The bytes on the left are not squeezed onto a percent scale.
    expect(chart!.props.yAxis.options.max).toBe("auto");
  });

  test("percent on the left is scaled by its own series, never the bytes on the right", async () => {
    const [chart] = await drawCharts(PERCENT_AND_BYTES, [
      resultOf([40, 60]),
      resultOf([4e9, 5e9]),
    ]);

    expect(chart!.props.yAxis.options.min).toBe(0);
    expect(chart!.props.yAxis.options.max).toBe(100);
    expect(axesOf(chart!).secondYAxis!.options.max).toBe("auto");
  });

  test("a 0-1 fraction on the right keeps a scale that ends at 1", async () => {
    const [chart] = await drawCharts(
      [
        query("a", "mem_used", { unit: "By" }),
        query("b", "system.cpu.utilization", { overlay: true }),
      ],
      [resultOf([4e9]), resultOf([0.4, 0.6])],
      {
        metricTypes: [
          Object.assign(new MetricType(), {
            name: "system.cpu.utilization",
            unit: "1",
          }),
        ],
      },
    );

    expect(secondAxisSeries(chart!)).toEqual(["system.cpu.utilization"]);
    expect(axesOf(chart!).secondYAxis!.options.max).toBe(1);
  });
});

describe("a third kind of unit fits neither axis", () => {
  const THREE_KINDS: Array<MetricQueryConfigData> = [
    query("a", "cpu", { unit: "%" }),
    query("b", "mem_used", { unit: "By", overlay: true }),
    query("c", "latency", { unit: "ms", overlay: true, warning: 300 }),
    query("d", "mem_free", { unit: "GB", overlay: true }),
  ];
  const THREE_KINDS_RESULTS: Array<AggregatedResult> = [
    resultOf([20, 40]),
    resultOf([4e9, 5e9]),
    resultOf([120, 180]),
    resultOf([2, 3]),
  ];

  test("drawn on the left as it is, while the fourth query, in gigabytes, joins the bytes on the right", async () => {
    const [chart] = await drawCharts(THREE_KINDS, THREE_KINDS_RESULTS);

    expect(secondAxisSeries(chart!)).toEqual(["mem_used", "mem_free"]);
    expect(valuesOf(chart!)["latency"]).toEqual([120, 180]);
    // Gigabytes on an axis in bytes: converted into bytes.
    expectClose(valuesOf(chart!)["mem_free"]!, [2e9, 3e9]);

    const warning: ChartReferenceLineProps = lineNamed(chart!, "Warning");

    expect(warning.value).toBe(300);
    expect(warning.isOnSecondYAxis).toBeFalsy();
    expect(warning.label).toBe(`Warning: ${written(300, "ms")}`);
  });

  test("its tooltip writes its values in its own unit, the others by their axes", async () => {
    const [chart] = await drawCharts(THREE_KINDS, THREE_KINDS_RESULTS);
    const formatters: Record<string, (value: number) => string> =
      axesOf(chart!).seriesValueFormatters || {};

    expect(Object.keys(formatters)).toEqual(["latency"]);
    expect(formatters["latency"]!(120)).toBe(written(120, "ms"));
  });

  test("the chart says so, naming its unit and the axes'", async () => {
    await drawCharts(THREE_KINDS, THREE_KINDS_RESULTS);

    expect(screen.getByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toHaveTextContent(
      "Queries in Milliseconds fit neither axis of this chart (Percent, Bytes), so they are drawn against the left axis and may not be directly comparable.",
    );
  });
});

describe("the legend says which axis each series uses", () => {
  test("each axis's unit, and each chip's axis", async () => {
    await drawCharts(PERCENT_AND_BYTES, [
      resultOf([20, 40]),
      resultOf([4e9, 5e9]),
    ]);

    expect(
      screen
        .getAllByTestId(CHART_AXIS_UNIT_TEST_ID)
        .map((badge: HTMLElement): string | null => {
          return badge.textContent;
        }),
    ).toEqual(["Left axis: Percent", "Right axis: Bytes"]);
    expect(chipAxis("cpu")).toBe("Left axis");
    expect(chipAxis("mem_used")).toBe("Right axis");
  });

  test("each chip's value is written in its own series' unit", async () => {
    await drawCharts(PERCENT_AND_BYTES, [
      resultOf([20, 40]),
      resultOf([4e9, 5e9]),
    ]);

    // The chips show each series' peak.
    expect(chipOf("cpu")).toHaveTextContent(shown(40, "%"));
    expect(chipOf("mem_used")).toHaveTextContent(shown(5e9, "By"));
  });

  test("a series on neither axis is on the left, its value in its own unit", async () => {
    await drawCharts(
      [
        query("a", "cpu", { unit: "%" }),
        query("b", "mem_used", { unit: "By", overlay: true }),
        query("c", "latency", { unit: "ms", overlay: true }),
      ],
      [resultOf([20]), resultOf([4e9]), resultOf([180])],
    );

    expect(chipAxis("latency")).toBe("Left axis");
    expect(chipOf("latency")).toHaveTextContent(shown(180, "ms"));
  });

  test("a chart with one axis names no axis: its unit as before, and plain chips", async () => {
    await drawCharts(
      [
        query("a", "mem_total", { unit: "GB" }),
        query("b", "mem_used", { unit: "MB", overlay: true }),
      ],
      [resultOf([8]), resultOf([4200])],
    );

    expect(screen.queryByTestId(CHART_AXIS_UNIT_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(SERIES_CHIP_AXIS_TEST_ID)).toBeNull();
    expect(chipOf("mem_used")).toHaveTextContent(shown(4.2, "GB"));
  });

  test("hiding the series on the right keeps the right axis, so the plot does not move", async () => {
    const [before] = await drawCharts(PERCENT_AND_BYTES, [
      resultOf([20, 40]),
      resultOf([4e9, 5e9]),
    ]);

    expect(secondAxisSeries(before!)).toEqual(["mem_used"]);

    act(() => {
      fireEvent.click(chipOf("mem_used"));
    });

    const [after] = lastCharts();

    expect(Object.keys(valuesOf(after!))).toEqual(["cpu"]);
    expect(secondAxisSeries(after!)).toEqual(["mem_used"]);
  });

  test("a moment's values, clicked on the chart, are each written in their own unit", async () => {
    const [chart] = await drawCharts(PERCENT_AND_BYTES, [
      resultOf([20, 40]),
      resultOf([4e9, 5e9]),
    ]);

    act(() => {
      (chart!.props as LineChartProps).onBucketClick!(
        WINDOW_START,
        new Date(WINDOW_START.getTime() + 10 * 60 * 1000),
        { cpu: 20, mem_used: 4e9 },
      );
    });

    const inspector: HTMLElement = screen.getByRole("dialog");

    expect(inspector).toHaveTextContent(shown(20, "%"));
    expect(inspector).toHaveTextContent(shown(4e9, "By"));
  });
});
