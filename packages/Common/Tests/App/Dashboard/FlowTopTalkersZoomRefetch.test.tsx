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
 * Issue #4105 review on the network device Traffic card (FlowTopTalkers),
 * whose bandwidth chart zooms the card's range: a drag and a double-click are
 * now everyday gestures on it, and each one refetches the whole card.
 *
 *   - sdn-2: every refetch used to swap the card's body - three tiles, the
 *     chart and four top-N tables, about a page - for a small loader, so the
 *     page collapsed under the pointer that had just dragged or double-clicked
 *     and was thrown back when the data landed. The last data now stays on
 *     screen, dimmed and marked "Refreshing", as the Database overview and
 *     MetricView keep theirs; only the very first load shows the loader.
 *   - sdn-6: a zoom into a quiet stretch showed "No flow data yet" and the
 *     NetFlow setup steps, as if export were not configured on a device the
 *     reader had just seen exporting. It now says there were no flows in the
 *     selected time range and how to get back; the setup steps stay for an
 *     unzoomed preset window.
 *   - sdn-1, end to end: a two-week response through the whole card draws
 *     every bucket and peaks at the Max it prints (the real DataPointUtil over
 *     the chart's props).
 *
 * The network (the top-talkers POST) and the card's range picker (a stand-in
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
const BANDWIDTH_CHART: string = "Bandwidth [Mbps]";
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

// The card's picker: shows its range, and picks a preset or a custom range.
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

import FlowTopTalkers from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/FlowTopTalkers";
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
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

interface FlowRequest {
  startTime: string;
  endTime: string;
}

type FlowResponse = { data: Record<string, unknown> };

function requestOf(call: Array<unknown>): FlowRequest {
  return (call[0] as { data: FlowRequest }).data;
}

function lastFlowRequest(): FlowRequest {
  const calls: Array<Array<unknown>> = apiPostMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error("The top talkers were never fetched");
  }
  return requestOf(last);
}

function requestMinutes(request: FlowRequest): number {
  return (Date.parse(request.endTime) - Date.parse(request.startTime)) / MINUTE;
}

// The API's bucket width for a window (pickBucketSeconds).
function apiBucketSeconds(request: FlowRequest): number {
  const windowSeconds: number = Math.floor(
    (Date.parse(request.endTime) - Date.parse(request.startTime)) / 1000,
  );
  return Math.max(60, Math.ceil(Math.ceil(windowSeconds / 120) / 60) * 60);
}

/*
 * What the endpoint answers for a window: figures that depend on its length
 * (so a card that did not follow the range shows the wrong number), a bucket
 * at 1 Mbps for every bucket of the window but one at `burstMbps`, and the
 * window echoed back.
 */
function flowResponse(
  request: FlowRequest,
  burstMbps: number = 1,
): FlowResponse {
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
      packets: 1,
    });
  }
  return {
    data: {
      totalOctets: minutes * 1000,
      totalPackets: minutes * 10,
      totalFlows: minutes,
      topSources: [{ key: `10.0.0.${minutes}`, octets: 3000, packets: 20 }],
      topDestinations: [{ key: "10.0.0.9", octets: 2000, packets: 10 }],
      topProtocolPorts: [
        { protocolNumber: 6, destinationPort: 443, octets: 5000, packets: 30 },
      ],
      topConversations: [],
      series: series,
      seriesBucketSeconds: bucketSeconds,
      windowStartAt: request.startTime,
      windowEndAt: request.endTime,
    },
  };
}

function quietResponse(request: FlowRequest): FlowResponse {
  return {
    data: {
      totalOctets: 0,
      totalPackets: 0,
      totalFlows: 0,
      series: [],
      seriesBucketSeconds: apiBucketSeconds(request),
      windowStartAt: request.startTime,
      windowEndAt: request.endTime,
    },
  };
}

// Answers every window from now on with `answer`.
function answerWith(answer: (request: FlowRequest) => FlowResponse): void {
  apiPostMock.mockImplementation(async (args: unknown) => {
    return answer((args as { data: FlowRequest }).data);
  });
}

// Holds the NEXT fetch until the test lets it land.
interface HeldFetch {
  land: (response: FlowResponse) => Promise<void>;
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
    land: async (response: FlowResponse): Promise<void> => {
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
  return screen.getByTestId(`chart ${BANDWIDTH_CHART}`);
}

async function renderCard(): Promise<void> {
  render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
  await flush();
  await waitFor(() => {
    expect(chart()).toBeInTheDocument();
  });
}

async function dragAcrossBandwidth(
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(
    screen.getByRole("button", { name: `Drag across ${BANDWIDTH_CHART}` }),
  );
  await flush();
}

function tileValue(title: string): string {
  const tile: HTMLElement | null = screen
    .getByRole("button", { name: `About ${title}` })
    .closest("div.rounded-md");
  return (
    (tile?.querySelector("div.text-2xl") as HTMLElement | null)?.textContent ||
    ""
  );
}

function pickerLabel(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

function body(): HTMLElement {
  return screen.getByTestId("flow-top-talkers-body");
}

// Everything that says the card is refetching over the data it shows.
function expectRefreshingOverLastData(): void {
  expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  expect(screen.getByTestId("flow-refreshing")).toHaveTextContent("Refreshing");
  expect(body()).toHaveClass("opacity-75");
  expect(body().parentElement).toHaveAttribute("aria-busy", "true");
}

function expectSettled(): void {
  expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  expect(screen.queryByTestId("flow-refreshing")).not.toBeInTheDocument();
  expect(body()).not.toHaveClass("opacity-75");
  expect(body().parentElement).toHaveAttribute("aria-busy", "false");
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  apiPostMock.mockReset();
  resetStandInCharts();
  answerWith((request: FlowRequest) => {
    return flowResponse(request);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Traffic card: a zoom or a reset refetches over the data on screen (sdn-2)", () => {
  test("the first load shows the loader, and nothing else", async () => {
    const first: HeldFetch = holdNextFetch();
    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(
      screen.queryByTestId("flow-top-talkers-body"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("flow-refreshing")).not.toBeInTheDocument();

    await first.land(flowResponse(lastFlowRequest()));

    expect(tileValue("Flows")).toBe("60");
    expectSettled();
  });

  test("a drag keeps the tiles, the chart and the tables on screen while the zoom's fetch runs", async () => {
    await renderCard();
    const chartBeforeZoom: HTMLElement = chart();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcrossBandwidth();

    // The picker already reads the zoom; the body still shows the past hour.
    expect(pickerLabel()).toBe(TimeRange.CUSTOM);
    expect(tileValue("Flows")).toBe("60");
    expect(screen.getByText("10.0.0.60")).toBeInTheDocument();
    expect(screen.getByText("Top Protocols & Ports")).toBeInTheDocument();
    // The very chart that was dragged: still mounted, not re-created.
    expect(chart()).toBe(chartBeforeZoom);
    expectRefreshingOverLastData();

    await zoomFetch.land(
      flowResponse({
        startTime: ZOOM_START.toISOString(),
        endTime: ZOOM_END.toISOString(),
      }),
    );

    expect(tileValue("Flows")).toBe("20");
    expect(screen.getByText("10.0.0.20")).toBeInTheDocument();
    expect(screen.queryByText("10.0.0.60")).not.toBeInTheDocument();
    expect(chart()).toBe(chartBeforeZoom);
    expectSettled();
  });

  test("a double-click on the chart keeps the zoomed figures on screen while the reset's fetch runs", async () => {
    await renderCard();
    await dragAcrossBandwidth();
    await waitFor(() => {
      expect(tileValue("Flows")).toBe("20");
    });
    const chartBeforeReset: HTMLElement = chart();
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.doubleClick(chart());
    await flush();

    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(tileValue("Flows")).toBe("20");
    expect(chart()).toBe(chartBeforeReset);
    expectRefreshingOverLastData();

    await resetFetch.land(flowResponse(lastFlowRequest()));

    expect(requestMinutes(lastFlowRequest())).toBe(60);
    expect(tileValue("Flows")).toBe("60");
    expect(chart()).toBe(chartBeforeReset);
    expectSettled();
  });

  test("Reset zoom beside the picker does the same", async () => {
    await renderCard();
    await dragAcrossBandwidth();
    await waitFor(() => {
      expect(tileValue("Flows")).toBe("20");
    });
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(tileValue("Flows")).toBe("20");
    expectRefreshingOverLastData();

    await resetFetch.land(flowResponse(lastFlowRequest()));

    expect(tileValue("Flows")).toBe("60");
    expectSettled();
  });

  test("a new pick on the picker refetches over the data on screen too", async () => {
    await renderCard();
    const pickFetch: HeldFetch = holdNextFetch();

    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();

    expect(tileValue("Flows")).toBe("60");
    expectRefreshingOverLastData();

    await pickFetch.land(flowResponse(lastFlowRequest()));

    expect(tileValue("Flows")).toBe(TWO_WEEKS_OF_FLOWS);
    expectSettled();
  });

  test("a failed refetch keeps the last data, under an inline note that it could not refresh", async () => {
    await renderCard();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcrossBandwidth();
    await zoomFetch.fail(new Error("The probe did not answer"));

    const note: HTMLElement = screen.getByRole("alert");
    expect(note).toHaveTextContent(
      "Couldn't refresh — showing previously loaded data. The probe did not answer",
    );
    expect(tileValue("Flows")).toBe("60");
    expect(chart()).toBeInTheDocument();
    expectSettled();

    // The next fetch that lands clears the note.
    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();
    await waitFor(() => {
      expect(tileValue("Flows")).toBe(TWO_WEEKS_OF_FLOWS);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a failed first load still shows the full error, with nothing stale to keep", async () => {
    apiPostMock.mockImplementation(async () => {
      throw new Error("The probe did not answer");
    });
    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();

    expect(screen.getByText("The probe did not answer")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("flow-top-talkers-body"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });

  test("a zoom, then a reset before the zoom's data lands: the slower, older answer never lands", async () => {
    await renderCard();
    const zoomFetch: HeldFetch = holdNextFetch();

    await dragAcrossBandwidth();
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();
    await waitFor(() => {
      expect(screen.queryByTestId("flow-refreshing")).not.toBeInTheDocument();
    });

    await zoomFetch.land(
      flowResponse({
        startTime: ZOOM_START.toISOString(),
        endTime: ZOOM_END.toISOString(),
      }),
    );

    expect(tileValue("Flows")).toBe("60");
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expectSettled();
  });
});

describe("Traffic card: an empty window after a zoom is not an onboarding screen (sdn-6)", () => {
  test("a zoom into a quiet stretch says there were no flows there, and how to get back", async () => {
    await renderCard();
    answerWith((request: FlowRequest) => {
      return requestMinutes(request) < 60
        ? quietResponse(request)
        : flowResponse(request);
    });

    await dragAcrossBandwidth();

    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    expect(empty).toHaveTextContent("No flows in the selected time range.");
    expect(empty).toHaveTextContent(
      "This device sent no flow records in the stretch you zoomed into. Double-click here, or use Reset zoom, to go back to the past 1 hour.",
    );
    expect(empty).not.toHaveTextContent("No flow data yet.");
    expect(empty).not.toHaveTextContent("PROBE_NETFLOW_RECEIVER_ENABLED");
    // It takes the double-click, so a double-click must not select a word.
    expect(empty).toHaveClass("select-none");

    fireEvent.doubleClick(empty);
    await flush();

    await waitFor(() => {
      expect(chart()).toBeInTheDocument();
    });
    expect(requestMinutes(lastFlowRequest())).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the unzoomed past hour with no flows keeps the NetFlow setup steps, and its text stays selectable", async () => {
    answerWith(quietResponse);
    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();

    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    expect(empty).toHaveTextContent("No flow data yet.");
    expect(empty).toHaveTextContent(
      "Flow export is not configured for this device, or nothing has arrived in the past 1 hour.",
    );
    expect(empty).toHaveTextContent("PROBE_NETFLOW_RECEIVER_ENABLED=true");
    expect(empty).not.toHaveTextContent("Double-click");
    expect(empty).not.toHaveClass("select-none");
  });

  test("another preset with no flows keeps the setup steps too, for that window", async () => {
    await renderCard();
    answerWith(quietResponse);

    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();

    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    expect(empty).toHaveTextContent("No flow data yet.");
    expect(empty).toHaveTextContent("nothing has arrived in the past 2 weeks");
  });

  test("a custom range picked on the card, with no flows: no setup steps, and no zoom to undo", async () => {
    await renderCard();
    answerWith(quietResponse);

    fireEvent.click(
      screen.getByRole("button", { name: "Pick 09:00 to 10:00" }),
    );
    await flush();

    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    expect([lastFlowRequest().startTime, lastFlowRequest().endTime]).toEqual([
      CUSTOM_START.toISOString(),
      CUSTOM_END.toISOString(),
    ]);
    expect(empty).toHaveTextContent("No flows in the selected time range.");
    expect(empty).toHaveTextContent(
      "This device sent no flow records in this window.",
    );
    expect(empty).not.toHaveTextContent("Double-click");
    expect(empty).not.toHaveTextContent("No flow data yet.");
    expect(empty).not.toHaveClass("select-none");
  });

  test("a quiet zoom inside a custom range points back to the time range before the zoom", async () => {
    await renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Pick 09:00 to 10:00" }),
    );
    await flush();
    await waitFor(() => {
      expect(tileValue("Flows")).toBe("60");
    });
    answerWith((request: FlowRequest) => {
      return requestMinutes(request) < 60
        ? quietResponse(request)
        : flowResponse(request);
    });

    await dragAcrossBandwidth(
      new Date("2026-09-28T09:10:00.000Z"),
      new Date("2026-09-28T09:20:00.000Z"),
    );

    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    expect(empty).toHaveTextContent(
      "Double-click here, or use Reset zoom, to go back to the time range before the zoom.",
    );
  });

  test("while a reset from a quiet zoom refetches, the empty state keeps its words: the setup steps never flash up", async () => {
    await renderCard();
    answerWith((request: FlowRequest) => {
      return requestMinutes(request) < 60
        ? quietResponse(request)
        : flowResponse(request);
    });
    await dragAcrossBandwidth();
    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    const resetFetch: HeldFetch = holdNextFetch();

    fireEvent.doubleClick(empty);
    await flush();

    // The picker is back on the past hour, but the data is still the zoom's.
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(screen.getByTestId("flow-no-data")).toHaveTextContent(
      "No flows in the selected time range.",
    );
    expect(screen.getByTestId("flow-no-data")).not.toHaveTextContent(
      "No flow data yet.",
    );
    expectRefreshingOverLastData();

    await resetFetch.land(flowResponse(lastFlowRequest()));

    expect(chart()).toBeInTheDocument();
    expect(tileValue("Flows")).toBe("60");
    expectSettled();
  });
});

describe("Traffic card: a two-week window draws every bucket, peaking at its Max (sdn-1, end to end)", () => {
  test("the whole card over a two-week response: one row per bucket, and the burst is drawn at 900 Mbps", async () => {
    await renderCard();
    answerWith((request: FlowRequest) => {
      return flowResponse(request, 900);
    });

    fireEvent.click(screen.getByRole("button", { name: "Pick Past 2 Weeks" }));
    await flush();
    await waitFor(() => {
      expect(tileValue("Flows")).toBe(TWO_WEEKS_OF_FLOWS);
    });

    const props: { data: Array<SeriesPoints>; xAxis: XAxis; yAxis: YAxis } =
      getStandInChart(BANDWIDTH_CHART).props as unknown as {
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
        return row["Bandwidth"];
      })
      .filter((value: unknown): value is number => {
        return typeof value === "number";
      });

    // 168-minute buckets: 121 of them, each its own point.
    expect(props.data[0]!.data).toHaveLength(121);
    expect(plotted).toHaveLength(121);
    expect(Math.max(...plotted)).toBe(900);
    expect(screen.getByText("Max").parentElement).toHaveTextContent(
      "Max 900 Mbps",
    );
  });
});
