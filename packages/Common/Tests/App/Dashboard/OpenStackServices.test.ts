import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_SERVICE_DISABLED_WARNING_DAYS,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackQuotaResource,
  getOpenStackQuotaFactKey,
} from "../../../Types/OpenStack/OpenStackQuota";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_BACKEND_LINUX_BRIDGE,
  OPENSTACK_BACKEND_OVN,
  OPENSTACK_BACKEND_OVS,
  OPENSTACK_CATALOG_ORDER,
  OpenStackAccessGap,
  OpenStackBusyHypervisor,
  OpenStackServiceGroup,
  getOpenStackAccessGaps,
  getOpenStackAttentionName,
  getOpenStackCollectionSeconds,
  getOpenStackFullestPoolPercent,
  getOpenStackHypervisorCounts,
  getOpenStackMostAllocatedHypervisors,
  getOpenStackNetworkBackendName,
  getOpenStackPoolTone,
  getOpenStackServiceAlertTemplateIds,
  getOpenStackServiceGroups,
  getOpenStackServiceTitle,
  getOpenStackStaleAgentIds,
  getOpenStackWorkerAlertTemplateIds,
  getOpenStackWorkerCounts,
  getOpenStackWorkerHost,
  getOpenStackWorkerMachine,
  getOpenStackWorkerRank,
  hasOpenStackHostPastAllocationLine,
  isOpenStackApiExternalId,
  isOpenStackApiScrapeFailed,
  isOpenStackIssueAboutService,
  isOpenStackRowInRegion,
  sortOpenStackWorkers,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackServices";
import {
  OpenStackAttentionAnswer,
  mergeOpenStackAttention,
  toOpenStackAttentionRow,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackOverviewReads";
import {
  getOpenStackRegionFromSearch,
  getOpenStackRegionRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackRegion";

/*
 * What the Overview's cards and the Services page read: how a cloud's APIs and workers
 * group, what needs someone first, what a credential can't see, what a region holds, and
 * where a tile's bar turns. The rules' own lines are OpenStackHealth's and are tested
 * there. These are the readings on top of them, each on both sides of what decides it.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const DAY_MINUTES: number = 24 * 60;

// What a row is written with: undefined is how the database's null reads on a model.
type RowFields = {
  [Key in keyof OpenStackResource]?: OpenStackResource[Key] | undefined;
};

function row(
  kind: OpenStackResourceKind,
  fields: RowFields = {},
): OpenStackResource {
  const resource: OpenStackResource = new OpenStackResource();
  resource.kind = kind;
  resource.regionName = "RegionOne";
  resource.externalId = `${kind}-${fields.name || "1"}-${fields.regionName || "RegionOne"}`;
  Object.assign(resource, fields);
  return resource;
}

function api(
  name: string,
  status: string = "up",
  regionName: string = "RegionOne",
  facts: JSONObject = {},
): OpenStackResource {
  return row(OpenStackResourceKind.Api, {
    externalId: `${regionName}/${name}`,
    name,
    status,
    regionName,
    facts,
  });
}

function worker(
  family: string,
  name: string,
  host: string,
  fields: Partial<OpenStackResource> = {},
): OpenStackResource {
  const regionName: string = fields.regionName || "RegionOne";
  return row(OpenStackResourceKind.Service, {
    externalId: `${regionName}/${family}/${host}/${name}`,
    name,
    status: "up",
    adminState: family === "network" ? "up" : "enabled",
    regionName,
    facts: { family, host },
    ...fields,
  });
}

function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

describe("how a row names itself", () => {
  test("an API by the word people use, and one nothing knows as it was written", () => {
    expect(getOpenStackServiceTitle("compute")).toBe("Compute (Nova)");
    expect(getOpenStackServiceTitle("dns")).toBe("dns");
    expect(getOpenStackServiceTitle(undefined)).toBe("");
    expect(getOpenStackAttentionName(api("volume"))).toBe(
      "Block Storage (Cinder)",
    );
  });

  test("a worker by its binary, never by a title", () => {
    expect(
      getOpenStackAttentionName(worker("compute", "nova-compute", "c-1")),
    ).toBe("nova-compute");
  });

  test("Cinder's host says its backend, and the machine is what comes before it", () => {
    const volume: OpenStackResource = worker(
      "volume",
      "cinder-volume",
      "compute-01@lvmdriver-1",
    );
    expect(getOpenStackWorkerHost(volume)).toBe("compute-01@lvmdriver-1");
    expect(getOpenStackWorkerMachine(volume)).toBe("compute-01");
    expect(
      getOpenStackWorkerMachine(
        worker("compute", "nova-compute", "compute-01"),
      ),
    ).toBe("compute-01");
  });

  test("a row with no host names no machine", () => {
    expect(
      getOpenStackWorkerMachine(row(OpenStackResourceKind.Service, {})),
    ).toBe("");
  });

  test("a value that starts with the mark is a name, not an empty machine", () => {
    expect(
      getOpenStackWorkerMachine(worker("volume", "cinder-volume", "@backend")),
    ).toBe("@backend");
  });

  test("an API's address is told from a worker's by its end", () => {
    expect(isOpenStackApiExternalId("RegionOne/compute")).toBe(true);
    expect(isOpenStackApiExternalId("Region/One/volume")).toBe(true);
    expect(
      isOpenStackApiExternalId("RegionOne/compute/compute-01/nova-compute"),
    ).toBe(false);
    for (const service of OPENSTACK_CATALOG_ORDER) {
      expect(isOpenStackApiExternalId(`RegionOne/${service}`)).toBe(true);
    }
  });
});

describe("what an API's row says", () => {
  test("how long collecting it took, and nothing when nothing said", () => {
    expect(
      getOpenStackCollectionSeconds(
        api("compute", "up", "RegionOne", { collectionSeconds: 0.29 }),
      ),
    ).toBe(0.29);
    expect(getOpenStackCollectionSeconds(api("compute"))).toBeNull();
    expect(
      getOpenStackCollectionSeconds(
        api("compute", "up", "RegionOne", { collectionSeconds: "0.29" }),
      ),
    ).toBeNull();
    expect(getOpenStackCollectionSeconds(null)).toBeNull();
    // Taking no time at all is a reading, not an absence of one.
    expect(
      getOpenStackCollectionSeconds(
        api("compute", "up", "RegionOne", { collectionSeconds: 0 }),
      ),
    ).toBe(0);
  });

  test("whether the read itself failed", () => {
    expect(
      isOpenStackApiScrapeFailed(
        api("compute", "down", "RegionOne", { scrapeFailed: true }),
      ),
    ).toBe(true);
    expect(isOpenStackApiScrapeFailed(api("compute", "down"))).toBe(false);
    expect(isOpenStackApiScrapeFailed(null)).toBe(false);
  });
});

describe("a Neutron agent's stale records", () => {
  test("are read as written, and a row that has none has none", () => {
    expect(
      getOpenStackStaleAgentIds(
        worker("network", "ovn-controller", "c-1", {
          facts: { family: "network", host: "c-1", staleAgentIds: ["a", "b"] },
        }),
      ),
    ).toEqual(["a", "b"]);
    expect(
      getOpenStackStaleAgentIds(
        worker("network", "ovn-controller", "c-1", {
          facts: { family: "network", host: "c-1", staleAgentIds: null },
        }),
      ),
    ).toEqual([]);
    expect(
      getOpenStackStaleAgentIds(worker("network", "ovn-controller", "c-1")),
    ).toEqual([]);
  });
});

describe("what needs someone first among workers", () => {
  const LINE_MINUTES: number =
    OPENSTACK_SERVICE_DISABLED_WARNING_DAYS * DAY_MINUTES;

  test("down, then forgotten, then disabled on purpose, then the rest", () => {
    const down: OpenStackResource = worker("compute", "nova-compute", "c-1", {
      status: "down",
    });
    const forgotten: OpenStackResource = worker(
      "compute",
      "nova-compute",
      "c-2",
      {
        adminState: "disabled",
        stateChangedAt: ago(LINE_MINUTES + 2 * DAY_MINUTES),
      },
    );
    const planned: OpenStackResource = worker(
      "compute",
      "nova-compute",
      "c-3",
      {
        adminState: "disabled",
        stateChangedAt: ago(DAY_MINUTES),
      },
    );
    const fine: OpenStackResource = worker("compute", "nova-compute", "c-4");

    expect(getOpenStackWorkerRank(down, NOW)).toBe(0);
    expect(getOpenStackWorkerRank(forgotten, NOW)).toBe(1);
    expect(getOpenStackWorkerRank(planned, NOW)).toBe(2);
    expect(getOpenStackWorkerRank(fine, NOW)).toBe(3);

    expect(
      sortOpenStackWorkers([fine, planned, forgotten, down], NOW).map(
        getOpenStackWorkerHost,
      ),
    ).toEqual(["c-1", "c-2", "c-3", "c-4"]);
  });

  test("a disabled worker that is also down is planned work, in both services' words", () => {
    expect(
      getOpenStackWorkerRank(
        worker("compute", "nova-compute", "c-1", {
          status: "down",
          adminState: "disabled",
          stateChangedAt: ago(10),
        }),
        NOW,
      ),
    ).toBe(2);
    expect(
      getOpenStackWorkerRank(
        worker("network", "neutron-l3-agent", "c-1", {
          status: "down",
          adminState: "down",
          stateChangedAt: ago(10),
        }),
        NOW,
      ),
    ).toBe(2);
  });

  test("the week's line holds exactly: on it is planned, past it is forgotten", () => {
    expect(
      getOpenStackWorkerRank(
        worker("compute", "nova-compute", "c-1", {
          adminState: "disabled",
          stateChangedAt: ago(LINE_MINUTES),
        }),
        NOW,
      ),
    ).toBe(2);
    expect(
      getOpenStackWorkerRank(
        worker("compute", "nova-compute", "c-1", {
          adminState: "disabled",
          stateChangedAt: ago(LINE_MINUTES + DAY_MINUTES),
        }),
        NOW,
      ),
    ).toBe(1);
  });

  test("hosts read in the order people read numbers", () => {
    expect(
      sortOpenStackWorkers(
        [
          worker("compute", "nova-compute", "compute-10"),
          worker("compute", "nova-compute", "compute-2"),
        ],
        NOW,
      ).map(getOpenStackWorkerHost),
    ).toEqual(["compute-2", "compute-10"]);
  });

  test("leaves the list it was handed alone", () => {
    const rows: Array<OpenStackResource> = [
      worker("compute", "nova-compute", "c-2"),
      worker("compute", "nova-compute", "c-1"),
    ];
    sortOpenStackWorkers(rows, NOW);
    expect(rows.map(getOpenStackWorkerHost)).toEqual(["c-2", "c-1"]);
  });
});

describe("how workers count", () => {
  test("planned work is not down, in Nova's word or Neutron's", () => {
    expect(
      getOpenStackWorkerCounts([
        worker("compute", "nova-compute", "c-1"),
        worker("compute", "nova-compute", "c-2", { status: "down" }),
        worker("compute", "nova-compute", "c-3", {
          status: "down",
          adminState: "disabled",
        }),
        worker("network", "neutron-l3-agent", "c-4", {
          status: "down",
          adminState: "down",
        }),
      ]),
    ).toEqual({ total: 4, up: 1, down: 1, disabled: 2 });
  });

  test("Neutron's admin up is not disabled", () => {
    expect(
      getOpenStackWorkerCounts([worker("network", "neutron-l3-agent", "c-1")]),
    ).toEqual({ total: 1, up: 1, down: 0, disabled: 0 });
  });

  test("nothing counts as nothing", () => {
    expect(getOpenStackWorkerCounts([])).toEqual({
      total: 0,
      up: 0,
      down: 0,
      disabled: 0,
    });
  });
});

describe("how a cloud's services group", () => {
  function groupsOf(
    apis: Array<OpenStackResource>,
    workers: Array<OpenStackResource> = [],
  ): Array<OpenStackServiceGroup> {
    return getOpenStackServiceGroups({ apis, workers, now: NOW });
  }

  test("by service and by region, so the same service in two regions is two cards", () => {
    const groups: Array<OpenStackServiceGroup> = groupsOf(
      [api("compute", "up", "RegionOne"), api("compute", "up", "RegionTwo")],
      [
        worker("compute", "nova-compute", "c-1"),
        worker("compute", "nova-compute", "c-1", { regionName: "RegionTwo" }),
      ],
    );
    expect(groups).toHaveLength(2);
    expect(
      groups.map((group: OpenStackServiceGroup): number => {
        return group.workers.length;
      }),
    ).toEqual([1, 1]);
    expect(
      groups.map((group: OpenStackServiceGroup) => {
        return group.regionName;
      }),
    ).toEqual(["RegionOne", "RegionTwo"]);
  });

  test("each family's workers go under the API that answers for them", () => {
    const groups: Array<OpenStackServiceGroup> = groupsOf(
      [api("compute"), api("network"), api("volume")],
      [
        worker("compute", "nova-scheduler", "ctl-1"),
        worker("network", "neutron-l3-agent", "ctl-1"),
        worker("volume", "cinder-scheduler", "ctl-1"),
      ],
    );
    const workersOf: (service: string) => Array<string | undefined> = (
      service: string,
    ): Array<string | undefined> => {
      return (
        groups
          .find((group: OpenStackServiceGroup): boolean => {
            return group.service === service;
          })
          ?.workers.map((row_: OpenStackResource) => {
            return row_.name;
          }) || []
      );
    };
    expect(workersOf("compute")).toEqual(["nova-scheduler"]);
    expect(workersOf("network")).toEqual(["neutron-l3-agent"]);
    expect(workersOf("volume")).toEqual(["cinder-scheduler"]);
  });

  test("workers with no API still have a card, and an API with no workers has its own", () => {
    const groups: Array<OpenStackServiceGroup> = groupsOf(
      [api("identity")],
      [worker("compute", "nova-compute", "c-1")],
    );
    expect(
      groups.find((group: OpenStackServiceGroup): boolean => {
        return group.service === "compute";
      })?.api,
    ).toBeNull();
    expect(
      groups.find((group: OpenStackServiceGroup): boolean => {
        return group.service === "identity";
      })?.counts.total,
    ).toBe(0);
  });

  test("a worker of a family nothing knows, and an API with no name, have no card", () => {
    expect(
      groupsOf(
        [row(OpenStackResourceKind.Api, { name: undefined })],
        [worker("baremetal", "ironic-conductor", "c-1")],
      ),
    ).toEqual([]);
  });

  test("what needs someone comes first: broken, then to look at, then calm", () => {
    const groups: Array<OpenStackServiceGroup> = groupsOf(
      [api("identity"), api("compute"), api("network"), api("volume")],
      [
        worker("network", "neutron-l3-agent", "c-1", { status: "down" }),
        worker("compute", "nova-scheduler", "c-1", { status: "down" }),
        worker("compute", "nova-scheduler", "c-2"),
      ],
    );
    expect(
      groups.map((group: OpenStackServiceGroup): string => {
        return group.service;
      }),
    ).toEqual(["network", "compute", "identity", "volume"]);
    expect(
      groups.map((group: OpenStackServiceGroup) => {
        return group.health;
      }),
    ).toEqual(["Unhealthy", "Degraded", "Healthy", "Healthy"]);
  });

  test("at one health, a whole API not answering comes before one worker of many", () => {
    expect(
      groupsOf(
        [api("compute"), api("image", "down")],
        [worker("compute", "nova-compute", "c-1", { status: "down" })],
      ).map((group: OpenStackServiceGroup): string => {
        return group.service;
      }),
    ).toEqual(["image", "compute"]);
  });

  test("a calm cloud reads in the order of Keystone's catalog, each region in turn", () => {
    expect(
      groupsOf([
        api("image"),
        api("volume"),
        api("network"),
        api("placement"),
        api("compute"),
        api("identity"),
        api("dns"),
      ]).map((group: OpenStackServiceGroup): string => {
        return group.service;
      }),
    ).toEqual([...OPENSTACK_CATALOG_ORDER, "dns"]);
  });

  test("every scheduler down is one critical, not a look per scheduler", () => {
    const groups: Array<OpenStackServiceGroup> = groupsOf(
      [api("compute")],
      [
        worker("compute", "nova-scheduler", "c-1", { status: "down" }),
        worker("compute", "nova-scheduler", "c-2", { status: "down" }),
      ],
    );
    expect(groups[0]?.health).toBe("Unhealthy");
    expect(groups[0]?.items).toHaveLength(1);
  });

  test("a disabled worker leaves its group calm", () => {
    expect(
      groupsOf(
        [api("compute")],
        [
          worker("compute", "nova-compute", "c-1", {
            status: "down",
            adminState: "disabled",
            stateChangedAt: ago(10),
          }),
        ],
      )[0]?.health,
    ).toBe("Healthy");
  });

  test("workers read as they last did only while their API is down", () => {
    const workers: Array<OpenStackResource> = [
      worker("compute", "nova-compute", "c-1"),
    ];
    expect(groupsOf([api("compute", "down")], workers)[0]?.isLastKnown).toBe(
      true,
    );
    expect(groupsOf([api("compute", "up")], workers)[0]?.isLastKnown).toBe(
      false,
    );
    // An API with nothing beneath it has said nothing that could be old.
    expect(groupsOf([api("identity", "down")])[0]?.isLastKnown).toBe(false);
  });
});

describe("the network backend, from what the agents list reports", () => {
  function backendOf(names: Array<string>): string | null {
    return getOpenStackNetworkBackendName(
      names.map((name: string): OpenStackResource => {
        return worker("network", name, "c-1");
      }),
    );
  }

  test("OVN, by each release's own names", () => {
    expect(backendOf(["ovn-controller", "neutron-ovn-agent"])).toBe(
      OPENSTACK_BACKEND_OVN,
    );
    expect(backendOf(["ovn-controller", "neutron-ovn-metadata-agent"])).toBe(
      OPENSTACK_BACKEND_OVN,
    );
    expect(backendOf(["OVN Controller Gateway agent"])).toBe(
      OPENSTACK_BACKEND_OVN,
    );
  });

  test("ML2/OVS, by its agent on every host", () => {
    expect(
      backendOf([
        "neutron-dhcp-agent",
        "neutron-l3-agent",
        "neutron-metadata-agent",
        "neutron-openvswitch-agent",
      ]),
    ).toBe(OPENSTACK_BACKEND_OVS);
  });

  test("Linux bridge, and Open vSwitch when a cloud runs both", () => {
    expect(backendOf(["neutron-linuxbridge-agent"])).toBe(
      OPENSTACK_BACKEND_LINUX_BRIDGE,
    );
    expect(
      backendOf(["neutron-linuxbridge-agent", "neutron-openvswitch-agent"]),
    ).toBe(OPENSTACK_BACKEND_OVS);
  });

  test("reads a cloud as a router's page does, even one midway from one to the other", () => {
    // An L3 agent is what a router's page goes by, so neither can say anything else here.
    expect(backendOf(["neutron-l3-agent", "ovn-controller"])).toBe(
      OPENSTACK_BACKEND_OVS,
    );
    expect(backendOf(["neutron-l3-agent"])).toBe(OPENSTACK_BACKEND_OVS);
    expect(backendOf(["neutron-l3-agent", "neutron-linuxbridge-agent"])).toBe(
      OPENSTACK_BACKEND_LINUX_BRIDGE,
    );
  });

  test("says nothing it can't read, and never reads another family's names", () => {
    expect(backendOf([])).toBeNull();
    expect(backendOf(["neutron-dhcp-agent"])).toBeNull();
    expect(
      getOpenStackNetworkBackendName([
        worker("compute", "ovn-looking-nova-compute", "c-1"),
      ]),
    ).toBeNull();
  });
});

describe("what a credential can't list", () => {
  const titlesOf: (gaps: Array<OpenStackAccessGap>) => Array<string> = (
    gaps: Array<OpenStackAccessGap>,
  ): Array<string> => {
    return gaps.map((gap: OpenStackAccessGap): string => {
      return gap.key;
    });
  };
  const ALL_UP: Array<OpenStackResource> = [
    api("compute"),
    api("network"),
    api("volume"),
  ];

  test("an API that says up, and none of what a working cloud always has", () => {
    expect(
      titlesOf(
        getOpenStackAccessGaps({
          apis: ALL_UP,
          workers: [],
          hypervisors: [],
          hasStoragePools: false,
        }),
      ),
    ).toEqual([
      "hypervisors",
      "compute-services",
      "network-agents",
      "volume-services",
      "storage-pools",
    ]);
  });

  test("each says so by name, in the words a person reads", () => {
    const gaps: Array<OpenStackAccessGap> = getOpenStackAccessGaps({
      apis: ALL_UP,
      workers: [],
      hypervisors: [],
    });
    expect(gaps[0]?.title).toBe("This credential can't list hypervisors");
    expect(gaps[1]?.title).toBe("This credential can't list compute services");
    expect(gaps[2]?.title).toBe("This credential can't list network agents");
    expect(gaps[3]?.title).toBe("This credential can't list volume services");
  });

  test("an API that is down says nothing about what a credential can do", () => {
    expect(
      getOpenStackAccessGaps({
        apis: [
          api("compute", "down"),
          api("network", "down"),
          api("volume", "down"),
        ],
        workers: [],
        hypervisors: [],
        hasStoragePools: false,
      }),
    ).toEqual([]);
  });

  test("a service a cloud doesn't run has no API, and nothing to be closed", () => {
    expect(
      getOpenStackAccessGaps({
        apis: [api("identity")],
        workers: [],
        hypervisors: [],
        hasStoragePools: false,
      }),
    ).toEqual([]);
  });

  test("rows of the kind close the gap", () => {
    expect(
      getOpenStackAccessGaps({
        apis: ALL_UP,
        workers: [
          worker("compute", "nova-compute", "c-1"),
          worker("network", "neutron-l3-agent", "c-1"),
          worker("volume", "cinder-volume", "c-1"),
        ],
        hypervisors: [row(OpenStackResourceKind.Hypervisor)],
        hasStoragePools: true,
      }),
    ).toEqual([]);
  });

  test("a region that shows nothing has a gap, whatever another region shows", () => {
    expect(
      titlesOf(
        getOpenStackAccessGaps({
          apis: [
            api("compute", "up", "RegionOne"),
            api("compute", "up", "RegionTwo"),
          ],
          workers: [worker("compute", "nova-compute", "c-1")],
          hypervisors: [row(OpenStackResourceKind.Hypervisor)],
        }),
      ),
    ).toEqual(["hypervisors", "compute-services"]);
  });

  test("a page that says nothing about hypervisors or pools isn't told about them", () => {
    expect(
      titlesOf(
        getOpenStackAccessGaps({
          apis: ALL_UP,
          workers: [
            worker("compute", "nova-compute", "c-1"),
            worker("network", "neutron-l3-agent", "c-1"),
            worker("volume", "cinder-volume", "c-1"),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("the alerts that watch a service", () => {
  const EXISTING: Set<string> = new Set(
    getAllOpenStackAlertTemplates().map(
      (template: OpenStackAlertTemplate): string => {
        return template.id;
      },
    ),
  );

  test("every API's are templates that exist", () => {
    for (const service of Object.values(OpenStackServiceType)) {
      const ids: Array<string> = getOpenStackServiceAlertTemplateIds(service);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect({ service, id, exists: EXISTING.has(id) }).toEqual({
          service,
          id,
          exists: true,
        });
      }
    }
  });

  test("an API's own alert, and those on the workers it answers for", () => {
    expect(getOpenStackServiceAlertTemplateIds("compute")).toEqual([
      "openstack-compute-api-down",
      "openstack-compute-service-down",
      "openstack-scheduler-or-conductor-down",
      "openstack-every-scheduler-or-conductor-down",
    ]);
    expect(getOpenStackServiceAlertTemplateIds("network")).toEqual([
      "openstack-network-api-down",
      "openstack-network-agent-down",
    ]);
    expect(getOpenStackServiceAlertTemplateIds("volume")).toEqual([
      "openstack-block-storage-api-down",
      "openstack-block-storage-service-down",
    ]);
    expect(getOpenStackServiceAlertTemplateIds("identity")).toEqual([
      "openstack-identity-api-down",
    ]);
    expect(getOpenStackServiceAlertTemplateIds("dns")).toEqual([]);
  });

  test("each worker's are the ones that fire for it, and exist", () => {
    const cases: Array<[OpenStackResource, Array<string>]> = [
      [
        worker("compute", "nova-compute", "c-1"),
        ["openstack-compute-service-down"],
      ],
      [
        worker("compute", "nova-conductor", "c-1"),
        [
          "openstack-scheduler-or-conductor-down",
          "openstack-every-scheduler-or-conductor-down",
        ],
      ],
      [
        worker("network", "ovn-controller", "c-1"),
        ["openstack-network-agent-down"],
      ],
      [
        worker("volume", "cinder-scheduler", "c-1"),
        ["openstack-block-storage-service-down"],
      ],
    ];
    for (const [one, ids] of cases) {
      expect(getOpenStackWorkerAlertTemplateIds(one)).toEqual(ids);
      for (const id of ids) {
        expect(EXISTING.has(id)).toBe(true);
      }
    }
    expect(
      getOpenStackWorkerAlertTemplateIds(row(OpenStackResourceKind.Service)),
    ).toEqual([]);
  });
});

describe("whether an open record is about a service", () => {
  const workers: Array<OpenStackResource> = [
    worker("compute", "nova-compute", "c-1"),
  ];
  const about: (labels: JSONObject | null) => boolean = (
    labels: JSONObject | null,
  ): boolean => {
    return isOpenStackIssueAboutService({
      labels,
      service: "compute",
      regionName: "RegionOne",
      workers,
    });
  };

  test("a monitor of its API, which says which service it collected", () => {
    expect(about({ openstack_service: "compute" })).toBe(true);
    expect(about({ openstack_service: "network" })).toBe(false);
  });

  test("a monitor of a worker it answers for", () => {
    expect(about({ service: "nova-compute", hostname: "c-1" })).toBe(true);
    expect(about({ service: "neutron-l3-agent", hostname: "c-1" })).toBe(false);
  });

  test("not another region's, and a record that names none could be any", () => {
    expect(
      about({
        openstack_service: "compute",
        "openstack.region.name": "RegionTwo",
      }),
    ).toBe(false);
    expect(
      about({
        openstack_service: "compute",
        "openstack.region.name": "RegionOne",
      }),
    ).toBe(true);
  });

  test("a record that says nothing is about nothing", () => {
    expect(about(null)).toBe(false);
    expect(about({})).toBe(false);
  });
});

describe("which rows a region reads", () => {
  test("its own, and Keystone's belongs to all of them", () => {
    const inRegion: (row_: OpenStackResource) => boolean = (
      row_: OpenStackResource,
    ): boolean => {
      return isOpenStackRowInRegion({
        row: row_,
        regionName: "RegionOne",
        now: NOW,
      });
    };
    expect(inRegion(api("compute", "up", "RegionOne"))).toBe(true);
    expect(inRegion(api("compute", "up", "RegionTwo"))).toBe(false);
    expect(
      inRegion(row(OpenStackResourceKind.Domain, { regionName: undefined })),
    ).toBe(true);
  });

  test("a project at a quota is the concern of the region the quota is in", () => {
    const project: OpenStackResource = row(OpenStackResourceKind.Project, {
      regionName: undefined,
      facts: {
        [getOpenStackQuotaFactKey(
          OpenStackQuotaResource.Instances,
          "RegionTwo",
        )]: {
          used: 95,
          limit: 100,
          observedAt: NOW.toISOString(),
        },
      },
    });
    expect(
      isOpenStackRowInRegion({
        row: project,
        regionName: "RegionTwo",
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isOpenStackRowInRegion({
        row: project,
        regionName: "RegionOne",
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("hypervisors, as a tile reads them", () => {
  const up: (fields?: Partial<OpenStackResource>) => OpenStackResource = (
    fields: Partial<OpenStackResource> = {},
  ): OpenStackResource => {
    return row(OpenStackResourceKind.Hypervisor, {
      name: "h-up",
      status: "up",
      adminState: "enabled",
      vcpuCapacity: 100,
      vcpuAllocated: 10,
      memoryCapacityBytes: 100,
      memoryAllocatedBytes: 10,
      ...fields,
    });
  };

  test("a lost one is lost and a disabled one is disabled, and a disabled one is not lost", () => {
    expect(
      getOpenStackHypervisorCounts([
        up(),
        up({ status: "down" }),
        up({ adminState: "disabled" }),
        up({ status: "down", adminState: "disabled" }),
        // Not a hypervisor at all.
        worker("compute", "nova-compute", "c-1"),
      ]),
    ).toEqual({ total: 4, up: 1, lost: 1, disabled: 2 });
  });

  test("a bar warns at the rules' own line, on a host that can take instances", () => {
    const atLine: number = OPENSTACK_ALLOCATION_WARNING_PERCENT;
    expect(
      hasOpenStackHostPastAllocationLine(
        [up({ vcpuAllocated: atLine })],
        "vcpu",
      ),
    ).toBe(false);
    expect(
      hasOpenStackHostPastAllocationLine(
        [up({ vcpuAllocated: atLine + 1 })],
        "vcpu",
      ),
    ).toBe(true);
    expect(
      hasOpenStackHostPastAllocationLine(
        [up({ memoryAllocatedBytes: atLine + 1 })],
        "memory",
      ),
    ).toBe(true);
    expect(
      hasOpenStackHostPastAllocationLine(
        [up({ vcpuAllocated: atLine + 1 })],
        "memory",
      ),
    ).toBe(false);
    // A lost host's numbers are old, and a disabled one takes nothing new.
    expect(
      hasOpenStackHostPastAllocationLine(
        [up({ vcpuAllocated: 99, status: "down" })],
        "vcpu",
      ),
    ).toBe(false);
    expect(
      hasOpenStackHostPastAllocationLine(
        [up({ vcpuAllocated: 99, adminState: "disabled" })],
        "vcpu",
      ),
    ).toBe(false);
    expect(hasOpenStackHostPastAllocationLine([], "vcpu")).toBe(false);
  });

  test("the most allocated, most first, never a host whose numbers can't be trusted", () => {
    const busy: Array<OpenStackBusyHypervisor> =
      getOpenStackMostAllocatedHypervisors({
        rows: [
          up({ name: "low", vcpuAllocated: 10 }),
          up({ name: "high", vcpuAllocated: 90 }),
          up({ name: "lost", vcpuAllocated: 99, status: "down" }),
          up({ name: "off", vcpuAllocated: 99, adminState: "disabled" }),
          up({ name: "none", vcpuCapacity: 0 }),
          worker("compute", "nova-compute", "c-1"),
        ],
        kind: "vcpu",
        limit: 5,
      });
    expect(
      busy.map((one: OpenStackBusyHypervisor) => {
        return one.row.name;
      }),
    ).toEqual(["high", "low"]);
    expect(busy[0]?.percent).toBe(90);
  });

  test("no more than it was asked for, and the same percent breaks by name", () => {
    expect(
      getOpenStackMostAllocatedHypervisors({
        rows: [up({ name: "b" }), up({ name: "a" }), up({ name: "c" })],
        kind: "memory",
        limit: 2,
      }).map((one: OpenStackBusyHypervisor) => {
        return one.row.name;
      }),
    ).toEqual(["a", "b"]);
  });
});

describe("the storage tile", () => {
  const pool: (used: number) => OpenStackResource = (
    used: number,
  ): OpenStackResource => {
    return row(OpenStackResourceKind.StoragePool, {
      diskCapacityBytes: 100,
      diskAllocatedBytes: used,
    });
  };

  test("reads the fullest pool among what it was given", () => {
    expect(getOpenStackFullestPoolPercent([pool(10), pool(90), pool(50)])).toBe(
      90,
    );
    expect(getOpenStackFullestPoolPercent([])).toBeNull();
    expect(
      getOpenStackFullestPoolPercent([
        row(OpenStackResourceKind.Hypervisor, {
          diskCapacityBytes: 100,
          diskAllocatedBytes: 99,
        }),
      ]),
    ).toBeNull();
  });

  test("its colour turns exactly where the rules do", () => {
    const warning: number = OPENSTACK_STORAGE_POOL_WARNING_PERCENT;
    const critical: number = OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT;
    expect(getOpenStackPoolTone(null)).toBe("positive");
    expect(getOpenStackPoolTone(warning)).toBe("positive");
    expect(getOpenStackPoolTone(warning + 0.1)).toBe("warning");
    expect(getOpenStackPoolTone(critical)).toBe("warning");
    expect(getOpenStackPoolTone(critical + 0.1)).toBe("danger");
  });
});

describe("the attention rows read a region at a time", () => {
  const answer: (
    rows: Array<OpenStackResource>,
    totalsByKind: Record<string, number>,
  ) => OpenStackAttentionAnswer = (
    rows: Array<OpenStackResource>,
    totalsByKind: Record<string, number>,
  ): OpenStackAttentionAnswer => {
    return { rows, totalsByKind };
  };

  test("add up, kind by kind", () => {
    const merged: OpenStackAttentionAnswer = mergeOpenStackAttention([
      answer([api("compute", "down", "RegionOne")], {
        Api: 1,
        Instance: 340,
      }),
      answer([api("compute", "down", "RegionTwo")], {
        Api: 1,
        Instance: 2,
      }),
    ]);
    expect(merged.rows).toHaveLength(2);
    expect(merged.totalsByKind).toEqual({ Api: 2, Instance: 342 });
  });

  test("a project is in every answer, and counted once", () => {
    const project: OpenStackResource = row(OpenStackResourceKind.Project, {
      externalId: "p-1",
      regionName: undefined,
    });
    const merged: OpenStackAttentionAnswer = mergeOpenStackAttention([
      answer([project], { Project: 1 }),
      answer([project], { Project: 1 }),
    ]);
    expect(merged.rows).toHaveLength(1);
    expect(merged.totalsByKind).toEqual({ Project: 1 });
  });

  test("no answers are no rows", () => {
    expect(mergeOpenStackAttention([])).toEqual({ rows: [], totalsByKind: {} });
  });

  test("a row's dates arrive as text and read as dates, and a bad one as none", () => {
    const parsed: OpenStackResource = toOpenStackAttentionRow({
      kind: "Instance",
      externalId: "i-1",
      stateChangedAt: "2026-11-04T10:00:00.000Z",
      lastSeenAt: "not a date",
      diskCapacityBytes: 5,
    });
    expect(parsed).toBeInstanceOf(OpenStackResource);
    expect(parsed.stateChangedAt?.getTime()).toBe(
      new Date("2026-11-04T10:00:00.000Z").getTime(),
    );
    expect(parsed.lastSeenAt).toBeUndefined();
    expect(parsed.diskCapacityBytes).toBe(5);
  });
});

describe("the region in the address", () => {
  test("reads as it was written, and nothing named is nothing", () => {
    expect(getOpenStackRegionFromSearch("?region=RegionOne")).toBe("RegionOne");
    expect(getOpenStackRegionFromSearch("?a=1&region=eu%20west%2F2")).toBe(
      "eu west/2",
    );
    expect(getOpenStackRegionFromSearch("?other=1")).toBeNull();
    expect(getOpenStackRegionFromSearch("")).toBeNull();
    expect(getOpenStackRegionFromSearch("?region=")).toBeNull();
    expect(getOpenStackRegionFromSearch("?region=%20")).toBeNull();
  });

  test("a link to one region encodes its name, and leaves the route it was handed", () => {
    const route: Route = new Route("/dashboard/p/openstack/c");
    expect(getOpenStackRegionRoute(route, "eu west/2").toString()).toBe(
      "/dashboard/p/openstack/c?region=eu%20west%2F2",
    );
    expect(route.toString()).toBe("/dashboard/p/openstack/c");
  });
});
