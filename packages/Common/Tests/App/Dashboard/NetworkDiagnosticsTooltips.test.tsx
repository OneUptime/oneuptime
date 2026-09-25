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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The (i) tooltips on a device's connectivity and traffic numbers,
 * RENDERED: the on-demand ping result rows, the traceroute hop table, the
 * past hour's latency trend (device Overview and topology drawer) and the
 * Traffic tab's NetFlow top talkers.
 *
 * Only the network is replaced: the metrics query, the diagnostic row reads
 * (through DeviceDiagnostics' own modelAPI seam) and the top-talkers POST.
 * Every statistic is checked for an (i) whose tooltip is the matching
 * NETWORK_DEVICE_METRIC_DESCRIPTIONS entry; the rows and columns that only
 * name something (Host, Reason, Hop, Source IP) are checked for having none.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const DIAGNOSTIC_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const fetchResultsMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      // Read at render time, long after the module-level id below exists.
      getCurrentProjectId: (): unknown => {
        return mockProjectObjectId;
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>): unknown => {
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
      default: (): string => {
        return "sparkline-stub";
      },
    };
  },
);

import DeviceDiagnostics from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnostics";
import { DIAGNOSTIC_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import DeviceLatencyTrend from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceLatencyTrend";
import FlowTopTalkers, {
  FlowSectionTitle,
  FlowStatTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/FlowTopTalkers";
import TracerouteHopsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TracerouteHopsTable";
import {
  NETWORK_DEVICE_METRIC_DESCRIPTIONS,
  NetworkDeviceMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const DESCRIPTIONS: Record<NetworkDeviceMetric, string> =
  NETWORK_DEVICE_METRIC_DESCRIPTIONS;

// Handed out by the Project mock; below the imports so ObjectID exists.
const mockProjectObjectId: ObjectID = new ObjectID(PROJECT_ID);

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function infoButtonNames(container?: HTMLElement): Array<string> {
  const scope: ReturnType<typeof within> | typeof screen = container
    ? within(container)
    : screen;

  return scope
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement): string => {
      return button.getAttribute("aria-label") || "";
    });
}

async function expectExplained(label: string, text: string): Promise<void> {
  const button: HTMLElement = screen.getByRole("button", {
    name: `About ${label}`,
  });

  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  expect(
    screen.getAllByRole("tooltip").map((tooltip: HTMLElement): string => {
      return tooltip.textContent || "";
    }),
  ).toContain(text);

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchResultsMock.mockReset();
  apiPostMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// --------------------------------------------------------- ping result

const createMock: MockFunction = getJestMockFunction();
const getDiagnosticMock: MockFunction = getJestMockFunction();
const getDeviceMock: MockFunction = getJestMockFunction();

const fakeModelAPI: typeof ModelAPI = {
  create: createMock,
  getItem: (request: { modelType: unknown }) => {
    return request.modelType === NetworkDevice
      ? getDeviceMock(request)
      : getDiagnosticMock(request);
  },
} as unknown as typeof ModelAPI;

function diagnosticRow(
  overrides: Partial<NetworkDeviceDiagnostic>,
): NetworkDeviceDiagnostic {
  return Object.assign(
    new NetworkDeviceDiagnostic(),
    { _id: DIAGNOSTIC_ID, status: "Pending" },
    overrides,
  );
}

async function runPing(result: NetworkDeviceDiagnostic): Promise<HTMLElement> {
  createMock.mockResolvedValue({ data: diagnosticRow({}) });
  getDiagnosticMock.mockResolvedValue(result);
  getDeviceMock.mockResolvedValue(
    Object.assign(new NetworkDevice(), {
      _id: DEVICE_ID,
      hostname: "10.0.0.1",
      probeId: new ObjectID(PROBE_ID),
    }),
  );

  render(
    <DeviceDiagnostics
      networkDeviceId={new ObjectID(DEVICE_ID)}
      modelAPI={fakeModelAPI}
    />,
  );
  await flush();

  await act(async () => {
    fireEvent.click(screen.getByTestId("network-device-diagnostic-ping"));
  });
  await act(async () => {
    jest.advanceTimersByTime(DIAGNOSTIC_POLL_INTERVAL_IN_MS);
  });
  await flush();

  return screen.getByTestId("network-device-diagnostic-result");
}

const COMPLETED_PING: NetworkDeviceDiagnostic = diagnosticRow({
  status: "Completed",
  hostname: "10.0.0.1",
  pingResult: {
    isOnline: true,
    failureCause: "",
    pingResponse: {
      packetsSent: 5,
      packetsReceived: 4,
      packetLossPercent: 20,
      minRoundTripTimeInMs: 10.2,
      maxRoundTripTimeInMs: 20.1,
      avgRoundTripTimeInMs: 12.44,
      jitterInMs: 1.2,
    },
  },
} as Partial<NetworkDeviceDiagnostic>);

describe("the on-demand ping result", () => {
  const PING_ROWS: Array<[string, NetworkDeviceMetric]> = [
    ["Average RTT", "pingAverageRtt"],
    ["Min / Max RTT", "pingMinMaxRtt"],
    ["Jitter", "pingJitter"],
    ["Packet loss", "pingPacketLoss"],
  ];

  test("each statistic row has an (i); the Host row does not", async () => {
    const result: HTMLElement = await runPing(COMPLETED_PING);

    expect(result).toHaveTextContent("10.0.0.1");
    expect(infoButtonNames(result)).toEqual(
      PING_ROWS.map(([label]: [string, NetworkDeviceMetric]): string => {
        return `About ${label}`;
      }),
    );
  });

  test.each(PING_ROWS)(
    "the %s row's (i) reads NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    async (label: string, key: NetworkDeviceMetric) => {
      await runPing(COMPLETED_PING);

      await expectExplained(label, DESCRIPTIONS[key]);
    },
  );

  test("the (i) sits in the term, beside its label, not in the value", async () => {
    const result: HTMLElement = await runPing(COMPLETED_PING);
    const info: HTMLElement = within(result).getByRole("button", {
      name: "About Jitter",
    });

    expect(info.closest("dt")).toHaveTextContent("Jitter");
    expect(info.closest("dd")).toBeNull();
    // The value still reads as it did.
    expect(result).toHaveTextContent("20% (4/5 received)");
  });

  test("a ping that could not run shows only its Reason, with no (i)", async () => {
    const result: HTMLElement = await runPing(
      diagnosticRow({
        status: "Completed",
        pingResult: {
          isOnline: false,
          failureCause: "ICMP is not usable on this probe.",
        },
      } as Partial<NetworkDeviceDiagnostic>),
    );

    expect(result).toHaveTextContent("ICMP is not usable on this probe.");
    expect(infoButtonNames(result)).toEqual([]);
  });
});

// -------------------------------------------------------- traceroute

describe("the traceroute hop table", () => {
  test("only the RTT header has an (i), and it explains the first-reply rule", async () => {
    render(
      <TracerouteHopsTable
        hops={[
          {
            hopNumber: 1,
            address: "10.0.0.1",
            hostName: "gw",
            roundTripTimeInMS: 0.8,
            isTimeout: false,
          },
          {
            hopNumber: 2,
            address: undefined,
            hostName: undefined,
            roundTripTimeInMS: undefined,
            isTimeout: true,
          },
        ]}
      />,
    );

    expect(infoButtonNames()).toEqual(["About RTT"]);
    expect(
      screen.getByRole("button", { name: "About RTT" }).closest("th"),
    ).toHaveTextContent("RTT");
    await expectExplained("RTT", DESCRIPTIONS.tracerouteRtt);
  });

  test("no hops, no table, no (i)", () => {
    const { container } = render(<TracerouteHopsTable hops={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

// ------------------------------------------------------- latency trend

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
  render(
    <MemoryRouter>
      <DeviceLatencyTrend networkDeviceId={new ObjectID(DEVICE_ID)} />
    </MemoryRouter>,
  );
  await flush();
}

describe("the latency trend", () => {
  test("the header and the loss line each have an (i)", async () => {
    fetchResultsMock.mockResolvedValue([
      aggregate([
        { time: "2026-09-15T10:00:00Z", value: 10 },
        { time: "2026-09-15T10:01:00Z", value: 30 },
      ]),
      aggregate([{ time: "2026-09-15T10:01:00Z", value: 50 }]),
    ]);

    await renderTrend();

    expect(infoButtonNames()).toEqual([
      "About Round-trip time, past hour",
      "About Packet loss (1h max)",
    ]);
    // The (i) adds no text: the lines read exactly as before.
    expect(
      screen.getByTestId("network-device-latency-summary"),
    ).toHaveTextContent("now 30.0 ms · avg 20.0 ms · max 30.0 ms");
    expect(screen.getByTestId("network-device-loss-summary").textContent).toBe(
      "Packet loss (1h max): 50%",
    );
  });

  test("the header's (i) explains now / avg / max as per-minute figures", async () => {
    fetchResultsMock.mockResolvedValue([
      aggregate([{ time: "2026-09-15T10:00:00Z", value: 10 }]),
      aggregate([]),
    ]);

    await renderTrend();

    await expectExplained(
      "Round-trip time, past hour",
      DESCRIPTIONS.latencyTrend,
    );
  });

  test("the loss line's (i) explains the worst minute of the hour", async () => {
    fetchResultsMock.mockResolvedValue([
      aggregate([{ time: "2026-09-15T10:00:00Z", value: 10 }]),
      aggregate([{ time: "2026-09-15T10:00:00Z", value: 0 }]),
    ]);

    await renderTrend();

    await expectExplained("Packet loss (1h max)", DESCRIPTIONS.packetLossPeak);
  });

  test("with no ping data there is no loss line, but the header keeps its (i)", async () => {
    fetchResultsMock.mockResolvedValue([aggregate([]), aggregate([])]);

    await renderTrend();

    expect(
      screen.getByText("No ping data in the last hour."),
    ).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(["About Round-trip time, past hour"]);
  });

  test("the (i) is not inside the Open metrics link", async () => {
    fetchResultsMock.mockResolvedValue([aggregate([]), aggregate([])]);

    await renderTrend();

    expect(
      screen
        .getByRole("button", { name: "About Round-trip time, past hour" })
        .closest("a"),
    ).toBeNull();
  });
});

// ------------------------------------------------------- top talkers

describe("FlowStatTile and FlowSectionTitle", () => {
  test("the stat tile shows its value and explains it", async () => {
    render(
      <FlowStatTile
        title="Flows"
        value="1,204"
        description={DESCRIPTIONS.flowCount}
      />,
    );

    expect(screen.getByText("1,204")).toBeInTheDocument();
    await expectExplained("Flows", DESCRIPTIONS.flowCount);
  });

  test("the section title explains its block", async () => {
    render(
      <FlowSectionTitle
        title="Bandwidth Over Time"
        description={DESCRIPTIONS.flowBandwidth}
      />,
    );

    expect(screen.getByText("Bandwidth Over Time")).toBeInTheDocument();
    await expectExplained("Bandwidth Over Time", DESCRIPTIONS.flowBandwidth);
  });
});

function topTalkersResponse(): unknown {
  return {
    data: {
      totalOctets: 5 * 1024 * 1024,
      totalPackets: 4200,
      totalFlows: 37,
      topSources: [{ key: "10.0.0.5", octets: 3000, packets: 20 }],
      topDestinations: [{ key: "10.0.0.9", octets: 2000, packets: 10 }],
      topProtocolPorts: [
        { protocolNumber: 6, destinationPort: 443, octets: 5000, packets: 30 },
      ],
      topConversations: [
        {
          sourceIp: "10.0.0.5",
          destinationIp: "10.0.0.9",
          octets: 1000,
          packets: 5,
        },
      ],
      series: [{ time: "2026-09-24T11:00:00Z", octets: 60000, packets: 50 }],
      seriesBucketSeconds: 60,
      windowStartAt: "2026-09-24T11:00:00.000Z",
      windowEndAt: "2026-09-24T12:00:00.000Z",
    },
  };
}

describe("the Traffic tab's top talkers", () => {
  const FLOW_TITLES: Array<[string, NetworkDeviceMetric]> = [
    ["Total Traffic", "flowTotalTraffic"],
    ["Packets", "flowPackets"],
    ["Flows", "flowCount"],
    ["Bandwidth Over Time", "flowBandwidth"],
    ["Top Sources", "flowTopSources"],
    ["Top Destinations", "flowTopDestinations"],
    ["Top Conversations", "flowTopConversations"],
    ["Top Protocols & Ports", "flowTopProtocolsPorts"],
  ];

  test("every total, the chart and every top-N table carry an (i)", async () => {
    apiPostMock.mockResolvedValue(topTalkersResponse());

    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();

    expect(screen.getByText("5.00 MB")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(
      FLOW_TITLES.map(([title]: [string, NetworkDeviceMetric]): string => {
        return `About ${title}`;
      }),
    );
  });

  test.each(FLOW_TITLES)(
    "the %s (i) reads NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: NetworkDeviceMetric) => {
      apiPostMock.mockResolvedValue(topTalkersResponse());

      render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
      await flush();

      await expectExplained(title, DESCRIPTIONS[key]);
    },
  );

  test("no flow data yet: the setup hint, and no numbers to explain", async () => {
    apiPostMock.mockResolvedValue({
      data: { totalOctets: 0, totalPackets: 0, totalFlows: 0 },
    });

    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();

    expect(screen.getByText("No flow data yet.")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual([]);
  });

  test("the query is the card's own window, which the texts call the selected range", async () => {
    apiPostMock.mockResolvedValue(topTalkersResponse());

    render(<FlowTopTalkers networkDeviceId={new ObjectID(DEVICE_ID)} />);
    await flush();

    const request: { data: Record<string, unknown> } = apiPostMock.mock
      .calls[0]![0] as { data: Record<string, unknown> };

    expect(request.data["networkDeviceId"]).toBe(DEVICE_ID);
    expect(request.data["projectId"]).toBe(PROJECT_ID);
    expect(typeof request.data["startTime"]).toBe("string");
    expect(typeof request.data["endTime"]).toBe("string");
    expect(DESCRIPTIONS.flowTotalTraffic).toContain("the selected range");
  });
});
