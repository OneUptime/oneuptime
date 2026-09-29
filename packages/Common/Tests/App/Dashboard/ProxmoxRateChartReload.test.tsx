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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 review, the Proxmox rate charts (ProxmoxRateChart) on Insights
 * and the node and guest Metrics tabs.
 *
 *   - A drag or a double-click on a rate chart reloads that very chart. It
 *     used to drop to a 192px skeleton (the chart is 300px) for the length
 *     of the load, so the block shrank by 108px under the pointer and the
 *     cards below jumped, then jumped back. Now only the first load is a
 *     skeleton, at the chart's height; a reload keeps the last chart on
 *     screen, over the window it was fetched for, dimmed and marked
 *     "Refreshing"; a failed reload keeps it with the error above.
 *   - Every zoom is a Custom window, which a card's Refresh re-resolves to
 *     the same instants, so Refresh never reached the rate charts and a
 *     failed one could not be retried while zoomed. They now reload on the
 *     card's Refresh count, whether the card renders them as children (the
 *     Insights Network card) or as extra charts (the Storage card, the
 *     Metrics tabs).
 *
 * The network is mocked; the pages, EmbeddedMetricCard, ResourceMetricsTab
 * and ProxmoxRateChart are the production code. The line chart, the card's
 * MetricView and its picker are the zoom page harness's stand-ins.
 */

const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const RATE_ERROR: string = "The metrics service is unavailable.";

function at(time: string): Date {
  return new Date(`2026-09-28T${time}:00.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
let mockLastParam: string = "node%2Fpve1";

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
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
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
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
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

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import ProxmoxClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Insights";
import ProxmoxClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/NodeDetail";
import ProxmoxClusterGuestDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/GuestDetail";
import ProxmoxRateChart from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxRateChart";
import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import {
  CHART_LOADING_SKELETON_TEST_ID,
  CHART_REFETCHING_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/ChartRefetchFrame";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  cardPickers,
  chartWindows,
  doubleClick,
  dragAcross,
  flush,
  metricViews,
  resetZoomButtons,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

interface AggregateCall {
  aggregateBy: {
    query: { name: string; attributes: Record<string, unknown> };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

type Point = {
  timestamp: Date;
  value: number;
  attributes: Record<string, string>;
};

const DISK_METRICS: Array<string> = [
  "pve_disk_read_bytes",
  "pve_disk_write_bytes",
];
const NETWORK_METRICS: Array<string> = [
  "pve_network_receive_bytes",
  "pve_network_transmit_bytes",
];
const RATE_METRICS: Array<string> = [...DISK_METRICS, ...NETWORK_METRICS];

// From when the counters exist.
let countersFrom: Date = at("11:00");

/*
 * A sample a minute from 11:00 to 11:59 inside the asked-for window: every
 * counter rising 60 KB a minute for node pve1 and guest 100.
 */
function points(call: AggregateCall): Array<Point> {
  const name: string = call.aggregateBy.query.name;
  const start: number = call.aggregateBy.startTimestamp.getTime();
  const end: number = call.aggregateBy.endTimestamp.getTime();
  const result: Array<Point> = [];

  if (!RATE_METRICS.includes(name)) {
    return result;
  }

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));
    if (
      time.getTime() < start ||
      time.getTime() > end ||
      time.getTime() < countersFrom.getTime()
    ) {
      continue;
    }
    for (const id of ["node/pve1", "qemu/100"]) {
      result.push({
        timestamp: time,
        value: minute * 60_000,
        attributes: { id: id },
      });
    }
  }

  return result;
}

interface HeldRateLoad {
  call: AggregateCall;
  release: () => void;
}

let holdRates: boolean = false;
let heldRates: Array<HeldRateLoad> = [];
// Rate loads over a window ending at one of these fail.
let failingRateEnds: Array<number> = [];

function isRateCall(call: AggregateCall): boolean {
  return RATE_METRICS.includes(call.aggregateBy.query.name);
}

function answer(call: AggregateCall): Promise<unknown> {
  if (
    isRateCall(call) &&
    failingRateEnds.includes(call.aggregateBy.endTimestamp.getTime())
  ) {
    return Promise.reject(new Error(RATE_ERROR));
  }
  return Promise.resolve({ data: points(call) });
}

function aggregateCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls.map((args: Array<unknown>): AggregateCall => {
    return args[0] as AggregateCall;
  });
}

// How many loads of these metrics asked for exactly [start, end].
function callsOver(names: Array<string>, start: Date, end: Date): number {
  return aggregateCalls().filter((call: AggregateCall): boolean => {
    return (
      names.includes(call.aggregateBy.query.name) &&
      call.aggregateBy.startTimestamp.getTime() === start.getTime() &&
      call.aggregateBy.endTimestamp.getTime() === end.getTime()
    );
  }).length;
}

function rateCallCount(): number {
  return aggregateCalls().filter(isRateCall).length;
}

async function releaseRatesEndingAt(end: Date): Promise<void> {
  const releasing: Array<HeldRateLoad> = heldRates.filter(
    (held: HeldRateLoad): boolean => {
      return held.call.aggregateBy.endTimestamp.getTime() === end.getTime();
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

function alertsAround(chart: HTMLElement): Array<HTMLElement> {
  // The frame around the chart: its error sits above the chart, inside it.
  const frame: HTMLElement = chart.closest("[aria-busy]")!
    .parentElement as HTMLElement;
  return within(frame).queryAllByRole("alert");
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

function expectSameCharts(charts: Array<HTMLElement>): void {
  const now: Array<HTMLElement> = zoomCharts();
  expect(now).toHaveLength(charts.length);
  charts.forEach((chart: HTMLElement, index: number) => {
    expect(now[index]).toBe(chart);
  });
}

function pressCardRefresh(index: number = 0): void {
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[index]!);
}

const HOUR: [string, string] = windowOf(at("11:00"), NOW);
const ZOOM: [string, string] = windowOf(at("11:20"), at("11:30"));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  holdRates = false;
  heldRates = [];
  failingRateEnds = [];
  countersFrom = at("11:00");
  mockLastParam = "node%2Fpve1";

  getItemMock.mockResolvedValue({
    _id: CLUSTER_ID,
    name: "pve-prod",
    otelCollectorStatus: "connected",
    lastSeenAt: NOW,
    nodeCount: 1,
    onlineNodeCount: 1,
    guestCount: 1,
    storageCount: 0,
    guestsWithoutBackupCount: 0,
  });

  getListMock.mockImplementation((request: unknown) => {
    const { modelType, query } = request as {
      modelType: unknown;
      query: Record<string, unknown>;
    };
    const rows: Array<Record<string, unknown>> = [
      {
        kind: "Node",
        externalId: "node/pve1",
        name: "pve1",
        isUp: true,
        latestCpuPercent: 10,
        metricsUpdatedAt: NOW,
        lastSeenAt: NOW,
      },
      {
        kind: "Guest",
        externalId: "qemu/100",
        name: "web",
        vmid: 100,
        guestType: "qemu",
        parentNodeName: "pve1",
        isUp: true,
        isBackedUp: true,
        metricsUpdatedAt: NOW,
        lastSeenAt: NOW,
      },
    ].filter((row: Record<string, unknown>): boolean => {
      return (
        modelType === ProxmoxResource &&
        (!query["kind"] || row["kind"] === query["kind"]) &&
        (!query["externalId"] || row["externalId"] === query["externalId"])
      );
    });

    return Promise.resolve({ data: rows, count: rows.length });
  });

  aggregateMock.mockImplementation((request: unknown) => {
    const call: AggregateCall = request as AggregateCall;
    if (!holdRates || !isRateCall(call)) {
      return answer(call);
    }
    return new Promise(
      (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
        heldRates.push({
          call: call,
          release: (): void => {
            answer(call).then(resolve, reject);
          },
        });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------------------------ Insights

// The five cards' Refresh buttons, in page order.
const STORAGE_CARD: number = 2;
const NETWORK_CARD: number = 4;

async function renderInsights(): Promise<void> {
  render(<ProxmoxClusterInsights {...PAGE_PROPS} />);
  await flush();
}

// [Disk Throughput (Storage card), Network (Network card)]
async function renderLoadedInsights(): Promise<Array<HTMLElement>> {
  await renderInsights();
  expect(metricViews()).toHaveLength(4);
  const charts: Array<HTMLElement> = zoomCharts();
  expect(charts).toHaveLength(2);
  expect(charts[0]).toHaveAttribute("data-series", "Read,Write");
  expect(charts[1]).toHaveAttribute("data-series", "Receive,Transmit");
  expect(chartWindows()).toEqual(same(HOUR, 2));
  return charts;
}

describe("Proxmox Insights: the rate charts stay on screen while they reload", () => {
  test("before the first load, each skeleton holds the chart's 300px", async () => {
    holdRates = true;
    await renderInsights();

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(2);
    for (const skeleton of skeletons()) {
      expect(skeleton).toHaveStyle({ height: "300px" });
      expect(skeleton.className).not.toMatch(/\bh-48\b/);
    }

    await releaseAllRates();

    expect(skeletons()).toHaveLength(0);
    expect(zoomCharts()).toHaveLength(2);
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a drag on Disk Throughput keeps both charts, over the hour they were fetched for, until the zoom lands", async () => {
    const charts: Array<HTMLElement> = await renderLoadedInsights();
    holdRates = true;

    await dragAcross(charts[0]!, at("11:20"), at("11:30"));

    // Every metric card moves to the zoom...
    expect(chartWindows(metricViews())).toEqual(same(ZOOM, 4));
    expect(callsOver(RATE_METRICS, at("11:20"), at("11:30"))).toBe(4);
    // ...and both rate charts stay, still on THEIR hour, marked Refreshing.
    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);
    expect(skeletons()).toHaveLength(0);

    await releaseRatesEndingAt(at("11:30"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a double-click reset keeps them on screen too, then draws the hour again", async () => {
    await renderLoadedInsights();
    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));
    const charts: Array<HTMLElement> = zoomCharts();
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    holdRates = true;

    await doubleClick(charts[0]!);

    expect(chartWindows(metricViews())).toEqual(same(HOUR, 4));
    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(refreshingMarkers()).toHaveLength(2);

    await releaseRatesEndingAt(NOW);

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("a reload that fails keeps the last chart with the error above it; the chart still takes the double-click back", async () => {
    await renderLoadedInsights();
    failingRateEnds = [at("11:30").getTime()];

    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));

    const charts: Array<HTMLElement> = zoomCharts();
    expect(charts).toHaveLength(2);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    for (const chart of charts) {
      const alerts: Array<HTMLElement> = alertsAround(chart);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(
        `Couldn't refresh — showing previously loaded data. ${RATE_ERROR}`,
      );
    }

    await doubleClick(charts[1]!);

    expect(chartWindows(metricViews())).toEqual(same(HOUR, 4));
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  test("a slow load for a window the reader has left cannot repaint the charts", async () => {
    await renderLoadedInsights();
    holdRates = true;

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    await doubleClick(zoomCharts()[1]!);
    await releaseRatesEndingAt(NOW);
    expect(chartWindows()).toEqual(same(HOUR, 2));

    await releaseRatesEndingAt(at("11:30"));

    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(0);
  });

  test("a zoom into a quiet stretch: the empty state keeps the chart's height, selects no text, and reloads in place", async () => {
    countersFrom = at("11:40");
    await renderLoadedInsights();

    await dragAcross(metricViews()[1]!, at("11:10"), at("11:30"));

    expect(zoomCharts()).toHaveLength(0);
    const empties: Array<HTMLElement> = screen.getAllByText(
      "No data reported for the selected time range.",
    );
    expect(empties).toHaveLength(2);
    for (const empty of empties) {
      expect(empty).toHaveStyle({ height: "300px" });
      expect(empty).toHaveClass("select-none");
      expect(empty.className).not.toMatch(/\bh-48\b/);
    }

    holdRates = true;
    fireEvent.doubleClick(empties[0]!);
    await flush();

    // The way back reloads the hour; the empty states stay until it lands.
    expect(
      screen.getAllByText("No data reported for the selected time range."),
    ).toEqual(empties);
    expect(refreshingMarkers()).toHaveLength(2);
    expect(skeletons()).toHaveLength(0);

    await releaseRatesEndingAt(NOW);

    expect(zoomCharts()).toHaveLength(2);
    expect(chartWindows()).toEqual(same(HOUR, 2));
  });
});

describe("Proxmox Insights: a card's Refresh reaches its rate chart while zoomed", () => {
  test("the Storage card's Refresh retries its failed Disk Throughput chart (an extra chart)", async () => {
    await renderLoadedInsights();
    failingRateEnds = [at("11:30").getTime()];
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));
    expect(callsOver(DISK_METRICS, at("11:20"), at("11:30"))).toBe(2);
    expect(alertsAround(zoomCharts()[0]!)).toHaveLength(1);

    failingRateEnds = [];
    pressCardRefresh(STORAGE_CARD);
    await flush();

    expect(callsOver(DISK_METRICS, at("11:20"), at("11:30"))).toBe(4);
    expect(alertsAround(zoomCharts()[0]!)).toHaveLength(0);
    expect(chartWindows()[0]).toEqual(ZOOM);
    // Refresh re-sends the pinned window: still zoomed.
    expect(cardPickers()[STORAGE_CARD]).toHaveTextContent(TimeRange.CUSTOM);
  });

  test("the Network card's Refresh retries its failed Network chart (the card's child)", async () => {
    await renderLoadedInsights();
    failingRateEnds = [at("11:30").getTime()];
    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));
    expect(callsOver(NETWORK_METRICS, at("11:20"), at("11:30"))).toBe(2);
    expect(alertsAround(zoomCharts()[1]!)).toHaveLength(1);

    failingRateEnds = [];
    pressCardRefresh(NETWORK_CARD);
    await flush();

    expect(callsOver(NETWORK_METRICS, at("11:20"), at("11:30"))).toBe(4);
    expect(alertsAround(zoomCharts()[1]!)).toHaveLength(0);
    expect(chartWindows()[1]).toEqual(ZOOM);
    expect(resetZoomButtons()).toHaveLength(5);
  });

  test("not zoomed, a card's Refresh moves the page's hour and each rate metric loads it once", async () => {
    await renderLoadedInsights();
    const later: Date = new Date(NOW.getTime() + 60_000);
    jest.setSystemTime(later);
    const before: number = rateCallCount();

    pressCardRefresh(NETWORK_CARD);
    await flush();

    /*
     * The page re-resolves its one window for every card: both rate charts
     * load it, each metric once (the Refresh count lands with the window).
     */
    expect(rateCallCount() - before).toBe(4);
    expect(
      callsOver(RATE_METRICS, new Date(later.getTime() - 60 * 60_000), later),
    ).toBe(4);
  });
});

// ------------------------------------------------- node and guest Metrics tab

async function renderNodeMetrics(): Promise<void> {
  mockLastParam = "node%2Fpve1";
  render(<ProxmoxClusterNodeDetail {...PAGE_PROPS} />);
  await flush();
  fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
  await flush();
}

describe("Proxmox node detail, Metrics tab: the node's rate charts stay on screen while they reload", () => {
  test("before the first load, each skeleton holds the chart's 300px", async () => {
    holdRates = true;
    await renderNodeMetrics();

    expect(skeletons()).toHaveLength(2);
    for (const skeleton of skeletons()) {
      expect(skeleton).toHaveStyle({ height: "300px" });
    }
    await releaseAllRates();
    expect(zoomCharts()).toHaveLength(2);
  });

  test("a drag keeps both charts on their hour until the zoom lands, still for this node", async () => {
    await renderNodeMetrics();
    const charts: Array<HTMLElement> = zoomCharts();
    expect(charts).toHaveLength(2);
    holdRates = true;

    await dragAcross(charts[1]!, at("11:20"), at("11:30"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);
    expect(heldRates).toHaveLength(4);
    for (const held of heldRates) {
      expect(held.call.aggregateBy.query.attributes["id"]).toBe("node/pve1");
    }

    await releaseRatesEndingAt(at("11:30"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
  });

  test("zoomed, the tab's Refresh retries both failed rate charts", async () => {
    await renderNodeMetrics();
    failingRateEnds = [at("11:30").getTime()];
    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(callsOver(RATE_METRICS, at("11:20"), at("11:30"))).toBe(4);

    failingRateEnds = [];
    pressCardRefresh();
    await flush();

    expect(callsOver(RATE_METRICS, at("11:20"), at("11:30"))).toBe(8);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);
    expect(resetZoomButtons()).toHaveLength(1);
  });
});

describe("Proxmox guest detail, Metrics tab", () => {
  test("a drag keeps the guest's rate charts on screen, and the tab's Refresh retries a failed load", async () => {
    mockLastParam = "qemu%2F100";
    render(<ProxmoxClusterGuestDetail {...PAGE_PROPS} />);
    await flush();
    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await flush();
    const charts: Array<HTMLElement> = zoomCharts();
    expect(charts).toHaveLength(2);

    holdRates = true;
    failingRateEnds = [at("11:30").getTime()];
    await dragAcross(charts[0]!, at("11:20"), at("11:30"));

    expectSameCharts(charts);
    expect(chartWindows()).toEqual(same(HOUR, 2));
    expect(refreshingMarkers()).toHaveLength(2);
    for (const held of heldRates) {
      expect(held.call.aggregateBy.query.attributes["id"]).toBe("qemu/100");
    }

    await releaseRatesEndingAt(at("11:30"));
    expectSameCharts(charts);
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    holdRates = false;
    failingRateEnds = [];
    pressCardRefresh();
    await flush();

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(chartWindows()).toEqual(same(ZOOM, 2));
  });
});

// ------------------------------------ ProxmoxRateChart in a card of its own

describe("ProxmoxRateChart in a card on a Custom window", () => {
  function renderCard(): void {
    render(
      <EmbeddedMetricCard
        title="Network"
        defaultTimeRange={{
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(at("11:20"), at("11:30")),
        }}
      >
        <ProxmoxRateChart
          clusterName="pve-prod"
          series={[
            { metricName: "pve_network_receive_bytes", label: "Receive" },
            { metricName: "pve_network_transmit_bytes", label: "Transmit" },
          ]}
          startDate={at("11:20")}
          endDate={at("11:30")}
          heightInPx={240}
        />
      </EmbeddedMetricCard>,
    );
  }

  test("a failed first load is retried by the card's Refresh: a skeleton at the given height while it runs, then the chart", async () => {
    failingRateEnds = [at("11:30").getTime()];
    renderCard();
    await flush();

    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
    expect(zoomCharts()).toHaveLength(0);
    expect(callsOver(NETWORK_METRICS, at("11:20"), at("11:30"))).toBe(2);

    failingRateEnds = [];
    holdRates = true;
    pressCardRefresh();
    await flush();

    expect(callsOver(NETWORK_METRICS, at("11:20"), at("11:30"))).toBe(4);
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]).toHaveStyle({ height: "240px" });

    await releaseAllRates();

    expect(zoomCharts()).toHaveLength(1);
    expect(chartWindows()).toEqual([ZOOM]);
  });

  test("outside any card, nothing but its window reloads it", async () => {
    render(
      <ProxmoxRateChart
        clusterName="pve-prod"
        series={[{ metricName: "pve_network_receive_bytes", label: "Receive" }]}
        startDate={at("11:20")}
        endDate={at("11:30")}
      />,
    );
    await flush();

    expect(zoomCharts()).toHaveLength(1);
    expect(
      callsOver(["pve_network_receive_bytes"], at("11:20"), at("11:30")),
    ).toBe(1);
  });
});

// ----------------------- ProxmoxRateChart rerendered for another resource

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

describe("ProxmoxRateChart keeps its last chart, and its error, only for the resource they came from", () => {
  interface ResourceChartOptions {
    id: string;
    start: Date;
    end: Date;
    clusterName?: string | undefined;
  }

  // The page's text after each commit of the tree around the chart.
  let commits: Array<string> = [];

  // A node's or guest's Network chart as its Metrics tab draws it.
  function resourceChart(options: ResourceChartOptions): React.ReactElement {
    return (
      <>
        <ProxmoxRateChart
          clusterName={options.clusterName ?? "pve-prod"}
          series={[
            { metricName: "pve_network_receive_bytes", label: "Receive" },
            { metricName: "pve_network_transmit_bytes", label: "Transmit" },
          ]}
          extraAttributes={{ id: options.id }}
          startDate={options.start}
          endDate={options.end}
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
      return held.call.aggregateBy.query.attributes[name];
    });
  }

  async function releaseRatesFor(id: string): Promise<void> {
    const releasing: Array<HeldRateLoad> = heldRates.filter(
      (held: HeldRateLoad): boolean => {
        return held.call.aggregateBy.query.attributes["id"] === id;
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

  test("a new window for the same guest keeps the chart, on its last window, until the load lands", async () => {
    const { rerender } = render(
      resourceChart({ id: "qemu/100", start: at("11:00"), end: NOW }),
    );
    await flush();
    const charts: Array<HTMLElement> = zoomCharts();
    expect(charts).toHaveLength(1);
    holdRates = true;

    rerender(
      resourceChart({ id: "qemu/100", start: at("11:20"), end: at("11:30") }),
    );
    await flush();

    expectSameCharts(charts);
    expect(chartWindows()).toEqual([HOUR]);
    expect(refreshingMarkers()).toHaveLength(1);
    expect(skeletons()).toHaveLength(0);

    await releaseAllRates();

    expectSameCharts(charts);
    expect(chartWindows()).toEqual([ZOOM]);
  });

  test("another guest starts over from a skeleton at the chart's height, never drawing the last one's rates", async () => {
    const { rerender } = render(
      resourceChart({ id: "qemu/100", start: at("11:00"), end: NOW }),
    );
    await flush();
    expect(zoomCharts()).toHaveLength(1);
    holdRates = true;
    commits = [];

    rerender(resourceChart({ id: "qemu/101", start: at("11:00"), end: NOW }));

    // Already the switch's own commit draws no chart under guest 101.
    expect(commits.length).toBeGreaterThan(0);
    for (const text of commits) {
      expect(text).not.toContain("Drag across the chart");
    }
    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);
    expect(skeletons()[0]).toHaveStyle({ height: "300px" });
    expect(refreshingMarkers()).toHaveLength(0);
    expect(heldAttribute("id")).toEqual(["qemu/101", "qemu/101"]);

    await releaseAllRates();

    expect(skeletons()).toHaveLength(0);
    expect(zoomCharts()).toHaveLength(1);
  });

  test("another cluster starts over from the skeleton too", async () => {
    const { rerender } = render(
      resourceChart({ id: "node/pve1", start: at("11:00"), end: NOW }),
    );
    await flush();
    holdRates = true;

    rerender(
      resourceChart({
        id: "node/pve1",
        start: at("11:00"),
        end: NOW,
        clusterName: "pve-dr",
      }),
    );
    await flush();

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);
    expect(heldAttribute("resource.proxmox.cluster.name")).toEqual([
      "pve-dr",
      "pve-dr",
    ]);

    await releaseAllRates();

    expect(zoomCharts()).toHaveLength(1);
  });

  test("a slow load for the last guest cannot paint over the next one", async () => {
    holdRates = true;
    const { rerender } = render(
      resourceChart({ id: "qemu/100", start: at("11:00"), end: NOW }),
    );
    await flush();
    rerender(resourceChart({ id: "qemu/101", start: at("11:00"), end: NOW }));
    await flush();

    await releaseRatesFor("qemu/100");

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);

    await releaseRatesFor("qemu/101");

    expect(zoomCharts()).toHaveLength(1);
  });

  test("a failed first load for one guest is never shown under another, not even for a frame", async () => {
    failingRateEnds = [NOW.getTime()];
    const { rerender } = render(
      resourceChart({ id: "qemu/100", start: at("11:00"), end: NOW }),
    );
    await flush();
    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
    holdRates = true;
    commits = [];

    rerender(resourceChart({ id: "qemu/101", start: at("11:00"), end: NOW }));

    expect(commits.length).toBeGreaterThan(0);
    for (const text of commits) {
      expect(text).not.toContain(RATE_ERROR);
    }
    expect(skeletons()).toHaveLength(1);
    expect(screen.queryByText(RATE_ERROR)).toBeNull();
  });

  test("a failed reload's error stays with its guest: another guest's first frame is only its skeleton", async () => {
    const { rerender } = render(
      resourceChart({ id: "qemu/100", start: at("11:00"), end: NOW }),
    );
    await flush();
    failingRateEnds = [at("11:30").getTime()];
    rerender(
      resourceChart({ id: "qemu/100", start: at("11:20"), end: at("11:30") }),
    );
    await flush();
    expect(zoomCharts()).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(RATE_ERROR);
    holdRates = true;
    commits = [];

    rerender(
      resourceChart({ id: "qemu/101", start: at("11:20"), end: at("11:30") }),
    );

    expect(commits.length).toBeGreaterThan(0);
    for (const text of commits) {
      expect(text).not.toContain(RATE_ERROR);
    }
    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a guest's own failure shows once its load for that guest fails", async () => {
    const { rerender } = render(
      resourceChart({ id: "qemu/100", start: at("11:00"), end: NOW }),
    );
    await flush();
    failingRateEnds = [NOW.getTime()];

    rerender(resourceChart({ id: "qemu/101", start: at("11:00"), end: NOW }));
    await flush();

    expect(zoomCharts()).toHaveLength(0);
    expect(skeletons()).toHaveLength(0);
    expect(screen.getByText(RATE_ERROR)).toBeInTheDocument();
  });
});
