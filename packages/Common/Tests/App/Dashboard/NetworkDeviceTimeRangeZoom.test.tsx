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
 * Issue #4105 on a network device's two time-series pages, each of which is
 * one card that owns the page's range:
 *
 *   - Metrics (DeviceHealthCharts): the interface utilization and polled
 *     OID panels are one MetricView. A drag on either zooms the CARD'S range,
 *     so its picker reads Custom (the view used to narrow only its own window
 *     and leave the picker on the old range), both panels re-fetch, and a
 *     double-click or "Reset zoom" puts the range back.
 *   - Traffic (FlowTopTalkers): the bandwidth chart - once a hand-drawn SVG
 *     with no gestures, now the shared area chart - zooms the card's range,
 *     and the totals and every top-N table, which come from the same fetch,
 *     follow it.
 *
 * The network is replaced (the metric fetch, the top-talkers POST); so is the
 * card's range picker (a stand-in showing the range, which can pick "Past 1
 * Day"). MetricView renders for real around a MetricCharts stand-in; the
 * bandwidth chart is ChartZoomStandIn, which resolves its zoom exactly as
 * the real area chart wrapper does.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:40:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:25:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");
const ZOOM_WINDOW: [string, string] = [
  ZOOM_START.toISOString(),
  ZOOM_END.toISOString(),
];
const BANDWIDTH_CHART: string = "Bandwidth [Mbps]";

const fetchResultsMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

// The zoom the page offers, as a chart inside the panels would see it.
interface MockSeenZoom {
  onTimeRangeSelect: unknown;
  onTimeRangeReset: unknown;
}

interface MockMetricChartsProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  pageZoomSeen?: MockSeenZoom | null | undefined;
}

const mockMetricCharts: { current: MockMetricChartsProps | null } = {
  current: null,
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>): unknown => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: (): Promise<Record<string, unknown>> => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        clearQueryTopNOverridesForScope: (): undefined => {
          return undefined;
        },
      },
    };
  },
);

/*
 * The panels MetricView draws: what matters is the zoom it hands them, and
 * what the page offers around them.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const zoomContext: { useChartTimeRangeZoom: () => unknown } =
      jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
      ) as { useChartTimeRangeZoom: () => unknown };
    return {
      __esModule: true,
      default: (props: MockMetricChartsProps): React.ReactElement => {
        mockMetricCharts.current = {
          ...props,
          pageZoomSeen:
            zoomContext.useChartTimeRangeZoom() as MockSeenZoom | null,
        };
        return (
          <div
            data-testid="device-panels"
            onDoubleClick={props.onTimeRangeReset}
          >
            <button
              type="button"
              onClick={() => {
                const drag: { start: Date; end: Date } = (
                  jest.requireActual("./ChartZoomStandIn") as {
                    standInDrag: { start: Date; end: Date };
                  }
                ).standInDrag;
                props.onTimeRangeSelect?.(drag.start, drag.end);
              }}
            >
              Drag across the device panels
            </button>
          </div>
        );
      },
    };
  },
);

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

// The card's picker: shows its range, and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }): React.ReactElement => {
      return (
        <button
          type="button"
          data-testid="card-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Day" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
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

import DeviceHealthCharts from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceHealthCharts";
import FlowTopTalkers, {
  BandwidthOverTimeChart,
  getBandwidthAxisPrecision,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/FlowTopTalkers";
import {
  StandInChartRecord,
  getStandInChart,
  resetStandInCharts,
  standInDrag,
} from "./ChartZoomStandIn";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import {
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import XAxisPrecision from "../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../UI/Components/Charts/Types/XAxis/XAxisType";
import XAxisUtil from "../../../UI/Components/Charts/Utils/XAxis";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function pickerLabel(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fetchResultsMock.mockReset();
  apiPostMock.mockReset();
  mockMetricCharts.current = null;
  resetStandInCharts();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------ Metrics: DeviceHealthCharts

function fetchedViews(): Array<MetricViewData> {
  return fetchResultsMock.mock.calls.map(
    (call: Array<unknown>): MetricViewData => {
      return (call[0] as { metricViewData: MetricViewData }).metricViewData;
    },
  );
}

function lastFetchedView(): MetricViewData {
  const views: Array<MetricViewData> = fetchedViews();
  const last: MetricViewData | undefined = views[views.length - 1];
  if (!last) {
    throw new Error("The device panels were never fetched");
  }
  return last;
}

function lastFetchedWindow(): [string, string] {
  const view: MetricViewData = lastFetchedView();
  return [
    view.startAndEndDate!.startValue.toISOString(),
    view.startAndEndDate!.endValue.toISOString(),
  ];
}

function lastFetchedMinutes(): number {
  const view: MetricViewData = lastFetchedView();
  return (
    (view.startAndEndDate!.endValue.getTime() -
      view.startAndEndDate!.startValue.getTime()) /
    MINUTE
  );
}

function panels(): MockMetricChartsProps {
  if (!mockMetricCharts.current) {
    throw new Error("The device panels have not rendered");
  }
  return mockMetricCharts.current;
}

async function renderHealth(): Promise<void> {
  fetchResultsMock.mockResolvedValue([
    { data: [], truncated: false },
    { data: [], truncated: false },
  ]);
  render(<DeviceHealthCharts networkDeviceId={new ObjectID(DEVICE_ID)} />);
  await flush();
  await waitFor(() => {
    expect(screen.getByTestId("device-panels")).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
  });
}

async function dragAcrossPanels(
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(
    screen.getByRole("button", { name: "Drag across the device panels" }),
  );
  await flush();
}

async function doubleClickPanels(): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId("device-panels"));
  await flush();
}

describe("Network device Metrics: the health panels zoom the card's range", () => {
  test("both panels take the card's zoom, the one the page offers", async () => {
    await renderHealth();

    expect(panels().pageZoomSeen).not.toBeNull();
    expect(panels().onTimeRangeSelect).toBe(
      panels().pageZoomSeen!.onTimeRangeSelect,
    );
    expect(panels().onTimeRangeReset).toBeUndefined();
    // One MetricView, both panels: the interface and OID queries together.
    expect(lastFetchedView().queryConfigs).toHaveLength(2);
    expect(lastFetchedMinutes()).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a drag zooms the card: both panels re-fetch the dragged window and the picker reads Custom", async () => {
    await renderHealth();

    await dragAcrossPanels();

    expect(lastFetchedWindow()).toEqual(ZOOM_WINDOW);
    expect(lastFetchedView().queryConfigs).toHaveLength(2);
    // It used to keep showing "Past 1 Hour" over a zoomed chart.
    expect(pickerLabel()).toBe(TimeRange.CUSTOM);
  });

  test("while zoomed there is exactly one Reset zoom, beside the picker", async () => {
    await renderHealth();

    await dragAcrossPanels();

    expect(resetButtons()).toHaveLength(1);
    const picker: HTMLElement = screen.getByTestId("card-picker");
    expect(picker.parentElement).toContainElement(resetButtons()[0]!);
    expect(panels().onTimeRangeReset).toBe(
      panels().pageZoomSeen!.onTimeRangeReset,
    );
  });

  test("a double-click puts the card's range back", async () => {
    await renderHealth();

    await dragAcrossPanels();
    await doubleClickPanels();

    expect(lastFetchedMinutes()).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(resetButtons()).toHaveLength(0);
    expect(panels().onTimeRangeReset).toBeUndefined();
  });

  test("Reset zoom does the same", async () => {
    await renderHealth();

    await dragAcrossPanels();
    fireEvent.click(resetButtons()[0]!);
    await flush();

    expect(lastFetchedMinutes()).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a zoom within a zoom: one double-click goes back to the past hour", async () => {
    await renderHealth();

    await dragAcrossPanels();
    await dragAcrossPanels(INNER_ZOOM_START, INNER_ZOOM_END);
    expect(lastFetchedWindow()).toEqual([
      INNER_ZOOM_START.toISOString(),
      INNER_ZOOM_END.toISOString(),
    ]);

    await doubleClickPanels();

    expect(lastFetchedMinutes()).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a double-click with nothing to undo does not re-fetch", async () => {
    await renderHealth();
    const fetches: number = fetchResultsMock.mock.calls.length;

    await doubleClickPanels();

    expect(fetchResultsMock.mock.calls.length).toBe(fetches);
  });

  test("picking a range ends the zoom", async () => {
    await renderHealth();

    await dragAcrossPanels();
    fireEvent.click(screen.getByTestId("card-picker"));
    await flush();

    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_DAY);
    expect(lastFetchedMinutes()).toBe(24 * 60);
    expect(resetButtons()).toHaveLength(0);
  });

  test("the card keeps its own zoom inside a page that zooms", async () => {
    const pageZoomToTimeRange: MockFunction = getJestMockFunction();
    const pageZoom: TimeRangeZoom = {
      isZoomed: false,
      rangeBeforeZoom: null,
      zoomToTimeRange: pageZoomToTimeRange as unknown as (
        startTime: Date,
        endTime: Date,
      ) => void,
      resetZoom: () => {},
    };
    fetchResultsMock.mockResolvedValue([{ data: [], truncated: false }]);
    render(
      <TimeRangeZoomProvider zoom={pageZoom}>
        <DeviceHealthCharts networkDeviceId={new ObjectID(DEVICE_ID)} />
      </TimeRangeZoomProvider>,
    );
    await flush();
    await waitFor(() => {
      expect(screen.getByTestId("device-panels")).toBeInTheDocument();
    });

    await dragAcrossPanels();

    expect(pageZoomToTimeRange).not.toHaveBeenCalled();
    expect(pickerLabel()).toBe(TimeRange.CUSTOM);
  });
});

// -------------------------------------------------- Traffic: FlowTopTalkers

interface FlowRequest {
  startTime: string;
  endTime: string;
  networkDeviceId: string;
  projectId: string;
}

function flowRequests(): Array<FlowRequest> {
  return apiPostMock.mock.calls.map((call: Array<unknown>): FlowRequest => {
    return (call[0] as { data: FlowRequest }).data;
  });
}

function lastFlowRequest(): FlowRequest {
  const requests: Array<FlowRequest> = flowRequests();
  const last: FlowRequest | undefined = requests[requests.length - 1];
  if (!last) {
    throw new Error("The top talkers were never fetched");
  }
  return last;
}

function requestMinutes(request: FlowRequest): number {
  return (Date.parse(request.endTime) - Date.parse(request.startTime)) / MINUTE;
}

/*
 * What the top-talkers endpoint answers for a window: figures that depend
 * on its length (so a card that did not follow the zoom shows the wrong
 * number), one-minute buckets, and the window echoed back.
 */
function flowResponse(request: FlowRequest): Record<string, unknown> {
  const minutes: number = requestMinutes(request);
  const start: number = Date.parse(request.startTime);
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
      series: [
        // 7.5 MB in the first minute: 1 Mbps.
        {
          time: new Date(start).toISOString(),
          octets: 7_500_000,
          packets: 50,
        },
        // A naive ClickHouse string, UTC: 0.5 Mbps in the third minute.
        {
          time: new Date(start + 2 * MINUTE)
            .toISOString()
            .replace("T", " ")
            .replace(/\.\d{3}Z$/, ""),
          octets: 3_750_000,
          packets: 25,
        },
      ],
      seriesBucketSeconds: 60,
      windowStartAt: request.startTime,
      windowEndAt: request.endTime,
    },
  };
}

async function renderTraffic(): Promise<void> {
  apiPostMock.mockImplementation(async (args: unknown) => {
    return flowResponse((args as { data: FlowRequest }).data);
  });
  render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
  await flush();
  await waitFor(() => {
    expect(screen.getByTestId(`chart ${BANDWIDTH_CHART}`)).toBeInTheDocument();
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

async function doubleClickBandwidth(): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId(`chart ${BANDWIDTH_CHART}`));
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

describe("Network device Traffic: the bandwidth chart zooms the card's range", () => {
  test("the chart is the shared area chart over the fetched window, in Mbps", async () => {
    await renderTraffic();

    const record: StandInChartRecord = getStandInChart(BANDWIDTH_CHART);
    const request: FlowRequest = lastFlowRequest();
    expect(record.props.xAxis.options.type).toBe(XAxisType.Time);
    expect((record.props.xAxis.options.min as Date).toISOString()).toBe(
      request.startTime,
    );
    expect((record.props.xAxis.options.max as Date).toISOString()).toBe(
      request.endTime,
    );
    // One-minute buckets: the axis is pinned to them.
    expect(record.props.xAxis.options.precision).toBe(
      XAxisPrecision.EVERY_MINUTE,
    );
    // Every bucket of the window, the silent ones as zero, as Mbps.
    const points: Array<{ x: Date; y: number }> = record.props.data[0]!.data;
    expect(points).toHaveLength(60);
    expect(points[0]).toEqual({ x: new Date(request.startTime), y: 1 });
    expect(points[1]!.y).toBe(0);
    // The naive ClickHouse bucket is read as UTC, not local time.
    expect(points[2]).toEqual({
      x: new Date(Date.parse(request.startTime) + 2 * MINUTE),
      y: 0.5,
    });
  });

  test("it passes no handlers of its own: it takes the card's zoom", async () => {
    await renderTraffic();

    const record: StandInChartRecord = getStandInChart(BANDWIDTH_CHART);
    expect(record.props.onTimeRangeSelect).toBeUndefined();
    expect(record.props.onTimeRangeReset).toBeUndefined();
    expect(record.zoom.onTimeRangeSelect).toBeInstanceOf(Function);
    expect(record.zoom.onTimeRangeReset).toBeUndefined();
  });

  test("the section names the gesture, revealed on hover", async () => {
    await renderTraffic();

    const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
    expect(hint).toHaveTextContent(/^Drag to zoom$/);
    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint.closest('[class~="group/zoomhint"]')).toContainElement(
      screen.getByText("Bandwidth Over Time"),
    );
  });

  test("Min / Avg / Max still read the gap-filled buckets", async () => {
    await renderTraffic();

    const stats: HTMLElement = screen.getByText("Min").parentElement!;
    // Silent minutes count as zero: the minimum is 0.
    expect(stats).toHaveTextContent("Min 0.00 Mbps");
    expect(stats).toHaveTextContent("Max 1.00 Mbps");
    // (1 + 0.5) Mbps over 60 minutes.
    expect(stats).toHaveTextContent("Avg 0.03 Mbps");
  });

  test("a drag re-fetches the card over the dragged window: chart, totals and tables follow", async () => {
    await renderTraffic();
    expect(tileValue("Flows")).toBe("60");
    expect(screen.getByText("10.0.0.60")).toBeInTheDocument();

    await dragAcrossBandwidth();
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });

    expect([lastFlowRequest().startTime, lastFlowRequest().endTime]).toEqual(
      ZOOM_WINDOW,
    );
    expect(lastFlowRequest().networkDeviceId).toBe(DEVICE_ID);
    expect(lastFlowRequest().projectId).toBe(PROJECT_ID);
    expect(tileValue("Flows")).toBe("20");
    expect(screen.getByText("10.0.0.20")).toBeInTheDocument();
    expect(screen.queryByText("10.0.0.60")).not.toBeInTheDocument();
    const record: StandInChartRecord = getStandInChart(BANDWIDTH_CHART);
    expect((record.props.xAxis.options.min as Date).toISOString()).toBe(
      ZOOM_WINDOW[0],
    );
    expect(record.props.data[0]!.data).toHaveLength(20);
  });

  test("after a drag the picker reads Custom, Reset zoom appears, and the hint names the reset", async () => {
    await renderTraffic();

    await dragAcrossBandwidth();
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });

    expect(pickerLabel()).toBe(TimeRange.CUSTOM);
    expect(resetButtons()).toHaveLength(1);
    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Double-click to reset",
    );
    // The card says which window it describes.
    expect(
      screen.getByText(
        /Who this device saw talking over the selected time range/,
      ),
    ).toBeInTheDocument();
  });

  test("a double-click on the chart puts the past hour back", async () => {
    await renderTraffic();

    await dragAcrossBandwidth();
    await waitFor(() => {
      expect(
        getStandInChart(BANDWIDTH_CHART).zoom.onTimeRangeReset,
      ).toBeInstanceOf(Function);
    });
    await doubleClickBandwidth();
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });

    expect(requestMinutes(lastFlowRequest())).toBe(60);
    expect(Date.parse(lastFlowRequest().endTime)).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    expect(resetButtons()).toHaveLength(0);
    expect(tileValue("Flows")).toBe("60");
  });

  test("Reset zoom beside the picker does the same", async () => {
    await renderTraffic();

    await dragAcrossBandwidth();
    fireEvent.click(resetButtons()[0]!);
    await flush();

    expect(requestMinutes(lastFlowRequest())).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a zoom within a zoom: one double-click goes back to the past hour", async () => {
    await renderTraffic();

    await dragAcrossBandwidth();
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });
    await dragAcrossBandwidth(INNER_ZOOM_START, INNER_ZOOM_END);
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });
    expect([lastFlowRequest().startTime, lastFlowRequest().endTime]).toEqual([
      INNER_ZOOM_START.toISOString(),
      INNER_ZOOM_END.toISOString(),
    ]);

    await doubleClickBandwidth();

    expect(requestMinutes(lastFlowRequest())).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("picking a range ends the zoom", async () => {
    await renderTraffic();

    await dragAcrossBandwidth();
    fireEvent.click(screen.getByTestId("card-picker"));
    await flush();

    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_DAY);
    expect(requestMinutes(lastFlowRequest())).toBe(24 * 60);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a slower, older fetch never overwrites the window the picker shows", async () => {
    await renderTraffic();

    /*
     * The zoom's fetch is still in flight when the reset's fetch lands:
     * the card must end up on the past hour's figures, not the zoom's.
     */
    let resolveZoomFetch: (value: unknown) => void = (): void => {};
    apiPostMock.mockImplementationOnce(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        resolveZoomFetch = resolve;
      });
    });

    await dragAcrossBandwidth();
    fireEvent.click(resetButtons()[0]!);
    await flush();
    await waitFor(() => {
      expect(tileValue("Flows")).toBe("60");
    });

    await act(async () => {
      resolveZoomFetch(
        flowResponse({
          startTime: ZOOM_WINDOW[0],
          endTime: ZOOM_WINDOW[1],
          networkDeviceId: DEVICE_ID,
          projectId: PROJECT_ID,
        }),
      );
    });
    await flush();

    expect(tileValue("Flows")).toBe("60");
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("a zoom into a quiet stretch: the empty state takes the double-click", async () => {
    await renderTraffic();
    apiPostMock.mockImplementation(async (args: unknown) => {
      const request: FlowRequest = (args as { data: FlowRequest }).data;
      return requestMinutes(request) < 60
        ? { data: { totalOctets: 0, totalPackets: 0, totalFlows: 0 } }
        : flowResponse(request);
    });

    await dragAcrossBandwidth();
    const empty: HTMLElement = await screen.findByTestId("flow-no-data");
    // Not the NetFlow setup steps: the device was just seen exporting.
    expect(empty).toHaveTextContent("No flows in the selected time range.");

    fireEvent.doubleClick(empty);
    await flush();

    expect(requestMinutes(lastFlowRequest())).toBe(60);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });
  });

  test("the empty state ignores a double-click when there is nothing to undo", async () => {
    apiPostMock.mockResolvedValue({
      data: { totalOctets: 0, totalPackets: 0, totalFlows: 0 },
    });
    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();
    const requests: number = apiPostMock.mock.calls.length;

    fireEvent.doubleClick(await screen.findByTestId("flow-no-data"));
    await flush();

    expect(apiPostMock.mock.calls.length).toBe(requests);
    expect(pickerLabel()).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("the card keeps its own zoom inside a page that zooms", async () => {
    const pageZoomToTimeRange: MockFunction = getJestMockFunction();
    apiPostMock.mockImplementation(async (args: unknown) => {
      return flowResponse((args as { data: FlowRequest }).data);
    });
    render(
      <TimeRangeZoomScope
        timeRange={{ range: TimeRange.PAST_ONE_WEEK }}
        onTimeRangeChange={
          pageZoomToTimeRange as unknown as (value: unknown) => void
        }
      >
        <FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />
      </TimeRangeZoomScope>,
    );
    await flush();
    await waitFor(() => {
      expect(
        screen.getByTestId(`chart ${BANDWIDTH_CHART}`),
      ).toBeInTheDocument();
    });

    await dragAcrossBandwidth();

    expect(pageZoomToTimeRange).not.toHaveBeenCalled();
    expect([lastFlowRequest().startTime, lastFlowRequest().endTime]).toEqual(
      ZOOM_WINDOW,
    );
  });
});

describe("BandwidthOverTimeChart", () => {
  const WINDOW_START: string = "2026-09-28T10:00:00.000Z";
  const WINDOW_END: string = "2026-09-28T11:00:00.000Z";

  test("an axis that spans the whole window, even when traffic is only at its start", () => {
    render(
      <BandwidthOverTimeChart
        series={[{ time: WINDOW_START, octets: 7_500_000, packets: 1 }]}
        bucketSeconds={60}
        windowStartAt={WINDOW_START}
        windowEndAt={WINDOW_END}
      />,
    );

    const record: StandInChartRecord = getStandInChart(BANDWIDTH_CHART);
    expect((record.props.xAxis.options.min as Date).toISOString()).toBe(
      WINDOW_START,
    );
    expect((record.props.xAxis.options.max as Date).toISOString()).toBe(
      WINDOW_END,
    );
  });

  test("without a window from the API, the first and last buckets bound the axis", () => {
    render(
      <BandwidthOverTimeChart
        series={[
          { time: "2026-09-28T10:00:00.000Z", octets: 1, packets: 1 },
          { time: "2026-09-28T10:05:00.000Z", octets: 1, packets: 1 },
        ]}
        bucketSeconds={300}
        windowStartAt=""
        windowEndAt=""
      />,
    );

    const record: StandInChartRecord = getStandInChart(BANDWIDTH_CHART);
    expect((record.props.xAxis.options.min as Date).toISOString()).toBe(
      "2026-09-28T10:00:00.000Z",
    );
    // The last bucket runs to its end.
    expect((record.props.xAxis.options.max as Date).toISOString()).toBe(
      "2026-09-28T10:10:00.000Z",
    );
  });

  test("keeps its indigo look and draws no legend (Min / Avg / Max is the legend)", () => {
    render(
      <BandwidthOverTimeChart
        series={[{ time: WINDOW_START, octets: 7_500_000, packets: 1 }]}
        bucketSeconds={60}
        windowStartAt={WINDOW_START}
        windowEndAt={WINDOW_END}
      />,
    );

    const props: Record<string, unknown> = getStandInChart(BANDWIDTH_CHART)
      .props as unknown as Record<string, unknown>;
    expect(props["colors"]).toEqual(["indigo"]);
    expect(props["showLegend"]).toBe(false);
    expect(
      screen.getByRole("figure", {
        name: "Bandwidth over time in megabits per second",
      }),
    ).toBeInTheDocument();
  });

  test("the tooltip and axis read Mbps", () => {
    render(
      <BandwidthOverTimeChart
        series={[{ time: WINDOW_START, octets: 7_500_000, packets: 1 }]}
        bucketSeconds={60}
        windowStartAt={WINDOW_START}
        windowEndAt={WINDOW_END}
      />,
    );

    const yAxis: { options: { formatter: (value: number) => string } } =
      getStandInChart(BANDWIDTH_CHART).props.yAxis as unknown as {
        options: { formatter: (value: number) => string };
      };
    expect(yAxis.options.formatter(12.345)).toBe("12.3 Mbps");
    expect(yAxis.options.formatter(0.5)).toBe("0.50 Mbps");
  });

  test("a series with no parseable bucket keeps its figures but draws no chart", () => {
    render(
      <BandwidthOverTimeChart
        series={[{ time: "not a time", octets: 7_500_000, packets: 1 }]}
        bucketSeconds={60}
        windowStartAt=""
        windowEndAt=""
      />,
    );

    expect(screen.getByText("Max")).toBeInTheDocument();
    expect(
      screen.queryByTestId(`chart ${BANDWIDTH_CHART}`),
    ).not.toBeInTheDocument();
  });

  test("inside a zoomable card the chart offers the card's drag", () => {
    const zoomToTimeRange: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={{
          isZoomed: false,
          rangeBeforeZoom: null,
          zoomToTimeRange: zoomToTimeRange as unknown as (
            startTime: Date,
            endTime: Date,
          ) => void,
          resetZoom: () => {},
        }}
      >
        <BandwidthOverTimeChart
          series={[{ time: WINDOW_START, octets: 7_500_000, packets: 1 }]}
          bucketSeconds={60}
          windowStartAt={WINDOW_START}
          windowEndAt={WINDOW_END}
        />
      </TimeRangeZoomProvider>,
    );

    standInDrag.start = new Date("2026-09-28T10:10:00.000Z");
    standInDrag.end = new Date("2026-09-28T10:20:00.000Z");
    fireEvent.click(
      within(screen.getByTestId(`chart ${BANDWIDTH_CHART}`)).getByRole(
        "button",
      ),
    );

    expect(zoomToTimeRange).toHaveBeenCalledWith(
      standInDrag.start,
      standInDrag.end,
    );
  });
});

/*
 * How far apart the chart library's walker puts two slots of a precision,
 * measured on the walker itself (a UTC Sunday, far from any clock change).
 */
function walkedStepSeconds(precision: XAxisPrecision): number {
  const from: Date = new Date("2026-09-27T00:00:00.000Z");
  const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
    xAxisMin: from,
    xAxisMax: new Date(from.getTime() + 2 * 24 * 60 * MINUTE),
    precision: precision,
  });
  return (intervals[1]!.getTime() - intervals[0]!.getTime()) / 1000;
}

// The API's bucket width for a window, as pickBucketSeconds sizes it.
function apiBucketSeconds(windowSeconds: number): number {
  return Math.max(60, Math.ceil(Math.ceil(windowSeconds / 120) / 60) * 60);
}

describe("getBandwidthAxisPrecision", () => {
  test("pins one-minute buckets to a one-minute grid", () => {
    expect(getBandwidthAxisPrecision(60)).toBe(XAxisPrecision.EVERY_MINUTE);
  });

  /*
   * sdn-1: every other width used to be left to the axis, which picks a
   * step from the window's length - daily over two weeks - and averaged
   * several buckets into each slot.
   */
  test.each([
    // The presets: 3 hours, a day, 2 days, a week, 2 weeks, a 31-day month.
    [120, XAxisPrecision.EVERY_MINUTE],
    [720, XAxisPrecision.EVERY_TEN_MINUTES],
    [1440, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [5040, XAxisPrecision.EVERY_HOUR],
    [10080, XAxisPrecision.EVERY_TWO_HOURS],
    [22320, XAxisPrecision.EVERY_SIX_HOURS],
    // Zooms and custom ranges: any whole number of minutes.
    [180, XAxisPrecision.EVERY_MINUTE],
    [240, XAxisPrecision.EVERY_MINUTE],
    [300, XAxisPrecision.EVERY_FIVE_MINUTES],
    [540, XAxisPrecision.EVERY_FIVE_MINUTES],
    [600, XAxisPrecision.EVERY_TEN_MINUTES],
    [840, XAxisPrecision.EVERY_TEN_MINUTES],
    [900, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [1740, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [1800, XAxisPrecision.EVERY_THIRTY_MINUTES],
    [3540, XAxisPrecision.EVERY_THIRTY_MINUTES],
    [3600, XAxisPrecision.EVERY_HOUR],
    [7140, XAxisPrecision.EVERY_HOUR],
    [7200, XAxisPrecision.EVERY_TWO_HOURS],
    [10800, XAxisPrecision.EVERY_THREE_HOURS],
    [21540, XAxisPrecision.EVERY_THREE_HOURS],
    [21600, XAxisPrecision.EVERY_SIX_HOURS],
    [43200, XAxisPrecision.EVERY_TWELVE_HOURS],
    // Wider than any fixed step: the widest one.
    [86400, XAxisPrecision.EVERY_TWELVE_HOURS],
  ])(
    "pins %i-second buckets to the coarsest step no wider than one: %s",
    (bucketSeconds: number, precision: XAxisPrecision) => {
      expect(getBandwidthAxisPrecision(bucketSeconds)).toBe(precision);
    },
  );

  test("for every bucket the API can send (one minute up to the 31-day window's), the step fits in a bucket and the next one up would not", () => {
    const steps: Array<number> = [
      60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200,
    ];
    const widest: number = apiBucketSeconds(31 * 24 * 60 * 60);
    expect(widest).toBe(22320);
    for (
      let bucketSeconds: number = 60;
      bucketSeconds <= widest;
      bucketSeconds += 60
    ) {
      const precision: XAxisPrecision | undefined =
        getBandwidthAxisPrecision(bucketSeconds);
      expect([bucketSeconds, precision]).not.toEqual([
        bucketSeconds,
        undefined,
      ]);
      const stepSeconds: number = walkedStepSeconds(precision!);
      const nextStep: number | undefined = steps.find((step: number) => {
        return step > stepSeconds;
      });
      expect([bucketSeconds, stepSeconds <= bucketSeconds]).toEqual([
        bucketSeconds,
        true,
      ]);
      expect([bucketSeconds, nextStep! > bucketSeconds]).toEqual([
        bucketSeconds,
        true,
      ]);
    }
  });

  test("the pinned steps are exactly as wide as the chart walks them", () => {
    expect(
      [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200].map(
        (seconds: number): number => {
          return walkedStepSeconds(getBandwidthAxisPrecision(seconds)!);
        },
      ),
    ).toEqual([60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200]);
  });

  test("a bucket narrower than a second fits no step: the axis picks its own", () => {
    expect(getBandwidthAxisPrecision(0.5)).toBeUndefined();
  });
});
