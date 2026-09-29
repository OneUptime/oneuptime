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
  chartZoomStandIns,
  doubleClickOn,
  dragAcross,
  resetChartZoomStandIns,
  settle,
  windowKey,
  windowOf,
} from "./ChartZoomHarness";

/*
 * Issue #4105 on the Kubernetes Costs pages - the cluster's and the
 * project-wide one. Their spend-over-time chart zooms the PAGE: the spend
 * tiles, both breakdown tables and the right-sizing card are all read for
 * the page's window, so a drag across the chart must re-read every one of
 * them for the window dragged out, and a double-click (or Reset zoom beside
 * the card's picker) must put them all back on the week they started on.
 *
 * Cost rows are hourly, so a selection under an hour is widened to an hour
 * around it before the page zooms - otherwise the window would usually hold
 * no cost row at all and every figure on the page would read $0.
 *
 * The pages, their EmbeddedMetricCard and the cost chart are real; the cost
 * fetches are stubbed and answer with one $1 row per hour of exactly the
 * window asked for, so the Total Spend tile reads back the window's length.
 * The line chart is stood in for (see ChartZoomHarness).
 */

type CostFetch = { start: Date; end: Date };

const mockFetchCostTrend: MockFunction = getJestMockFunction();
const mockFetchNamespaceBreakdown: MockFunction = getJestMockFunction();
const mockFetchWorkloadBreakdown: MockFunction = getJestMockFunction();
const mockFetchClusterBreakdown: MockFunction = getJestMockFunction();
const mockFetchRightSizing: MockFunction = getJestMockFunction();
const mockGetClusterList: MockFunction = getJestMockFunction();

// While true, no window has any cost rows.
let mockCostIsQuiet: boolean = false;

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
import KubernetesCostTrendChart from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesCostTrendChart";
import {
  CostZoomWindow,
  MIN_COST_ZOOM_SPAN_IN_MS,
  widenCostZoomWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * Half past, so the week holds exactly 168 hourly rows (the query's bounds
 * are inclusive: a window ending on the hour would also take the next
 * hour's row).
 */
const NOW: Date = new Date("2026-09-28T12:30:00.000Z");
const ONE_WEEK_AGO: Date = new Date(NOW.getTime() - 7 * DAY_MS);

/*
 * Two whole days inside the week. 49 hourly rows start in it - 00:00 on
 * the 24th through 00:00 on the 26th - so "$49.00" spent.
 */
const DRAG_START: Date = new Date("2026-09-24T00:00:00.000Z");
const DRAG_END: Date = new Date("2026-09-26T00:00:00.000Z");
// Six hours inside those two days.
const NESTED_DRAG_START: Date = new Date("2026-09-25T06:00:00.000Z");
const NESTED_DRAG_END: Date = new Date("2026-09-25T12:00:00.000Z");

const WEEK_WINDOW: string = windowKey(ONE_WEEK_AGO, NOW);
const DRAG_WINDOW: string = windowKey(DRAG_START, DRAG_END);
const NESTED_DRAG_WINDOW: string = windowKey(
  NESTED_DRAG_START,
  NESTED_DRAG_END,
);

const NO_COST_DATA: string =
  "No cost data reported for the selected time range.";

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

function totalSpendTile(): string {
  const title: HTMLElement = screen.getByText("Total Spend");
  const tile: HTMLElement | null = title.closest(".rounded-xl");

  return tile?.textContent || "";
}

function picker(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetChartZoomStandIns();
  mockCostIsQuiet = false;

  const hourlyRows: (params: unknown) => Array<number> = (
    params: unknown,
  ): Array<number> => {
    if (mockCostIsQuiet) {
      return [];
    }
    const window: { startDate: Date; endDate: Date } = params as {
      startDate: Date;
      endDate: Date;
    };
    return hourStartsWithin(window.startDate, window.endDate);
  };

  mockFetchCostTrend.mockReset();
  mockFetchCostTrend.mockImplementation((params: unknown) => {
    return Promise.resolve(
      hourlyRows(params).map((time: number): { x: Date; y: number } => {
        return { x: new Date(time), y: 1 };
      }),
    );
  });

  mockFetchNamespaceBreakdown.mockReset();
  mockFetchNamespaceBreakdown.mockImplementation((params: unknown) => {
    const hours: number = hourlyRows(params).length;
    return Promise.resolve(
      hours === 0
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
          ],
    );
  });

  mockFetchWorkloadBreakdown.mockReset();
  mockFetchWorkloadBreakdown.mockImplementation(() => {
    return Promise.resolve([]);
  });

  mockFetchClusterBreakdown.mockReset();
  mockFetchClusterBreakdown.mockImplementation((params: unknown) => {
    const hours: number = hourlyRows(params).length;
    return Promise.resolve(
      hours === 0
        ? []
        : [
            {
              clusterName: "production-us-east-1",
              totalCost: hours,
              workloadCost: hours,
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

describe("widenCostZoomWindow", () => {
  const WINDOW_START: Date = ONE_WEEK_AGO;
  const WINDOW_END: Date = NOW;

  function widen(start: string, end: string): string {
    const widened: CostZoomWindow = widenCostZoomWindow({
      startTime: new Date(start),
      endTime: new Date(end),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    return windowKey(widened.startTime, widened.endTime);
  }

  test("keeps a selection of an hour or more as it is", () => {
    expect(widen("2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00.000Z")).toBe(
      "2026-09-25T10:00:00.000Z/2026-09-25T11:00:00.000Z",
    );
    expect(widen("2026-09-24T00:00:00.000Z", "2026-09-26T00:00:00.000Z")).toBe(
      DRAG_WINDOW,
    );
  });

  test("puts a right-to-left selection the right way round", () => {
    expect(widen("2026-09-26T00:00:00.000Z", "2026-09-24T00:00:00.000Z")).toBe(
      DRAG_WINDOW,
    );
  });

  test("widens a selection under an hour to an hour centred on it", () => {
    expect(widen("2026-09-25T10:10:00.000Z", "2026-09-25T10:40:00.000Z")).toBe(
      "2026-09-25T09:55:00.000Z/2026-09-25T10:55:00.000Z",
    );
    expect(MIN_COST_ZOOM_SPAN_IN_MS).toBe(HOUR_MS);
  });

  test("an hour always holds the start of an hour - the row the page can show", () => {
    const widened: CostZoomWindow = widenCostZoomWindow({
      startTime: new Date("2026-09-25T10:07:00.000Z"),
      endTime: new Date("2026-09-25T10:37:00.000Z"),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(hourStartsWithin(widened.startTime, widened.endTime)).toHaveLength(
      1,
    );
  });

  test("never reaches past the end of the window on screen (so never past now)", () => {
    const tenMinutesAgo: string = new Date(
      NOW.getTime() - 10 * 60 * 1000,
    ).toISOString();

    expect(widen(tenMinutesAgo, NOW.toISOString())).toBe(
      windowKey(new Date(NOW.getTime() - HOUR_MS), NOW),
    );
  });

  test("never reaches before the start of the window on screen", () => {
    const start: string = ONE_WEEK_AGO.toISOString();
    const tenMinutesIn: string = new Date(
      ONE_WEEK_AGO.getTime() + 10 * 60 * 1000,
    ).toISOString();

    expect(widen(start, tenMinutesIn)).toBe(
      windowKey(ONE_WEEK_AGO, new Date(ONE_WEEK_AGO.getTime() + HOUR_MS)),
    );
  });

  test("on a window under an hour, a drag keeps the whole window: there is nothing finer to see", () => {
    const thirtyMinutesAgo: Date = new Date(NOW.getTime() - 30 * 60 * 1000);
    const widened: CostZoomWindow = widenCostZoomWindow({
      startTime: new Date(NOW.getTime() - 20 * 60 * 1000),
      endTime: new Date(NOW.getTime() - 15 * 60 * 1000),
      windowStart: thirtyMinutesAgo,
      windowEnd: NOW,
    });

    expect(windowKey(widened.startTime, widened.endTime)).toBe(
      windowKey(thirtyMinutesAgo, NOW),
    );
  });

  test("an empty or backwards window leaves the selection alone", () => {
    const widened: CostZoomWindow = widenCostZoomWindow({
      startTime: new Date("2026-09-28T11:40:00.000Z"),
      endTime: new Date("2026-09-28T11:45:00.000Z"),
      windowStart: NOW,
      windowEnd: NOW,
    });

    expect(windowKey(widened.startTime, widened.endTime)).toBe(
      "2026-09-28T11:40:00.000Z/2026-09-28T11:45:00.000Z",
    );
  });
});

describe("KubernetesCostTrendChart", () => {
  const TREND: Array<{ x: Date; y: number }> = [
    { x: new Date("2026-09-25T10:00:00.000Z"), y: 1 },
    { x: new Date("2026-09-25T11:00:00.000Z"), y: 1 },
  ];
  const WINDOW: InBetween<Date> = new InBetween<Date>(ONE_WEEK_AGO, NOW);

  function zoom(
    isZoomed: boolean,
    zoomToTimeRange: (startTime: Date, endTime: Date) => void,
    resetZoom: () => void,
  ): TimeRangeZoom {
    return {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_WEEK } : null,
      zoomToTimeRange: zoomToTimeRange,
      resetZoom: resetZoom,
    };
  }

  test("outside a page that zooms it draws the chart with no zoom and no hint", () => {
    render(
      <KubernetesCostTrendChart
        trend={TREND}
        isLoading={false}
        startAndEndDate={WINDOW}
        syncid="costs"
      />,
    );

    const drawn: { select: unknown; reset: unknown } | undefined =
      chartZoomStandIns.lineCharts[chartZoomStandIns.lineCharts.length - 1];

    expect(drawn?.select).toBeUndefined();
    expect(drawn?.reset).toBeUndefined();
    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
  });

  test("inside one, a sub-hour drag reaches the page widened to an hour", () => {
    const zoomTo: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={zoom(
          false,
          zoomTo as unknown as (startTime: Date, endTime: Date) => void,
          () => {},
        )}
      >
        <KubernetesCostTrendChart
          trend={TREND}
          isLoading={false}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    chartZoomStandIns.dragWindow = {
      start: new Date("2026-09-25T10:10:00.000Z"),
      end: new Date("2026-09-25T10:40:00.000Z"),
    };
    fireEvent.click(screen.getByTestId("chart-drag"));

    expect(zoomTo).toHaveBeenCalledTimes(1);
    expect(
      windowKey(
        zoomTo.mock.calls[0]![0] as Date,
        zoomTo.mock.calls[0]![1] as Date,
      ),
    ).toBe("2026-09-25T09:55:00.000Z/2026-09-25T10:55:00.000Z");
  });

  test("offers the page's reset only while the page is zoomed", () => {
    const resetZoom: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <TimeRangeZoomProvider
        zoom={zoom(false, () => {}, resetZoom as unknown as () => void)}
      >
        <KubernetesCostTrendChart
          trend={TREND}
          isLoading={false}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    expect(
      chartZoomStandIns.lineCharts[chartZoomStandIns.lineCharts.length - 1]
        ?.reset,
    ).toBeUndefined();

    rerender(
      <TimeRangeZoomProvider
        zoom={zoom(true, () => {}, resetZoom as unknown as () => void)}
      >
        <KubernetesCostTrendChart
          trend={TREND}
          isLoading={false}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(screen.getByTestId("chart-plot"));

    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("names the drag above the chart, revealed on hover, and keeps the row while loading", () => {
    const { rerender } = render(
      <TimeRangeZoomProvider
        zoom={zoom(
          false,
          () => {},
          () => {},
        )}
      >
        <KubernetesCostTrendChart
          trend={TREND}
          isLoading={true}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Drag to zoom",
    );

    rerender(
      <TimeRangeZoomProvider
        zoom={zoom(
          false,
          () => {},
          () => {},
        )}
      >
        <KubernetesCostTrendChart
          trend={TREND}
          isLoading={false}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);

    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint.closest('[class~="group/zoomhint"]')).toBe(
      screen.getByTestId("line-chart").closest('[class~="group/zoomhint"]'),
    );
  });

  test("the no-cost message resets a zoom on a double-click, and only while zoomed", () => {
    const resetZoom: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <TimeRangeZoomProvider
        zoom={zoom(false, () => {}, resetZoom as unknown as () => void)}
      >
        <KubernetesCostTrendChart
          trend={[]}
          isLoading={false}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(screen.getByText(NO_COST_DATA));
    expect(resetZoom).not.toHaveBeenCalled();

    rerender(
      <TimeRangeZoomProvider
        zoom={zoom(true, () => {}, resetZoom as unknown as () => void)}
      >
        <KubernetesCostTrendChart
          trend={[]}
          isLoading={false}
          startAndEndDate={WINDOW}
          syncid="costs"
        />
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(screen.getByText(NO_COST_DATA));
    expect(resetZoom).toHaveBeenCalledTimes(1);
  });
});

describe("the cluster Costs page", () => {
  async function renderClusterCosts(): Promise<void> {
    render(<KubernetesClusterCosts {...PAGE_PROPS} />);
    await settle();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  }

  function expectEveryFetchFor(window: string): void {
    expect(latestWindowOf(mockFetchCostTrend)).toBe(window);
    expect(latestWindowOf(mockFetchNamespaceBreakdown)).toBe(window);
    expect(latestWindowOf(mockFetchWorkloadBreakdown)).toBe(window);
    expect(latestWindowOf(mockFetchRightSizing)).toBe(window);
  }

  test("opens on the past week: the chart, the tiles, both tables and right-sizing all read it", async () => {
    await renderClusterCosts();

    expect(windowOf(spendChart())).toBe(WEEK_WINDOW);
    expectEveryFetchFor(WEEK_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(totalSpendTile()).toContain("$168.00");
    expect(resetZoomButton()).toBeNull();
  });

  test("a drag across the spend chart re-reads the whole page for the dragged window", async () => {
    await renderClusterCosts();

    await dragAcross(spendChart(), DRAG_START, DRAG_END);

    expect(windowOf(spendChart())).toBe(DRAG_WINDOW);
    expectEveryFetchFor(DRAG_WINDOW);
    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(totalSpendTile()).toContain("$49.00");
    expect(resetZoomButton()).toBeVisible();
  });

  test("a double-click on the chart puts the whole page back on the past week", async () => {
    await renderClusterCosts();

    await dragAcross(spendChart(), DRAG_START, DRAG_END);
    await doubleClickOn(spendChart());

    expect(windowOf(spendChart())).toBe(WEEK_WINDOW);
    expectEveryFetchFor(WEEK_WINDOW);
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(totalSpendTile()).toContain("$168.00");
    expect(resetZoomButton()).toBeNull();
  });

  test("Reset zoom beside the card's picker does the same", async () => {
    await renderClusterCosts();

    await dragAcross(spendChart(), DRAG_START, DRAG_END);
    fireEvent.click(resetZoomButton()!);
    await settle();

    expect(windowOf(spendChart())).toBe(WEEK_WINDOW);
    expectEveryFetchFor(WEEK_WINDOW);
  });

  test("zooming twice and resetting once returns to the past week", async () => {
    await renderClusterCosts();

    await dragAcross(spendChart(), DRAG_START, DRAG_END);
    await dragAcross(spendChart(), NESTED_DRAG_START, NESTED_DRAG_END);

    expect(windowOf(spendChart())).toBe(NESTED_DRAG_WINDOW);
    expectEveryFetchFor(NESTED_DRAG_WINDOW);

    await doubleClickOn(spendChart());

    expect(windowOf(spendChart())).toBe(WEEK_WINDOW);
    expectEveryFetchFor(WEEK_WINDOW);
  });

  test("a sub-hour drag zooms to the hour around it, so the page still has a cost row to show", async () => {
    await renderClusterCosts();

    await dragAcross(
      spendChart(),
      new Date("2026-09-25T10:10:00.000Z"),
      new Date("2026-09-25T10:40:00.000Z"),
    );

    const hour: string = "2026-09-25T09:55:00.000Z/2026-09-25T10:55:00.000Z";

    expect(windowOf(spendChart())).toBe(hour);
    expectEveryFetchFor(hour);
    expect(totalSpendTile()).toContain("$1.00");
  });

  test("a drag up to now zooms to the last hour, never past now", async () => {
    await renderClusterCosts();

    await dragAcross(
      spendChart(),
      new Date(NOW.getTime() - 10 * 60 * 1000),
      NOW,
    );

    expectEveryFetchFor(windowKey(new Date(NOW.getTime() - HOUR_MS), NOW));
  });

  test("a zoom into a stretch with no cost rows shows the message, and a double-click on it goes back", async () => {
    await renderClusterCosts();

    mockCostIsQuiet = true;
    await dragAcross(spendChart(), DRAG_START, DRAG_END);

    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(resetZoomButton()).toBeVisible();

    mockCostIsQuiet = false;
    fireEvent.doubleClick(screen.getAllByText(NO_COST_DATA)[0]!);
    await settle();

    expect(windowOf(spendChart())).toBe(WEEK_WINDOW);
    expectEveryFetchFor(WEEK_WINDOW);
    expect(resetZoomButton()).toBeNull();
  });

  test("picking a range in the card's picker ends the zoom", async () => {
    await renderClusterCosts();

    await dragAcross(spendChart(), DRAG_START, DRAG_END);
    expect(resetZoomButton()).toBeVisible();

    fireEvent.click(screen.getByTestId("card-picker"));
    await settle();

    expect(picker()).toBe(TimeRange.PAST_ONE_DAY);
    expect(resetZoomButton()).toBeNull();
    expect(windowOf(spendChart())).toBe(
      windowKey(new Date(NOW.getTime() - DAY_MS), NOW),
    );
    expect(
      chartZoomStandIns.lineCharts[chartZoomStandIns.lineCharts.length - 1]
        ?.reset,
    ).toBeUndefined();
  });

  test("the spend chart takes the page's zoom, widened, and names the drag", async () => {
    await renderClusterCosts();

    const drawn: { hostSelect: unknown; select: unknown } | undefined =
      chartZoomStandIns.lineCharts[chartZoomStandIns.lineCharts.length - 1];

    // Its own handler: the page's zoom behind the one-hour widening.
    expect(drawn?.hostSelect).toBeInstanceOf(Function);
    expect(drawn?.select).toBe(drawn?.hostSelect);
    expect(
      within(spendChart()).getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Drag to zoom");
  });
});

describe("the project Costs page", () => {
  async function renderProjectCosts(): Promise<void> {
    render(<KubernetesCosts {...PAGE_PROPS} />);
    await settle();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  }

  test("a drag across the spend chart re-reads the tiles and the cluster table for the window", async () => {
    await renderProjectCosts();

    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(WEEK_WINDOW);
    const clusterListsBefore: number = mockGetClusterList.mock.calls.length;

    await dragAcross(spendChart(), DRAG_START, DRAG_END);

    expect(windowOf(spendChart())).toBe(DRAG_WINDOW);
    expect(latestWindowOf(mockFetchCostTrend)).toBe(DRAG_WINDOW);
    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(DRAG_WINDOW);
    expect(mockGetClusterList.mock.calls.length).toBe(clusterListsBefore + 1);
    expect(totalSpendTile()).toContain("$49.00");
    expect(picker()).toBe(TimeRange.CUSTOM);
    expect(resetZoomButton()).toBeVisible();
  });

  test("a double-click on the chart puts the page back on the past week", async () => {
    await renderProjectCosts();

    await dragAcross(spendChart(), DRAG_START, DRAG_END);
    await doubleClickOn(spendChart());

    expect(windowOf(spendChart())).toBe(WEEK_WINDOW);
    expect(latestWindowOf(mockFetchCostTrend)).toBe(WEEK_WINDOW);
    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(WEEK_WINDOW);
    expect(totalSpendTile()).toContain("$168.00");
    expect(picker()).toBe(TimeRange.PAST_ONE_WEEK);
    expect(resetZoomButton()).toBeNull();
  });

  test("a sub-hour drag is widened to an hour here too", async () => {
    await renderProjectCosts();

    await dragAcross(
      spendChart(),
      new Date("2026-09-25T10:10:00.000Z"),
      new Date("2026-09-25T10:40:00.000Z"),
    );

    expect(latestWindowOf(mockFetchClusterBreakdown)).toBe(
      "2026-09-25T09:55:00.000Z/2026-09-25T10:55:00.000Z",
    );
  });
});
