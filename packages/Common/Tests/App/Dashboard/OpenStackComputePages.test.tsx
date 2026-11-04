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
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import Includes from "../../../Types/BaseDatabase/Includes";
import Navigation from "../../../UI/Utils/Navigation";
import { getOpenStackFlavorExternalId } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackPartFacts";
import OpenStackCloudAggregateDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AggregateDetail";
import OpenStackCloudAggregates from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Aggregates";
import OpenStackCloudAvailabilityZoneDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AvailabilityZoneDetail";
import OpenStackCloudAvailabilityZones from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AvailabilityZones";
import OpenStackCloudFlavorDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/FlavorDetail";
import OpenStackCloudFlavors from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Flavors";
import OpenStackCloudHypervisorDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/HypervisorDetail";
import OpenStackCloudHypervisors from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Hypervisors";
import OpenStackCloudInstanceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/InstanceDetail";
import OpenStackCloudInstances from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Instances";
import {
  OpenStackRecording,
  getOpenStackDrilledReleases,
} from "../../Helpers/OpenStackRecordings";
import {
  CLOUD_ID,
  CLOUD_PATH,
  HYPERVISOR_ID,
  HYPERVISOR_NAME,
  READ_FAILED,
  Row,
  attentionRowsOf,
  computeServiceRow,
  hypervisorRow,
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
 * The compute pages, rendered for real over the real tables and part cards, with only the
 * network replaced: hypervisors, instances, availability zones, aggregates and flavors.
 * What a source-level test can't see: that a lost hypervisor says its numbers are last
 * known, that a failed instance with no hypervisor reads as that and not as a gap, and that
 * every list reads a page of rows from the server.
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
      default: (props: { queryConfigs: Array<any> }) => {
        return (
          <div data-testid="resource-metrics-tab">
            {props.queryConfigs.map((config: any) => {
              return (
                <div
                  key={config.metricAliasData.metricVariable}
                  data-testid="metric-query"
                  data-metric={config.metricQueryData.filterData.metricName}
                  data-attributes={JSON.stringify(
                    config.metricQueryData.filterData.attributes,
                  )}
                >
                  {config.metricAliasData.title}
                </div>
              );
            })}
          </div>
        );
      },
    };
  },
);

const INSTANCE_ID: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function instanceRow(fields: Row = {}): Row {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000011",
    kind: OpenStackResourceKind.Instance,
    name: "web-01",
    externalId: INSTANCE_ID,
    regionName: "RegionOne",
    availabilityZone: "az1",
    hypervisorName: HYPERVISOR_NAME,
    openStackProjectId: PROJECT_A,
    status: "ACTIVE",
    stateChangedAt: minutesAgo(5),
    facts: { flavorId: "m1.small", libvirtName: "instance-00000001" },
    lastSeenAt: new Date(),
    ...fields,
  };
}

function flavorRow(fields: Row = {}): Row {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000021",
    kind: OpenStackResourceKind.Flavor,
    name: "Small",
    externalId: getOpenStackFlavorExternalId("RegionOne", "m1.small"),
    regionName: "RegionOne",
    vcpuCapacity: 2,
    memoryCapacityBytes: 4 * 1024 * 1024 * 1024,
    diskCapacityBytes: 40 * 1024 * 1024 * 1024,
    facts: { isPublic: true },
    lastSeenAt: new Date(),
    ...fields,
  };
}

function projectRow(): Row {
  return {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000031",
    kind: OpenStackResourceKind.Project,
    name: "payments",
    externalId: PROJECT_A,
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

describe("the Hypervisors list", () => {
  test("says allocated with its ratio, and opens a hypervisor's page on a click", async () => {
    server.rows = [hypervisorRow()];
    const navigate: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    const row: HTMLElement = await screen
      .findByText(HYPERVISOR_NAME)
      .then((cell: HTMLElement) => {
        return cell.closest("tr") as HTMLElement;
      });
    expect(within(row).getByText("12 of 64 (19%)")).toBeInTheDocument();
    expect(within(row).getByText("ratio 16:1")).toBeInTheDocument();
    expect(screen.getByText("vCPUs Allocated")).toBeInTheDocument();
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
    expect(within(row).getByText("up")).toHaveAttribute(
      "data-tone",
      "positive",
    );

    fireEvent.click(within(row).getByText("up"));
    await settle();

    expect(navigate).toHaveBeenCalled();
    expect(String(navigate.mock.calls[0]![0])).toContain(
      `${CLOUD_PATH}/hypervisors/${encodeURIComponent(HYPERVISOR_ID)}`,
    );
  });

  test("a lost hypervisor says so, and that its numbers are last known", async () => {
    server.rows = [hypervisorRow({ status: "down" })];

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    const row: HTMLElement = (
      await screen.findByText(HYPERVISOR_NAME)
    ).closest("tr") as HTMLElement;
    expect(within(row).getByText("Lost")).toHaveAttribute("data-tone", "danger");
    expect(
      within(row).getByText("nova-compute is down. Its numbers are last known"),
    ).toBeInTheDocument();
    expect(within(row).getAllByText("last known").length).toBeGreaterThan(0);
    // Its ratio would read as what it can still promise: it can promise nothing.
    expect(within(row).queryByText("ratio 16:1")).not.toBeInTheDocument();
  });

  test("one someone disabled reads Disabled with their reason, never as a failure", async () => {
    server.rows = [
      hypervisorRow({
        status: "down",
        adminState: "disabled",
        disabledReason: "Hardware swap, CHG-1042",
      }),
    ];

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    const row: HTMLElement = (
      await screen.findByText(HYPERVISOR_NAME)
    ).closest("tr") as HTMLElement;
    expect(within(row).getByText("Disabled")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(within(row).getByText("Hardware swap, CHG-1042")).toBeInTheDocument();
    expect(row.querySelector('[data-tone="danger"]')).toBeNull();
  });

  test("past the allocation line reads in words and colour", async () => {
    server.rows = [hypervisorRow({ vcpuAllocated: 60 })];

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    const row: HTMLElement = (
      await screen.findByText(HYPERVISOR_NAME)
    ).closest("tr") as HTMLElement;
    expect(within(row).getByText("up")).toHaveAttribute("data-tone", "warning");
    expect(within(row).getByText("94% of vCPUs allocated")).toBeInTheDocument();
  });

  test("a column no row holds is not drawn, and is once one does", async () => {
    server.rows = [hypervisorRow()];
    await renderPage(OpenStackCloudHypervisors, "/hypervisors");
    await screen.findByText(HYPERVISOR_NAME);
    expect(screen.queryByText("Aggregates")).not.toBeInTheDocument();
    cleanup();

    server.rows = [hypervisorRow({ facts: { aggregates: "ssd,gpu" } })];
    await renderPage(OpenStackCloudHypervisors, "/hypervisors");
    await screen.findByText(HYPERVISOR_NAME);
    expect(await screen.findByText("Aggregates")).toBeInTheDocument();
    expect(screen.getByText("ssd, gpu")).toBeInTheDocument();
  });

  test("reads one page of hypervisors, and needs no join to its nova-compute", async () => {
    server.rows = [hypervisorRow()];

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");
    await screen.findByText(HYPERVISOR_NAME);

    for (const call of kindCalls(OpenStackResourceKind.Hypervisor)) {
      expect(call.limit).toBeLessThanOrEqual(500);
    }
    expect(kindCalls(OpenStackResourceKind.Service)).toEqual([]);
  });

  describe("an empty list", () => {
    test("with Nova answering says this credential can't list them, with the fix", async () => {
      server.rows = [
        {
          kind: OpenStackResourceKind.Api,
          name: "compute",
          externalId: "RegionOne/compute",
          status: "up",
        },
      ];

      await renderPage(OpenStackCloudHypervisors, "/hypervisors");

      expect(
        await screen.findByText("This credential can't list hypervisors"),
      ).toBeInTheDocument();
      expect(screen.getByText(/troubleshoot\.sh/)).toBeInTheDocument();
    });

    test("with Nova not answering says that", async () => {
      server.rows = [
        {
          kind: OpenStackResourceKind.Api,
          name: "compute",
          externalId: "RegionOne/compute",
          status: "down",
        },
      ];

      await renderPage(OpenStackCloudHypervisors, "/hypervisors");

      expect(
        await screen.findByText("This service's API isn't answering"),
      ).toBeInTheDocument();
    });

    test("with nothing reported yet says that, and blames nobody's credential", async () => {
      await renderPage(OpenStackCloudHypervisors, "/hypervisors");

      expect(
        await screen.findByText("No hypervisors reported yet"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("This credential can't list hypervisors"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("a hypervisor's page", () => {
  const PATH: string = partPath("hypervisors", HYPERVISOR_ID);

  test("its hero: its state, its zone and region a step away", async () => {
    server.rows = [hypervisorRow()];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    expect(
      await screen.findByTestId("openstack-hypervisor-hero-name"),
    ).toHaveTextContent(HYPERVISOR_NAME);
    expect(
      screen.getByTestId("openstack-hypervisor-hero-status"),
    ).toHaveTextContent("up");
    const location: HTMLElement = screen.getByTestId(
      "openstack-hypervisor-hero-location",
    );
    expect(location).toHaveTextContent(
      "In zone az1 of region RegionOne of cloud prod-eu",
    );
    expect(within(location).getByText("az1").closest("a")).toHaveAttribute(
      "href",
      `${CLOUD_PATH}/availability-zones/${encodeURIComponent("RegionOne/az1")}`,
    );
  });

  test("its tiles say allocated, at Placement's ratio, and running instances", async () => {
    server.rows = [hypervisorRow()];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);
    await screen.findByTestId("openstack-hypervisor-tiles");

    expect(
      tile("openstack-hypervisor-tiles", "vCPUs allocated"),
    ).toHaveTextContent("19%12 of 64, ratio 16:1");
    expect(
      tile("openstack-hypervisor-tiles", "Memory allocated"),
    ).toHaveTextContent("13%16.0 GiB of 128 GiB, ratio 1.5:1");
    expect(
      tile("openstack-hypervisor-tiles", "Local disk allocated"),
    ).toHaveTextContent("10%");
    expect(tile("openstack-hypervisor-tiles", "Instances")).toHaveTextContent(
      "5running",
    );
    expect(screen.queryByTestId("openstack-hypervisor-lost")).toBeNull();
  });

  test("a lost one says so first, and every number is last known with no bar to read as room", async () => {
    server.rows = [
      hypervisorRow({ status: "down" }),
      computeServiceRow({ status: "down" }),
    ];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    expect(
      await screen.findByTestId("openstack-hypervisor-lost"),
    ).toHaveTextContent(/Nova has lost this hypervisor/);
    expect(
      screen.getByTestId("openstack-hypervisor-hero-status"),
    ).toHaveTextContent("Lost");
    expect(
      screen
        .getAllByTestId("openstack-hypervisor-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["Last known"]);
    expect(
      tile("openstack-hypervisor-tiles", "vCPUs allocated"),
    ).toHaveTextContent("12 of 64, last known");
    expect(tile("openstack-hypervisor-tiles", "Instances")).toHaveTextContent(
      "last known",
    );
    /*
     * Its nova-compute is what says it is down, and by the short name the service goes
     * by, how many instances it took with it.
     */
    expect(attentionRowsOf("openstack-hypervisor-attention")).toEqual([
      "nova-compute: Down, with 5 instances on it",
    ]);
    const asked: Array<unknown> = kindCalls(OpenStackResourceKind.Service).map(
      (call) => {
        return (call.query["hypervisorName"] as Includes).values;
      },
    );
    expect(asked).toEqual([["compute-07", HYPERVISOR_NAME]]);
  });

  test("what needs attention: its own allocation, and the instances on it by name", async () => {
    server.rows = [
      hypervisorRow({ vcpuAllocated: 60 }),
      computeServiceRow(),
      instanceRow({
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000012",
        externalId: "22222222-2222-4222-8222-222222222222",
        name: "broken",
        status: "ERROR",
      }),
      instanceRow(),
    ];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);
    await screen.findByTestId("openstack-hypervisor-attention");

    expect(attentionRowsOf("openstack-hypervisor-attention")).toEqual([
      "This hypervisor: 94% of vCPUs allocated",
      "broken: In ERROR",
    ]);
    // Asked for by the words the rules read, never the host's every instance.
    const instanceCalls = kindCalls(OpenStackResourceKind.Instance);
    expect(instanceCalls).toHaveLength(1);
    expect(instanceCalls[0]!.limit).toBe(100);
    expect(instanceCalls[0]!.query["status"]).toBeInstanceOf(Includes);
  });

  test("its Instances tab is the Instances list, scoped on the server", async () => {
    server.rows = [
      hypervisorRow(),
      instanceRow(),
      instanceRow({
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000013",
        externalId: "33333333-3333-4333-8333-333333333333",
        name: "elsewhere",
        hypervisorName: "compute-08.example.internal",
      }),
    ];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);
    fireEvent.click(await screen.findByRole("tab", { name: /Instances/ }));
    await settle();

    expect(await screen.findByText("web-01")).toBeInTheDocument();
    expect(screen.queryByText("elsewhere")).not.toBeInTheDocument();
    const scoped = kindCalls(OpenStackResourceKind.Instance).filter((call) => {
      return call.query["hypervisorName"] === HYPERVISOR_NAME && !call.query["status"];
    });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped[0]!.query["regionName"]).toBe("RegionOne");
    expect(scoped[0]!.limit).toBeLessThanOrEqual(100);
  });

  test("what it takes with it: how many instances, in how many projects, by name", async () => {
    server.rows = [hypervisorRow(), instanceRow(), projectRow()];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    const blast: HTMLElement = await screen.findByTestId(
      "openstack-hypervisor-blast",
    );
    expect(
      within(blast).getByTestId("openstack-hypervisor-blast-counts"),
    ).toHaveTextContent("1 instancein 1 project");
    const project: HTMLElement = within(blast).getByTestId(
      "openstack-hypervisor-blast-project",
    );
    expect(project).toHaveTextContent("payments");
    expect(within(project).getByRole("link")).toHaveAttribute(
      "href",
      `${CLOUD_PATH}/projects/${PROJECT_A}`,
    );
  });

  test("a failed read of what it takes says so in its own frame, with a way to read again", async () => {
    server.rows = [hypervisorRow()];
    server.failPosts.add("blast-radius");

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    expect(
      await screen.findByTestId("openstack-hypervisor-blast-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-hypervisor-blast")).toBeNull();
  });

  test("its alerts: Turn on N alerts goes to Recommendations with them ticked", async () => {
    server.rows = [hypervisorRow()];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    const alerts: HTMLElement = await screen.findByTestId(
      "openstack-hypervisor-alerts",
    );
    expect(
      within(alerts)
        .getAllByTestId("openstack-hypervisor-alerts-item")
        .map((item: HTMLElement) => {
          return item.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual([
      "Compute Service Down",
      "vCPU Allocation High",
      "Memory Allocation High",
      "Local Disk Allocation High",
    ]);
    const turnOn: HTMLElement = within(alerts).getByTestId(
      "openstack-hypervisor-alerts-turn-on",
    );
    expect(turnOn).toHaveTextContent("Turn on 4 alerts");
    expect(turnOn).toHaveAttribute(
      "href",
      expect.stringContaining(`${CLOUD_PATH}/recommendations?`),
    );
  });

  test("what is open on it: only records about it, across Nova's two names for a machine", async () => {
    server.rows = [hypervisorRow()];
    server.records["IncidentState"] = [
      {
        _id: "50000000-0000-4000-8000-000000000001",
        name: "Created",
        isResolvedState: false,
        order: 1,
      },
    ];
    server.records["Incident"] = [
      {
        _id: "60000000-0000-4000-8000-000000000001",
        title: "compute-07 down",
        incidentNumber: 7,
        createdAt: minutesAgo(10),
        seriesLabels: { hostname: "compute-07", service: "nova-compute" },
        currentIncidentState: { name: "Created" },
        incidentSeverity: { name: "Critical", color: "#ff0000" },
      },
      {
        _id: "60000000-0000-4000-8000-000000000002",
        title: "L3 agent down",
        incidentNumber: 8,
        createdAt: minutesAgo(5),
        seriesLabels: { hostname: "compute-07", service: "neutron-l3-agent" },
        currentIncidentState: { name: "Created" },
        incidentSeverity: { name: "Critical", color: "#ff0000" },
      },
    ];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    const open: HTMLElement = await screen.findByTestId(
      "openstack-hypervisor-open",
    );
    expect(open).toHaveTextContent("compute-07 down");
    expect(open).not.toHaveTextContent("L3 agent down");
  });

  test("its Metrics tab reads what Placement promises on this host and region", async () => {
    server.rows = [hypervisorRow()];

    await renderPage(OpenStackCloudHypervisorDetail, PATH);
    fireEvent.click(await screen.findByRole("tab", { name: "Metrics" }));
    await settle();

    const queries: Array<HTMLElement> = screen.getAllByTestId("metric-query");
    expect(
      queries.map((query: HTMLElement) => {
        return query.textContent;
      }),
    ).toEqual([
      "vCPUs allocated",
      "Memory allocated",
      "Local disk allocated",
      "Running instances",
    ]);
    expect(JSON.parse(queries[0]!.getAttribute("data-attributes")!)).toEqual({
      "resource.openstack.cloud.name": "prod-eu",
      "openstack.region.name": "RegionOne",
      hostname: HYPERVISOR_NAME,
      resourcetype: "VCPU",
    });
  });

  test("real CPU and memory only appear when exactly one host's agent runs on it", async () => {
    server.rows = [hypervisorRow()];
    server.records["Host"] = [
      {
        _id: "90000000-0000-4000-8000-000000000001",
        name: "compute-07",
        hostIdentifier: "compute-07",
      },
    ];
    server.history = {};

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    expect(
      await screen.findByTestId("openstack-hypervisor-host-usage"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("openstack-hypervisor-host-link").closest("a"),
    ).toHaveAttribute("href", expect.stringContaining("/hosts/"));
    cleanup();

    // Two matches: no link on a guess.
    server.records["Host"] = [
      {
        _id: "90000000-0000-4000-8000-000000000001",
        hostIdentifier: "compute-07",
      },
      {
        _id: "90000000-0000-4000-8000-000000000002",
        hostIdentifier: HYPERVISOR_NAME,
      },
    ];
    await renderPage(OpenStackCloudHypervisorDetail, PATH);
    await screen.findByTestId("openstack-hypervisor-tiles");
    expect(screen.queryByTestId("openstack-hypervisor-host-usage")).toBeNull();
  });

  test("a read that failed says so with Try again, and is never 'not in the inventory'", async () => {
    server.rows = [hypervisorRow()];
    server.failKinds.add(OpenStackResourceKind.Hypervisor);

    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    const error: HTMLElement = await screen.findByTestId(
      "openstack-part-read-error",
    );
    expect(error).toHaveTextContent("Couldn't load this hypervisor");
    expect(error).toHaveTextContent(READ_FAILED);
    expect(
      screen.queryByTestId("openstack-hypervisor-not-reported"),
    ).toBeNull();
    // The hero still names it, from its address.
    expect(
      screen.getByTestId("openstack-hypervisor-hero-name"),
    ).toHaveTextContent(HYPERVISOR_NAME);

    server.failKinds.clear();
    fireEvent.click(within(error).getByTestId("refresh-button"));
    await settle();

    expect(
      await screen.findByTestId("openstack-hypervisor-overview"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-part-read-error")).toBeNull();
  });

  test("one that isn't in the inventory says that", async () => {
    await renderPage(OpenStackCloudHypervisorDetail, PATH);

    expect(
      await screen.findByTestId("openstack-hypervisor-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
    expect(screen.queryByTestId("openstack-part-read-error")).toBeNull();
  });
});

describe("the Instances list", () => {
  test("each state in Nova's word, whose it is, its flavor's name and a step to its host", async () => {
    server.rows = [instanceRow(), flavorRow(), projectRow()];

    await renderPage(OpenStackCloudInstances, "/instances");

    const row: HTMLElement = (await screen.findByText("web-01")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("ACTIVE")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(await within(row).findByText("payments")).toBeInTheDocument();
    expect(within(row).getByText("Small").closest("a")).toHaveAttribute(
      "href",
      `${CLOUD_PATH}/flavors/${encodeURIComponent("RegionOne/m1.small")}`,
    );
    expect(within(row).getByText(HYPERVISOR_NAME).closest("a")).toHaveAttribute(
      "href",
      `${CLOUD_PATH}/hypervisors/${encodeURIComponent(HYPERVISOR_ID)}`,
    );
    expect(within(row).getByText("az1")).toBeInTheDocument();
    expect(within(row).getByText("5m")).toBeInTheDocument();
  });

  test("a flavor nothing names reads by its own id, without its region", async () => {
    server.rows = [instanceRow()];

    await renderPage(OpenStackCloudInstances, "/instances");

    const row: HTMLElement = (await screen.findByText("web-01")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("m1.small")).toBeInTheDocument();
  });

  test("stuck is its own state, and says for how long", async () => {
    server.rows = [
      instanceRow({ status: "BUILD", stateChangedAt: minutesAgo(180) }),
    ];

    await renderPage(OpenStackCloudInstances, "/instances");

    const row: HTMLElement = (await screen.findByText("web-01")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Stuck")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(row).getByText("BUILD for 3h")).toBeInTheDocument();
  });

  test("a step taking its time reads as what it is, with nothing to look at", async () => {
    server.rows = [
      instanceRow({ status: "BUILD", stateChangedAt: minutesAgo(3) }),
    ];

    await renderPage(OpenStackCloudInstances, "/instances");

    const row: HTMLElement = (await screen.findByText("web-01")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("BUILD")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(within(row).queryByText("Stuck")).not.toBeInTheDocument();
  });

  test("no address column of dashes, because the exporter's are empty, and one when a row has it", async () => {
    server.rows = [instanceRow()];
    await renderPage(OpenStackCloudInstances, "/instances");
    await screen.findByText("web-01");
    expect(screen.queryByText("Address")).not.toBeInTheDocument();
    cleanup();

    server.rows = [
      instanceRow({ facts: { flavorId: "m1", addressIpv4: "10.0.0.5" } }),
    ];
    await renderPage(OpenStackCloudInstances, "/instances");
    await screen.findByText("web-01");
    expect(await screen.findByText("Address")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.5")).toBeInTheDocument();
  });

  test("a failed instance with no hypervisor has no link to one", async () => {
    server.rows = [
      instanceRow({
        status: "ERROR",
        hypervisorName: undefined,
        availabilityZone: undefined,
      }),
    ];

    await renderPage(OpenStackCloudInstances, "/instances");

    const row: HTMLElement = (await screen.findByText("web-01")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("ERROR")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(within(row).queryByText(/In ERROR/)).not.toBeInTheDocument();
  });

  test("opens an instance's page on a click", async () => {
    server.rows = [instanceRow()];
    const navigate: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    await renderPage(OpenStackCloudInstances, "/instances");
    fireEvent.click(await screen.findByText("web-01"));
    await settle();

    expect(String(navigate.mock.calls[0]![0])).toContain(
      `${CLOUD_PATH}/instances/${INSTANCE_ID}`,
    );
  });
});

describe("an instance's page", () => {
  const PATH: string = partPath("instances", INSTANCE_ID);

  test("its hero says where it runs, a step away", async () => {
    server.rows = [instanceRow(), flavorRow()];

    await renderPage(OpenStackCloudInstanceDetail, PATH);

    const location: HTMLElement = await screen.findByTestId(
      "openstack-instance-hero-location",
    );
    expect(location).toHaveTextContent(
      `On hypervisor ${HYPERVISOR_NAME} of cloud prod-eu`,
    );
    expect(
      within(location).getByText(HYPERVISOR_NAME).closest("a"),
    ).toHaveAttribute(
      "href",
      `${CLOUD_PATH}/hypervisors/${encodeURIComponent(HYPERVISOR_ID)}`,
    );
  });

  test("its size is its flavor's, said to be, and never called what it is using", async () => {
    server.rows = [instanceRow(), flavorRow()];

    await renderPage(OpenStackCloudInstanceDetail, PATH);
    await screen.findByTestId("openstack-instance-tiles");

    expect(tile("openstack-instance-tiles", "vCPUs")).toHaveTextContent(
      "2from its flavor",
    );
    expect(tile("openstack-instance-tiles", "Memory")).toHaveTextContent(
      "4.0 GiBfrom its flavor",
    );
    expect(
      screen.getByTestId("openstack-instance-details-flavor"),
    ).toHaveTextContent("Small");
  });

  test("what isn't collected is said to be, with where to look instead", async () => {
    server.rows = [instanceRow()];

    await renderPage(OpenStackCloudInstanceDetail, PATH);

    const addresses: HTMLElement = await screen.findByTestId(
      "openstack-instance-details-addresses",
    );
    expect(addresses).toHaveTextContent("Not collected");
    expect(addresses).toHaveTextContent(`openstack server show ${INSTANCE_ID}`);
    expect(
      screen.getByTestId("openstack-instance-details-image"),
    ).toHaveTextContent("Not collected");
  });

  test("an address a row holds is shown", async () => {
    server.rows = [
      instanceRow({ facts: { addressIpv4: "10.0.0.5", addressIpv6: "fd00::5" } }),
    ];

    await renderPage(OpenStackCloudInstanceDetail, PATH);

    expect(
      await screen.findByTestId("openstack-instance-details-addresses"),
    ).toHaveTextContent("10.0.0.5, fd00::5");
  });

  test("one that failed before it was placed says that, and has no hypervisor to link to", async () => {
    server.rows = [
      instanceRow({
        status: "ERROR",
        hypervisorName: undefined,
        availabilityZone: undefined,
      }),
    ];

    await renderPage(OpenStackCloudInstanceDetail, PATH);

    expect(
      await screen.findByTestId("openstack-instance-explanation"),
    ).toHaveTextContent(/never placed this instance on a hypervisor/);
    expect(
      screen.getByTestId("openstack-instance-hero-location"),
    ).toHaveTextContent("Not placed on a hypervisor");
    expect(
      screen.getByTestId("openstack-instance-details-hypervisor"),
    ).toHaveTextContent("Not placed on a hypervisor");
    expect(attentionRowsOf("openstack-instance-attention")).toEqual([
      "This instance: In ERROR",
    ]);
    // It asks after no hypervisor it doesn't have.
    expect(kindCalls(OpenStackResourceKind.Service)).toEqual([]);
  });

  test("a probe's fault message shows up where the reason does, and the exporter's lack is said", async () => {
    server.rows = [
      instanceRow({
        status: "ERROR",
        facts: { faultMessage: "No valid host was found." },
      }),
    ];
    await renderPage(OpenStackCloudInstanceDetail, PATH);
    expect(
      await screen.findByTestId("openstack-instance-attention-message"),
    ).toHaveTextContent("No valid host was found.");
    expect(
      screen.getByTestId("openstack-instance-details-fault"),
    ).toHaveTextContent("No valid host was found.");
    cleanup();

    server.rows = [instanceRow({ status: "ERROR", facts: {} })];
    await renderPage(OpenStackCloudInstanceDetail, PATH);
    expect(
      await screen.findByTestId("openstack-instance-details-fault"),
    ).toHaveTextContent("Not collected");
  });

  test("stuck says for how long, and on a lost host says that too", async () => {
    server.rows = [
      instanceRow({
        status: "VERIFY_RESIZE",
        stateChangedAt: minutesAgo(120),
      }),
      computeServiceRow({ status: "down" }),
    ];

    await renderPage(OpenStackCloudInstanceDetail, PATH);
    await screen.findByTestId("openstack-instance-attention");

    expect(attentionRowsOf("openstack-instance-attention")).toEqual([
      "nova-compute: Down",
      "This instance: VERIFY_RESIZE for 2h",
    ]);
    expect(
      screen.getByTestId("openstack-instance-hero-status"),
    ).toHaveTextContent("Stuck");
    expect(
      screen.getByTestId("openstack-instance-explanation"),
    ).toHaveTextContent(/confirm or revert/);
  });

  test("its Volumes tab lists what is attached to it, by its own id", async () => {
    server.rows = [
      instanceRow(),
      {
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000041",
        kind: OpenStackResourceKind.Volume,
        name: "data",
        externalId: "v1",
        status: "in-use",
        facts: { attachedToInstance: INSTANCE_ID },
      },
      {
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000042",
        kind: OpenStackResourceKind.Volume,
        name: "other",
        externalId: "v2",
        status: "in-use",
        facts: { attachedToInstance: "someone-else" },
      },
    ];

    await renderPage(OpenStackCloudInstanceDetail, PATH);
    fireEvent.click(await screen.findByRole("tab", { name: "Volumes" }));
    await settle();

    expect(await screen.findByText("data")).toBeInTheDocument();
    expect(screen.queryByText("other")).not.toBeInTheDocument();
  });

  test("its alerts are the instance templates", async () => {
    server.rows = [instanceRow()];

    await renderPage(OpenStackCloudInstanceDetail, PATH);

    expect(
      within(await screen.findByTestId("openstack-instance-alerts"))
        .getAllByTestId("openstack-instance-alerts-item")
        .map((item: HTMLElement) => {
          return item.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual([
      "Instances in Error",
      "Instance Stuck Building",
      "Instance Stuck Transitioning",
      "Instance Stuck in Verify Resize",
    ]);
  });
});

describe("availability zones and aggregates", () => {
  const MANY: Array<Row> = [
    hypervisorRow(),
    hypervisorRow({
      _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000003",
      name: "compute-08.example.internal",
      externalId: "RegionOne/compute-08.example.internal",
      hypervisorName: "compute-08.example.internal",
      status: "down",
      instanceCount: 7,
      facts: { aggregates: "gpu" },
    }),
    hypervisorRow({
      _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000004",
      name: "compute-09.example.internal",
      externalId: "RegionOne/compute-09.example.internal",
      hypervisorName: "compute-09.example.internal",
      availabilityZone: "az2",
      facts: { aggregates: "gpu,ssd" },
    }),
    hypervisorRow({
      _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000005",
      name: "controller.example.internal",
      externalId: "RegionOne/controller.example.internal",
      hypervisorName: "controller.example.internal",
      availabilityZone: "internal",
    }),
    computeServiceRow({
      _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000006",
      externalId: "RegionOne/compute/compute-08/nova-compute",
      hypervisorName: "compute-08",
      status: "down",
      facts: { family: "compute", host: "compute-08" },
    }),
  ];

  test("the zones list: hypervisors, capacity and health per zone, and Nova's internal one isn't there", async () => {
    server.rows = MANY;

    await renderPage(OpenStackCloudAvailabilityZones, "/availability-zones");

    const az1: HTMLElement = (await screen.findByText("az1")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(az1).getByText("Unhealthy")).toBeInTheDocument();
    expect(within(az1).getByText("1 up, 1 lost")).toBeInTheDocument();
    // The lost host's numbers are not room.
    expect(within(az1).getByText("12 of 64 (19%)")).toBeInTheDocument();
    expect(within(az1).getByText("12")).toBeInTheDocument();

    const az2: HTMLElement = tableRow("az2");
    expect(within(az2).getByText("Healthy")).toBeInTheDocument();
    expect(screen.queryByText("internal")).not.toBeInTheDocument();
  });

  test("a zone's row opens its page", async () => {
    server.rows = MANY;

    await renderPage(OpenStackCloudAvailabilityZones, "/availability-zones");

    expect(
      within((await screen.findByText("az1")).closest("tr") as HTMLElement)
        .getByText("az1")
        .closest("a"),
    ).toHaveAttribute(
      "href",
      `${CLOUD_PATH}/availability-zones/${encodeURIComponent("RegionOne/az1")}`,
    );
  });

  test("a zone's page: its hero, what needs attention, its tiles and its lists, on the server", async () => {
    server.rows = MANY;

    await renderPage(
      OpenStackCloudAvailabilityZoneDetail,
      partPath("availability-zones", "RegionOne/az1"),
    );

    expect(
      await screen.findByTestId("openstack-zone-hero-status"),
    ).toHaveTextContent("Unhealthy");
    expect(
      screen.getByTestId("openstack-zone-hero-location"),
    ).toHaveTextContent("Zone of region RegionOne of cloud prod-eu");
    expect(attentionRowsOf("openstack-zone-attention")).toEqual([
      "nova-compute: Down, with 7 instances on it",
    ]);
    expect(tile("openstack-zone-tiles", "Hypervisors")).toHaveTextContent(
      "21 up, 1 lost",
    );
    expect(tile("openstack-zone-tiles", "Instances")).toHaveTextContent("12");

    fireEvent.click(screen.getByRole("tab", { name: /Hypervisors/ }));
    await settle();
    expect(await screen.findByText(HYPERVISOR_NAME)).toBeInTheDocument();
    expect(
      screen.queryByText("compute-09.example.internal"),
    ).not.toBeInTheDocument();
    const call = kindCalls(OpenStackResourceKind.Hypervisor).find((one) => {
      return one.query["availabilityZone"] === "az1";
    });
    expect(call?.query["regionName"]).toBe("RegionOne");
  });

  test("a zone nothing says it is in says that", async () => {
    server.rows = MANY;

    await renderPage(
      OpenStackCloudAvailabilityZoneDetail,
      partPath("availability-zones", "RegionOne/gone"),
    );

    expect(
      await screen.findByTestId("openstack-zone-not-reported"),
    ).toHaveTextContent(/No hypervisor says it is in it/);
  });

  test("a failed read says so, and is never read as a zone with nothing in it", async () => {
    server.rows = MANY;
    server.failPosts.add("needs-attention");

    await renderPage(
      OpenStackCloudAvailabilityZoneDetail,
      partPath("availability-zones", "RegionOne/az1"),
    );

    expect(
      await screen.findByTestId("openstack-part-read-error"),
    ).toHaveTextContent("Couldn't load this cloud's zones");
    expect(screen.queryByTestId("openstack-zone-not-reported")).toBeNull();
  });

  test("the aggregates list: a hypervisor in two counts towards both", async () => {
    server.rows = MANY;

    await renderPage(OpenStackCloudAggregates, "/aggregates");

    const gpu: HTMLElement = (await screen.findByText("gpu")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(gpu).getByText("1 up, 1 lost")).toBeInTheDocument();
    expect(within(tableRow("ssd")).getByText("1 up")).toBeInTheDocument();
  });

  test("a cloud with no aggregates says that's usual, not a fault", async () => {
    server.rows = [
      hypervisorRow(),
      {
        kind: OpenStackResourceKind.Api,
        name: "compute",
        externalId: "RegionOne/compute",
        status: "up",
      },
    ];

    await renderPage(OpenStackCloudAggregates, "/aggregates");

    expect(
      await screen.findByText(/No host aggregates reported/),
    ).toBeInTheDocument();
  });

  test("zones with no hypervisors and Nova answering say the credential can't list them", async () => {
    server.rows = [
      {
        kind: OpenStackResourceKind.Api,
        name: "compute",
        externalId: "RegionOne/compute",
        status: "up",
      },
    ];

    await renderPage(OpenStackCloudAvailabilityZones, "/availability-zones");

    expect(
      await screen.findByText(/This credential can't list hypervisors/),
    ).toBeInTheDocument();
  });

  test("an aggregate's page lists its own hypervisors by name, because a fact can't be sorted or matched whole", async () => {
    server.rows = MANY;

    await renderPage(
      OpenStackCloudAggregateDetail,
      partPath("aggregates", "RegionOne/ssd"),
    );

    expect(
      await screen.findByTestId("openstack-aggregate-hero-name"),
    ).toHaveTextContent("ssd");

    fireEvent.click(screen.getByRole("tab", { name: /Hypervisors/ }));
    await settle();

    expect(
      await screen.findByText("compute-09.example.internal"),
    ).toBeInTheDocument();
    expect(screen.queryByText(HYPERVISOR_NAME)).not.toBeInTheDocument();
    const call = kindCalls(OpenStackResourceKind.Hypervisor).find((one) => {
      return one.query["hypervisorName"] instanceof Includes;
    });
    expect((call?.query["hypervisorName"] as Includes).values).toEqual([
      "compute-09.example.internal",
    ]);
  });
});

describe("flavors", () => {
  test("the list: each size, and how many instances use it, from one count on the server", async () => {
    server.rows = [
      flavorRow(),
      flavorRow({
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000022",
        name: "Unused",
        externalId: "RegionOne/m1.unused",
      }),
      instanceRow(),
      instanceRow({
        _id: "6c1b2a3d-4e5f-4a6b-8c7d-000000000014",
        externalId: "44444444-4444-4444-8444-444444444444",
      }),
    ];

    await renderPage(OpenStackCloudFlavors, "/flavors");

    const small: HTMLElement = (await screen.findByText("Small")).closest(
      "tr",
    ) as HTMLElement;
    expect(await within(small).findByText("2", { selector: "span" })).toBeInTheDocument();
    expect(within(small).getByText("4.0 GiB")).toBeInTheDocument();
    expect(within(small).getByText("Public")).toBeInTheDocument();
    expect(within(tableRow("Unused")).getByText("0")).toBeInTheDocument();

    expect(
      server.postCalls.filter((call) => {
        return call.path.includes("/counts/");
      }),
    ).toHaveLength(1);
    // No read of the instances themselves, of which there can be hundreds of thousands.
    expect(kindCalls(OpenStackResourceKind.Instance)).toEqual([]);
  });

  test("a failed count leaves the column out, and the sizes are still true", async () => {
    server.rows = [flavorRow()];
    server.failPosts.add("counts");

    await renderPage(OpenStackCloudFlavors, "/flavors");

    await screen.findByText("Small");
    expect(screen.queryByText("Instances")).not.toBeInTheDocument();
  });

  test("a flavor's page: its size, how many use it, and those instances on the server", async () => {
    server.rows = [flavorRow(), instanceRow()];

    await renderPage(
      OpenStackCloudFlavorDetail,
      partPath("flavors", "RegionOne/m1.small"),
    );

    await screen.findByTestId("openstack-flavor-tiles");
    expect(tile("openstack-flavor-tiles", "vCPUs")).toHaveTextContent("2");
    expect(tile("openstack-flavor-tiles", "Instances")).toHaveTextContent(
      "1of this flavor",
    );
    expect(
      screen.getByTestId("openstack-flavor-details-flavor-id"),
    ).toHaveTextContent("m1.small");
    expect(
      screen
        .getAllByTestId("openstack-flavor-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["Public"]);

    fireEvent.click(screen.getByRole("tab", { name: "Instances" }));
    await settle();
    expect(await screen.findByText("web-01")).toBeInTheDocument();
  });
});

describe.each(getOpenStackDrilledReleases())("on what %s said", (release: string) => {
  function load(scene: string): void {
    const recording: OpenStackRecording = new OpenStackRecording(release, scene);
    server.rows = recording.rows.map((row, index: number) => {
      return {
        ...row,
        _id: `6c1b2a3d-4e5f-4a6b-8c7d-${String(index).padStart(12, "0")}`,
      } as Row;
    });
  }

  test("a stopped nova-compute: the list says Lost, and its page how many instances it holds", async () => {
    load("compute-down");
    const hypervisor: Row = server.rows.find((row: Row) => {
      return row.kind === OpenStackResourceKind.Hypervisor;
    })!;

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");
    expect(await screen.findByText("Lost")).toBeInTheDocument();
    cleanup();

    await renderPage(
      OpenStackCloudHypervisorDetail,
      partPath("hypervisors", hypervisor.externalId as string),
    );
    expect(
      await screen.findByTestId("openstack-hypervisor-lost"),
    ).toBeInTheDocument();
    expect(attentionRowsOf("openstack-hypervisor-attention")[0]).toMatch(
      /nova-compute: Down, with \d+ instances? on it/,
    );
    expect(
      tile("openstack-hypervisor-tiles", "vCPUs allocated"),
    ).toHaveTextContent("last known");
  });

  test("the failed instance reads as failing before it was placed", async () => {
    load("healthy");
    const failed: Row = server.rows.find((row: Row) => {
      return row.name === "ou-failed";
    })!;

    await renderPage(
      OpenStackCloudInstanceDetail,
      partPath("instances", failed.externalId as string),
    );

    expect(
      await screen.findByTestId("openstack-instance-explanation"),
    ).toHaveTextContent(/never placed/);
    expect(
      screen.getByTestId("openstack-instance-hero-status"),
    ).toHaveTextContent("ERROR");
  });

  test("a running instance links to the real hypervisor and flavor rows", async () => {
    load("healthy");
    const running: Row = server.rows.find((row: Row) => {
      return row.name === "ou-running";
    })!;

    await renderPage(
      OpenStackCloudInstanceDetail,
      partPath("instances", running.externalId as string),
    );

    expect(
      await screen.findByTestId("openstack-instance-tiles"),
    ).toHaveTextContent("from its flavor");
    expect(
      screen.getByTestId("openstack-instance-details-flavor"),
    ).toHaveTextContent("ou.tiny");
    expect(
      screen.getByTestId("openstack-instance-details-addresses"),
    ).toHaveTextContent("Not collected");
  });
});

// The id every read of these pages is scoped to, so a slip shows up here.
test("every read is of this cloud", async () => {
  resetServer();
  server.rows = [hypervisorRow()];
  await renderPage(OpenStackCloudHypervisors, "/hypervisors");
  await screen.findByText(HYPERVISOR_NAME);
  for (const call of server.listCalls) {
    if (call.model === "OpenStackResource") {
      expect(String(call.query["openStackCloudId"])).toBe(CLOUD_ID);
    }
  }
});
