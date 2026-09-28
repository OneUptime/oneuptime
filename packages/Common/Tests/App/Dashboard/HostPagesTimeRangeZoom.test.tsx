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
 * Issue #4105 on the Host pages: the overview, a process, a Windows service
 * and a systemd unit. Each page is rendered for real with its data layer
 * mocked and its line charts replaced by the zoom stand-in (see
 * TimeRangeZoomPageHarness), and a customer's gestures are played against
 * it:
 *
 *   - every chart on the page holds the page's one zoom;
 *   - a drag on any chart retimes the whole page - every fetch behind the
 *     charts, tiles, tables and identity is re-issued for the window dragged
 *     out, and the picker reads Custom with Reset zoom beside it;
 *   - a double-click on any OTHER chart, or Reset zoom, puts the range from
 *     before the zoom back, however many times the reader drilled in;
 *   - the picker ends the zoom; auto-refresh keeps a zoom pinned;
 *   - a slow response for a window the reader left cannot repaint the page;
 *   - a zoom into a quiet stretch (no chart left to double-click) still has
 *     a way back where the reader is looking.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

// A time on the test's day, e.g. at("11:36") or at("11:46:30").
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
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return lastParamMock();
      },
      navigate: () => {},
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

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

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

// Covered by its own suite; it fetches counts that do not follow the range.
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

import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import HostProcessView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ProcessView";
import HostServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ServiceView";
import HostSystemdUnitView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnitView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import TimeRange from "../../../Types/Time/TimeRange";
import { infoButtonsFor } from "./HostTooltipHarness";
import {
  chartWindows,
  customRangeLabel,
  deferred,
  Deferred,
  doubleClick,
  dragAcross,
  expectOneSharedZoom,
  expectRevealedOnHoverOf,
  flush,
  pickPreset,
  pickerLabel,
  presetLabel,
  resetZoomButtons,
  windowOf,
  zoomChart,
  zoomCharts,
  zoomHints,
} from "./TimeRangeZoomPageHarness";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const PAST_30_MINUTES: string = presetLabel(TimeRange.PAST_THIRTY_MINS);

type Row = {
  timestamp: Date;
  value: number;
  attributes?: Record<string, string>;
};

interface TimeWindow {
  startValue: Date;
  endValue: Date;
}

interface AggregateCall {
  aggregateBy: {
    query: {
      name: string;
      attributes: Record<string, string>;
      time: TimeWindow;
    };
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

interface ListCall {
  query: {
    name: string;
    time: TimeWindow;
  };
  limit: number;
}

function aggregateCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls.map((args: Array<unknown>): AggregateCall => {
    return args[0] as AggregateCall;
  });
}

function listCalls(): Array<ListCall> {
  return getListMock.mock.calls.map((args: Array<unknown>): ListCall => {
    return args[0] as ListCall;
  });
}

// The [start, end] a set of aggregate calls asked for, as ISO strings.
function aggregateWindows(
  calls: Array<AggregateCall>,
): Array<[string, string]> {
  return calls.map((call: AggregateCall): [string, string] => {
    return [
      call.aggregateBy.startTimestamp.toISOString(),
      call.aggregateBy.endTimestamp.toISOString(),
    ];
  });
}

function queryWindow(window: TimeWindow): [string, string] {
  return [window.startValue.toISOString(), window.endValue.toISOString()];
}

// One row a minute from 11:00 to 11:59 - inside every window a test asks for.
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
      ...(attributes ? { attributes } : {}),
    });
  }

  return rows;
}

// The rows the server would return for the window an aggregate asked for.
function insideWindow(rows: Array<Row>, call: AggregateCall): Array<Row> {
  const start: number = call.aggregateBy.startTimestamp.getTime();
  const end: number = call.aggregateBy.endTimestamp.getTime();

  return rows.filter((row: Row): boolean => {
    const time: number = row.timestamp.getTime();
    return time >= start && time <= end;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  lastParamMock.mockReset();
  getItemMock.mockResolvedValue({
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

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------------------------ overview

/*
 * CPU is quiet (12%) until 11:45 and busy (64%) from then on, so the CPU
 * tile - the mean of the last five minutes of the window - reads 64% on the
 * default half hour and 12% on a window zoomed in before 11:45.
 */
function overviewRows(call: AggregateCall): Array<Row> {
  const attributes: Record<string, string> = call.aggregateBy.query.attributes;
  const busyFrom: number = at("11:45").getTime();

  switch (call.aggregateBy.query.name) {
    case "system.cpu.utilization":
      return everyMinute((time: Date): number => {
        if (attributes["state"] !== "user") {
          return 0;
        }
        return time.getTime() < busyFrom ? 0.12 : 0.64;
      });
    case "system.memory.utilization":
      return everyMinute(() => {
        return 0.5;
      });
    case "system.cpu.load_average.1m":
      return everyMinute(() => {
        return 1.5;
      });
    case "system.processes.count":
      return everyMinute(() => {
        return 3;
      });
    case "system.filesystem.usage":
      return [
        ...everyMinute(
          () => {
            return 40 * GIB;
          },
          { mountpoint: "/", device: "/dev/sda1", type: "ext4", state: "used" },
        ),
        ...everyMinute(
          () => {
            return 60 * GIB;
          },
          { mountpoint: "/", device: "/dev/sda1", type: "ext4", state: "free" },
        ),
      ];
    case "system.network.io":
      return everyMinute(
        (time: Date): number => {
          return time.getTime() / 1000;
        },
        { device: "eth0", direction: "receive" },
      );
    case "oneuptime.host.heartbeat":
      return everyMinute(() => {
        return 2;
      });
    default:
      return [];
  }
}

interface HeldAggregate {
  call: AggregateCall;
  release: () => void;
}

let holdAggregates: boolean = false;
let heldAggregates: Array<HeldAggregate> = [];
let failAggregate: (call: AggregateCall) => boolean = (): boolean => {
  return false;
};

function answerAggregatesWith(
  rowsFor: (call: AggregateCall) => Array<Row>,
): void {
  holdAggregates = false;
  heldAggregates = [];
  failAggregate = (): boolean => {
    return false;
  };

  aggregateMock.mockImplementation((request: unknown) => {
    const call: AggregateCall = request as AggregateCall;
    const answer: { data: Array<Row> } = {
      data: insideWindow(rowsFor(call), call),
    };

    if (failAggregate(call)) {
      return Promise.reject(new Error("Analytics is down"));
    }

    if (holdAggregates) {
      const held: Deferred<{ data: Array<Row> }> = deferred<{
        data: Array<Row>;
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
}

// Answer the held aggregates whose window ends at `end`.
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

const OVERVIEW_CHARTS: number = 5; // Availability, CPU, Memory, Disk space, Network
const OVERVIEW_FETCHES: number = 9; // aggregates per load

function cpuTile(): HTMLElement {
  // The first "About CPU" is the tile's; the second is the chart card's.
  return infoButtonsFor("CPU")[0]!.closest(".rounded-xl") as HTMLElement;
}

async function renderOverview(): Promise<void> {
  answerAggregatesWith(overviewRows);
  render(<HostOverview {...PAGE_PROPS} />);
  await flush();
  expect(zoomCharts()).toHaveLength(OVERVIEW_CHARTS);
}

// The last load's aggregate windows, the tile-window process fallback aside.
function lastOverviewLoad(): {
  windows: Array<[string, string]>;
  processFallback: [string, string];
} {
  const load: Array<AggregateCall> = aggregateCalls().slice(-OVERVIEW_FETCHES);
  const fallback: AggregateCall | undefined = load.find(
    (call: AggregateCall): boolean => {
      return call.aggregateBy.query.name === "process.cpu.utilization";
    },
  );

  expect(fallback).toBeDefined();

  return {
    windows: aggregateWindows(
      load.filter((call: AggregateCall): boolean => {
        return call !== fallback;
      }),
    ),
    processFallback: aggregateWindows([fallback!])[0]!,
  };
}

function everyWindowIs(
  window: [string, string],
  count: number,
): Array<[string, string]> {
  return Array.from({ length: count }, (): [string, string] => {
    return window;
  });
}

describe("Host overview: one zoom for the whole page", () => {
  test("all five charts hold the page's one zoom, with nothing to reset yet", async () => {
    await renderOverview();

    expectOneSharedZoom({ zoomed: false });
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("each chart section names the gesture at its heading, revealed while hovered", async () => {
    await renderOverview();

    const hints: Array<HTMLElement> = zoomHints();

    // One per section: Availability, and Resource usage's four cards.
    expect(hints).toHaveLength(2);

    for (const hint of hints) {
      expect(hint).toHaveTextContent("Drag to zoom");
      const section: HTMLElement = expectRevealedOnHoverOf(hint);
      expect(
        section.querySelectorAll('[data-testid="zoom-chart"]').length,
      ).toBeGreaterThan(0);
    }

    // The Resource usage section holds the four cards the hint speaks for.
    const resourceSection: HTMLElement = hints[1]!.closest(
      ".group",
    ) as HTMLElement;
    expect(resourceSection).toHaveTextContent("Resource usage");
    expect(
      resourceSection.querySelectorAll('[data-testid="zoom-chart"]'),
    ).toHaveLength(4);
  });

  test("a drag on the CPU chart refetches every chart, tile and table for the dragged window", async () => {
    await renderOverview();
    expect(cpuTile()).toHaveTextContent("64.0%");
    const before: number = aggregateCalls().length;

    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));

    expect(aggregateCalls().length).toBe(before + OVERVIEW_FETCHES);
    const load: {
      windows: Array<[string, string]>;
      processFallback: [string, string];
    } = lastOverviewLoad();
    expect(load.windows).toEqual(
      everyWindowIs(windowOf(at("11:36"), at("11:44")), OVERVIEW_FETCHES - 1),
    );
    // The Processes fallback reads the last five minutes of the new window.
    expect(load.processFallback).toEqual(windowOf(at("11:39"), at("11:44")));

    // Every chart is redrawn over the zoomed window...
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:36"), at("11:44")), OVERVIEW_CHARTS),
    );
    // ...and the tiles read it too: 11:39-11:44 is before CPU got busy.
    expect(cpuTile()).toHaveTextContent("12.0%");

    expect(pickerLabel()).toBe(customRangeLabel(at("11:36"), at("11:44")));
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({ zoomed: true });
    for (const hint of zoomHints()) {
      expect(hint).toHaveTextContent("Drag to zoom · double-click to reset");
    }
  });

  test("a drag made right to left zooms to the same window", async () => {
    await renderOverview();

    await dragAcross(zoomChart(3), at("11:44"), at("11:36"));

    expect(lastOverviewLoad().windows[0]).toEqual(
      windowOf(at("11:36"), at("11:44")),
    );
    expect(pickerLabel()).toBe(customRangeLabel(at("11:36"), at("11:44")));
  });

  test("a double-click on a different chart puts Past 30 Minutes back, sliding with the clock", async () => {
    await renderOverview();
    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));

    await doubleClick(zoomChart(4));

    expect(lastOverviewLoad().windows).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), OVERVIEW_FETCHES - 1),
    );
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("64.0%");
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false });
  });

  test("a double-click on the chart that was dragged resets too", async () => {
    await renderOverview();
    await dragAcross(zoomChart(0), at("11:31"), at("11:59"));
    expect(pickerLabel()).toBe(customRangeLabel(at("11:31"), at("11:59")));

    await doubleClick(zoomChart(0));

    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(lastOverviewLoad().windows[0]).toEqual(windowOf(at("11:30"), NOW));
  });

  test("Reset zoom beside the picker does what a double-click does", async () => {
    await renderOverview();
    await dragAcross(zoomChart(2), at("11:36"), at("11:44"));

    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(lastOverviewLoad().windows[0]).toEqual(windowOf(at("11:30"), NOW));
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("drilling in twice, one double-click climbs all the way out", async () => {
    await renderOverview();

    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));
    await dragAcross(zoomChart(2), at("11:40"), at("11:42"));

    expect(lastOverviewLoad().windows[0]).toEqual(
      windowOf(at("11:40"), at("11:42")),
    );
    expect(pickerLabel()).toBe(customRangeLabel(at("11:40"), at("11:42")));

    await doubleClick(zoomChart(3));

    // Straight back to the half hour, not to the first zoom.
    expect(lastOverviewLoad().windows[0]).toEqual(windowOf(at("11:30"), NOW));
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });

  test("a drag past the end of the window stops at the window's end", async () => {
    await renderOverview();

    // The newest bucket reaches past "now"; the zoom must not.
    await dragAcross(zoomChart(1), at("11:50"), at("12:10"));

    expect(lastOverviewLoad().windows[0]).toEqual(windowOf(at("11:50"), NOW));
  });

  test("picking a range in the picker ends the zoom, and a double-click then leaves the page alone", async () => {
    await renderOverview();
    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));

    await pickPreset("Past 1 Hour");

    expect(lastOverviewLoad().windows[0]).toEqual(windowOf(at("11:00"), NOW));
    expect(resetZoomButtons()).toHaveLength(0);
    expectOneSharedZoom({ zoomed: false });

    const before: number = aggregateCalls().length;
    await doubleClick(zoomChart(4));

    expect(aggregateCalls().length).toBe(before);
    expect(pickerLabel()).toBe(presetLabel(TimeRange.PAST_ONE_HOUR));
  });

  test("a double-click with nothing to undo does not refetch", async () => {
    await renderOverview();
    const before: number = aggregateCalls().length;

    await doubleClick(zoomChart(2));

    expect(aggregateCalls().length).toBe(before);
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });

  test("auto-refresh keeps a zoom pinned to its window, and slides again after the reset", async () => {
    await renderOverview();
    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));
    const afterZoom: number = aggregateCalls().length;

    // The overview refreshes every 30 seconds by default.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();

    expect(aggregateCalls().length).toBe(afterZoom + OVERVIEW_FETCHES);
    expect(lastOverviewLoad().windows[0]).toEqual(
      windowOf(at("11:36"), at("11:44")),
    );
    expect(resetZoomButtons()).toHaveLength(1);

    await doubleClick(zoomChart(0));
    expect(lastOverviewLoad().windows[0]).toEqual(
      windowOf(at("11:30:30"), at("12:00:30")),
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();

    expect(lastOverviewLoad().windows[0]).toEqual(
      windowOf(at("11:31"), at("12:01")),
    );
  });

  test("Refresh now while zoomed reloads the zoomed window and keeps the zoom", async () => {
    await renderOverview();
    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));
    const afterZoom: number = aggregateCalls().length;

    fireEvent.click(screen.getByTestId("manual-refresh"));
    await flush();

    expect(aggregateCalls().length).toBe(afterZoom + OVERVIEW_FETCHES);
    expect(lastOverviewLoad().windows[0]).toEqual(
      windowOf(at("11:36"), at("11:44")),
    );
    expect(resetZoomButtons()).toHaveLength(1);
    expectOneSharedZoom({ zoomed: true });
  });

  test("a slow response for the zoomed window cannot repaint the page after the reset", async () => {
    await renderOverview();
    holdAggregates = true;

    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));
    await doubleClick(zoomChart(2));

    // The reset's answer lands first; the zoom's, late, must be dropped.
    await releaseAggregatesEndingAt(NOW);
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );

    await releaseAggregatesEndingAt(at("11:44"));
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), OVERVIEW_CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("64.0%");
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });

  test("a slow response for the old window cannot overwrite the zoom", async () => {
    await renderOverview();
    holdAggregates = true;

    // A refresh of the half hour is in flight when the reader zooms.
    fireEvent.click(screen.getByTestId("manual-refresh"));
    await flush();
    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));

    await releaseAggregatesEndingAt(at("11:44"));
    await releaseAggregatesEndingAt(NOW);

    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:36"), at("11:44")), OVERVIEW_CHARTS),
    );
    expect(cpuTile()).toHaveTextContent("12.0%");
  });

  test("when the zoomed load fails, Reset zoom beside the picker is still the way back", async () => {
    await renderOverview();
    failAggregate = (call: AggregateCall): boolean => {
      return call.aggregateBy.endTimestamp.getTime() === at("11:44").getTime();
    };

    await dragAcross(zoomChart(1), at("11:36"), at("11:44"));

    expect(screen.getByText("Analytics is down")).toBeInTheDocument();
    expect(zoomCharts()).toHaveLength(0);
    expect(resetZoomButtons()).toHaveLength(1);

    fireEvent.click(resetZoomButtons()[0]!);
    await flush();

    expect(screen.queryByText("Analytics is down")).toBeNull();
    expect(zoomCharts()).toHaveLength(OVERVIEW_CHARTS);
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });
});

// ------------------------------------------------------------------- process

const PROCESS_CHARTS: number = 3; // CPU, Memory (RSS), Disk I/O
const PROCESS_FETCHES: number = 6; // aggregates per load

// The process started at 11:40; before that there is nothing to show.
function processRows(call: AggregateCall): Array<Row> {
  const startedAt: number = at("11:40").getTime();
  const alive: (rows: Array<Row>) => Array<Row> = (
    rows: Array<Row>,
  ): Array<Row> => {
    return rows.filter((row: Row): boolean => {
      return row.timestamp.getTime() >= startedAt;
    });
  };

  switch (call.aggregateBy.query.name) {
    case "process.cpu.utilization":
      return alive(
        everyMinute(() => {
          return 0.3;
        }),
      );
    case "process.memory.usage":
      return alive(
        everyMinute(() => {
          return 2 * GIB;
        }),
      );
    case "process.disk.io":
      return alive(
        everyMinute(
          (time: Date): number => {
            return time.getTime() / 100;
          },
          { direction: "read" },
        ),
      );
    default:
      return [];
  }
}

function mockProcessIdentity(): void {
  lastParamMock.mockReturnValue("4321");
  getListMock.mockImplementation((request: unknown) => {
    const call: ListCall = request as ListCall;
    const end: Date = call.query.time.endValue;

    // Samples only exist while the process runs (from 11:40).
    if (end.getTime() <= at("11:40").getTime()) {
      return Promise.resolve({ data: [] });
    }

    return Promise.resolve({
      data: [
        {
          time: new Date(end.getTime() - 60_000),
          attributes: {
            "resource.process.pid": "4321",
            "resource.process.executable.name": "postgres",
            "resource.process.command": "postgres -D /var/lib/postgresql",
            "resource.process.owner": "postgres",
          },
        },
      ],
    });
  });
}

async function renderProcess(): Promise<void> {
  mockProcessIdentity();
  answerAggregatesWith(processRows);
  render(<HostProcessView {...PAGE_PROPS} />);
  await flush();
  expect(zoomCharts()).toHaveLength(PROCESS_CHARTS);
}

function lastProcessLoadWindows(): Array<[string, string]> {
  return aggregateWindows(aggregateCalls().slice(-PROCESS_FETCHES));
}

describe("Host process view: one zoom for the whole page", () => {
  test("the three charts hold the page's one zoom; the section heading names the gesture", async () => {
    await renderProcess();

    expectOneSharedZoom({ zoomed: false });
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), PROCESS_CHARTS),
    );

    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(1);
    expect(expectRevealedOnHoverOf(hints[0]!)).toHaveTextContent(
      "Resource usage",
    );
  });

  test("a drag retimes the charts, the tiles and the identity lookup", async () => {
    await renderProcess();
    const listsBefore: number = listCalls().length;

    await dragAcross(zoomChart(0), at("11:44"), at("11:52"));

    // Identity is resolved from the last 15 minutes of the zoomed window.
    expect(listCalls().length).toBe(listsBefore + 1);
    expect(
      queryWindow(listCalls()[listCalls().length - 1]!.query.time),
    ).toEqual(windowOf(at("11:37"), at("11:52")));
    // Every metric the charts and tiles read is fetched for the window.
    expect(lastProcessLoadWindows()).toEqual(
      everyWindowIs(windowOf(at("11:44"), at("11:52")), PROCESS_FETCHES),
    );
    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:44"), at("11:52")), PROCESS_CHARTS),
    );
    expect(pickerLabel()).toBe(customRangeLabel(at("11:44"), at("11:52")));
    expectOneSharedZoom({ zoomed: true });
    expect(zoomHints()[0]).toHaveTextContent(
      "Drag to zoom · double-click to reset",
    );
  });

  test("a double-click on another chart puts Past 30 Minutes back", async () => {
    await renderProcess();
    await dragAcross(zoomChart(0), at("11:44"), at("11:52"));

    await doubleClick(zoomChart(2));

    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), PROCESS_CHARTS),
    );
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expectOneSharedZoom({ zoomed: false });
  });

  test("a zoom into a stretch the process was quiet for offers Reset zoom under the no-data note", async () => {
    await renderProcess();
    expect(screen.queryByText("No process metrics in range")).toBeNull();

    await dragAcross(zoomChart(1), at("11:31"), at("11:36"));

    expect(screen.getByText("No process metrics in range")).toBeInTheDocument();
    // The empty charts stay mounted, so a double-click still reaches them...
    expect(zoomCharts()).toHaveLength(PROCESS_CHARTS);
    // ...and the note carries the way back too, beside the picker's.
    const note: HTMLElement = screen
      .getByText("No process metrics in range")
      .closest('[data-testid="card"]') as HTMLElement;
    const resetInNote: Array<HTMLElement> = resetZoomButtons().filter(
      (button: HTMLElement): boolean => {
        return note.contains(button);
      },
    );
    expect(resetZoomButtons()).toHaveLength(2);
    expect(resetInNote).toHaveLength(1);

    fireEvent.click(resetInNote[0]!);
    await flush();

    expect(screen.queryByText("No process metrics in range")).toBeNull();
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("the no-data note offers no reset when the page is not zoomed", async () => {
    await renderProcess();

    await pickPreset("Past 5 Minutes");
    answerAggregatesWith((): Array<Row> => {
      return [];
    });
    fireEvent.click(screen.getByTestId("manual-refresh"));
    await flush();

    expect(screen.getByText("No process metrics in range")).toBeInTheDocument();
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("a slow response for the zoomed window cannot repaint the page after the reset", async () => {
    await renderProcess();
    holdAggregates = true;

    await dragAcross(zoomChart(0), at("11:44"), at("11:52"));
    await doubleClick(zoomChart(1));

    await releaseAggregatesEndingAt(NOW);
    await releaseAggregatesEndingAt(at("11:52"));

    expect(chartWindows()).toEqual(
      everyWindowIs(windowOf(at("11:30"), NOW), PROCESS_CHARTS),
    );
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });
});

// ------------------------------------------------------------------- service

/*
 * A sample every 30 seconds from 11:00, newest first as the API returns
 * them: Running (4), except Stopped (1) from 11:45 to 11:50.
 */
function serviceRows(window: TimeWindow): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (let i: number = 0; i < 120; i++) {
    const time: Date = new Date(at("11:00").getTime() + i * 30_000);

    if (
      time.getTime() < window.startValue.getTime() ||
      time.getTime() > window.endValue.getTime()
    ) {
      continue;
    }

    const stopped: boolean =
      time.getTime() >= at("11:45").getTime() &&
      time.getTime() < at("11:50").getTime();

    rows.push({
      time: time,
      value: stopped ? 1 : 4,
      attributes: {
        name: "Spooler",
        startup_mode: "auto_start",
        "resource.host.name": "web-01",
      },
    });
  }

  return rows.reverse();
}

async function renderService(): Promise<void> {
  lastParamMock.mockReturnValue("Spooler");
  getListMock.mockImplementation((request: unknown) => {
    return Promise.resolve({
      data: serviceRows((request as ListCall).query.time),
    });
  });
  render(<HostServiceView {...PAGE_PROPS} />);
  await flush();
  expect(zoomCharts()).toHaveLength(1);
}

function tileOf(title: string): HTMLElement {
  return infoButtonsFor(title)[0]!.closest(".rounded-xl") as HTMLElement;
}

describe("Host Windows service view: the timeline zooms the page", () => {
  test("the status timeline holds the page's zoom; its heading names the gesture", async () => {
    await renderService();

    expectOneSharedZoom({ zoomed: false });
    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(1);
    const section: HTMLElement = expectRevealedOnHoverOf(hints[0]!);
    expect(section).toHaveTextContent("Status timeline");
    expect(section.querySelector('[data-testid="zoom-chart"]')).not.toBeNull();
  });

  test("a drag narrows the timeline, the tiles and State Changes to the dragged window", async () => {
    await renderService();
    // The half hour holds the 5-minute stop: 50 of 60 samples running.
    expect(tileOf("Availability")).toHaveTextContent("83.3%");
    expect(tileOf("State Changes")).toHaveTextContent(/State Changes\s*2/);

    await dragAcross(zoomChart(0), at("11:46"), at("11:49"));

    expect(
      queryWindow(listCalls()[listCalls().length - 1]!.query.time),
    ).toEqual(windowOf(at("11:46"), at("11:49")));
    expect(chartWindows()).toEqual([windowOf(at("11:46"), at("11:49"))]);
    expect(tileOf("Availability")).toHaveTextContent("0.0%");
    expect(tileOf("Current Status")).toHaveTextContent("Stopped");
    expect(tileOf("State Changes")).toHaveTextContent(/State Changes\s*0/);
    expect(pickerLabel()).toBe(customRangeLabel(at("11:46"), at("11:49")));
    expect(resetZoomButtons()).toHaveLength(1);
  });

  test("a double-click on the timeline puts Past 30 Minutes back", async () => {
    await renderService();
    await dragAcross(zoomChart(0), at("11:46"), at("11:49"));
    expect(tileOf("Availability")).toHaveTextContent("0.0%");

    await doubleClick(zoomChart(0));

    expect(
      queryWindow(listCalls()[listCalls().length - 1]!.query.time),
    ).toEqual(windowOf(at("11:30"), NOW));
    expect(tileOf("Availability")).toHaveTextContent("83.3%");
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(resetZoomButtons()).toHaveLength(0);
  });

  test("a zoom into a silent stretch hides the timeline and offers Reset zoom under the no-data note", async () => {
    await renderService();

    // No scrape lands between two 30-second samples.
    await dragAcross(zoomChart(0), at("11:40:05"), at("11:40:25"));

    expect(zoomCharts()).toHaveLength(0);
    expect(screen.getByText("No service metrics in range")).toBeInTheDocument();
    expect(resetZoomButtons()).toHaveLength(2);

    const note: HTMLElement = screen
      .getByText("No service metrics in range")
      .closest('[data-testid="card"]') as HTMLElement;
    const inNote: HTMLElement | undefined = resetZoomButtons().find(
      (button: HTMLElement): boolean => {
        return note.contains(button);
      },
    );
    expect(inNote).toBeDefined();

    fireEvent.click(inNote!);
    await flush();

    expect(zoomCharts()).toHaveLength(1);
    expect(screen.queryByText("No service metrics in range")).toBeNull();
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });
});

// ------------------------------------------------------------- systemd unit

/*
 * A sample every 30 seconds from 11:00, newest first: active, except
 * failed from 11:45 to 11:50.
 */
function unitRows(window: TimeWindow): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (let i: number = 0; i < 120; i++) {
    const time: Date = new Date(at("11:00").getTime() + i * 30_000);

    if (
      time.getTime() < window.startValue.getTime() ||
      time.getTime() > window.endValue.getTime()
    ) {
      continue;
    }

    const failed: boolean =
      time.getTime() >= at("11:45").getTime() &&
      time.getTime() < at("11:50").getTime();

    rows.push({
      time: time,
      value: 1,
      attributes: {
        "resource.systemd.unit.name": "nginx.service",
        "systemd.unit.active_state": failed ? "failed" : "active",
        "resource.host.name": "web-01",
      },
    });
  }

  return rows.reverse();
}

async function renderUnit(): Promise<void> {
  lastParamMock.mockReturnValue("nginx.service");
  getListMock.mockImplementation((request: unknown) => {
    return Promise.resolve({
      data: unitRows((request as ListCall).query.time),
    });
  });
  render(<HostSystemdUnitView {...PAGE_PROPS} />);
  await flush();
  expect(zoomCharts()).toHaveLength(1);
}

describe("Host systemd unit view: the timeline zooms the page", () => {
  test("the state timeline holds the page's zoom; its heading names the gesture", async () => {
    await renderUnit();

    expectOneSharedZoom({ zoomed: false });
    const hints: Array<HTMLElement> = zoomHints();
    expect(hints).toHaveLength(1);
    expect(expectRevealedOnHoverOf(hints[0]!)).toHaveTextContent(
      "State timeline",
    );
  });

  test("a drag narrows the timeline, the tiles and State Changes to the dragged window", async () => {
    await renderUnit();
    expect(tileOf("Availability")).toHaveTextContent("83.3%");

    await dragAcross(zoomChart(0), at("11:46"), at("11:49"));

    expect(
      queryWindow(listCalls()[listCalls().length - 1]!.query.time),
    ).toEqual(windowOf(at("11:46"), at("11:49")));
    expect(chartWindows()).toEqual([windowOf(at("11:46"), at("11:49"))]);
    expect(tileOf("Availability")).toHaveTextContent("0.0%");
    expect(tileOf("Current State")).toHaveTextContent("Failed");
    expect(tileOf("State Changes")).toHaveTextContent(/State Changes\s*0/);
    expect(pickerLabel()).toBe(customRangeLabel(at("11:46"), at("11:49")));
    expectOneSharedZoom({ zoomed: true });
  });

  test("a double-click on the timeline, or Reset zoom, puts Past 30 Minutes back", async () => {
    await renderUnit();

    await dragAcross(zoomChart(0), at("11:46"), at("11:49"));
    await doubleClick(zoomChart(0));
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(tileOf("Availability")).toHaveTextContent("83.3%");

    await dragAcross(zoomChart(0), at("11:46"), at("11:49"));
    fireEvent.click(resetZoomButtons()[0]!);
    await flush();
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
    expect(
      queryWindow(listCalls()[listCalls().length - 1]!.query.time),
    ).toEqual(windowOf(at("11:30"), NOW));
  });

  test("a zoom into a silent stretch hides the timeline and offers Reset zoom under the no-data note", async () => {
    await renderUnit();

    await dragAcross(zoomChart(0), at("11:40:05"), at("11:40:25"));

    expect(zoomCharts()).toHaveLength(0);
    expect(screen.getByText("No unit metrics in range")).toBeInTheDocument();

    const note: HTMLElement = screen
      .getByText("No unit metrics in range")
      .closest('[data-testid="card"]') as HTMLElement;
    const inNote: HTMLElement | undefined = resetZoomButtons().find(
      (button: HTMLElement): boolean => {
        return note.contains(button);
      },
    );
    expect(inNote).toBeDefined();

    fireEvent.click(inNote!);
    await flush();

    expect(zoomCharts()).toHaveLength(1);
    expect(pickerLabel()).toBe(PAST_30_MINUTES);
  });
});
