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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the Proxmox pages, rendered for real with the network
 * mocked and the charts replaced by the zoom stand-ins (see
 * TimeRangeZoomPageHarness). The rate charts (ProxmoxRateChart) are the
 * real component: they fetch their counters through the mocked API and
 * draw through the chart stand-in.
 *
 *   - Cluster overview: the four "Cluster resource usage" charts hold the
 *     page's one zoom. A drag reloads the golden metrics for the window;
 *     replication health (a fixed "last 30 minutes, now" card) and the
 *     inventory are left alone.
 *   - Insights: five cards share one range and one zoom - the metric charts
 *     AND the disk / network rate charts. A drag on any of them retimes
 *     every card and refetches both rate charts; a double-click on any
 *     other one puts it all back. A rate chart zoomed into a quiet stretch
 *     takes the double-click on its empty state.
 *   - Node and guest detail: the Metrics tab (ResourceMetricsTab) owns its
 *     range; its metric charts and rate charts share the tab's zoom.
 */

const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    const harness: { StandInAutoRefreshControl: unknown } = jest.requireActual(
      "./TimeRangeZoomPageHarness",
    ) as {
      StandInAutoRefreshControl: unknown;
    };
    return { __esModule: true, default: harness.StandInAutoRefreshControl };
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

import ProxmoxClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index";
import ProxmoxClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Insights";
import ProxmoxClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/NodeDetail";
import ProxmoxClusterGuestDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/GuestDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import TimeRange from "../../../Types/Time/TimeRange";
import { TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX } from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import {
  cardPickers,
  chartWindows,
  customRangeLabel,
  deferred,
  Deferred,
  doubleClick,
  dragAcross,
  expectOneSharedZoom,
  expectRevealedOnHoverOf,
  flush,
  metricViews,
  pickerLabel,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomCharts,
  zoomHints,
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

function aggregateCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls.map((args: Array<unknown>): AggregateCall => {
    return args[0] as AggregateCall;
  });
}

function callsNamed(
  names: Array<string>,
  calls: Array<AggregateCall> = aggregateCalls(),
): Array<AggregateCall> {
  return calls.filter((call: AggregateCall): boolean => {
    return names.includes(call.aggregateBy.query.name);
  });
}

function windowsOf(calls: Array<AggregateCall>): Array<[string, string]> {
  return calls.map((call: AggregateCall): [string, string] => {
    return [
      call.aggregateBy.startTimestamp.toISOString(),
      call.aggregateBy.endTimestamp.toISOString(),
    ];
  });
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

const RATE_METRICS: Array<string> = [
  "pve_disk_read_bytes",
  "pve_disk_write_bytes",
  "pve_network_receive_bytes",
  "pve_network_transmit_bytes",
];

const REPLICATION_METRICS: Array<string> = [
  "pve_replication_info",
  "pve_replication_last_sync_timestamp_seconds",
  "pve_replication_duration_seconds",
  "pve_replication_failed_syncs",
];

// From when the counters (and the node's CPU samples) exist.
let countersFrom: Date = at("11:00");

/*
 * A sample a minute from 11:00 to 11:59, inside the asked-for window:
 * node pve1's CPU ratio (10% until 11:45, 60% after), and every counter
 * rising 60 KB a minute (1 KB/s) for pve1 and guest 100.
 */
function points(call: AggregateCall): Array<Point> {
  const name: string = call.aggregateBy.query.name;
  const start: number = call.aggregateBy.startTimestamp.getTime();
  const end: number = call.aggregateBy.endTimestamp.getTime();
  const result: Array<Point> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));

    if (
      time.getTime() < start ||
      time.getTime() > end ||
      time.getTime() < countersFrom.getTime()
    ) {
      continue;
    }

    if (name === "pve_cpu_usage_ratio") {
      result.push({
        timestamp: time,
        value: time.getTime() < at("11:45").getTime() ? 0.1 : 0.6,
        attributes: { id: "node/pve1" },
      });
    } else if (RATE_METRICS.includes(name)) {
      for (const id of ["node/pve1", "qemu/100"]) {
        result.push({
          timestamp: time,
          value: minute * 60_000,
          attributes: { id: id },
        });
      }
    }
  }

  return result;
}

interface HeldAggregate {
  call: AggregateCall;
  release: () => void;
}

let holdAggregates: boolean = false;
let heldAggregates: Array<HeldAggregate> = [];

async function releaseAggregatesEndingAt(end: Date): Promise<void> {
  const releasing: Array<HeldAggregate> = heldAggregates.filter(
    (held: HeldAggregate): boolean => {
      return held.call.aggregateBy.endTimestamp.getTime() === end.getTime();
    },
  );

  heldAggregates = heldAggregates.filter((held: HeldAggregate): boolean => {
    return !releasing.includes(held);
  });

  expect(releasing.length).toBeGreaterThan(0);

  for (const held of releasing) {
    held.release();
  }

  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  holdAggregates = false;
  heldAggregates = [];
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
    const answer: { data: Array<Point> } = { data: points(call) };

    if (holdAggregates) {
      const held: Deferred<{ data: Array<Point> }> = deferred<{
        data: Array<Point>;
      }>();
      heldAggregates.push({
        call: call,
        release: (): void => {
          held.resolve(answer);
        },
      });
      return held.promise;
    }

    return Promise.resolve(answer);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ---------------------------------------------------------- cluster overview

const OVERVIEW_CHARTS: number = 4; // CPU, Memory, Storage, Network
const GOLDEN_METRICS: Array<string> = [
  "pve_cpu_usage_ratio",
  "pve_cpu_usage_limit",
  "pve_memory_usage_bytes",
  "pve_memory_size_bytes",
  "pve_disk_usage_bytes",
  "pve_network_receive_bytes",
  "pve_network_transmit_bytes",
];

async function renderOverview(): Promise<void> {
  render(<ProxmoxClusterOverview {...PAGE_PROPS} />);
  await flush();
  expect(zoomCharts()).toHaveLength(OVERVIEW_CHARTS);
}

function lastGoldenWindows(): Array<[string, string]> {
  return windowsOf(callsNamed(GOLDEN_METRICS).slice(-GOLDEN_METRICS.length));
}

function cpuTile(): HTMLElement {
  return screen
    .getAllByRole("button", { name: "About CPU" })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

describe("Proxmox cluster overview: one zoom for Cluster resource usage", () => {
  test("the four charts hold the page's one zoom; the section heading names the gesture", async () => {
    await renderOverview();

    expectOneSharedZoom({ zoomed: false });
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(1);
    const section: HTMLElement = expectRevealedOnHoverOf(hints[0]!);
    expect(section).toHaveTextContent("Cluster resource usage");
    expect(section.querySelectorAll('[data-testid="zoom-chart"]')).toHaveLength(
      OVERVIEW_CHARTS,
    );
  });

  test("a drag on Network reloads the golden metrics for the window, and nothing else", async () => {
    await renderOverview();
    expect(cpuTile()).toHaveTextContent("60.0%");
    const replicationCalls: number = callsNamed(REPLICATION_METRICS).length;
    const inventoryLoads: number = getListMock.mock.calls.length;

    await dragAcross(zoomCharts()[3]!, at("11:36"), at("11:44"));

    expect(lastGoldenWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), GOLDEN_METRICS.length),
    );
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), OVERVIEW_CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("10.0%");
    // Replication health and the inventory are "now", not the chart window.
    expect(callsNamed(REPLICATION_METRICS)).toHaveLength(replicationCalls);
    expect(getListMock.mock.calls.length).toBe(inventoryLoads);

    expect(pickerLabel()).toBe(customRangeLabel(at("11:36"), at("11:44")));
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({ zoomed: true });
  });

  test("a double-click on a different chart, or Reset zoom, puts the half hour back", async () => {
    await renderOverview();

    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));
    await doubleClick(zoomCharts()[2]!);

    expect(lastGoldenWindows()[0]).toEqual(windowOf(at("11:30"), NOW));
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_THIRTY_MINS));
    expectOneSharedZoom({ zoomed: false });

    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));
    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("60.0%");
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("auto-refresh while zoomed reloads the zoomed window; replication stays anchored to now", async () => {
    await renderOverview();
    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();

    expect(lastGoldenWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), GOLDEN_METRICS.length),
    );
    // Replication reads the 30 minutes up to the tick, zoom or no zoom.
    const tick: Date = new Date(NOW.getTime() + 30_000);
    const replication: Array<AggregateCall> = callsNamed(REPLICATION_METRICS);
    expect(windowsOf(replication.slice(-REPLICATION_METRICS.length))).toEqual(
      same(
        windowOf(new Date(tick.getTime() - 30 * 60_000), tick),
        REPLICATION_METRICS.length,
      ),
    );
    expect(resetZoomButtons()).toHaveLength(1);
  });

  test("a slow golden-metrics response for the zoom cannot repaint the page after the reset", async () => {
    await renderOverview();
    holdAggregates = true;

    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));
    await doubleClick(zoomCharts()[1]!);

    await releaseAggregatesEndingAt(NOW);
    await releaseAggregatesEndingAt(at("11:44"));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("60.0%");
  });
});

// ------------------------------------------------------------------ insights

const INSIGHTS_CARDS: number = 5;
const INSIGHTS_METRIC_VIEWS: number = 4; // Network has only its rate chart

async function renderInsights(): Promise<void> {
  render(<ProxmoxClusterInsights {...PAGE_PROPS} />);
  await flush();
  expect(metricViews()).toHaveLength(INSIGHTS_METRIC_VIEWS);
}

function lastRateWindows(): Array<[string, string]> {
  return windowsOf(callsNamed(RATE_METRICS).slice(-RATE_METRICS.length));
}

describe("Proxmox Insights: five cards and two rate charts, one zoom", () => {
  test("the metric charts and both rate charts hold the page's one zoom", async () => {
    await renderInsights();

    // The disk throughput chart (Storage) and the network chart (Network).
    expect(zoomCharts()).toHaveLength(2);
    expectOneSharedZoom({
      zoomed: false,
      among: [...metricViews(), ...zoomCharts()],
    });
    expect(chartWindows([...metricViews(), ...zoomCharts()])).toEqual(
      same(windowOf(at("11:00"), NOW), INSIGHTS_METRIC_VIEWS + 2),
    );
  });

  test("a drag on the network rate chart retimes every card and refetches both rate charts", async () => {
    await renderInsights();

    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:20"), at("11:30")), INSIGHTS_METRIC_VIEWS),
    );
    expect(lastRateWindows()).toEqual(
      same(windowOf(at("11:20"), at("11:30")), RATE_METRICS.length),
    );
    expect(chartWindows()).toEqual(same(windowOf(at("11:20"), at("11:30")), 2));
    expect(
      cardPickers().map((picker: HTMLElement): string => {
        return picker.textContent || "";
      }),
    ).toEqual(same(TimeRange.CUSTOM, INSIGHTS_CARDS));
    expect(resetZoomButtons()).toHaveLength(INSIGHTS_CARDS);
    expectOneSharedZoom({
      zoomed: true,
      among: [...metricViews(), ...zoomCharts()],
    });
  });

  test("a double-click on the Compute card's chart puts every card and rate chart back on the hour", async () => {
    await renderInsights();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    await doubleClick(metricViews()[0]!);

    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:00"), NOW), INSIGHTS_METRIC_VIEWS),
    );
    expect(lastRateWindows()).toEqual(
      same(windowOf(at("11:00"), NOW), RATE_METRICS.length),
    );
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("a drag on a metric chart and a double-click on a rate chart work together", async () => {
    await renderInsights();

    await dragAcross(metricViews()[3]!, at("11:10"), at("11:50"));
    expect(lastRateWindows()[0]).toEqual(windowOf(at("11:10"), at("11:50")));

    await doubleClick(zoomCharts()[1]!);

    expect(chartWindows(metricViews())[3]).toEqual(windowOf(at("11:00"), NOW));
    expect(lastRateWindows()[0]).toEqual(windowOf(at("11:00"), NOW));
  });

  test("a rate chart zoomed into a quiet stretch takes the double-click on its empty state", async () => {
    // The counters only exist from 11:40.
    countersFrom = at("11:40");
    await renderInsights();
    expect(zoomCharts()).toHaveLength(2);

    await dragAcross(metricViews()[1]!, at("11:10"), at("11:30"));

    expect(zoomCharts()).toHaveLength(0);
    const empties: Array<HTMLElement> = screen.getAllByText(
      "No data reported for the selected time range.",
    );
    expect(empties).toHaveLength(2);

    fireEvent.doubleClick(empties[1]!);
    await flush();

    expect(zoomCharts()).toHaveLength(2);
    expect(chartWindows(metricViews())).toEqual(
      same(windowOf(at("11:00"), NOW), INSIGHTS_METRIC_VIEWS),
    );
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("with nothing zoomed, a double-click on an empty rate chart does nothing", async () => {
    countersFrom = at("12:30");
    await renderInsights();
    const before: number = callsNamed(RATE_METRICS).length;

    fireEvent.doubleClick(
      screen.getAllByText("No data reported for the selected time range.")[0]!,
    );
    await flush();

    expect(callsNamed(RATE_METRICS)).toHaveLength(before);
    expect(chartWindows(metricViews())[0]).toEqual(windowOf(at("11:00"), NOW));
  });
});

// ------------------------------------------------- node and guest Metrics tab

async function openMetricsTab(): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
  await flush();
}

describe("Proxmox node detail: the Metrics tab zooms itself", () => {
  async function renderNodeMetrics(): Promise<void> {
    mockLastParam = "node%2Fpve1";
    render(<ProxmoxClusterNodeDetail {...PAGE_PROPS} />);
    await flush();
    await openMetricsTab();
    expect(metricViews()).toHaveLength(1);
    // Network and disk throughput for the node.
    expect(zoomCharts()).toHaveLength(2);
  }

  test("the tab's metric charts and both rate charts share the tab's one zoom", async () => {
    await renderNodeMetrics();

    expectOneSharedZoom({
      zoomed: false,
      among: [...metricViews(), ...zoomCharts()],
    });
    // The tab owns the range: its own picker, no page-wide one.
    expect(cardPickers()).toHaveLength(1);
    expect(
      screen.queryByTestId(
        `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
      ),
    ).toBeNull();
  });

  test("a drag on the disk throughput chart retimes the whole tab", async () => {
    await renderNodeMetrics();

    await dragAcross(zoomCharts()[1]!, at("11:20"), at("11:30"));

    expect(chartWindows(metricViews())).toEqual([
      windowOf(at("11:20"), at("11:30")),
    ]);
    expect(chartWindows()).toEqual(same(windowOf(at("11:20"), at("11:30")), 2));
    // Both rate charts refetch, still scoped to this node.
    const rates: Array<AggregateCall> = callsNamed(RATE_METRICS).slice(-4);
    expect(windowsOf(rates)).toEqual(
      same(windowOf(at("11:20"), at("11:30")), 4),
    );
    for (const call of rates) {
      expect(call.aggregateBy.query.attributes["id"]).toBe("node/pve1");
    }
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.CUSTOM);
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({
      zoomed: true,
      among: [...metricViews(), ...zoomCharts()],
    });
  });

  test("a double-click on the metric chart puts the tab back on its hour", async () => {
    await renderNodeMetrics();
    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    await doubleClick(metricViews()[0]!);

    expect(chartWindows(metricViews())).toEqual([windowOf(at("11:00"), NOW)]);
    expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
    expect(cardPickers()[0]).toHaveTextContent(TimeRange.PAST_ONE_HOUR);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("Reset zoom in the tab's header does the same", async () => {
    await renderNodeMetrics();
    await dragAcross(metricViews()[0]!, at("11:20"), at("11:30"));
    expect(chartWindows()).toEqual(same(windowOf(at("11:20"), at("11:30")), 2));

    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(chartWindows()).toEqual(same(windowOf(at("11:00"), NOW), 2));
  });
});

describe("Proxmox guest detail: the Metrics tab zooms itself", () => {
  test("a drag on the guest's network chart retimes the tab; a double-click on its disk chart undoes it", async () => {
    mockLastParam = "qemu%2F100";
    render(<ProxmoxClusterGuestDetail {...PAGE_PROPS} />);
    await flush();
    await openMetricsTab();
    expect(zoomCharts()).toHaveLength(2);
    expectOneSharedZoom({
      zoomed: false,
      among: [...metricViews(), ...zoomCharts()],
    });

    await dragAcross(zoomCharts()[0]!, at("11:20"), at("11:30"));

    expect(chartWindows([...metricViews(), ...zoomCharts()])).toEqual(
      same(windowOf(at("11:20"), at("11:30")), metricViews().length + 2),
    );
    for (const call of callsNamed(RATE_METRICS).slice(-4)) {
      expect(call.aggregateBy.query.attributes["id"]).toBe("qemu/100");
    }

    await doubleClick(zoomCharts()[1]!);

    expect(chartWindows([...metricViews(), ...zoomCharts()])).toEqual(
      same(windowOf(at("11:00"), NOW), metricViews().length + 2),
    );
  });
});
