import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Host from "../../../../Models/DatabaseModels/Host";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import Service from "../../../../Models/DatabaseModels/Service";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import CephResourceService from "../../../../Server/Services/CephResourceService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesResourceService from "../../../../Server/Services/KubernetesResourceService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import ServiceService from "../../../../Server/Services/ServiceService";
import OpenStackAcrossProducts from "../../../../Server/Utils/OpenStack/OpenStackAcrossProducts";
import { ExtractedEntity } from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
} from "../../../../Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  EntityRelationshipEdge,
  deriveRelationships,
} from "../../../../Utils/Telemetry/EntityRelationship";

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

afterEach(() => {
  jest.restoreAllMocks();
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
    expect(params[4]).toBe("web\\_1\\%.%");
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
    mockQuery(HostService, () => {
      return [
        { hostName: "web-1", instanceId: INSTANCE_ID },
        { hostName: "elsewhere", instanceId: null },
      ];
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
    jest.spyOn(HostService, "findBy").mockImplementation((async (query: {
      query: { hostId?: unknown };
    }) => {
      return query.query.hostId
        ? [hostRow({ name: "web-1", hostIdentifier: "web-1" })]
        : data?.hypervisorHosts || [
            hostRow({ name: HYPERVISOR, hostIdentifier: HYPERVISOR }),
          ];
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

  function mockCeph(healthStatus: number = 0): void {
    jest.spyOn(CephClusterService, "findBy").mockResolvedValue([
      {
        id: CEPH_ID,
        name: "ceph-east",
        fsid: null,
        healthStatus,
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
        return Object.assign(new OpenStackResource(), { hypervisorName });
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
        }),
      ).toBe(host);
      jest.restoreAllMocks();
    }
  });

  test("looks for a host with any domain, as well as the names it was given", async () => {
    const findBy: jest.Mock = hostsAre([]);
    hypervisorsAre([]);
    await OpenStackAcrossProducts.getHostOfMachine({
      projectId: PROJECT_ID,
      machineName: "compute-01",
    });
    expect(findBy).toHaveBeenCalledTimes(2);
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
      }),
    ).toBe(host);
  });
});
