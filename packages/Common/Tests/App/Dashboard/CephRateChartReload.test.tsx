/**
 * @timezone UTC
 */
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
 * Issue #4105 review, the Ceph rate charts (CephRateChart) on the cluster
 * Overview, Insights and a pool's Metrics tab.
 *
 *   - A drag or a double-click on a rate chart reloads that very chart. It
 *     used to drop to a 192px skeleton for the length of the load, so the
 *     chart vanished from under the pointer and the cards below jumped (a
 *     300px chart on Insights, 220px on the Overview), and every 30s
 *     auto-refresh tick on the Overview unmounted it, drag and all. Now only
 *     the first load is a skeleton, at the chart's height; a reload keeps the
 *     last chart on screen, over the window it was fetched for, dimmed and
 *     marked "Refreshing", and a failed reload keeps it with the error above.
 *   - Every zoom is a Custom window, which the card's Refresh re-resolves to
 *     the same instants, so Refresh never reached the rate charts and a
 *     failed one could not be retried while zoomed. They now reload on the
 *     card's Refresh count (useEmbeddedMetricCardRefreshNonce).
 *   - Nothing named the drag on these charts (the Insights Client I/O card
 *     holds only them). Each heading now carries the hover-revealed hint.
 *
 * The network is mocked; the pages, EmbeddedMetricCard, ResourceMetricsTab
 * and CephRateChart are the production code. The line chart, the card's
 * MetricView and its picker are the zoom page harness's stand-ins.
 */

const CLUSTER_ID: string = "0193c0de-6666-4aaa-8bbb-000000000006";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;
const RATE_ERROR: string = "The metrics service is unavailable.";

function at(time: string): Date {
  return new Date(`2026-09-28T${time}:00.000Z`);
}

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();
let mockLastParam: string = "1";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(1);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
      },
      aggregate: (...args: Array<unknown>): unknown => {
        return analyticsAggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-6666-4aaa-8bbb-000000000006");
      },
      getLastParamAsString: (): string => {
        return mockLastParam;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    const harness: { StandInMetricView: unknown } = jest.requireActual(
      "./TimeRangeZoomPageHarness",
    ) as { StandInMetricView: unknown };
    return { __esModule: true, default: harness.StandInMetricView };
  },
);

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  const harness: { StandInRangeStartAndEndDateView: unknown } =
    jest.requireActual("./TimeRangeZoomPageHarness") as {
      StandInRangeStartAndEndDateView: unknown;
    };
  return {
    __esModule: true,
    default: harness.StandInRangeStartAndEndDateView,
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

// The hero's refresh cluster: "Refresh now" is fetchAll(false), as a tick is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    const harness: { StandInAutoRefreshControl: unknown } = jest.requireActual(
      "./TimeRangeZoomPageHarness",
    ) as { StandInAutoRefreshControl: unknown };
    return { __esModule: true, default: harness.StandInAutoRefreshControl };
  },
);

import CephClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import CephClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Insights";
import CephClusterPoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/PoolDetail";
import CephRateChart from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart";
import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import {
  CHART_LOADING_SKELETON_TEST_ID,
  CHART_REFETCHING_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/ChartRefetchFrame";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  TIME_RANGE_ZOOM_HINT_RESET_TEXT,
  TIME_RANGE_ZOOM_HINT_TEXT,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  ZOOM_CHART_TEST_ID,
  cardPickers,
  chartWindows,
  doubleClick,
  dragAcross,
  expectRevealedOnHoverOf,
  flush,
  metricViews,
  resetZoomButtons,
  windowOf,
  zoomCharts,
  zoomHints,
} from "./TimeRangeZoomPageHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

const CLUSTER: Record<string, unknown> = {
  _id: CLUSTER_ID,
  name: "ceph-prod",
  fsid: "3b0c1f7e-aaaa-bbbb-cccc-000000000001",
  otelCollectorStatus: "connected",
  lastSeenAt: minutesAgo(1),
  cephVersion: "18.2.4",
  healthStatus: 0,
  monCount: 3,
  osdCount: 2,
  osdUpCount: 2,
  osdInCount: 2,
  poolCount: 1,
  capacityUsedPercent: 12.34,
};

type Row = Record<string, unknown>;

const ROWS_BY_KIND: Record<string, Array<Row>> = {
  Osd: [],
  Pool: [
    {
      kind: "Pool",
      externalId: "1",
      name: "rbd",
      storedBytes: 300 * GIB,
      maxAvailBytes: 700 * GIB,
      objects: 76800,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
      createdAt: minutesAgo(60 * 24 * 3),
    },
  ],
  Mon: [],
  Mgr: [],
  Mds: [],
  Rgw: [],
};

const RATE_METRICS: Array<string> = [
  "ceph_pool_rd",
  "ceph_pool_wr",
  "ceph_pool_rd_bytes",
  "ceph_pool_wr_bytes",
];

interface AggregateCall {
  name: string;
  start: Date;
  end: Date;
  attributes: Record<string, unknown>;
}

function toCall(args: unknown): AggregateCall {
  const aggregateBy: {
    query: { name: string; attributes?: Record<string, unknown> };
    startTimestamp: Date;
    endTimestamp: Date;
  } = (args as { aggregateBy: never }).aggregateBy;
  return {
    name: aggregateBy.query.name,
    start: aggregateBy.startTimestamp,
    end: aggregateBy.endTimestamp,
    attributes: aggregateBy.query.attributes || {},
  };
}

// A cumulative counter climbing through the window it is asked for.
function counterRows(start: Date, end: Date): Array<Row> {
  const step: number = (end.getTime() - start.getTime()) / 4;
  return [1, 2, 3].map((i: number): Row => {
    return {
      timestamp: new Date(start.getTime() + i * step),
      value: 1000 + 10 * ((i * step) / 1000),
      attributes: { pool_id: "1" },
    };
  });
}

interface HeldRateLoad {
  call: AggregateCall;
  release: () => void;
}

// Rate loads are held until released while this is set.
let holdRates: boolean = false;
let heldRates: Array<HeldRateLoad> = [];
// Rate loads over a window ending at one of these fail, or find nothing.
let failingRateEnds: Array<number> = [];
let quietRateEnds: Array<number> = [];

function answerRates(call: AggregateCall): Promise<unknown> {
  if (failingRateEnds.includes(call.end.getTime())) {
    return Promise.reject(new Error(RATE_ERROR));
  }
  if (quietRateEnds.includes(call.end.getTime())) {
    return Promise.resolve({ data: [] });
  }
  return Promise.resolve({ data: counterRows(call.start, call.end) });
}

function arrange(): void {
  modelGetItemMock.mockImplementation(async () => {
    return CLUSTER;
  });

  modelGetListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (
      args as { query: Record<string, unknown> }
    ).query;
    const rows: Array<Row> = ROWS_BY_KIND[String(query["kind"])] || [];
    const filtered: Array<Row> = query["externalId"]
      ? rows.filter((row: Row): boolean => {
          return row["externalId"] === query["externalId"];
        })
      : rows;
    return { data: filtered, count: filtered.length, skip: 0, limit: 100 };
  });

  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });

  analyticsAggregateMock.mockImplementation((args: unknown) => {
    const call: AggregateCall = toCall(args);
    if (RATE_METRICS.includes(call.name)) {
      if (!holdRates) {
        return answerRates(call);
      }
      return new Promise(
        (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
          heldRates.push({
            call: call,
            release: (): void => {
              answerRates(call).then(resolve, reject);
            },
          });
        },
      );
    }
    if (call.name === "ceph_cluster_total_used_bytes") {
      return Promise.resolve({
        data: [
          { timestamp: minutesAgo(120), value: 100 * GIB },
          { timestamp: minutesAgo(0), value: 300 * GIB },
        ],
      });
    }
    return Promise.resolve({ data: [] });
  });
}

// ----------------------------------------------------------------- helpers

function rateCalls(): Array<AggregateCall> {
  return analyticsAggregateMock.mock.calls
    .map((args: Array<unknown>): AggregateCall => {
      return toCall(args[0]);
    })
    .filter((call: AggregateCall): boolean => {
      return RATE_METRICS.includes(call.name);
    });
}

// How many rate loads asked for exactly [start, end].
function rateCallsOver(start: Date, end: Date): number {
  return rateCalls().filter((call: AggregateCall): boolean => {
    return (
      call.start.getTime() === start.getTime() &&
      call.end.getTime() === end.getTime()
    );
  }).length;
}

async function releaseRatesEndingAt(end: Date): Promise<void> {
  const releasing: Array<HeldRateLoad> = heldRates.filter(
    (held: HeldRateLoad): boolean => {
      return held.call.end.getTime() === end.getTime();
    },
  );
  heldRates = heldRates.filter((held: HeldRateLoad): boolean => {
    return !releasing.includes(held);
  });
  expect(releasing.length).toBeGreaterThan(0);
  for (const held of releasing) {
    held.release();
  }
  await flush();
}

async function releaseAllRates(): Promise<void> {
  const releasing: Array<HeldRateLoad> = heldRates;
  heldRates = [];
  for (const held of releasing) {
    held.release();
  }
  await flush();
}

function skeletons(): Array<HTMLElement> {
  return screen.queryAllByTestId(CHART_LOADING_SKELETON_TEST_ID);
}

function refreshingMarkers(): Array<HTMLElement> {
  return screen.queryAllByTestId(CHART_REFETCHING_TEST_ID);
}

// The named hint group around each rate chart: its heading and the chart.
function rateSections(): Array<HTMLElement> {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[class~="group/zoomhint"]'),
  );
}

function rateAlerts(): Array<HTMLElement> {
  return rateSections().flatMap((section: HTMLElement): Array<HTMLElement> => {
    return within(section).queryAllByRole("alert");
  });
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

function pressCardRefresh(index: number = 0): void {
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[index]!);
}

// A 30-second auto-refresh tick (the Overview's default interval).
async function autoRefreshTick(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await flush();
}

const HOUR: [string, string] = windowOf(at("11:00"), NOW);
const ZOOM: [string, string] = windowOf(at("11:20"), at("11:40"));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  mockLastParam = "1";
  holdRates = false;
  heldRates = [];
  failingRateEnds = [];
  quietRateEnds = [];
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsGetListMock,
    analyticsAggregateMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// --------------------------------------------------------------- Overview

async function renderOverview(): Promise<void> {
  render(<CephClusterOverview {...PAGE_PROPS} />);
  await flush();
}

async function renderLoadedOverview(): Promise<Array<HTMLElement>> {
  await renderOverview();
  const charts: Array<HTMLElement> = zoomCharts();
  expect(charts).toHaveLength(2);
  expect(chartWindows()).toEqual(same(HOUR, 2));
  return charts;
}

function expectSameCharts(charts: Array<HTMLElement>): void {
  const now: Array<HTMLElement> = zoomCharts();
  expect(now).toHaveLength(charts.length);
  charts.forEach((chart: HTMLElement, index: number) => {
    // The very same node: React kept the chart mounted.
    expect(now[index]).toBe(chart);
  });
}

describe("Ceph Overview: the Golden Signals rate charts stay on screen while they reload", () => {
  test("before the first load, each rate chart's skeleton holds the chart's 220px", async () => {
    holdRates = true;
    await renderOverview();

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(2);
    for (const skeleton of skeletons()) {
      expect(skeleton).toHaveStyle({ height: "220px" });
    }

    await releaseAllRates();

    expect(skeletons()).toHaveLength(0);
    expect(zoomCharts()).toHaveLength(2);
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a drag on Client IOPS keeps both charts, over the hour they were fetched for, until the zoom lands", async () => {
    const charts: Array<HTMLElement> = await renderLoadedOverview();
    holdRates = true;

    await dragAcross(charts[0]!, at("11:20"), at("11:40"));

    // The zoomed window is asked for...
    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(4);
    // ...and meanwhile the same two charts stay, still on THEIR hour.
    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);
    expect(skeletons()).toHaveLength(0);

    await releaseRatesEndingAt(at("11:40"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a double-click reset keeps them on screen too, then draws the hour again", async () => {
    await renderLoadedOverview();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    const charts: Array<HTMLElement> = zoomCharts();
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    holdRates = true;

    await doubleClick(charts[1]!);

    expect(cardPickers()[0]).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(refreshingMarkers()).toHaveLength(2);

    await releaseRatesEndingAt(NOW);

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("an auto-refresh tick slides the hour without unmounting the charts (a drag in progress survives it)", async () => {
    const charts: Array<HTMLElement> = await renderLoadedOverview();
    const keys: Array<string | null> = charts.map(
      (chart: HTMLElement): string | null => {
        return chart.getAttribute("data-chart-key");
      },
    );
    holdRates = true;

    await autoRefreshTick();

    const tick: Date = new Date(NOW.getTime() + 30_000);
    const tickHourStart: Date = new Date(tick.getTime() - 60 * MINUTE);
    expect(rateCallsOver(tickHourStart, tick)).toBe(4);
    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);
    expect(skeletons()).toHaveLength(0);

    await releaseRatesEndingAt(tick);

    expectSameCharts(charts);
    expect(
      zoomCharts().map((chart: HTMLElement): string | null => {
        return chart.getAttribute("data-chart-key");
      }),
    ).toEqual(keys);
    expect(chartWindows()).toEqual(same(windowOf(tickHourStart, tick), 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("while zoomed, a tick neither restarts nor repeats the load for the pinned window", async () => {
    await renderLoadedOverview();
    holdRates = true;
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    const calls: number = rateCalls().length;

    await autoRefreshTick();
    fireEvent.click(screen.getByTestId("manual-refresh"));
    await flush();

    expect(rateCalls()).toHaveLength(calls);
    // The load already in flight still lands.
    await releaseRatesEndingAt(at("11:40"));
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a reload that fails keeps the last chart, with the error above it, and the chart still resets the zoom", async () => {
    await renderLoadedOverview();
    failingRateEnds = [at("11:40").getTime()];

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));

    expect(zoomCharts()).toHaveLength(2);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    const alerts: Array<HTMLElement> = rateAlerts();
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert).toHaveTextContent(
        `Couldn't refresh — showing previously loaded data. ${RATE_ERROR}`,
      );
    }
    expect(resetZoomButtons()).toHaveLength(1);

    await doubleClick(zoomCharts()[0]!);

    expect(cardPickers()[0]).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(rateAlerts()).toHaveLength(0);
  });

  test("a slow load for a window the reader has left cannot repaint the charts", async () => {
    await renderLoadedOverview();
    holdRates = true;

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    await doubleClick(zoomCharts()[1]!);
    await releaseRatesEndingAt(NOW);
    expect(chartWindows()).toEqual(same(HOUR, 2));

    await releaseRatesEndingAt(at("11:40"));

    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a zoom into a quiet stretch: the empty state keeps the chart's height, selects no text, and reloads in place", async () => {
    await renderLoadedOverview();
    quietRateEnds = [at("11:40").getTime()];

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));

    expect(zoomCharts()).toHaveLength(0);
    const empty: HTMLElement = screen.getByText(
      "No client I/O reported in the selected time range.",
    );
    expect(empty).toHaveStyle({ height: "220px" });
    expect(empty).toHaveClass("select-none");
    expect(empty.className).not.toMatch(/\bh-48\b/);

    holdRates = true;
    fireEvent.doubleClick(empty);
    await flush();

    // The way back reloads the hour; the empty state stays until it lands.
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(
      screen.getByText("No client I/O reported in the selected time range."),
    ).toBe(empty);
    expect(refreshingMarkers()).toHaveLength(2);
    expect(skeletons()).toHaveLength(0);

    await releaseRatesEndingAt(NOW);

    expect(zoomCharts()).toHaveLength(2);
    expect(chartWindows()).toEqual(same(HOUR, 2));
  });
});

describe("Ceph Overview: the Golden Signals card's Refresh reaches its rate charts", () => {
  test("zoomed, a failed rate chart is retried by the card's Refresh over the pinned window", async () => {
    await renderLoadedOverview();
    failingRateEnds = [at("11:40").getTime()];
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(4);
    expect(rateAlerts()).toHaveLength(2);

    failingRateEnds = [];
    pressCardRefresh();
    await flush();

    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(8);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(rateAlerts()).toHaveLength(0);
    // Still zoomed: Refresh re-sends the pinned window.
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);
    expect(resetZoomButtons()).toHaveLength(1);
  });

  test("zoomed and healthy, the card's Refresh reloads both rate charts once each", async () => {
    await renderLoadedOverview();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(4);

    pressCardRefresh();
    await flush();

    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(8);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
  });

  test("not zoomed, the card's Refresh loads each rate metric once, over the re-resolved hour", async () => {
    await renderLoadedOverview();
    const later: Date = new Date(NOW.getTime() + MINUTE);
    jest.setSystemTime(later);
    const before: number = rateCalls().length;

    pressCardRefresh();
    await flush();

    // The nonce and the new window land together: one load, not two.
    expect(rateCalls().length - before).toBe(4);
    expect(rateCallsOver(new Date(later.getTime() - 60 * MINUTE), later)).toBe(
      4,
    );
  });

  test("the page's own Refresh now leaves a pinned zoom's rate charts alone", async () => {
    await renderLoadedOverview();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    const before: number = rateCalls().length;

    fireEvent.click(screen.getByTestId("manual-refresh"));
    await flush();

    expect(rateCalls()).toHaveLength(before);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
  });
});

describe("Ceph Overview: each rate chart's heading names the drag", () => {
  test("one hover-revealed hint per rate chart, in a group around that chart alone", async () => {
    await renderLoadedOverview();

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(2);
    const titles: Array<string> = ["Client IOPS", "Client Throughput"];
    hints.forEach((hint: HTMLElement, index: number) => {
      const group: HTMLElement = expectRevealedOnHoverOf(hint);
      expect(group).toHaveTextContent(titles[index]!);
      const charts: NodeListOf<Element> = group.querySelectorAll(
        `[data-testid="${ZOOM_CHART_TEST_ID}"]`,
      );
      expect(charts).toHaveLength(1);
      expect(charts[0]).toBe(zoomCharts()[index]);
      expect(hint).toHaveTextContent(TIME_RANGE_ZOOM_HINT_TEXT);
      // The heading's own weight stays off the hint.
      expect(hint).toHaveClass("ml-auto", "font-normal");
    });
  });

  test("zoomed, the hints name the double-click back; reset, they name the drag again", async () => {
    await renderLoadedOverview();

    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:40"));
    expect(zoomHints()).toHaveLength(2);
    for (const hint of zoomHints()) {
      expect(hint).toHaveTextContent(TIME_RANGE_ZOOM_HINT_RESET_TEXT);
    }

    await doubleClick(zoomCharts()[0]!);
    expect(zoomHints()).toHaveLength(2);
    for (const hint of zoomHints()) {
      expect(hint).toHaveTextContent(TIME_RANGE_ZOOM_HINT_TEXT);
    }
  });

  test("the hint stays in the heading while a chart reloads", async () => {
    await renderLoadedOverview();
    holdRates = true;

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));

    expect(zoomHints()).toHaveLength(2);
    expect(refreshingMarkers()).toHaveLength(2);
  });
});

// --------------------------------------------------------------- Insights

async function renderInsights(): Promise<void> {
  render(<CephClusterInsights {...PAGE_PROPS} />);
  await flush();
}

async function renderLoadedInsights(): Promise<Array<HTMLElement>> {
  await renderInsights();
  // Capacity, Latency and Data Health have a MetricView; Client I/O does not.
  expect(metricViews()).toHaveLength(3);
  const charts: Array<HTMLElement> = zoomCharts();
  expect(charts).toHaveLength(2);
  expect(chartWindows()).toEqual(same(HOUR, 2));
  return charts;
}

// The four cards' Refresh buttons, in page order.
const CLIENT_IO_CARD: number = 1;

describe("Ceph Insights: the Client I/O rate charts stay on screen while they reload", () => {
  test("before the first load, each skeleton holds the chart's default 300px", async () => {
    holdRates = true;
    await renderInsights();

    expect(skeletons()).toHaveLength(2);
    for (const skeleton of skeletons()) {
      expect(skeleton).toHaveStyle({ height: "300px" });
    }

    await releaseAllRates();

    expect(skeletons()).toHaveLength(0);
    expect(zoomCharts()).toHaveLength(2);
  });

  test("a drag on Client Throughput keeps both charts while every card retimes", async () => {
    const charts: Array<HTMLElement> = await renderLoadedInsights();
    holdRates = true;

    await dragAcross(charts[1]!, at("11:20"), at("11:40"));

    // The three metric cards move to the zoom at once...
    expect(chartWindows(metricViews())).toEqual(same(ZOOM, 3));
    // ...and the rate charts stay, on their hour, until their load lands.
    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);

    await releaseRatesEndingAt(at("11:40"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
  });

  test("a double-click in another card keeps them on screen while they reload the hour", async () => {
    await renderLoadedInsights();
    await dragAcross(metricViews()[0]!, at("11:20"), at("11:40"));
    const charts: Array<HTMLElement> = zoomCharts();
    holdRates = true;

    await doubleClick(metricViews()[2]!);

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    await releaseRatesEndingAt(NOW);
    expect(chartWindows()).toEqual(same(HOUR, 2));
  });

  test("zoomed, the Client I/O card's Refresh retries its failed rate charts", async () => {
    await renderLoadedInsights();
    failingRateEnds = [at("11:40").getTime()];
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:40"));
    expect(rateAlerts()).toHaveLength(2);
    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(4);

    failingRateEnds = [];
    // The card holds only the rate charts: its Refresh has nothing else to do.
    pressCardRefresh(CLIENT_IO_CARD);
    await flush();

    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(8);
    expect(rateAlerts()).toHaveLength(0);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(resetZoomButtons()).toHaveLength(4);
  });

  test("each rate chart's heading names the drag, revealed over that chart", async () => {
    await renderLoadedInsights();

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(2);
    hints.forEach((hint: HTMLElement, index: number) => {
      const group: HTMLElement = expectRevealedOnHoverOf(hint);
      expect(
        group.querySelectorAll(`[data-testid="${ZOOM_CHART_TEST_ID}"]`),
      ).toHaveLength(1);
      expect(group).toContainElement(zoomCharts()[index]!);
    });
    expect(hints[0]!.closest('[class~="group/zoomhint"]')).toHaveTextContent(
      "Client IOPS",
    );
    expect(hints[1]!.closest('[class~="group/zoomhint"]')).toHaveTextContent(
      "Client Throughput",
    );

    await dragAcross(metricViews()[2]!, at("11:20"), at("11:40"));
    for (const hint of zoomHints()) {
      expect(hint).toHaveTextContent(TIME_RANGE_ZOOM_HINT_RESET_TEXT);
    }
  });
});

// ------------------------------------------------ pool detail, Metrics tab

async function renderPoolMetrics(): Promise<void> {
  mockLastParam = "1";
  render(<CephClusterPoolDetail {...PAGE_PROPS} />);
  await flush();
  fireEvent.click(await screen.findByTestId("tab-Metrics"));
  await flush();
}

describe("Ceph pool detail, Metrics tab: the pool's rate charts stay on screen while they reload", () => {
  test("before the first load, each skeleton holds the chart's default 300px", async () => {
    holdRates = true;
    await renderPoolMetrics();

    expect(skeletons()).toHaveLength(2);
    for (const skeleton of skeletons()) {
      expect(skeleton).toHaveStyle({ height: "300px" });
    }
    await releaseAllRates();
    expect(zoomCharts()).toHaveLength(2);
  });

  test("a drag keeps both charts on their hour until the zoom lands, still for this pool", async () => {
    await renderPoolMetrics();
    const charts: Array<HTMLElement> = zoomCharts();
    expect(charts).toHaveLength(2);
    holdRates = true;

    await dragAcross(charts[0]!, at("11:20"), at("11:40"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);
    for (const held of heldRates) {
      expect(held.call.attributes["pool_id"]).toBe("1");
    }

    await releaseRatesEndingAt(at("11:40"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
  });

  test("zoomed, the tab's Refresh retries a failed rate chart for this pool", async () => {
    await renderPoolMetrics();
    failingRateEnds = [at("11:40").getTime()];
    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:40"));
    expect(rateAlerts()).toHaveLength(2);

    failingRateEnds = [];
    pressCardRefresh();
    await flush();

    const retried: Array<AggregateCall> = rateCalls().filter(
      (call: AggregateCall): boolean => {
        return (
          call.start.getTime() === at("11:20").getTime() &&
          call.end.getTime() === at("11:40").getTime()
        );
      },
    );
    expect(retried).toHaveLength(8);
    for (const call of retried) {
      expect(call.attributes["pool_id"]).toBe("1");
    }
    expect(rateAlerts()).toHaveLength(0);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);
  });

  test("each rate chart's heading names the drag, revealed over that chart", async () => {
    await renderPoolMetrics();

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(2);
    hints.forEach((hint: HTMLElement, index: number) => {
      const group: HTMLElement = expectRevealedOnHoverOf(hint);
      expect(group).toContainElement(zoomCharts()[index]!);
      expect(hint).toHaveTextContent(TIME_RANGE_ZOOM_HINT_TEXT);
    });
  });
});

// ---------------------------------- CephRateChart in a card of its own

describe("CephRateChart in a card on a Custom window", () => {
  function renderCard(): void {
    render(
      <EmbeddedMetricCard
        title="Client I/O"
        defaultTimeRange={{
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(at("11:20"), at("11:40")),
        }}
        renderExtraCharts={(dateRange: InBetween<Date>): React.ReactElement => {
          return (
            <CephRateChart
              clusterName="ceph-prod"
              series={[
                { metricName: "ceph_pool_rd", label: "Read" },
                { metricName: "ceph_pool_wr", label: "Write" },
              ]}
              seriesKeyAttributes={["pool_id"]}
              startDate={dateRange.startValue}
              endDate={dateRange.endValue}
            />
          );
        }}
      />,
    );
  }

  test("a failed first load is retried by the card's Refresh: a skeleton while it runs, then the chart", async () => {
    failingRateEnds = [at("11:40").getTime()];
    renderCard();
    await flush();

    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
    expect(zoomCharts()).toHaveLength(0);
    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(2);

    failingRateEnds = [];
    holdRates = true;
    pressCardRefresh();
    await flush();

    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(4);
    // Nothing was ever drawn, so the retry is a skeleton at the chart's height.
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]).toHaveStyle({ height: "300px" });
    expect(screen.queryByText(RATE_ERROR)).toBeNull();

    await releaseAllRates();

    expect(zoomCharts()).toHaveLength(1);
    expect(chartWindows()).toEqual([ZOOM]);
  });

  test("a failed retry shows the error again", async () => {
    failingRateEnds = [at("11:40").getTime()];
    renderCard();
    await flush();

    pressCardRefresh();
    await flush();

    expect(rateCallsOver(at("11:20"), at("11:40"))).toBe(4);
    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
    expect(skeletons()).toHaveLength(0);
  });
});

// ------------------------------- CephRateChart rerendered for other counters

/*
 * Runs its callback in the layout phase of every commit that rerenders it:
 * after that commit's DOM changes and before any effect can follow them up,
 * so it sees what the reader could see for a frame.
 */
function CommitProbe(props: { onCommit: () => void }): null {
  React.useLayoutEffect((): void => {
    props.onCommit();
  });
  return null;
}

describe("CephRateChart keeps its last chart, and its error, only for the counters they came from", () => {
  interface PoolChartOptions {
    poolId: string;
    start: Date;
    end: Date;
    clusterName?: string | undefined;
  }

  // The page's text after each commit of the tree around the chart.
  let commits: Array<string> = [];

  // A pool's rate chart as PoolDetail draws it, beside a commit probe.
  function poolChart(options: PoolChartOptions): React.ReactElement {
    return (
      <>
        <CephRateChart
          clusterName={options.clusterName ?? "ceph-prod"}
          series={[
            { metricName: "ceph_pool_rd", label: "Read" },
            { metricName: "ceph_pool_wr", label: "Write" },
          ]}
          seriesKeyAttributes={["pool_id"]}
          extraAttributes={{ pool_id: options.poolId }}
          startDate={options.start}
          endDate={options.end}
          heightInPx={220}
        />
        <CommitProbe
          onCommit={(): void => {
            commits.push(document.body.textContent || "");
          }}
        />
      </>
    );
  }

  function heldAttribute(name: string): Array<unknown> {
    return heldRates.map((held: HeldRateLoad): unknown => {
      return held.call.attributes[name];
    });
  }

  async function releaseRatesForPool(poolId: string): Promise<void> {
    const releasing: Array<HeldRateLoad> = heldRates.filter(
      (held: HeldRateLoad): boolean => {
        return held.call.attributes["pool_id"] === poolId;
      },
    );
    heldRates = heldRates.filter((held: HeldRateLoad): boolean => {
      return !releasing.includes(held);
    });
    expect(releasing.length).toBeGreaterThan(0);
    for (const held of releasing) {
      held.release();
    }
    await flush();
  }

  beforeEach(() => {
    commits = [];
  });

  test("a new window for the same pool keeps the chart, on its last window, until the load lands", async () => {
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    const charts: Array<HTMLElement> = zoomCharts();
    expect(charts).toHaveLength(1);
    expect(chartWindows()).toEqual([HOUR]);
    holdRates = true;

    rerender(poolChart({ poolId: "1", start: at("11:20"), end: at("11:40") }));
    await flush();

    expectSameCharts(charts);
    expect(chartWindows()).toEqual([HOUR]);
    expect(refreshingMarkers()).toHaveLength(1);
    expect(skeletons()).toHaveLength(0);
    expect(heldAttribute("pool_id")).toEqual(["1", "1"]);

    await releaseAllRates();

    expectSameCharts(charts);
    expect(chartWindows()).toEqual([ZOOM]);
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("another pool starts over from a skeleton at the chart's height, never drawing the last pool's rates", async () => {
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    expect(zoomCharts()).toHaveLength(1);
    holdRates = true;
    commits = [];

    rerender(poolChart({ poolId: "2", start: at("11:00"), end: NOW }));

    // Already the switch's own commit draws no chart under pool 2.
    expect(commits.length).toBeGreaterThan(0);
    for (const text of commits) {
      expect(text).not.toContain("Drag across the chart");
    }
    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]).toHaveStyle({ height: "220px" });
    expect(refreshingMarkers()).toHaveLength(0);
    expect(heldAttribute("pool_id")).toEqual(["2", "2"]);

    await releaseAllRates();

    expect(skeletons()).toHaveLength(0);
    expect(zoomCharts()).toHaveLength(1);
    expect(chartWindows()).toEqual([HOUR]);
  });

  test("another cluster starts over from the skeleton too", async () => {
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    expect(zoomCharts()).toHaveLength(1);
    holdRates = true;

    rerender(
      poolChart({
        poolId: "1",
        start: at("11:00"),
        end: NOW,
        clusterName: "ceph-dr",
      }),
    );
    await flush();

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);
    expect(heldAttribute("resource.ceph.cluster.name")).toEqual([
      "ceph-dr",
      "ceph-dr",
    ]);

    await releaseAllRates();

    expect(zoomCharts()).toHaveLength(1);
  });

  test("a slow load for the last pool cannot paint over the next one", async () => {
    holdRates = true;
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    rerender(poolChart({ poolId: "2", start: at("11:00"), end: NOW }));
    await flush();

    await releaseRatesForPool("1");

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);

    await releaseRatesForPool("2");

    expect(zoomCharts()).toHaveLength(1);
    expect(skeletons()).toHaveLength(0);
  });

  test("for the same pool, a failed reload's error stays up while its retry runs, and clears when it lands", async () => {
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    failingRateEnds = [at("11:40").getTime()];
    rerender(poolChart({ poolId: "1", start: at("11:20"), end: at("11:40") }));
    await flush();
    expect(zoomCharts()).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(RATE_ERROR);

    failingRateEnds = [];
    holdRates = true;
    rerender(poolChart({ poolId: "1", start: at("11:25"), end: at("11:40") }));
    await flush();

    // The retry is in flight: the chart, its error and the marker stay.
    expect(zoomCharts()).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(RATE_ERROR);
    expect(refreshingMarkers()).toHaveLength(1);

    await releaseAllRates();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(chartWindows()).toEqual([windowOf(at("11:25"), at("11:40"))]);
  });

  test("a failed first load for one pool is never shown under another, not even for a frame", async () => {
    failingRateEnds = [NOW.getTime()];
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
    holdRates = true;
    commits = [];

    rerender(poolChart({ poolId: "2", start: at("11:00"), end: NOW }));

    expect(commits.length).toBeGreaterThan(0);
    for (const text of commits) {
      expect(text).not.toContain(RATE_ERROR);
    }
    expect(skeletons()).toHaveLength(1);
    expect(screen.queryByText(RATE_ERROR)).toBeNull();
  });

  test("a failed reload's error stays with its pool: another pool's first frame is only its skeleton", async () => {
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    failingRateEnds = [at("11:40").getTime()];
    rerender(poolChart({ poolId: "1", start: at("11:20"), end: at("11:40") }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(RATE_ERROR);
    holdRates = true;
    commits = [];

    rerender(poolChart({ poolId: "2", start: at("11:20"), end: at("11:40") }));

    expect(commits.length).toBeGreaterThan(0);
    for (const text of commits) {
      expect(text).not.toContain(RATE_ERROR);
    }
    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a pool's own failure shows once its load for that pool fails", async () => {
    const { rerender } = render(
      poolChart({ poolId: "1", start: at("11:00"), end: NOW }),
    );
    await flush();
    failingRateEnds = [NOW.getTime()];

    rerender(poolChart({ poolId: "2", start: at("11:00"), end: NOW }));
    await flush();

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(0);
    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
  });
});
