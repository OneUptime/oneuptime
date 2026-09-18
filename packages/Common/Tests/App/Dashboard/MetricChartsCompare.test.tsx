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
 * Ghost overlays end-to-end through the real MetricCharts: previous-
 * period results must render as dashed twins of DISPLAYED series only —
 * never as legend chips, never consuming Top-N slots, and always
 * time-shifted onto the current window's bucket grid (unshifted points
 * would be silently dropped by the bucketer).
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
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

const fetchExemplarsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchExemplars: (...args: Array<any>) => {
          fetchExemplarsMock(...args);
          return new Promise(() => {
            // Intentionally never settles.
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

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T11:00:00.000Z");
const WINDOW_MS: number = WINDOW_END.getTime() - WINDOW_START.getTime();

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a", legend: "CPU" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      } as unknown as MetricQueryConfigData,
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

function buildResult(offsetMs: number): AggregatedResult {
  return {
    data: [
      {
        timestamp: new Date(
          new Date("2026-08-20T10:10:00.000Z").getTime() - offsetMs,
        ),
        value: 40,
      },
      {
        timestamp: new Date(
          new Date("2026-08-20T10:30:00.000Z").getTime() - offsetMs,
        ),
        value: 70,
      },
    ],
    truncated: false,
  } as unknown as AggregatedResult;
}

beforeEach(() => {
  fetchExemplarsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("MetricCharts compare overlays", () => {
  test("renders a dashed ghost twin without adding legend chips", () => {
    const { container } = render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={[buildResult(0)]}
        metricResultsPrevious={[buildResult(WINDOW_MS)]}
        compareOffsetMs={WINDOW_MS}
        metricTypes={[]}
      />,
    );

    // The ghost line is on the chart, dashed…
    expect(
      container.querySelector('path[stroke-dasharray="6 4"]'),
    ).toBeInTheDocument();

    // …but the chip legend shows only the live series.
    expect(screen.getAllByText("CPU").length).toBeGreaterThan(0);
    expect(screen.queryByText("CPU (previous)")).toBeNull();
    // And the series count still reads 1.
    expect(screen.getByText("1 series")).toBeInTheDocument();
  });

  test("no previous results means no ghosts", () => {
    const { container } = render(
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={[buildResult(0)]}
        metricTypes={[]}
      />,
    );

    expect(container.querySelector('path[stroke-dasharray="6 4"]')).toBeNull();
  });
});
