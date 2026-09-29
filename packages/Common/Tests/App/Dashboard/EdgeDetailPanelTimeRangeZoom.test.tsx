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
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the Topology maps' service-call drawer (a Service Map edge,
 * or Infrastructure's service traffic): its two history charts zoom the
 * DRAWER's window, never the Topology page's range. The page's range drives
 * the maps, which read only its start ("Active in"), and changing it reloads
 * the map the drawer is open on - so:
 *
 *   - a drag on either chart narrows the drawer's history (re-fetched at
 *     finer buckets) and the drawer offers "Reset zoom";
 *   - a double-click on either chart, or "Reset zoom", goes back to the
 *     page's range;
 *   - a new range picked on the page starts the drawer over on it;
 *   - the page's own zoom is never asked to do anything.
 *
 * Only the network is replaced (the history POST); the drawer, its SideOver
 * and ChartGroup render for real, around ChartZoomStandIn line charts that
 * resolve their zoom exactly as the real wrapper does.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:40:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:25:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");

const CALLS_CHART: string = "Calls + Errors [Calls]";
const LATENCY_CHART: string = "Avg latency [Latency]";

const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Line/LineChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string): string => {
          return value;
        },
        translateValue: (value: React.ReactNode): React.ReactNode => {
          return value;
        },
      };
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

import EdgeDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import {
  getStandInChart,
  resetStandInCharts,
  standInDrag,
} from "./ChartZoomStandIn";
import { TimeRangeZoomScope } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

interface HistoryRequest {
  startTime: string;
  endTime: string;
  bucketSeconds: number;
  callerServiceName: string;
  calleeServiceName: string;
}

function historyRequests(): Array<HistoryRequest> {
  return apiPostMock.mock.calls.map((call: Array<unknown>): HistoryRequest => {
    return (call[0] as { data: HistoryRequest }).data;
  });
}

function lastHistoryRequest(): HistoryRequest {
  const requests: Array<HistoryRequest> = historyRequests();
  const last: HistoryRequest | undefined = requests[requests.length - 1];
  if (!last) {
    throw new Error("The drawer never fetched its history");
  }
  return last;
}

function requestMinutes(request: HistoryRequest): number {
  return (Date.parse(request.endTime) - Date.parse(request.startTime)) / MINUTE;
}

// ClickHouse's naive "YYYY-MM-DD hh:mm:ss" (UTC).
function naive(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

let mockQuietWindowMinutes: number | null = null;

// The history for a window: one busy bucket at its start.
function historyResponse(request: HistoryRequest): Record<string, unknown> {
  const stepMs: number = request.bucketSeconds * 1000;
  const firstMs: number =
    Math.floor(Date.parse(request.startTime) / stepMs) * stepMs;
  const quiet: boolean =
    mockQuietWindowMinutes !== null &&
    requestMinutes(request) === mockQuietWindowMinutes;
  return {
    data: {
      buckets: quiet
        ? []
        : [
            {
              bucketStart: naive(firstMs),
              callCount: 42,
              errorCount: 2,
              avgDurationMs: 31,
            },
          ],
      bucketSeconds: request.bucketSeconds,
      callerServiceId: null,
      calleeServiceId: null,
      truncated: false,
    },
  };
}

const CHECKOUT: TopologyEntity = {
  entityKey: "service:checkout",
  entityType: "service",
  displayName: "checkout",
};
const PAYMENTS: TopologyEntity = {
  entityKey: "service:payments",
  entityType: "service",
  displayName: "payments",
};
const ORDERS_DB: TopologyEntity = {
  entityKey: "database:orders",
  entityType: "database",
  displayName: "orders-db",
};
const RELATIONSHIP: TopologyRelationship = {
  fromEntityKey: CHECKOUT.entityKey,
  toEntityKey: PAYMENTS.entityKey,
  callCount: 900,
  errorCount: 9,
  avgDurationMs: 31,
};

// Whatever the page's own zoom is asked to do (it must be asked nothing).
const pageZoomRangeChanges: MockFunction = getJestMockFunction();

/*
 * The Topology page, reduced to what the drawer sees of it: a range it
 * owns (the page's picker sets it directly), inside a page-level zoom scope
 * so a leak from the drawer into the page would show up.
 */
const TopologyPageStandIn: React.FunctionComponent<{
  toEntity?: TopologyEntity;
}> = (props: { toEntity?: TopologyEntity }): React.ReactElement => {
  const [timeRange, setTimeRange] = React.useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_DAY,
  });
  return (
    <TimeRangeZoomScope
      timeRange={timeRange}
      onTimeRangeChange={(next: RangeStartAndEndDateTime) => {
        pageZoomRangeChanges(next);
        setTimeRange(next);
      }}
    >
      <button
        type="button"
        onClick={() => {
          setTimeRange({ range: TimeRange.PAST_ONE_WEEK });
        }}
      >
        Pick Past 1 Week on the page
      </button>
      <EdgeDetailPanel
        fromEntity={CHECKOUT}
        toEntity={props.toEntity || PAYMENTS}
        relationship={RELATIONSHIP}
        timeRange={timeRange}
        metricsWindowSeconds={900}
        onClose={(): void => {}}
      />
    </TimeRangeZoomScope>
  );
};

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function waitForCharts(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`chart ${CALLS_CHART}`)).toBeInTheDocument();
    expect(screen.getByTestId(`chart ${LATENCY_CHART}`)).toBeInTheDocument();
  });
}

async function renderDrawer(): Promise<void> {
  render(<TopologyPageStandIn />);
  await flush();
  await waitForCharts();
}

async function dragAcross(
  name: string,
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(screen.getByRole("button", { name: `Drag across ${name}` }));
  await flush();
  await waitForCharts();
}

async function doubleClick(name: string): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId(`chart ${name}`));
  await flush();
  await waitForCharts();
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function expectOnThePagesDay(): void {
  const request: HistoryRequest = lastHistoryRequest();
  expect(requestMinutes(request)).toBe(24 * 60);
  // A day is charted every 15 minutes, and fetched at that step (sdn-3).
  expect(request.bucketSeconds).toBe(15 * 60);
  expect(resetButtons()).toHaveLength(0);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  apiPostMock.mockReset();
  pageZoomRangeChanges.mockReset();
  resetStandInCharts();
  mockQuietWindowMinutes = null;
  apiPostMock.mockImplementation(async (args: unknown) => {
    return historyResponse((args as { data: HistoryRequest }).data);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("EdgeDetailPanel: the history charts zoom the drawer, not the page", () => {
  test("the drawer opens on the page's range", async () => {
    await renderDrawer();

    const request: HistoryRequest = lastHistoryRequest();
    expect(request.callerServiceName).toBe("checkout");
    expect(request.calleeServiceName).toBe("payments");
    expect(Date.parse(request.endTime)).toBe(NOW.getTime());
    expectOnThePagesDay();
  });

  test("both charts take the drawer's one zoom, and the page's zoom is not offered to them", async () => {
    await renderDrawer();

    const select: unknown = getStandInChart(CALLS_CHART).zoom.onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    expect(getStandInChart(LATENCY_CHART).zoom.onTimeRangeSelect).toBe(select);
    expect(getStandInChart(CALLS_CHART).zoom.onTimeRangeReset).toBeUndefined();

    // Proven by a drag: the page's own zoom is never asked anything.
    await dragAcross(CALLS_CHART);
    expect(pageZoomRangeChanges).not.toHaveBeenCalled();
  });

  test("the chart headers name the gesture", async () => {
    await renderDrawer();

    expect(screen.getAllByText("Drag to zoom")).toHaveLength(2);
  });

  test("a drag re-fetches the drawer's history over the dragged window, at finer buckets", async () => {
    await renderDrawer();

    await dragAcross(CALLS_CHART);

    const request: HistoryRequest = lastHistoryRequest();
    expect([request.startTime, request.endTime]).toEqual([
      ZOOM_START.toISOString(),
      ZOOM_END.toISOString(),
    ]);
    // A 20-minute window is charted per minute (a day was per hour).
    expect(request.bucketSeconds).toBe(60);
    for (const name of [CALLS_CHART, LATENCY_CHART]) {
      const options: { min: Date | number; max: Date | number } =
        getStandInChart(name).props.xAxis.options;
      expect([name, (options.min as Date).toISOString()]).toEqual([
        name,
        ZOOM_START.toISOString(),
      ]);
      expect([name, (options.max as Date).toISOString()]).toEqual([
        name,
        ZOOM_END.toISOString(),
      ]);
    }
    expect(pageZoomRangeChanges).not.toHaveBeenCalled();
  });

  test("while zoomed the drawer offers Reset zoom, and the chart headers name the double-click", async () => {
    await renderDrawer();

    await dragAcross(LATENCY_CHART);

    expect(resetButtons()).toHaveLength(1);
    expect(resetButtons()[0]).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_ONE_DAY}, the time range before the zoom`,
    );
    expect(
      screen.getAllByText("Drag to zoom · double-click to reset"),
    ).toHaveLength(2);
    expect(getStandInChart(CALLS_CHART).zoom.onTimeRangeReset).toBeInstanceOf(
      Function,
    );
  });

  test("a double-click on the OTHER chart puts the page's range back", async () => {
    await renderDrawer();

    await dragAcross(CALLS_CHART);
    await doubleClick(LATENCY_CHART);

    expectOnThePagesDay();
    expect(pageZoomRangeChanges).not.toHaveBeenCalled();
    expect(getStandInChart(CALLS_CHART).zoom.onTimeRangeReset).toBeUndefined();
  });

  test("Reset zoom does the same", async () => {
    await renderDrawer();

    await dragAcross(CALLS_CHART);
    fireEvent.click(resetButtons()[0]!);
    await flush();
    await waitForCharts();

    expectOnThePagesDay();
    expect(pageZoomRangeChanges).not.toHaveBeenCalled();
  });

  test("a zoom within a zoom: one double-click goes back to the page's range", async () => {
    await renderDrawer();

    await dragAcross(CALLS_CHART);
    await dragAcross(LATENCY_CHART, INNER_ZOOM_START, INNER_ZOOM_END);
    expect([
      lastHistoryRequest().startTime,
      lastHistoryRequest().endTime,
    ]).toEqual([INNER_ZOOM_START.toISOString(), INNER_ZOOM_END.toISOString()]);

    await doubleClick(CALLS_CHART);

    expectOnThePagesDay();
  });

  test("a double-click with nothing to undo does not re-fetch", async () => {
    await renderDrawer();
    const requests: number = apiPostMock.mock.calls.length;

    await doubleClick(CALLS_CHART);

    expect(apiPostMock.mock.calls.length).toBe(requests);
  });

  test("a new range picked on the page ends the drawer's zoom", async () => {
    await renderDrawer();

    await dragAcross(CALLS_CHART);
    fireEvent.click(
      screen.getByRole("button", { name: "Pick Past 1 Week on the page" }),
    );
    await flush();
    await waitForCharts();

    const request: HistoryRequest = lastHistoryRequest();
    expect(requestMinutes(request)).toBe(7 * 24 * 60);
    expect(resetButtons()).toHaveLength(0);
    expect(getStandInChart(CALLS_CHART).zoom.onTimeRangeReset).toBeUndefined();
  });

  test("a zoom into a quiet stretch: the empty message takes the double-click", async () => {
    await renderDrawer();
    mockQuietWindowMinutes = 20;

    standInDrag.start = ZOOM_START;
    standInDrag.end = ZOOM_END;
    fireEvent.click(
      screen.getByRole("button", { name: `Drag across ${CALLS_CHART}` }),
    );
    await flush();

    const empty: HTMLElement = await screen.findByTestId("edge-history-empty");
    // The way out is still on screen, above the empty history.
    expect(resetButtons()).toHaveLength(1);

    fireEvent.doubleClick(empty);
    await flush();
    await waitForCharts();

    expectOnThePagesDay();
  });

  test("the empty message ignores a double-click when there is nothing to undo", async () => {
    mockQuietWindowMinutes = 24 * 60;
    render(<TopologyPageStandIn />);
    await flush();
    const requests: number = apiPostMock.mock.calls.length;

    fireEvent.doubleClick(await screen.findByTestId("edge-history-empty"));
    await flush();

    expect(apiPostMock.mock.calls.length).toBe(requests);
  });

  test("a call with no history (into a database) has no charts and no zoom", async () => {
    render(<TopologyPageStandIn toEntity={ORDERS_DB} />);
    await flush();

    expect(screen.getByTestId("edge-history-unavailable")).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(resetButtons()).toHaveLength(0);
    expect(screen.queryByText("Drag to zoom")).not.toBeInTheDocument();
  });

  test("the drawer zooms on its own when the page offers no zoom at all (the Topology page)", async () => {
    render(
      <EdgeDetailPanel
        fromEntity={CHECKOUT}
        toEntity={PAYMENTS}
        relationship={RELATIONSHIP}
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        metricsWindowSeconds={900}
        onClose={(): void => {}}
      />,
    );
    await flush();
    await waitForCharts();
    expect(getStandInChart(CALLS_CHART).zoom.onTimeRangeSelect).toBeInstanceOf(
      Function,
    );

    await dragAcross(LATENCY_CHART);
    expect([
      lastHistoryRequest().startTime,
      lastHistoryRequest().endTime,
    ]).toEqual([ZOOM_START.toISOString(), ZOOM_END.toISOString()]);
    expect(resetButtons()).toHaveLength(1);

    await doubleClick(CALLS_CHART);
    expectOnThePagesDay();
  });

  test("the drawer's zoom window never reaches past the page's range end", async () => {
    await renderDrawer();

    // A drag whose last bucket runs past now is cut at the window's end.
    await dragAcross(
      CALLS_CHART,
      new Date(NOW.getTime() - 30 * MINUTE),
      new Date(NOW.getTime() + HOUR),
    );

    const request: HistoryRequest = lastHistoryRequest();
    expect(request.startTime).toBe(
      new Date(NOW.getTime() - 30 * MINUTE).toISOString(),
    );
    expect(Date.parse(request.endTime)).toBeLessThan(NOW.getTime() + MINUTE);
  });
});
