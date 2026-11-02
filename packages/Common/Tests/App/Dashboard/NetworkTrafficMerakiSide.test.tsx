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
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A Traffic page's Meraki side (issue #5140), rendered through the page
 * itself (NetworkTrafficView), as a reader meets it:
 *
 *   - which side it opens on: its flows when it has any, as before; Meraki
 *     when Meraki read its traffic and nothing else did; a switch in the
 *     header between the two, kept in the address bar;
 *   - what the Meraki side shows: the same four numbers and chart, the
 *     busiest networks or uplinks, applications, clients and destinations,
 *     how the connection is doing, and who talks to whom as far as Meraki
 *     says;
 *   - a click on a network narrows the page, a chip says so;
 *   - the page's uplinks side by side (issue #5377): what each carried, its
 *     average and peak, its loss and latency, and a click that narrows the
 *     whole page to that one uplink - never to the appliance with both;
 *   - the numbers stop where the reads did: no line falling to zero at the
 *     right edge, no average of a stretch nobody has reported yet;
 *   - a line over the traffic that needs acting on says Review;
 *   - rows never repeat the one network (or the one appliance) the page is
 *     of, and host names are drawn as text, addresses in the monospace;
 *   - the network's page without any traffic offers to connect Meraki in
 *     its set-up guide, one with flow records at its foot - and a reader
 *     who may not connect is told why there is no button.
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
  FLOW_DESCRIPTIONS,
  NetworkTrafficScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView";
import { getStandInChart, resetStandInCharts } from "./ChartZoomStandIn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

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

// What PermissionGate answers about connecting Meraki (owners and admins may).
let connectGate: PermissionGateResult;

const MAY_NOT_CONNECT: string =
  "You do not have permission to create this Meraki connection. You need one of these permissions: Project Owner, Project Admin.";

// A connection whose key Meraki refused, as the page's summary says it.
const FAILING: JSONObject = {
  id: "c2",
  name: "Acme Campus",
  organizationName: "Acme Campus",
  status: "failing",
  readIntervalInMinutes: 5,
  lastPulledAt: "2026-10-01T11:58:00.000Z",
  lastError: "Meraki answered the organization with HTTP 401: Invalid API key",
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
  connectGate = { isAllowed: true };
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return connectGate;
    },
  );
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

  test("the numbers, the chart, the lists - and what Meraki cannot say of who talks to whom", async () => {
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
    // A named client: its address, maker and network - its MAC is not needed.
    expect(rowsOf("meraki-top-clients")[0]).toHaveTextContent(
      "10.0.0.25 · Apple · Branch 1",
    );
    expect(rowsOf("meraki-top-clients")[0]).not.toHaveTextContent(
      "22:33:44:55:66:77",
    );
    expect(rowsOf("meraki-top-destinations")[0]).toHaveTextContent(
      "teams.microsoft.com",
    );
    // A host name is text; addresses are drawn in the monospace font.
    expect(
      within(rowsOf("meraki-top-destinations")[0]!).getByText(
        "teams.microsoft.com",
      ),
    ).not.toHaveClass("font-mono");
    expect(screen.getByTestId("meraki-conversations-note")).toHaveTextContent(
      "Meraki reports what each network reached, never which client talked to it.",
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
    // The page is of one network: its rows never repeat it.
    expect(uplink).toHaveTextContent("MX 1");
    expect(uplink).not.toHaveTextContent("Branch 1");
    expect(rowsOf("meraki-top-clients")[0]).toHaveTextContent(
      "10.0.0.25 · Apple",
    );
    expect(rowsOf("meraki-top-clients")[0]).not.toHaveTextContent("Branch 1");
    expect(
      within(screen.getByTestId("meraki-top-uplinks")).getByText("Open MX 1"),
    ).toBeInTheDocument();
  });

  test("a device's page reads that device, and lists its uplinks", async () => {
    answerUsage(() => {
      return usage();
    });

    await renderView(DEVICE);

    expect(lastUsageRequest().networkDeviceId).toBe(DEVICE_ID);
    expect(screen.getByTestId("meraki-traffic-body")).toBeInTheDocument();
    // A device's page lists its uplinks, never a network to narrow to.
    expect(screen.queryByTestId("meraki-top-networks")).toBeNull();
    // Its own uplinks: the appliance is the page's, and is not named again.
    expect(rowsOf("meraki-top-uplinks")[0]).not.toHaveTextContent("MX 1");
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

    expect(screen.getByTestId("meraki-conversations-note")).toHaveTextContent(
      "Turn on NetFlow on the MX appliances to see every conversation, address to address, with its packets.",
    );
    expect(screen.queryByTestId("meraki-show-conversations")).toBeNull();

    fireEvent.click(screen.getByTestId("meraki-set-up-netflow"));
    await flush();

    expect(query().get("source")).toBe("flows");
    expect(screen.queryByTestId("meraki-traffic-body")).toBeNull();
  });

  test("a page with flow records too: Who talks to whom offers its own conversations", async () => {
    window.history.replaceState(null, "", "/?source=meraki");
    answerFlows(flows());

    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-conversations-note")).toHaveTextContent(
      "Meraki reports what each network reached, never which client talked to it. This page's flow records have every conversation, address to address, with its packets.",
    );
    expect(screen.queryByTestId("meraki-set-up-netflow")).toBeNull();

    fireEvent.click(screen.getByTestId("meraki-show-conversations"));
    await flush();

    expect(query().get("source")).toBe("flows");
    expect(screen.getByTestId("traffic-body")).toBeInTheDocument();
  });

  test("a line to act on says Review: to the connections below on the network's page", async () => {
    answerUsage(() => {
      return usage({
        connections: [
          FAILING,
          {
            id: "c1",
            name: "Acme Retail",
            organizationName: "Acme Retail",
            status: "healthy",
            readIntervalInMinutes: 5,
            lastSuccessfulPullAt: "2026-10-01T11:58:00.000Z",
          },
        ],
      });
    });

    await renderView(NETWORK);

    const [failing, healthy]: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-connection-line",
    );
    expect(
      within(failing!).getByTestId("meraki-connection-line-review"),
    ).toHaveAttribute("href", "#traffic-meraki-connections");
    // A line that needs nothing has nothing to review.
    expect(
      within(healthy!).queryByTestId("meraki-connection-line-review"),
    ).toBeNull();
  });

  test("on a device's page, Review goes to the network's page, where the connections are", async () => {
    answerUsage(() => {
      return usage({ connections: [FAILING] });
    });

    await renderView(DEVICE);

    const review: HTMLElement = screen.getByTestId(
      "meraki-connection-line-review",
    );
    expect(review.closest("a")).toHaveAttribute(
      "href",
      "/dashboard/10000000-0000-4000-8000-000000000001/network-devices/traffic",
    );
  });

  test("an empty range after the reads stopped says when the newest traffic is - not that Meraki keeps 30 days", async () => {
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
        lastUplinkAt: "2026-10-01T09:00:00.000Z",
        lastAnalyticsAt: "2026-10-01T08:00:00.000Z",
        connections: [
          {
            id: "c1",
            name: "Acme Retail",
            organizationName: "Acme Retail",
            status: "stale",
            readIntervalInMinutes: 5,
            lastSuccessfulPullAt: "2026-10-01T09:00:00.000Z",
          },
        ],
      });
    });

    await renderView(NETWORK);

    const empty: HTMLElement = screen.getByTestId("meraki-no-data");
    expect(empty).toHaveTextContent(
      "The newest traffic is from 3 hours ago. Pick a longer time range to see it.",
    );
    expect(empty).not.toHaveTextContent("30 days");
  });

  test("an empty range of a connection still reading: Meraki keeps 30 days", async () => {
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
        lastUplinkAt: "2026-10-01T11:55:00.000Z",
      });
    });

    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-no-data")).toHaveTextContent(
      "Meraki keeps traffic for 30 days: pick a longer time range to see older traffic.",
    );
  });
});

describe("the page's uplinks, side by side (issue #5377)", () => {
  const TWO_UPLINKS: JSONObject = {
    uplinkInterfaces: [
      {
        interfaceName: "wan2",
        applianceCount: 3,
        sentOctets: 1_000_000,
        receivedOctets: 9_000_000,
        lossPercent: 1.5,
        latencyMs: 41.6,
      },
      {
        interfaceName: "wan1",
        applianceCount: 12,
        sentOctets: 20_000_000,
        receivedOctets: 150_000_000,
        lossPercent: 0,
        latencyMs: 21.4,
      },
    ],
    uplinkSeries: [
      {
        time: "2026-10-01T11:00:00.000Z",
        interfaceName: "wan1",
        sentOctets: 10_000_000,
        receivedOctets: 75_000_000,
        lossPercent: 0,
        latencyMs: 20,
      },
      {
        time: "2026-10-01T11:00:00.000Z",
        interfaceName: "wan2",
        sentOctets: 500_000,
        receivedOctets: 4_500_000,
        lossPercent: 1.5,
        latencyMs: 40,
      },
      {
        time: "2026-10-01T11:05:00.000Z",
        interfaceName: "wan1",
        sentOctets: 10_000_000,
        receivedOctets: 75_000_000,
        lossPercent: null,
        latencyMs: null,
      },
    ],
  };

  function cell(row: HTMLElement, name: string): HTMLElement {
    return within(row).getByTestId(`meraki-uplink-row-${name}`);
  }

  function uplinkRows(): Array<HTMLElement> {
    return screen.getAllByTestId("meraki-uplink-row");
  }

  beforeEach(() => {
    answerFlows(noFlows());
    answerUsage(() => {
      return usage(TWO_UPLINKS);
    });
  });

  test("each uplink's traffic, share, average, peak, latency and loss, wan1 first however much it carried", async () => {
    await renderView(NETWORK);

    const [wan1, wan2]: Array<HTMLElement> = uplinkRows() as [
      HTMLElement,
      HTMLElement,
    ];

    expect(cell(wan1, "name")).toHaveTextContent("wan1");
    expect(cell(wan1, "share")).toHaveTextContent("94%");
    expect(cell(wan1, "traffic")).toHaveTextContent("170 MB");
    expect(wan1).toHaveTextContent("In 150 MB · out 20.0 MB");
    expect(cell(wan1, "appliances")).toHaveTextContent("On 12 appliances");
    expect(cell(wan1, "latency")).toHaveTextContent("21");
    expect(cell(wan1, "loss")).toHaveTextContent("0%");
    // The busiest bucket: 85 MB in five minutes.
    expect(cell(wan1, "peak")).toHaveTextContent("2.27 Mbps");

    expect(cell(wan2, "name")).toHaveTextContent("wan2");
    expect(cell(wan2, "share")).toHaveTextContent("6%");
    expect(cell(wan2, "latency")).toHaveTextContent("42");
    expect(cell(wan2, "loss")).toHaveTextContent("1.5%");
  });

  test("the bug this fixes: a click on wan1 in the Uplinks list narrows to wan1, and wan2 stays out of it", async () => {
    answerUsage(() => {
      return usage({
        ...TWO_UPLINKS,
        topNetworks: [
          {
            controllerNetworkId: "L_1000",
            name: "Branch 1",
            sentOctets: 1,
            receivedOctets: 1,
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
          },
          {
            deviceSerial: "Q2XX-AAAA-0000",
            deviceName: "MX 1",
            controllerNetworkId: "L_1000",
            controllerNetworkName: "Branch 1",
            interfaceName: "wan2",
            sentOctets: 1,
            receivedOctets: 1,
          },
        ],
      });
    });

    await renderView(NETWORK);

    fireEvent.click(rowsOf("meraki-top-uplinks")[0]!);
    await flush();

    expect(lastUsageRequest().filters).toEqual({
      controllerNetworkId: "L_1000",
      deviceSerial: "Q2XX-AAAA-0000",
      interfaceName: "wan1",
    });
    expect(query().get("mup")).toBe("wan1");

    const [wan1, wan2]: Array<HTMLElement> = rowsOf("meraki-top-uplinks") as [
      HTMLElement,
      HTMLElement,
    ];

    expect(wan1).toHaveAttribute("aria-pressed", "true");
    expect(wan2).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("meraki-filter-uplink")).toHaveTextContent(
      "Uplink wan1",
    );
    expect(screen.getByTestId("meraki-filter-appliance")).toHaveTextContent(
      "Appliance MX 1",
    );
  });

  test("a click on an uplink narrows the page to it by name; the others stay listed, and it widens again", async () => {
    await renderView(NETWORK);

    fireEvent.click(uplinkRows()[1]!);
    await flush();

    expect(lastUsageRequest().filters).toEqual({ interfaceName: "wan2" });
    expect(query().get("mup")).toBe("wan2");
    expect(uplinkRows()).toHaveLength(2);
    expect(uplinkRows()[1]).toHaveAttribute("aria-pressed", "true");
    expect(uplinkRows()[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(uplinkRows()[1]!);
    await flush();

    expect(lastUsageRequest().filters).toEqual({});
    expect(query().get("mup")).toBeNull();
  });

  test("a link to an uplink opens on it", async () => {
    window.history.replaceState(null, "", "/?mup=wan2");

    await renderView(NETWORK);

    expect(lastUsageRequest().filters).toEqual({ interfaceName: "wan2" });
    expect(screen.getByTestId("meraki-filter-uplink")).toHaveTextContent(
      "Uplink wan2",
    );
  });

  test("the chip's x widens the page, and keeps the network", async () => {
    window.history.replaceState(null, "", "/?mnet=L_1000&mup=wan2");

    await renderView(NETWORK);

    fireEvent.click(
      within(screen.getByTestId("meraki-filter-uplink")).getByRole("button"),
    );
    await flush();

    expect(lastUsageRequest().filters).toEqual({
      controllerNetworkId: "L_1000",
    });
  });

  test("narrowed to an uplink, a click on a network keeps it: wan2's busiest sites, then one of them", async () => {
    window.history.replaceState(null, "", "/?mup=wan2");

    await renderView(NETWORK);

    fireEvent.click(rowsOf("meraki-top-networks")[1]!);
    await flush();

    expect(lastUsageRequest().filters).toEqual({
      controllerNetworkId: "L_1001",
      interfaceName: "wan2",
    });
  });

  test("narrowed to an uplink, the page says its lists stay the network's, and the flows are not a false 0", async () => {
    window.history.replaceState(null, "", "/?mup=wan2");

    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-narrowed-note")).toHaveTextContent(
      "Meraki counts applications, destinations, clients and flows per network, so those stay the whole network's.",
    );
    expect(screen.getByTestId("traffic-tile-flows-value")).toHaveTextContent(
      "\u2014",
    );
  });

  test("not narrowed, there is no such note, and the flows are counted", async () => {
    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-narrowed-note")).toBeNull();
    expect(screen.getByTestId("traffic-tile-flows-value")).toHaveTextContent(
      "180",
    );
  });

  test("a device's page narrows by the uplink's name alone: the page is the appliance", async () => {
    answerUsage(() => {
      return usage(TWO_UPLINKS);
    });

    await renderView(DEVICE);

    expect(cellCount("appliances")).toBe(0);

    fireEvent.click(rowsOf("meraki-top-uplinks")[0]!);
    await flush();

    expect(lastUsageRequest().filters).toEqual({ interfaceName: "wan1" });
    expect(rowsOf("meraki-top-uplinks")[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  function cellCount(name: string): number {
    return screen.queryAllByTestId(`meraki-uplink-row-${name}`).length;
  }

  test("the chart draws a line an uplink, and switches to latency and to loss", async () => {
    await renderView(NETWORK);

    expect(
      getStandInChart("wan1 + wan2 [Mbps]").props.data[0]!.data,
    ).toHaveLength(12 - 1);

    fireEvent.click(screen.getByTestId("meraki-uplink-chart-latency"));
    await flush();

    expect(screen.getByTestId("meraki-uplink-chart-latency")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const latency: ReturnType<typeof getStandInChart> =
      getStandInChart("wan1 + wan2 [ms]");

    // Only the bucket measured: the next one is a gap, not a zero.
    expect(latency.props.data[0]!.data).toHaveLength(1);
    expect(latency.props.data[0]!.data[0]!.y).toBe(20);

    fireEvent.click(screen.getByTestId("meraki-uplink-chart-loss"));
    await flush();

    expect(getStandInChart("wan1 + wan2 [%]").props.data[1]!.data[0]!.y).toBe(
      1.5,
    );
  });

  test("a stretch nobody measured breaks the line; a stretch of no traffic does not", async () => {
    await renderView(NETWORK);

    expect(
      (
        getStandInChart("wan1 + wan2 [Mbps]").props as unknown as {
          connectNulls: boolean;
        }
      ).connectNulls,
    ).toBe(true);

    fireEvent.click(screen.getByTestId("meraki-uplink-chart-latency"));
    await flush();

    expect(
      (
        getStandInChart("wan1 + wan2 [ms]").props as unknown as {
          connectNulls: boolean;
        }
      ).connectNulls,
    ).toBe(false);
  });

  test("the bug this guards: on a range whose grid is finer than its buckets the line stays whole", async () => {
    answerUsage(() => {
      return usage({ ...TWO_UPLINKS, bucketSeconds: 720 });
    });

    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("meraki-uplink-chart-latency"));
    await flush();

    expect(
      (
        getStandInChart("wan1 + wan2 [ms]").props as unknown as {
          connectNulls: boolean;
        }
      ).connectNulls,
    ).toBe(true);
  });

  test("the chart joins the page's zoom", async () => {
    await renderView(NETWORK);

    expect(
      getStandInChart("wan1 + wan2 [Mbps]").zoom.onTimeRangeSelect,
    ).toBeDefined();
  });

  test("nothing measured: no latency or loss to switch to, no empty columns, the bytes still compare", async () => {
    answerUsage(() => {
      return usage({
        uplinkInterfaces: [
          {
            interfaceName: "wan1",
            applianceCount: 1,
            sentOctets: 5,
            receivedOctets: 5,
            lossPercent: null,
            latencyMs: null,
          },
          {
            interfaceName: "wan2",
            applianceCount: 1,
            sentOctets: 1,
            receivedOctets: 1,
            lossPercent: null,
            latencyMs: null,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-uplink-chart-modes")).toBeNull();
    expect(cellCount("latency")).toBe(0);
    expect(cellCount("loss")).toBe(0);
    expect(uplinkRows()).toHaveLength(2);
  });

  test("one uplink measured and one not: the other says it is unknown, not perfect", async () => {
    answerUsage(() => {
      return usage({
        uplinkInterfaces: [
          {
            interfaceName: "wan1",
            applianceCount: 1,
            sentOctets: 5,
            receivedOctets: 5,
            lossPercent: 0.2,
            latencyMs: 20,
          },
          {
            interfaceName: "wan2",
            applianceCount: 1,
            sentOctets: 1,
            receivedOctets: 1,
            lossPercent: null,
            latencyMs: null,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(cell(uplinkRows()[1]!, "latency")).toHaveTextContent("\u2014");
    expect(cell(uplinkRows()[1]!, "loss")).toHaveTextContent("\u2014");
  });

  test("a standby line that carried nothing is listed with its health, and no noise about its bytes", async () => {
    answerUsage(() => {
      return usage({
        uplinkInterfaces: [
          {
            interfaceName: "wan1",
            applianceCount: 1,
            sentOctets: 5,
            receivedOctets: 5,
            lossPercent: 0,
            latencyMs: 20,
          },
          {
            interfaceName: "cellular",
            applianceCount: 0,
            sentOctets: 0,
            receivedOctets: 0,
            lossPercent: 0,
            latencyMs: 71,
          },
        ],
      });
    });

    await renderView(NETWORK);

    const standby: HTMLElement = uplinkRows()[1]!;

    expect(cell(standby, "name")).toHaveTextContent("cellular");
    expect(cell(standby, "latency")).toHaveTextContent("71");
    expect(standby).not.toHaveTextContent("In 0 B");
    expect(within(standby).queryByTestId("meraki-uplink-row-appliances")).toBe(
      null,
    );
  });

  test("one uplink with nothing measured has nothing to compare: no card", async () => {
    answerUsage(() => {
      return usage({
        uplinkInterfaces: [
          {
            interfaceName: "wan1",
            applianceCount: 1,
            sentOctets: 5,
            receivedOctets: 5,
            lossPercent: null,
            latencyMs: null,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-uplink-comparison")).toBeNull();
  });

  test("an organization with no uplinks has no card", async () => {
    answerUsage(() => {
      return usage({
        primaryKind: "application",
        lastUplinkAt: null,
        uplinkInterfaces: [],
      });
    });

    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-uplink-comparison")).toBeNull();
  });

  test("before any traffic there is no card", async () => {
    answerUsage(() => {
      return usage({
        ...TWO_UPLINKS,
        totals: { sentOctets: 0, receivedOctets: 0, flows: 0 },
        applicationTotals: { sentOctets: 0, receivedOctets: 0 },
        clientTotals: { sentOctets: 0, receivedOctets: 0 },
        lastUplinkAt: null,
        lastAnalyticsAt: null,
      });
    });

    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-uplink-comparison")).toBeNull();
  });
});

describe("the numbers stop where the reads did (issue #5377)", () => {
  // The past hour, the newest uplink window ending 15 minutes before its end.
  const READ_TO_11_45: JSONObject = {
    totals: { sentOctets: 0, receivedOctets: 36_000_000, flows: 180 },
    lastUplinkAt: "2026-10-01T11:45:00.000Z",
    series: [
      {
        time: "2026-10-01T11:40:00.000Z",
        sentOctets: 0,
        receivedOctets: 3_000_000,
      },
    ],
  };

  beforeEach(() => {
    answerFlows(noFlows());
  });

  test("the bug this fixes: the chart ends at the last read, and never falls to zero after it", async () => {
    answerUsage(() => {
      return usage(READ_TO_11_45);
    });

    await renderView(NETWORK);

    const chart: ReturnType<typeof getStandInChart> =
      getStandInChart("In + Out [Mbps]");
    const points: Array<{ x: Date; y: number }> = chart.props.data[0]!
      .data as Array<{ x: Date; y: number }>;

    expect(points[points.length - 1]!.x.toISOString()).toBe(
      "2026-10-01T11:40:00.000Z",
    );
    expect(points[points.length - 1]!.y).toBeGreaterThan(0);
    // The axis still runs to the range's end: time passing, with no line.
    expect((chart.props.xAxis.options.max as Date).toISOString()).toBe(
      "2026-10-01T12:00:00.000Z",
    );
  });

  test("the bug this fixes: the average is of what was read, and the page says how far that is", async () => {
    answerUsage(() => {
      return usage(READ_TO_11_45);
    });

    await renderView(NETWORK);

    // 36 MB over the 45 minutes read: 107 kbps. Over the hour it would be 80.
    expect(screen.getByTestId("traffic-tile-average-value")).toHaveTextContent(
      "107 kbps",
    );
    expect(screen.getByTestId("meraki-read-up-to")).toHaveTextContent(
      "Read up to 15 minutes ago.",
    );
  });

  test("the bug this guards: a link that went down draws its drop, and its average counts the silence", async () => {
    // Traffic to 11:10, then nothing, and the reads went on to 11:55.
    answerUsage(() => {
      return usage({
        totals: { sentOctets: 0, receivedOctets: 36_000_000, flows: 180 },
        lastUplinkAt: "2026-10-01T11:10:00.000Z",
        uplinksReadTo: "2026-10-01T11:55:00.000Z",
        series: [
          {
            time: "2026-10-01T11:05:00.000Z",
            sentOctets: 0,
            receivedOctets: 3_000_000,
          },
        ],
      });
    });

    await renderView(NETWORK);

    const points: Array<{ x: Date; y: number }> = getStandInChart(
      "In + Out [Mbps]",
    ).props.data[0]!.data as Array<{ x: Date; y: number }>;
    const last: { x: Date; y: number } = points[points.length - 1]!;

    // The line reaches the last read, flat at zero: the outage, drawn.
    expect(last.x.toISOString()).toBe("2026-10-01T11:50:00.000Z");
    expect(last.y).toBe(0);
    // 36 MB over the 55 minutes read, not the 10 it carried.
    expect(screen.getByTestId("traffic-tile-average-value")).toHaveTextContent(
      "87.3 kbps",
    );
    expect(screen.getByTestId("meraki-read-up-to")).toHaveTextContent(
      "Read up to 5 minutes ago.",
    );
  });

  test("a range read to its end says nothing about it", async () => {
    answerUsage(() => {
      return usage({
        lastUplinkAt: "2026-10-01T12:00:00.000Z",
      });
    });

    await renderView(NETWORK);

    expect(screen.queryByTestId("meraki-read-up-to")).toBeNull();
  });
});

describe("who talks to whom", () => {
  const CONVERSATIONS: Array<JSONObject> = [
    {
      controllerNetworkId: "L_1000",
      controllerNetworkName: "Branch 1",
      destination: "teams.microsoft.com",
      application: "Microsoft Teams",
      protocol: "UDP",
      port: 3478,
      sentOctets: 1_000_000,
      receivedOctets: 9_000_000,
      flows: 1204,
      clients: 34,
    },
    {
      controllerNetworkId: "L_1001",
      controllerNetworkName: "Branch 2",
      destination: "52.112.0.10",
      application: "Microsoft Teams",
      protocol: "TCP",
      port: 443,
      sentOctets: 500_000,
      receivedOctets: 500_000,
      flows: 1,
      clients: 1,
    },
    {
      controllerNetworkId: "L_1001",
      controllerNetworkName: "Branch 2",
      destination: "",
      application: "Encrypted TCP (SSL)",
      protocol: "",
      port: 0,
      sentOctets: 100_000,
      receivedOctets: 100_000,
      flows: 0,
      clients: 0,
    },
  ];

  beforeEach(() => {
    answerFlows(noFlows());
    answerUsage(() => {
      return usage({ topConversations: CONVERSATIONS });
    });
  });

  test("what each network reached: over which protocol and port, for how many clients, which way and how much", async () => {
    await renderView(NETWORK);

    const row: HTMLElement = rowsOf("meraki-conversations")[0]!;

    expect(
      within(row).getByTestId("meraki-conversation-from"),
    ).toHaveTextContent("Branch 1");
    expect(within(row).getByTestId("meraki-conversation-to")).toHaveTextContent(
      "teams.microsoft.com",
    );
    expect(row).toHaveTextContent(
      "UDP port 3478 · Microsoft Teams · Up to 34 clients",
    );
    expect(row).toHaveTextContent("In 9.00 MB · out 1.00 MB · 1,204 flows");
    expect(row).toHaveTextContent("10.0 MB");
  });

  test("one client is one client, and one flow one flow", async () => {
    await renderView(NETWORK);

    const row: HTMLElement = rowsOf("meraki-conversations")[1]!;

    expect(row).toHaveTextContent("· 1 client");
    expect(row).toHaveTextContent("· 1 flow");
  });

  test("an address is in the addresses' font; a host name is text", async () => {
    await renderView(NETWORK);

    const [host, address]: Array<HTMLElement> = rowsOf(
      "meraki-conversations",
    ) as [HTMLElement, HTMLElement];

    expect(within(host).getByTestId("meraki-conversation-to")).not.toHaveClass(
      "font-mono",
    );
    expect(within(address).getByTestId("meraki-conversation-to")).toHaveClass(
      "font-mono",
    );
  });

  test("traffic Meraki names only by its application is listed by it, saying nothing it does not know", async () => {
    await renderView(NETWORK);

    const row: HTMLElement = rowsOf("meraki-conversations")[2]!;

    expect(within(row).getByTestId("meraki-conversation-to")).toHaveTextContent(
      "Encrypted TCP (SSL)",
    );
    expect(row).not.toHaveTextContent("clients");
    expect(row).not.toHaveTextContent("flows");
  });

  test("a page of one network does not name it on every row", async () => {
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
        topConversations: [CONVERSATIONS[0]!],
      });
    });

    await renderView(NETWORK);

    const row: HTMLElement = rowsOf("meraki-conversations")[0]!;

    expect(row).not.toHaveTextContent("Branch 1");
    expect(row).toHaveTextContent("teams.microsoft.com");
  });

  test("the bug this guards: narrowed to an uplink one network uses, rows of several still say which", async () => {
    window.history.replaceState(null, "", "/?mup=cellular");
    answerUsage(() => {
      return usage({
        topNetworks: [
          {
            controllerNetworkId: "L_1000",
            name: "Branch 1",
            sentOctets: 1,
            receivedOctets: 1,
          },
        ],
        topConversations: CONVERSATIONS,
        topClients: [
          {
            clientKey: "k1",
            name: "Kiosk 3",
            ip: "10.0.0.25",
            mac: "",
            manufacturer: "",
            controllerNetworkName: "Branch 1",
            sentOctets: 2,
            receivedOctets: 2,
          },
          {
            clientKey: "k2",
            name: "Kiosk 4",
            ip: "10.0.0.26",
            mac: "",
            manufacturer: "",
            controllerNetworkName: "Branch 2",
            sentOctets: 1,
            receivedOctets: 1,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(
      within(rowsOf("meraki-conversations")[0]!).getByTestId(
        "meraki-conversation-from",
      ),
    ).toHaveTextContent("Branch 1");
    expect(rowsOf("meraki-top-clients")[0]).toHaveTextContent("Branch 1");
    expect(rowsOf("meraki-top-clients")[1]).toHaveTextContent("Branch 2");
  });

  test("the rows' shares are of what Meraki's analytics counted, and they stay beside the way to the rest", async () => {
    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-set-up-netflow")).toBeInTheDocument();
    expect(screen.getByTestId("meraki-conversations-note")).toHaveTextContent(
      "Turn on NetFlow on the MX appliances to see every conversation, address to address, with its packets.",
    );
  });

  test("the card is as tall as its rows, not as tall as the page", async () => {
    await renderView(NETWORK);

    const card: HTMLElement = screen
      .getByTestId("meraki-conversations")
      .closest("[data-testid='card']") as HTMLElement;

    expect(card.className).not.toContain("h-full");
    // The lists beside each other still are, so a short one leaves no hole.
    expect(
      (
        screen
          .getByTestId("meraki-top-applications")
          .closest("[data-testid='card']") as HTMLElement
      ).className,
    ).toContain("h-full");
  });

  test("no rows, and no window of them ever read: where Meraki keeps them", async () => {
    answerUsage(() => {
      return usage({ topConversations: [], lastAnalyticsAt: null });
    });

    await renderView(NETWORK);

    expect(screen.getByTestId("meraki-conversations-empty")).toHaveTextContent(
      "Meraki keeps them where traffic analysis with hostname visibility is turned on, under Network-wide > General.",
    );
    // The way to the rest stays.
    expect(screen.getByTestId("meraki-set-up-netflow")).toBeInTheDocument();
  });

  test("the bug this fixes: a range between two reads says when the newest is, never that traffic analysis is off", async () => {
    answerUsage(() => {
      return usage({
        topApplications: [],
        topDestinations: [],
        topClients: [],
        topConversations: [],
        applicationTotals: { sentOctets: 0, receivedOctets: 0 },
        clientTotals: { sentOctets: 0, receivedOctets: 0 },
        totals: { sentOctets: 30_000_000, receivedOctets: 0, flows: 0 },
        // Read an hour and a half ago: before this past hour began.
        lastAnalyticsAt: "2026-10-01T10:30:00.000Z",
      });
    });

    await renderView(NETWORK);

    for (const list of [
      "meraki-top-applications-empty",
      "meraki-top-destinations-empty",
      "meraki-top-clients-empty",
      "meraki-conversations-empty",
    ]) {
      expect(screen.getByTestId(list)).toHaveTextContent(
        "Meraki's applications, destinations and clients are read every two hours. The newest are from 1 hour ago: pick a longer time range to see them.",
      );
      expect(screen.getByTestId(list)).not.toHaveTextContent(
        "traffic analysis",
      );
    }

    // Nor a count of flows that would say there were none.
    expect(screen.getByTestId("traffic-tile-flows-value")).toHaveTextContent(
      "\u2014",
    );
  });

  test("the applications and destinations say their protocol and port", async () => {
    answerUsage(() => {
      return usage({
        topApplications: [
          {
            application: "Microsoft Teams",
            protocol: "UDP",
            port: 3478,
            sentOctets: 1,
            receivedOctets: 1,
            flows: 1,
          },
        ],
        topDestinations: [
          {
            destination: "teams.microsoft.com",
            application: "Microsoft Teams",
            protocol: "UDP",
            port: 3478,
            sentOctets: 1,
            receivedOctets: 1,
          },
        ],
      });
    });

    await renderView(NETWORK);

    expect(rowsOf("meraki-top-applications")[0]).toHaveTextContent(
      "UDP port 3478",
    );
    expect(rowsOf("meraki-top-destinations")[0]).toHaveTextContent(
      "Microsoft Teams · UDP port 3478",
    );
  });
});

describe("the network's page without any traffic", () => {
  test("its set-up guide offers to connect Meraki, which opens the connect dialog", async () => {
    answerFlows(noFlows());

    await renderView(NETWORK);

    expect(screen.getByTestId("traffic-setup-meraki")).toHaveTextContent(
      "Using Cisco Meraki?",
    );

    /*
     * Official logos audit: Meraki is Cisco's, and the row shows Cisco's
     * logo where a cloud stood for it - decorative, beside the words that
     * name it.
     */
    const logo: Element | null = screen
      .getByTestId("traffic-setup-meraki")
      .querySelector("[data-provider-logo]");
    expect(logo).toHaveAttribute("data-provider-logo", "cisco");
    expect(logo).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByTestId("traffic-setup-connect-meraki"));
    await flush();

    expect(screen.getByTestId("meraki-connect")).toBeInTheDocument();
  });

  test("a device's guide does not: a device's traffic comes from its flows", async () => {
    answerFlows(noFlows());

    await renderView(DEVICE);

    expect(screen.queryByTestId("traffic-setup-meraki")).toBeNull();
  });

  test("a reader who may not connect reads the offer, and why there is no button", async () => {
    answerFlows(noFlows());
    connectGate = { isAllowed: false, disabledReason: MAY_NOT_CONNECT };

    await renderView(NETWORK);

    expect(screen.getByTestId("traffic-setup-meraki")).toHaveTextContent(
      "Using Cisco Meraki?",
    );
    expect(screen.queryByTestId("traffic-setup-connect-meraki")).toBeNull();
    expect(screen.getByTestId("traffic-setup-meraki-locked")).toHaveTextContent(
      MAY_NOT_CONNECT,
    );
  });

  test("before the permissions load: no offer at all", async () => {
    answerFlows(noFlows());
    connectGate = { isAllowed: false };

    await renderView(NETWORK);

    expect(screen.queryByTestId("traffic-setup-meraki")).toBeNull();
  });
});

describe("the network's page with flow records and no connection", () => {
  test("offers Meraki in one line at its foot, which opens the connect dialog", async () => {
    await renderView(NETWORK);

    expect(screen.getByTestId("traffic-body")).toBeInTheDocument();
    expect(screen.getByTestId("meraki-offer")).toHaveTextContent(
      "Using Cisco Meraki? Connect Meraki",
    );
    // Cisco's logo, an icon's size, where a cloud stood for Meraki.
    const logo: Element | null = screen
      .getByTestId("meraki-offer")
      .querySelector("[data-provider-logo]");
    expect(logo).toHaveAttribute("data-provider-logo", "cisco");
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).not.toHaveClass("bg-white");

    fireEvent.click(screen.getByTestId("meraki-offer-connect"));
    await flush();

    expect(screen.getByTestId("meraki-connect")).toBeInTheDocument();
  });

  test("a device's page never does: Meraki is connected on the network's page", async () => {
    await renderView(DEVICE);

    expect(screen.queryByTestId("meraki-offer")).toBeNull();
  });
});

describe("the flow side's card in every language", () => {
  const LOCALES: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  function readLocale(code: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
    ) as Record<string, string>;
  }

  test("says whose traffic it is in words the Dashboard translates, as the Meraki side's does", async () => {
    const english: Record<string, string> = readLocale("en");
    const german: Record<string, string> = readLocale("de");

    for (const description of Object.values(FLOW_DESCRIPTIONS)) {
      expect(english[description]).toBe(description);
      expect(german[description]).toBeTruthy();
      expect(german[description]).not.toBe(description);
    }

    await renderView(NETWORK);

    expect(screen.getByText(FLOW_DESCRIPTIONS.network)).toBeInTheDocument();
  });
});
