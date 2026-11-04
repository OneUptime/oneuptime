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
  act,
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The OpenStack pages, rendered for real over the real ModelTable, with only the
 * network replaced. What a source-level test cannot see:
 *
 *  - a list reads one page of one kind of one cloud, and never the whole kind,
 *    because a cloud can hold hundreds of thousands of rows;
 *  - a row's project reads by name, from the few rows that name the page's projects;
 *  - a service someone disabled reads Disabled, with their reason, on its own row;
 *  - the Overview says what the cloud holds and what is promised, says nothing about
 *    health, and shows the setup guide instead of zeros for a cloud with no data.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

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

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import OpenStackCloudHypervisors from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Hypervisors";
import OpenStackCloudOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Index";
import OpenStackCloudInstances from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Instances";
import OpenStackCloudNetworks from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Networks";
import OpenStackCloudServices from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Services";

const CLOUD_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-00000000000a";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

type ListCall = {
  modelType: { new (): BaseModel };
  query: JSONObject;
  limit: number;
  skip: number;
};

let listCalls: Array<ListCall> = [];
let rowsFor: (call: ListCall) => Array<OpenStackResource> = () => {
  return [];
};

function row(values: Partial<OpenStackResource>): OpenStackResource {
  const resource: OpenStackResource = new OpenStackResource();
  Object.assign(resource, values);
  return resource;
}

function kindOf(call: ListCall): unknown {
  return call.query["kind"];
}

function tableCalls(kind: OpenStackResourceKind): Array<ListCall> {
  return listCalls.filter((call: ListCall): boolean => {
    return kindOf(call) === kind;
  });
}

const FULL_SUMMARY: JSONObject = {
  regionCount: 2,
  availabilityZoneCount: 3,
  hypervisorCount: 48,
  instanceCount: 1204,
  activeInstanceCount: 1100,
  volumeCount: 900,
  networkCount: 120,
  routerCount: 0,
  floatingIpCount: 77,
  projectCount: 31,
  serviceCount: 214,
  downServiceCount: 2,
  vcpuCapacity: 1000,
  vcpuAllocated: 620,
  memoryCapacityBytes: 1099511627776,
  memoryAllocatedBytes: 549755813888,
  storageCapacityBytes: 2199023255552,
  storageUsedBytes: 1099511627776,
};

const EMPTY_SUMMARY: JSONObject = Object.fromEntries(
  Object.keys(FULL_SUMMARY).map((key: string): [string, number] => {
    return [key, 0];
  }),
);

let summary: JSONObject | HTTPErrorResponse = FULL_SUMMARY;
let cloud: OpenStackCloud | null = null;

function cloudWith(values: Partial<OpenStackCloud>): OpenStackCloud {
  const item: OpenStackCloud = new OpenStackCloud();
  item.name = "prod-eu";
  Object.assign(item, values);
  return item;
}

beforeEach(() => {
  listCalls = [];
  rowsFor = () => {
    return [];
  };
  summary = FULL_SUMMARY;
  cloud = null;
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (options: any): Promise<ListResult<any>> => {
      const call: ListCall = {
        modelType: options.modelType,
        query: options.query || {},
        limit: options.limit,
        skip: options.skip,
      };
      listCalls.push(call);
      const data: Array<OpenStackResource> =
        options.modelType === OpenStackResource ? rowsFor(call) : [];
      return {
        data,
        count: data.length,
        skip: options.skip || 0,
        limit: options.limit || 10,
      } as ListResult<any>;
    });
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return cloud;
  }) as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockImplementation((async () => {
    return summary instanceof HTTPErrorResponse ? summary : { data: summary };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  path: string,
): Promise<void> {
  goTo(`/dashboard/${PROJECT_ID}/openstack/${CLOUD_ID}${path}`);

  await act(async () => {
    render(
      <MemoryRouter>
        <Page {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  });
  await settle();
}

describe("a list reads one page of one kind of one cloud", () => {
  test("by the cloud and the kind, a page at a time", async () => {
    await renderPage(OpenStackCloudInstances, "/instances");

    const calls: Array<ListCall> = tableCalls(OpenStackResourceKind.Instance);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(String(call.query["openStackCloudId"])).toBe(CLOUD_ID);
      expect(call.skip).toBe(0);
      // A page, never the whole kind: a cloud can hold hundreds of thousands.
      expect(call.limit).toBeLessThanOrEqual(100);
    }
  });

  test("a row reads OpenStack's own word, and its project by name", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      if (kindOf(call) === OpenStackResourceKind.Instance) {
        return [
          row({
            _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            kind: OpenStackResourceKind.Instance,
            name: "web-01",
            externalId: "11111111-1111-4111-8111-111111111111",
            status: "SHUTOFF",
            regionName: "RegionOne",
            hypervisorName: "compute-07",
            openStackProjectId: PROJECT_A,
            facts: { flavorId: "m1.small", addressIpv4: "10.0.0.5" },
          }),
        ];
      }
      if (kindOf(call) === OpenStackResourceKind.Project) {
        return [
          row({
            kind: OpenStackResourceKind.Project,
            externalId: PROJECT_A,
            name: "payments",
          }),
        ];
      }
      return [];
    };

    await renderPage(OpenStackCloudInstances, "/instances");

    expect(await screen.findByText("web-01")).toBeInTheDocument();
    expect(screen.getByText("SHUTOFF")).toBeInTheDocument();
    expect(await screen.findByText("payments")).toBeInTheDocument();
    expect(screen.getByText("compute-07")).toBeInTheDocument();
    expect(screen.getByText("m1.small")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.5")).toBeInTheDocument();

    // Asked only for the page's own projects.
    const lookups: Array<ListCall> = tableCalls(OpenStackResourceKind.Project);
    expect(lookups).toHaveLength(1);
    const asked: unknown = lookups[0]!.query["externalId"];
    expect(asked).toBeInstanceOf(Includes);
    expect((asked as Includes).values).toEqual([PROJECT_A]);
    expect(lookups[0]!.limit).toBe(1);
  });

  test("a project Keystone doesn't name reads by its ID", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Instance
        ? [
            row({
              _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              kind: OpenStackResourceKind.Instance,
              name: "web-01",
              externalId: "11111111-1111-4111-8111-111111111111",
              openStackProjectId: PROJECT_A,
            }),
          ]
        : [];
    };

    await renderPage(OpenStackCloudInstances, "/instances");

    expect(await screen.findByText(PROJECT_A)).toBeInTheDocument();
  });

  test("a row with no name reads by its ID", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Instance
        ? [
            row({
              _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              kind: OpenStackResourceKind.Instance,
              externalId: "11111111-1111-4111-8111-111111111111",
            }),
          ]
        : [];
    };

    await renderPage(OpenStackCloudInstances, "/instances");

    expect(
      await screen.findByText("11111111-1111-4111-8111-111111111111"),
    ).toBeInTheDocument();
  });

  test("an empty list says why it could be, and offers nothing to create", async () => {
    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    expect(
      await screen.findByText("No hypervisors reported yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A Project view credential can't list hypervisors/),
    ).toBeInTheDocument();
  });

  test("a network reads its addresses used of total", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Network
        ? [
            row({
              _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              kind: OpenStackResourceKind.Network,
              name: "private",
              status: "ACTIVE",
              facts: { ipsUsed: 12, ipsTotal: 254, networkType: "vxlan" },
            }),
          ]
        : [];
    };

    await renderPage(OpenStackCloudNetworks, "/networks");

    expect(await screen.findByText("12 of 254")).toBeInTheDocument();
    expect(screen.getByText("vxlan")).toBeInTheDocument();
  });
});

describe("the Services page", () => {
  test("has a table for the APIs and one for each family, by the family's rows", async () => {
    await renderPage(OpenStackCloudServices, "/services");

    expect(await screen.findByText("No APIs reported yet")).toBeInTheDocument();
    expect(
      screen.getByText("No compute services reported yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No network agents reported yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No volume services reported yet"),
    ).toBeInTheDocument();

    const families: Array<unknown> = tableCalls(
      OpenStackResourceKind.Service,
    ).map((call: ListCall): unknown => {
      return (call.query["facts"] as JSONObject)["family"];
    });

    expect(new Set(families)).toEqual(
      new Set(["compute", "network", "volume"]),
    );
  });

  test("a service someone disabled reads Disabled, with their reason, and no alarm", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      const family: unknown = (call.query["facts"] as JSONObject | undefined)?.[
        "family"
      ];
      return family === "compute"
        ? [
            row({
              _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              kind: OpenStackResourceKind.Service,
              name: "nova-compute",
              externalId: "RegionOne/compute/compute-12/nova-compute",
              status: "down",
              adminState: "disabled",
              disabledReason: "Hardware swap, CHG-1042",
              regionName: "RegionOne",
              facts: { family: "compute", host: "compute-12" },
            }),
            row({
              _id: "7c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              kind: OpenStackResourceKind.Service,
              name: "nova-compute",
              externalId: "RegionOne/compute/compute-07/nova-compute",
              status: "down",
              adminState: "enabled",
              regionName: "RegionOne",
              facts: { family: "compute", host: "compute-07" },
            }),
          ]
        : [];
    };

    await renderPage(OpenStackCloudServices, "/services");

    const disabledRow: HTMLElement = (
      await screen.findByText("compute-12")
    ).closest("tr") as HTMLElement;
    expect(within(disabledRow).getByText("Disabled")).toBeInTheDocument();
    expect(within(disabledRow).getByText("disabled")).toBeInTheDocument();
    expect(
      within(disabledRow).getByText("Hardware swap, CHG-1042"),
    ).toBeInTheDocument();
    expect(disabledRow.querySelector('[data-tone="danger"]')).toBeNull();

    const downRow: HTMLElement = screen
      .getByText("compute-07")
      .closest("tr") as HTMLElement;
    expect(downRow.querySelector('[data-tone="danger"]')).not.toBeNull();
    expect(within(downRow).getByText("down")).toBeInTheDocument();
  });

  test("an API reads by its service's name", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Api
        ? [
            row({
              _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
              kind: OpenStackResourceKind.Api,
              name: "compute",
              externalId: "RegionOne/compute",
              status: "up",
              regionName: "RegionOne",
            }),
          ]
        : [];
    };

    await renderPage(OpenStackCloudServices, "/services");

    expect(await screen.findByText("Compute (Nova)")).toBeInTheDocument();
  });
});

describe("the Hypervisors page", () => {
  const HYPERVISOR: Partial<OpenStackResource> = {
    _id: "6c1b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    kind: OpenStackResourceKind.Hypervisor,
    name: "compute-07",
    externalId: "RegionOne/compute-07",
    hypervisorName: "compute-07",
    regionName: "RegionOne",
    vcpuAllocated: 12,
    vcpuCapacity: 64,
    instanceCount: 5,
  };

  test("says allocated, and never CPU or usage", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Hypervisor
        ? [row(HYPERVISOR)]
        : [];
    };

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    expect(await screen.findByText("12 of 64")).toBeInTheDocument();
    expect(screen.getByText("vCPUs Allocated")).toBeInTheDocument();
    expect(screen.getByText("Memory Allocated")).toBeInTheDocument();
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
    expect(screen.queryByText(/usage/i)).not.toBeInTheDocument();
  });

  test("a host whose nova-compute stopped says so beside its numbers", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      if (kindOf(call) === OpenStackResourceKind.Hypervisor) {
        return [row(HYPERVISOR)];
      }
      if (kindOf(call) === OpenStackResourceKind.Service) {
        return [
          row({
            kind: OpenStackResourceKind.Service,
            name: "nova-compute",
            regionName: "RegionOne",
            hypervisorName: "compute-07",
            status: "down",
            adminState: "enabled",
          }),
        ];
      }
      return [];
    };

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    expect(await screen.findByText("down")).toBeInTheDocument();

    const lookups: Array<ListCall> = tableCalls(OpenStackResourceKind.Service);
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.query["name"]).toBe("nova-compute");
    expect((lookups[0]!.query["hypervisorName"] as Includes).values).toEqual([
      "compute-07",
    ]);
  });
});

describe("the Overview", () => {
  test("a cloud with nothing reported shows the setup guide, not zeros", async () => {
    cloud = cloudWith({ otelCollectorStatus: "disconnected" });
    summary = EMPTY_SUMMARY;

    await renderPage(OpenStackCloudOverview, "");

    expect(await screen.findByText("Connect this cloud")).toBeInTheDocument();
    expect(
      screen.queryByTestId("openstack-overview-capacity"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Healthy$/)).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  test("a reporting cloud says it is connected, and nothing about health", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
      agentVersion: "0.161.0",
    });

    await renderPage(OpenStackCloudOverview, "");

    expect(
      within(
        await screen.findByTestId("openstack-overview-connection"),
      ).getByText("Connected"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last seen/)).toBeInTheDocument();
    expect(screen.queryByText(/^Healthy$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Degraded$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Unhealthy$/)).not.toBeInTheDocument();
  });

  test("a chip counts what was reported and opens its list, and a kind with none has none", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });

    await renderPage(OpenStackCloudOverview, "");

    const counts: HTMLElement = await screen.findByTestId(
      "openstack-overview-counts",
    );

    expect(
      within(counts).getByText("48 hypervisors").closest("a"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/openstack/${CLOUD_ID}/hypervisors`),
    );
    expect(within(counts).getByText("2 regions")).toBeInTheDocument();
    expect(within(counts).getByText("2 services down")).toBeInTheDocument();
    // This cloud reports no routers: not "0 routers".
    expect(within(counts).queryByText(/router/)).not.toBeInTheDocument();
  });

  test("the tiles say allocated and used, and what of", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });

    await renderPage(OpenStackCloudOverview, "");

    const tiles: HTMLElement = await screen.findByTestId(
      "openstack-overview-capacity",
    );

    expect(within(tiles).getByText("vCPUs allocated")).toBeInTheDocument();
    expect(within(tiles).getByText("Memory allocated")).toBeInTheDocument();
    expect(within(tiles).getByText("Storage used")).toBeInTheDocument();
    expect(within(tiles).getByText("62%")).toBeInTheDocument();
    expect(within(tiles).getByText("620 of 1000")).toBeInTheDocument();
  });

  test("no capacity reported reads as not reported, never as 0%", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });
    summary = { ...EMPTY_SUMMARY, instanceCount: 3 };

    await renderPage(OpenStackCloudOverview, "");

    const tiles: HTMLElement = await screen.findByTestId(
      "openstack-overview-capacity",
    );

    expect(within(tiles).queryByText("0%")).not.toBeInTheDocument();
    expect(within(tiles).getAllByText("Not reported yet")).toHaveLength(3);
  });

  test("a failed read says so, with Try again, and never reads as an empty cloud", async () => {
    cloud = cloudWith({ otelCollectorStatus: "connected" });
    summary = new HTTPErrorResponse(500, {}, {});

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByTestId("openstack-overview-read-error"),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't load this cloud")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.queryByText("Connect this cloud")).not.toBeInTheDocument();
  });
});
