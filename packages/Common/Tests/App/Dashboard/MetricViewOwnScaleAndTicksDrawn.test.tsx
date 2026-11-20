import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
 * ISSUES #10079 AND #10080, DRAWN WHERE METRIC QUERIES ARE OVERLAID: THE
 * METRICS EXPLORER AND A METRIC MONITOR'S PREVIEWS.
 *
 * Both draw with MetricView. Here the real MetricView, the real MetricCharts
 * and the real charts draw, with the metrics read stood in for and recharts
 * given a size to draw in:
 *
 *   - a third kind of unit (milliseconds on a chart in percent and bytes)
 *     is drawn to a scale of its own, with no axis: two axes drawn, never a
 *     third, the left one's percent never stretched by it, its line kept to
 *     its shape over the plot, its chip saying "Own scale", and the chart
 *     saying so; in the explorer, in the criteria page's preview, and in a
 *     Metrics monitor's form, whose rule on that query is drawn to its scale;
 *   - a value axis over a narrow range (a filesystem at 17.2 GB, give or take
 *     a few megabytes) writes ticks that read apart, on the left axis and on
 *     the right, in English and in German.
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

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
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
import { getYAxisWidthForLabelsInPx } from "../../../UI/Components/Charts/Utils/YAxisWidth";

const WINDOW_END: Date = new Date();
const WINDOW_START: Date = new Date(WINDOW_END.getTime() - 60 * 60 * 1000);
const WINDOW: InBetween<Date> = new InBetween<Date>(WINDOW_START, WINDOW_END);

// What the host sends, by metric: a point every ten minutes of the window.
const VALUES: Record<string, Array<number>> = {
  cpu_usage_percent: [12, 48, 25, 62, 37, 14],
  mem_used: [4.1e9, 4.4e9, 4.2e9, 4.6e9, 4.5e9, 4.3e9],
  // About 70 processes: drawn against a percent axis, it read 7,000%.
  processes: [68, 72, 70, 75, 71, 69],
  latency: [120, 180, 150, 240, 210, 160],
  // A filesystem at 17.2 GB, give or take a few megabytes (#10079).
  filesystem_used: [
    17.2013e9, 17.2021e9, 17.2034e9, 17.2047e9, 17.2039e9, 17.2026e9,
  ],
  // A request counter in the billions, rising by a million a step.
  requests_total: [
    119.2e9, 119.201e9, 119.202e9, 119.203e9, 119.204e9, 119.205e9,
  ],
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

// CPU in percent, memory in bytes overlaid on it, and latency in a third kind.
const THREE_KINDS: Array<MetricQueryConfigData> = [
  query("a", "cpu_usage_percent", "%"),
  query("b", "mem_used", "By", true),
  query("c", "latency", "ms", true),
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

// The lines drawn: recharts' line curves, less their hit areas.
function curves(): Array<Element> {
  return Array.from(
    document.querySelectorAll(
      'path.recharts-line-curve:not([stroke="transparent"])',
    ),
  );
}

// How far up and down the plot a line runs, in pixels.
function spanOf(curve: Element): number {
  const numbers: Array<number> = (
    (curve.getAttribute("d") || "").match(/-?\d+(\.\d+)?/g) || []
  ).map(Number);
  const ys: Array<number> = numbers.filter(
    (_value: number, index: number): boolean => {
      return index % 2 === 1;
    },
  );

  return ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0;
}

async function waitForLines(count: number): Promise<void> {
  await waitFor(() => {
    expect(curves().length).toBeGreaterThanOrEqual(count);
  });
}

function chipAxisOf(seriesName: string): string | null {
  const chip: HTMLElement = screen.getByTitle(`${seriesName} — click to hide`);

  return (
    within(chip).queryByTestId(SERIES_CHIP_AXIS_TEST_ID)?.textContent || null
  );
}

function badges(): Array<string | null> {
  return screen
    .getAllByTestId(CHART_AXIS_UNIT_TEST_ID)
    .map((badge: HTMLElement): string | null => {
      return badge.textContent;
    });
}

function expectApart(ticks: Array<string>): void {
  expect(ticks.length).toBeGreaterThanOrEqual(3);
  for (let index: number = 1; index < ticks.length; index++) {
    expect(ticks[index]).not.toBe(ticks[index - 1]);
  }
}

// The third kind drawn to a scale of its own, as every host draws it.
function expectThirdKindOnItsOwnScale(): void {
  const [left, right] = valueAxes();

  // Two axes, never a third: percent on the left, bytes on the right.
  expect(valueAxes()).toHaveLength(2);
  for (const tick of left!) {
    expect(tick).toMatch(/%$/);
    // The left axis keeps its percent: the third kind never stretches it.
    expect(Number(tick.replace(/[^0-9.]/g, ""))).toBeLessThanOrEqual(100);
  }
  for (const tick of right!) {
    expect(tick).toMatch(/(^0|B)$/);
  }

  // Every line keeps its shape over the plot, the third kind's too.
  expect(curves()).toHaveLength(3);
  for (const curve of curves()) {
    expect(spanOf(curve)).toBeGreaterThan(20);
  }

  expect(chipAxisOf("latency")).toBe("Own scale");
  expect(chipAxisOf("cpu_usage_percent")).toBe("Left axis");
  expect(chipAxisOf("mem_used")).toBe("Right axis");
  expect(badges()).toEqual([
    "Left axis: Percent",
    "Right axis: Bytes",
    "Own scale: Milliseconds",
  ]);
  expect(screen.getByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toHaveTextContent(
    "Queries in Milliseconds fit neither axis of this chart (Percent, Bytes), so each kind of unit is drawn to a scale of its own, with no axis. Read their values in the legend and the tooltip.",
  );
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  fetchResultsMock.mockReset();
  answerEachQuery();
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("issue #10080: a third kind of unit is drawn to a scale of its own", () => {
  test("the metrics explorer: two axes, the third kind's line on its own scale, and the legend says so", async () => {
    render(
      <MetricView
        data={viewOf(THREE_KINDS)}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForLines(3);

    expect(screen.getAllByTestId("chart-group-card")).toHaveLength(1);
    expectThirdKindOnItsOwnScale();
  });

  test("the issue's processes no longer pull a percent axis up to thousands", async () => {
    render(
      <MetricView
        data={viewOf([
          query("a", "cpu_usage_percent", "%"),
          query("b", "mem_used", "By", true),
          query("c", "processes", "{processes}", true),
        ])}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForLines(3);

    const [left] = valueAxes();

    expect(left![left!.length - 1]).toBe("100.00%");
    expect(chipAxisOf("processes")).toBe("Own scale");
  });

  test("the criteria page's read-only preview draws the third kind on its own scale", async () => {
    render(
      <MonitorStepMetricPreview
        metricsViewConfig={{
          queryConfigs: THREE_KINDS,
          formulaConfigs: [],
        }}
        rollingTime={RollingTime.Past1Hour}
      />,
    );

    await waitForLines(3);

    expectThirdKindOnItsOwnScale();
  });

  test("a Metrics monitor's form: a rule on the third kind is drawn to its scale, and neither axis takes it in", async () => {
    const rule: MetricChartThreshold = {
      metricVariable: "c",
      value: 2000,
      name: "Slow requests",
      filterType: FilterType.GreaterThan,
      color: "#ef4444",
    };

    render(
      <MetricView
        data={viewOf(THREE_KINDS)}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        thresholdLinesExtendAxis={true}
        thresholds={[rule]}
        onChange={(): void => {}}
      />,
    );

    await waitForLines(3);
    await act(async () => {
      await Promise.resolve();
    });

    const [left, right] = valueAxes();

    // Neither axis stretches to a 2,000 ms rule.
    for (const tick of left!) {
      expect(Number(tick.replace(/[^0-9.]/g, ""))).toBeLessThanOrEqual(100);
    }
    for (const tick of right!) {
      expect(tick).not.toMatch(/ms|sec/);
    }
    // Its line is drawn, labelled in its unit.
    expect(screen.getByText(/Slow requests/)).toBeInTheDocument();
  });
});

describe("issue #10079: a value axis over a narrow range writes ticks that read apart", () => {
  test("the metrics explorer: the issue's filesystem, 17.2 GB give or take a few megabytes", async () => {
    render(
      <MetricView
        data={viewOf([query("a", "filesystem_used", "By")])}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForLines(1);

    const [ticks] = valueAxes();

    expectApart(ticks!);
    expect(ticks).toEqual([
      "17.201\u00A0GB",
      "17.202\u00A0GB",
      "17.203\u00A0GB",
      "17.204\u00A0GB",
      "17.205\u00A0GB",
    ]);
  });

  test("both axes, each over its own narrow range", async () => {
    render(
      <MetricView
        data={viewOf([
          query("a", "requests_total", "{requests}"),
          query("b", "filesystem_used", "By", true),
        ])}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForLines(2);

    const [left, right] = valueAxes();

    expectApart(left!);
    expectApart(right!);
    // A counter rising by a few million on 119 billion: to five figures.
    for (const tick of left!) {
      expect(tick).toMatch(/^119\.\d{2}B$/);
    }
    for (const tick of right!) {
      expect(tick).toMatch(/^17\.\d{3}\u00A0GB$/);
    }
  });

  test("in German, in its digits and decimal comma", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    render(
      <MetricView
        data={viewOf([query("a", "filesystem_used", "By")])}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={(): void => {}}
      />,
    );

    await waitForLines(1);

    const [ticks] = valueAxes();

    expectApart(ticks!);
    expect(ticks![0]).toBe("17,201\u00A0GB");
  });

  test("the criteria page's preview reads apart too, its axis as wide as its widest tick", async () => {
    render(
      <MonitorStepMetricPreview
        metricsViewConfig={{
          queryConfigs: [query("a", "filesystem_used", "By")],
          formulaConfigs: [],
        }}
        rollingTime={RollingTime.Past1Hour}
      />,
    );

    await waitForLines(1);

    const [ticks] = valueAxes();
    const gridLine: Element | null = document.querySelector(
      ".recharts-cartesian-grid-horizontal line",
    );

    expectApart(ticks!);
    // The plot starts after the widest tick: none is cut at the card's edge.
    expect(Number(gridLine?.getAttribute("x1") || 0)).toBeGreaterThanOrEqual(
      getYAxisWidthForLabelsInPx({ labels: ticks! }),
    );
  });
});
