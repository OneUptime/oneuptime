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
 * Issue #4105 follow-up on the Host pages - the overview, a process, a
 * Windows service and a systemd unit - when the backend is slower than the
 * 30-second auto-refresh. Each page keeps only its newest load (so a zoom
 * and its reset cannot land out of order), and its timer used to start a
 * load on every tick whether or not one was still running. A load that
 * outlasted the interval was then superseded by the tick's before it
 * landed, and when every load did, none ever landed: skeletons for good,
 * Refresh disabled and spinning.
 *
 * Each page is rendered for real, its hero's AutoRefreshControl included,
 * with the slow calls parked until a test answers them:
 *
 *   - a tick while a load runs leaves it alone; the load lands, paints the
 *     page and stops the spinner, and auto-refresh carries on after it;
 *   - a zoom, its reset and the picker still replace a running load, and
 *     whichever answer lands first, the newest window wins;
 *   - the replaced load's answer landing does not let the timer replace the
 *     zoom's load while that one still runs;
 *   - a load that fails, or finds no host, lets the timer go on too.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

// A time on the test's day, e.g. at("11:36") or at("12:00:30").
function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-28T${withSeconds}.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const lastParamMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
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
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: (): unknown => {
        return lastParamMock();
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

// Covered by its own suite; it fetches counts that do not follow the range.
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

import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import HostProcessView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ProcessView";
import HostServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ServiceView";
import HostSystemdUnitView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnitView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TimeRange from "../../../Types/Time/TimeRange";
import { infoButtonsFor } from "./HostTooltipHarness";
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
  pickPreset,
  pickerLabel,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomCharts,
} from "./TimeRangeZoomPageHarness";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const PAST_30_MINUTES: string = presetLabel(TimeRange.PAST_THIRTY_MINS);

type Row = Record<string, unknown>;

interface TimeWindow {
  startValue: Date;
  endValue: Date;
}

interface AggregateRequest {
  aggregateBy: {
    query: { name: string; attributes: Record<string, string> };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

interface ListRequest {
  query: { name: string; time: TimeWindow };
}

type SlowKind = "aggregate" | "list";

// A call the backend parked, and the window it asked for.
interface SlowCall {
  kind: SlowKind;
  start: Date;
  end: Date;
}

const backlog: Backlog<SlowCall> = new Backlog<SlowCall>();

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

// One row a minute from 11:00 to 11:59.
function everyMinute(
  value: (time: Date) => number,
  attributes?: Record<string, string>,
): Array<Row> {
  const rows: Array<Row> = [];

  for (let minute: number = 0; minute < 60; minute++) {
    const time: Date = new Date(Date.UTC(2026, 8, 28, 11, minute));
    rows.push({
      timestamp: time,
      value: value(time),
      ...(attributes ? { attributes: attributes } : {}),
    });
  }

  return rows;
}

function inside(rows: Array<Row>, start: Date, end: Date): Array<Row> {
  return rows.filter((row: Row): boolean => {
    const time: number = (row["timestamp"] as Date).getTime();
    return time >= start.getTime() && time <= end.getTime();
  });
}

/*
 * The overview's host: CPU quiet (12%) until 11:45 and busy (64%) after, so
 * the CPU tile - the last five minutes of the window - reads 64% on the
 * default half hour and 12% on a window zoomed in before 11:45.
 */
function overviewRows(request: AggregateRequest): Array<Row> {
  const attributes: Record<string, string> =
    request.aggregateBy.query.attributes;

  switch (request.aggregateBy.query.name) {
    case "system.cpu.utilization":
      return everyMinute((time: Date): number => {
        if (attributes["state"] !== "user") {
          return 0;
        }
        return time.getTime() < at("11:45").getTime() ? 0.12 : 0.64;
      });
    case "system.memory.utilization":
      return everyMinute((): number => {
        return 0.5;
      });
    case "oneuptime.host.heartbeat":
      return everyMinute((): number => {
        return 2;
      });
    default:
      return [];
  }
}

// The process started at 11:40.
function processRows(request: AggregateRequest): Array<Row> {
  const alive: Array<Row> = everyMinute((): number => {
    return 0.3;
  }).filter((row: Row): boolean => {
    return (row["timestamp"] as Date).getTime() >= at("11:40").getTime();
  });

  return request.aggregateBy.query.name === "process.cpu.utilization"
    ? alive
    : [];
}

// The process's identity: its latest sample in the lookup window.
function processIdentity(request: ListRequest): Array<Row> {
  const end: Date = request.query.time.endValue;

  if (end.getTime() <= at("11:40").getTime()) {
    return [];
  }

  return [
    {
      time: new Date(end.getTime() - 60_000),
      attributes: {
        "resource.process.pid": "4321",
        "resource.process.executable.name": "postgres",
        "resource.process.command": "postgres -D /var/lib/postgresql",
        "resource.process.owner": "postgres",
      },
    },
  ];
}

/*
 * A sample every 30 seconds from 11:00, newest first as the API returns
 * them; `attributesAt` says what each one carries.
 */
function samplesEvery30s(
  window: TimeWindow,
  sample: (time: Date) => Row,
): Array<Row> {
  const rows: Array<Row> = [];

  for (let i: number = 0; i < 120; i++) {
    const time: Date = new Date(at("11:00").getTime() + i * 30_000);

    if (
      time.getTime() >= window.startValue.getTime() &&
      time.getTime() <= window.endValue.getTime()
    ) {
      rows.push({ time: time, ...sample(time) });
    }
  }

  return rows.reverse();
}

function stoppedAt(time: Date): boolean {
  return (
    time.getTime() >= at("11:45").getTime() &&
    time.getTime() < at("11:50").getTime()
  );
}

// Running (4), except Stopped (1) from 11:45 to 11:50.
function serviceRows(request: ListRequest): Array<Row> {
  return samplesEvery30s(request.query.time, (time: Date): Row => {
    return {
      value: stoppedAt(time) ? 1 : 4,
      attributes: {
        name: "Spooler",
        startup_mode: "auto_start",
        "resource.host.name": "web-01",
      },
    };
  });
}

// Active, except failed from 11:45 to 11:50.
function unitRows(request: ListRequest): Array<Row> {
  return samplesEvery30s(request.query.time, (time: Date): Row => {
    return {
      value: 1,
      attributes: {
        "resource.systemd.unit.name": "nginx.service",
        "systemd.unit.active_state": stoppedAt(time) ? "failed" : "active",
        "resource.host.name": "web-01",
      },
    };
  });
}

interface HostPageCase {
  Page: React.FunctionComponent<PageComponentProps>;
  // The pid, service or unit the route names.
  lastParam: string;
  // The calls that are slow, and how many one load makes.
  slowKind: SlowKind;
  callsPerLoad: number;
  // Charts on screen once a load has landed.
  charts: number;
  // A window to drag out that has data in it.
  zoom: [Date, Date];
  aggregateRows: (request: AggregateRequest) => Array<Row>;
  listRows: (request: ListRequest) => Array<Row>;
}

const NO_ROWS: () => Array<Row> = (): Array<Row> => {
  return [];
};

const HOST_PAGES: Array<[string, HostPageCase]> = [
  [
    "Host overview",
    {
      Page: HostOverview,
      lastParam: "",
      slowKind: "aggregate",
      callsPerLoad: 9,
      charts: 5, // Availability, CPU, Memory, Disk space, Network
      zoom: [at("11:36"), at("11:44")],
      aggregateRows: overviewRows,
      listRows: NO_ROWS,
    },
  ],
  [
    "Host process view",
    {
      Page: HostProcessView,
      lastParam: "4321",
      slowKind: "aggregate",
      callsPerLoad: 6,
      charts: 3, // CPU, Memory (RSS), Disk I/O
      zoom: [at("11:44"), at("11:52")],
      aggregateRows: processRows,
      listRows: processIdentity,
    },
  ],
  [
    "Host Windows service view",
    {
      Page: HostServiceView,
      lastParam: "Spooler",
      slowKind: "list",
      callsPerLoad: 1,
      charts: 1, // the status timeline
      zoom: [at("11:46"), at("11:49")],
      aggregateRows: NO_ROWS,
      listRows: serviceRows,
    },
  ],
  [
    "Host systemd unit view",
    {
      Page: HostSystemdUnitView,
      lastParam: "nginx.service",
      slowKind: "list",
      callsPerLoad: 1,
      charts: 1, // the state timeline
      zoom: [at("11:46"), at("11:49")],
      aggregateRows: NO_ROWS,
      listRows: unitRows,
    },
  ],
];

// Whether the slow calls are parked, or answered at once.
let slow: boolean = true;

function serve(pageCase: HostPageCase): void {
  lastParamMock.mockReturnValue(pageCase.lastParam);

  aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: AggregateRequest = request as AggregateRequest;
    const start: Date = call.aggregateBy.startTimestamp;
    const end: Date = call.aggregateBy.endTimestamp;
    const answer: { data: Array<Row> } = {
      data: inside(pageCase.aggregateRows(call), start, end),
    };

    if (slow && pageCase.slowKind === "aggregate") {
      return backlog.park({ kind: "aggregate", start: start, end: end }, answer);
    }

    return Promise.resolve(answer);
  });

  getListMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: ListRequest = request as ListRequest;
    const answer: { data: Array<Row> } = { data: pageCase.listRows(call) };

    if (slow && pageCase.slowKind === "list") {
      return backlog.park(
        {
          kind: "list",
          start: call.query.time.startValue,
          end: call.query.time.endValue,
        },
        answer,
      );
    }

    return Promise.resolve(answer);
  });
}

async function mount(pageCase: HostPageCase): Promise<void> {
  serve(pageCase);
  render(<pageCase.Page {...PAGE_PROPS} />);
  await flush();
}

// Renders the page with its first load answered at once, then goes slow.
async function mountPainted(pageCase: HostPageCase): Promise<void> {
  slow = false;
  await mount(pageCase);
  expect(zoomCharts()).toHaveLength(pageCase.charts);
  slow = true;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  lastParamMock.mockReset();
  backlog.clear();
  slow = true;
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      _id: HOST_ID,
      name: "web-01",
      hostIdentifier: "web-01",
      otelCollectorStatus: "connected",
      lastSeenAt: NOW,
      cpuCores: 4,
      totalMemoryBytes: 16 * GIB,
      processCount: 212,
      osType: "linux",
    });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(HOST_PAGES)(
  "%s: loads that outlast the auto-refresh",
  (_name: string, pageCase: HostPageCase) => {
    test("a tick while the first load runs leaves it alone; the load lands, paints the page and stops the spinner", async () => {
      await mount(pageCase);

      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expect(zoomCharts()).toHaveLength(0);
      expectRefreshSpinning();
      const hostLookups: number = getItemMock.mock.calls.length;

      await advance(AUTO_REFRESH_MS);

      // The tick asked for nothing: it waits for the load still running.
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expect(getItemMock.mock.calls.length).toBe(hostLookups);
      expectRefreshSpinning();

      // Five seconds past the tick, the first load's answer lands.
      await advance(5_000);
      await backlog.release(endsAt(NOW));

      expect(zoomCharts()).toHaveLength(pageCase.charts);
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:30"), NOW), pageCase.charts),
      );
      expectRefreshSettled();
    });

    test("however many ticks a load outlasts, it lands, and only then does the next tick load again", async () => {
      await mount(pageCase);

      // Three ticks come and go while the first load runs.
      await advance(3 * AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);

      await advance(5_000);
      await backlog.release(endsAt(NOW));
      expect(zoomCharts()).toHaveLength(pageCase.charts);
      expectRefreshSettled();

      // The skipped ticks are not made up for: one tick, one load.
      await advance(AUTO_REFRESH_MS - 5_000);
      const tick: Date = at("12:02");
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expect(
        backlog.calls().every((call: SlowCall): boolean => {
          return call.end.getTime() === tick.getTime();
        }),
      ).toBe(true);
      expectRefreshSpinning();
    });

    test("auto-refresh carries on: each landed load is followed by a tick for the slid window, which the next tick waits for", async () => {
      await mountPainted(pageCase);

      // 12:00:30: the tick loads the half hour up to now.
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expectRefreshSpinning();

      // 12:01:00: that load is still running, so this tick waits.
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);

      await advance(5_000);
      await backlog.release(endsAt(at("12:00:30")));
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:30:30"), at("12:00:30")), pageCase.charts),
      );
      expectRefreshSettled();

      // 12:01:30: the next tick loads again, up to the new now.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expect(backlog.calls()[0]!.end).toEqual(at("12:01:30"));
    });

    test("a drag while an auto-refresh load runs wins when its answer lands first", async () => {
      await mountPainted(pageCase);
      const [zoomStart, zoomEnd] = pageCase.zoom;

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, zoomStart, zoomEnd);
      expect(backlog.calls()).toHaveLength(2 * pageCase.callsPerLoad);

      await backlog.release(endsAt(zoomEnd));
      await backlog.release(endsAt(at("12:00:30")));

      expect(chartWindows()).toEqual(
        same(windowOf(zoomStart, zoomEnd), pageCase.charts),
      );
      expect(pickerLabel()).toBe(customRangeLabel(zoomStart, zoomEnd));
      expectRefreshSettled();
    });

    test("a drag while an auto-refresh load runs wins when the older answer lands first", async () => {
      await mountPainted(pageCase);
      const [zoomStart, zoomEnd] = pageCase.zoom;

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, zoomStart, zoomEnd);

      // The replaced load lands: nothing it read is drawn...
      await backlog.release(endsAt(at("12:00:30")));
      expect(chartWindows()).toEqual(
        same(windowOf(at("11:30"), NOW), pageCase.charts),
      );
      // ...and the zoom's load is still the one the page waits for.
      expectRefreshSpinning();

      await backlog.release(endsAt(zoomEnd));
      expect(chartWindows()).toEqual(
        same(windowOf(zoomStart, zoomEnd), pageCase.charts),
      );
      expectRefreshSettled();
    });

    test("the replaced load landing does not let the next tick replace the zoom's load, which still lands", async () => {
      await mountPainted(pageCase);
      const [zoomStart, zoomEnd] = pageCase.zoom;

      await advance(AUTO_REFRESH_MS);
      await dragAcross(zoomCharts()[0]!, zoomStart, zoomEnd);
      await advance(5_000);
      await backlog.release(endsAt(at("12:00:30")));

      // 12:01:00: the zoom's load is still running; the tick waits for it.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expect(
        backlog.calls().every((call: SlowCall): boolean => {
          return call.end.getTime() === zoomEnd.getTime();
        }),
      ).toBe(true);

      await backlog.release(endsAt(zoomEnd));
      expect(chartWindows()).toEqual(
        same(windowOf(zoomStart, zoomEnd), pageCase.charts),
      );
      expect(resetZoomButtons()).toHaveLength(1);
      expectRefreshSettled();
    });

    test("a double-click while the zoom's load runs puts the half hour back, and its load wins", async () => {
      await mountPainted(pageCase);
      const [zoomStart, zoomEnd] = pageCase.zoom;

      await dragAcross(zoomCharts()[0]!, zoomStart, zoomEnd);
      await advance(AUTO_REFRESH_MS);
      // The zoom's load outlasts the tick, which waits for it.
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);

      await doubleClick(zoomCharts()[0]!);
      await backlog.release(endsAt(at("12:00:30")));
      await backlog.release(endsAt(zoomEnd));

      expect(chartWindows()).toEqual(
        same(windowOf(at("11:30:30"), at("12:00:30")), pageCase.charts),
      );
      expect(pickerLabel()).toBe(PAST_30_MINUTES);
      expectRefreshSettled();
    });

    test("a failed load lets the timer go on: the next tick loads again", async () => {
      await mount(pageCase);
      await advance(AUTO_REFRESH_MS);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);

      await advance(5_000);
      await backlog.fail(endsAt(NOW), new Error("Analytics is down"));

      expect(
        screen.getAllByText("Analytics is down").length,
      ).toBeGreaterThan(0);
      expectRefreshSettled();

      // 12:01:00: nothing is running any more, so the tick loads again.
      await advance(AUTO_REFRESH_MS - 5_000);
      expect(backlog.calls()).toHaveLength(pageCase.callsPerLoad);
      expect(backlog.calls().every(endsAt(at("12:01")))).toBe(true);
    });

    test("a host that is not found lets the timer go on too", async () => {
      getItemMock.mockImplementation((): Promise<unknown> => {
        return Promise.resolve(null);
      });
      await mount(pageCase);

      expect(screen.getAllByText("Host not found.").length).toBeGreaterThan(0);
      const lookups: number = getItemMock.mock.calls.length;

      await advance(AUTO_REFRESH_MS);

      expect(getItemMock.mock.calls.length).toBe(lookups + 1);
    });
  },
);

describe("Host overview: what a slow load leaves on screen", () => {
  const overview: HostPageCase = HOST_PAGES[0]![1];

  function cpuTile(): HTMLElement {
    // The first "About CPU" is the tile's; the second is the chart card's.
    return infoButtonsFor("CPU")[0]!.closest(".rounded-xl") as HTMLElement;
  }

  test("the tiles read the first load once it lands, however late", async () => {
    await mount(overview);

    await advance(AUTO_REFRESH_MS + 5_000);
    await backlog.release(endsAt(NOW));

    // The last five minutes of the half hour: the host is busy.
    expect(cpuTile()).toHaveTextContent("64.0%");
  });

  test("a zoom during a slow refresh reads the zoomed window into the tiles, not the refresh's", async () => {
    await mountPainted(overview);
    expect(cpuTile()).toHaveTextContent("64.0%");

    await advance(AUTO_REFRESH_MS);
    await dragAcross(zoomCharts()[1]!, at("11:36"), at("11:44"));
    await backlog.release(endsAt(at("11:44")));
    await backlog.release(endsAt(at("12:00:30")));

    // 11:39-11:44 is before the host got busy.
    expect(cpuTile()).toHaveTextContent("12.0%");
  });

  test("the picker during a slow refresh wins over it", async () => {
    await mountPainted(overview);

    await advance(AUTO_REFRESH_MS);
    await advance(2_000);
    await pickPreset("Past 1 Hour");
    expect(backlog.calls()).toHaveLength(2 * overview.callsPerLoad);

    await backlog.release(endsAt(at("12:00:32")));
    await backlog.release(endsAt(at("12:00:30")));

    expect(chartWindows()).toEqual(
      same(windowOf(at("11:00:32"), at("12:00:32")), overview.charts),
    );
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_ONE_HOUR));
    expectRefreshSettled();
  });

  test("with auto-refresh off, nothing ticks, and a slow load still lands", async () => {
    window.localStorage.setItem("host-overview-auto-refresh-interval", "off");
    await mount(overview);

    await advance(5 * AUTO_REFRESH_MS);
    expect(backlog.calls()).toHaveLength(overview.callsPerLoad);

    await backlog.release(endsAt(NOW));
    expect(zoomCharts()).toHaveLength(overview.charts);
    expectRefreshSettled();
  });

  test("Refresh after a slow load has landed loads again at once, without waiting for a tick", async () => {
    await mount(overview);
    await advance(AUTO_REFRESH_MS + 5_000);
    await backlog.release(endsAt(NOW));

    fireEvent.click(screen.getByTitle("Refresh now"));
    await flush();

    expect(backlog.calls()).toHaveLength(overview.callsPerLoad);
    expect(backlog.calls().every(endsAt(at("12:00:35")))).toBe(true);
    expectRefreshSpinning();
  });
});
