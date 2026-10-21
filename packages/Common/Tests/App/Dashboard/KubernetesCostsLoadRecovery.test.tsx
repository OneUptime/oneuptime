/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
  doubleClickOn,
  dragAcross,
  resetChartZoomStandIns,
  settle,
  windowKey,
  windowOf,
} from "./ChartZoomHarness";

/*
 * Issue #4105 on the Kubernetes Costs pages: what a load the zoom set off
 * does when it fails, and what the Spend card's Refresh does while zoomed.
 *
 * - A failed load used to replace the whole page with a bare message: the
 *   zoom scope, the picker, Reset zoom and every Refresh went with it, so a
 *   drag during a network blip left the reader nothing to retry, undo or
 *   pick. The error now takes the place of the chart and the tables only,
 *   the tiles read "—" instead of the previous window's figures, and the
 *   error takes the reset double-click while zoomed.
 * - Every zoom is a Custom window, which Refresh re-resolves to the very
 *   same instants, so the Spend card's Refresh changed nothing the page's
 *   load could see and did nothing while zoomed - not even after an error.
 *   It now reloads the page.
 *
 * The pages, their EmbeddedMetricCard, the cost chart and the zoom scope
 * are real; the cost fetches are stubbed (one $1 row per hour that starts
 * in the window, both ends included), and can be made to fail. The line
 * chart is stood in for (see ChartZoomHarness).
 */

type CostFetch = { start: Date; end: Date };

const mockFetchCostTrend: MockFunction = getJestMockFunction();
const mockFetchNamespaceBreakdown: MockFunction = getJestMockFunction();
const mockFetchWorkloadBreakdown: MockFunction = getJestMockFunction();
const mockFetchClusterBreakdown: MockFunction = getJestMockFunction();
const mockFetchRightSizing: MockFunction = getJestMockFunction();
const mockGetClusterList: MockFunction = getJestMockFunction();

// While true, every cost fetch fails.
let mockCostFails: boolean = false;

/*
 * While set, cost fetches wait for the test to answer them, to play an old
 * load's failure against a newer load.
 */
let heldCostFetches: Array<{
  release: () => void;
  fail: () => void;
}> | null = null;

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
        "./ChartZoomHarness",
      ) as typeof import("./ChartZoomHarness")
    ).StandInLineChart,
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
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const NOW: Date = new Date("2026-09-28T12:30:00.000Z");
const ONE_WEEK_AGO: Date = new Date(NOW.getTime() - 7 * DAY_MS);

// Two whole days inside the week; the page reads them to the millisecond before the 26th.
const DRAG_START: Date = new Date("2026-09-24T00:00:00.000Z");
const DRAG_END: Date = new Date("2026-09-26T00:00:00.000Z");
const ZOOMED_END: Date = new Date(DRAG_END.getTime() - 1);

const WEEK_WINDOW: string = windowKey(ONE_WEEK_AGO, NOW);
const ZOOMED_WINDOW: string = windowKey(DRAG_START, ZOOMED_END);

const LOAD_ERROR: string = "Could not load";

// The hours a window's cost rows start at: [start, end], as the query reads.
function hourStartsWithin(start: Date, end: Date): Array<number> {
  const hours: Array<number> = [];
  const first: number = Math.ceil(start.getTime() / HOUR_MS) * HOUR_MS;

  for (let time: number = first; time <= end.getTime(); time += HOUR_MS) {
    hours.push(time);
  }

  return hours;
}

function paramsOf(call: Array<unknown>): { startDate: Date; endDate: Date } {
  return call[0] as { startDate: Date; endDate: Date };
}

function fetchesOf(mock: MockFunction): Array<CostFetch> {
  return mock.mock.calls.map((call: Array<unknown>): CostFetch => {
    return { start: paramsOf(call).startDate, end: paramsOf(call).endDate };
  });
}

function windowsOf(mock: MockFunction): Array<string> {
  return fetchesOf(mock).map((fetch: CostFetch): string => {
    return windowKey(fetch.start, fetch.end);
  });
}

function latestWindowOf(mock: MockFunction): string {
  const windows: Array<string> = windowsOf(mock);
  const latest: string | undefined = windows[windows.length - 1];

  if (!latest) {
    throw new Error("Never fetched");
  }

  return latest;
}

// Answers a cost fetch: now, or when the test releases (or fails) it.
function answer<T>(rows: () => T): Promise<T> {
  if (mockCostFails) {
    return Promise.reject(new Error("503 Service Unavailable"));
  }

  if (!heldCostFetches) {
    return Promise.resolve(rows());
  }

  const held: Array<{ release: () => void; fail: () => void }> =
    heldCostFetches;

  return new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void) => {
      held.push({
        release: () => {
          resolve(rows());
        },
        fail: () => {
          reject(new Error("503 Service Unavailable"));
        },
      });
    },
  );
}

// The card whose title reads exactly `title`.
function card(title: string): HTMLElement {
  const found: HTMLElement | null = screen
    .getByText(title)
    .closest('[data-testid="card"]');

  if (!found) {
    throw new Error(`No card titled "${title}"`);
  }

  return found as HTMLElement;
}

/*
 * The spend chart's box: its hint row, then the chart or what stands in
 * for it. The page's only zoom hint is the chart's.
 */
function chartArea(): HTMLElement {
  const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
  const area: HTMLElement | null = hint.closest('[class~="group/zoomhint"]');

  if (!area) {
    throw new Error("No spend chart area");
  }

  return area as HTMLElement;
}

function tile(title: string): string {
  const heading: HTMLElement = screen.getByText(title);
  const tileElement: HTMLElement | null = heading.closest(".rounded-xl");

  return tileElement?.textContent || "";
}

function picker(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function spendCardRefresh(title: string): HTMLElement {
  return within(card(title)).getByRole("button", { name: "Refresh" });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetChartZoomStandIns();
  mockCostFails = false;
  heldCostFetches = null;

  const hourlyRows: (params: unknown) => Array<number> = (
    params: unknown,
  ): Array<number> => {
    const window: { startDate: Date; endDate: Date } = params as {
      startDate: Date;
      endDate: Date;
    };
    return hourStartsWithin(window.startDate, window.endDate);
  };

  mockFetchCostTrend.mockReset();
  mockFetchCostTrend.mockImplementation((params: unknown) => {
    return answer(() => {
      return hourlyRows(params).map((time: number): { x: Date; y: number } => {
        return { x: new Date(time), y: 1 };
      });
    });
  });

  mockFetchNamespaceBreakdown.mockReset();
  mockFetchNamespaceBreakdown.mockImplementation((params: unknown) => {
    return answer(() => {
      const hours: number = hourlyRows(params).length;
      return hours === 0
        ? []
        : [
            {
              namespace: "shop",
              cpuCost: hours / 2,
              ramCost: hours / 2,
              pvCost: 0,
              otherCost: 0,
              totalCost: hours,
              efficiency: 0.5,
            },
          ];
    });
  });

  mockFetchWorkloadBreakdown.mockReset();
  mockFetchWorkloadBreakdown.mockImplementation(() => {
    return answer(() => {
      return [
        {
          controllerName: "checkout",
          controllerKind: "Deployment",
          namespace: "shop",
          totalCost: 1,
          efficiency: 0.5,
        },
      ];
    });
  });

  mockFetchClusterBreakdown.mockReset();
  mockFetchClusterBreakdown.mockImplementation((params: unknown) => {
    return answer(() => {
      const hours: number = hourlyRows(params).length;
      return hours === 0
        ? []
        : [
            {
              clusterName: "production-us-east-1",
              totalCost: hours,
              workloadCost: hours,
              idleCost: 0,
              efficiency: 0.5,
            },
          ];
    });
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

describe("the cluster Costs page: a failed load leaves the way back", () => {
  async function renderClusterCosts(): Promise<void> {
    render(<KubernetesClusterCosts {...PAGE_PROPS} />);
    await settle();
  }

  async function zoomIntoAFailingLoad(): Promise<void> {
    await renderClusterCosts();
    expect(tile("Total Spend")).toContain("$168.00");

    mockCostFails = true;
    await dragAcross(chartArea(), DRAG_START, DRAG_END);
  }

  function expectEveryCostFetchFor(window: string): void {
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

  test("a zoom whose load fails keeps the picker, Reset zoom and the card's Refresh", async () => {
    await zoomIntoAFailingLoad();

    expect(latestWindowOf(mockFetchCostTrend)).toBe(ZOOMED_WINDOW);
    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(resetZoomButton()).toBeVisible();
    expect(spendCardRefresh("Spend")).toBeVisible();
    // The rest of the page is still there too.
    expect(card("Spend by Namespace")).toBeInTheDocument();
    expect(card("Spend by Workload")).toBeInTheDocument();
  });

  test("the error takes the place of the chart and of both tables, and the tiles show no stale figures", async () => {
    await zoomIntoAFailingLoad();

    expect(within(chartArea()).queryByTestId("line-chart")).toBeNull();
    expect(within(chartArea()).getByText(LOAD_ERROR)).toBeInTheDocument();
    expect(
      within(card("Spend by Namespace")).getByText(LOAD_ERROR),
    ).toBeInTheDocument();
    expect(
      within(card("Spend by Workload")).getByText(LOAD_ERROR),
    ).toBeInTheDocument();
    // Not the week's figures, which the picker no longer shows.
    for (const title of [
      "Total Spend",
      "Workload Spend",
      "Idle Spend",
      "Idle %",
    ]) {
      expect({ title: title, text: tile(title) }).toEqual({
        title: title,
        text: expect.stringContaining("—"),
      });
    }
    expect(tile("Total Spend")).not.toContain("$168.00");
    // The namespace the week's load found is not listed under the error.
    expect(within(card("Spend by Namespace")).queryByText("shop")).toBeNull();
  });

  test("the retry beside the error reloads the zoomed window, and the page comes back", async () => {
    await zoomIntoAFailingLoad();

    const trendFetches: number = mockFetchCostTrend.mock.calls.length;
    mockCostFails = false;
    fireEvent.click(within(chartArea()).getByTestId("refresh-button"));
    await settle();

    expect(mockFetchCostTrend.mock.calls.length).toBe(trendFetches + 1);
    expectEveryCostFetchFor(ZOOMED_WINDOW);
    expect(windowOf(chartArea())).toBe(ZOOMED_WINDOW);
    expect(tile("Total Spend")).toContain("$48.00");
    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(resetZoomButton()).toBeVisible();
  });

  test("a table's Refresh? under the error retries the page too", async () => {
    await zoomIntoAFailingLoad();

    mockCostFails = false;
    fireEvent.click(
      within(card("Spend by Workload")).getByTestId("refresh-button"),
    );
    await settle();

    expectEveryCostFetchFor(ZOOMED_WINDOW);
    expect(within(chartArea()).getByTestId("line-chart")).toBeInTheDocument();
    expect(
      within(card("Spend by Workload")).getByText("checkout"),
    ).toBeTruthy();
  });

  test("the card's Refresh retries it as well", async () => {
    await zoomIntoAFailingLoad();

    mockCostFails = false;
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();

    expectEveryCostFetchFor(ZOOMED_WINDOW);
    expect(tile("Total Spend")).toContain("$48.00");
  });

  test("a double-click on the error puts the page back on the week, and the error is not selectable", async () => {
    await zoomIntoAFailingLoad();

    const message: HTMLElement = within(chartArea()).getByText(LOAD_ERROR);
    expect(message.closest(".select-none")).not.toBe(null);

    mockCostFails = false;
    fireEvent.doubleClick(message);
    await settle();

    expectEveryCostFetchFor(WEEK_WINDOW);
    expect(windowOf(chartArea())).toBe(WEEK_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(resetZoomButton()).toBeNull();
    expect(tile("Total Spend")).toContain("$168.00");
  });

  test("Reset zoom beside the picker gets back from it too", async () => {
    await zoomIntoAFailingLoad();

    mockCostFails = false;
    fireEvent.click(resetZoomButton()!);
    await settle();

    expectEveryCostFetchFor(WEEK_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(tile("Total Spend")).toContain("$168.00");
  });

  test("picking another range after a failed zoom loads that range", async () => {
    await zoomIntoAFailingLoad();

    mockCostFails = false;
    fireEvent.click(screen.getByTestId("card-picker"));
    await settle();

    expectEveryCostFetchFor(windowKey(new Date(NOW.getTime() - DAY_MS), NOW));
    expect(picker()).toBe(TimeRange.PAST_ONE_DAY);
    expect(resetZoomButton()).toBeNull();
    expect(tile("Total Spend")).toContain("$24.00");
  });

  test("a first load that fails shows the error in place, and its double-click does nothing: there is no zoom to undo", async () => {
    mockCostFails = true;
    await renderClusterCosts();

    const trendFetches: number = mockFetchCostTrend.mock.calls.length;
    const message: HTMLElement = within(chartArea()).getByText(LOAD_ERROR);

    fireEvent.doubleClick(message);
    await settle();

    expect(mockFetchCostTrend.mock.calls.length).toBe(trendFetches);
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(resetZoomButton()).toBeNull();

    // And the retry beside it loads the week.
    mockCostFails = false;
    fireEvent.click(within(chartArea()).getByTestId("refresh-button"));
    await settle();

    expectEveryCostFetchFor(WEEK_WINDOW);
    expect(tile("Total Spend")).toContain("$168.00");
  });

  test("a failure from a load the page has moved on from is not shown", async () => {
    await renderClusterCosts();

    // The zoom's load hangs, then the reader resets it.
    heldCostFetches = [];
    await dragAcross(chartArea(), DRAG_START, DRAG_END);
    const zoomLoad: Array<{ release: () => void; fail: () => void }> =
      heldCostFetches;
    heldCostFetches = null;
    expect(zoomLoad.length).toBeGreaterThan(0);

    fireEvent.click(resetZoomButton()!);
    await settle();
    expect(tile("Total Spend")).toContain("$168.00");

    // The abandoned zoom's load fails late.
    for (const fetch of zoomLoad) {
      fetch.fail();
    }
    await settle();

    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(windowOf(chartArea())).toBe(WEEK_WINDOW);
    expect(tile("Total Spend")).toContain("$168.00");
  });
});

describe("the cluster Costs page: the Spend card's Refresh reloads it", () => {
  async function renderClusterCosts(): Promise<void> {
    render(<KubernetesClusterCosts {...PAGE_PROPS} />);
    await settle();
  }

  function callCounts(): Record<string, number> {
    return {
      trend: mockFetchCostTrend.mock.calls.length,
      namespaces: mockFetchNamespaceBreakdown.mock.calls.length,
      workloads: mockFetchWorkloadBreakdown.mock.calls.length,
      rightSizing: mockFetchRightSizing.mock.calls.length,
    };
  }

  function plus(
    counts: Record<string, number>,
    added: number,
  ): Record<string, number> {
    const next: Record<string, number> = {};
    for (const key of Object.keys(counts)) {
      next[key] = (counts[key] || 0) + added;
    }
    return next;
  }

  test("while zoomed, Refresh reloads the trend, both tables and right-sizing for the zoomed window", async () => {
    await renderClusterCosts();
    await dragAcross(chartArea(), DRAG_START, DRAG_END);

    const before: Record<string, number> = callCounts();
    // A minute later: the zoomed window must not move with the clock.
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();

    expect(callCounts()).toEqual(plus(before, 1));
    expect(windowsOf(mockFetchCostTrend).slice(-1)).toEqual([ZOOMED_WINDOW]);
    expect(windowsOf(mockFetchNamespaceBreakdown).slice(-1)).toEqual([
      ZOOMED_WINDOW,
    ]);
    expect(windowsOf(mockFetchWorkloadBreakdown).slice(-1)).toEqual([
      ZOOMED_WINDOW,
    ]);
    expect(windowsOf(mockFetchRightSizing).slice(-1)).toEqual([ZOOMED_WINDOW]);
    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(resetZoomButton()).toBeVisible();
  });

  test("while zoomed, every press reloads again", async () => {
    await renderClusterCosts();
    await dragAcross(chartArea(), DRAG_START, DRAG_END);

    const before: Record<string, number> = callCounts();
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();

    expect(callCounts()).toEqual(plus(before, 2));
  });

  test("Refresh picks up the newest spend for the zoomed window", async () => {
    await renderClusterCosts();
    await dragAcross(chartArea(), DRAG_START, DRAG_END);
    expect(tile("Total Spend")).toContain("$48.00");

    // Late-arriving cost rows: the same window is now worth twice as much.
    mockFetchNamespaceBreakdown.mockImplementation(() => {
      return Promise.resolve([
        {
          namespace: "shop",
          cpuCost: 48,
          ramCost: 48,
          pvCost: 0,
          otherCost: 0,
          totalCost: 96,
          efficiency: 0.5,
        },
      ]);
    });
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();

    expect(tile("Total Spend")).toContain("$96.00");
  });

  test("on the week, Refresh re-resolves the week and reloads every figure once - not twice", async () => {
    await renderClusterCosts();

    const before: Record<string, number> = callCounts();
    const later: Date = new Date(NOW.getTime() + 60 * 1000);
    jest.setSystemTime(later);
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();

    expect(callCounts()).toEqual(plus(before, 1));
    const laterWeek: string = windowKey(
      new Date(later.getTime() - 7 * DAY_MS),
      later,
    );
    expect(latestWindowOf(mockFetchCostTrend)).toBe(laterWeek);
    expect(latestWindowOf(mockFetchRightSizing)).toBe(laterWeek);
  });

  test("after a reset, Refresh reloads the week", async () => {
    await renderClusterCosts();
    await dragAcross(chartArea(), DRAG_START, DRAG_END);
    await doubleClickOn(chartArea());

    const before: Record<string, number> = callCounts();
    fireEvent.click(spendCardRefresh("Spend"));
    await settle();

    expect(callCounts()).toEqual(plus(before, 1));
    expect(latestWindowOf(mockFetchCostTrend)).toBe(WEEK_WINDOW);
  });
});

describe("the project Costs page", () => {
  async function renderProjectCosts(): Promise<void> {
    render(<KubernetesCosts {...PAGE_PROPS} />);
    await settle();
  }

  test("a zoom whose load fails keeps the picker, Reset zoom and Refresh, with the error where the chart and the table were", async () => {
    await renderProjectCosts();
    expect(tile("Total Spend")).toContain("$168.00");

    mockCostFails = true;
    await dragAcross(chartArea(), DRAG_START, DRAG_END);

    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(resetZoomButton()).toBeVisible();
    expect(spendCardRefresh("Kubernetes Spend")).toBeVisible();
    expect(within(chartArea()).getByText(LOAD_ERROR)).toBeInTheDocument();
    expect(
      within(card("Spend by Cluster")).getByText(LOAD_ERROR),
    ).toBeInTheDocument();
    expect(
      within(card("Spend by Cluster")).queryByText("production-us-east-1"),
    ).toBeNull();
    expect(tile("Total Spend")).toContain("—");
    expect(tile("Total Spend")).toContain("could not load");
  });

  test("its retry reloads the zoomed window: the trend, the cluster table and the cluster list", async () => {
    await renderProjectCosts();
    mockCostFails = true;
    await dragAcross(chartArea(), DRAG_START, DRAG_END);

    const clusterLists: number = mockGetClusterList.mock.calls.length;
    mockCostFails = false;
    fireEvent.click(within(chartArea()).getByTestId("refresh-button"));
    await settle();

    expect(latestWindowOf(mockFetchCostTrend)).toBe(ZOOMED_WINDOW);
    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(ZOOMED_WINDOW);
    expect(mockGetClusterList.mock.calls.length).toBe(clusterLists + 1);
    expect(tile("Total Spend")).toContain("$48.00");
    expect(tile("Total Spend")).toContain("across 1 cluster");
  });

  test("a double-click on the error puts the page back on the week", async () => {
    await renderProjectCosts();
    mockCostFails = true;
    await dragAcross(chartArea(), DRAG_START, DRAG_END);

    mockCostFails = false;
    const message: HTMLElement = within(chartArea()).getByText(LOAD_ERROR);
    expect(message.closest(".select-none")).not.toBe(null);
    fireEvent.doubleClick(message);
    await settle();

    expect(latestWindowOf(mockFetchCostTrend)).toBe(WEEK_WINDOW);
    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(WEEK_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(resetZoomButton()).toBeNull();
  });

  test("while zoomed, the card's Refresh reloads the trend, the cluster table and the cluster list", async () => {
    await renderProjectCosts();
    await dragAcross(chartArea(), DRAG_START, DRAG_END);

    const before: [number, number, number] = [
      mockFetchCostTrend.mock.calls.length,
      mockFetchClusterBreakdown.mock.calls.length,
      mockGetClusterList.mock.calls.length,
    ];
    fireEvent.click(spendCardRefresh("Kubernetes Spend"));
    await settle();

    expect([
      mockFetchCostTrend.mock.calls.length,
      mockFetchClusterBreakdown.mock.calls.length,
      mockGetClusterList.mock.calls.length,
    ]).toEqual([before[0] + 1, before[1] + 1, before[2] + 1]);
    expect(latestWindowOf(mockFetchCostTrend)).toBe(ZOOMED_WINDOW);
    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(ZOOMED_WINDOW);
  });

  test("on the week, the card's Refresh reloads once for the re-resolved week", async () => {
    await renderProjectCosts();

    const before: number = mockFetchCostTrend.mock.calls.length;
    const later: Date = new Date(NOW.getTime() + 60 * 1000);
    jest.setSystemTime(later);
    fireEvent.click(spendCardRefresh("Kubernetes Spend"));
    await settle();

    expect(mockFetchCostTrend.mock.calls.length).toBe(before + 1);
    expect(latestWindowOf(mockFetchCostTrend)).toBe(
      windowKey(new Date(later.getTime() - 7 * DAY_MS), later),
    );
  });
});
