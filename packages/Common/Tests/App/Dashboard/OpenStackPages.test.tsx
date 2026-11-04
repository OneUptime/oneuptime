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
 *  - the Overview reads what is wrong from the rules, says what the cloud holds and what
 *    is promised, asks nothing current of a cloud that has stopped reporting, and shows
 *    the setup guide instead of zeros for a cloud with no data.
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
import {
  OpenStackQuotaResource,
  getOpenStackQuotaFactKey,
} from "../../../Types/OpenStack/OpenStackQuota";
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

// What a read other than the summary answers, by a piece of its address.
let posted: Record<string, JSONObject | HTTPErrorResponse> = {};
let postedTo: Array<{ url: string; body: JSONObject }> = [];

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
  posted = {};
  postedTo = [];
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
  jest.spyOn(API, "post").mockImplementation((async (options: any) => {
    const url: string = options.url.toString();
    postedTo.push({ url, body: options.data || {} });
    const key: string | undefined = Object.keys(posted).find(
      (piece: string): boolean => {
        return url.includes(piece);
      },
    );
    const answer: JSONObject | HTTPErrorResponse =
      key !== undefined ? (posted[key] as JSONObject) : summary;
    return answer instanceof HTTPErrorResponse ? answer : { data: answer };
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
  function worker(values: Partial<OpenStackResource>): OpenStackResource {
    const facts: JSONObject = (values.facts as JSONObject) || {};
    return row({
      kind: OpenStackResourceKind.Service,
      name: "nova-compute",
      status: "up",
      adminState: "enabled",
      regionName: "RegionOne",
      externalId: `RegionOne/${facts["family"]}/${facts["host"]}/${values.name}`,
      ...values,
    });
  }

  function workersRowsOf(
    apis: Array<OpenStackResource>,
    workers: Array<OpenStackResource>,
  ): (call: ListCall) => Array<OpenStackResource> {
    return (call: ListCall): Array<OpenStackResource> => {
      if (kindOf(call) === OpenStackResourceKind.Api) {
        return apis;
      }
      return kindOf(call) === OpenStackResourceKind.Service ? workers : [];
    };
  }

  function api(name: string, status: string = "up"): OpenStackResource {
    return row({
      kind: OpenStackResourceKind.Api,
      name,
      externalId: `RegionOne/${name}`,
      status,
      regionName: "RegionOne",
    });
  }

  function workerRowOn(host: string): HTMLElement {
    return document.querySelector(
      `[data-testid="openstack-service-worker"][data-host="${host}"]`,
    ) as HTMLElement;
  }

  test("reads this cloud's APIs and workers whole, and says when it has none", async () => {
    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-services-empty"),
    ).toBeInTheDocument();
    expect(screen.getByText("No services reported yet")).toBeInTheDocument();

    const reads: Array<ListCall> = listCalls.filter(
      (call: ListCall): boolean => {
        return call.modelType === OpenStackResource;
      },
    );
    expect(new Set(reads.map(kindOf))).toEqual(
      new Set([OpenStackResourceKind.Api, OpenStackResourceKind.Service]),
    );
    for (const read of reads) {
      expect(String(read.query["openStackCloudId"])).toBe(CLOUD_ID);
    }
  });

  test("a service someone disabled reads Disabled, with their reason, and no alarm", async () => {
    rowsFor = workersRowsOf(
      [api("compute")],
      [
        worker({
          status: "down",
          adminState: "disabled",
          disabledReason: "Hardware swap, CHG-1042",
          facts: { family: "compute", host: "compute-12" },
        }),
        worker({
          status: "down",
          facts: { family: "compute", host: "compute-07" },
        }),
      ],
    );

    await renderPage(OpenStackCloudServices, "/services");

    await screen.findByTestId("openstack-service-group");

    const disabledRow: HTMLElement = workerRowOn("compute-12");
    expect(within(disabledRow).getByText("Disabled")).toBeInTheDocument();
    expect(within(disabledRow).getByText(/^disabled/)).toBeInTheDocument();
    expect(
      within(disabledRow).getByText("Hardware swap, CHG-1042"),
    ).toBeInTheDocument();
    expect(disabledRow.querySelector('[data-tone="danger"]')).toBeNull();

    const downRow: HTMLElement = workerRowOn("compute-07");
    expect(downRow.querySelector('[data-tone="danger"]')).not.toBeNull();
    expect(within(downRow).getByText("down")).toBeInTheDocument();

    // What needs someone comes first, whichever order the rows arrived in.
    const hosts: Array<string | null> = screen
      .getAllByTestId("openstack-service-worker")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-host");
      });
    expect(hosts).toEqual(["compute-07", "compute-12"]);
  });

  test("a group of disabled workers raises nothing", async () => {
    rowsFor = workersRowsOf(
      [api("compute")],
      [
        worker({
          status: "down",
          adminState: "disabled",
          stateChangedAt: new Date(),
          facts: { family: "compute", host: "compute-12" },
        }),
      ],
    );

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-service-group"),
    ).toHaveAttribute("data-health", "Healthy");
  });

  test("an API reads by its service's name, in the order of Keystone's catalog", async () => {
    rowsFor = workersRowsOf(
      [api("image"), api("compute"), api("identity")],
      [],
    );

    await renderPage(OpenStackCloudServices, "/services");

    expect(await screen.findByText("Compute (Nova)")).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("openstack-service-group")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-service");
        }),
    ).toEqual(["identity", "compute", "image"]);
  });

  test("Neutron's card says which backend its agents are, and its word for what an operator set", async () => {
    rowsFor = workersRowsOf(
      [api("network")],
      [
        worker({
          name: "ovn-controller",
          status: "down",
          adminState: "up",
          facts: { family: "network", host: "compute-01" },
        }),
      ],
    );

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-service-group-backend"),
    ).toHaveTextContent("OVN");
    expect(
      within(workerRowOn("compute-01")).getByText(/^Admin up/),
    ).toBeInTheDocument();
  });

  test("an API that isn't answering says its workers read as they last did", async () => {
    rowsFor = workersRowsOf(
      [api("compute", "down")],
      [worker({ facts: { family: "compute", host: "compute-01" } })],
    );

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-service-group-last-known"),
    ).toBeInTheDocument();
  });

  test("a stale record beside a live agent reads as stale, and the agent as up", async () => {
    rowsFor = workersRowsOf(
      [api("network")],
      [
        worker({
          name: "ovn-controller",
          adminState: "up",
          facts: {
            family: "network",
            host: "compute-01",
            staleAgentIds: ["dead-record"],
          },
        }),
      ],
    );

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-service-worker-stale"),
    ).toHaveTextContent(/stale record/);
    expect(workerRowOn("compute-01")).toHaveAttribute("data-status", "up");
  });

  test("an up API with nothing to list says the credential can't, only while it reports", async () => {
    rowsFor = workersRowsOf([api("compute")], []);
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByText("This credential can't list compute services"),
    ).toBeInTheDocument();
  });

  test("a cloud that has stopped reporting says so, and asks nothing of its credential", async () => {
    rowsFor = workersRowsOf([api("compute")], []);
    cloud = cloudWith({
      otelCollectorStatus: "disconnected",
      lastSeenAt: new Date("2026-11-01T00:00:00.000Z"),
    });

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-services-quiet"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This credential can't list compute services"),
    ).not.toBeInTheDocument();
  });

  test("a read that fails says so, and never reads as a cloud with no services", async () => {
    jest
      .spyOn(ModelAPI, "getList")
      .mockRejectedValue(new Error("The inventory is unavailable") as never);

    await renderPage(OpenStackCloudServices, "/services");

    expect(
      await screen.findByTestId("openstack-services-read-error"),
    ).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(
      screen.queryByTestId("openstack-services-empty"),
    ).not.toBeInTheDocument();
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
    status: "up",
    adminState: "enabled",
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

    expect(await screen.findByText("12 of 64 (19%)")).toBeInTheDocument();
    expect(screen.getByText("vCPUs Allocated")).toBeInTheDocument();
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
    expect(screen.queryByText(/usage/i)).not.toBeInTheDocument();
  });

  test("a host whose nova-compute stopped reads Lost beside its last numbers, from its own row", async () => {
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Hypervisor
        ? [row({ ...HYPERVISOR, status: "down" })]
        : [];
    };

    await renderPage(OpenStackCloudHypervisors, "/hypervisors");

    expect(await screen.findByText("Lost")).toBeInTheDocument();
    expect(screen.getAllByText("last known").length).toBeGreaterThan(0);
    // A hypervisor's row holds its nova-compute's state: nothing to join by name.
    expect(tableCalls(OpenStackResourceKind.Service)).toEqual([]);
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

  test("a reporting cloud with nothing wrong says it is connected, and Healthy", async () => {
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
    expect(
      await screen.findByTestId("openstack-overview-health"),
    ).toHaveAttribute("data-health", "Healthy");
  });

  test("what is wrong reads first, by name, and turns the verdict", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });
    posted = {
      "needs-attention": {
        rows: [
          {
            kind: OpenStackResourceKind.Api,
            name: "compute",
            externalId: "RegionOne/compute",
            status: "down",
            regionName: "RegionOne",
            stateChangedAt: new Date().toISOString(),
          },
        ],
        totalsByKind: { Api: 1 },
      },
    };

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByTestId("openstack-overview-health"),
    ).toHaveAttribute("data-health", "Unhealthy");
    expect(
      within(screen.getByTestId("openstack-needs-attention")).getByText(
        "Compute (Nova)",
      ),
    ).toBeInTheDocument();
  });

  test("more of a kind than a read holds says how many, and where the rest are", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });
    posted = {
      "needs-attention": {
        rows: [
          {
            kind: OpenStackResourceKind.Instance,
            name: "web-01",
            externalId: "11111111-1111-4111-8111-111111111111",
            status: "ERROR",
          },
        ],
        totalsByKind: { Instance: 340 },
      },
    };

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByTestId("openstack-needs-attention-capped"),
    ).toHaveTextContent("See them all");
  });

  test("a region's pill says what reading that region does, a project at its quota there included", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });
    const region: (regionName: string) => JSONObject = (
      regionName: string,
    ): JSONObject => {
      return {
        regionName,
        apiCount: 1,
        downApiCount: 0,
        serviceCount: 0,
        downServiceCount: 0,
        hypervisorCount: 1,
        instanceCount: 1,
        vcpuCapacity: 10,
        vcpuAllocated: 1,
        memoryCapacityBytes: 10,
        memoryAllocatedBytes: 1,
        storageCapacityBytes: 0,
        storageUsedBytes: 0,
      };
    };
    posted = {
      "region-summaries": {
        regions: [region("RegionOne"), region("RegionTwo")],
      },
      // A project belongs to no region, and each region's answer holds it.
      "needs-attention": {
        rows: [
          {
            kind: OpenStackResourceKind.Project,
            externalId: PROJECT_A,
            name: "payments",
            facts: {
              [getOpenStackQuotaFactKey(
                OpenStackQuotaResource.Instances,
                "RegionTwo",
              )]: {
                used: 95,
                limit: 100,
                observedAt: new Date().toISOString(),
              },
            },
          },
        ],
        totalsByKind: { Project: 1 },
      },
    };

    await renderPage(OpenStackCloudOverview, "");

    const items: Array<HTMLElement> = await screen.findAllByTestId(
      "openstack-regions-card-item",
    );
    expect(
      items.map((item: HTMLElement): Array<string | null> => {
        return [
          item.getAttribute("data-region"),
          item.getAttribute("data-health"),
        ];
      }),
    ).toEqual([
      ["RegionOne", "Healthy"],
      ["RegionTwo", "Degraded"],
    ]);
  });

  test("a cloud that has stopped reporting asks nothing current, and has no verdict", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "disconnected",
      lastSeenAt: new Date("2026-11-01T00:00:00.000Z"),
    });

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByTestId("openstack-overview-health"),
    ).toHaveAttribute("data-health", "Unknown");
    expect(screen.getByTestId("openstack-overview-quiet")).toBeInTheDocument();
    expect(screen.getByTestId("openstack-overview-counts")).toHaveAttribute(
      "data-current",
      "false",
    );
    expect(
      screen.queryByTestId("openstack-needs-attention"),
    ).not.toBeInTheDocument();

    // No rule can be asked of what it said days ago, and no services are down that it knows of.
    const asked: Array<string> = postedTo.map(
      (one: { url: string; body: JSONObject }): string => {
        return one.url;
      },
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(
      asked.filter((url: string): boolean => {
        return (
          url.includes("needs-attention") ||
          url.includes("region-summaries") ||
          url.includes("top-consumers")
        );
      }),
    ).toEqual([]);
    expect(screen.queryByText("2 services down")).not.toBeInTheDocument();

    // A percentage days old reads as today's.
    const tiles: HTMLElement = screen.getByTestId(
      "openstack-overview-capacity",
    );
    expect(within(tiles).queryByText("62%")).not.toBeInTheDocument();
    expect(within(tiles).getAllByText("Nothing current")).toHaveLength(5);
  });

  test("a verdict read from a list that couldn't be read is no verdict", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });
    posted = { "needs-attention": new HTTPErrorResponse(500, {}, {}) };

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByTestId("openstack-needs-attention-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("openstack-overview-health")).toHaveAttribute(
      "data-health",
      "Unknown",
    );
    expect(
      screen.queryByTestId("openstack-needs-attention"),
    ).not.toBeInTheDocument();
  });

  test("an up API with no hypervisors to list reads as the credential, never as Healthy", async () => {
    cloud = cloudWith({
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
    });
    summary = { ...FULL_SUMMARY, hypervisorCount: 0, vcpuCapacity: 0 };
    rowsFor = (call: ListCall): Array<OpenStackResource> => {
      return kindOf(call) === OpenStackResourceKind.Api
        ? [
            row({
              kind: OpenStackResourceKind.Api,
              name: "compute",
              externalId: "RegionOne/compute",
              status: "up",
              regionName: "RegionOne",
            }),
          ]
        : [];
    };

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByText("This credential can't list hypervisors"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("openstack-overview-health")).toHaveAttribute(
      "data-health",
      "Unknown",
    );
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
    expect(within(tiles).getByText(/^620 of 1,?000$/)).toBeInTheDocument();
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

    const frame: HTMLElement = await screen.findByTestId(
      "openstack-overview-summary-error",
    );
    expect(
      within(frame).getByText("Couldn't read this cloud's inventory"),
    ).toBeInTheDocument();
    expect(within(frame).getByText("Try again")).toBeInTheDocument();
    expect(screen.queryByText("Connect this cloud")).not.toBeInTheDocument();
    // A tile says it couldn't read this: the cloud may be reporting fine.
    expect(
      within(screen.getByTestId("openstack-overview-capacity")).queryByText(
        "Not reported yet",
      ),
    ).not.toBeInTheDocument();
  });

  test("a cloud that can't be read at all says so, with Try again", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("No answer") as never);

    await renderPage(OpenStackCloudOverview, "");

    expect(
      await screen.findByTestId("openstack-overview-read-error"),
    ).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });
});
