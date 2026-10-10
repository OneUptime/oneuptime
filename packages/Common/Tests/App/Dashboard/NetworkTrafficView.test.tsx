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
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Traffic page (NetworkTrafficView), rendered, in all three of its
 * places: a device's tab, a site's page and the whole network's.
 *
 *   - A click on any row narrows the whole page to it: the next request
 *     carries the filter, a chip says so, the address bar keeps it, and a
 *     second click (or the chip's x) widens the page again.
 *   - Before a device has sent a flow the page is a set-up guide: the ports,
 *     the vendor's commands, the addresses records are matched by.
 *   - On the network's page an address that sends flows but is no device
 *     yet is one click from being one: Add as device (prefilled), or It is
 *     one of my devices (its Other Addresses).
 *
 * The network (the traffic POST, the device list and update) is replaced;
 * so is the range picker. The chart is ChartZoomStandIn.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const SITE_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const UNKNOWN_EXPORTER: string = "198.51.100.7";

const apiPostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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
        return apiPostMock(...args);
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
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import NetworkTrafficView, {
  NetworkTrafficDeviceInfo,
  NetworkTrafficScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView";
import { resetStandInCharts, standInCharts } from "./ChartZoomStandIn";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

interface TrafficRequest {
  networkDeviceId?: string | undefined;
  networkSiteId?: string | undefined;
  startTime: string;
  endTime: string;
  filters?: Record<string, unknown> | undefined;
}

function lastRequest(): TrafficRequest {
  const calls: Array<Array<unknown>> = apiPostMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];

  if (!last) {
    throw new Error("The traffic was never fetched");
  }

  return (last[0] as { data: TrafficRequest }).data;
}

function summary(overrides: JSONObject = {}): JSONObject {
  return {
    windowStartAt: "2026-10-01T11:00:00.000Z",
    windowEndAt: "2026-10-01T12:00:00.000Z",
    bucketSeconds: 60,
    totals: { octets: 600_000_000, packets: 500_000, flows: 1200 },
    maxSamplingRate: 1,
    series: [
      { time: "2026-10-01 11:00:00", octets: 300_000_000 },
      { time: "2026-10-01 11:30:00", octets: 300_000_000 },
    ],
    topSources: [
      { ip: "10.0.0.5", octets: 400_000_000, packets: 300_000 },
      { ip: "10.0.0.7", octets: 200_000_000, packets: 200_000 },
    ],
    topDestinations: [
      { ip: "10.0.0.9", octets: 350_000_000, packets: 250_000 },
      { ip: "8.8.8.8", octets: 250_000_000, packets: 250_000 },
    ],
    topConversations: [
      {
        sourceIp: "10.0.0.5",
        destinationIp: "10.0.0.9",
        octets: 350_000_000,
        packets: 250_000,
      },
      {
        sourceIp: "10.0.0.7",
        destinationIp: "8.8.8.8",
        octets: 250_000_000,
        packets: 250_000,
      },
    ],
    topApplications: [
      { protocolNumber: 6, port: 443, octets: 500_000_000, packets: 400_000 },
      { protocolNumber: 17, port: 53, octets: 100_000_000, packets: 100_000 },
    ],
    topInterfaces: [
      {
        interfaceIndex: 3,
        name: "Gi0/3",
        alias: "uplink",
        speedInMbps: 10,
        inOctets: 450_000_000,
        outOctets: 45_000_000,
      },
    ],
    topDevices: [],
    sources: [],
    lastFlowAt: "2026-10-01 11:59:30",
    ...overrides,
  };
}

function answerWith(answer: (request: TrafficRequest) => JSONObject): void {
  apiPostMock.mockImplementation(async (args: unknown) => {
    return { data: answer((args as { data: TrafficRequest }).data) };
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderView(
  scope: NetworkTrafficScope,
  device?: NetworkTrafficDeviceInfo,
): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTrafficView scope={scope} device={device} />
    </MemoryRouter>,
  );
  await flush();
}

const DEVICE_SCOPE: NetworkTrafficScope = {
  kind: "device",
  networkDeviceId: new ObjectID(DEVICE_ID),
};

function rowsOf(listTestId: string): Array<HTMLElement> {
  return within(screen.getByTestId(listTestId)).getAllByTestId(
    `${listTestId}-row`,
  );
}

function rowNamed(listTestId: string, text: string): HTMLElement {
  const row: HTMLElement | undefined = rowsOf(listTestId).find(
    (candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(text);
    },
  );

  if (!row) {
    throw new Error(`No row "${text}" in ${listTestId}`);
  }

  return row;
}

function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState(null, "", "/");
  apiPostMock.mockReset();
  getListMock.mockReset();
  updateByIdMock.mockReset();
  resetStandInCharts();
  answerWith(() => {
    return summary();
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a click on any row narrows the whole page", () => {
  test("a source: the request, the chip, the row and the address bar all say so", async () => {
    await renderView(DEVICE_SCOPE);
    expect(lastRequest().filters).toEqual({});

    fireEvent.click(rowNamed("traffic-top-sources", "10.0.0.5"));
    await flush();

    expect(lastRequest().filters).toEqual({ sourceIp: "10.0.0.5" });
    expect(lastRequest().networkDeviceId).toBe(DEVICE_ID);
    expect(screen.getByTestId("traffic-filter-source")).toHaveTextContent(
      "From 10.0.0.5",
    );
    expect(rowNamed("traffic-top-sources", "10.0.0.5")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rowNamed("traffic-top-sources", "10.0.0.7")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(query().get("src")).toBe("10.0.0.5");
  });

  test("a second click on the same row widens the page again", async () => {
    await renderView(DEVICE_SCOPE);

    fireEvent.click(rowNamed("traffic-top-sources", "10.0.0.5"));
    await flush();
    fireEvent.click(rowNamed("traffic-top-sources", "10.0.0.5"));
    await flush();

    expect(lastRequest().filters).toEqual({});
    expect(
      screen.queryByTestId("traffic-filter-source"),
    ).not.toBeInTheDocument();
    expect(query().get("src")).toBeNull();
  });

  test("filters add up, a chip's x takes out only its own, and Clear filters takes out all", async () => {
    await renderView(DEVICE_SCOPE);

    fireEvent.click(rowNamed("traffic-top-sources", "10.0.0.5"));
    await flush();
    fireEvent.click(rowNamed("traffic-top-destinations", "10.0.0.9"));
    await flush();

    expect(lastRequest().filters).toEqual({
      sourceIp: "10.0.0.5",
      destinationIp: "10.0.0.9",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove the filter From 10.0.0.5",
      }),
    );
    await flush();

    expect(lastRequest().filters).toEqual({ destinationIp: "10.0.0.9" });

    fireEvent.click(screen.getByTestId("traffic-filters-clear"));
    await flush();

    expect(lastRequest().filters).toEqual({});
    expect(screen.getByTestId("traffic-filters")).toHaveTextContent(
      "Click any row to see only its traffic.",
    );
  });

  test("an application: its protocol and service port, named after the service", async () => {
    await renderView(DEVICE_SCOPE);

    const https: HTMLElement = rowNamed("traffic-top-applications", "HTTPS");
    expect(https).toHaveTextContent("TCP port 443");

    fireEvent.click(https);
    await flush();

    expect(lastRequest().filters).toEqual({ protocolNumber: 6, port: 443 });
    expect(screen.getByTestId("traffic-filter-application")).toHaveTextContent(
      "Application HTTPS",
    );
    expect(query().get("proto")).toBe("6");
    expect(query().get("port")).toBe("443");
  });

  test("an interface: named from the walk, how busy it was, and the chart splits into in and out", async () => {
    answerWith((request: TrafficRequest) => {
      return request.filters?.["interfaceIndex"] === 3
        ? summary({
            series: [
              {
                time: "2026-10-01 11:00:00",
                octets: 300_000_000,
                inOctets: 250_000_000,
                outOctets: 50_000_000,
              },
            ],
          })
        : summary();
    });
    await renderView(DEVICE_SCOPE);

    const uplink: HTMLElement = rowNamed("traffic-top-interfaces", "Gi0/3");
    // 450 MB in over an hour on a 10 Mbps port: 1 Mbps, 10% on average.
    expect(uplink).toHaveTextContent("uplink · 10% of 10.0 Mbps on average");
    expect(uplink).toHaveTextContent("In 450 MB · out 45.0 MB");
    expect(standInCharts.has("Traffic [Mbps]")).toBe(true);

    fireEvent.click(uplink);
    await flush();

    expect(lastRequest().filters).toEqual({ interfaceIndex: 3 });
    expect(screen.getByTestId("traffic-filter-interface")).toHaveTextContent(
      "Through Gi0/3",
    );
    await waitFor(() => {
      expect(standInCharts.has("In + Out [Mbps]")).toBe(true);
    });
  });

  test("a conversation, in the diagram or the list, narrows to the pair", async () => {
    await renderView(DEVICE_SCOPE);

    const bands: Array<HTMLElement> = screen.getAllByTestId(
      "traffic-conversation-band",
    );
    expect(bands).toHaveLength(2);
    // The busiest band is drawn last, on top.
    fireEvent.click(bands[1]!);
    await flush();

    expect(lastRequest().filters).toEqual({
      sourceIp: "10.0.0.5",
      destinationIp: "10.0.0.9",
    });

    fireEvent.click(screen.getByTestId("traffic-conversations-list"));
    const listRows: Array<HTMLElement> = screen.getAllByTestId(
      "traffic-conversation-row",
    );
    expect(listRows[0]).toHaveTextContent("10.0.0.5 → 10.0.0.9");
    expect(listRows[0]).toHaveAttribute("aria-pressed", "true");

    // The same pair again widens the page.
    fireEvent.click(listRows[0]!);
    await flush();

    expect(lastRequest().filters).toEqual({});
  });

  test("an address in the diagram narrows to everything it sent, or received", async () => {
    await renderView(DEVICE_SCOPE);

    fireEvent.click(
      screen.getAllByTestId("traffic-conversation-destination")[1]!,
    );
    await flush();

    expect(lastRequest().filters).toEqual({ destinationIp: "8.8.8.8" });
  });

  test("Find an IP address narrows to traffic to or from it", async () => {
    await renderView(DEVICE_SCOPE);

    fireEvent.change(screen.getByLabelText("Find an IP address"), {
      target: { value: " 2001:DB8::1 " },
    });
    fireEvent.click(screen.getByTestId("traffic-find-address-button"));
    await flush();

    expect(lastRequest().filters).toEqual({ hostIp: "2001:db8::1" });
    expect(screen.getByTestId("traffic-filter-host")).toHaveTextContent(
      "To or from 2001:db8::1",
    );
    expect(screen.getByLabelText("Find an IP address")).toHaveValue("");
  });

  test("Find an IP address refuses what is not one, without asking the server", async () => {
    await renderView(DEVICE_SCOPE);
    const requests: number = apiPostMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText("Find an IP address"), {
      target: { value: "core-router" },
    });
    fireEvent.submit(screen.getByTestId("traffic-find-address"));
    await flush();

    expect(
      screen.getByText("Enter an IP address, like 10.0.0.5."),
    ).toBeInTheDocument();
    expect(apiPostMock.mock.calls.length).toBe(requests);
  });

  test("a link with filters opens filtered", async () => {
    window.history.replaceState(null, "", "/?src=10.0.0.5&proto=6&port=443");

    await renderView(DEVICE_SCOPE);

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().filters).toEqual({
      sourceIp: "10.0.0.5",
      protocolNumber: 6,
      port: 443,
    });
    expect(screen.getByTestId("traffic-filter-source")).toBeInTheDocument();
    expect(screen.getByTestId("traffic-filter-application")).toHaveTextContent(
      "Application HTTPS",
    );
  });

  test("filters that match nothing: say so, and offer to clear them", async () => {
    window.history.replaceState(null, "", "/?src=10.0.0.99");
    answerWith((request: TrafficRequest) => {
      return request.filters?.["sourceIp"]
        ? summary({
            totals: { octets: 0, packets: 0, flows: 0 },
            series: [],
            topSources: [],
            topDestinations: [],
            topConversations: [],
            topApplications: [],
            topInterfaces: [],
          })
        : summary();
    });

    await renderView(DEVICE_SCOPE);

    const empty: HTMLElement = screen.getByTestId("traffic-no-match");
    expect(empty).toHaveTextContent(
      "No traffic matches these filters in this time range.",
    );
    expect(screen.queryByTestId("traffic-setup-guide")).not.toBeInTheDocument();

    fireEvent.click(
      within(empty).getByRole("button", { name: "Clear filters" }),
    );
    await flush();

    expect(lastRequest().filters).toEqual({});
    expect(screen.getByTestId("traffic-tiles")).toBeInTheDocument();
  });
});

describe("a device's page says what is arriving", () => {
  test("the format, the address it comes from, and the device's sampling", async () => {
    answerWith(() => {
      return summary({
        maxSamplingRate: 512,
        sources: [
          {
            networkDeviceId: DEVICE_ID,
            name: "core-router",
            exporterIp: "192.0.2.1",
            probeId: PROBE_ID,
            flowFormat: "IPFIX",
            samplingRate: 512,
            lastFlowAt: "2026-10-01 11:59:30",
            flows: 1200,
            octets: 600_000_000,
          },
        ],
      });
    });

    await renderView(DEVICE_SCOPE);

    const status: HTMLElement = screen.getByTestId("traffic-device-status");
    expect(status).toHaveTextContent("Receiving IPFIX from 192.0.2.1");
    expect(status).toHaveTextContent("The device samples 1 in 512 packets.");
    expect(screen.getByTestId("traffic-sampled-note")).toHaveTextContent(
      "Estimated from sampled traffic (up to 1 in 512 packets).",
    );
  });

  test("the tiles: total, average, peak and flow records", async () => {
    await renderView(DEVICE_SCOPE);

    expect(screen.getByTestId("traffic-tile-total-value")).toHaveTextContent(
      "600 MB",
    );
    // 600 MB over the hour: 1.33 Mbps.
    expect(screen.getByTestId("traffic-tile-average-value")).toHaveTextContent(
      "1.33 Mbps",
    );
    // 300 MB in one minute: 40 Mbps.
    expect(screen.getByTestId("traffic-tile-peak-value")).toHaveTextContent(
      "40.0 Mbps",
    );
    expect(screen.getByTestId("traffic-tile-flows-value")).toHaveTextContent(
      "1,200",
    );
  });

  test("each row shows its bytes and its share of the page", async () => {
    await renderView(DEVICE_SCOPE);

    const first: HTMLElement = rowNamed("traffic-top-sources", "10.0.0.5");
    expect(first).toHaveTextContent("400 MB");
    expect(first).toHaveTextContent("67%");
  });
});

describe("before the first flow, the page is the set-up guide", () => {
  function neverSent(): JSONObject {
    return summary({
      totals: { octets: 0, packets: 0, flows: 0 },
      series: [],
      topSources: [],
      topDestinations: [],
      topConversations: [],
      topApplications: [],
      topInterfaces: [],
      lastFlowAt: null,
    });
  }

  test("the probe, its ports, the commands for each vendor and the addresses records are matched by", async () => {
    answerWith(neverSent);

    await renderView(DEVICE_SCOPE, {
      hostname: "10.0.0.1",
      otherAddresses: "10.255.0.1, 192.0.2.1",
      probeName: "Branch probe",
      isGlobalProbe: false,
    });

    const guide: HTMLElement = screen.getByTestId("traffic-setup-guide");
    expect(guide).toHaveTextContent("Send flow records to probe Branch probe");
    expect(
      within(guide)
        .getAllByTestId("traffic-setup-port")
        .map((port: HTMLElement): string => {
          return port.textContent || "";
        }),
    ).toEqual([
      "UDP 2055NetFlow v5, v9 · IPFIX",
      "UDP 4739IPFIX",
      "UDP 6343sFlow v5",
    ]);
    expect(
      within(guide)
        .getAllByTestId("traffic-setup-match-address")
        .map((address: HTMLElement): string => {
          return address.textContent || "";
        }),
    ).toEqual(["10.0.0.1", "10.255.0.1", "192.0.2.1"]);
    expect(
      screen.queryByTestId("traffic-setup-global-probe"),
    ).not.toBeInTheDocument();
    // Nothing else on the page yet.
    expect(screen.queryByTestId("traffic-tiles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("traffic-top-sources")).not.toBeInTheDocument();
  });

  test("the vendor tabs switch the commands", async () => {
    answerWith(neverSent);
    await renderView(DEVICE_SCOPE);

    expect(screen.getByTestId("traffic-setup-configuration")).toHaveTextContent(
      "export-protocol ipfix",
    );
    expect(
      screen.getByTestId("traffic-setup-vendor-cisco-ios-xe"),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("traffic-setup-vendor-arista"));
    expect(screen.getByTestId("traffic-setup-configuration")).toHaveTextContent(
      "sflow destination <probe-address> 6343",
    );

    fireEvent.click(screen.getByTestId("traffic-setup-vendor-meraki"));
    expect(
      screen.queryByTestId("traffic-setup-configuration"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("traffic-setup-steps")).toHaveTextContent(
      "Network-wide > General",
    );
  });

  test("a device on a global probe is told its flows cannot reach it", async () => {
    answerWith(neverSent);

    await renderView(DEVICE_SCOPE, {
      hostname: "10.0.0.1",
      probeName: "Global probe",
      isGlobalProbe: true,
    });

    expect(screen.getByTestId("traffic-setup-global-probe")).toHaveTextContent(
      "Run a custom probe on the device's network",
    );
  });

  test("the network's page gets the guide when nothing is sending at all", async () => {
    answerWith(neverSent);

    await renderView({ kind: "network" });

    expect(screen.getByTestId("traffic-setup-guide")).toHaveTextContent(
      "See where your network's traffic goes",
    );
    expect(
      screen.queryByTestId("traffic-setup-match-address"),
    ).not.toBeInTheDocument();
  });
});

describe("a site's page", () => {
  const SITE_DEVICES: JSONObject = {
    topDevices: [
      {
        networkDeviceId: DEVICE_ID,
        name: "core-router",
        exporterIp: "192.0.2.1",
        octets: 500_000_000,
        packets: 400_000,
      },
      {
        networkDeviceId: OTHER_DEVICE_ID,
        name: "edge-firewall",
        exporterIp: "192.0.2.2",
        octets: 100_000_000,
        packets: 100_000,
      },
    ],
    topInterfaces: [],
  };

  test("asks for the site's traffic and lists its busiest devices instead of interfaces", async () => {
    answerWith(() => {
      return summary(SITE_DEVICES);
    });

    await renderView({ kind: "site", networkSiteId: new ObjectID(SITE_ID) });

    expect(lastRequest().networkSiteId).toBe(SITE_ID);
    expect(lastRequest().networkDeviceId).toBeUndefined();
    expect(rowsOf("traffic-top-devices")).toHaveLength(2);
    expect(
      screen.queryByTestId("traffic-top-interfaces"),
    ).not.toBeInTheDocument();
  });

  test("a click on a device narrows the page to it; its arrow opens the device", async () => {
    answerWith(() => {
      return summary(SITE_DEVICES);
    });
    await renderView({ kind: "site", networkSiteId: new ObjectID(SITE_ID) });

    const core: HTMLElement = rowNamed("traffic-top-devices", "core-router");
    const item: HTMLElement = core.closest("li")!;
    const open: HTMLElement = within(item).getByRole("link", {
      name: "Open core-router",
    });

    // The link is beside the row's button, never inside it.
    expect(core).not.toContainElement(open);
    expect(open.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/traffic`,
    );

    fireEvent.click(core);
    await flush();

    expect(lastRequest().filters).toEqual({ networkDeviceId: DEVICE_ID });
    expect(screen.getByTestId("traffic-filter-device")).toHaveTextContent(
      "Device core-router",
    );
    expect(query().get("device")).toBe(DEVICE_ID);
  });
});

describe("the network's page and the addresses that are not devices yet", () => {
  const SOURCES: JSONObject = {
    sources: [
      {
        networkDeviceId: DEVICE_ID,
        name: "core-router",
        exporterIp: "192.0.2.1",
        probeId: PROBE_ID,
        flowFormat: "NetFlow v9",
        samplingRate: 1,
        lastFlowAt: "2026-10-01 11:59:30",
        flows: 1000,
        octets: 500_000_000,
      },
      {
        exporterIp: UNKNOWN_EXPORTER,
        probeId: PROBE_ID,
        flowFormat: "sFlow",
        samplingRate: 1024,
        lastFlowAt: "2026-10-01 11:58:00",
        flows: 200,
        octets: 100_000_000,
      },
    ],
    topDevices: [
      {
        networkDeviceId: DEVICE_ID,
        name: "core-router",
        exporterIp: "192.0.2.1",
        octets: 500_000_000,
        packets: 400_000,
      },
      {
        exporterIp: UNKNOWN_EXPORTER,
        octets: 100_000_000,
        packets: 100_000,
      },
    ],
    topInterfaces: [],
  };

  beforeEach(() => {
    answerWith(() => {
      return summary(SOURCES);
    });
  });

  test("asks for every device's traffic, and says how many senders are not devices yet", async () => {
    await renderView({ kind: "network" });

    expect(lastRequest().networkDeviceId).toBeUndefined();
    expect(lastRequest().networkSiteId).toBeUndefined();
    expect(screen.getByTestId("traffic-unknown-sources")).toHaveTextContent(
      "1 address sending flow records is not a device yet.",
    );
    expect(
      within(screen.getByTestId("traffic-unknown-sources")).getByRole("link", {
        name: "Review",
      }),
    ).toHaveAttribute("href", "#traffic-sources");
  });

  test("lists who is sending: devices by name, the rest by address, with what they send", async () => {
    await renderView({ kind: "network" });

    const sources: Array<HTMLElement> = screen.getAllByTestId("traffic-source");
    expect(sources).toHaveLength(2);
    expect(sources[0]).toHaveTextContent("core-router");
    expect(sources[0]).toHaveTextContent("NetFlow v9");
    expect(
      within(sources[0]!).queryByTestId("traffic-source-unknown"),
    ).not.toBeInTheDocument();
    expect(sources[1]).toHaveTextContent(UNKNOWN_EXPORTER);
    expect(sources[1]).toHaveTextContent("sFlow · 1 in 1,024 sampled");
    expect(
      within(sources[1]!).getByTestId("traffic-source-unknown"),
    ).toHaveTextContent("Not a device yet");
  });

  test("an address that is not a device yet narrows the page by the address it sends from", async () => {
    await renderView({ kind: "network" });

    const unknown: HTMLElement = rowNamed(
      "traffic-top-devices",
      UNKNOWN_EXPORTER,
    );
    expect(unknown).toHaveTextContent("Not a device yet");

    fireEvent.click(unknown);
    await flush();

    expect(lastRequest().filters).toEqual({ exporterIp: UNKNOWN_EXPORTER });
    expect(screen.getByTestId("traffic-filter-exporter")).toHaveTextContent(
      `Sent by ${UNKNOWN_EXPORTER}`,
    );
  });

  test("Add as device opens Add Device with the address and the probe filled in", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    await renderView({ kind: "network" });

    fireEvent.click(screen.getByTestId("traffic-source-add"));

    expect(navigate).toHaveBeenCalledTimes(1);
    const route: Route = navigate.mock.calls[0]![0] as Route;
    const url: URL = new URL(route.toString(), "https://oneuptime.example");
    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/network-devices`);
    expect(url.searchParams.get("open")).toBe("add-device");
    expect(url.searchParams.get("address")).toBe(UNKNOWN_EXPORTER);
    expect(url.searchParams.get("probe")).toBe(PROBE_ID);
  });

  test("It is one of my devices: the address joins the device's Other Addresses, and the page reads again", async () => {
    getListMock.mockResolvedValue({
      data: [
        Object.assign(new NetworkDevice(), {
          _id: DEVICE_ID,
          name: "core-router",
          hostname: "192.0.2.1",
          otherAddresses: "10.255.0.1",
        }),
        Object.assign(new NetworkDevice(), {
          _id: OTHER_DEVICE_ID,
          name: "edge-firewall",
          hostname: "192.0.2.2",
        }),
      ],
      count: 2,
      skip: 0,
      limit: 500,
    });
    updateByIdMock.mockResolvedValue({});
    await renderView({ kind: "network" });
    const requestsBefore: number = apiPostMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("traffic-source-link"));
    await flush();

    const modal: HTMLElement = screen.getByTestId("modal");
    expect(modal).toHaveTextContent("Which device sends these flows?");
    expect(modal).toHaveTextContent(`Flows from ${UNKNOWN_EXPORTER}`);

    const picker: HTMLElement = await within(modal).findByRole("combobox");
    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("option", { name: "core-router (192.0.2.1)" }),
    );
    fireEvent.click(
      within(modal).getByRole("button", { name: "Use this device" }),
    );
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const update: { id: ObjectID; data: JSONObject } = updateByIdMock.mock
      .calls[0]![0] as { id: ObjectID; data: JSONObject };
    expect(update.id.toString()).toBe(DEVICE_ID);
    expect(update.data).toEqual({
      otherAddresses: `10.255.0.1, ${UNKNOWN_EXPORTER}`,
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("traffic-sources-notice")).toHaveTextContent(
      `Flows from ${UNKNOWN_EXPORTER} go to core-router from the next minute on.`,
    );
    expect(apiPostMock.mock.calls.length).toBe(requestsBefore + 1);
  });

  test("a device that could not be updated says why, and the dialog stays open", async () => {
    getListMock.mockResolvedValue({
      data: [
        Object.assign(new NetworkDevice(), {
          _id: DEVICE_ID,
          name: "core-router",
          hostname: "192.0.2.1",
        }),
      ],
      count: 1,
      skip: 0,
      limit: 500,
    });
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to edit this device."),
    );
    await renderView({ kind: "network" });

    fireEvent.click(screen.getByTestId("traffic-source-link"));
    await flush();
    const modal: HTMLElement = screen.getByTestId("modal");
    fireEvent.keyDown(await within(modal).findByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("option", { name: "core-router (192.0.2.1)" }),
    );
    fireEvent.click(
      within(modal).getByRole("button", { name: "Use this device" }),
    );
    await flush();

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "You do not have permission to edit this device.",
    );
    expect(
      screen.queryByTestId("traffic-sources-notice"),
    ).not.toBeInTheDocument();
  });

  test("only the network's page lists the senders", async () => {
    await renderView(DEVICE_SCOPE);

    expect(screen.queryByTestId("traffic-sources")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("traffic-unknown-sources"),
    ).not.toBeInTheDocument();
  });
});
