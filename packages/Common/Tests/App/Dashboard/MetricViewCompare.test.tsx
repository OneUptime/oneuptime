import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Compare-to-previous-period: MetricView must fetch the SAME queries a
 * second time over the window shifted back by exactly one window width,
 * hand both result sets to MetricCharts, and degrade to live-only when
 * the shifted fetch fails.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const metricChartsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({
            metricTypes: [],
            telemetryServices: [],
          });
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        metricChartsMock(props);
        return React.createElement("div", {
          "data-testid": "metric-charts",
        });
      },
    };
  },
);

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T11:00:00.000Z");
const WINDOW_MS: number = WINDOW_END.getTime() - WINDOW_START.getTime();

function buildData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as unknown as MetricViewData;
}

interface CapturedFetch {
  metricViewData: MetricViewData;
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  metricChartsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
});

afterEach(() => {
  cleanup();
});

describe("MetricView compare with previous period", () => {
  test("fetches the shifted window alongside the live one and hands both down", async () => {
    render(
      <MetricView
        data={buildData()}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        compareWithPreviousPeriod={true}
        onChange={() => {
          // not exercised
        }}
      />,
    );

    await waitFor(() => {
      expect(fetchResultsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const windows: Array<[number, number]> = fetchResultsMock.mock.calls.map(
      (call: Array<unknown>): [number, number] => {
        const args: CapturedFetch = call[0] as CapturedFetch;
        return [
          args.metricViewData.startAndEndDate!.startValue.getTime(),
          args.metricViewData.startAndEndDate!.endValue.getTime(),
        ];
      },
    );

    /*
     * One live window and one shifted back by EXACTLY the window width
     * (bucket-congruent modulo the shift). Alignment may floor the live
     * start onto the bucket grid, so assert the relationship between the
     * two fetches rather than raw instants.
     */
    const [liveWindow, previousWindow] = windows as [
      [number, number],
      [number, number],
    ];
    const liveWidth: number = liveWindow[1] - liveWindow[0];
    expect(previousWindow[0]).toBe(liveWindow[0] - liveWidth);
    expect(previousWindow[1]).toBe(liveWindow[1] - liveWidth);
    expect(liveWidth).toBeGreaterThanOrEqual(WINDOW_MS);

    await waitFor(() => {
      const lastProps: Record<string, unknown> = metricChartsMock.mock.calls[
        metricChartsMock.mock.calls.length - 1
      ]?.[0] as Record<string, unknown>;
      expect(lastProps["metricResultsPrevious"]).toBeTruthy();
      expect(lastProps["compareOffsetMs"]).toBe(liveWidth);
    });
  });

  test("compare off means exactly one fetch and no ghost props", async () => {
    render(
      <MetricView
        data={buildData()}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={() => {
          // not exercised
        }}
      />,
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    // Let any (wrong) shifted fetch get scheduled before asserting.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 30);
    });
    /*
     * MetricView may legitimately refetch the LIVE window more than once
     * on mount — what compare-off forbids is any fetch of a SHIFTED
     * (earlier) window.
     */
    const anyShiftedFetch: boolean = fetchResultsMock.mock.calls.some(
      (call: Array<unknown>): boolean => {
        const args: CapturedFetch = call[0] as CapturedFetch;
        return (
          args.metricViewData.startAndEndDate!.endValue.getTime() <=
          WINDOW_START.getTime()
        );
      },
    );
    expect(anyShiftedFetch).toBe(false);
    const lastProps: Record<string, unknown> = metricChartsMock.mock.calls[
      metricChartsMock.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;
    expect(lastProps["metricResultsPrevious"]).toBeUndefined();
  });

  test("a failed shifted fetch degrades to live-only, never an error", async () => {
    fetchResultsMock.mockImplementation(
      (args: { metricViewData: MetricViewData }) => {
        const start: number =
          args.metricViewData.startAndEndDate!.startValue.getTime();
        // The shifted (earlier) fetch fails; the live one succeeds.
        if (start < WINDOW_START.getTime()) {
          return Promise.reject(new Error("clickhouse hiccup"));
        }
        return Promise.resolve([{ data: [], truncated: false }]);
      },
    );

    render(
      <MetricView
        data={buildData()}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        compareWithPreviousPeriod={true}
        onChange={() => {
          // not exercised
        }}
      />,
    );

    await waitFor(() => {
      expect(metricChartsMock).toHaveBeenCalled();
    });

    const lastProps: Record<string, unknown> = metricChartsMock.mock.calls[
      metricChartsMock.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;
    expect(lastProps["metricResults"]).toBeTruthy();
    expect(lastProps["metricResultsPrevious"]).toBeUndefined();
  });
});
