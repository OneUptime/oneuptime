/** @timezone UTC */

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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 review on the Topology service-call drawer (EdgeDetailPanel),
 * whose two history charts zoom the drawer's own window:
 *
 *   - sdn-3: the drawer asked for hourly buckets for every window over 3
 *     hours, while its charts are drawn on 5-, 15- and 30-minute steps up to
 *     3 days. The page opens on "Past 1 Day", so the first zoom anyone makes
 *     - a few hours of that day - re-fetched the very same hourly buckets and
 *     only stretched them. The history is now fetched one chart step at a
 *     time: a 6-hour zoom brings 5-minute buckets.
 *   - cc-6: "Reset zoom" got a row of its own above the charts that appeared
 *     with the zoom, so the charts jumped down right under the pointer that
 *     had just dragged them, and back up on a reset. It now sits in the
 *     history's header, a row that is there zoomed or not.
 *   - A zoom (or a reset) used to swap both charts for a loader until the new
 *     history landed, collapsing the drawer under the pointer. The last
 *     history now stays on screen, dimmed, drawn over the window it was
 *     fetched for, and "Refreshing" shows in the header.
 *
 * The drawer, its SideOver and ChartGroup render for real around
 * ChartZoomStandIn line charts; only the network (the history POST) is
 * replaced, by a stand-in API that buckets a fixed stream of calls the way
 * the real one does, so a coarse bucket and a fine one describe the same
 * traffic.
 */

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;

// A 6-hour drag across the day's chart, from one 15-minute row to another.
const ZOOM_START: Date = new Date("2026-09-28T02:45:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T08:45:00.000Z");

// A 20-minute burst inside the zoomed stretch: 20 calls a minute, 1 otherwise.
const BURST_START: Date = new Date("2026-09-28T05:00:00.000Z");
const BURST_END: Date = new Date("2026-09-28T05:20:00.000Z");

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
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import ChartDataPoint, {
  CHART_DATA_POINT_DATE_KEY,
} from "../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../../../UI/Components/Charts/Types/SeriesPoints";
import { XAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import YAxis from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import DataPointUtil from "../../../UI/Components/Charts/Utils/DataPoint";
import TimeRange from "../../../Types/Time/TimeRange";

interface HistoryRequest {
  startTime: string;
  endTime: string;
  bucketSeconds: number;
}

type HistoryResponse = { data: Record<string, unknown> };

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

function naiveUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

// The service's calls in the minute starting at `minuteMs`.
function callsInMinute(minuteMs: number): number {
  return minuteMs >= BURST_START.getTime() && minuteMs < BURST_END.getTime()
    ? 20
    : 1;
}

/*
 * What the API answers for a window: the calls of each epoch-aligned bucket
 * of the size asked for that fall inside the window, one bucket per bucket
 * that saw a call (so every bucket here). `quiet` answers no buckets at all.
 */
function historyResponse(
  request: HistoryRequest,
  quiet: boolean = false,
): HistoryResponse {
  const bucketMs: number = request.bucketSeconds * SECOND;
  const startMs: number = Date.parse(request.startTime);
  const endMs: number = Date.parse(request.endTime);
  const buckets: Array<Record<string, unknown>> = [];
  for (
    let bucketStartMs: number = Math.floor(startMs / bucketMs) * bucketMs;
    !quiet && bucketStartMs < endMs;
    bucketStartMs += bucketMs
  ) {
    let calls: number = 0;
    for (
      let minuteMs: number = Math.max(bucketStartMs, startMs);
      minuteMs < Math.min(bucketStartMs + bucketMs, endMs);
      minuteMs += MINUTE
    ) {
      calls += callsInMinute(minuteMs);
    }
    buckets.push({
      bucketStart: naiveUtc(bucketStartMs),
      callCount: calls,
      errorCount: 0,
      avgDurationMs: 30,
    });
  }
  return {
    data: {
      buckets: buckets,
      bucketSeconds: request.bucketSeconds,
      callerServiceId: null,
      calleeServiceId: null,
      truncated: false,
    },
  };
}

// Answers every fetch from now on with `answer`.
function answerWith(
  answer: (request: HistoryRequest) => HistoryResponse,
): void {
  apiPostMock.mockImplementation(async (args: unknown) => {
    return answer((args as { data: HistoryRequest }).data);
  });
}

// Holds the NEXT fetch until the test lets it land (or fail).
interface HeldFetch {
  land: () => Promise<void>;
  fail: (error: Error) => Promise<void>;
}

function holdNextFetch(): HeldFetch {
  let resolveFetch: (value: unknown) => void = (): void => {};
  let rejectFetch: (error: Error) => void = (): void => {};
  let heldRequest: HistoryRequest | null = null;
  apiPostMock.mockImplementationOnce((args: unknown) => {
    heldRequest = (args as { data: HistoryRequest }).data;
    return new Promise(
      (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
        resolveFetch = resolve;
        rejectFetch = reject;
      },
    );
  });
  return {
    land: async (): Promise<void> => {
      await act(async () => {
        resolveFetch(historyResponse(heldRequest!));
      });
      await flush();
    },
    fail: async (error: Error): Promise<void> => {
      await act(async () => {
        rejectFetch(error);
      });
      await flush();
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
const RELATIONSHIP: TopologyRelationship = {
  fromEntityKey: CHECKOUT.entityKey,
  toEntityKey: PAYMENTS.entityKey,
  callCount: 900,
  errorCount: 9,
  avgDurationMs: 31,
};

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function chart(name: string): HTMLElement {
  return screen.getByTestId(`chart ${name}`);
}

// The Topology page opens the drawer over its default range, a day.
async function renderDrawer(): Promise<void> {
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
  await waitFor(() => {
    expect(chart(CALLS_CHART)).toBeInTheDocument();
  });
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
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function historySection(): HTMLElement {
  return screen.getByTestId("edge-history");
}

function historyHeader(): HTMLElement {
  return screen.getByTestId("edge-history-header");
}

function historyBody(): HTMLElement {
  return screen.getByTestId("edge-history-body");
}

// The rows the Calls chart draws (the real DataPointUtil over its props).
function callRows(): Array<ChartDataPoint> {
  const props: { data: Array<SeriesPoints>; xAxis: XAxis; yAxis: YAxis } =
    getStandInChart(CALLS_CHART).props as unknown as {
      data: Array<SeriesPoints>;
      xAxis: XAxis;
      yAxis: YAxis;
    };
  return DataPointUtil.getChartDataPoints({
    seriesPoints: props.data,
    xAxis: props.xAxis,
    yAxis: props.yAxis,
  });
}

function plottedCalls(): Array<number> {
  return callRows()
    .map((row: ChartDataPoint): unknown => {
      return row["Calls"];
    })
    .filter((value: unknown): value is number => {
      return typeof value === "number";
    });
}

function callsAxisSpan(): Array<string> {
  const options: { min: Date | number; max: Date | number } =
    getStandInChart(CALLS_CHART).props.xAxis.options;
  return [
    (options.min as Date).toISOString(),
    (options.max as Date).toISOString(),
  ];
}

// Everything that says the drawer is refetching over the history it shows.
function expectRefreshingOverLastHistory(): void {
  expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  expect(
    within(historyHeader()).getByTestId("edge-history-refreshing"),
  ).toHaveTextContent("Refreshing");
  expect(historyBody()).toHaveClass("opacity-75");
  expect(historySection()).toHaveAttribute("aria-busy", "true");
}

function expectSettled(): void {
  expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("edge-history-refreshing"),
  ).not.toBeInTheDocument();
  expect(historyBody()).not.toHaveClass("opacity-75");
  expect(historySection()).toHaveAttribute("aria-busy", "false");
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  apiPostMock.mockReset();
  resetStandInCharts();
  answerWith((request: HistoryRequest) => {
    return historyResponse(request);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Topology drawer: a zoom from the page's day brings finer buckets (sdn-3)", () => {
  test("the page's day is fetched in 15-minute buckets, the step its charts are drawn on, each bucket its own slot", async () => {
    await renderDrawer();

    const request: HistoryRequest = lastHistoryRequest();
    expect(Date.parse(request.endTime) - Date.parse(request.startTime)).toBe(
      DAY,
    );
    expect(request.bucketSeconds).toBe(15 * 60);
    /*
     * 96 quarter hours, drawn one a slot: 15 calls each, but the two the
     * burst falls in (05:00, all burst; 05:15, five minutes of it).
     */
    const calls: Array<number> = plottedCalls();
    expect(calls).toHaveLength(96);
    expect(
      calls.filter((value: number): boolean => {
        return value !== 15;
      }),
    ).toEqual([15 * 20, 5 * 20 + 10 * 1]);
  });

  test("a 6-hour drag across it re-fetches that stretch in 5-minute buckets, and the 20-minute burst fills its own four slots", async () => {
    await renderDrawer();

    await dragAcross(CALLS_CHART);

    const request: HistoryRequest = lastHistoryRequest();
    expect([request.startTime, request.endTime]).toEqual([
      ZOOM_START.toISOString(),
      ZOOM_END.toISOString(),
    ]);
    expect(request.bucketSeconds).toBe(5 * 60);
    expect(callsAxisSpan()).toEqual([
      ZOOM_START.toISOString(),
      ZOOM_END.toISOString(),
    ]);

    // All 72 five-minute buckets, each on its own slot, 5 calls apiece...
    const rows: Array<ChartDataPoint> = callRows();
    expect(plottedCalls()).toHaveLength(72);
    // ...but the burst's four, at 100: not one hourly point of 440.
    const burst: Array<string> = rows
      .filter((row: ChartDataPoint): boolean => {
        return row["Calls"] === 100;
      })
      .map((row: ChartDataPoint): string => {
        return new Date(Number(row[CHART_DATA_POINT_DATE_KEY])).toISOString();
      });
    expect(burst).toEqual([
      "2026-09-28T05:00:00.000Z",
      "2026-09-28T05:05:00.000Z",
      "2026-09-28T05:10:00.000Z",
      "2026-09-28T05:15:00.000Z",
    ]);
    expect(
      plottedCalls().filter((value: number): boolean => {
        return value !== 100;
      }),
    ).toEqual(new Array(68).fill(5));
  });

  test("a zoom within that zoom goes finer still: 20 minutes of it are fetched a minute at a time", async () => {
    await renderDrawer();
    await dragAcross(CALLS_CHART);

    await dragAcross(
      LATENCY_CHART,
      new Date("2026-09-28T04:55:00.000Z"),
      new Date("2026-09-28T05:15:00.000Z"),
    );

    expect(lastHistoryRequest().bucketSeconds).toBe(60);
    expect(plottedCalls()).toEqual([
      ...new Array(5).fill(1),
      ...new Array(15).fill(20),
    ]);
  });

  test("a reset goes back to the day's 15-minute buckets", async () => {
    await renderDrawer();
    await dragAcross(CALLS_CHART);

    fireEvent.doubleClick(chart(CALLS_CHART));
    await flush();

    expect(lastHistoryRequest().bucketSeconds).toBe(15 * 60);
    expect(plottedCalls()).toHaveLength(96);
  });
});

describe("Topology drawer: Reset zoom sits in the history's header, so a zoom moves nothing (cc-6)", () => {
  test("before any zoom the header is there, a row as tall as the button, with no Reset zoom in it", async () => {
    await renderDrawer();

    const header: HTMLElement = historyHeader();
    expect(header).toHaveClass("h-7");
    expect(header).toHaveTextContent("History");
    expect(resetButtons()).toHaveLength(0);
    // The header opens the history section, above the charts.
    expect(historySection().firstElementChild).toBe(header);
  });

  test("a drag brings Reset zoom into that same row; no row appears above the charts", async () => {
    await renderDrawer();
    const header: HTMLElement = historyHeader();
    const sectionRows: Array<Element> = Array.from(historySection().children);
    const callsChart: HTMLElement = chart(CALLS_CHART);

    await dragAcross(CALLS_CHART);

    expect(resetButtons()).toHaveLength(1);
    expect(header).toContainElement(resetButtons()[0]!);
    // The very same rows, in the same order: nothing was inserted.
    expect(historyHeader()).toBe(header);
    expect(Array.from(historySection().children)).toEqual(sectionRows);
    // And the charts were never swapped out.
    expect(chart(CALLS_CHART)).toBe(callsChart);
    expect(screen.queryByTestId("edge-history-zoom")).not.toBeInTheDocument();
  });

  test("a reset takes Reset zoom out of the row again, and the row stays", async () => {
    await renderDrawer();
    const header: HTMLElement = historyHeader();
    const sectionRows: Array<Element> = Array.from(historySection().children);
    await dragAcross(CALLS_CHART);

    fireEvent.click(resetButtons()[0]!);
    await flush();

    expect(resetButtons()).toHaveLength(0);
    expect(historyHeader()).toBe(header);
    expect(Array.from(historySection().children)).toEqual(sectionRows);
    expect(lastHistoryRequest().bucketSeconds).toBe(15 * 60);
  });
});

describe("Topology drawer: a zoom or a reset refetches over the history on screen", () => {
  test("the first load shows the loader under the header, and nothing else", async () => {
    const first: HeldFetch = holdNextFetch();
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

    expect(
      within(historySection()).getByTestId("component-loader"),
    ).toBeInTheDocument();
    expect(historySection()).toHaveAttribute("aria-busy", "true");
    expect(historyHeader()).toHaveTextContent("History");
    expect(
      screen.queryByTestId("edge-history-refreshing"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("edge-history-body")).not.toBeInTheDocument();

    await first.land();

    expect(chart(CALLS_CHART)).toBeInTheDocument();
    expectSettled();
  });

  test("a drag keeps both charts on screen, dimmed, until the zoom's history lands - still drawn over the day they show", async () => {
    await renderDrawer();
    const callsChart: HTMLElement = chart(CALLS_CHART);
    const latencyChart: HTMLElement = chart(LATENCY_CHART);
    const daySpan: Array<string> = callsAxisSpan();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcross(CALLS_CHART);

    expect(lastHistoryRequest().bucketSeconds).toBe(5 * 60);
    expect(chart(CALLS_CHART)).toBe(callsChart);
    expect(chart(LATENCY_CHART)).toBe(latencyChart);
    // The day's buckets, on the day's axis - not laid over the zoom's.
    expect(callsAxisSpan()).toEqual(daySpan);
    expect(plottedCalls()).toHaveLength(96);
    expectRefreshingOverLastHistory();
    // The way back is already offered.
    expect(resetButtons()).toHaveLength(1);

    await zoomFetch.land();

    expect(callsAxisSpan()).toEqual([
      ZOOM_START.toISOString(),
      ZOOM_END.toISOString(),
    ]);
    expect(plottedCalls()).toHaveLength(72);
    expect(chart(CALLS_CHART)).toBe(callsChart);
    expectSettled();
  });

  test("a double-click keeps the zoomed charts on screen while the reset's history loads", async () => {
    await renderDrawer();
    await dragAcross(CALLS_CHART);
    const callsChart: HTMLElement = chart(CALLS_CHART);
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.doubleClick(chart(LATENCY_CHART));
    await flush();

    expect(lastHistoryRequest().bucketSeconds).toBe(15 * 60);
    expect(resetButtons()).toHaveLength(0);
    expect(chart(CALLS_CHART)).toBe(callsChart);
    expect(callsAxisSpan()).toEqual([
      ZOOM_START.toISOString(),
      ZOOM_END.toISOString(),
    ]);
    expectRefreshingOverLastHistory();

    await resetFetch.land();

    expect(plottedCalls()).toHaveLength(96);
    expectSettled();
  });

  test("a failed refetch keeps the last history, under a note that it could not refresh; the next fetch that lands clears it", async () => {
    await renderDrawer();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcross(CALLS_CHART);
    await zoomFetch.fail(new Error("ClickHouse did not answer"));

    const note: HTMLElement = within(historySection()).getByRole("alert");
    expect(note).toHaveTextContent(
      "Couldn't refresh — showing previously loaded data. ClickHouse did not answer",
    );
    expect(plottedCalls()).toHaveLength(96);
    expectSettled();

    // Back to the day, which loads: the note goes.
    fireEvent.click(resetButtons()[0]!);
    await flush();

    expect(within(historySection()).queryByRole("alert")).toBeNull();
    expect(plottedCalls()).toHaveLength(96);
  });

  test("a failed first load shows the full error, with nothing stale to keep", async () => {
    apiPostMock.mockImplementation(async () => {
      throw new Error("ClickHouse did not answer");
    });
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

    expect(
      within(historySection()).getByText("ClickHouse did not answer"),
    ).toBeInTheDocument();
    expect(within(historySection()).queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("edge-history-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });

  test("a zoom, then a reset before the zoom's history lands: the older answer never lands", async () => {
    await renderDrawer();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcross(CALLS_CHART);
    fireEvent.click(resetButtons()[0]!);
    await flush();
    expect(plottedCalls()).toHaveLength(96);
    expectSettled();

    await zoomFetch.land();

    expect(plottedCalls()).toHaveLength(96);
    expect(callsAxisSpan()[1]).toBe(NOW.toISOString());
    expect(resetButtons()).toHaveLength(0);
  });
});

describe("Topology drawer: an empty zoomed stretch takes the double-click", () => {
  test("after a zoom into a quiet stretch its words cannot be selected, and its double-click goes back to the day", async () => {
    await renderDrawer();
    answerWith((request: HistoryRequest) => {
      return historyResponse(request, true);
    });

    await dragAcross(CALLS_CHART);

    const empty: HTMLElement = await screen.findByTestId("edge-history-empty");
    // A double-click on it must not also select a word.
    expect(empty).toHaveClass("select-none");
    expect(resetButtons()).toHaveLength(1);

    fireEvent.doubleClick(empty);
    await flush();

    expect(lastHistoryRequest().bucketSeconds).toBe(15 * 60);
    expect(resetButtons()).toHaveLength(0);
  });

  test("at the page's own range there is nothing to undo: its words stay selectable, and a double-click does nothing", async () => {
    answerWith((request: HistoryRequest) => {
      return historyResponse(request, true);
    });
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
    const empty: HTMLElement = await screen.findByTestId("edge-history-empty");
    const requests: number = apiPostMock.mock.calls.length;

    expect(empty).not.toHaveClass("select-none");
    fireEvent.doubleClick(empty);
    await flush();

    expect(apiPostMock.mock.calls.length).toBe(requests);
  });

  test("while the reset from a quiet stretch loads, the empty message stays where it was, dimmed", async () => {
    await renderDrawer();
    answerWith((request: HistoryRequest) => {
      return historyResponse(request, true);
    });
    await dragAcross(CALLS_CHART);
    const empty: HTMLElement = await screen.findByTestId("edge-history-empty");
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.doubleClick(empty);
    await flush();

    expect(screen.getByTestId("edge-history-empty")).toBe(empty);
    expectRefreshingOverLastHistory();

    await resetFetch.land();

    expect(chart(CALLS_CHART)).toBeInTheDocument();
    expectSettled();
  });
});
