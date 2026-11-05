import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import Host from "../../../../Models/DatabaseModels/Host";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import Service from "../../../../Models/DatabaseModels/Service";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import CephResourceService from "../../../../Server/Services/CephResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import ServiceService from "../../../../Server/Services/ServiceService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import OpenStackAcrossProducts from "../../../../Server/Utils/OpenStack/OpenStackAcrossProducts";
import { ExtractedEntity } from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  OpenStackServicePlacement,
} from "../../../../Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { keyForService } from "../../../../Utils/Telemetry/EntityKey";
import {
  EntityRelationshipEdge,
  deriveRelationships,
} from "../../../../Utils/Telemetry/EntityRelationship";
import {
  ARCHIVED_CLOUD,
  CLOUD_A,
  CLOUD_B,
  EstateHost,
  EstateHypervisor,
  EstateInstance,
  LINK_ESTATES,
  LinkEstate,
  MANY_DOMAINS_ESTATES,
  expectEstateToLinkAsWritten,
  expectLinksToBeOneToOne,
  getExpectedLinks,
  getRandomLinkEstates,
  getTooManyHostsEstate,
} from "./OpenStackLinkEstates";

/*
 * The joins between a cloud and the rest of OneUptime, with what each read returns made up
 * here. Whether the SQL itself reads what it says is OpenStackAcrossProductsPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OTHER_CLOUD_ID: ObjectID = ObjectID.generate();
const INSTANCE_ID: string = "a1b2c3d4-0000-4000-8000-000000000001";
const GUEST_ID: string = "a1b2c3d4-0000-4000-8000-000000000002";
const HYPERVISOR: string = "compute-01.example.internal";

function row(fields: Partial<OpenStackResource>): OpenStackResource {
  const resource: OpenStackResource = new OpenStackResource();
  Object.assign(resource, {
    projectId: PROJECT_ID,
    openStackCloudId: CLOUD_ID,
    ...fields,
  });
  return resource;
}

function hostRow(fields: Partial<Host>): Host {
  const host: Host = new Host();
  Object.assign(host, { _id: ObjectID.generate().toString(), ...fields });
  return host;
}

const INSTANCE: OpenStackResource = row({
  kind: OpenStackResourceKind.Instance,
  externalId: INSTANCE_ID,
  name: "web-1",
  regionName: "RegionOne",
  availabilityZone: "nova",
  hypervisorName: HYPERVISOR,
  openStackProjectId: "p1",
  status: "ACTIVE",
});

const HYPERVISOR_ROW: OpenStackResource = row({
  kind: OpenStackResourceKind.Hypervisor,
  externalId: `RegionOne/${HYPERVISOR}`,
  name: HYPERVISOR,
  regionName: "RegionOne",
  availabilityZone: "nova",
  hypervisorName: HYPERVISOR,
  status: "up",
});

function mockClouds(): void {
  const cloud: OpenStackCloud = new OpenStackCloud();
  cloud._id = CLOUD_ID.toString();
  cloud.name = "prod-eu";
  jest
    .spyOn(OpenStackCloudService, "findBy")
    .mockResolvedValue([cloud] as never);
  jest
    .spyOn(OpenStackCloudService, "findOneById")
    .mockResolvedValue(cloud as never);
}

function mockQuery(
  service: { getRepository: () => unknown },
  answer: (sql: string, params: Array<unknown>) => unknown,
): jest.Mock {
  const query: jest.Mock = jest.fn(
    async (sql: unknown, params: unknown): Promise<unknown> => {
      return answer(sql as string, params as Array<unknown>);
    },
  );
  jest
    .spyOn(service, "getRepository")
    .mockReturnValue({ manager: { query } } as never);
  return query;
}

beforeEach(() => {
  mockClouds();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * What a read's WHERE asks for, for a stand-in to answer: a list a helper bound, or one value.
 */
function valuesOf(condition: unknown): Array<string> {
  if (condition instanceof FindOperator) {
    return (
      Object.values(
        condition.objectLiteralParameters || {},
      )[0] as Array<unknown>
    ).map((value: unknown): string => {
      return String(value);
    });
  }
  return [String(condition)];
}

/*
 * The database, for an estate. It answers each read with what its statement asks, as far as a
 * read says it in values: which clouds and which UUIDs. A host's name it leaves to the code
 * under test, which has to hold each match to the rule itself, and it holds to each LIMIT, so a
 * read that asks for too much and filters afterwards is caught here as well as on Postgres.
 */
function standInFor(estate: LinkEstate): {
  cloudIds: Map<string, ObjectID>;
  hostIds: Map<string, ObjectID>;
  stamp: (hostName: string, cloudId: ObjectID) => Promise<void>;
} {
  const cloudIds: Map<string, ObjectID> = new Map(
    [CLOUD_A, CLOUD_B, ARCHIVED_CLOUD].map((name: string) => {
      return [name, ObjectID.generate()];
    }),
  );
  const cloudOf: (name: string) => ObjectID = (name: string): ObjectID => {
    return cloudIds.get(name) as ObjectID;
  };
  const cloudRows: Array<OpenStackCloud> = [
    CLOUD_A,
    CLOUD_B,
    ARCHIVED_CLOUD,
  ].map((name: string): OpenStackCloud => {
    return Object.assign(new OpenStackCloud(), {
      _id: cloudOf(name).toString(),
      name,
      isArchived: name === ARCHIVED_CLOUD,
    });
  });

  const hostRows: Array<Host> = estate.hosts.map((one: EstateHost): Host => {
    return hostRow({
      name: one.name,
      hostIdentifier: one.name,
      hostId: one.hostId,
      isArchived: Boolean(one.isArchived),
      openStackCloudId: one.cloud ? cloudOf(one.cloud) : undefined,
    } as Partial<Host>);
  });
  const hostIds: Map<string, ObjectID> = new Map(
    hostRows.map((one: Host): [string, ObjectID] => {
      return [one.hostIdentifier as string, one.id as ObjectID];
    }),
  );

  const hypervisorRows: Array<OpenStackResource> = estate.hypervisors.map(
    (one: EstateHypervisor, index: number): OpenStackResource => {
      return row({
        _id: ObjectID.generate().toString(),
        kind: OpenStackResourceKind.Hypervisor,
        externalId: `${one.region || "default"}/${one.name}/${index}`,
        name: one.name,
        regionName: one.region,
        hypervisorName: one.name,
        openStackCloudId: cloudOf(one.cloud),
      } as Partial<OpenStackResource>);
    },
  );
  const instanceRows: Array<OpenStackResource> = (estate.instances || []).map(
    (one: EstateInstance): OpenStackResource => {
      return row({
        _id: ObjectID.generate().toString(),
        kind: OpenStackResourceKind.Instance,
        externalId: one.id,
        name: one.id,
        hypervisorName: "somewhere",
        openStackCloudId: cloudOf(one.cloud),
      } as Partial<OpenStackResource>);
    },
  );

  const isInClouds: (
    resource: OpenStackResource,
    clouds: Array<string>,
  ) => boolean = (
    resource: OpenStackResource,
    clouds: Array<string>,
  ): boolean => {
    return clouds.includes(resource.openStackCloudId?.toString() || "");
  };

  jest.spyOn(OpenStackCloudService, "findBy").mockImplementation((async (data: {
    query: { isArchived?: boolean };
  }) => {
    return cloudRows.filter((cloud: OpenStackCloud): boolean => {
      return data.query.isArchived === false ? !cloud.isArchived : true;
    });
  }) as never);
  jest
    .spyOn(OpenStackCloudService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return cloudRows.find((cloud: OpenStackCloud): boolean => {
        return cloud.id?.toString() === data.id.toString();
      });
    }) as never);

  mockQuery(
    OpenStackResourceService,
    (sql: string, params: Array<unknown>): unknown => {
      if (sql.includes('SELECT "_id"')) {
        const clouds: Array<string> = params[1] as Array<string>;
        const names: Array<string> = params[2] as Array<string>;
        const pattern: string | null = params[3] as string | null;
        const limit: number = Number(sql.match(/LIMIT (\d+)/)![1]);
        return hypervisorRows
          .filter((one: OpenStackResource): boolean => {
            const name: string = (one.hypervisorName || "").toLowerCase();
            return (
              isInClouds(one, clouds) &&
              (names.includes(name) ||
                (pattern !== null &&
                  name.startsWith(
                    pattern.slice(0, -1).replace(/\\(.)/g, "$1"),
                  )))
            );
          })
          .slice(0, limit)
          .map((one: OpenStackResource): JSONObject => {
            return { _id: one._id as string };
          });
      }
      if (sql.includes('SELECT DISTINCT "externalId"')) {
        const clouds: Array<string> = params[1] as Array<string>;
        const ids: Array<string> = params[2] as Array<string>;
        return instanceRows
          .filter((one: OpenStackResource): boolean => {
            return (
              isInClouds(one, clouds) && ids.includes(one.externalId as string)
            );
          })
          .map((one: OpenStackResource): JSONObject => {
            return { externalId: one.externalId as string };
          });
      }
      return [];
    },
  );
  jest
    .spyOn(OpenStackResourceService, "findBy")
    .mockImplementation((async (data: {
      query: {
        _id?: unknown;
        externalId?: unknown;
        openStackCloudId?: unknown;
      };
      limit: number;
    }) => {
      if (data.query._id) {
        const ids: Array<string> = valuesOf(data.query._id);
        return hypervisorRows.filter((one: OpenStackResource): boolean => {
          return ids.includes(one._id as string);
        });
      }
      const clouds: Array<string> = valuesOf(data.query.openStackCloudId);
      return instanceRows
        .filter((one: OpenStackResource): boolean => {
          return (
            isInClouds(one, clouds) && one.externalId === data.query.externalId
          );
        })
        .slice(0, data.limit);
    }) as never);
  jest
    .spyOn(OpenStackResourceService, "findOneBy")
    .mockResolvedValue(null as never);

  jest.spyOn(HostService, "findBy").mockImplementation((async (data: {
    query: {
      hostId?: unknown;
      openStackCloudId?: ObjectID;
      isArchived?: boolean;
    };
    limit: number;
  }) => {
    const ids: Array<string> | null = data.query.hostId
      ? valuesOf(data.query.hostId)
      : null;
    return hostRows
      .filter((one: Host): boolean => {
        return (
          !one.isArchived &&
          (!ids || ids.includes((one.hostId || "").toLowerCase())) &&
          (!data.query.openStackCloudId ||
            one.openStackCloudId?.toString() ===
              data.query.openStackCloudId.toString())
        );
      })
      .slice(0, data.limit);
  }) as never);
  jest.spyOn(HostService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    return hostRows.find((one: Host): boolean => {
      return one.id?.toString() === data.id.toString();
    });
  }) as never);
  mockQuery(HostService, (): unknown => {
    return [];
  });
  mockQuery(KubernetesResourceService, (): unknown => {
    return [];
  });
  jest.spyOn(ServiceService, "findBy").mockResolvedValue([] as never);

  return {
    cloudIds,
    hostIds,
    stamp: async (hostName: string, cloudId: ObjectID): Promise<void> => {
      const found: Host | undefined = hostRows.find((one: Host): boolean => {
        return one.hostIdentifier === hostName;
      });
      (found as Host).openStackCloudId = cloudId;
    },
  };
}

describe("no link on a guess, from either end", () => {
  test.each(
    [...LINK_ESTATES, ...MANY_DOMAINS_ESTATES].map(
      (estate: LinkEstate): [string, LinkEstate] => {
        return [estate.title, estate];
      },
    ),
  )("%s", async (_title: string, estate: LinkEstate) => {
    await expectEstateToLinkAsWritten(estate, {
      projectId: PROJECT_ID,
      ...standInFor(estate),
    });
  });

  test("a name more hosts share than a read holds has no machine, since any of them could be it", async () => {
    const estate: LinkEstate = getTooManyHostsEstate();
    await expectEstateToLinkAsWritten(estate, {
      projectId: PROJECT_ID,
      ...standInFor(estate),
    });
  });

  test("the estates written out agree with the rule as a test reads it", () => {
    for (const estate of [...LINK_ESTATES, ...MANY_DOMAINS_ESTATES]) {
      expect({
        title: estate.title,
        ...getExpectedLinks(estate),
      }).toEqual({
        title: estate.title,
        machines: estate.machines || [],
        guests: estate.guests || [],
      });
    }
  });

  test.each([1, 2, 3, 4])(
    "estates nobody wrote out, drawn from seed %d, link one to one and agree from both ends",
    async (seed: number) => {
      for (const estate of getRandomLinkEstates({ seed, count: 60 })) {
        expectLinksToBeOneToOne(estate);
        await expectEstateToLinkAsWritten(estate, {
          projectId: PROJECT_ID,
          ...standInFor(estate),
        });
        jest.restoreAllMocks();
      }
    },
  );
});

describe("which cloud a host belongs to, for the link ingest makes", () => {
  test("a host.id that is an instance's UUID is that instance's cloud, whatever the host is called", async () => {
    mockClouds();
    const findBy: unknown = jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([INSTANCE] as never);
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: INSTANCE_ID,
        hostIdentifier: HYPERVISOR,
      }),
    ).resolves.toBe(CLOUD_ID);
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("the same UUID in two clouds links to neither", async () => {
    mockClouds();
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([
        INSTANCE,
        row({ ...INSTANCE, openStackCloudId: OTHER_CLOUD_ID }),
      ] as never);
    mockQuery(OpenStackResourceService, () => {
      return [];
    });
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: INSTANCE_ID,
        hostIdentifier: "web-1",
      }),
    ).resolves.toBeNull();
  });

  test("a machine-id is no instance's, so the name is what is asked", async () => {
    mockClouds();
    const findBy: unknown = jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([HYPERVISOR_ROW] as never);
    mockQuery(OpenStackResourceService, () => {
      return [{ _id: "x" }];
    });
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([hostRow({ hostIdentifier: "compute-01" })] as never);
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: "0123456789abcdef0123456789abcdef",
        hostIdentifier: "compute-01",
      }),
    ).resolves.toBe(CLOUD_ID);
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("a short name that fits two hypervisors links to neither", async () => {
    jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue([
      row({ hypervisorName: "compute-01.east.example" }),
      row({
        hypervisorName: "compute-01.west.example",
        openStackCloudId: OTHER_CLOUD_ID,
      }),
    ] as never);
    mockQuery(OpenStackResourceService, () => {
      return [{ _id: "x" }, { _id: "y" }];
    });
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: null,
        hostIdentifier: "compute-01",
      }),
    ).resolves.toBeNull();
  });

  test("a name the database found that isn't a match after all doesn't count", async () => {
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([
        row({ hypervisorName: "compute-01.east.example" }),
      ] as never);
    mockQuery(OpenStackResourceService, () => {
      return [{ _id: "x" }];
    });
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: null,
        hostIdentifier: "compute-01.west.example",
      }),
    ).resolves.toBeNull();
  });

  test("nothing to go on is nothing", async () => {
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: null,
        hostIdentifier: null,
      }),
    ).resolves.toBeNull();
  });

  test("a host's own _ or % in its name is a character, not a wildcard", async () => {
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [];
    });
    await OpenStackAcrossProducts.findCloudOfHost({
      projectId: PROJECT_ID,
      hostIdAttribute: null,
      hostIdentifier: "web_1%",
    });
    const params: Array<unknown> = query.mock.calls[0]![1] as Array<unknown>;
    expect(params[3]).toBe("web\\_1\\%.%");
  });

  test("a full name is asked for as itself and its short form, and any domain is not", async () => {
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [];
    });
    await OpenStackAcrossProducts.findCloudOfHost({
      projectId: PROJECT_ID,
      hostIdAttribute: null,
      hostIdentifier: "Compute-01.Example.Internal",
    });
    const params: Array<unknown> = query.mock.calls[0]![1] as Array<unknown>;
    expect(params[2]).toEqual(["compute-01.example.internal", "compute-01"]);
    expect(params[3]).toBeNull();
  });

  test("a project with no clouds is asked nothing more", async () => {
    jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([] as never);
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [];
    });
    await expect(
      OpenStackAcrossProducts.findCloudOfHost({
        projectId: PROJECT_ID,
        hostIdAttribute: INSTANCE_ID,
        hostIdentifier: "web-1",
      }),
    ).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("where something in another product runs", () => {
  test("a host with no cloud is on no cloud, and nothing else is asked", async () => {
    jest
      .spyOn(HostService, "findOneById")
      .mockResolvedValue(hostRow({ hostId: INSTANCE_ID }) as never);
    const findBy: unknown = jest.spyOn(OpenStackResourceService, "findBy");
    await expect(
      OpenStackAcrossProducts.getPlacementOfHost({
        projectId: PROJECT_ID,
        hostId: ObjectID.generate(),
      }),
    ).resolves.toBeNull();
    expect(findBy).not.toHaveBeenCalled();
  });

  function mockInstanceSurroundings(): void {
    mockClouds();
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([INSTANCE] as never);
    jest
      .spyOn(OpenStackResourceService, "findOneBy")
      .mockImplementation((async (data: {
        query: { kind: OpenStackResourceKind };
      }) => {
        return data.query.kind === OpenStackResourceKind.Project
          ? row({ name: "payments" })
          : row({ externalId: `RegionOne/${HYPERVISOR}` });
      }) as never);
  }

  test("a guest says its instance, its hypervisor, its zone and whose it is", async () => {
    mockInstanceSurroundings();
    jest
      .spyOn(HostService, "findOneById")
      .mockResolvedValue(
        hostRow({ hostId: INSTANCE_ID, openStackCloudId: CLOUD_ID }) as never,
      );
    const placement: OpenStackPlacement | null =
      await OpenStackAcrossProducts.getPlacementOfHost({
        projectId: PROJECT_ID,
        hostId: ObjectID.generate(),
      });
    expect(placement).toEqual({
      openStackCloudId: CLOUD_ID.toString(),
      cloudName: "prod-eu",
      kind: "instance",
      externalId: INSTANCE_ID,
      name: "web-1",
      regionName: "RegionOne",
      availabilityZone: "nova",
      hypervisorName: HYPERVISOR,
      hypervisorExternalId: `RegionOne/${HYPERVISOR}`,
      openStackProjectId: "p1",
      openStackProjectName: "payments",
      status: "ACTIVE",
    });
  });

  test("a Kubernetes node's provider ID names its instance", async () => {
    mockInstanceSurroundings();
    const query: jest.Mock = mockQuery(KubernetesResourceService, () => {
      return [{ providerId: `openstack:///${INSTANCE_ID}` }];
    });
    const placement: OpenStackPlacement | null =
      await OpenStackAcrossProducts.getPlacementOfKubernetesNode({
        projectId: PROJECT_ID,
        kubernetesClusterId: ObjectID.generate(),
        nodeName: "node-1",
      });
    expect(placement?.externalId).toBe(INSTANCE_ID);
    expect(query.mock.calls[0]![0] as string).toContain(`"kind" = 'Node'`);
  });

  test.each([
    ["another cloud's provider", "aws:///us-east-1a/i-0abc"],
    ["no provider at all", null],
  ])(
    "a node with %s isn't on OpenStack",
    async (_name: string, providerId: unknown) => {
      const findBy: unknown = jest.spyOn(OpenStackResourceService, "findBy");
      mockQuery(KubernetesResourceService, () => {
        return [{ providerId }];
      });
      await expect(
        OpenStackAcrossProducts.getPlacementOfKubernetesNode({
          projectId: PROJECT_ID,
          kubernetesClusterId: ObjectID.generate(),
          nodeName: "node-1",
        }),
      ).resolves.toBeNull();
      expect(findBy).not.toHaveBeenCalled();
    },
  );

  test("a service is placed through each host its telemetry names", async () => {
    mockInstanceSurroundings();
    mockQuery(HostService, (sql: string) => {
      return sql.includes('AS "hostName"')
        ? [
            { hostName: "web-1", instanceId: INSTANCE_ID },
            { hostName: "elsewhere", instanceId: null },
          ]
        : [];
    });
    mockQuery(OpenStackResourceService, () => {
      return [];
    });
    jest.spyOn(HostService, "findOneBy").mockImplementation((async () => {
      return null;
    }) as never);
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockImplementation((async (data: {
        query: { kind: OpenStackResourceKind };
      }) => {
        return data.query.kind === OpenStackResourceKind.Instance
          ? [INSTANCE]
          : [];
      }) as never);

    const placements: Awaited<
      ReturnType<typeof OpenStackAcrossProducts.getPlacementsOfService>
    > = await OpenStackAcrossProducts.getPlacementsOfService({
      projectId: PROJECT_ID,
      serviceName: "api",
    });
    expect(
      placements.map((one: (typeof placements)[number]): string => {
        return one.hostName;
      }),
    ).toEqual(["web-1"]);
    expect(placements[0]!.placement.hypervisorName).toBe(HYPERVISOR);
  });

  test("a service in Kubernetes is placed through the node its pods are on", async () => {
    mockInstanceSurroundings();
    const clusterId: ObjectID = ObjectID.generate();
    mockQuery(HostService, (sql: string) => {
      return sql.includes('AS "nodeName"')
        ? [{ clusterIdentifier: "prod", nodeName: "node-1" }]
        : [];
    });
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        { id: clusterId, clusterIdentifier: "prod" },
      ] as never);
    mockQuery(KubernetesResourceService, () => {
      return [{ providerId: `openstack:///${INSTANCE_ID}` }];
    });

    const placements: Array<OpenStackServicePlacement> =
      await OpenStackAcrossProducts.getPlacementsOfService({
        projectId: PROJECT_ID,
        serviceName: "api",
      });

    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      hostName: "node-1",
      hostId: null,
      kubernetesClusterId: clusterId.toString(),
    });
    expect(placements[0]!.placement.externalId).toBe(INSTANCE_ID);
  });

  test("a service on more machines than a page names stops at the limit", async () => {
    mockInstanceSurroundings();
    const hosts: Array<JSONObject> = [];
    for (let index: number = 0; index < 20; index++) {
      hosts.push({ hostName: `web-${index}`, instanceId: INSTANCE_ID });
    }
    mockQuery(HostService, (sql: string) => {
      return sql.includes('AS "hostName"') ? hosts : [];
    });
    mockQuery(OpenStackResourceService, () => {
      return [];
    });
    jest.spyOn(HostService, "findOneBy").mockResolvedValue(null as never);
    expect(
      await OpenStackAcrossProducts.getPlacementsOfService({
        projectId: PROJECT_ID,
        serviceName: "api",
      }),
    ).toHaveLength(10);
  });
});

describe("what a failed hypervisor takes with it beyond the cloud", () => {
  function mockEstate(data?: {
    hypervisorHosts?: Array<Host> | undefined;
    nodes?: Array<JSONObject> | undefined;
  }): void {
    mockQuery(OpenStackResourceService, (sql: string) => {
      // Which hypervisors its machine's host could be, which is another question.
      return sql.includes('SELECT "_id"')
        ? []
        : [{ externalId: INSTANCE_ID }, { externalId: GUEST_ID }];
    });
    mockQuery(KubernetesResourceService, () => {
      return (
        data?.nodes || [
          {
            clusterId: "cluster-1",
            clusterName: "prod",
            nodeName: "node-1",
            providerId: `openstack:///${INSTANCE_ID}`,
          },
          {
            clusterId: "cluster-2",
            clusterName: "elsewhere",
            nodeName: "node-9",
            providerId: "openstack:///ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
        ]
      );
    });
    mockQuery(HostService, () => {
      return [{ name: "api" }, { name: "worker" }, { name: null }];
    });
    // Asked twice, by name and by domain, a database answers with the same row both times.
    const hypervisorHosts: Array<Host> = data?.hypervisorHosts || [
      hostRow({ name: HYPERVISOR, hostIdentifier: HYPERVISOR }),
    ];
    jest.spyOn(HostService, "findBy").mockImplementation((async (query: {
      query: { hostId?: unknown };
    }) => {
      return query.query.hostId
        ? [hostRow({ name: "web-1", hostIdentifier: "web-1" })]
        : hypervisorHosts;
    }) as never);
    const api: Service = new Service();
    api._id = ObjectID.generate().toString();
    api.name = "api";
    jest.spyOn(ServiceService, "findBy").mockResolvedValue([api] as never);
  }

  test("the machine itself, the hosts its instances are, the nodes and clusters, and the services", async () => {
    mockEstate();
    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
        regionName: "RegionOne",
      });

    expect(reach.hostCount).toBe(2);
    expect(reach.hosts[0]!.isHypervisor).toBe(true);
    expect(reach.hosts[1]!.name).toBe("web-1");
    expect(reach.hosts[1]!.isHypervisor).toBe(false);
    // The node on one of its instances, and not the node on another hypervisor's.
    expect(reach.kubernetesNodeCount).toBe(1);
    expect(reach.kubernetesNodes[0]!.nodeName).toBe("node-1");
    expect(reach.kubernetesClusters).toEqual([
      { id: "cluster-1", name: "prod", nodeCount: 1 },
    ]);
    expect(reach.serviceCount).toBe(1);
    expect(reach.services[0]!.name).toBe("api");
  });

  test("its instances are named too, for an alert to say whose night this is", async () => {
    mockEstate();
    mockQuery(OpenStackResourceService, (sql: string) => {
      return sql.includes('SELECT "_id"')
        ? []
        : [
            { externalId: INSTANCE_ID, name: "web-1" },
            { externalId: GUEST_ID, name: null },
          ];
    });
    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
      });
    expect(reach.instanceCount).toBe(2);
    expect(reach.instances).toEqual([
      { id: INSTANCE_ID, name: "web-1" },
      { id: GUEST_ID, name: null },
    ]);
  });

  test("a node whose instance another cloud holds too is on neither", async () => {
    mockEstate();
    const otherCloud: OpenStackCloud = new OpenStackCloud();
    otherCloud._id = OTHER_CLOUD_ID.toString();
    otherCloud.name = "restored-copy";
    const thisCloud: OpenStackCloud = new OpenStackCloud();
    thisCloud._id = CLOUD_ID.toString();
    thisCloud.name = "prod-eu";
    jest
      .spyOn(OpenStackCloudService, "findBy")
      .mockResolvedValue([thisCloud, otherCloud] as never);
    mockQuery(OpenStackResourceService, (sql: string) => {
      if (sql.includes('SELECT DISTINCT "externalId"')) {
        return [{ externalId: INSTANCE_ID }];
      }
      return sql.includes('SELECT "_id"')
        ? []
        : [{ externalId: INSTANCE_ID }, { externalId: GUEST_ID }];
    });

    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
      });
    expect(reach.kubernetesNodeCount).toBe(0);
    expect(reach.kubernetesClusters).toEqual([]);
  });

  test("services on a node are counted with those on a host, and each only once", async () => {
    mockEstate();
    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
      });
    // Both reads answer "api" here: one from the hosts, and one from the node's pods.
    expect(ServiceService.findBy).toHaveBeenCalledTimes(2);
    expect(reach.services).toHaveLength(1);
  });

  test("a host two hypervisors could both be is neither's, and its guests still count", async () => {
    mockEstate({
      hypervisorHosts: [hostRow({ hostIdentifier: "compute-01" })],
    });
    mockQuery(OpenStackResourceService, (sql: string) => {
      return sql.includes('SELECT "_id"')
        ? [{ _id: "one" }, { _id: "two" }]
        : [{ externalId: INSTANCE_ID }];
    });
    jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue([
      Object.assign(new OpenStackResource(), {
        hypervisorName: "compute-01.a.example.internal",
      }),
      Object.assign(new OpenStackResource(), {
        hypervisorName: "compute-01.b.example.internal",
      }),
    ] as never);

    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: "compute-01.a.example.internal",
      });

    expect(
      reach.hosts.map((host: { isHypervisor: boolean }): boolean => {
        return host.isHypervisor;
      }),
    ).toEqual([false]);
  });

  test("a machine name that fits two hosts is neither, and its guests still count", async () => {
    mockEstate({
      hypervisorHosts: [
        hostRow({ hostIdentifier: "compute-01" }),
        hostRow({ hostIdentifier: "compute-01.example.internal" }),
      ],
    });
    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
      });
    expect(
      reach.hosts.map((host: { name: string }): string => {
        return host.name;
      }),
    ).toEqual(["web-1"]);
  });

  test("a region's name is part of which instances those are", async () => {
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [];
    });
    mockQuery(KubernetesResourceService, () => {
      return [];
    });
    mockQuery(HostService, () => {
      return [];
    });
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);
    await OpenStackAcrossProducts.getReachOfHypervisor({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      hypervisorName: HYPERVISOR,
      regionName: "RegionTwo",
    });
    expect(query.mock.calls[0]![1] as Array<unknown>).toContain("RegionTwo");
  });

  test("a long list is counted in full, and named up to the limit", async () => {
    const nodes: Array<JSONObject> = [];
    const ids: Array<{ externalId: string }> = [];
    for (let index: number = 0; index < 60; index++) {
      const id: string = `a1b2c3d4-0000-4000-8000-${String(index).padStart(12, "0")}`;
      ids.push({ externalId: id });
      nodes.push({
        clusterId: "cluster-1",
        clusterName: "prod",
        nodeName: `node-${index}`,
        providerId: `openstack:///${id}`,
      });
    }
    mockQuery(OpenStackResourceService, () => {
      return ids;
    });
    mockQuery(KubernetesResourceService, () => {
      return nodes;
    });
    mockQuery(HostService, () => {
      return [];
    });
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);
    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
      });
    expect(reach.kubernetesNodeCount).toBe(60);
    expect(reach.kubernetesNodes).toHaveLength(50);
    expect(reach.kubernetesClusters[0]!.nodeCount).toBe(60);
  });

  test("what it reads doesn't grow with what it finds", async () => {
    const statementsFor: (count: number) => Promise<number> = async (
      count: number,
    ): Promise<number> => {
      const ids: Array<{ externalId: string; name: string }> = [];
      for (let index: number = 0; index < count; index++) {
        ids.push({
          externalId: `a1b2c3d4-0000-4000-8000-${String(index).padStart(12, "0")}`,
          name: `web-${index}`,
        });
      }
      mockEstate();
      const resources: jest.Mock = mockQuery(
        OpenStackResourceService,
        (sql: string) => {
          return sql.includes('SELECT "_id"') ? [] : ids;
        },
      );
      const nodes: jest.Mock = mockQuery(KubernetesResourceService, () => {
        return [];
      });
      const graph: jest.Mock = mockQuery(HostService, () => {
        return [];
      });
      await OpenStackAcrossProducts.getReachOfHypervisor({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        hypervisorName: HYPERVISOR,
      });
      const total: number =
        resources.mock.calls.length +
        nodes.mock.calls.length +
        graph.mock.calls.length +
        (HostService.findBy as unknown as jest.Mock).mock.calls.length +
        (OpenStackCloudService.findBy as unknown as jest.Mock).mock.calls
          .length;
      jest.restoreAllMocks();
      mockClouds();
      return total;
    };

    expect(await statementsFor(2)).toBe(await statementsFor(4000));
  });

  test("a nova-compute reaches what its hypervisor does, by its short name", async () => {
    mockEstate();
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([HYPERVISOR_ROW] as never);
    const first: jest.Mock = mockQuery(
      OpenStackResourceService,
      (sql: string) => {
        return sql.includes("LOWER")
          ? [{ _id: "x" }]
          : [{ externalId: INSTANCE_ID }];
      },
    );
    const reach: OpenStackReachAcrossProducts | null =
      await OpenStackAcrossProducts.getReachOfPart({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        part: {
          kind: OpenStackResourceKind.Service,
          name: "nova-compute",
          regionName: "RegionOne",
          facts: { host: "compute-01" },
        },
      });
    expect(first).toHaveBeenCalled();
    expect(reach?.kubernetesNodeCount).toBe(1);
  });

  test("anything else has no reach of its own", async () => {
    await expect(
      OpenStackAcrossProducts.getReachOfPart({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        part: { kind: OpenStackResourceKind.Router, name: "r" },
      }),
    ).resolves.toBeNull();
  });
});

describe("a storage pool and Ceph", () => {
  const CEPH_ID: ObjectID = ObjectID.generate();

  function mockCeph(
    healthStatus: number = 0,
    lastSeenAt: Date = new Date(),
  ): void {
    jest.spyOn(CephClusterService, "findBy").mockResolvedValue([
      {
        id: CEPH_ID,
        name: "ceph-east",
        fsid: null,
        healthStatus,
        lastSeenAt,
      },
    ] as never);
    jest
      .spyOn(CephResourceService, "findBy")
      .mockResolvedValue([
        { cephClusterId: CEPH_ID, name: "volumes" },
      ] as never);
  }

  test("a pool someone confirmed carries its cluster's trouble onto its row", async () => {
    mockCeph(2);
    const rows: Array<JSONObject> = [
      {
        kind: OpenStackResourceKind.StoragePool,
        name: "ctl@rbd#rbd",
        facts: {
          cephLink: { cephClusterId: CEPH_ID.toString(), isNotCeph: false },
        },
      },
    ];
    await OpenStackAcrossProducts.addCephStatusToPools({
      projectId: PROJECT_ID,
      rows,
    });
    expect((rows[0]!["facts"] as JSONObject)["cephStatus"]).toEqual({
      clusterId: CEPH_ID.toString(),
      clusterName: "ceph-east",
      healthStatus: 2,
    });
  });

  test("a cluster whose agent stopped raises nothing, however it last read", async () => {
    mockCeph(2, new Date(Date.now() - 60 * 60 * 1000));
    const rows: Array<JSONObject> = [
      {
        kind: OpenStackResourceKind.StoragePool,
        name: "ctl@rbd#rbd",
        facts: {
          cephLink: { cephClusterId: CEPH_ID.toString(), isNotCeph: false },
        },
      },
    ];
    await OpenStackAcrossProducts.addCephStatusToPools({
      projectId: PROJECT_ID,
      rows,
    });
    expect((rows[0]!["facts"] as JSONObject)["cephStatus"]).toEqual({
      clusterId: CEPH_ID.toString(),
      clusterName: "ceph-east",
      healthStatus: null,
    });
  });

  test("a pool that has only a suggestion carries nothing: a guess can't raise an alarm", async () => {
    mockCeph(2);
    const rows: Array<JSONObject> = [
      {
        kind: OpenStackResourceKind.StoragePool,
        name: "ctl@rbd#volumes",
        facts: {},
      },
    ];
    await OpenStackAcrossProducts.addCephStatusToPools({
      projectId: PROJECT_ID,
      rows,
    });
    expect((rows[0]!["facts"] as JSONObject)["cephStatus"]).toBeUndefined();
  });

  test("a Ceph pool's name two Cinder pools hold suggests neither of them", async () => {
    mockCeph();
    jest.spyOn(OpenStackResourceService, "findOneBy").mockResolvedValue(
      row({
        _id: "a0000000-0000-4000-8000-000000000001",
        name: "ctl-1@rbd#volumes",
        facts: {},
      } as Partial<OpenStackResource>) as never,
    );
    jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue([
      row({
        _id: "a0000000-0000-4000-8000-000000000001",
        name: "ctl-1@rbd#volumes",
        facts: {},
      } as Partial<OpenStackResource>),
      row({
        _id: "a0000000-0000-4000-8000-000000000002",
        name: "ctl-2@rbd#volumes",
        facts: {},
      } as Partial<OpenStackResource>),
    ] as never);
    jest
      .spyOn(CephClusterService, "findOneById")
      .mockResolvedValue(null as never);

    const answer: Awaited<
      ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
    > = await OpenStackAcrossProducts.getStoragePoolCephLink({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      externalId: "RegionOne/ctl-1@rbd#volumes",
    });
    expect(answer?.link.state).toBe("unknown");
    expect(answer?.link.clusterId).toBeNull();
  });

  test("a Ceph pool's name one Cinder pool holds is suggested to it", async () => {
    mockCeph();
    const only: OpenStackResource = row({
      _id: "a0000000-0000-4000-8000-000000000001",
      name: "ctl-1@rbd#volumes",
      facts: {},
    } as Partial<OpenStackResource>);
    jest
      .spyOn(OpenStackResourceService, "findOneBy")
      .mockResolvedValue(only as never);
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([only] as never);
    jest
      .spyOn(CephClusterService, "findOneById")
      .mockResolvedValue({ healthStatus: 0 } as never);

    const answer: Awaited<
      ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
    > = await OpenStackAcrossProducts.getStoragePoolCephLink({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      externalId: "RegionOne/ctl-1@rbd#volumes",
    });
    expect(answer?.link.state).toBe("suggested");
    expect(answer?.link.clusterId).toBe(CEPH_ID.toString());
  });

  test("an answer can be taken back, which touches only the answer", async () => {
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [[{ _id: "x" }], 1];
    });
    await expect(
      OpenStackAcrossProducts.forgetStoragePoolCephLink({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        externalId: "RegionOne/ctl@rbd#rbd",
      }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0]![0] as string).toContain("- 'cephLink'");
  });

  test("taking back an answer about a pool that isn't there says so", async () => {
    mockQuery(OpenStackResourceService, () => {
      return [[], 0];
    });
    await expect(
      OpenStackAcrossProducts.forgetStoragePoolCephLink({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        externalId: "nope",
      }),
    ).resolves.toBe(false);
  });

  test("a cloud with no pools asks Ceph nothing", async () => {
    const findBy: unknown = jest.spyOn(CephClusterService, "findBy");
    await OpenStackAcrossProducts.addCephStatusToPools({
      projectId: PROJECT_ID,
      rows: [{ kind: OpenStackResourceKind.Hypervisor }],
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("an answer is kept beside what a scrape writes, key by key", async () => {
    jest
      .spyOn(CephClusterService, "findOneBy")
      .mockResolvedValue({ _id: CEPH_ID.toString() } as never);
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [[{ _id: "x" }], 1];
    });
    await expect(
      OpenStackAcrossProducts.confirmStoragePoolCephLink({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        externalId: "RegionOne/ctl@rbd#rbd",
        cephClusterId: CEPH_ID,
        isNotCeph: false,
      }),
    ).resolves.toBe(true);
    const params: Array<unknown> = query.mock.calls[0]![1] as Array<unknown>;
    expect(JSON.parse(params[3] as string)).toMatchObject({
      cephClusterId: CEPH_ID.toString(),
      isNotCeph: false,
    });
    expect(query.mock.calls[0]![0] as string).toContain("jsonb_build_object");
  });

  test("a cluster of another project is refused, and nothing is written", async () => {
    jest
      .spyOn(CephClusterService, "findOneBy")
      .mockResolvedValue(null as never);
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [[], 0];
    });
    await expect(
      OpenStackAcrossProducts.confirmStoragePoolCephLink({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        externalId: "RegionOne/ctl@rbd#rbd",
        cephClusterId: ObjectID.generate(),
        isNotCeph: false,
      }),
    ).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test("a pool that isn't there is said to be", async () => {
    const query: jest.Mock = mockQuery(OpenStackResourceService, () => {
      return [[], 0];
    });
    await expect(
      OpenStackAcrossProducts.confirmStoragePoolCephLink({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        externalId: "nope",
        cephClusterId: null,
        isNotCeph: true,
      }),
    ).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("a service whose own telemetry names its instance", () => {
  test("a UUID two clouds hold draws neither", async () => {
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([
        INSTANCE,
        row({ ...INSTANCE, openStackCloudId: OTHER_CLOUD_ID }),
      ] as never);
    const fence: unknown = jest.spyOn(GlobalCache, "setStringIfNotExists");
    await OpenStackAcrossProducts.reconcileServiceOnInstance({
      projectId: PROJECT_ID,
      instanceId: INSTANCE_ID,
      serviceName: "api",
    });
    expect(fence).not.toHaveBeenCalled();
  });

  test("a UUID no cloud holds draws nothing", async () => {
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([] as never);
    const fence: unknown = jest.spyOn(GlobalCache, "setStringIfNotExists");
    await OpenStackAcrossProducts.reconcileServiceOnInstance({
      projectId: PROJECT_ID,
      instanceId: INSTANCE_ID,
      serviceName: "api",
    });
    expect(fence).not.toHaveBeenCalled();
  });
});

describe("Topology's Infrastructure view", () => {
  const PLACEMENT: OpenStackPlacement = {
    openStackCloudId: CLOUD_ID.toString(),
    cloudName: "prod-eu",
    kind: "instance",
    externalId: INSTANCE_ID,
    name: "web-1",
    regionName: "RegionOne",
    availabilityZone: "nova",
    hypervisorName: HYPERVISOR,
    hypervisorExternalId: `RegionOne/${HYPERVISOR}`,
    openStackProjectId: "p1",
    openStackProjectName: "payments",
    status: "ACTIVE",
  };

  function edgesOf(
    entities: Array<ExtractedEntity>,
  ): Array<[string, string, string]> {
    const typeOf: Map<string, string> = new Map(
      entities.map((entity: ExtractedEntity): [string, string] => {
        return [entity.entityKey, entity.entityType];
      }),
    );
    return deriveRelationships(entities)
      .map((edge: EntityRelationshipEdge): [string, string, string] => {
        return [
          typeOf.get(edge.fromEntityKey)!,
          edge.relationshipType,
          typeOf.get(edge.toEntityKey)!,
        ];
      })
      .sort();
  }

  test("a guest's service runs on its instance, on its hypervisor, in its cloud", () => {
    const entities: Array<ExtractedEntity> =
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: PLACEMENT,
        serviceName: "api",
      });
    const edges: Array<[string, string, string]> = edgesOf(entities);
    expect(edges).toContainEqual([
      EntityType.Service,
      EntityRelationshipType.HostedOn,
      EntityType.OpenStackInstance,
    ]);
    expect(edges).toContainEqual([
      EntityType.OpenStackInstance,
      EntityRelationshipType.RunsOn,
      EntityType.OpenStackHypervisor,
    ]);
    expect(edges).toContainEqual([
      EntityType.OpenStackHypervisor,
      EntityRelationshipType.MemberOf,
      EntityType.OpenStackCloud,
    ]);
  });

  test("a namespaced service is the same service its own telemetry reports", () => {
    const namespaced: ExtractedEntity | undefined =
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: PLACEMENT,
        serviceName: "api",
        serviceNamespace: "payments",
      }).find((entity: ExtractedEntity): boolean => {
        return entity.entityType === EntityType.Service;
      });
    expect(namespaced?.entityKey).toBe(
      keyForService(PROJECT_ID.toString(), "api", "payments"),
    );
  });

  test("a cloud with no name to be known by draws nothing, rather than a second cloud", () => {
    expect(
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: { ...PLACEMENT, cloudName: null },
        serviceName: "api",
      }),
    ).toEqual([]);
  });

  test("it never makes a phantom host or a phantom service", () => {
    const types: Array<string> = OpenStackAcrossProducts.getPlacementEntities({
      projectId: PROJECT_ID,
      placement: PLACEMENT,
    }).map((entity: ExtractedEntity): string => {
      return entity.entityType;
    });
    expect(types).not.toContain(EntityType.Host);
    expect(types).not.toContain(EntityType.Service);
  });

  test("the instance it makes is the same one every time, wherever it has moved", () => {
    const keyOf: (hypervisorName: string) => string | undefined = (
      hypervisorName: string,
    ): string | undefined => {
      return OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: { ...PLACEMENT, hypervisorName },
      }).find((entity: ExtractedEntity): boolean => {
        return entity.entityType === EntityType.OpenStackInstance;
      })?.entityKey;
    };
    expect(keyOf("compute-02")).toBe(keyOf(HYPERVISOR));
  });

  test("a hypervisor's own host's services run on the hypervisor, with no instance in it", () => {
    const entities: Array<ExtractedEntity> =
      OpenStackAcrossProducts.getPlacementEntities({
        projectId: PROJECT_ID,
        placement: { ...PLACEMENT, kind: "hypervisor", name: HYPERVISOR },
        serviceName: "nova-compute",
      });
    const edges: Array<[string, string, string]> = edgesOf(entities);
    expect(edges).toContainEqual([
      EntityType.Service,
      EntityRelationshipType.HostedOn,
      EntityType.OpenStackHypervisor,
    ]);
    expect(
      entities.some((entity: ExtractedEntity): boolean => {
        return entity.entityType === EntityType.OpenStackInstance;
      }),
    ).toBe(false);
  });
});

describe("a person's choice of a host's cloud", () => {
  test.each(["openStackCloud", "openStackCloudId"])(
    "%s is theirs to make, with the permission to edit a host",
    (column: string) => {
      const update: Array<Permission> | undefined =
        new Host().getColumnAccessControlFor(column)?.update;
      expect(update).toEqual(
        expect.arrayContaining([Permission.EditHost, Permission.ProjectOwner]),
      );
      expect(update).not.toContain(Permission.Viewer);
      expect(update).not.toContain(Permission.ReadHost);
    },
  );
});

describe("the host that is a machine", () => {
  function hostsAre(rows: Array<Host>): jest.Mock {
    return jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue(rows as never) as unknown as jest.Mock;
  }

  function hypervisorsAre(names: Array<string>): void {
    mockQuery(OpenStackResourceService, () => {
      return names.map((_name: string, index: number): JSONObject => {
        return { _id: `row-${index}` };
      });
    });
    jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue(
      names.map((hypervisorName: string): OpenStackResource => {
        return Object.assign(new OpenStackResource(), {
          hypervisorName,
          openStackCloudId: CLOUD_ID,
        });
      }) as never,
    );
  }

  test("is the one host with that name", async () => {
    const host: Host = hostRow({ hostIdentifier: "compute-01" });
    hostsAre([host]);
    hypervisorsAre(["compute-01"]);
    expect(
      await OpenStackAcrossProducts.getHostOfMachine({
        projectId: PROJECT_ID,
        machineName: "compute-01",
        openStackCloudId: CLOUD_ID,
      }),
    ).toBe(host);
  });

  test("is found whichever of them has the domain, and in any case", async () => {
    for (const [machineName, hostIdentifier] of [
      ["compute-01", "compute-01.example.internal"],
      ["compute-01.example.internal", "compute-01"],
      ["COMPUTE-01", "compute-01"],
      ["compute-01.example.internal", "Compute-01.Example.Internal"],
    ] as Array<[string, string]>) {
      const host: Host = hostRow({ hostIdentifier });
      hostsAre([host]);
      hypervisorsAre([machineName]);
      expect(
        await OpenStackAcrossProducts.getHostOfMachine({
          projectId: PROJECT_ID,
          machineName,
          openStackCloudId: CLOUD_ID,
        }),
      ).toBe(host);
      jest.restoreAllMocks();
      mockClouds();
    }
  });

  test("looks for a host with any domain, as well as the names it was given", async () => {
    const findBy: jest.Mock = hostsAre([]);
    hypervisorsAre([]);
    await OpenStackAcrossProducts.getHostOfMachine({
      projectId: PROJECT_ID,
      machineName: "compute-01",
      openStackCloudId: CLOUD_ID,
    });
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a full name has no other domain to look in", async () => {
    const findBy: jest.Mock = hostsAre([]);
    hypervisorsAre([]);
    await OpenStackAcrossProducts.getHostOfMachine({
      projectId: PROJECT_ID,
      machineName: "compute-01.example.internal",
      openStackCloudId: CLOUD_ID,
    });
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("a machine in another cloud's name is not this cloud's", async () => {
    hostsAre([hostRow({ hostIdentifier: "compute-01.b.example.internal" })]);
    mockQuery(OpenStackResourceService, () => {
      return [{ _id: "x" }];
    });
    jest.spyOn(OpenStackResourceService, "findBy").mockResolvedValue([
      Object.assign(new OpenStackResource(), {
        hypervisorName: "compute-01.b.example.internal",
        openStackCloudId: OTHER_CLOUD_ID,
      }),
    ] as never);
    expect(
      await OpenStackAcrossProducts.getHostOfMachine({
        projectId: PROJECT_ID,
        machineName: "compute-01",
        openStackCloudId: CLOUD_ID,
      }),
    ).toBeNull();
  });

  test("a name two hosts could be is neither", async () => {
    hostsAre([
      hostRow({ hostIdentifier: "compute-01" }),
      hostRow({ hostIdentifier: "compute-01.example.internal" }),
    ]);
    hypervisorsAre(["compute-01.example.internal"]);
    expect(
      await OpenStackAcrossProducts.getHostOfMachine({
        projectId: PROJECT_ID,
        machineName: "compute-01.example.internal",
        openStackCloudId: CLOUD_ID,
      }),
    ).toBeNull();
  });

  test("a host two hypervisors could both be belongs to neither", async () => {
    hostsAre([hostRow({ hostIdentifier: "compute-01" })]);
    hypervisorsAre([
      "compute-01.a.example.internal",
      "compute-01.b.example.internal",
    ]);
    expect(
      await OpenStackAcrossProducts.getHostOfMachine({
        projectId: PROJECT_ID,
        machineName: "compute-01.a.example.internal",
        openStackCloudId: CLOUD_ID,
      }),
    ).toBeNull();
  });

  test("two different full names are two machines, however alike they start", async () => {
    hostsAre([hostRow({ hostIdentifier: "compute-01.b.example.internal" })]);
    hypervisorsAre(["compute-01.a.example.internal"]);
    expect(
      await OpenStackAcrossProducts.getHostOfMachine({
        projectId: PROJECT_ID,
        machineName: "compute-01.a.example.internal",
        openStackCloudId: CLOUD_ID,
      }),
    ).toBeNull();
  });

  test("a control plane machine is no hypervisor, and still has its host", async () => {
    const host: Host = hostRow({ hostIdentifier: "controller-01" });
    hostsAre([host]);
    hypervisorsAre([]);
    expect(
      await OpenStackAcrossProducts.getHostOfMachine({
        projectId: PROJECT_ID,
        machineName: "controller-01",
        openStackCloudId: CLOUD_ID,
      }),
    ).toBe(host);
  });
});
