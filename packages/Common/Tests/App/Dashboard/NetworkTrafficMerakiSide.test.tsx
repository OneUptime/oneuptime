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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Traffic page's Meraki side (issue #5140), rendered through the page
 * itself (NetworkTrafficView), as a reader meets it:
 *
 *   - which side it opens on: its flows when it has any, as before; Meraki
 *     when Meraki read its traffic and nothing else did; a switch in the
 *     header between the two, kept in the address bar;
 *   - what the Meraki side shows: the same four numbers and chart, the
 *     busiest networks or uplinks, applications, clients and destinations,
 *     how the connection is doing, and why there are no conversations;
 *   - a click on a network narrows the page, a chip says so;
 *   - the network's page without any traffic offers to connect Meraki.
 *
 * The network (both summaries) and the range picker are replaced; the
 * chart is ChartZoomStandIn.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const NOW: Date = new Date("2026-10-01T12:00:00.000Z");

const flowPostMock: MockFunction = getJestMockFunction();
const usagePostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
    }): React.ReactElement => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
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
        if (
          String((args[0] as { url?: unknown } | undefined)?.url).includes(
            "/usage-summary",
          )
        ) {
          return usagePostMock(...args);
        }

        return flowPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import NetworkTrafficView, {
  NetworkTrafficScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView";
import { resetStandInCharts } from "./ChartZoomStandIn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

interface UsageRequest {
  networkDeviceId?: string | undefined;
  networkSiteId?: string | undefined;
  startTime: string;
  endTime: string;
  filters?: Record<string, unknown> | undefined;
}

function flows(overrides: JSONObject = {}): JSONObject {
  return {
    windowStartAt: "2026-10-01T11:00:00.000Z",
    windowEndAt: "2026-10-01T12:00:00.000Z",
    bucketSeconds: 60,
    totals: { octets: 600_000_000, packets: 500_000, flows: 1200 },
    maxSamplingRate: 1,
    series: [{ time: "2026-10-01 11:00:00", octets: 600_000_000 }],
    topSources: [{ ip: "10.0.0.5", octets: 600_000_000, packets: 500_000 }],
    topDestinations: [],
    topConversations: [],
    topApplications: [],
    topInterfaces: [],
    topDevices: [],
    sources: [
      {
        exporterIp: "10.0.0.1",
        networkDeviceId: DEVICE_ID,
        deviceName: "core-router",
        flowFormat: "netflow-v9",
        octets: 600_000_000,
        flows: 1200,
        lastFlowAt: "2026-10-01 11:59:30",
      },
    ],
    lastFlowAt: "2026-10-01 11:59:30",
    ...overrides,
  };
}

// A page nothing sends flow records to.
function noFlows(): JSONObject {
  return flows({
    totals: { octets: 0, packets: 0, flows: 0 },
    series: [],
    topSources: [],
    sources: [],
    lastFlowAt: null,
  });
}

function usage(overrides: JSONObject = {}): JSONObject {
  return {
    isAvailable: true,
    windowStartAt: "2026-10-01T11:00:00.000Z",
    windowEndAt: "2026-10-01T12:00:00.000Z",
    bucketSeconds: 300,
    totals: { sentOctets: 30_000_000, receivedOctets: 150_000_000, flows: 180 },
    primaryKind: "uplink",
    applicationTotals: { sentOctets: 3_600_000, receivedOctets: 10_800_000 },
    clientTotals: { sentOctets: 1_000_000, receivedOctets: 4_000_000 },
    series: [
      {
        time: "2026-10-01T11:00:00.000Z",
        sentOctets: 15_000_000,
        receivedOctets: 75_000_000,
      },
      {
        time: "2026-10-01T11:30:00.000Z",
        sentOctets: 15_000_000,
        receivedOctets: 75_000_000,
      },
    ],
    topNetworks: [
      {
        controllerNetworkId: "L_1000",
        name: "Branch 1",
        sentOctets: 20_000_000,
        receivedOctets: 100_000_000,
      },
      {
        controllerNetworkId: "L_1001",
        name: "Branch 2",
        sentOctets: 10_000_000,
        receivedOctets: 50_000_000,
      },
    ],
    topUplinks: [
      {
        deviceSerial: "Q2XX-AAAA-0000",
        deviceName: "MX 1",
        controllerNetworkId: "L_1000",
        controllerNetworkName: "Branch 1",
        interfaceName: "wan1",
        sentOctets: 20_000_000,
        receivedOctets: 100_000_000,
        networkDeviceId: DEVICE_ID,
      },
    ],
    topApplications: [
      {
        application: "Microsoft Teams",
        sentOctets: 3_600_000,
        receivedOctets: 10_800_000,
        flows: 180,
      },
    ],
    topDestinations: [
      {
        destination: "teams.microsoft.com",
        application: "Microsoft Teams",
        sentOctets: 3_600_000,
        receivedOctets: 10_800_000,
      },
    ],
    topClients: [
      {
        clientKey: "k74272e",
        name: "Kiosk 3",
        ip: "10.0.0.25",
        mac: "22:33:44:55:66:77",
        manufacturer: "Apple",
        controllerNetworkName: "Branch 1",
        sentOctets: 1_000_000,
        receivedOctets: 4_000_000,
      },
    ],
    lastUplinkAt: "2026-10-01T11:55:00.000Z",
    lastAnalyticsAt: "2026-10-01T10:00:00.000Z",
    connections: [
      {
        id: "c1",
        name: "Acme Retail",
        provider: "meraki",
        organizationName: "Acme Retail",
        status: "healthy",
        readIntervalInMinutes: 5,
        lastPulledAt: "2026-10-01T11:58:00.000Z",
        lastSuccessfulPullAt: "2026-10-01T11:58:00.000Z",
      },
    ],
    ...overrides,
  };
}

function answerFlows(answer: JSONObject): void {
  flowPostMock.mockImplementation(async () => {
    return { data: answer };
  });
}

function answerUsage(answer: (request: UsageRequest) => JSONObject): void {
  usagePostMock.mockImplementation(async (args: unknown) => {
    return { data: answer((args as { data: UsageRequest }).data) };
  });
}

function lastUsageRequest(): UsageRequest {
  const calls: Array<Array<unknown>> = usagePostMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];

  if (!last) {
    throw new Error("The Meraki side was never fetched");
  }

  return (last[0] as { data: UsageRequest }).data;
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderView(scope: NetworkTrafficScope): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTrafficView scope={scope} />
    </MemoryRouter>,
  );
  await flush();
}

function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function sideButton(side: "flows" | "meraki"): HTMLElement {
  return within(screen.getByTestId("traffic-source-switch")).getByTestId(
    `traffic-source-${side}`,
  );
}

function rowsOf(listTestId: string): Array<HTMLElement> {
  return within(screen.getByTestId(listTestId)).getAllByTestId(
    `${listTestId}-row`,
  );
}

const NETWORK: NetworkTrafficScope = { kind: "network" };
const DEVICE: NetworkTrafficScope = {
  kind: "device",
  networkDeviceId: new ObjectID(DEVICE_ID),
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState(null, "", "/");
  flowPostMock.mockReset();
  usagePostMock.mockReset();
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 100 };
  });
  resetStandInCharts();
  answerFlows(flows());
  answerUsage(() => {
    return { isAvailable: false };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("which side a page opens on", () => {
  test("a page Meraki has no traffic of is as it was: no switch, its flows", async () => {
    await renderView(DEVICE);

    expect(screen.queryByTestId("traffic-source-switch")).toBeNull();
    expect(screen.getByTestId("traffic-body")).toBeInTheDocument();
    expect(lastUsageRequest().networkDeviceId).toBe(DEVICE_ID);
  });

  test("a page with flows and Meraki traffic opens on its flows, with the switch", async () => {
    answerUsage(() => {
      return usage();
    });

    await renderView(NETWORK);

    expect(sideButton("flows")).toHaveAttribute("aria-pressed", "true");
    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("traffic-body")).toBeInTheDocument();
    expect(screen.queryByTestId("meraki-traffic-body")).toBeNull();
  });

  test("a page with Meraki traffic and no flow records opens on Meraki", async () => {
    answerFlows(noFlows());
    answerUsage(() => {
      return usage();
    });

    await renderView(NETWORK);

    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("meraki-traffic-body")).toBeInTheDocument();
    expect(screen.queryByTestId("traffic-setup-guide")).toBeNull();
  });

  test("the switch picks a side and the address bar keeps it", async () => {
    answerUsage(() => {
      return usage();
    });

    await renderView(NETWORK);
    fireEvent.click(sideButton("meraki"));
    await flush();

    expect(query().get("source")).toBe("meraki");
    expect(screen.getByTestId("meraki-traffic-body")).toBeInTheDocument();

    fireEvent.click(sideButton("flows"));
    await flush();

    expect(query().get("source")).toBe("flows");
    expect(screen.getByTestId("traffic-body")).toBeInTheDocument();
  });

  test("a link to the Meraki side opens on it", async () => {
    window.history.replaceState(null, "", "/?source=meraki&mnet=L_1001");
    answerUsage(() => {
      return usage();
    });

    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-traffic-body")).toBeInTheDocument();
    expect(lastUsageRequest().filters).toEqual({
      controllerNetworkId: "L_1001",
    });
    expect(screen.getByTestId("meraki-filter-network")).toHaveTextContent(
      "Network Branch 2",
    );
  });
});

describe("the Meraki side", () => {
  beforeEach(() => {
    answerFlows(noFlows());
    answerUsage(() => {
      return usage();
    });
  });

  test("the numbers, the chart, the lists - and why there are no conversations", async () => {
    await renderView(NETWORK);

    expect(screen.getByTestId("traffic-tile-total-value")).toHaveTextContent(
      "180 MB",
    );
    expect(screen.getByTestId("traffic-tile-flows-value")).toHaveTextContent(
      "180",
    );
    expect(screen.getByTestId("traffic-over-time-chart")).toBeInTheDocument();
    expect(rowsOf("meraki-top-networks")).toHaveLength(2);
    expect(rowsOf("meraki-top-applications")[0]).toHaveTextContent(
      "Microsoft Teams",
    );
    expect(rowsOf("meraki-top-clients")[0]).toHaveTextContent("Kiosk 3");
    expect(rowsOf("meraki-top-clients")[0]).toHaveTextContent(
      "10.0.0.25 · 22:33:44:55:66:77 · Apple · Branch 1",
    );
    expect(rowsOf("meraki-top-destinations")[0]).toHaveTextContent(
      "teams.microsoft.com",
    );
    expect(screen.getByTestId("meraki-conversations-note")).toHaveTextContent(
      "The Meraki dashboard API reports totals, not conversations",
    );
  });

  test("how the connection is doing, one line over its traffic", async () => {
    answerUsage(() => {
      return usage({
        connections: [
          {
            id: "c1",
            name: "Acme Retail",
            organizationName: "Acme Retail",
            status: "healthy",
            readIntervalInMinutes: 5,
            lastSuccessfulPullAt: "2026-10-01T11:58:00.000Z",
          },
          {
            id: "c2",
            name: "Acme Campus",
            organizationName: "Acme Campus",
            status: "failing",
            readIntervalInMinutes: 5,
            lastPulledAt: "2026-10-01T11:58:00.000Z",
            lastError:
              "Meraki answered the organization with HTTP 401: Invalid API key",
          },
        ],
      });
    });

    await renderView(NETWORK);

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-connection-line",
    );
    // The one to act on first.
    expect(lines[0]).toHaveAttribute("data-status", "failing");
    expect(lines[0]).toHaveTextContent("Acme Campus");
    expect(
      within(lines[0]!).getByTestId("meraki-connection-line-detail"),
    ).toHaveTextContent("HTTP 401: Invalid API key");
    expect(lines[1]).toHaveAttribute("data-status", "healthy");
  });

  test("a click on a network narrows the page; the chip's x widens it again", async () => {
    await renderView(NETWORK);

    fireEvent.click(rowsOf("meraki-top-networks")[1]!);
    await flush();

    expect(lastUsageRequest().filters).toEqual({
      controllerNetworkId: "L_1001",
    });
    expect(query().get("mnet")).toBe("L_1001");
    expect(screen.getByTestId("meraki-filter-network")).toHaveTextContent(
      "Network Branch 2",
    );

    fireEvent.click(
      within(screen.getByTestId("meraki-filter-network")).getByRole("button"),
    );
    await flush();

    expect(lastUsageRequest().filters).toEqual({});
    expect(query().get("mnet")).toBeNull();
  });

  test("a branch's page lists its uplinks, and an MX that is a device links to it", async () => {
    answerUsage(() => {
      return usage({
        topNetworks: [
          {
            controllerNetworkId: "L_1000",
            name: "Branch 1",
            sentOctets: 20_000_000,
            receivedOctets: 100_000_000,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-top-networks")).toBeNull();
    const uplink: HTMLElement = rowsOf("meraki-top-uplinks")[0]!;
    expect(uplink).toHaveTextContent("wan1");
    expect(uplink).toHaveTextContent("MX 1 · Branch 1");
    expect(
      within(screen.getByTestId("meraki-top-uplinks")).getByText("Open MX 1"),
    ).toBeInTheDocument();
  });

  test("a device's page reads that device, and its rows are not filters", async () => {
    answerUsage(() => {
      return usage();
    });

    await renderView(DEVICE);

    expect(lastUsageRequest().networkDeviceId).toBe(DEVICE_ID);
    expect(screen.getByTestId("meraki-traffic-body")).toBeInTheDocument();
    // A device's page lists its uplinks, never a network to narrow to.
    expect(screen.queryByTestId("meraki-top-networks")).toBeNull();
    expect(
      within(rowsOf("meraki-top-uplinks")[0]!).queryByRole("button"),
    ).toBeNull();
  });

  test("before the first read: waiting, never 'no traffic'", async () => {
    answerUsage(() => {
      return usage({
        totals: { sentOctets: 0, receivedOctets: 0, flows: 0 },
        applicationTotals: { sentOctets: 0, receivedOctets: 0 },
        clientTotals: { sentOctets: 0, receivedOctets: 0 },
        series: [],
        topNetworks: [],
        topUplinks: [],
        topApplications: [],
        topDestinations: [],
        topClients: [],
        lastUplinkAt: null,
        lastAnalyticsAt: null,
        connections: [
          {
            id: "c1",
            name: "Acme Retail",
            organizationName: "Acme Retail",
            status: "waiting",
            readIntervalInMinutes: 5,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-waiting")).toHaveTextContent(
      "Waiting for the first read from Meraki.",
    );
    expect(screen.queryByTestId("meraki-no-data")).toBeNull();
    // The page says it waits: a line that only waits too is not drawn.
    expect(screen.queryByTestId("meraki-connection-line")).toBeNull();
  });

  test("Set up NetFlow goes to the flow side", async () => {
    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("meraki-set-up-netflow"));
    await flush();

    expect(query().get("source")).toBe("flows");
    expect(screen.queryByTestId("meraki-traffic-body")).toBeNull();
  });
});

describe("the network's page without any traffic", () => {
  test("its set-up guide offers to connect Meraki, which opens the connect dialog", async () => {
    answerFlows(noFlows());

    await renderView(NETWORK);

    expect(screen.getByTestId("traffic-setup-meraki")).toHaveTextContent(
      "Using Cisco Meraki?",
    );
    fireEvent.click(screen.getByTestId("traffic-setup-connect-meraki"));
    await flush();

    expect(screen.getByTestId("meraki-connect")).toBeInTheDocument();
  });

  test("a device's guide does not: a device's traffic comes from its flows", async () => {
    answerFlows(noFlows());

    await renderView(DEVICE);

    expect(screen.queryByTestId("traffic-setup-meraki")).toBeNull();
  });
});
