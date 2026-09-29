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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 follow-up on the Proxmox cluster overview when its golden
 * metrics (the CPU / Memory / Network tiles and the four Cluster resource
 * usage charts) are slower than the 30-second auto-refresh. The page keeps
 * only its newest golden load, and the timer used to start one on every
 * tick whether or not one was still running: when every load outlasted
 * the interval, none ever landed - the tiles and charts as skeletons,
 * Refresh disabled and spinning.
 *
 * The page is rendered for real (its hero's AutoRefreshControl too) with
 * the golden aggregates parked until a test answers them. The cluster, its
 * inventory and the replication health (anchored to now, not to the
 * charts' window) answer at once.
 */

const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// A time on the test's day, e.g. at("11:36") or at("12:00:30").
function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-28T${withSeconds}.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: (): unknown => {
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

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "card-model-detail" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import ProxmoxClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  AUTO_REFRESH_MS,
  advance,
  Backlog,
  expectRefreshSettled,
  expectRefreshSpinning,
  refreshButton,
} from "./SlowLoadHarness";
import {
  chartWindows,
  customRangeLabel,
  doubleClick,
  dragAcross,
  flush,
  pickPreset,
  pickerLabel,
  presetLabel,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const CHARTS: number = 4; // CPU, Memory, Storage, Network
const REFRESH_STORAGE_KEY: string = "proxmox-overview-auto-refresh-interval";

// The golden load's aggregates; replication's are anchored to now.
const GOLDEN_METRICS: Array<string> = [
  "pve_cpu_usage_ratio",
  "pve_cpu_usage_limit",
  "pve_memory_usage_bytes",
  "pve_memory_size_bytes",
  "pve_disk_usage_bytes",
  "pve_network_receive_bytes",
  "pve_network_transmit_bytes",
];

interface AggregateCall {
  aggregateBy: {
    query: { name: string };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

type Point = {
  timestamp: Date;
  value: number;
  attributes: Record<string, string>;
};

// A golden aggregate, parked until the test answers it.
interface SlowCall {
  name: string;
  start: Date;
  end: Date;
}

const backlog: Backlog<SlowCall> = new Backlog<SlowCall>();
let slow: boolean = true;

function endsAt(end: Date): (call: SlowCall) => boolean {
  return (call: SlowCall): boolean => {
    return call.end.getTime() === end.getTime();
  };
}

function same<T>(value: T, count: number): Array<T> {
  return Array.from({ length: count }, (): T => {
    return value;
  });
}

function aggregateCallsNamed(names: Array<string>): number {
  return aggregateMock.mock.calls.filter((args: Array<unknown>): boolean => {
    return names.includes((args[0] as AggregateCall).aggregateBy.query.name);
  }).length;
}

/*
 * Node pve1's CPU ratio: 10% until 11:45, 60% after, one sample a minute.
 * The CPU tile (the last five minutes of the window) reads 60% on the
 * default half hour and 10% on a window zoomed in before 11:45.
 */
function points(call: AggregateCall): Array<Point> {
  if (call.aggregateBy.query.name !== "pve_cpu_usage_ratio") {
    return [];
  }

  const result: Array<Point> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));

    if (
      time.getTime() < call.aggregateBy.startTimestamp.getTime() ||
      time.getTime() > call.aggregateBy.endTimestamp.getTime()
    ) {
      continue;
    }

    result.push({
      timestamp: time,
      value: time.getTime() < at("11:45").getTime() ? 0.1 : 0.6,
      attributes: { id: "node/pve1" },
    });
  }

  return result;
}

function cpuTile(): HTMLElement {
  return screen
    .getAllByRole("button", { name: "About CPU" })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

async function mount(): Promise<void> {
  render(<ProxmoxClusterOverview {...PAGE_PROPS} />);
  await flush();
}

// Renders the page with its first golden load answered at once.
async function mountPainted(): Promise<void> {
  slow = false;
  await mount();
  expect(zoomCharts()).toHaveLength(CHARTS);
  slow = true;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  backlog.clear();
  slow = true;

  getItemMock.mockResolvedValue({
    _id: CLUSTER_ID,
    name: "pve-prod",
    otelCollectorStatus: "connected",
    lastSeenAt: NOW,
    nodeCount: 1,
    onlineNodeCount: 1,
    guestCount: 0,
    storageCount: 0,
    guestsWithoutBackupCount: 0,
  });

  getListMock.mockImplementation((request: unknown): Promise<unknown> => {
    const { modelType } = request as { modelType: unknown };
    const rows: Array<Record<string, unknown>> =
      modelType === ProxmoxResource
        ? [
            {
              kind: "Node",
              externalId: "node/pve1",
              name: "pve1",
              isUp: true,
              latestCpuPercent: 10,
              metricsUpdatedAt: NOW,
              lastSeenAt: NOW,
            },
          ]
        : [];

    return Promise.resolve({ data: rows, count: rows.length });
  });

  aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: AggregateCall = request as AggregateCall;
    const answer: { data: Array<Point> } = { data: points(call) };

    if (slow && GOLDEN_METRICS.includes(call.aggregateBy.query.name)) {
      return backlog.park(
        {
          name: call.aggregateBy.query.name,
          start: call.aggregateBy.startTimestamp,
          end: call.aggregateBy.endTimestamp,
        },
        answer,
      );
    }

    return Promise.resolve(answer);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Proxmox cluster overview: golden loads that outlast the auto-refresh", () => {
  test("a tick while the first golden load runs leaves it alone; the load lands, paints the tiles and charts and stops the spinner", async () => {
    await mount();

    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expect(zoomCharts()).toHaveLength(0);
    expectRefreshSpinning();
    const inventoryLoads: number = getListMock.mock.calls.length;
    const otherQueries: number = aggregateMock.mock.calls.length;

    await advance(AUTO_REFRESH_MS);

    // The golden load is left to run...
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    // ...while the inventory and the replication health still refresh.
    expect(getListMock.mock.calls.length).toBeGreaterThan(inventoryLoads);
    expect(aggregateMock.mock.calls.length).toBeGreaterThan(otherQueries);
    expect(aggregateCallsNamed(GOLDEN_METRICS)).toBe(GOLDEN_METRICS.length);
    expectRefreshSpinning();

    await advance(5_000);
    await backlog.release(endsAt(NOW));

    expect(chartWindows()).toEqual(same(windowOf(at("11:30"), NOW), CHARTS));
    expect(cpuTile()).toHaveTextContent("60.0%");
    expectRefreshSettled();
  });

  test("after a load that outlasted three ticks lands, the next tick loads the slid window, and the one after waits for it", async () => {
    await mount();

    await advance(3 * AUTO_REFRESH_MS + 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    await backlog.release(endsAt(NOW));
    expectRefreshSettled();

    // 12:02:00: one tick, one golden load, for the half hour up to it.
    await advance(AUTO_REFRESH_MS - 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expect(backlog.calls().every(endsAt(at("12:02")))).toBe(true);
    expectRefreshSpinning();

    // 12:02:30: still running, so this tick waits.
    await advance(AUTO_REFRESH_MS);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);

    await backlog.release(endsAt(at("12:02")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:32"), at("12:02")), CHARTS),
    );
    expectRefreshSettled();
  });

  test("a drag during a slow auto-refresh load wins when its answer lands first", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[3]!, at("11:36"), at("11:44"));
    expect(backlog.calls()).toHaveLength(2 * GOLDEN_METRICS.length);

    await backlog.release(endsAt(at("11:44")));
    await backlog.release(endsAt(at("12:00:30")));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("10.0%");
    expect(pickerLabel()).toBe(customRangeLabel(at("11:36"), at("11:44")));
    expectRefreshSettled();
  });

  test("a drag during a slow auto-refresh load wins when the older answer lands first", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[3]!, at("11:36"), at("11:44"));

    await backlog.release(endsAt(at("12:00:30")));
    expect(chartWindows()).toEqual(same(windowOf(at("11:30"), NOW), CHARTS));
    expectRefreshSpinning();

    await backlog.release(endsAt(at("11:44")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("10.0%");
    expectRefreshSettled();
  });

  test("the replaced load landing does not let the next tick replace the zoom's load, which still lands", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));
    await advance(5_000);
    await backlog.release(endsAt(at("12:00:30")));

    // 12:01:00: the zoom's load is still running; the tick waits for it.
    await advance(AUTO_REFRESH_MS - 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expect(backlog.calls().every(endsAt(at("11:44")))).toBe(true);

    await backlog.release(endsAt(at("11:44")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    expectRefreshSettled();
  });

  test("a double-click during the zoom's slow load puts the half hour back, and that load wins", async () => {
    await mountPainted();

    await dragAcross(zoomCharts()[0]!, at("11:36"), at("11:44"));
    await advance(AUTO_REFRESH_MS);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);

    await doubleClick(zoomCharts()[2]!);
    await backlog.release(endsAt(at("12:00:30")));
    await backlog.release(endsAt(at("11:44")));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30:30"), at("12:00:30")), CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("60.0%");
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_THIRTY_MINS));
    expectRefreshSettled();
  });

  test("Refresh pressed shortly before a tick paints when its own answer lands", async () => {
    await mountPainted();

    await advance(25_000);
    fireEvent.click(refreshButton());
    await flush();
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expectRefreshSpinning();

    // 12:00:30: the tick leaves the Refresh's golden load alone...
    await advance(5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);

    // ...which lands at 12:00:35 and is drawn.
    await advance(5_000);
    await backlog.release(endsAt(at("12:00:25")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30:25"), at("12:00:25")), CHARTS),
    );
    expectRefreshSettled();
  });

  test("a drag shortly before a tick paints when its own answer lands", async () => {
    await mountPainted();

    await advance(25_000);
    await dragAcross(zoomCharts()[3]!, at("11:36"), at("11:44"));
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);

    // 12:00:30: the tick would load the zoomed window again; it waits.
    await advance(5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);

    await advance(5_000);
    await backlog.release(endsAt(at("11:44")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("10.0%");
    expectRefreshSettled();
  });

  test("the picker during a slow auto-refresh load wins over it", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await advance(2_000);
    await pickPreset("Past 1 Hour");
    expect(backlog.calls()).toHaveLength(2 * GOLDEN_METRICS.length);

    await backlog.release(endsAt(at("12:00:32")));
    await backlog.release(endsAt(at("12:00:30")));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:00:32"), at("12:00:32")), CHARTS),
    );
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_ONE_HOUR));
    expectRefreshSettled();
  });

  test("on a remembered 10-second interval, a golden load that outlasts two ticks still lands, and the ticks go on after it", async () => {
    window.localStorage.setItem(REFRESH_STORAGE_KEY, "10s");
    await mount();

    // The ticks at 12:00:10 and 12:00:20 leave the first golden load alone.
    await advance(25_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expectRefreshSpinning();

    await backlog.release(endsAt(NOW));
    expect(chartWindows()).toEqual(same(windowOf(at("11:30"), NOW), CHARTS));
    expectRefreshSettled();

    // 12:00:30: nothing is running, so the tick loads the slid window.
    await advance(5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expect(backlog.calls().every(endsAt(at("12:00:30")))).toBe(true);
  });

  test("with auto-refresh off, nothing ticks, and a slow golden load still lands", async () => {
    window.localStorage.setItem(REFRESH_STORAGE_KEY, "off");
    await mount();

    await advance(5 * AUTO_REFRESH_MS);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);

    await backlog.release(endsAt(NOW));
    expect(chartWindows()).toEqual(same(windowOf(at("11:30"), NOW), CHARTS));
    expectRefreshSettled();
  });

  test("a failed golden load lets the timer go on: the next tick loads again", async () => {
    await mount();
    await advance(AUTO_REFRESH_MS + 5_000);

    await backlog.fail(endsAt(NOW), new Error("Analytics is down"));
    expect(screen.getAllByText("Analytics is down").length).toBeGreaterThan(0);
    expectRefreshSettled();

    await advance(AUTO_REFRESH_MS - 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_METRICS.length);
    expect(backlog.calls().every(endsAt(at("12:01")))).toBe(true);
  });
});
