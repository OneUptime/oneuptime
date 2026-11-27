/*
 * The Affected Resources chip filters a list by the resources its records
 * touch, and the type -> relation mapping is the whole contract: filter the
 * wrong relation and the list silently shows the wrong rows, with the chip
 * still lit and claiming to apply.
 *
 * The mapping used to be an if/else chain ending in a bare `else` that
 * returned "podmanHosts". Every type added after Podman — Proxmox, Ceph,
 * storage arrays, Docker Swarm, IoT — would have fallen into it and filtered
 * alerts by Podman hosts. These tests pin one assertion per type.
 *
 * Its filter is one LinkedTo the list's own query carries (#11073), built
 * from the picks alone: the chip used to read each type's matching records
 * first - the first 10,000 of them - and filter the list by their ids, so a
 * monitor with more incidents than that listed only some, and said nothing.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import buildAffectedResourcesFacet, {
  NO_RESOURCE_ID,
} from "../../FeatureSet/Dashboard/src/Components/AffectedResources/buildAffectedResourcesFacet";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import {
  buildFacetColumnQuery,
  FacetColumnQuery,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Includes from "Common/Types/BaseDatabase/Includes";
import LinkedTo, {
  LINKED_TO_QUERY_KEY,
  LinkedToMatch,
  MAX_LINKED_TO_IDS,
} from "Common/Types/BaseDatabase/LinkedTo";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_ID: string = "33333333-3333-4333-8333-333333333333";
const IS_OPERATOR: FilterOperator = "is";
const IS_NOT_OPERATOR: FilterOperator = "is_not";

function alertFacet(): ResourceFacet {
  return buildAffectedResourcesFacet<Alert>({
    parentModelType: Alert,
    monitorQueryField: "monitorId",
    excludeMonitor: true,
  });
}

function incidentFacet(): ResourceFacet {
  return buildAffectedResourcesFacet<Incident>({
    parentModelType: Incident,
    includeNetworkDevice: true,
    includeCloudResource: true,
    includeServiceLevelObjective: true,
  });
}

// The chip's filter for these picks: a LinkedTo, or a test failure.
function linkedToOf(
  facet: ResourceFacet,
  values: Array<string>,
  operator: FilterOperator = IS_OPERATOR,
): LinkedTo {
  const linkedTo: LinkedTo | null = facet.toLinkedTo!(values, operator);

  expect(linkedTo).toBeInstanceOf(LinkedTo);

  return linkedTo!;
}

// `count` distinct ids.
function ids(count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `11073000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
});

describe("buildAffectedResourcesFacet maps each resource type to its relation", () => {
  test.each([
    ["service", "services"],
    ["host", "hosts"],
    ["kubernetesCluster", "kubernetesClusters"],
    ["dockerHost", "dockerHosts"],
    ["podmanHost", "podmanHosts"],
    ["proxmoxCluster", "proxmoxClusters"],
    ["openStackCloud", "openStackClouds"],
    ["vmwareVCenter", "vmwareVCenters"],
    ["xcpNgPool", "xcpNgPools"],
    ["cephCluster", "cephClusters"],
    ["storageArray", "storageArrays"],
    ["dockerSwarmCluster", "dockerSwarmClusters"],
    ["iotFleet", "iotFleets"],
    ["databaseServer", "databaseServers"],
  ])(
    "a %s pick filters by the %s relation",
    (type: string, relation: string) => {
      const linkedTo: LinkedTo = linkedToOf(alertFacet(), [
        `${type}:${RESOURCE_ID}`,
      ]);

      expect(linkedTo.match).toBe(LinkedToMatch.AnyOf);
      expect(linkedTo.relations).toEqual({ [relation]: [RESOURCE_ID] });
    },
  );

  test.each([
    ["networkDevice", "networkDevices"],
    ["cloudResource", "cloudResources"],
    ["serviceLevelObjective", "serviceLevelObjectives"],
    ["monitor", "monitors"],
  ])(
    "on incidents, a %s pick filters by the %s relation",
    (type: string, relation: string) => {
      expect(
        linkedToOf(incidentFacet(), [`${type}:${RESOURCE_ID}`]).relations,
      ).toEqual({ [relation]: [RESOURCE_ID] });
    },
  );

  test("the monitor type uses the field the caller named", () => {
    /*
     * Alert.monitor is the one ManyToOne — it filters on the FK column,
     * not on a join table, so the caller passes the field name.
     */
    const facet: ResourceFacet = buildAffectedResourcesFacet<Alert>({
      parentModelType: Alert,
      monitorQueryField: "monitorId",
    });

    expect(linkedToOf(facet, [`monitor:${RESOURCE_ID}`]).relations).toEqual({
      monitorId: [RESOURCE_ID],
    });
  });

  test("picks of several types are one filter, OR'd: a record touching any of them", () => {
    const linkedTo: LinkedTo = linkedToOf(alertFacet(), [
      `host:${RESOURCE_ID}`,
      `cephCluster:${RESOURCE_ID}`,
      `storageArray:${OTHER_ID}`,
      `databaseServer:${RESOURCE_ID}`,
      `host:${OTHER_ID}`,
    ]);

    expect(linkedTo.match).toBe(LinkedToMatch.AnyOf);
    expect(linkedTo.relations).toEqual({
      hosts: [RESOURCE_ID, OTHER_ID],
      cephClusters: [RESOURCE_ID],
      storageArrays: [OTHER_ID],
      databaseServers: [RESOURCE_ID],
    });
  });

  test('"is not" keeps the records touching none of them', () => {
    const linkedTo: LinkedTo = linkedToOf(
      alertFacet(),
      [`host:${RESOURCE_ID}`, `service:${OTHER_ID}`],
      IS_NOT_OPERATOR,
    );

    expect(linkedTo.match).toBe(LinkedToMatch.NoneOf);
    expect(linkedTo.relations).toEqual({
      hosts: [RESOURCE_ID],
      services: [OTHER_ID],
    });
  });

  test("nothing is read to build the filter: the server answers it in the list's own query", () => {
    linkedToOf(alertFacet(), [
      `host:${RESOURCE_ID}`,
      `service:${RESOURCE_ID}`,
      `iotFleet:${RESOURCE_ID}`,
    ]);

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a resource picked twice, or in capitals, is named once", () => {
    expect(
      linkedToOf(alertFacet(), [
        `host:${RESOURCE_ID}`,
        `host:${RESOURCE_ID.toUpperCase()}`,
        `host:${RESOURCE_ID}`,
      ]).relations,
    ).toEqual({ hosts: [RESOURCE_ID] });
  });

  test(`picks past the ${MAX_LINKED_TO_IDS} one filter names are left out, as the owner chip leaves them`, () => {
    const picks: Array<string> = ids(MAX_LINKED_TO_IDS + 5).map(
      (id: string): string => {
        return `host:${id}`;
      },
    );

    expect(linkedToOf(alertFacet(), picks).relations["hosts"]).toEqual(
      ids(MAX_LINKED_TO_IDS),
    );
  });

  test('"is empty" and "is not empty" ask nothing of it', () => {
    for (const operator of [
      "is_empty",
      "is_not_empty",
    ] as Array<FilterOperator>) {
      expect(
        alertFacet().toLinkedTo!([`host:${RESOURCE_ID}`], operator),
      ).toBeNull();
    }
  });

  test("no picks, no filter", () => {
    expect(alertFacet().toLinkedTo!([], IS_OPERATOR)).toBeNull();
    expect(alertFacet().toLinkedTo!([], IS_NOT_OPERATOR)).toBeNull();
  });
});

/*
 * A pick a link or a saved view brought back can name nothing here: a type
 * this list does not offer, a key with no type, an id that is no id. It is
 * left out - and under "is", picks that all name nothing match nothing (a
 * record is linked to no such resource), as a deleted resource's pick does,
 * rather than dropping the filter and listing everything under a lit chip.
 */
describe("picks that name nothing", () => {
  test.each([
    ["a type that is not a resource", `somethingElse:${RESOURCE_ID}`],
    ["no type at all", RESOURCE_ID],
    ["an id that is no id", "host:not-an-id"],
    ["a type this list does not offer", `networkSite:${RESOURCE_ID}`],
    [
      "the monitor type, where a Monitor chip of its own filters monitors",
      `monitor:${RESOURCE_ID}`,
    ],
  ])('under "is", %s matches nothing', (_case: string, pick: string) => {
    expect(linkedToOf(alertFacet(), [pick]).relations).toEqual({
      services: [NO_RESOURCE_ID],
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test('under "is not", they keep every record', () => {
    expect(
      alertFacet().toLinkedTo!(
        [`somethingElse:${RESOURCE_ID}`, "host:not-an-id"],
        IS_NOT_OPERATOR,
      ),
    ).toBeNull();
  });

  test("beside a pick that names a resource, they are only left out", () => {
    expect(
      linkedToOf(alertFacet(), [
        `somethingElse:${RESOURCE_ID}`,
        `host:${RESOURCE_ID}`,
        "host:not-an-id",
      ]).relations,
    ).toEqual({ hosts: [RESOURCE_ID] });
  });
});

describe("the chip's filter, as the list's query holds it", () => {
  test('goes under "linkedTo", whatever the chip is called', () => {
    const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
      facet: alertFacet(),
      operator: IS_OPERATOR,
      values: [`host:${RESOURCE_ID}`],
      existingValue: undefined,
    });

    expect(columnQuery?.field).toBe(LINKED_TO_QUERY_KEY);
    expect(columnQuery?.value).toBeInstanceOf(LinkedTo);
    expect((columnQuery?.value as LinkedTo).relations).toEqual({
      hosts: [RESOURCE_ID],
    });
  });

  test("an empty selection, or a valueless operator, writes nothing", () => {
    for (const [operator, values] of [
      ["is", []],
      ["is_not", []],
      ["is_empty", []],
      ["is_not_empty", [`host:${RESOURCE_ID}`]],
    ] as Array<[FilterOperator, Array<string>]>) {
      expect(
        buildFacetColumnQuery({
          facet: alertFacet(),
          operator: operator,
          values: values,
          existingValue: undefined,
        }),
      ).toBeNull();
    }
  });
});

describe("the chip's search", () => {
  test("offers every resource type in the dropdown when monitors are excluded", async () => {
    await alertFacet().loadOptions!(PROJECT_ID, "");

    /*
     * One lookup per offered type. Monitors are excluded here because the
     * alerts table carries a dedicated Monitor chip.
     */
    expect(getListMock.mock.calls).toHaveLength(14);
  });

  test("searches each type on the server by the name typed, a page each", async () => {
    await alertFacet().loadOptions!(PROJECT_ID, "  prod ");

    for (const call of getListMock.mock.calls) {
      const request: { query: JSONObject; limit: number } = call[0] as {
        query: JSONObject;
        limit: number;
      };

      expect(request.query["projectId"]).toBe(PROJECT_ID);
      expect((request.query["name"] as { value: string }).value).toBe("prod");
      expect(request.limit).toBe(25);
    }
  });

  test("offers Databases in the dropdown, grouped under their own label", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string } }) => {
        if (args.modelType.name === "DatabaseServer") {
          return {
            data: [
              {
                id: new ObjectID(RESOURCE_ID),
                name: "PostgreSQL db.prod:5432",
              },
            ],
            count: 1,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .loadOptions!(PROJECT_ID, "");

    const database: FilterChipDropdownOption | undefined = options.find(
      (option: FilterChipDropdownOption): boolean => {
        return option.value === `databaseServer:${RESOURCE_ID}`;
      },
    );
    expect(database).toBeDefined();
    expect(database!.label).toBe("PostgreSQL db.prod:5432");
    expect(database!.group).toBe("Databases");
    expect(database!.isArchived).toBeUndefined();
  });

  test("offers storage arrays in the dropdown, grouped under their own label", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string } }) => {
        if (args.modelType.name === "StorageArray") {
          return {
            data: [{ id: new ObjectID(RESOURCE_ID), name: "fa-prod-01" }],
            count: 1,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .loadOptions!(PROJECT_ID, "");

    const storageArray: FilterChipDropdownOption | undefined = options.find(
      (option: FilterChipDropdownOption): boolean => {
        return option.value === `storageArray:${RESOURCE_ID}`;
      },
    );
    expect(storageArray).toBeDefined();
    expect(storageArray!.label).toBe("fa-prod-01");
    expect(storageArray!.group).toBe("Storage Arrays");
  });

  test("an archived resource is offered, marked archived, and its archive is asked for", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string } }) => {
        if (args.modelType.name === "Host") {
          return {
            data: [
              {
                id: new ObjectID(RESOURCE_ID),
                name: "old-web",
                isArchived: true,
              },
              { id: new ObjectID(OTHER_ID), name: "web", isArchived: false },
            ],
            count: 2,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .loadOptions!(PROJECT_ID, "web");

    const hostRead: { select: JSONObject } = getListMock.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: { name: string } }).modelType.name === "Host"
        );
      },
    )![0] as { select: JSONObject };

    expect(hostRead.select).toEqual({
      _id: true,
      name: true,
      isArchived: true,
    });
    expect(
      options
        .filter((option: FilterChipDropdownOption): boolean => {
          return option.group === "Hosts";
        })
        .map((option: FilterChipDropdownOption) => {
          return [option.label, Boolean(option.isArchived)];
        }),
    ).toEqual([
      ["old-web", true],
      ["web", false],
    ]);
  });

  test("a type that cannot be archived is not asked for its archive", async () => {
    await buildAffectedResourcesFacet({
      parentModelType: Alert,
      includeNetworkSite: true,
    }).loadOptions!(PROJECT_ID, "");

    const siteRead: { select: JSONObject } = getListMock.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: { name: string } }).modelType.name ===
          "NetworkSite"
        );
      },
    )![0] as { select: JSONObject };

    expect(siteRead.select).toEqual({ _id: true, name: true });
  });

  test("a type whose search fails offers nothing, and the others still answer", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string } }) => {
        if (args.modelType.name === "Host") {
          throw new Error("refused");
        }
        if (args.modelType.name === "Service") {
          return {
            data: [{ id: new ObjectID(RESOURCE_ID), name: "checkout" }],
            count: 1,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .loadOptions!(PROJECT_ID, "");

    expect(
      options.map((option: FilterChipDropdownOption): string => {
        return option.value;
      }),
    ).toEqual([`service:${RESOURCE_ID}`]);
  });
});

/*
 * What a link or a saved view picked is read by its ids, whatever the
 * project holds: a resource found by its name, an archived one marked, one
 * gone as "No longer available" under its type - never as its key.
 */
describe("the chip's saved picks", () => {
  test("are read by their ids, within the project, each type from its own table", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string }; query: JSONObject }) => {
        if (args.modelType.name === "Host") {
          return {
            data: [{ id: new ObjectID(RESOURCE_ID), name: "web-1" }],
            count: 1,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .resolveOptions!(PROJECT_ID, [`host:${RESOURCE_ID}`]);

    expect(getListMock).toHaveBeenCalledTimes(1);
    const request: { query: JSONObject; limit: number } = getListMock.mock
      .calls[0]![0] as { query: JSONObject; limit: number };

    expect(request.query["projectId"]).toBe(PROJECT_ID);
    expect(
      ((request.query["_id"] as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([RESOURCE_ID]);
    expect(request.limit).toBe(1);
    expect(options).toEqual([
      expect.objectContaining({
        value: `host:${RESOURCE_ID}`,
        label: "web-1",
        group: "Hosts",
      }),
    ]);
    expect(options[0]!.isNotFound).toBeUndefined();
  });

  test("one gone - deleted, or out of the reader's reach - is named as gone, under its type", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string } }) => {
        if (args.modelType.name === "Host") {
          return {
            data: [{ id: new ObjectID(RESOURCE_ID), name: "web-1" }],
            count: 1,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .resolveOptions!(PROJECT_ID, [
      `host:${RESOURCE_ID}`,
      `host:${OTHER_ID}`,
      `service:${OTHER_ID}`,
    ]);

    expect(
      options.map((option: FilterChipDropdownOption) => {
        return [option.value, option.group, Boolean(option.isNotFound)];
      }),
    ).toEqual([
      [`service:${OTHER_ID}`, "Services", true],
      [`host:${RESOURCE_ID}`, "Hosts", false],
      [`host:${OTHER_ID}`, "Hosts", true],
    ]);
  });

  test("an archived one is marked archived", async () => {
    getListMock.mockResolvedValue({
      data: [
        { id: new ObjectID(RESOURCE_ID), name: "old-web", isArchived: true },
      ],
      count: 1,
      skip: 0,
      limit: 0,
    });

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .resolveOptions!(PROJECT_ID, [`host:${RESOURCE_ID}`]);

    expect(options[0]!.label).toBe("old-web");
    expect(options[0]!.isArchived).toBe(true);
  });

  test("a read that fails names nothing, rather than calling the picks gone", async () => {
    getListMock.mockRejectedValue(new Error("offline"));

    expect(
      await alertFacet().resolveOptions!(PROJECT_ID, [`host:${RESOURCE_ID}`]),
    ).toEqual([]);
  });

  test("a pick whose id is no id, or of a type not offered, is not read", async () => {
    expect(
      await alertFacet().resolveOptions!(PROJECT_ID, [
        "host:not-an-id",
        `networkSite:${RESOURCE_ID}`,
      ]),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("many picks of a type are read in pages, every one of them named", async () => {
    const picked: Array<string> = ids(1200);

    getListMock.mockImplementation(async (args: { query: JSONObject }) => {
      return {
        data: ((args.query["_id"] as Includes).values as Array<ObjectID>).map(
          (id: ObjectID) => {
            return { id: id, name: `host ${id.toString().slice(-4)}` };
          },
        ),
        count: 0,
        skip: 0,
        limit: 0,
      };
    });

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .resolveOptions!(
      PROJECT_ID,
      picked.map((id: string): string => {
        return `host:${id}`;
      }),
    );

    expect(getListMock.mock.calls.length).toBeGreaterThan(1);
    expect(options).toHaveLength(1200);
    expect(
      options.filter((option: FilterChipDropdownOption): boolean => {
        return Boolean(option.isNotFound);
      }),
    ).toEqual([]);
  });
});

/*
 * Issue #5341: incidents and alerts hold network devices, so their lists
 * can be filtered by one. Only theirs: a maintenance event has no such
 * relation, so the type is offered only where it is asked for.
 */
describe("network devices in the Affected Resources filter", () => {
  function deviceFacet(): ResourceFacet {
    return buildAffectedResourcesFacet<Alert>({
      parentModelType: Alert,
      monitorQueryField: "monitorId",
      excludeMonitor: true,
      includeNetworkDevice: true,
    });
  }

  test("a networkDevice pick filters by the networkDevices relation", () => {
    expect(
      linkedToOf(deviceFacet(), [`networkDevice:${RESOURCE_ID}`]).relations,
    ).toEqual({ networkDevices: [RESOURCE_ID] });
  });

  test("offers devices in the dropdown, grouped under their own label", async () => {
    getListMock.mockImplementation(
      async (args: { modelType: { name: string } }) => {
        if (args.modelType.name === "NetworkDevice") {
          return {
            data: [{ id: new ObjectID(RESOURCE_ID), name: "WAN-RTR-01" }],
            count: 1,
            skip: 0,
            limit: 0,
          };
        }
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    );

    const options: Array<FilterChipDropdownOption> = await deviceFacet()
      .loadOptions!(PROJECT_ID, "");

    const device: FilterChipDropdownOption | undefined = options.find(
      (option: FilterChipDropdownOption): boolean => {
        return option.value === `networkDevice:${RESOURCE_ID}`;
      },
    );

    expect(device).toBeDefined();
    expect(device!.label).toBe("WAN-RTR-01");
    expect(device!.group).toBe("Network Devices");
    // One lookup per offered type: the twelve, and devices.
    expect(getListMock.mock.calls).toHaveLength(15);
  });

  test("is not offered, nor filtered by, where it was not asked for", async () => {
    await alertFacet().loadOptions!(PROJECT_ID, "");

    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: { name: string } }).modelType.name ===
          "NetworkDevice"
        );
      }),
    ).toBe(false);

    expect(
      linkedToOf(alertFacet(), [`networkDevice:${RESOURCE_ID}`]).relations,
    ).toEqual({ services: [NO_RESOURCE_ID] });
  });
});
