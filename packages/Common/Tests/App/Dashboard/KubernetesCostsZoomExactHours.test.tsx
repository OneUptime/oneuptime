/** @timezone UTC */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  RealChartRow,
  doubleClickRealRows,
  dragRealRows,
  realRowsOf,
  realRowsWindowOf,
  settleRealRows,
} from "./RealRowsLineChart";

/*
 * Issue #4105 on the Kubernetes Costs pages, with a real drag on a clock
 * that is not on the hour - as a reader's never is.
 *
 * The spend chart draws one bar per hour of the week, each at the start of
 * the hour its cost row covers. A drag across bars must zoom the page to
 * exactly the hours under them: the tiles, the tables and right-sizing are
 * all summed over the page's window, and every cost query counts a row
 * whose hour starts ANYWHERE in that window, both ends included. The zoom
 * used to end where the last dragged hour ends - which is exactly where the
 * next, unselected hour starts - so every drag also summed one hour nobody
 * selected.
 *
 * The pages, their EmbeddedMetricCard, the cost chart and the zoom are
 * real; so are the chart's rows (DataPointUtil) and the drag
 * (useChartRangeSelection), through RealRowsLineChart. The cost fetches are
 * stubbed and read the window the way the server does: one row per hour
 * that STARTS in [start, end], both ends included.
 */

type CostFetch = { start: Date; end: Date };

const mockFetchCostTrend: MockFunction = getJestMockFunction();
const mockFetchNamespaceBreakdown: MockFunction = getJestMockFunction();
const mockFetchWorkloadBreakdown: MockFunction = getJestMockFunction();
const mockFetchClusterBreakdown: MockFunction = getJestMockFunction();
const mockFetchRightSizing: MockFunction = getJestMockFunction();
const mockGetClusterList: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-8888-4aaa-8bbb-000000000008");
      },
      navigate: () => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return mockGetClusterList(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: () => {
        return "Could not load";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils",
      ) as Record<string, unknown>),
      fetchCostTrend: (...args: Array<unknown>) => {
        return mockFetchCostTrend(...args);
      },
      fetchNamespaceBreakdown: (...args: Array<unknown>) => {
        return mockFetchNamespaceBreakdown(...args);
      },
      fetchWorkloadBreakdown: (...args: Array<unknown>) => {
        return mockFetchWorkloadBreakdown(...args);
      },
      fetchClusterBreakdown: (...args: Array<unknown>) => {
        return mockFetchClusterBreakdown(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesRightSizingUtils",
  () => {
    return {
      __esModule: true,
      fetchRightSizingRecommendations: (...args: Array<unknown>) => {
        return mockFetchRightSizing(...args);
      },
    };
  },
);

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual(
        "./RealRowsLineChart",
      ) as typeof import("./RealRowsLineChart")
    ).RealRowsLineChart,
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

// The card's own picker: shows its range, and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }) => {
      return (
        <button
          type="button"
          data-testid="card-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Day" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
      );
    },
  };
});

import KubernetesClusterCosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Costs";
import KubernetesCosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Costs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// Twenty-three minutes and eleven seconds past noon: not on any grid.
const NOW: Date = new Date("2026-09-28T12:23:11.000Z");
const ONE_WEEK_AGO: Date = new Date(NOW.getTime() - 7 * DAY_MS);
const ONE_DAY_AGO: Date = new Date(NOW.getTime() - DAY_MS);

/*
 * Every hour costs $1, but for two spikes: $100 in the 10:00 hour on the
 * 27th (inside the week) and $50 in the 10:00 hour on the 28th (inside
 * the last day). The spend tiles then say exactly which hours a window
 * counted: two neighbouring $1 hours never add up to a spike.
 */
const SPIKES: Record<string, number> = {
  "2026-09-27T10:00:00.000Z": 100,
  "2026-09-28T10:00:00.000Z": 50,
};

function costOfHour(time: number): number {
  return SPIKES[new Date(time).toISOString()] ?? 1;
}

// The hours whose cost rows a window counts: those starting in [start, end].
function hoursCountedIn(start: Date, end: Date): Array<number> {
  const hours: Array<number> = [];
  const first: number = Math.ceil(start.getTime() / HOUR_MS) * HOUR_MS;

  for (let time: number = first; time <= end.getTime(); time += HOUR_MS) {
    hours.push(time);
  }

  return hours;
}

function spendIn(start: Date, end: Date): number {
  return hoursCountedIn(start, end).reduce(
    (sum: number, time: number): number => {
      return sum + costOfHour(time);
    },
    0,
  );
}

function at(iso: string): Date {
  return new Date(iso);
}

function windowKey(start: Date, end: Date): string {
  return `${start.toISOString()}/${end.toISOString()}`;
}

function paramsOf(call: Array<unknown>): { startDate: Date; endDate: Date } {
  return call[0] as { startDate: Date; endDate: Date };
}

function fetchesOf(mock: MockFunction): Array<CostFetch> {
  return mock.mock.calls.map((call: Array<unknown>): CostFetch => {
    return { start: paramsOf(call).startDate, end: paramsOf(call).endDate };
  });
}

function latestWindowOf(mock: MockFunction): string {
  const fetches: Array<CostFetch> = fetchesOf(mock);
  const latest: CostFetch | undefined = fetches[fetches.length - 1];

  if (!latest) {
    throw new Error("Never fetched");
  }

  return windowKey(latest.start, latest.end);
}

function spendChart(): HTMLElement {
  const chart: HTMLElement | null = screen
    .queryByTestId("line-chart")
    ?.closest('[class~="group/zoomhint"]') as HTMLElement | null;

  if (!chart) {
    throw new Error("The spend chart is not drawn");
  }

  return chart;
}

function tile(title: string): string {
  const heading: HTMLElement = screen.getByText(title);
  const card: HTMLElement | null = heading.closest(".rounded-xl");

  return card?.textContent || "";
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function formatDollars(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function rowStartingAt(start: Date): RealChartRow {
  const row: RealChartRow | undefined = realRowsOf(spendChart()).find(
    (candidate: RealChartRow): boolean => {
      return candidate.bucketStart === start.toISOString();
    },
  );

  if (!row) {
    throw new Error(`No bar starts at ${start.toISOString()}`);
  }

  return row;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  const hourlyRows: (params: unknown) => Array<number> = (
    params: unknown,
  ): Array<number> => {
    const window: { startDate: Date; endDate: Date } = params as {
      startDate: Date;
      endDate: Date;
    };
    return hoursCountedIn(window.startDate, window.endDate);
  };

  mockFetchCostTrend.mockReset();
  mockFetchCostTrend.mockImplementation((params: unknown) => {
    return Promise.resolve(
      hourlyRows(params).map((time: number): { x: Date; y: number } => {
        return { x: new Date(time), y: costOfHour(time) };
      }),
    );
  });

  const spendOf: (params: unknown) => number = (params: unknown): number => {
    return hourlyRows(params).reduce((sum: number, time: number): number => {
      return sum + costOfHour(time);
    }, 0);
  };

  mockFetchNamespaceBreakdown.mockReset();
  mockFetchNamespaceBreakdown.mockImplementation((params: unknown) => {
    const spend: number = spendOf(params);
    return Promise.resolve(
      spend === 0
        ? []
        : [
            {
              namespace: "shop",
              cpuCost: spend / 2,
              ramCost: spend / 2,
              pvCost: 0,
              otherCost: 0,
              totalCost: spend,
              efficiency: 0.5,
            },
          ],
    );
  });

  mockFetchWorkloadBreakdown.mockReset();
  mockFetchWorkloadBreakdown.mockImplementation(() => {
    return Promise.resolve([]);
  });

  mockFetchClusterBreakdown.mockReset();
  mockFetchClusterBreakdown.mockImplementation((params: unknown) => {
    const spend: number = spendOf(params);
    return Promise.resolve(
      spend === 0
        ? []
        : [
            {
              clusterName: "production-us-east-1",
              totalCost: spend,
              workloadCost: spend,
              idleCost: 0,
              efficiency: 0.5,
            },
          ],
    );
  });

  mockFetchRightSizing.mockReset();
  mockFetchRightSizing.mockImplementation(() => {
    return Promise.resolve({
      recommendations: [],
      summary: {
        totalMonthlySavings: 0,
        totalMonthlyIncrease: 0,
        overprovisionedCount: 0,
        underprovisionedCount: 0,
        noRequestSetCount: 0,
        analyzedCount: 0,
        missingMemoryPeakCount: 0,
      },
      observedHours: 168,
    });
  });

  mockGetClusterList.mockReset();
  mockGetClusterList.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0 });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the cluster Costs page zooms to exactly the hours dragged across", () => {
  const WEEK: string = windowKey(ONE_WEEK_AGO, NOW);

  async function renderClusterCosts(): Promise<void> {
    render(<KubernetesClusterCosts {...PAGE_PROPS} />);
    await settleRealRows();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  }

  function expectEveryFetchFor(window: string): void {
    expect({
      trend: latestWindowOf(mockFetchCostTrend),
      namespaces: latestWindowOf(mockFetchNamespaceBreakdown),
      workloads: latestWindowOf(mockFetchWorkloadBreakdown),
      rightSizing: latestWindowOf(mockFetchRightSizing),
    }).toEqual({
      trend: window,
      namespaces: window,
      workloads: window,
      rightSizing: window,
    });
  }

  test("the week's bars sit on the hours the cost rows start at, though the week does not", async () => {
    await renderClusterCosts();

    expect(realRowsWindowOf(spendChart())).toBe(WEEK);
    expect(ONE_WEEK_AGO.toISOString()).toBe("2026-09-21T12:23:11.000Z");

    // The spike's bar: labelled 10:00, starting at 10:00 - not at 10:23.
    const spike: RealChartRow = rowStartingAt(at("2026-09-27T10:00:00.000Z"));
    expect(spike.label).toContain("10:00");
    expect(spike.values).toEqual({ "Total Cost": 100 });

    for (const row of realRowsOf(spendChart())) {
      expect(new Date(row.bucketStart).getTime() % HOUR_MS).toBe(0);
    }

    expect(tile("Total Spend")).toContain(
      formatDollars(spendIn(ONE_WEEK_AGO, NOW)),
    );
    expect(tile("Total Spend")).toContain("$316.00");
  });

  test("a drag across the 10:00 and 11:00 bars reads those two hours - not the noon hour after them", async () => {
    await renderClusterCosts();

    await dragRealRows(
      spendChart(),
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:00:00.000Z"),
    );

    const selected: string = windowKey(
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:59:59.999Z"),
    );

    expectEveryFetchFor(selected);
    expect(
      hoursCountedIn(
        at("2026-09-27T10:00:00.000Z"),
        at("2026-09-27T11:59:59.999Z"),
      ).map((time: number): string => {
        return new Date(time).toISOString();
      }),
    ).toEqual(["2026-09-27T10:00:00.000Z", "2026-09-27T11:00:00.000Z"]);
    // $100 + $1: the spike and the hour after it, and nothing else.
    expect(tile("Total Spend")).toContain("$101.00");
    expect(tile("Workload Spend")).toContain("$101.00");
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    expect(resetZoomButton()).toBeVisible();
    // The zoomed chart draws those two hours and no other.
    expect(
      realRowsOf(spendChart())
        .filter((row: RealChartRow): boolean => {
          return Object.keys(row.values).length > 0;
        })
        .map((row: RealChartRow): string => {
          return row.bucketStart;
        }),
    ).toEqual(["2026-09-27T10:00:00.000Z", "2026-09-27T11:00:00.000Z"]);
  });

  test("a drag the other way round reads the same two hours", async () => {
    await renderClusterCosts();

    await dragRealRows(
      spendChart(),
      at("2026-09-27T11:00:00.000Z"),
      at("2026-09-27T10:00:00.000Z"),
    );

    expectEveryFetchFor(
      windowKey(at("2026-09-27T10:00:00.000Z"), at("2026-09-27T11:59:59.999Z")),
    );
    expect(tile("Total Spend")).toContain("$101.00");
  });

  test("a drag across six bars reads six hours", async () => {
    await renderClusterCosts();

    await dragRealRows(
      spendChart(),
      at("2026-09-27T08:00:00.000Z"),
      at("2026-09-27T13:00:00.000Z"),
    );

    expectEveryFetchFor(
      windowKey(at("2026-09-27T08:00:00.000Z"), at("2026-09-27T13:59:59.999Z")),
    );
    // 08:00 to 13:00: five $1 hours and the $100 spike.
    expect(tile("Total Spend")).toContain("$105.00");
  });

  test("a drag across the last two bars reads up to now: the hour still filling up counts, nothing past it", async () => {
    await renderClusterCosts();

    await dragRealRows(
      spendChart(),
      at("2026-09-28T11:00:00.000Z"),
      at("2026-09-28T12:00:00.000Z"),
    );

    expectEveryFetchFor(windowKey(at("2026-09-28T11:00:00.000Z"), NOW));
    expect(tile("Total Spend")).toContain("$2.00");
  });

  test("two days, then six hours inside them, then one double-click: each zoom reads exactly its hours, and the reset the whole week", async () => {
    await renderClusterCosts();

    await dragRealRows(
      spendChart(),
      at("2026-09-25T00:00:00.000Z"),
      at("2026-09-26T23:00:00.000Z"),
    );

    expectEveryFetchFor(
      windowKey(at("2026-09-25T00:00:00.000Z"), at("2026-09-26T23:59:59.999Z")),
    );
    // Forty-eight $1 hours: the 25th and the 26th, and not midnight on the 27th.
    expect(tile("Total Spend")).toContain("$48.00");

    /*
     * Two days are drawn half-hourly. Dragging from the 06:00 bar to the
     * 11:30 one covers six whole hours.
     */
    expect(rowStartingAt(at("2026-09-26T11:30:00.000Z"))).toBeTruthy();
    await dragRealRows(
      spendChart(),
      at("2026-09-26T06:00:00.000Z"),
      at("2026-09-26T11:30:00.000Z"),
    );

    expectEveryFetchFor(
      windowKey(at("2026-09-26T06:00:00.000Z"), at("2026-09-26T11:59:59.999Z")),
    );
    expect(tile("Total Spend")).toContain("$6.00");

    await doubleClickRealRows(spendChart());

    expectEveryFetchFor(WEEK);
    expect(tile("Total Spend")).toContain("$316.00");
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_WEEK,
    );
    expect(resetZoomButton()).toBeNull();
  });

  describe("on the past day, drawn quarter-hourly", () => {
    async function renderPastDay(): Promise<void> {
      await renderClusterCosts();
      fireEvent.click(screen.getByTestId("card-picker"));
      await settleRealRows();
      expect(realRowsWindowOf(spendChart())).toBe(windowKey(ONE_DAY_AGO, NOW));
      expect(rowStartingAt(at("2026-09-28T10:15:00.000Z"))).toBeTruthy();
    }

    test("a half-hour drag inside the $50 hour is widened to that hour, and reads it alone", async () => {
      await renderPastDay();

      await dragRealRows(
        spendChart(),
        at("2026-09-28T10:15:00.000Z"),
        at("2026-09-28T10:30:00.000Z"),
      );

      expectEveryFetchFor(
        windowKey(
          at("2026-09-28T10:00:00.000Z"),
          at("2026-09-28T10:59:59.999Z"),
        ),
      );
      expect(tile("Total Spend")).toContain("$50.00");
    });

    test("a half-hour drag over the start of the $50 hour reads that hour alone", async () => {
      await renderPastDay();

      await dragRealRows(
        spendChart(),
        at("2026-09-28T09:45:00.000Z"),
        at("2026-09-28T10:00:00.000Z"),
      );

      expectEveryFetchFor(
        windowKey(
          at("2026-09-28T09:30:00.000Z"),
          at("2026-09-28T10:29:59.999Z"),
        ),
      );
      expect(tile("Total Spend")).toContain("$50.00");
    });

    test("an hour's drag from 10:45 reads the one hour it covers the start of - 11:00, not the $50 hour", async () => {
      await renderPastDay();

      await dragRealRows(
        spendChart(),
        at("2026-09-28T10:45:00.000Z"),
        at("2026-09-28T11:30:00.000Z"),
      );

      expectEveryFetchFor(
        windowKey(
          at("2026-09-28T10:45:00.000Z"),
          at("2026-09-28T11:44:59.999Z"),
        ),
      );
      expect(tile("Total Spend")).toContain("$1.00");
    });
  });
});

describe("the project Costs page zooms to exactly the hours dragged across", () => {
  async function renderProjectCosts(): Promise<void> {
    render(<KubernetesCosts {...PAGE_PROPS} />);
    await settleRealRows();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  }

  test("a drag across the 10:00 and 11:00 bars reads those two hours across every cluster", async () => {
    await renderProjectCosts();

    expect(tile("Total Spend")).toContain("$316.00");

    await dragRealRows(
      spendChart(),
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:00:00.000Z"),
    );

    const selected: string = windowKey(
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:59:59.999Z"),
    );

    expect(latestWindowOf(mockFetchCostTrend)).toBe(selected);
    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(selected);
    expect(tile("Total Spend")).toContain("$101.00");
    expect(screen.getByText("production-us-east-1")).toBeInTheDocument();
  });

  test("a double-click after the zoom reads the whole week again", async () => {
    await renderProjectCosts();

    await dragRealRows(
      spendChart(),
      at("2026-09-27T10:00:00.000Z"),
      at("2026-09-27T11:00:00.000Z"),
    );
    await doubleClickRealRows(spendChart());

    expect(latestWindowOf(mockFetchCostTrend)).toBe(
      windowKey(ONE_WEEK_AGO, NOW),
    );
    expect(tile("Total Spend")).toContain("$316.00");
  });
});
