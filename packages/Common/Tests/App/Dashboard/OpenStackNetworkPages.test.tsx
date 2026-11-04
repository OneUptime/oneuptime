import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudFloatingIpDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/FloatingIpDetail";
import OpenStackCloudFloatingIps from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/FloatingIps";
import OpenStackCloudNetworkAgentDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/NetworkAgentDetail";
import OpenStackCloudNetworkAgents from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/NetworkAgents";
import OpenStackCloudNetworkDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/NetworkDetail";
import OpenStackCloudNetworks from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Networks";
import OpenStackCloudRouterDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/RouterDetail";
import OpenStackCloudRouters from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Routers";
import OpenStackCloudSubnetDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/SubnetDetail";
import OpenStackCloudSubnets from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Subnets";
import { OpenStackRecording } from "../../Helpers/OpenStackRecordings";
import {
  CLOUD_PATH,
  ListCall,
  Row,
  attentionRowsOf,
  kindCalls,
  partPath,
  renderPage,
  resetServer,
  server,
  settle,
  tableRow,
  tile,
} from "./OpenStackPartHarness";

/*
 * The network pages, rendered for real over the real tables and part cards, with only the
 * network replaced: networks and subnets, routers, floating IPs and agents. An external
 * network that fills up, a router whose agent stopped and a floating IP that stays down each
 * reach Needs attention by name with their pages saying why, and ML2/OVS and OVN clouds
 * read correctly, down to the real recordings of each.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(300000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

const NETWORK_ID: string = "aaaaaaaa-1111-4111-8111-000000000001";
const PRIVATE_NETWORK_ID: string = "aaaaaaaa-1111-4111-8111-000000000002";
const ROUTER_ID: string = "bbbbbbbb-1111-4111-8111-000000000001";
const FLOATING_IP_ID: string = "cccccccc-1111-4111-8111-000000000001";
const AGENT_ID: string = "dddddddd-1111-4111-8111-000000000001";
const SUBNET_ID: string = "eeeeeeee-1111-4111-8111-000000000001";
const AGENT_ROW_ID: string = "RegionOne/network/net-01/neutron-l3-agent";
const PROJECT_A: string = "ffffffff-0000-4000-8000-00000000000a";
const PROJECT_B: string = "ffffffff-0000-4000-8000-00000000000b";

let nextId: number = 1;

function id(): string {
  return `6c1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
}

function externalNetwork(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Network,
    name: "public",
    externalId: NETWORK_ID,
    regionName: "RegionOne",
    status: "ACTIVE",
    lastSeenAt: new Date(),
    facts: {
      isExternal: true,
      networkType: "flat",
      mtu: 1500,
      ipsUsed: 96,
      ipsTotal: 100,
      ipsBySubnet: {
        "public-subnet": {
          total: 100,
          used: 96,
          cidr: "172.24.4.0/24",
          ipVersion: "4",
        },
        "ipv6-public-subnet": {
          total: 1.8446744073709552e19,
          used: 4,
          cidr: "2001:db8::/64",
          ipVersion: "6",
        },
      },
    },
    ...fields,
  };
}

function privateNetwork(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Network,
    name: "private",
    externalId: PRIVATE_NETWORK_ID,
    regionName: "RegionOne",
    openStackProjectId: PROJECT_A,
    status: "ACTIVE",
    lastSeenAt: new Date(),
    facts: {
      isExternal: false,
      networkType: "vxlan",
      ipsUsed: 254,
      ipsTotal: 254,
    },
    ...fields,
  };
}

function routerRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Router,
    name: "edge",
    externalId: ROUTER_ID,
    regionName: "RegionOne",
    openStackProjectId: PROJECT_A,
    status: "ACTIVE",
    adminState: "up",
    lastSeenAt: new Date(),
    facts: { externalNetworkId: NETWORK_ID },
    ...fields,
  };
}

const ALIVE_ACTIVE: JSONObject = {
  host: "net-01",
  isAlive: true,
  isAdminUp: true,
  haState: "active",
};
const DEAD: JSONObject = {
  host: "net-02",
  isAlive: false,
  isAdminUp: true,
  haState: "standby",
};

function agentRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Service,
    name: "neutron-l3-agent",
    externalId: AGENT_ROW_ID,
    regionName: "RegionOne",
    status: "up",
    adminState: "up",
    lastSeenAt: new Date(),
    facts: { family: "network", host: "net-01", agentId: AGENT_ID },
    ...fields,
  };
}

function floatingIpRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.FloatingIp,
    name: "172.24.4.10",
    externalId: FLOATING_IP_ID,
    regionName: "RegionOne",
    openStackProjectId: PROJECT_A,
    status: "ACTIVE",
    lastSeenAt: new Date(),
    facts: { routerId: ROUTER_ID, floatingNetworkId: NETWORK_ID },
    ...fields,
  };
}

function projectRow(externalId: string, name: string): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Project,
    name,
    externalId,
    status: "enabled",
    lastSeenAt: new Date(),
  };
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Networks page", () => {
  test("external pools come first, in a list of their own, and the rest after them", async () => {
    server.rows = [externalNetwork(), privateNetwork()];

    await renderPage(OpenStackCloudNetworks, "/networks");

    await screen.findByText("External Networks");
    const headings: Array<string> = screen
      .getAllByRole("heading")
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });
    expect(headings.indexOf("External Networks")).toBeLessThan(
      headings.indexOf("Networks"),
    );

    const external: HTMLElement = (await screen.findByText("public")).closest(
      "tr",
    ) as HTMLElement;
    const other: HTMLElement = (await screen.findByText("private")).closest(
      "tr",
    ) as HTMLElement;
    expect(external).not.toBe(other);

    /*
     * Each list asked the server for its own, because a fact can't be sorted by, and a
     * row that doesn't say is not external.
     */
    const networkCalls: Array<ListCall> = kindCalls(
      OpenStackResourceKind.Network,
    );
    expect(
      networkCalls.some((call: ListCall) => {
        return (call.query["facts"] as JSONObject)?.["isExternal"] === true;
      }),
    ).toBe(true);
    expect(
      networkCalls.some((call: ListCall) => {
        return (
          (call.query["facts"] as JSONObject)?.["isExternal"] instanceof
          NotEqual
        );
      }),
    ).toBe(true);
  });

  test("an external pool says what is used in words and colour, and what is left", async () => {
    server.rows = [externalNetwork()];

    await renderPage(OpenStackCloudNetworks, "/networks");

    const row: HTMLElement = (await screen.findByText("public")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("96 of 100")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(row).getByText("96% of addresses used")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("External")).toBeInTheDocument();
  });

  test("days until empty comes from the pool's own history, and says when it can't tell", async () => {
    const hour: number = 60 * 60 * 1000;
    const start: number = Date.now() - 23 * hour;
    server.rows = [externalNetwork()];
    server.history["openstack_neutron_network_ip_availabilities_used"] =
      Array.from({ length: 24 }, (_: unknown, index: number) => {
        return { time: start + index * hour, value: 80 + index * 0.7 };
      });

    await renderPage(OpenStackCloudNetworks, "/networks");

    const row: HTMLElement = (await screen.findByText("public")).closest(
      "tr",
    ) as HTMLElement;
    expect(await within(row).findByText(/^~\d+ days?$/)).toBeInTheDocument();
    cleanup();

    server.history = {};
    await renderPage(OpenStackCloudNetworks, "/networks");
    expect(await screen.findByText("Not enough history")).toBeInTheDocument();
  });

  test("a tenant's own full network asks nothing of anyone, and has no pool forecast", async () => {
    server.rows = [privateNetwork()];

    await renderPage(OpenStackCloudNetworks, "/networks");

    const row: HTMLElement = (await screen.findByText("private")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("254 of 254")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(screen.queryByText("Days Until Empty")).not.toBeInTheDocument();
    expect(screen.queryByText("External Networks")).not.toBeInTheDocument();
  });

  test("security groups are a count per region, and it says how to see them per project", async () => {
    server.rows = [privateNetwork()];
    server.metrics["openstack_neutron_security_groups"] = [
      { group: "RegionOne", value: 6 },
      { group: "RegionTwo", value: 2 },
    ];

    await renderPage(OpenStackCloudNetworks, "/networks");

    await screen.findByTestId("openstack-network-counts");
    expect(screen.getByText("Security Groups")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(
      screen.getByTestId("openstack-security-groups-by-project-off"),
    ).toHaveTextContent(/--disable-metric=neutron-quota_network/);
  });

  test("with a region chosen, the counts and the external list are that region's", async () => {
    server.rows = [
      privateNetwork({ regionName: "RegionTwo" }),
      externalNetwork({ regionName: "RegionOne" }),
    ];
    server.metrics["openstack_neutron_security_groups"] = [
      { group: "RegionOne", value: 6 },
      { group: "RegionTwo", value: 2 },
    ];

    await renderPage(OpenStackCloudNetworks, "/networks?region=RegionTwo");

    const counts: HTMLElement = await screen.findByTestId(
      "openstack-network-counts",
    );
    expect(within(counts).getByText("2")).toBeInTheDocument();
    expect(within(counts).queryByText("8")).not.toBeInTheDocument();
    // Its one external pool is in another region, so this one has no list of them.
    expect(await screen.findByText("private")).toBeInTheDocument();
    expect(screen.queryByText("External Networks")).not.toBeInTheDocument();
  });

  test("with Neutron's quotas on, security groups read per project", async () => {
    server.rows = [privateNetwork()];
    server.metrics["openstack_neutron_security_groups"] = [
      { group: "RegionOne", value: 6 },
    ];
    server.metrics["openstack_neutron_quota_security_group"] = [
      { group: "payments", value: 4 },
      { group: "research", value: 2 },
    ];

    await renderPage(OpenStackCloudNetworks, "/networks");

    const byProject: HTMLElement = await screen.findByTestId(
      "openstack-security-groups-by-project",
    );
    expect(byProject).toHaveTextContent("payments4");
    expect(byProject).toHaveTextContent("research2");
  });

  test("ports are a count, and only by choice: off, it says why and how to turn them on", async () => {
    server.rows = [privateNetwork()];

    await renderPage(OpenStackCloudNetworks, "/networks");

    await screen.findByTestId("openstack-network-counts");
    expect(screen.getByText("Not counted")).toBeInTheDocument();
    expect(screen.getByTestId("openstack-ports-off")).toHaveTextContent(
      /--disable-metric=neutron-ports/,
    );
    cleanup();

    server.metrics["openstack_neutron_ports"] = [
      { group: "RegionOne", value: 42 },
    ];
    await renderPage(OpenStackCloudNetworks, "/networks");
    await screen.findByTestId("openstack-network-counts");
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-ports-off")).toBeNull();
  });

  test("every row one project's says it may not be the whole cloud, and only says may", async () => {
    server.rows = [
      privateNetwork(),
      projectRow(PROJECT_A, "payments"),
      projectRow(PROJECT_B, "research"),
    ];

    await renderPage(OpenStackCloudNetworks, "/networks");

    expect(
      await screen.findByTestId("openstack-limited-view-notice"),
    ).toHaveTextContent(/may not be the whole cloud/);
    cleanup();

    // Only one project is known: that may well be all there is.
    server.rows = [privateNetwork(), projectRow(PROJECT_A, "payments")];
    await renderPage(OpenStackCloudNetworks, "/networks");
    await screen.findByText("private");
    expect(screen.queryByTestId("openstack-limited-view-notice")).toBeNull();
  });
});

describe("a network's page", () => {
  const PATH: string = partPath("networks", NETWORK_ID);

  test("an external one filling up reaches Needs attention by name, and says why", async () => {
    server.rows = [externalNetwork()];

    await renderPage(OpenStackCloudNetworkDetail, PATH);

    expect(
      await screen.findByTestId("openstack-network-explanation"),
    ).toHaveTextContent(/nearly out of addresses/);
    expect(attentionRowsOf("openstack-network-attention")).toEqual([
      "This network: 96% of addresses used",
    ]);
    expect(
      screen
        .getAllByTestId("openstack-network-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["External"]);
    expect(tile("openstack-network-tiles", "Addresses used")).toHaveTextContent(
      "96%96 of 100",
    );
    expect(tile("openstack-network-tiles", "Addresses free")).toHaveTextContent(
      "4",
    );
  });

  test("one with none left is critical, and says what stops working", async () => {
    server.rows = [
      externalNetwork({
        facts: { isExternal: true, ipsUsed: 100, ipsTotal: 100 },
      }),
    ];

    await renderPage(OpenStackCloudNetworkDetail, PATH);

    expect(
      await screen.findByTestId("openstack-network-explanation"),
    ).toHaveTextContent(/no addresses left/);
    expect(attentionRowsOf("openstack-network-attention")).toEqual([
      "This network: No addresses left",
    ]);
    expect(
      screen.getAllByTestId("openstack-network-attention-item")[0],
    ).toHaveAttribute("data-severity", "critical");
  });

  test("its subnets: an IPv4 share, and an IPv6 count with no share of a /64", async () => {
    server.rows = [externalNetwork()];

    await renderPage(OpenStackCloudNetworkDetail, PATH);

    const rows: Array<string> = (
      await screen.findAllByTestId("openstack-network-subnet")
    ).map((row: HTMLElement) => {
      return row.textContent || "";
    });
    expect(rows[0]).toContain("public-subnet");
    expect(rows[0]).toContain("172.24.4.0/24");
    expect(rows[0]).toContain("96 of 100 (96%)");
    expect(rows[1]).toContain("ipv6-public-subnet");
    expect(rows[1]).toContain("4 used");
    expect(rows[1]).not.toContain("%");
  });

  test("its forecast says when there isn't enough history", async () => {
    server.rows = [externalNetwork()];

    await renderPage(OpenStackCloudNetworkDetail, PATH);

    expect(await screen.findByText("Not enough history")).toBeInTheDocument();
    expect(
      tile("openstack-network-tiles", "Growth Forecast"),
    ).toHaveTextContent("Not enough history");
  });

  test("its alerts are the external pool's, and a tenant's network has none to offer", async () => {
    server.rows = [externalNetwork()];
    await renderPage(OpenStackCloudNetworkDetail, PATH);
    expect(
      within(await screen.findByTestId("openstack-network-alerts"))
        .getAllByTestId("openstack-network-alerts-item")
        .map((item: HTMLElement) => {
          return item.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual(["External IP Pool Nearly Full", "Network Out of IPs"]);
    cleanup();

    server.rows = [privateNetwork()];
    await renderPage(
      OpenStackCloudNetworkDetail,
      partPath("networks", PRIVATE_NETWORK_ID),
    );
    await screen.findByTestId("openstack-network-overview");
    expect(screen.queryByTestId("openstack-network-alerts")).toBeNull();
    expect(screen.queryByTestId("openstack-network-explanation")).toBeNull();
    expect(screen.queryByTestId("openstack-network-attention")).toBeNull();
  });

  test("an external one's tabs: its subnets, routers through it and addresses from it, on the server", async () => {
    server.rows = [
      externalNetwork(),
      routerRow(),
      floatingIpRow(),
      {
        _id: id(),
        kind: OpenStackResourceKind.Subnet,
        name: "public-subnet",
        externalId: SUBNET_ID,
        regionName: "RegionOne",
        facts: { networkId: NETWORK_ID, cidr: "172.24.4.0/24" },
      },
    ];

    await renderPage(OpenStackCloudNetworkDetail, PATH);

    fireEvent.click(await screen.findByRole("tab", { name: "Routers" }));
    await settle();
    expect(await screen.findByText("edge")).toBeInTheDocument();
    expect(
      kindCalls(OpenStackResourceKind.Router).some((call: ListCall) => {
        return (
          (call.query["facts"] as JSONObject)?.["externalNetworkId"] ===
          NETWORK_ID
        );
      }),
    ).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Floating IPs" }));
    await settle();
    expect(await screen.findByText("172.24.4.10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Subnets" }));
    await settle();
    expect(await screen.findByText("public-subnet")).toBeInTheDocument();
  });

  test("a read that failed says so with Try again", async () => {
    server.failKinds.add(OpenStackResourceKind.Network);

    await renderPage(OpenStackCloudNetworkDetail, PATH);

    expect(
      await screen.findByTestId("openstack-part-read-error"),
    ).toHaveTextContent("Couldn't load this network");
  });
});

describe("subnets", () => {
  test("the list: its CIDR, gateway, DHCP and a step to its network", async () => {
    server.rows = [
      externalNetwork(),
      {
        _id: id(),
        kind: OpenStackResourceKind.Subnet,
        name: "public-subnet",
        externalId: SUBNET_ID,
        regionName: "RegionOne",
        facts: {
          networkId: NETWORK_ID,
          cidr: "172.24.4.0/24",
          gatewayIp: "172.24.4.1",
          enableDhcp: false,
        },
      },
    ];

    await renderPage(OpenStackCloudSubnets, "/subnets");

    const row: HTMLElement = (await screen.findByText("public-subnet")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("172.24.4.0/24")).toBeInTheDocument();
    expect(within(row).getByText("172.24.4.1")).toBeInTheDocument();
    expect(within(row).getByText("Off")).toBeInTheDocument();
    expect(
      (await within(row).findByText("public")).closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/networks/${NETWORK_ID}`);
  });

  test("a page reads its addresses from its network's row", async () => {
    server.rows = [
      externalNetwork(),
      {
        _id: id(),
        kind: OpenStackResourceKind.Subnet,
        name: "public-subnet",
        externalId: SUBNET_ID,
        regionName: "RegionOne",
        facts: { networkId: NETWORK_ID, cidr: "172.24.4.0/24" },
      },
    ];

    await renderPage(
      OpenStackCloudSubnetDetail,
      partPath("subnets", SUBNET_ID),
    );

    await screen.findByTestId("openstack-subnet-tiles");
    expect(
      await within(screen.getByTestId("openstack-subnet-tiles")).findByText(
        "96%",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("openstack-subnet-details-network"),
    ).toHaveTextContent("public");
  });

  test("an IPv6 one says how many are in use, and no share of a /64", async () => {
    server.rows = [
      externalNetwork(),
      {
        _id: id(),
        kind: OpenStackResourceKind.Subnet,
        name: "ipv6-public-subnet",
        externalId: SUBNET_ID,
        regionName: "RegionOne",
        facts: { networkId: NETWORK_ID, cidr: "2001:db8::/64" },
      },
    ];

    await renderPage(
      OpenStackCloudSubnetDetail,
      partPath("subnets", SUBNET_ID),
    );

    await screen.findByTestId("openstack-subnet-tiles");
    expect(tile("openstack-subnet-tiles", "Addresses used")).toHaveTextContent(
      "4in use",
    );
  });
});

describe("routers", () => {
  const OVS_AGENT: Row = agentRow();

  test("on ML2/OVS the list names how many agents are alive, and which is active", async () => {
    server.rows = [
      OVS_AGENT,
      routerRow({
        facts: {
          externalNetworkId: NETWORK_ID,
          l3Agents: { a: ALIVE_ACTIVE, b: DEAD },
        },
      }),
      externalNetwork(),
    ];

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("edge")).closest(
      "tr",
    ) as HTMLElement;
    expect(
      within(row).getByText("1 of 2 alive, active on net-01"),
    ).toBeInTheDocument();
    expect(
      (await within(row).findByText("public")).closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/networks/${NETWORK_ID}`);
  });

  test("a router with no alive agent reads critical in the list, whatever its own word says", async () => {
    server.rows = [
      OVS_AGENT,
      routerRow({
        facts: { l3Agents: { b: DEAD } },
      }),
    ];

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("edge")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(within(row).getByText("No alive L3 agent")).toBeInTheDocument();
    expect(within(row).getByText("0 of 1 alive")).toBeInTheDocument();
  });

  test("on OVN it reads Not applicable, and nothing is wrong", async () => {
    server.rows = [
      agentRow({
        name: "ovn-controller",
        externalId: "RegionOne/network/net-01/ovn-controller",
      }),
      routerRow(),
    ];

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("edge")).closest(
      "tr",
    ) as HTMLElement;
    expect(await within(row).findByText("Not applicable")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "positive",
    );
  });

  test("with the agents not listed it says Not reported, and never calls that missing", async () => {
    server.rows = [routerRow()];

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("edge")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Not reported")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "positive",
    );
  });

  test("one someone set down reads Disabled", async () => {
    server.rows = [routerRow({ adminState: "down" })];

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("edge")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Disabled")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(within(row).getByText("down")).toBeInTheDocument();
  });

  describe("a router's page", () => {
    const PATH: string = partPath("routers", ROUTER_ID);

    test("one whose agent stopped says why, names the agent, and links to it", async () => {
      server.rows = [
        OVS_AGENT,
        routerRow({
          facts: { l3Agents: { a: { ...DEAD, host: "net-01" } } },
        }),
      ];

      await renderPage(OpenStackCloudRouterDetail, PATH);

      expect(
        await screen.findByTestId("openstack-router-explanation"),
      ).toHaveTextContent(/No L3 agent holding this router is alive/);
      expect(attentionRowsOf("openstack-router-attention")).toEqual([
        "This router: No alive L3 agent",
      ]);
      const agent: HTMLElement = screen.getByTestId("openstack-router-agent");
      expect(agent).toHaveAttribute("data-alive", "false");
      expect(agent).toHaveTextContent("Not alive");
      expect(within(agent).getByText("net-01").closest("a")).toHaveAttribute(
        "href",
        `${CLOUD_PATH}/network-agents/${encodeURIComponent(AGENT_ROW_ID)}`,
      );
    });

    test("two active agents say split brain", async () => {
      server.rows = [
        OVS_AGENT,
        routerRow({
          facts: {
            l3Agents: {
              a: ALIVE_ACTIVE,
              b: { ...ALIVE_ACTIVE, host: "net-02" },
            },
          },
        }),
      ];

      await renderPage(OpenStackCloudRouterDetail, PATH);

      expect(
        await screen.findByTestId("openstack-router-explanation"),
      ).toHaveTextContent(/split brain/);
      expect(attentionRowsOf("openstack-router-attention")).toEqual([
        "This router: Two active L3 agents",
      ]);
    });

    test("on OVN it says there's no agent to be missing, and nothing needs anyone", async () => {
      server.rows = [
        agentRow({
          name: "ovn-controller",
          externalId: "RegionOne/network/net-01/ovn-controller",
        }),
        routerRow(),
      ];

      await renderPage(OpenStackCloudRouterDetail, PATH);

      expect(
        await screen.findByTestId("openstack-router-ovn"),
      ).toHaveTextContent(/this is not a fault/);
      expect(tile("openstack-router-tiles", "L3 agents")).toHaveTextContent(
        "Not applicable",
      );
      expect(screen.queryByTestId("openstack-router-attention")).toBeNull();
      expect(screen.queryByTestId("openstack-router-explanation")).toBeNull();
    });

    test("what it takes with it: the floating IPs through it, whose they are", async () => {
      server.rows = [
        routerRow(),
        floatingIpRow(),
        projectRow(PROJECT_A, "payments"),
      ];

      await renderPage(OpenStackCloudRouterDetail, PATH);

      const blast: HTMLElement = await screen.findByTestId(
        "openstack-router-blast",
      );
      expect(
        within(blast).getByTestId("openstack-router-blast-counts"),
      ).toHaveTextContent("1 floating IPin 1 project");
      expect(blast).toHaveTextContent("payments");
    });

    test("its external network reads by name, a step away", async () => {
      server.rows = [routerRow(), externalNetwork()];

      await renderPage(OpenStackCloudRouterDetail, PATH);

      const row: HTMLElement = await screen.findByTestId(
        "openstack-router-details-external-network",
      );
      expect(
        (await within(row).findByText("public")).closest("a"),
      ).toHaveAttribute("href", `${CLOUD_PATH}/networks/${NETWORK_ID}`);
    });

    test("its alerts are the router templates", async () => {
      server.rows = [routerRow()];

      await renderPage(OpenStackCloudRouterDetail, PATH);

      expect(
        within(await screen.findByTestId("openstack-router-alerts"))
          .getAllByTestId("openstack-router-alerts-item")
          .map((item: HTMLElement) => {
            return item.querySelector("div.font-medium")?.textContent;
          }),
      ).toEqual([
        "Router Not Active",
        "Router Without Active Agent",
        "Router With Two Active Agents",
      ]);
    });

    test("its Floating IPs tab reads what goes through it, on the server", async () => {
      server.rows = [
        routerRow(),
        floatingIpRow(),
        floatingIpRow({
          name: "172.24.4.11",
          externalId: "cccccccc-1111-4111-8111-000000000002",
          facts: { routerId: "someone-else" },
        }),
      ];

      await renderPage(OpenStackCloudRouterDetail, PATH);
      fireEvent.click(await screen.findByRole("tab", { name: "Floating IPs" }));
      await settle();

      expect(await screen.findByText("172.24.4.10")).toBeInTheDocument();
      expect(screen.queryByText("172.24.4.11")).not.toBeInTheDocument();
    });
  });
});

describe("floating IPs", () => {
  test("the list says associated, unassociated and associated but not active, and where each goes", async () => {
    server.rows = [
      routerRow(),
      externalNetwork(),
      floatingIpRow(),
      floatingIpRow({
        name: "172.24.4.11",
        externalId: "cccccccc-1111-4111-8111-000000000002",
        status: "DOWN",
        facts: { routerId: null, floatingNetworkId: NETWORK_ID },
      }),
      floatingIpRow({
        name: "172.24.4.12",
        externalId: "cccccccc-1111-4111-8111-000000000003",
        status: "DOWN",
        facts: { routerId: ROUTER_ID, floatingNetworkId: NETWORK_ID },
      }),
    ];

    await renderPage(OpenStackCloudFloatingIps, "/floating-ips");

    const inUse: HTMLElement = (await screen.findByText("172.24.4.10")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(inUse).getByText("Associated")).toBeInTheDocument();
    expect(
      (await within(inUse).findByText("edge")).closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/routers/${ROUTER_ID}`);

    const spare: HTMLElement = tableRow("172.24.4.11");
    expect(within(spare).getByText("Unassociated")).toBeInTheDocument();
    expect(within(spare).getByText("DOWN")).toHaveAttribute(
      "data-tone",
      "neutral",
    );

    const down: HTMLElement = tableRow("172.24.4.12");
    expect(
      within(down).getByText("Associated, not active"),
    ).toBeInTheDocument();
    expect(within(down).getByText("DOWN")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    // A column of nothing the exporter never says.
    expect(screen.queryByText("Fixed Address")).not.toBeInTheDocument();
  });

  test("a page: stays down, reaches Needs attention by name, and says why", async () => {
    server.rows = [
      routerRow(),
      externalNetwork(),
      floatingIpRow({ status: "DOWN" }),
    ];

    await renderPage(
      OpenStackCloudFloatingIpDetail,
      partPath("floating-ips", FLOATING_IP_ID),
    );

    expect(
      await screen.findByTestId("openstack-floating-ip-explanation"),
    ).toHaveTextContent(/may not be arriving/);
    expect(attentionRowsOf("openstack-floating-ip-attention")).toEqual([
      "This floating IP: Associated, but not active",
    ]);
    expect(
      screen.getByTestId("openstack-floating-ip-hero-name"),
    ).toHaveTextContent("172.24.4.10");
    expect(
      await within(
        screen.getByTestId("openstack-floating-ip-details-router"),
      ).findByText("edge"),
    ).toBeInTheDocument();
    expect(
      await within(
        screen.getByTestId("openstack-floating-ip-details-network"),
      ).findByText("public"),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("openstack-floating-ip-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["Associated, not active"]);
  });

  test("a spare one says it's waiting and nothing is wrong", async () => {
    server.rows = [
      floatingIpRow({ status: "DOWN", facts: { routerId: null } }),
    ];

    await renderPage(
      OpenStackCloudFloatingIpDetail,
      partPath("floating-ips", FLOATING_IP_ID),
    );

    expect(
      await screen.findByTestId("openstack-floating-ip-spare"),
    ).toHaveTextContent(/nothing is wrong/);
    expect(screen.queryByTestId("openstack-floating-ip-attention")).toBeNull();
  });
});

describe("network agents", () => {
  test("the list links to the Services page, and an agent to its own page", async () => {
    server.rows = [agentRow()];

    await renderPage(OpenStackCloudNetworkAgents, "/network-agents");

    expect(
      within(await screen.findByTestId("openstack-network-agents-services"))
        .getByText("Services")
        .closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/services`);
    const row: HTMLElement = (await screen.findByText("net-01")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("neutron-l3-agent")).toBeInTheDocument();
    // Its state and its admin state, each in Neutron's word.
    expect(within(row).getAllByText("up")).toHaveLength(2);
  });

  test("with Neutron answering and none listed, it says this credential can't list them", async () => {
    server.rows = [
      {
        kind: OpenStackResourceKind.Api,
        name: "network",
        externalId: "RegionOne/network",
        status: "up",
      },
    ];

    await renderPage(OpenStackCloudNetworkAgents, "/network-agents");

    expect(
      await screen.findByText("This credential can't list network agents"),
    ).toBeInTheDocument();
  });

  test("an L3 agent's page lists the routers it holds, by its own id", async () => {
    server.rows = [
      agentRow(),
      routerRow({
        facts: { l3Agents: { [AGENT_ID]: ALIVE_ACTIVE } },
      }),
      routerRow({
        name: "elsewhere",
        externalId: "bbbbbbbb-1111-4111-8111-000000000002",
        facts: { l3Agents: { "another-agent": ALIVE_ACTIVE } },
      }),
    ];

    await renderPage(
      OpenStackCloudNetworkAgentDetail,
      partPath("network-agents", AGENT_ROW_ID),
    );

    expect(
      await screen.findByTestId("openstack-network-agent-hero-location"),
    ).toHaveTextContent("On host net-01 of cloud prod-eu");
    expect(
      screen.queryByTestId("openstack-network-agent-serves-unknown"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Routers" }));
    await settle();

    expect(await screen.findByText("edge")).toBeInTheDocument();
    expect(screen.queryByText("elsewhere")).not.toBeInTheDocument();
    expect(
      kindCalls(OpenStackResourceKind.Router).some((call: ListCall) => {
        const asked: unknown = (call.query["facts"] as JSONObject)?.[
          "l3Agents"
        ];
        return asked instanceof Search && asked.value === AGENT_ID;
      }),
    ).toBe(true);
  });

  test("a stopped one reaches Needs attention by name", async () => {
    server.rows = [agentRow({ status: "down" })];

    await renderPage(
      OpenStackCloudNetworkAgentDetail,
      partPath("network-agents", AGENT_ROW_ID),
    );

    await screen.findByTestId("openstack-network-agent-attention");
    expect(attentionRowsOf("openstack-network-agent-attention")).toEqual([
      "This agent: Down",
    ]);
    expect(
      within(screen.getByTestId("openstack-network-agent-alerts"))
        .getAllByTestId("openstack-network-agent-alerts-item")
        .map((item: HTMLElement) => {
          return item.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual(["Network Agent Down"]);
  });

  test("a DHCP agent says what it serves isn't collected, rather than listing nothing", async () => {
    const dhcp: string = "RegionOne/network/net-01/neutron-dhcp-agent";
    server.rows = [agentRow({ name: "neutron-dhcp-agent", externalId: dhcp })];

    await renderPage(
      OpenStackCloudNetworkAgentDetail,
      partPath("network-agents", dhcp),
    );

    expect(
      await screen.findByTestId("openstack-network-agent-serves-unknown"),
    ).toHaveTextContent(/isn't in what's collected/);
    expect(screen.queryByRole("tab", { name: "Routers" })).toBeNull();
  });
});

describe("on what real clouds said", () => {
  function load(release: string, scene: string): void {
    const recording: OpenStackRecording = new OpenStackRecording(
      release,
      scene,
    );
    server.rows = recording.rows.map(
      (row: OpenStackResource, index: number) => {
        return {
          ...row,
          _id: `6c1b2a3d-4e5f-4a6b-8c7d-${String(index).padStart(12, "0")}`,
        } as Row;
      },
    );
  }

  function named(kind: OpenStackResourceKind, name: string): Row {
    return server.rows.find((row: Row) => {
      return row.kind === kind && row.name === name;
    })!;
  }

  test("ML2/OVS: a router names the agent holding it, and its row is where the link goes", async () => {
    load("gazpacho-ovs", "healthy");

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("ou-router")).closest(
      "tr",
    ) as HTMLElement;
    expect(await within(row).findByText(/1 of 1 alive/)).toBeInTheDocument();
    cleanup();

    await renderPage(
      OpenStackCloudRouterDetail,
      partPath(
        "routers",
        named(OpenStackResourceKind.Router, "ou-router").externalId as string,
      ),
    );
    const agent: HTMLElement = await screen.findByTestId(
      "openstack-router-agent",
    );
    expect(agent).toHaveAttribute("data-alive", "true");
    const href: string =
      within(agent).getByRole("link").getAttribute("href") || "";
    const agentRowId: string = decodeURIComponent(href.split("/").pop() || "");
    expect(
      server.rows.some((candidate: Row) => {
        return (
          candidate.kind === OpenStackResourceKind.Service &&
          candidate.externalId === agentRowId
        );
      }),
    ).toBe(true);
  });

  test("OVN: a router's agents read Not applicable, and nothing needs anyone", async () => {
    load("hibiscus-ovn", "healthy");

    await renderPage(OpenStackCloudRouters, "/routers");

    const row: HTMLElement = (await screen.findByText("ou-router")).closest(
      "tr",
    ) as HTMLElement;
    expect(await within(row).findByText("Not applicable")).toBeInTheDocument();
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "positive",
    );
  });

  test("the real dual-stack public network reads its IPv4 pool, not a /64", async () => {
    load("gazpacho-ovs", "healthy");
    const network: Row = named(OpenStackResourceKind.Network, "public");

    await renderPage(
      OpenStackCloudNetworkDetail,
      partPath("networks", network.externalId as string),
    );

    await screen.findByTestId("openstack-network-tiles");
    expect(tile("openstack-network-tiles", "Addresses used")).toHaveTextContent(
      /\d of 253/,
    );
  });

  test("the real floating IPs: one through a real router, and one spare", async () => {
    load("gazpacho-ovs", "healthy");

    await renderPage(OpenStackCloudFloatingIps, "/floating-ips");

    expect(await screen.findByText("Associated")).toBeInTheDocument();
    expect(screen.getByText("Unassociated")).toBeInTheDocument();
    expect(await screen.findByText("ou-router")).toBeInTheDocument();
  });
});
