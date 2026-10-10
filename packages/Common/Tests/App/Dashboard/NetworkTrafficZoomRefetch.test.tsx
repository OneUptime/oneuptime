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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 review on the Traffic pages (NetworkTrafficView), whose chart
 * zooms the page's range: a drag and a double-click are everyday gestures on
 * it, and each one refetches the whole page.
 *
 *   - sdn-2: every refetch used to swap the body - the tiles, the chart and
 *     the tables, about a page - for a small loader, so the page collapsed
 *     under the pointer that had just dragged or double-clicked and was
 *     thrown back when the data landed. The last data stays on screen,
 *     dimmed and marked "Refreshing"; only the very first load shows the
 *     loader.
 *   - sdn-6: a zoom into a quiet stretch must not read as "flow export is
 *     not set up" on a device the reader has just seen exporting. It says
 *     there was no traffic in the selected time range and how to get back;
 *     the set-up guide is for a device that has never sent a flow.
 *   - sdn-1, end to end: a two-week response through the whole page draws
 *     every bucket and peaks at the Peak it prints (the real DataPointUtil
 *     over the chart's props).
 *
 * The network (the traffic POST) and the page's range picker (a stand-in
 * that can pick a preset or a custom range) are replaced; the area chart is
 * ChartZoomStandIn, which resolves its zoom exactly as the real wrapper does.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:40:00.000Z");
const CUSTOM_START: Date = new Date("2026-09-28T09:00:00.000Z");
const CUSTOM_END: Date = new Date("2026-09-28T10:00:00.000Z");
const TRAFFIC_CHART: string = "Traffic [Mbps]";
// The Flows tile over two weeks: a flow a minute, as the tile formats it.
const TWO_WEEKS_OF_FLOWS: string = (14 * 24 * 60).toLocaleString();

const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Area/AreaChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

// The page's picker: shows its range, and picks a preset or a custom range.
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: unknown) => void;
    }): React.ReactElement => {
      const { default: InBetweenType } = jest.requireActual(
        "../../../Types/BaseDatabase/InBetween",
      ) as { default: new (start: Date, end: Date) => unknown };
      return (
        <div>
          <span data-testid="card-picker">
            {props.dashboardStartAndEndDate.range}
          </span>
          <button
            type="button"
            onClick={() => {
              props.onChange({ range: "Past 2 Weeks" });
            }}
          >
            Pick Past 2 Weeks
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange({
                range: "Custom",
                startAndEndDate: new InBetweenType(
                  new Date("2026-09-28T09:00:00.000Z"),
                  new Date("2026-09-28T10:00:00.000Z"),
                ),
              });
            }}
          >
            Pick 09:00 to 10:00
          </button>
        </div>
      );
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

import NetworkTrafficView from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView";
import {
  getStandInChart,
  resetStandInCharts,
  standInDrag,
} from "./ChartZoomStandIn";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import ChartDataPoint from "../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "../../../UI/Components/Charts/Types/SeriesPoints";
import { XAxis } from "../../../UI/Components/Charts/Types/XAxis/XAxis";
import YAxis from "../../../UI/Components/Charts/Types/YAxis/YAxis";
import DataPointUtil from "../../../UI/Components/Charts/Utils/DataPoint";
import { getNetworkTrafficBucketSeconds } from "../../../Types/NetFlow/NetworkTraffic";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

interface TrafficRequest {
  startTime: string;
  endTime: string;
}

type TrafficResponse = { data: Record<string, unknown> };

function requestOf(call: Array<unknown>): TrafficRequest {
  return (call[0] as { data: TrafficRequest }).data;
}

function lastTrafficRequest(): TrafficRequest {
  const calls: Array<Array<unknown>> = apiPostMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error("The traffic was never fetched");
  }
  return requestOf(last);
}

function requestMinutes(request: TrafficRequest): number {
  return (Date.parse(request.endTime) - Date.parse(request.startTime)) / MINUTE;
}

function apiBucketSeconds(request: TrafficRequest): number {
  return getNetworkTrafficBucketSeconds(
    Math.floor(
      (Date.parse(request.endTime) - Date.parse(request.startTime)) / 1000,
    ),
  );
}

function emptyLists(): Record<string, unknown> {
  return {
    topSources: [],
    topDestinations: [],
    topConversations: [],
    topApplications: [],
    topInterfaces: [],
    topDevices: [],
    sources: [],
  };
}

/*
 * What the endpoint answers for a window: figures that depend on its length
 * (so a page that did not follow the range shows the wrong number), a bucket
 * at 1 Mbps for every bucket of the window but one at `burstMbps`, and the
 * window echoed back.
 */
function trafficResponse(
  request: TrafficRequest,
  burstMbps: number = 1,
): TrafficResponse {
  const minutes: number = requestMinutes(request);
  const bucketSeconds: number = apiBucketSeconds(request);
  const bucketMs: number = bucketSeconds * 1000;
  const firstMs: number =
    Math.floor(Date.parse(request.startTime) / bucketMs) * bucketMs;
  const count: number = Math.ceil(
    (Date.parse(request.endTime) - firstMs) / bucketMs,
  );
  const series: Array<Record<string, unknown>> = [];
  for (let index: number = 0; index < count; index++) {
    const mbps: number = index === Math.floor(count / 2) ? burstMbps : 1;
    series.push({
      time: new Date(firstMs + index * bucketMs).toISOString(),
      octets: (mbps * 1_000_000 * bucketSeconds) / 8,
    });
  }
  return {
    data: {
      ...emptyLists(),
      windowStartAt: request.startTime,
      windowEndAt: request.endTime,
      bucketSeconds: bucketSeconds,
      totals: { octets: minutes * 1000, packets: minutes * 10, flows: minutes },
      maxSamplingRate: 1,
      series: series,
      topSources: [{ ip: `10.0.0.${minutes}`, octets: 3000, packets: 20 }],
      topDestinations: [{ ip: "10.0.0.9", octets: 2000, packets: 10 }],
      topApplications: [
        { protocolNumber: 6, port: 443, octets: 5000, packets: 30 },
      ],
      lastFlowAt: "2026-09-28 11:59:00",
    },
  };
}

/*
 * A window with no flows. `lastFlowAt` is when the device last sent one;
 * null for a device that never has.
 */
function quietResponse(
  request: TrafficRequest,
  lastFlowAt: string | null = "2026-09-27 08:00:00",
): TrafficResponse {
  return {
    data: {
      ...emptyLists(),
      windowStartAt: request.startTime,
      windowEndAt: request.endTime,
      bucketSeconds: apiBucketSeconds(request),
      totals: { octets: 0, packets: 0, flows: 0 },
      maxSamplingRate: 1,
      series: [],
      lastFlowAt: lastFlowAt,
    },
  };
}

function neverSentResponse(request: TrafficRequest): TrafficResponse {
  return quietResponse(request, null);
}

// Answers every window from now on with `answer`.
function answerWith(
  answer: (request: TrafficRequest) => TrafficResponse,
): void {
  apiPostMock.mockImplementation(async (args: unknown) => {
    return answer((args as { data: TrafficRequest }).data);
  });
}

// Holds the NEXT fetch until the test lets it land.
interface HeldFetch {
  land: (response: TrafficResponse) => Promise<void>;
  fail: (error: Error) => Promise<void>;
}

function holdNextFetch(): HeldFetch {
  let resolveFetch: (value: unknown) => void = (): void => {};
  let rejectFetch: (error: Error) => void = (): void => {};
  apiPostMock.mockImplementationOnce(() => {
    return new Promise(
      (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
        resolveFetch = resolve;
        rejectFetch = reject;
      },
    );
  });
  return {
    land: async (response: TrafficResponse): Promise<void> => {
      await act(async () => {
        resolveFetch(response);
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

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function chart(): HTMLElement {
  return screen.getByTestId(`chart ${TRAFFIC_CHART}`);
}

function renderView(): void {
  render(
    <NetworkTrafficView
      scope={{ kind: "device", networkDeviceId: new ObjectID(DEVICE_ID) }}
    />,
  );
}

async function renderPage(): Promise<void> {
  renderView();
  await flush();
  await waitFor(() => {
    expect(chart()).toBeInTheDocument();
  });
}

async function dragAcrossTraffic(
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(
    screen.getByRole("button", { name: `Drag across ${TRAFFIC_CHART}` }),
  );
  await flush();
}

function tileValue(tile: "total" | "average" | "peak" | "flows"): string {
  return screen.getByTestId(`traffic-tile-${tile}-value`).textContent || "";
}

function pickerLabel(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

function body(): HTMLElement {
  return screen.getByTestId("traffic-body");
}

// Everything that says the page is refetching over the data it shows.
function expectRefreshingOverLastData(): void {
  expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  expect(screen.getByTestId("traffic-refreshing")).toHaveTextContent(
    "Refreshing",
  );
  expect(body()).toHaveClass("opacity-75");
  expect(body().parentElement).toHaveAttribute("aria-busy", "true");
}

function expectSettled(): void {
  expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  expect(screen.queryByTestId("traffic-refreshing")).not.toBeInTheDocument();
  expect(body()).not.toHaveClass("opacity-75");
  expect(body().parentElement).toHaveAttribute("aria-busy", "false");
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState(null, "", "/");
  apiPostMock.mockReset();
  resetStandInCharts();
  answerWith((request: TrafficRequest) => {
    return trafficResponse(request);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Traffic page: a zoom or a reset refetches over the data on screen (sdn-2)", () => {
  test("the first load shows the loader, and nothing else", async () => {
    const first: HeldFetch = holdNextFetch();
    renderView();
    await flush();

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("traffic-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("traffic-refreshing")).not.toBeInTheDocument();

    await first.land(trafficResponse(lastTrafficRequest()));

    expect(tileValue("flows")).toBe("60");
    expectSettled();
  });

  test("a drag keeps the tiles, the chart and the lists on screen while the zoom's fetch runs", async () => {
    await renderPage();
    const chartBeforeZoom: HTMLElement = chart();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcrossTraffic();

    // The picker already reads the zoom; the body still shows the past hour.
    expect(pickerLabel()).toBe(TimeRange.CUSTOM);
    expect(tileValue("flows")).toBe("60");
    expect(screen.getByText("10.0.0.60")).toBeInTheDocument();
    expect(screen.getByTestId("traffic-top-applications")).toHaveTextContent(
      "HTTPS",
    );
    // The very chart that was dragged: still mounted, not re-created.
    expect(chart()).toBe(chartBeforeZoom);
    expectRefreshingOverLastData();

    await zoomFetch.land(
      trafficResponse({
        startTime: ZOOM_START.toISOString(),
        endTime: ZOOM_END.toISOString(),
      }),
    );

    expect(tileValue("flows")).toBe("20");
    expect(screen.getByText("10.0.0.20")).toBeInTheDocument();
    expect(screen.queryByText("10.0.0.60")).not.toBeInTheDocument();
    expect(chart()).toBe(chartBeforeZoom);
    expectSettled();
  });

  test("a double-click on the chart keeps the zoomed figures on screen while the reset's fetch runs", async () => {
    await renderPage();
    await dragAcrossTraffic();
    await waitFor(() => {
      expect(tileValue("flows")).toBe("20");
    });
    const chartBeforeReset: HTMLElement = chart();
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.doubleClick(chart());
    await flush();

    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(tileValue("flows")).toBe("20");
    expect(chart()).toBe(chartBeforeReset);
    expectRefreshingOverLastData();

    await resetFetch.land(trafficResponse(lastTrafficRequest()));

    expect(requestMinutes(lastTrafficRequest())).toBe(60);
    expect(tileValue("flows")).toBe("60");
    expect(chart()).toBe(chartBeforeReset);
    expectSettled();
  });

  test("Reset zoom beside the picker does the same", async () => {
    await renderPage();
    await dragAcrossTraffic();
    await waitFor(() => {
      expect(tileValue("flows")).toBe("20");
    });
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(tileValue("flows")).toBe("20");
    expectRefreshingOverLastData();

    await resetFetch.land(trafficResponse(lastTrafficRequest()));

    expect(tileValue("flows")).toBe("60");
    expectSettled();
  });

  test("a new pick on the picker refetches over the data on screen too", async () => {
    await renderPage();
    const pickFetch: HeldFetch = holdNextFetch();

    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();

    expect(tileValue("flows")).toBe("60");
    expectRefreshingOverLastData();

    await pickFetch.land(trafficResponse(lastTrafficRequest()));

    expect(tileValue("flows")).toBe(TWO_WEEKS_OF_FLOWS);
    expectSettled();
  });

  test("a failed refetch keeps the last data, under an inline note that it could not refresh", async () => {
    await renderPage();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcrossTraffic();
    await zoomFetch.fail(new Error("The probe did not answer"));

    const note: HTMLElement = screen.getByRole("alert");
    expect(note).toHaveTextContent(
      "Couldn't refresh — showing previously loaded data. The probe did not answer",
    );
    expect(tileValue("flows")).toBe("60");
    expect(chart()).toBeInTheDocument();
    expectSettled();

    // The next fetch that lands clears the note.
    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();
    await waitFor(() => {
      expect(tileValue("flows")).toBe(TWO_WEEKS_OF_FLOWS);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a failed first load still shows the full error, with nothing stale to keep", async () => {
    apiPostMock.mockImplementation(async () => {
      throw new Error("The probe did not answer");
    });
    renderView();
    await flush();

    expect(screen.getByText("The probe did not answer")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("traffic-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });

  test("a zoom, then a reset before the zoom's data lands: the slower, older answer never lands", async () => {
    await renderPage();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcrossTraffic();
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();
    await waitFor(() => {
      expect(
        screen.queryByTestId("traffic-refreshing"),
      ).not.toBeInTheDocument();
    });

    await zoomFetch.land(
      trafficResponse({
        startTime: ZOOM_START.toISOString(),
        endTime: ZOOM_END.toISOString(),
      }),
    );

    expect(tileValue("flows")).toBe("60");
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expectSettled();
  });
});

describe("Traffic page: an empty window after a zoom is not an onboarding screen (sdn-6)", () => {
  test("a zoom into a quiet stretch says there was no traffic there, and how to get back", async () => {
    await renderPage();
    answerWith((request: TrafficRequest) => {
      return requestMinutes(request) < 60
        ? quietResponse(request)
        : trafficResponse(request);
    });

    await dragAcrossTraffic();

    const empty: HTMLElement = await screen.findByTestId("traffic-no-data");
    expect(empty).toHaveTextContent("No traffic in the selected time range.");
    expect(empty).toHaveTextContent(
      "No flow records from this device in the stretch you zoomed into. Double-click here, or use Reset zoom, to go back to the past 1 hour.",
    );
    expect(screen.queryByTestId("traffic-setup-guide")).not.toBeInTheDocument();
    // It takes the double-click, so a double-click must not select a word.
    expect(empty).toHaveClass("select-none");

    fireEvent.doubleClick(empty);
    await flush();

    await waitFor(() => {
      expect(chart()).toBeInTheDocument();
    });
    expect(requestMinutes(lastTrafficRequest())).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a device that never sent a flow gets the set-up guide, whose text stays selectable", async () => {
    answerWith(neverSentResponse);
    renderView();
    await flush();

    const guide: HTMLElement = await screen.findByTestId("traffic-setup-guide");
    expect(guide).toHaveTextContent("See where this device's traffic goes");
    // The ports the probe listens on, and the vendor commands.
    expect(guide).toHaveTextContent("UDP 2055");
    expect(guide).toHaveTextContent("UDP 4739");
    expect(guide).toHaveTextContent("UDP 6343");
    expect(screen.getByTestId("traffic-setup-configuration")).toHaveTextContent(
      "flow exporter ONEUPTIME",
    );
    expect(guide).not.toHaveTextContent("Double-click");
    expect(guide).not.toHaveClass("select-none");
    // Nothing to read yet: no tiles, no chart.
    expect(screen.queryByTestId("traffic-tiles")).not.toBeInTheDocument();
  });

  test("a device that sent before but not in this window: its last flow, and no set-up guide", async () => {
    answerWith((request: TrafficRequest) => {
      return quietResponse(request, "2026-09-27 08:00:00");
    });
    renderView();
    await flush();

    expect(screen.getByTestId("traffic-device-status")).toHaveTextContent(
      "No flow records in the last hour.",
    );
    expect(screen.getByTestId("traffic-no-data")).toHaveTextContent(
      "No flow records from this device in this time range.",
    );
    expect(screen.queryByTestId("traffic-setup-guide")).not.toBeInTheDocument();
  });

  test("another preset with no flows ever keeps the set-up guide too", async () => {
    await renderPage();
    answerWith(neverSentResponse);

    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();

    expect(
      await screen.findByTestId("traffic-setup-guide"),
    ).toBeInTheDocument();
  });

  test("a custom range picked on the page, with no flows: no set-up guide, and no zoom to undo", async () => {
    await renderPage();
    answerWith(neverSentResponse);

    fireEvent.click(
      screen.getByRole("button", { name: "Pick 09:00 to 10:00" }),
    );
    await flush();

    const empty: HTMLElement = await screen.findByTestId("traffic-no-data");
    expect([
      lastTrafficRequest().startTime,
      lastTrafficRequest().endTime,
    ]).toEqual([CUSTOM_START.toISOString(), CUSTOM_END.toISOString()]);
    expect(empty).toHaveTextContent("No traffic in the selected time range.");
    expect(empty).toHaveTextContent(
      "No flow records from this device in this time range.",
    );
    expect(empty).not.toHaveTextContent("Double-click");
    expect(screen.queryByTestId("traffic-setup-guide")).not.toBeInTheDocument();
    expect(empty).not.toHaveClass("select-none");
  });

  test("a quiet zoom inside a custom range points back to the time range before the zoom", async () => {
    await renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Pick 09:00 to 10:00" }),
    );
    await flush();
    await waitFor(() => {
      expect(tileValue("flows")).toBe("60");
    });
    answerWith((request: TrafficRequest) => {
      return requestMinutes(request) < 60
        ? quietResponse(request)
        : trafficResponse(request);
    });

    await dragAcrossTraffic(
      new Date("2026-09-28T09:10:00.000Z"),
      new Date("2026-09-28T09:20:00.000Z"),
    );

    const empty: HTMLElement = await screen.findByTestId("traffic-no-data");
    expect(empty).toHaveTextContent(
      "Double-click here, or use Reset zoom, to go back to the time range before the zoom.",
    );
  });

  test("while a reset from a quiet zoom refetches, the empty state keeps its words: the set-up guide never flashes up", async () => {
    await renderPage();
    answerWith((request: TrafficRequest) => {
      return requestMinutes(request) < 60
        ? neverSentResponse(request)
        : trafficResponse(request);
    });
    await dragAcrossTraffic();
    const empty: HTMLElement = await screen.findByTestId("traffic-no-data");
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.doubleClick(empty);
    await flush();

    // The picker is back on the past hour, but the data is still the zoom's.
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(screen.getByTestId("traffic-no-data")).toHaveTextContent(
      "No traffic in the selected time range.",
    );
    expect(screen.queryByTestId("traffic-setup-guide")).not.toBeInTheDocument();
    expectRefreshingOverLastData();

    await resetFetch.land(trafficResponse(lastTrafficRequest()));

    expect(chart()).toBeInTheDocument();
    expect(tileValue("flows")).toBe("60");
    expectSettled();
  });
});

describe("Traffic page: a two-week window draws every bucket, peaking at its Peak (sdn-1, end to end)", () => {
  test("the whole page over a two-week response: one row per bucket, and the burst is drawn at 900 Mbps", async () => {
    await renderPage();
    answerWith((request: TrafficRequest) => {
      return trafficResponse(request, 900);
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();
    await waitFor(() => {
      expect(tileValue("flows")).toBe(TWO_WEEKS_OF_FLOWS);
    });

    const props: { data: Array<SeriesPoints>; xAxis: XAxis; yAxis: YAxis } =
      getStandInChart(TRAFFIC_CHART).props as unknown as {
        data: Array<SeriesPoints>;
        xAxis: XAxis;
        yAxis: YAxis;
      };
    const rows: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: props.data,
      xAxis: props.xAxis,
      yAxis: props.yAxis,
    });
    const plotted: Array<number> = rows
      .map((row: ChartDataPoint): unknown => {
        return row["Traffic"];
      })
      .filter((value: unknown): value is number => {
        return typeof value === "number";
      });

    // 168-minute buckets: 121 of them, each its own point.
    expect(props.data[0]!.data).toHaveLength(121);
    expect(plotted).toHaveLength(121);
    expect(Math.max(...plotted)).toBe(900);
    expect(tileValue("peak")).toBe("900 Mbps");
  });
});
