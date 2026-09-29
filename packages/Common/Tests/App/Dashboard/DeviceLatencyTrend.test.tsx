import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import DeviceLatencyTrend from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceLatencyTrend";
import { NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME as SERVER_METRIC_NAME } from "../../../Server/Utils/Monitor/NetworkDeviceMetricUtil";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import { NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME } from "../../../Types/NetworkDevice/NetworkDevicePingMetricNames";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #3745: the hour of round-trip time under a device's name.
 *
 * The trend is the context an on-demand ping is read against, and the only
 * thing that makes it the RIGHT context is the query: the device's own
 * series (attributes.networkDeviceId), by the name the server writes, for
 * the past hour. That query is what this pins, along with what the operator
 * sees for a series, for a single point, for nothing, and for a metrics
 * store that failed. The metrics API and the sparkline are stubbed so the
 * assertions are about this component's decisions, not recharts.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const fetchResultsMock: MockFunction = getJestMockFunction();
const currentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectIdMock();
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricSparkline",
  () => {
    return {
      __esModule: true,
      default: (props: {
        points: Array<unknown>;
        isLoading?: boolean | undefined;
      }) => {
        return `sparkline-stub:${
          props.isLoading ? "loading" : props.points.length
        }`;
      },
    };
  },
);

interface FetchResultsRequest {
  metricViewData: MetricViewData;
  metricTypes?: Array<unknown> | undefined;
}

function aggregate(
  rows: Array<{ time: string; value: number }>,
): AggregatedResult {
  return {
    data: rows.map((row: { time: string; value: number }) => {
      return { timestamp: new Date(row.time), value: row.value };
    }),
  };
}

async function renderTrend(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DeviceLatencyTrend networkDeviceId={new ObjectID(DEVICE_ID)} />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  currentProjectIdMock.mockReset();
  currentProjectIdMock.mockReturnValue(PROJECT_ID);
  fetchResultsMock.mockResolvedValue([aggregate([]), aggregate([])]);
});

afterEach(() => {
  cleanup();
});

describe("what the trend asks the metrics API for", () => {
  test("the device's own RTT and packet-loss series, with no MetricType listing", async () => {
    await renderTrend();

    expect(fetchResultsMock).toHaveBeenCalledTimes(1);

    const request: FetchResultsRequest = fetchResultsMock.mock
      .calls[0]![0] as FetchResultsRequest;
    const configs: Array<MetricQueryConfigData> =
      request.metricViewData.queryConfigs;

    expect(configs).toHaveLength(2);

    expect(configs[0]!.metricQueryData.filterData.metricName).toBe(
      NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME,
    );
    expect(configs[0]!.metricQueryData.filterData.attributes).toEqual({
      networkDeviceId: DEVICE_ID,
      projectId: PROJECT_ID,
    });

    expect(configs[1]!.metricQueryData.filterData.metricName).toBe(
      MonitorMetricType.PacketLossPercent,
    );
    expect(configs[1]!.metricQueryData.filterData.attributes).toEqual({
      networkDeviceId: DEVICE_ID,
      projectId: PROJECT_ID,
    });

    /*
     * Left out, fetchResults lists every MetricType of the project (up to
     * ten thousand rows, uncached) on every drawer open, for a unit
     * conversion these ms and % series do not need.
     */
    expect(request.metricTypes).toEqual([]);
  });

  test("no project means nothing to scope to, so nothing is fetched", async () => {
    currentProjectIdMock.mockReturnValue(null);

    await renderTrend();

    expect(fetchResultsMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("No ping data in the last hour."),
    ).toBeInTheDocument();
  });

  /*
   * The dashboard reads the series the server writes. A rename on either
   * side that the other does not follow leaves the sparkline pointed at a
   * series nobody writes, and no type checker notices; the value is what
   * has to agree.
   */
  test("by the same name the server util writes under", () => {
    expect(SERVER_METRIC_NAME).toBe(
      NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME,
    );
    expect(NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME).toBe(
      "oneuptime.monitor.ping.round.trip.time",
    );
  });
});

describe("what the trend shows", () => {
  test("a series: the sparkline, now / avg / max, and the hour's worst loss", async () => {
    fetchResultsMock.mockResolvedValue([
      aggregate([
        { time: "2026-09-15T10:00:00Z", value: 10 },
        { time: "2026-09-15T10:01:00Z", value: 30 },
        { time: "2026-09-15T10:02:00Z", value: 20 },
      ]),
      aggregate([
        { time: "2026-09-15T10:00:00Z", value: 0 },
        { time: "2026-09-15T10:01:00Z", value: 40 },
      ]),
    ]);

    await renderTrend();

    expect(
      screen.getByTestId("network-device-latency-summary"),
    ).toHaveTextContent("now 20.0 ms · avg 20.0 ms · max 30.0 ms");
    expect(screen.getByTestId("network-device-loss-summary")).toHaveTextContent(
      "Packet loss (1h max): 40%",
    );
    expect(
      screen.getByTestId("network-device-latency-trend"),
    ).toHaveTextContent("sparkline-stub:3");
  });

  /*
   * MetricSparkline draws a dashed "no data" box for fewer than two points,
   * which above a summary line with a number in it reads as a contradiction.
   */
  test("a single point is a summary, not a line", async () => {
    fetchResultsMock.mockResolvedValue([
      aggregate([{ time: "2026-09-15T10:00:00Z", value: 12.5 }]),
      aggregate([{ time: "2026-09-15T10:00:00Z", value: 0 }]),
    ]);

    await renderTrend();

    expect(
      screen.getByTestId("network-device-latency-summary"),
    ).toHaveTextContent("now 12.5 ms · avg 12.5 ms · max 12.5 ms");
    expect(screen.getByTestId("network-device-loss-summary")).toHaveTextContent(
      "Packet loss (1h max): 0%",
    );
    expect(screen.queryByText(/sparkline-stub/)).not.toBeInTheDocument();
  });

  test("shows the loading placeholder until the API answers", async () => {
    fetchResultsMock.mockReturnValue(
      new Promise<Array<AggregatedResult>>(() => {
        // Never settles: the fetch is still in flight.
      }),
    );

    await renderTrend();

    expect(
      screen.getByTestId("network-device-latency-trend"),
    ).toHaveTextContent("sparkline-stub:loading");
    expect(
      screen.queryByTestId("network-device-latency-summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No ping data in the last hour."),
    ).not.toBeInTheDocument();
  });

  /*
   * Quiet on failure: the drawer mounts this for every managed device it
   * opens, and a red error under the device's name because the metrics
   * store was slow would make the whole drawer look broken.
   */
  test("a metrics store that failed reads as no data, not as an error", async () => {
    fetchResultsMock.mockRejectedValue(new Error("ClickHouse is away."));

    await renderTrend();

    expect(
      screen.getByText("No ping data in the last hour."),
    ).toBeInTheDocument();
    expect(screen.queryByText("ClickHouse is away.")).not.toBeInTheDocument();
    expect(screen.queryByText(/sparkline-stub/)).not.toBeInTheDocument();
  });

  test("links to the device's Metrics page", async () => {
    await renderTrend();

    const link: HTMLElement = screen.getByText("Open metrics");

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`${DEVICE_ID}/metrics`),
    );
  });
});
