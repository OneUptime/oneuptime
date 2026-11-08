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
import { getJestSpyOn } from "../../Spy";

/*
 * Issue #5762, rendered through the Traffic page itself (NetworkTrafficView),
 * as a reader meets it:
 *
 *   - the side it opens on: Meraki where Meraki reports, the side the reader
 *     picked last on this kind of page (remembered in the browser), a link's
 *     side over both - and it stays on its side while the reader narrows it;
 *   - Top networks, Top applications and Top clients cut at ten say how many
 *     there are, and "View all" opens every one of them: searched, sorted
 *     and paged by the server, a network a click from narrowing the page;
 *   - a device's page in a project that reads Meraki: not linked to an
 *     appliance, and the way to link it - the likely appliances first, one
 *     another device is already listed but not offered - then which
 *     appliance it is, over its traffic, and Unlink. Whoever may not change
 *     a device's serial number is told why there is no button.
 *
 * The network and the range picker are replaced; the chart is
 * ChartZoomStandIn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ROUTER_ID: string = "40000000-0000-4000-8000-000000000002";
const OTHER_ID: string = "40000000-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-10-01T12:00:00.000Z");

const flowPostMock: MockFunction = getJestMockFunction();
const usagePostMock: MockFunction = getJestMockFunction();
const listPostMock: MockFunction = getJestMockFunction();
const appliancesPostMock: MockFunction = getJestMockFunction();
const linkPostMock: MockFunction = getJestMockFunction();
const unlinkPostMock: MockFunction = getJestMockFunction();
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
        const url: string = String(
          (args[0] as { url?: unknown } | undefined)?.url,
        );

        if (url.includes("/usage-summary")) {
          return usagePostMock(...args);
        }

        if (url.includes("/usage-list")) {
          return listPostMock(...args);
        }

        if (url.includes("/usage-appliances")) {
          return appliancesPostMock(...args);
        }

        if (url.includes("/unlink-appliance")) {
          return unlinkPostMock(...args);
        }

        if (url.includes("/link-appliance")) {
          return linkPostMock(...args);
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
  APPLIANCE_REFILE_REREAD_MS,
  NetworkTrafficScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficView";
import { LIST_SEARCH_DELAY_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiTrafficListModal";
import { getTrafficSideStorageKey } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/TrafficSideMemory";
import { resetStandInCharts } from "./ChartZoomStandIn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  BUTTON_DISABLED_CURSOR_CLASS_NAME,
  BUTTON_DISABLED_FADE_CLASS_NAME,
} from "../../../UI/Components/Button/ButtonStates";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

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
        networkDeviceId: ROUTER_ID,
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

function noFlows(): JSONObject {
  return flows({
    totals: { octets: 0, packets: 0, flows: 0 },
    series: [],
    topSources: [],
    sources: [],
    lastFlowAt: null,
  });
}

function networks(count: number): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    rows.push({
      controllerNetworkId: `L_${1000 + index}`,
      name: `Store ${String(index + 1).padStart(3, "0")}`,
      sentOctets: 2_000_000 - index * 1000,
      receivedOctets: 10_000_000 - index * 5000,
    });
  }

  return rows;
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
    ],
    topNetworks: networks(10),
    topUplinks: [],
    topApplications: [
      {
        application: "Microsoft Teams",
        protocol: "UDP",
        port: 3478,
        sentOctets: 3_600_000,
        receivedOctets: 10_800_000,
        flows: 180,
      },
    ],
    topDestinations: [],
    topClients: [
      {
        clientKey: "k1",
        name: "Kiosk 3",
        ip: "10.0.0.25",
        mac: "22:33:44:55:66:77",
        manufacturer: "Apple",
        controllerNetworkName: "Store 001",
        sentOctets: 1_000_000,
        receivedOctets: 4_000_000,
      },
    ],
    networkCount: 523,
    applicationCount: 1,
    clientCount: 1,
    lastUplinkAt: "2026-10-01T11:55:00.000Z",
    lastAnalyticsAt: "2026-10-01T10:00:00.000Z",
    connections: [
      {
        id: "c1",
        name: "Acme Networks",
        provider: "meraki",
        organizationName: "Acme Networks",
        status: "healthy",
        readIntervalInMinutes: 5,
        lastPulledAt: "2026-10-01T11:58:00.000Z",
        lastSuccessfulPullAt: "2026-10-01T11:58:00.000Z",
      },
    ],
    ...overrides,
  };
}

function answer(mock: MockFunction, data: (body: JSONObject) => unknown): void {
  mock.mockImplementation(async (args: unknown) => {
    const result: unknown = data((args as { data: JSONObject }).data || {});

    return result instanceof Error ? Promise.reject(result) : { data: result };
  });
}

function bodiesOf(mock: MockFunction): Array<JSONObject> {
  return mock.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

async function renderView(scope: NetworkTrafficScope): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkTrafficView scope={scope} />
    </MemoryRouter>,
  );
  await flush();
}

function sideButton(side: "flows" | "meraki"): HTMLElement {
  return within(screen.getByTestId("traffic-source-switch")).getByTestId(
    `traffic-source-${side}`,
  );
}

const NETWORK: NetworkTrafficScope = { kind: "network" };
const ROUTER: NetworkTrafficScope = {
  kind: "device",
  networkDeviceId: new ObjectID(ROUTER_ID),
};

let recordGate: PermissionGateResult;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();

  for (const mock of [
    flowPostMock,
    usagePostMock,
    listPostMock,
    appliancesPostMock,
    linkPostMock,
    unlinkPostMock,
    getListMock,
  ]) {
    mock.mockReset();
  }

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 100 };
  });
  resetStandInCharts();
  answer(flowPostMock, () => {
    return flows();
  });
  answer(usagePostMock, () => {
    return usage();
  });
  recordGate = { isAllowed: true };
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return recordGate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the side a page opens on (issue #5762)", () => {
  test("the reader's pick is remembered: the next visit opens there, though Meraki reports", async () => {
    await renderView(NETWORK);
    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(sideButton("flows"));
    await flush();

    expect(
      window.localStorage.getItem(
        getTrafficSideStorageKey(PROJECT_ID, "network"),
      ),
    ).toBe("flows");

    cleanup();
    window.history.replaceState(null, "", "/");
    await renderView(NETWORK);

    expect(sideButton("flows")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("traffic-body")).toBeInTheDocument();
  });

  test("a pick is remembered for its kind of page only: a device's page still picks for itself", async () => {
    window.localStorage.setItem(
      getTrafficSideStorageKey(PROJECT_ID, "network"),
      "flows",
    );
    answer(usagePostMock, (body: JSONObject) => {
      return body["networkDeviceId"]
        ? usage({
            deviceAppliance: {
              status: "linked",
              serial: "Q2PN-LDS0-0012",
              name: "LDS MX68",
              isLinkedBySerialNumber: true,
            },
          })
        : usage();
    });

    await renderView(ROUTER);

    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");
  });

  test("a link that names a side wins over the remembered one", async () => {
    window.localStorage.setItem(
      getTrafficSideStorageKey(PROJECT_ID, "network"),
      "flows",
    );
    window.history.replaceState(null, "", "/?source=meraki");

    await renderView(NETWORK);

    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");
  });

  test("a remembered side with nothing to show gives way: no flow records, so Meraki", async () => {
    window.localStorage.setItem(
      getTrafficSideStorageKey(PROJECT_ID, "network"),
      "flows",
    );
    answer(flowPostMock, () => {
      return noFlows();
    });

    await renderView(NETWORK);

    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("traffic-setup-guide")).toBeNull();
  });

  test("the page stays on its side while the reader narrows it - never jumping to the flows under them", async () => {
    answer(usagePostMock, (body: JSONObject) => {
      return (body["filters"] as JSONObject | undefined)?.[
        "controllerNetworkId"
      ]
        ? usage({
            totals: { sentOctets: 0, receivedOctets: 0, flows: 0 },
            applicationTotals: { sentOctets: 0, receivedOctets: 0 },
            clientTotals: { sentOctets: 0, receivedOctets: 0 },
            series: [],
            topNetworks: [],
            topApplications: [],
            topClients: [],
          })
        : usage();
    });

    await renderView(NETWORK);
    fireEvent.click(
      within(screen.getByTestId("meraki-top-networks")).getAllByTestId(
        "meraki-top-networks-row",
      )[0]!,
    );
    await flush();

    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("meraki-no-match")).toBeInTheDocument();
  });
});

describe("every network, not ten", () => {
  function listRows(): Array<HTMLElement> {
    return within(screen.getByTestId("modal")).queryAllByTestId(
      "meraki-list-row",
    );
  }

  beforeEach(() => {
    answer(flowPostMock, () => {
      return noFlows();
    });
    answer(listPostMock, (body: JSONObject) => {
      const search: string = String(body["search"] || "").toLowerCase();
      const all: Array<JSONObject> = networks(523).filter((row: JSONObject) => {
        return String(row["name"]).toLowerCase().includes(search);
      });
      const skip: number = Number(body["skip"] || 0);
      const limit: number = Number(body["limit"] || 25);

      return {
        list: body["list"],
        count: all.length,
        networks: all.slice(skip, skip + limit),
      };
    });
  });

  test("a list cut at ten says how many there are; one that is whole says nothing", async () => {
    await renderView(NETWORK);

    expect(
      screen.getByTestId("meraki-top-networks-view-all"),
    ).toHaveTextContent("View all 523 networks");
    // One application and one client: their lists are whole.
    expect(screen.queryByTestId("meraki-top-applications-view-all")).toBeNull();
    expect(screen.queryByTestId("meraki-top-clients-view-all")).toBeNull();
  });

  test("View all opens every network: the page's request, the first page, busiest first", async () => {
    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent("All networks");
    expect(bodiesOf(listPostMock)[0]).toMatchObject({
      list: "networks",
      primaryKind: "uplink",
      search: "",
      sortBy: "total",
      skip: 0,
      limit: 25,
      startTime: expect.any(String),
      endTime: expect.any(String),
    });
    expect(listRows()).toHaveLength(25);
    expect(listRows()[0]).toHaveTextContent("Store 001");
    expect(screen.getByTestId("meraki-list-pagination")).toHaveTextContent(
      "523",
    );
  });

  test("the next page reads on from where the first ended", async () => {
    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();

    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await flush();

    expect(bodiesOf(listPostMock).pop()).toMatchObject({ skip: 25 });
    expect(listRows()[0]).toHaveTextContent("Store 026");
  });

  test("a search waits for the typing to pause, then starts from the first page", async () => {
    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();
    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await flush();

    const asked: number = listPostMock.mock.calls.length;
    fireEvent.change(screen.getByTestId("meraki-list-search"), {
      target: { value: "store 042" },
    });
    await flush();
    expect(listPostMock.mock.calls.length).toBe(asked);

    await advance(LIST_SEARCH_DELAY_MS);

    expect(bodiesOf(listPostMock).pop()).toMatchObject({
      search: "store 042",
      skip: 0,
    });
    expect(listRows()).toHaveLength(1);
    expect(listRows()[0]).toHaveTextContent("Store 042");
  });

  test("a search that matches nothing says so", async () => {
    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();
    fireEvent.change(screen.getByTestId("meraki-list-search"), {
      target: { value: "coventry" },
    });
    await advance(LIST_SEARCH_DELAY_MS);

    expect(screen.getByTestId("meraki-list-empty")).toHaveTextContent(
      "No network matches “coventry”.",
    );
  });

  test("sorted by what came in or went out, from the first page again", async () => {
    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();

    const sort: HTMLElement = screen.getByTestId("meraki-list-sort");
    expect(within(sort).getByTestId("meraki-list-sort-total")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(sort).getByTestId("meraki-list-sort-in"));
    await flush();
    expect(bodiesOf(listPostMock).pop()).toMatchObject({
      sortBy: "in",
      skip: 0,
    });

    fireEvent.click(within(sort).getByTestId("meraki-list-sort-out"));
    await flush();
    expect(bodiesOf(listPostMock).pop()).toMatchObject({ sortBy: "out" });
  });

  test("a network picked there narrows the page to it, as a row of Top networks does, and the dialog closes", async () => {
    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();

    fireEvent.click(listRows()[3]!);
    await flush();

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("mnet")).toBe(
      "L_1003",
    );
    expect(bodiesOf(usagePostMock).pop()?.["filters"]).toEqual({
      controllerNetworkId: "L_1003",
    });
  });

  test("a list that fails says why, and tries again", async () => {
    answer(listPostMock, () => {
      return new Error(
        "Summing this much traffic took longer than 45 seconds.",
      );
    });

    await renderView(NETWORK);
    fireEvent.click(screen.getByTestId("meraki-top-networks-view-all"));
    await flush();

    expect(screen.getByTestId("meraki-list-error")).toHaveTextContent(
      "Summing this much traffic took longer than 45 seconds.",
    );
  });

  test("the applications and the clients have theirs when cut too, read as rows of their own", async () => {
    answer(usagePostMock, () => {
      return usage({ applicationCount: 347, clientCount: 8644 });
    });
    answer(listPostMock, (body: JSONObject) => {
      return {
        list: body["list"],
        count: 2,
        applications: [
          {
            application: "Zoom",
            protocol: "UDP",
            port: 8801,
            sentOctets: 1,
            receivedOctets: 2,
          },
        ],
        clients: [
          {
            clientKey: "k9",
            name: "",
            ip: "10.0.0.99",
            mac: "aa:bb:cc:dd:ee:ff",
            sentOctets: 1,
            receivedOctets: 2,
          },
        ],
      };
    });

    await renderView(NETWORK);

    expect(
      screen.getByTestId("meraki-top-applications-view-all"),
    ).toHaveTextContent("View all 347 applications");
    fireEvent.click(screen.getByTestId("meraki-top-clients-view-all"));
    await flush();

    expect(bodiesOf(listPostMock).pop()).toMatchObject({ list: "clients" });
    expect(screen.getByTestId("modal-title")).toHaveTextContent("All clients");
    // A client without a name is its address, in the addresses' font - and not a filter.
    expect(listRows()[0]).toHaveTextContent("10.0.0.99");
    expect(listRows()[0]!.tagName).toBe("DIV");
  });
});

describe("a router's Traffic page and its Meraki appliance", () => {
  const APPLIANCES: JSONObject = {
    appliances: [
      {
        serial: "Q2PN-LDS0-0012",
        name: "LDS MX68",
        controllerNetworkId: "L_12",
        controllerNetworkName: "Branch 012 · Leeds",
        connectionName: "Acme Networks",
        lastSeenAt: "2026-10-01T11:55:00.000Z",
        octets: 4_000_000,
        isLikely: true,
        likenessReason: "number",
        likenessShared: "12",
      },
      {
        serial: "Q2PN-BRS0-0047",
        name: "BRS MX68",
        controllerNetworkId: "L_47",
        controllerNetworkName: "Branch 047 · Bristol",
        connectionName: "Acme Networks",
        lastSeenAt: "2026-10-01T11:55:00.000Z",
        octets: 2_000_000,
        isLikely: false,
        linkedDeviceId: OTHER_ID,
        linkedDeviceName: "Bristol router",
      },
      {
        serial: "Q2PN-COV0-0003",
        name: "COV MX67C",
        controllerNetworkId: "L_3",
        controllerNetworkName: "Warehouse · Coventry",
        connectionName: "Acme Networks",
        lastSeenAt: "2026-10-01T11:55:00.000Z",
        octets: 1_000_000,
        isLikely: false,
      },
    ],
    total: 3,
    matching: 3,
  };

  let linked: boolean;

  beforeEach(() => {
    linked = false;
    answer(flowPostMock, () => {
      return noFlows();
    });
    answer(usagePostMock, () => {
      return linked
        ? usage({
            topNetworks: [],
            topUplinks: [
              {
                deviceSerial: "Q2PN-LDS0-0012",
                deviceName: "LDS MX68",
                controllerNetworkId: "L_12",
                controllerNetworkName: "Branch 012 · Leeds",
                interfaceName: "wan1",
                sentOctets: 1,
                receivedOctets: 2,
                networkDeviceId: ROUTER_ID,
              },
            ],
            deviceAppliance: {
              status: "linked",
              serial: "Q2PN-LDS0-0012",
              name: "LDS MX68",
              controllerNetworkName: "Branch 012 · Leeds",
              isLinkedBySerialNumber: true,
            },
          })
        : {
            isAvailable: false,
            deviceAppliance: { status: "unlinked" },
          };
    });
    answer(appliancesPostMock, () => {
      return APPLIANCES;
    });
    answer(linkPostMock, () => {
      linked = true;
      return { deviceSerial: "Q2PN-LDS0-0012", isRefiled: true };
    });
    answer(unlinkPostMock, () => {
      linked = false;
      return { deviceSerial: "Q2PN-LDS0-0012", isRefiled: true };
    });
  });

  test("the bug this fixes: no Meraki side and no word of it - now the switch, and why the side is empty", async () => {
    await renderView(ROUTER);

    expect(sideButton("meraki")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("meraki-appliance-unlinked")).toHaveTextContent(
      "This device is not linked to a Meraki appliance.",
    );
    expect(screen.getByTestId("meraki-appliance-link")).toHaveTextContent(
      "Link to a Meraki appliance",
    );
  });

  test("a router that exports flows opens on them, with Meraki and its link one click away", async () => {
    answer(flowPostMock, () => {
      return flows();
    });

    await renderView(ROUTER);

    expect(sideButton("flows")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(sideButton("meraki"));
    await flush();

    expect(screen.getByTestId("meraki-appliance-unlinked")).toBeInTheDocument();
  });

  test("the dialog lists the appliances, the likely first and why; one another device is already cannot be picked", async () => {
    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();

    expect(bodiesOf(appliancesPostMock)[0]).toEqual({
      networkDeviceId: ROUTER_ID,
      search: "",
    });
    expect(screen.getByTestId("meraki-link-likely-heading")).toHaveTextContent(
      "Likely matches",
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-link-appliance",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("LDS MX68");
    expect(
      within(rows[0]!).getByTestId("meraki-link-appliance-likeness"),
    ).toHaveTextContent("Both names have 12");
    expect(within(rows[1]!).getByRole("radio")).toBeDisabled();
    expect(
      within(rows[1]!).getByTestId("meraki-link-appliance-taken"),
    ).toHaveTextContent("Linked to Bristol router");

    // Nothing picked: nothing to link.
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
  });

  test("an appliance another device is takes the shared locked look: its name and details fade, the device it is does not", async () => {
    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "meraki-link-appliance",
    );
    const locked: HTMLElement = rows[1]!;
    const free: HTMLElement = rows[0]!;
    const nameLine: (row: HTMLElement) => HTMLElement = (
      row: HTMLElement,
    ): HTMLElement => {
      return within(row).getByTestId("meraki-link-appliance-name")
        .parentElement!;
    };

    expect(locked).toHaveAttribute("data-locked", "true");
    expect(locked.className.split(" ")).toContain(
      BUTTON_DISABLED_CURSOR_CLASS_NAME,
    );
    // No hover on a row that cannot be picked, and no look of its own.
    expect(locked.className).not.toContain("hover:");
    expect(locked.className).not.toContain("bg-gray-50");
    expect(nameLine(locked).className.split(" ")).toContain(
      BUTTON_DISABLED_FADE_CLASS_NAME,
    );
    expect(
      within(locked).getByTestId("meraki-link-appliance-taken").className,
    ).not.toContain(BUTTON_DISABLED_FADE_CLASS_NAME);

    expect(free).toHaveAttribute("data-locked", "false");
    expect(free.className).toContain("cursor-pointer");
    expect(free.className).toContain("hover:bg-gray-50");
    expect(free.className).not.toContain(BUTTON_DISABLED_CURSOR_CLASS_NAME);
    expect(nameLine(free).className.split(" ")).not.toContain(
      BUTTON_DISABLED_FADE_CLASS_NAME,
    );
  });

  test("picking one links the device: its serial number posted, the page reads its traffic and names the appliance", async () => {
    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();

    fireEvent.click(
      within(screen.getAllByTestId("meraki-link-appliance")[0]!).getByRole(
        "radio",
      ),
    );
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(bodiesOf(linkPostMock)[0]).toEqual({
      networkDeviceId: ROUTER_ID,
      deviceSerial: "Q2PN-LDS0-0012",
    });
    expect(screen.queryByTestId("meraki-link-dialog")).toBeNull();
    expect(screen.getByTestId("meraki-appliance-line")).toHaveTextContent(
      "Linked to the Meraki appliance LDS MX68",
    );
    expect(screen.getByTestId("meraki-appliance-line")).toHaveTextContent(
      "Q2PN-LDS0-0012",
    );

    // And once more a moment later, when the stored traffic is filed.
    const reads: number = usagePostMock.mock.calls.length;
    await advance(APPLIANCE_REFILE_REREAD_MS);
    expect(usagePostMock.mock.calls.length).toBeGreaterThan(reads);
  });

  test("a link the server refuses is said in the dialog, which stays open", async () => {
    answer(linkPostMock, () => {
      return new Error(
        "This appliance is linked to Bristol router already. Unlink it there first.",
      );
    });

    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();
    fireEvent.click(
      within(screen.getAllByTestId("meraki-link-appliance")[2]!).getByRole(
        "radio",
      ),
    );
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("meraki-link-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "This appliance is linked to Bristol router already. Unlink it there first.",
    );
  });

  test("a search narrows the appliances once the typing pauses", async () => {
    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();

    fireEvent.change(screen.getByTestId("meraki-link-search"), {
      target: { value: "bristol" },
    });
    await advance(LIST_SEARCH_DELAY_MS);

    expect(bodiesOf(appliancesPostMock).pop()).toEqual({
      networkDeviceId: ROUTER_ID,
      search: "bristol",
    });
  });

  test("no appliance reported lately: the dialog says so, and what reports traffic", async () => {
    answer(appliancesPostMock, () => {
      return { appliances: [], total: 0, matching: 0 };
    });

    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();

    expect(screen.getByTestId("meraki-link-empty")).toHaveTextContent(
      "No Meraki appliance reported traffic in the last 7 days.",
    );
  });

  test("more appliances than the dialog shows: it says so, and that a search finds the rest", async () => {
    answer(appliancesPostMock, () => {
      return { ...APPLIANCES, matching: 1200, total: 1200 };
    });

    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-link"));
    await flush();

    expect(screen.getByTestId("meraki-link-more")).toHaveTextContent(
      "Showing 3 of 1,200. Search to find the rest.",
    );
  });

  test("a linked device: Unlink, confirmed, takes the link off and the page reads again", async () => {
    linked = true;

    await renderView(ROUTER);
    fireEvent.click(screen.getByTestId("meraki-appliance-unlink"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Unlink this device?",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "The traffic of LDS MX68 goes back to the network's Traffic page",
    );

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(bodiesOf(unlinkPostMock)[0]).toEqual({ networkDeviceId: ROUTER_ID });
    expect(screen.getByTestId("meraki-appliance-unlinked")).toBeInTheDocument();
  });

  test("a device linked another way - its MAC, Meraki's record - offers no Unlink: there is nothing on it to take off", async () => {
    answer(usagePostMock, () => {
      return usage({
        topNetworks: [],
        deviceAppliance: {
          status: "linked",
          serial: "Q2PN-LDS0-0012",
          name: "LDS MX68",
          isLinkedBySerialNumber: false,
        },
      });
    });

    await renderView(ROUTER);

    expect(screen.getByTestId("meraki-appliance-line")).toBeInTheDocument();
    expect(screen.queryByTestId("meraki-appliance-unlink")).toBeNull();
  });

  test("linked a moment ago, its traffic not filed yet: which appliance, and that it comes within minutes", async () => {
    answer(usagePostMock, () => {
      return {
        isAvailable: false,
        deviceAppliance: {
          status: "linked",
          serial: "Q2PN-LDS0-0012",
          name: "LDS MX68",
          isLinkedBySerialNumber: true,
        },
      };
    });

    await renderView(ROUTER);

    expect(screen.getByTestId("meraki-appliance-waiting")).toHaveTextContent(
      "Linked to the Meraki appliance LDS MX68",
    );
    expect(screen.getByTestId("meraki-appliance-waiting")).toHaveTextContent(
      "Its traffic shows here within a few minutes.",
    );
  });

  test("whoever may not change a device's serial number reads why there is no button", async () => {
    recordGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this network device. You need this permission: Edit Network Device.",
    };

    await renderView(ROUTER);

    expect(screen.queryByTestId("meraki-appliance-link")).toBeNull();
    expect(
      screen.getByTestId("meraki-appliance-link-locked"),
    ).toHaveTextContent("Edit Network Device");
  });

  test("a device Meraki has nothing to say of, in a project without Meraki: no switch, as before", async () => {
    answer(usagePostMock, () => {
      return { isAvailable: false };
    });

    await renderView(ROUTER);

    expect(screen.queryByTestId("traffic-source-switch")).toBeNull();
  });
});
