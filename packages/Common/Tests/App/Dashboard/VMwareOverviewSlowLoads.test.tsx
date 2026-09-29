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
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 follow-up on the VMware vCenter overview when its golden
 * metrics (eight grouped aggregates behind the Host CPU / Memory / CPU
 * Ready tiles and the four resource-usage charts) are slower than the
 * 30-second auto-refresh. The page keeps only its newest golden load, and
 * the timer used to start one on every tick whether or not one was still
 * running: when every load outlasted the interval, none ever landed - the
 * tiles and charts as skeletons, Refresh disabled and spinning.
 *
 * The page is rendered for real (its hero's AutoRefreshControl too) with
 * the golden aggregates parked until a test answers them; the vCenter and
 * its inventory answer at once.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// A time on the test's day, e.g. at("11:36") or at("12:00:30").
function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-28T${withSeconds}.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

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
        return new ObjectIDType("11111111-1111-4111-8111-111111111111");
      },
      navigate: (): void => {},
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
        return new ObjectIDType("22222222-2222-4222-8222-222222222222");
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
      return React.createElement("section", { "data-testid": "details" });
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

import VMwareVCenterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import VMwareResourceModel from "../../../Models/DatabaseModels/VMwareResource";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  AUTO_REFRESH_MS,
  advance,
  Backlog,
  expectRefreshSettled,
  expectRefreshSpinning,
} from "./SlowLoadHarness";
import {
  chartWindows,
  customRangeLabel,
  doubleClick,
  dragAcross,
  flush,
  pickerLabel,
  presetLabel,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";
import { inventoryRow, vcenterModel } from "./VMwareTooltipHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const CHARTS: number = 4; // Host CPU, Host Memory, Datastore Used, VM CPU Ready
const GOLDEN_FETCHES: number = 8; // aggregates per golden-metrics load

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

/*
 * One ESXi host whose CPU runs at 10% until 11:45 and 60% after: the Host
 * CPU tile (the last five minutes of the window) reads 60% on the default
 * half hour and 10% on a window zoomed in before 11:45.
 */
function goldenPoints(call: AggregateCall): Array<Point> {
  if (call.aggregateBy.query.name !== "vcenter.host.cpu.utilization") {
    return [];
  }

  const points: Array<Point> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));

    if (
      time.getTime() < call.aggregateBy.startTimestamp.getTime() ||
      time.getTime() > call.aggregateBy.endTimestamp.getTime()
    ) {
      continue;
    }

    points.push({
      timestamp: time,
      value: time.getTime() < at("11:45").getTime() ? 10 : 60,
      attributes: {
        "resource.vcenter.datacenter.name": "dc1",
        "resource.vcenter.host.name": "esx01",
      },
    });
  }

  return points;
}

function hostCpuTile(): HTMLElement {
  // The first "About Host CPU" is the tile's.
  return screen
    .getAllByRole("button", { name: "About Host CPU" })[0]!
    .closest(".rounded-xl") as HTMLElement;
}

async function mount(): Promise<void> {
  render(<VMwareVCenterOverview {...PAGE_PROPS} />);
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

  getItemMock.mockResolvedValue(vcenterModel());
  getListMock.mockImplementation((): Promise<unknown> => {
    const rows: Array<VMwareResourceModel> = [
      inventoryRow({
        kind: "Host",
        externalId: "host/dc1/esx01",
        name: "esx01",
        datacenterName: "dc1",
        latestCpuPercent: 42,
        metricsUpdatedAt: NOW,
      }),
    ];
    return Promise.resolve({ data: rows, count: rows.length });
  });
  aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: AggregateCall = request as AggregateCall;
    const answer: { data: Array<Point> } = { data: goldenPoints(call) };

    if (slow) {
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

describe("VMware vCenter overview: golden loads that outlast the auto-refresh", () => {
  test("a tick while the first golden load runs leaves it alone; the load lands, paints the tiles and charts and stops the spinner", async () => {
    await mount();

    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);
    expect(zoomCharts()).toHaveLength(0);
    expectRefreshSpinning();
    const inventoryLoads: number = getListMock.mock.calls.length;

    await advance(AUTO_REFRESH_MS);

    // The golden load is left to run; the inventory still refreshes.
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);
    expect(getListMock.mock.calls.length).toBeGreaterThan(inventoryLoads);
    expectRefreshSpinning();

    await advance(5_000);
    await backlog.release(endsAt(NOW));

    expect(chartWindows()).toEqual(same(windowOf(at("11:30"), NOW), CHARTS));
    expect(hostCpuTile()).toHaveTextContent("60.0%");
    expectRefreshSettled();
  });

  test("after a load that outlasted three ticks lands, the next tick loads the slid window, and the one after waits for it", async () => {
    await mount();

    await advance(3 * AUTO_REFRESH_MS + 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);
    await backlog.release(endsAt(NOW));
    expectRefreshSettled();

    // 12:02:00: one tick, one golden load, for the half hour up to it.
    await advance(AUTO_REFRESH_MS - 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);
    expect(backlog.calls().every(endsAt(at("12:02")))).toBe(true);
    expectRefreshSpinning();

    // 12:02:30: still running, so this tick waits.
    await advance(AUTO_REFRESH_MS);
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);

    await backlog.release(endsAt(at("12:02")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:32"), at("12:02")), CHARTS),
    );
    expectRefreshSettled();
  });

  test("a drag during a slow auto-refresh load wins when its answer lands first", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));
    expect(backlog.calls()).toHaveLength(2 * GOLDEN_FETCHES);

    await backlog.release(endsAt(at("11:44")));
    await backlog.release(endsAt(at("12:00:30")));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    // 11:39-11:44 is before the host got busy.
    expect(hostCpuTile()).toHaveTextContent("10.0%");
    expect(pickerLabel()).toBe(customRangeLabel(at("11:36"), at("11:44")));
    expectRefreshSettled();
  });

  test("a drag during a slow auto-refresh load wins when the older answer lands first", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));

    await backlog.release(endsAt(at("12:00:30")));
    expect(chartWindows()).toEqual(same(windowOf(at("11:30"), NOW), CHARTS));
    expectRefreshSpinning();

    await backlog.release(endsAt(at("11:44")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    expect(hostCpuTile()).toHaveTextContent("10.0%");
    expectRefreshSettled();
  });

  test("the replaced load landing does not let the next tick replace the zoom's load, which still lands", async () => {
    await mountPainted();

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));
    await advance(5_000);
    await backlog.release(endsAt(at("12:00:30")));

    // 12:01:00: the zoom's load is still running; the tick waits for it.
    await advance(AUTO_REFRESH_MS - 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);
    expect(backlog.calls().every(endsAt(at("11:44")))).toBe(true);

    await backlog.release(endsAt(at("11:44")));
    expect(chartWindows()).toEqual(
      same(windowOf(at("11:36"), at("11:44")), CHARTS),
    );
    expectRefreshSettled();
  });

  test("a double-click during the zoom's slow load puts the half hour back, and that load wins", async () => {
    await mountPainted();

    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));
    await advance(AUTO_REFRESH_MS);
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);

    await doubleClick(zoomCharts()[2]!);
    await backlog.release(endsAt(at("12:00:30")));
    await backlog.release(endsAt(at("11:44")));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:30:30"), at("12:00:30")), CHARTS),
    );
    expect(hostCpuTile()).toHaveTextContent("60.0%");
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_THIRTY_MINS));
    expectRefreshSettled();
  });

  test("a failed golden load lets the timer go on: the next tick loads again", async () => {
    await mount();
    await advance(AUTO_REFRESH_MS + 5_000);

    await backlog.fail(endsAt(NOW), new Error("Analytics is down"));
    expect(screen.getAllByText("Analytics is down").length).toBeGreaterThan(0);
    expectRefreshSettled();

    await advance(AUTO_REFRESH_MS - 5_000);
    expect(backlog.calls()).toHaveLength(GOLDEN_FETCHES);
    expect(backlog.calls().every(endsAt(at("12:01")))).toBe(true);
  });
});
