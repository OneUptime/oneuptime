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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #10042, IN THE OTHER PLACES A METRIC QUERY IS OVERLAID: THE METRICS
 * EXPLORER AND A METRIC MONITOR'S PREVIEWS.
 *
 * Both draw their charts with MetricView. Here the real MetricView, the real
 * MetricCharts and the real charts draw bytes with percent overlaid on them,
 * with the metrics read stood in for and recharts given a size to draw in:
 *
 *   - the explorer (charts in cards): one chart, two value axes, each in its
 *     own unit, and the legend saying which series is on which;
 *   - a monitor's read-only preview on its criteria page
 *     (MonitorStepMetricPreview): the same;
 *   - a Metrics monitor's form, whose rule draws a line on the query it
 *     compares: a rule on the bytes query is drawn against the bytes axis,
 *     on the right, which takes it in, while the percent axis on the left
 *     keeps to its percent scale.
 */

jest.setTimeout(120000);

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
        width: 640,
        height: 320,
      } as Record<string, unknown>);
    },
  };
});

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
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

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import MonitorStepMetricPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview";
import {
  CHART_AXIS_UNIT_TEST_ID,
  OVERLAY_UNIT_MISMATCH_TEST_ID,
  SERIES_CHIP_AXIS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import { MetricChartThreshold } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricChartThresholds";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import RollingTime from "../../../Types/RollingTime/RollingTime";

const WINDOW_END: Date = new Date();
const WINDOW_START: Date = new Date(WINDOW_END.getTime() - 60 * 60 * 1000);
const WINDOW: InBetween<Date> = new InBetween<Date>(WINDOW_START, WINDOW_END);

// What the host sends, by metric: a point every ten minutes of the window.
const VALUES: Record<string, Array<number>> = {
  mem_used: [4.1e9, 4.4e9, 4.2e9, 4.6e9, 4.5e9, 4.3e9],
  cpu_usage_percent: [12, 48, 25, 62, 37, 14],
};

function query(
  variable: string,
  metricName: string,
  unit: string,
  isOverlaid: boolean = false,
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
    ...(isOverlaid ? { overlayWithPreviousQuery: true } : {}),
  } as MetricQueryConfigData;
}

// Memory in bytes, with CPU in percent overlaid on its chart.
const BYTES_WITH_PERCENT: Array<MetricQueryConfigData> = [
  query("a", "mem_used", "By"),
  query("b", "cpu_usage_percent", "%", true),
];

function viewOf(queryConfigs: Array<MetricQueryConfigData>): MetricViewData {
  return {
    startAndEndDate: WINDOW,
    queryConfigs: queryConfigs,
    formulaConfigs: [],
  };
}

function answerEachQuery(): void {
  fetchResultsMock.mockImplementation((input: unknown) => {
    const queryConfigs: Array<MetricQueryConfigData> = (
      input as { metricViewData: MetricViewData }
    ).metricViewData.queryConfigs;

    return Promise.resolve(
      queryConfigs.map((queryConfig: MetricQueryConfigData) => {
        const metricName: string = String(
          queryConfig.metricQueryData.filterData.metricName,
        );

        return {
          data: (VALUES[metricName] || []).map(
            (value: number, step: number) => {
              return {
                timestamp: new Date(
                  WINDOW_START.getTime() + step * 10 * 60 * 1000,
                ),
                value: value,
              };
            },
          ),
          truncated: false,
        };
      }),
    );
  });
}

// The value axes drawn, left first: what each one's ticks say.
function valueAxes(): Array<Array<string>> {
  return Array.from(document.querySelectorAll(".recharts-yAxis-tick-labels"))
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

async function waitForTwoLines(): Promise<void> {
  await waitFor(() => {
    expect(
      document.querySelectorAll("path.recharts-line-curve").length,
    ).toBeGreaterThanOrEqual(2);
  });
}

function chipAxisOf(seriesName: string): string | null {
  const chip: HTMLElement = screen.getByTitle(`${seriesName} — click to hide`);

  return (
    within(chip).queryByTestId(SERIES_CHIP_AXIS_TEST_ID)?.textContent || null
  );
}

// Bytes on the left, percent on the right, each tick in its own unit.
function expectBytesLeftPercentRight(): void {
  const axes: Array<Array<string>> = valueAxes();

  expect(axes).toHaveLength(2);
  expect(axes[0]!.length).toBeGreaterThan(1);
  expect(axes[1]!.length).toBeGreaterThan(1);
  for (const tick of axes[0]!) {
    expect(tick).toMatch(/(^0|B)$/);
  }
  for (const tick of axes[1]!) {
    expect(tick).toMatch(/%$/);
  }
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  answerEachQuery();
});

afterEach(() => {
  cleanup();
});

describe("the metrics explorer: an overlaid query in another kind of unit gets the right axis", () => {
  test("one chart, bytes on the left and percent on the right, and the legend says which is which", async () => {
    render(
      <MetricView
        data={viewOf(BYTES_WITH_PERCENT)}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForTwoLines();

    // The explorer draws its charts in cards: this one is one card.
    expect(screen.getAllByTestId("chart-group-card")).toHaveLength(1);
    expectBytesLeftPercentRight();
    expect(
      screen
        .getAllByTestId(CHART_AXIS_UNIT_TEST_ID)
        .map((badge: HTMLElement): string | null => {
          return badge.textContent;
        }),
    ).toEqual(["Left axis: Bytes", "Right axis: Percent"]);
    expect(chipAxisOf("mem_used")).toBe("Left axis");
    expect(chipAxisOf("cpu_usage_percent")).toBe("Right axis");
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("the same queries on charts of their own: two cards, one axis each", async () => {
    render(
      <MetricView
        data={viewOf([
          query("a", "mem_used", "By"),
          query("b", "cpu_usage_percent", "%"),
        ])}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForTwoLines();

    expect(screen.getAllByTestId("chart-group-card")).toHaveLength(2);
    expect(valueAxes()).toHaveLength(2);
    expect(screen.queryByTestId(CHART_AXIS_UNIT_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(SERIES_CHIP_AXIS_TEST_ID)).toBeNull();
  });
});

describe("a monitor's preview: the same two axes", () => {
  test("the criteria page's read-only preview draws bytes left and percent right", async () => {
    render(
      <MonitorStepMetricPreview
        metricsViewConfig={{
          queryConfigs: BYTES_WITH_PERCENT,
          formulaConfigs: [],
        }}
        rollingTime={RollingTime.Past1Hour}
      />,
    );

    await waitForTwoLines();

    expectBytesLeftPercentRight();
    expect(chipAxisOf("cpu_usage_percent")).toBe("Right axis");
  });

  test("a Metrics monitor's form: a rule on the bytes query is drawn against the bytes axis, which takes it in", async () => {
    const rule: MetricChartThreshold = {
      metricVariable: "a",
      value: 6e9,
      name: "High memory",
      filterType: FilterType.GreaterThan,
      color: "#ef4444",
    };

    render(
      <MetricView
        data={viewOf([
          query("a", "cpu_usage_percent", "%"),
          query("b", "mem_used", "By", true),
        ])}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        thresholdLinesExtendAxis={true}
        thresholds={[{ ...rule, metricVariable: "b" }]}
        onChange={(): void => {}}
      />,
    );

    await waitForTwoLines();
    await act(async () => {
      await Promise.resolve();
    });

    const [left, right] = valueAxes();

    // The percent axis keeps to percent: the rule's 6 GB never reaches it.
    for (const tick of left!) {
      expect(tick).toMatch(/%$/);
      expect(Number(tick.replace(/[^0-9.]/g, ""))).toBeLessThanOrEqual(100);
    }
    // The bytes axis, on the right, stretches to take the rule's line in.
    expect(
      right!.map((tick: string): string => {
        return tick.replace(/\s+/g, " ");
      }),
    ).toContainEqual(expect.stringMatching(/^[6-9](\.\d+)? GB$/));
    expect(screen.getByText(/High memory/)).toBeInTheDocument();
  });
});
