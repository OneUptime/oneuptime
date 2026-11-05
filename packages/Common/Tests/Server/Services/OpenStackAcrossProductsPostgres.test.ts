import { DataSource } from "typeorm";
import path from "path";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Entities from "../../../Models/DatabaseModels/Index";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import LinkedInfrastructureContext, {
  LinkedInfrastructureResource,
  OpenStackPlacementOfResource,
} from "../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import { LinkedAffectedResourceType } from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import logger from "../../../Server/Utils/Logger";
import OpenStackAcrossProducts from "../../../Server/Utils/OpenStack/OpenStackAcrossProducts";
import OpenStackAlertContext, {
  OpenStackAlertContextResult,
} from "../../../Server/Utils/OpenStack/OpenStackAlertContext";
import { reconcileEntityRegistryThrottled } from "../../../Server/Utils/Telemetry/EntityRegistry";
import InventoryItem from "../../../Server/Utils/Telemetry/TelemetryEntity";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusOwner,
} from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackLinkedHost,
  OpenStackLinkedService,
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  OpenStackServicePlacement,
} from "../../../Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  assessOpenStackStoragePool,
  OpenStackAssessment,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import { ResourceAttentionSeverity } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  OPENSTACK_FIXTURES_FOLDER,
  readRecordedOpenStackResources,
  readRecordedSeries,
  scanRecordedSeries,
  toParsedOpenStackResource,
} from "../../Helpers/OpenStackRecordedRows";
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
  getRandomLinkEstates,
  getTooManyHostsEstate,
} from "../Utils/OpenStack/OpenStackLinkEstates";

/*
 * THE JOINS BETWEEN A CLOUD AND THE REST OF ONEUPTIME, ON POSTGRES.
 *
 * Hand-written SQL over a jsonb spec, an entity graph and case-folded names, which only a real
 * database can prove. Opt in the way OpenStackResourcePostgres.test.ts does
 * (RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true and OPENSTACK_INVENTORY_TEST_DATABASE_*), against
 * a database with the migrations applied. It clones the tables it reads into a schema of its
 * own.
 *
 * What it pins:
 *   - no link on a guess, from either end: every estate in OpenStackLinkEstates and estates
 *     drawn at random, through real SQL, so a LIKE or a LIMIT can't quietly make two into one;
 *   - the estate the issue names, with the cloud's rows from what a real DevStack's exporter
 *     answered, a Kubernetes node through the real inventory extractor and services through the
 *     real entity registry: each page links to the next, and an alert on the hypervisor lists
 *     what is affected across products. The Ceph-backed pool is made up, because no recording
 *     holds one: DevStack's rig runs LVM;
 *   - a pool and Ceph: what links on its own, what is only a suggestion, and that an answer
 *     outlives the next scrape.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: ReadonlyArray<string> = [
  "OpenStackCloud",
  "OpenStackResource",
  "Host",
  "Service",
  "KubernetesCluster",
  "KubernetesResource",
  "CephCluster",
  "CephResource",
  "InventoryItem",
  "InventoryItemRelationship",
];

const OBSERVED_AT_MS: number = Date.now();

function resource(
  overrides: Partial<ParsedOpenStackResource> & {
    kind: OpenStackResourceKind;
    externalId: string;
  },
): ParsedOpenStackResource {
  return {
    name: null,
    regionName: null,
    availabilityZone: null,
    hypervisorName: null,
    openStackProjectId: null,
    status: null,
    adminState: null,
    disabledReason: null,
    vcpuCapacity: null,
    vcpuAllocated: null,
    memoryCapacityBytes: null,
    memoryAllocatedBytes: null,
    diskCapacityBytes: null,
    diskAllocatedBytes: null,
    instanceCount: null,
    facts: {},
    lastSeenAt: new Date(OBSERVED_AT_MS),
    ...overrides,
  };
}

// A node as the Kubernetes agent's k8sobjects receiver sends it, OTLP's kvlist and all.
function nodeLogBody(data: {
  name: string;
  providerID?: string | undefined;
}): string {
  const text: (value: string) => JSONObject = (value: string): JSONObject => {
    return { stringValue: value };
  };
  const list: (values: Array<JSONObject>) => JSONObject = (
    values: Array<JSONObject>,
  ): JSONObject => {
    return { kvlistValue: { values } };
  };
  return JSON.stringify(
    list([
      { key: "kind", value: text("Node") },
      {
        key: "metadata",
        value: list([{ key: "name", value: text(data.name) }]),
      },
      {
        key: "spec",
        value: list(
          data.providerID
            ? [{ key: "providerID", value: text(data.providerID) }]
            : [],
        ),
      },
      { key: "status", value: list([]) },
    ]),
  );
}

describePostgres("the joins across products, on Postgres", () => {
  const schema: string = `openstack_links_${Date.now()}`;
  let database: DataSource;

  const insert: (
    table: string,
    fields: Record<string, unknown>,
  ) => Promise<ObjectID> = async (
    table: string,
    fields: Record<string, unknown>,
  ): Promise<ObjectID> => {
    const row: Record<string, unknown> = { version: 1, ...fields };
    const columns: Array<string> = Object.keys(row);
    const rows: Array<{ _id: string }> = await database.query(
      `INSERT INTO "${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")}) RETURNING "_id"`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );
    return new ObjectID((rows[0] as { _id: string })._id);
  };

  const addCloud: (
    projectId: ObjectID,
    name: string,
    isArchived?: boolean,
  ) => Promise<ObjectID> = async (
    projectId: ObjectID,
    name: string,
    isArchived: boolean = false,
  ): Promise<ObjectID> => {
    return await insert("OpenStackCloud", {
      projectId: projectId.toString(),
      name,
      slug: `${name}-${ObjectID.generate().toString()}`,
      isArchived,
    });
  };

  const addHost: (
    projectId: ObjectID,
    host: EstateHost,
    cloudIds?: Map<string, ObjectID>,
  ) => Promise<ObjectID> = async (
    projectId: ObjectID,
    host: EstateHost,
    cloudIds?: Map<string, ObjectID>,
  ): Promise<ObjectID> => {
    return await insert("Host", {
      projectId: projectId.toString(),
      name: host.name,
      slug: `${host.name}-${ObjectID.generate().toString()}`,
      hostIdentifier: host.name,
      hostId: host.hostId || null,
      isArchived: Boolean(host.isArchived),
      openStackCloudId:
        host.cloud && cloudIds
          ? (cloudIds.get(host.cloud) as ObjectID).toString()
          : null,
    });
  };

  const addEstate: (estate: LinkEstate) => Promise<{
    projectId: ObjectID;
    cloudIds: Map<string, ObjectID>;
    hostIds: Map<string, ObjectID>;
    stamp: (hostName: string, cloudId: ObjectID) => Promise<void>;
  }> = async (
    estate: LinkEstate,
  ): Promise<{
    projectId: ObjectID;
    cloudIds: Map<string, ObjectID>;
    hostIds: Map<string, ObjectID>;
    stamp: (hostName: string, cloudId: ObjectID) => Promise<void>;
  }> => {
    // A project of its own, so an estate can only ever see itself.
    const projectId: ObjectID = ObjectID.generate();
    const cloudIds: Map<string, ObjectID> = new Map();
    for (const cloud of [CLOUD_A, CLOUD_B, ARCHIVED_CLOUD]) {
      cloudIds.set(
        cloud,
        await addCloud(projectId, cloud, cloud === ARCHIVED_CLOUD),
      );
    }

    for (const cloud of [CLOUD_A, CLOUD_B, ARCHIVED_CLOUD]) {
      const resources: Array<ParsedOpenStackResource> = [
        ...estate.hypervisors
          .filter((one: EstateHypervisor): boolean => {
            return one.cloud === cloud;
          })
          .map((one: EstateHypervisor): ParsedOpenStackResource => {
            return resource({
              kind: OpenStackResourceKind.Hypervisor,
              externalId: `${one.region || "default"}/${one.name}`,
              name: one.name,
              regionName: one.region || null,
              hypervisorName: one.name,
              status: "up",
            });
          }),
        ...(estate.instances || [])
          .filter((one: EstateInstance): boolean => {
            return one.cloud === cloud;
          })
          .map((one: EstateInstance): ParsedOpenStackResource => {
            return resource({
              kind: OpenStackResourceKind.Instance,
              externalId: one.id,
              name: one.id,
              status: "ACTIVE",
            });
          }),
      ];
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: cloudIds.get(cloud) as ObjectID,
        resources,
      });
    }

    const hostIds: Map<string, ObjectID> = new Map();
    for (const host of estate.hosts) {
      hostIds.set(host.name, await addHost(projectId, host, cloudIds));
    }

    return {
      projectId,
      cloudIds,
      hostIds,
      stamp: async (hostName: string, cloudId: ObjectID): Promise<void> => {
        await database.query(
          `UPDATE "Host" SET "openStackCloudId" = $1 WHERE "_id" = $2`,
          [cloudId.toString(), (hostIds.get(hostName) as ObjectID).toString()],
        );
      },
    };
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},pg_catalog` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
  }, 600000);

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    // Every reconcile runs: no fence stands between one and the next here.
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(true as never);
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null as never);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await database.query(`DROP SCHEMA "${schema}" CASCADE`);
    await database.destroy();
  });

  describe("no link on a guess, from either end", () => {
    test.each(
      [...LINK_ESTATES, ...MANY_DOMAINS_ESTATES].map(
        (estate: LinkEstate): [string, LinkEstate] => {
          return [estate.title, estate];
        },
      ),
    )(
      "%s",
      async (_title: string, estate: LinkEstate) => {
        await expectEstateToLinkAsWritten(estate, await addEstate(estate));
      },
      120000,
    );

    test.each([11, 12, 13])(
      "estates nobody wrote out, drawn from seed %d, link one to one and agree from both ends",
      async (seed: number) => {
        for (const estate of getRandomLinkEstates({ seed, count: 15 })) {
          expectLinksToBeOneToOne(estate);
          await expectEstateToLinkAsWritten(estate, await addEstate(estate));
        }
      },
      600000,
    );

    test("a name more hosts share than a read holds has no machine, since any of them could be it", async () => {
      const estate: LinkEstate = getTooManyHostsEstate();
      await expectEstateToLinkAsWritten(estate, await addEstate(estate));
    }, 600000);

    test("another project's parts are never a match, however alike", async () => {
      const estate: LinkEstate = {
        title: "a project's own",
        hosts: [{ name: "compute-01" }],
        hypervisors: [{ name: "compute-01", cloud: CLOUD_A }],
        machines: [["compute-01", "compute-01", CLOUD_A]],
      };
      // The same names, in a project of their own: this one's links stay one to one.
      await addEstate(estate);
      await expectEstateToLinkAsWritten(estate, await addEstate(estate));
    }, 120000);

    test("a part that has gone from the inventory is no match, and no rival", async () => {
      const estate: LinkEstate = {
        title: "after a hypervisor was removed",
        hosts: [{ name: "compute-01" }],
        hypervisors: [
          { name: "compute-01", cloud: CLOUD_A },
          { name: "compute-01", cloud: CLOUD_B },
        ],
      };
      const ids: Awaited<ReturnType<typeof addEstate>> =
        await addEstate(estate);
      await expectEstateToLinkAsWritten(estate, ids);

      await database.query(
        `UPDATE "OpenStackResource" SET "deletedAt" = now()
         WHERE "projectId" = $1 AND "openStackCloudId" = $2`,
        [
          ids.projectId.toString(),
          (ids.cloudIds.get(CLOUD_B) as ObjectID).toString(),
        ],
      );
      await expectEstateToLinkAsWritten(
        {
          ...estate,
          hypervisors: [{ name: "compute-01", cloud: CLOUD_A }],
          machines: [["compute-01", "compute-01", CLOUD_A]],
        },
        ids,
      );
    }, 120000);

    test("a link already made is not written over by a rival that turns up later", async () => {
      const estate: LinkEstate = {
        title: "before a second cloud",
        hosts: [
          { name: "web-1", hostId: "a1b2c3d4-0000-4000-8000-00000000000a" },
        ],
        hypervisors: [],
        instances: [
          { id: "a1b2c3d4-0000-4000-8000-00000000000a", cloud: CLOUD_A },
        ],
        guests: [["web-1", "a1b2c3d4-0000-4000-8000-00000000000a", CLOUD_A]],
      };
      const ids: Awaited<ReturnType<typeof addEstate>> =
        await addEstate(estate);
      await expectEstateToLinkAsWritten(estate, ids);

      // A restored copy of the cloud arrives, holding the same instance.
      await OpenStackResourceService.bulkUpsert({
        projectId: ids.projectId,
        openStackCloudId: ids.cloudIds.get(CLOUD_B) as ObjectID,
        resources: [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: "a1b2c3d4-0000-4000-8000-00000000000a",
            name: "web-1",
          }),
        ],
      });

      const placement: OpenStackPlacement | null =
        await OpenStackAcrossProducts.getPlacementOfHost({
          projectId: ids.projectId,
          hostId: ids.hostIds.get("web-1") as ObjectID,
        });
      expect(placement?.openStackCloudId).toBe(
        (ids.cloudIds.get(CLOUD_A) as ObjectID).toString(),
      );
    }, 120000);
  });

  describe("a Kubernetes node's provider ID", () => {
    const INSTANCE: string = "b1b2c3d4-0000-4000-8000-000000000001";

    const setUp: () => Promise<{
      projectId: ObjectID;
      cloudId: ObjectID;
      otherCloudId: ObjectID;
      clusterId: ObjectID;
      addNode: (name: string, providerID?: string) => Promise<void>;
    }> = async () => {
      const projectId: ObjectID = ObjectID.generate();
      const cloudId: ObjectID = await addCloud(projectId, "prod-eu");
      const otherCloudId: ObjectID = await addCloud(projectId, "prod-us");
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: cloudId,
        resources: [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: INSTANCE,
            name: "k8s-worker-1",
            hypervisorName: "compute-01",
            availabilityZone: "az-1",
            regionName: "RegionOne",
          }),
          resource({
            kind: OpenStackResourceKind.Hypervisor,
            externalId: "RegionOne/compute-01",
            name: "compute-01",
            hypervisorName: "compute-01",
            regionName: "RegionOne",
          }),
        ],
      });
      const clusterId: ObjectID = await insert("KubernetesCluster", {
        projectId: projectId.toString(),
        name: "prod",
        slug: `prod-${ObjectID.generate().toString()}`,
        clusterIdentifier: "prod",
      });
      return {
        projectId,
        cloudId,
        otherCloudId,
        clusterId,
        addNode: async (name: string, providerID?: string): Promise<void> => {
          const record: ExtractedInventoryRecord | null =
            extractInventoryResource({
              resourceType: "nodes",
              logBody: nodeLogBody({ name, providerID }),
              lastSeenAt: new Date(),
            });
          await KubernetesResourceService.bulkUpsert({
            projectId,
            kubernetesClusterId: clusterId,
            resources: [record!.resource],
          });
        },
      };
    };

    test.each([
      ["no region", `openstack:///${INSTANCE}`],
      ["a region", `openstack://RegionOne/${INSTANCE}`],
      ["capitals", `openstack:///${INSTANCE.toUpperCase()}`],
    ])(
      "with %s, stored by the real extractor, names its instance from both ends",
      async (_name: string, providerID: string) => {
        const { projectId, cloudId, clusterId, addNode } = await setUp();
        await addNode("node-1", providerID);

        const placement: OpenStackPlacement | null =
          await OpenStackAcrossProducts.getPlacementOfKubernetesNode({
            projectId,
            kubernetesClusterId: clusterId,
            nodeName: "node-1",
          });
        expect(placement?.externalId).toBe(INSTANCE);
        expect(placement?.hypervisorName).toBe("compute-01");
        expect(placement?.hypervisorExternalId).toBe("RegionOne/compute-01");
        expect(placement?.availabilityZone).toBe("az-1");

        const reach: OpenStackReachAcrossProducts =
          await OpenStackAcrossProducts.getReachOfInstance({
            projectId,
            openStackCloudId: cloudId,
            instanceId: INSTANCE,
          });
        expect(
          reach.kubernetesNodes.map((node: { nodeName: string }) => {
            return node.nodeName;
          }),
        ).toEqual(["node-1"]);
        expect(reach.kubernetesClusters).toEqual([
          { id: clusterId.toString(), name: "prod", nodeCount: 1 },
        ]);
      },
      120000,
    );

    test.each([
      ["another cloud provider's", "aws:///us-east-1a/i-0abc"],
      ["no provider at all", undefined],
      ["something else's UUID", "gce:///p/z/" + INSTANCE],
      ["half a UUID", "openstack:///b1b2c3d4"],
    ])(
      "with %s links to nothing, from either end",
      async (_name: string, providerID: string | undefined) => {
        const { projectId, cloudId, clusterId, addNode } = await setUp();
        await addNode("node-1", providerID);

        await expect(
          OpenStackAcrossProducts.getPlacementOfKubernetesNode({
            projectId,
            kubernetesClusterId: clusterId,
            nodeName: "node-1",
          }),
        ).resolves.toBeNull();

        const reach: OpenStackReachAcrossProducts =
          await OpenStackAcrossProducts.getReachOfInstance({
            projectId,
            openStackCloudId: cloudId,
            instanceId: INSTANCE,
          });
        expect(reach.kubernetesNodeCount).toBe(0);
      },
      120000,
    );

    test("whose UUID two clouds hold is on neither, from either end", async () => {
      const { projectId, cloudId, otherCloudId, clusterId, addNode } =
        await setUp();
      await addNode("node-1", `openstack:///${INSTANCE}`);
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: otherCloudId,
        resources: [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: INSTANCE,
            name: "k8s-worker-1",
            hypervisorName: "compute-01",
          }),
        ],
      });

      await expect(
        OpenStackAcrossProducts.getPlacementOfKubernetesNode({
          projectId,
          kubernetesClusterId: clusterId,
          nodeName: "node-1",
        }),
      ).resolves.toBeNull();

      for (const openStackCloudId of [cloudId, otherCloudId]) {
        const reach: OpenStackReachAcrossProducts =
          await OpenStackAcrossProducts.getReachOfInstance({
            projectId,
            openStackCloudId,
            instanceId: INSTANCE,
          });
        expect(reach.kubernetesNodeCount).toBe(0);
        expect(reach.kubernetesClusters).toEqual([]);
      }
    }, 120000);

    test("of another project is nobody's here", async () => {
      const { projectId, cloudId } = await setUp();
      const elsewhere: Awaited<ReturnType<typeof setUp>> = await setUp();
      await elsewhere.addNode("node-1", `openstack:///${INSTANCE}`);
      const reach: OpenStackReachAcrossProducts =
        await OpenStackAcrossProducts.getReachOfInstance({
          projectId,
          openStackCloudId: cloudId,
          instanceId: INSTANCE,
        });
      expect(reach.kubernetesNodeCount).toBe(0);
    }, 120000);

    test("a node of a cluster that has gone isn't anyone's", async () => {
      const { projectId, cloudId, clusterId, addNode } = await setUp();
      await addNode("node-1", `openstack:///${INSTANCE}`);
      await database.query(
        `UPDATE "KubernetesCluster" SET "deletedAt" = now() WHERE "_id" = $1`,
        [clusterId.toString()],
      );
      const reach: OpenStackReachAcrossProducts =
        await OpenStackAcrossProducts.getReachOfInstance({
          projectId,
          openStackCloudId: cloudId,
          instanceId: INSTANCE,
        });
      expect(reach.kubernetesNodeCount).toBe(0);
    }, 120000);
  });

  /*
   * A cluster that Magnum built with the Kubernetes agent on it, which no runner has reached. Most of
   * this is made up, in the shape of what was recorded. The last test joins what a real cloud said of
   * a cluster and its stack, because that is the half a recording can prove.
   */
  describe("a Magnum cluster and the Kubernetes cluster it is", () => {
    const STACK: string = "ou-cluster-a1b2c3d4";
    const uuidOf: (number: number) => string = (number: number): string => {
      return `c1b2c3d4-0000-4000-8000-${String(number).padStart(12, "0")}`;
    };

    const setUp: () => Promise<{
      projectId: ObjectID;
      cloudId: ObjectID;
      clusterId: ObjectID;
      addNode: (
        name: string,
        instanceNumber: number,
        cluster?: ObjectID,
      ) => Promise<void>;
      addKubernetesCluster: (name: string) => Promise<ObjectID>;
      addServer: (name: string, number: number) => Promise<void>;
      linkFromThere: (cluster?: ObjectID) => Promise<string | null>;
      linkFromHere: (externalId?: string) => Promise<string | null>;
    }> = async () => {
      const projectId: ObjectID = ObjectID.generate();
      const cloudId: ObjectID = await addCloud(projectId, "prod-eu");
      const addServer: (name: string, number: number) => Promise<void> = async (
        name: string,
        number: number,
      ): Promise<void> => {
        await OpenStackResourceService.bulkUpsert({
          projectId,
          openStackCloudId: cloudId,
          resources: [
            resource({
              kind: OpenStackResourceKind.Instance,
              externalId: uuidOf(number),
              name,
              hypervisorName: "compute-01",
              regionName: "RegionOne",
            }),
          ],
        });
      };
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: cloudId,
        resources: [
          resource({
            kind: OpenStackResourceKind.Stack,
            externalId: "stack-1",
            name: STACK,
            regionName: "RegionOne",
            status: "CREATE_COMPLETE",
          }),
          resource({
            kind: OpenStackResourceKind.ContainerCluster,
            externalId: "magnum-1",
            name: "ou-cluster",
            regionName: "RegionOne",
            status: "CREATE_COMPLETE",
            facts: { stackId: "stack-1", masterCount: 1, nodeCount: 2 },
          }),
        ],
      });
      await addServer(`${STACK}-master-0`, 1);
      await addServer(`${STACK}-node-0`, 2);
      await addServer(`${STACK}-node-1`, 3);

      const addKubernetesCluster: (name: string) => Promise<ObjectID> = async (
        name: string,
      ): Promise<ObjectID> => {
        return await insert("KubernetesCluster", {
          projectId: projectId.toString(),
          name,
          slug: `${name}-${ObjectID.generate().toString()}`,
          clusterIdentifier: name,
        });
      };
      const clusterId: ObjectID = await addKubernetesCluster("from-magnum");
      return {
        projectId,
        cloudId,
        clusterId,
        addServer,
        addKubernetesCluster,
        addNode: async (
          name: string,
          instanceNumber: number,
          cluster: ObjectID = clusterId,
        ): Promise<void> => {
          const record: ExtractedInventoryRecord | null =
            extractInventoryResource({
              resourceType: "nodes",
              logBody: nodeLogBody({
                name,
                providerID: `openstack:///${uuidOf(instanceNumber)}`,
              }),
              lastSeenAt: new Date(),
            });
          await KubernetesResourceService.bulkUpsert({
            projectId,
            kubernetesClusterId: cluster,
            resources: [record!.resource],
          });
        },
        linkFromThere: async (
          cluster: ObjectID = clusterId,
        ): Promise<string | null> => {
          return (
            (
              await OpenStackAcrossProducts.getMagnumClusterOfKubernetesCluster({
                projectId,
                kubernetesClusterId: cluster,
              })
            )?.externalId || null
          );
        },
        linkFromHere: async (
          externalId: string = "magnum-1",
        ): Promise<string | null> => {
          return (
            (
              await OpenStackAcrossProducts.getKubernetesClusterOfMagnumCluster({
                projectId,
                openStackCloudId: cloudId,
                externalId,
              })
            )?.kubernetesClusterId || null
          );
        },
      };
    };

    test("links both ways, and says the same from each", async () => {
      const { projectId, cloudId, clusterId, addNode, linkFromHere, linkFromThere } =
        await setUp();
      await addNode("master-0", 1);
      await addNode("node-0", 2);
      await addNode("node-1", 3);

      expect(await linkFromThere()).toBe("magnum-1");
      expect(await linkFromHere()).toBe(clusterId.toString());

      const fromThere: unknown =
        await OpenStackAcrossProducts.getMagnumClusterOfKubernetesCluster({
          projectId,
          kubernetesClusterId: clusterId,
        });
      expect(fromThere).toEqual({
        openStackCloudId: cloudId.toString(),
        cloudName: "prod-eu",
        regionName: "RegionOne",
        externalId: "magnum-1",
        name: "ou-cluster",
        status: "CREATE_COMPLETE",
        kubernetesClusterId: clusterId.toString(),
        kubernetesClusterName: "from-magnum",
        nodeCount: 3,
      });
      expect(
        await OpenStackAcrossProducts.getKubernetesClusterOfMagnumCluster({
          projectId,
          openStackCloudId: cloudId,
          externalId: "magnum-1",
        }),
      ).toEqual(fromThere);
    });

    test("a machine joined by hand says nothing against it", async () => {
      const { addNode, addServer, linkFromHere, linkFromThere, clusterId } =
        await setUp();
      await addServer("by-hand", 9);
      await addNode("master-0", 1);
      await addNode("by-hand", 9);

      expect(await linkFromThere()).toBe("magnum-1");
      expect(await linkFromHere()).toBe(clusterId.toString());
    });

    test("a server scaled past what it was asked for is still one of its servers", async () => {
      const { addNode, addServer, linkFromHere, clusterId } = await setUp();
      await addServer(`${STACK}-node-15`, 16);
      await addNode("node-15", 16);

      expect(await linkFromHere()).toBe(clusterId.toString());
    });

    test("nothing on its servers: no link from either end, and no error", async () => {
      const { linkFromHere, linkFromThere } = await setUp();
      expect(await linkFromThere()).toBeNull();
      expect(await linkFromHere()).toBeNull();
    });

    test("a Kubernetes cluster of ordinary instances is no Magnum cluster's", async () => {
      const { addNode, addServer, linkFromThere } = await setUp();
      await addServer("k8s-worker-1", 7);
      await addNode("k8s-worker-1", 7);
      expect(await linkFromThere()).toBeNull();
    });

    test("an agent installed twice under two names is neither, from either end", async () => {
      const { addNode, addKubernetesCluster, linkFromHere, linkFromThere } =
        await setUp();
      const second: ObjectID = await addKubernetesCluster("from-magnum-again");
      await addNode("master-0", 1);
      await addNode("master-0", 1, second);

      expect(await linkFromThere()).toBeNull();
      expect(await linkFromThere(second)).toBeNull();
      expect(await linkFromHere()).toBeNull();
    });

    test("servers of two Magnum clusters in one Kubernetes cluster is neither, from either end", async () => {
      const { projectId, cloudId, addNode, addServer, linkFromHere, linkFromThere } =
        await setUp();
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: cloudId,
        resources: [
          resource({
            kind: OpenStackResourceKind.Stack,
            externalId: "stack-2",
            name: "other-e5f6",
            regionName: "RegionOne",
          }),
          resource({
            kind: OpenStackResourceKind.ContainerCluster,
            externalId: "magnum-2",
            name: "other",
            regionName: "RegionOne",
            facts: { stackId: "stack-2" },
          }),
        ],
      });
      await addServer("other-e5f6-node-0", 8);
      await addNode("master-0", 1);
      await addNode("other-node-0", 8);

      expect(await linkFromThere()).toBeNull();
      expect(await linkFromHere()).toBeNull();
      expect(await linkFromHere("magnum-2")).toBeNull();
    });

    test("a stack it can't read leaves it unlinked, rather than guessed at", async () => {
      const { projectId, cloudId, addNode, linkFromHere, linkFromThere } =
        await setUp();
      await addNode("master-0", 1);
      await database.query(
        `UPDATE "OpenStackResource" SET "deletedAt" = now()
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "kind" = 'Stack'`,
        [projectId.toString(), cloudId.toString()],
      );

      expect(await linkFromThere()).toBeNull();
      expect(await linkFromHere()).toBeNull();
    });

    test("a server whose UUID a restored copy of the cloud holds says nothing, from either end", async () => {
      const { projectId, addNode, linkFromHere, linkFromThere } = await setUp();
      const copy: ObjectID = await addCloud(projectId, "restored");
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: copy,
        resources: [
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: uuidOf(1),
            name: `${STACK}-master-0`,
            regionName: "RegionOne",
          }),
        ],
      });
      await addNode("master-0", 1);

      expect(await linkFromThere()).toBeNull();
      expect(await linkFromHere()).toBeNull();
    });

    test("another project's clusters are never a match, however alike", async () => {
      const { addNode, cloudId, linkFromHere } = await setUp();
      await addNode("master-0", 1);
      expect(
        await OpenStackAcrossProducts.getKubernetesClusterOfMagnumCluster({
          projectId: ObjectID.generate(),
          openStackCloudId: cloudId,
          externalId: "magnum-1",
        }),
      ).toBeNull();
      expect(await linkFromHere("no-such-cluster")).toBeNull();
    });

    test("joins on what a real cloud said of a cluster and its stack", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const cloudId: ObjectID = await addCloud(projectId, "devstack");
      const recorded: Array<ParsedOpenStackResource> = scanRecordedSeries(
        readRecordedSeries(
          path.join(
            OPENSTACK_FIXTURES_FOLDER,
            "services-heat-magnum",
            "access-check",
            "exporter",
            "admin",
          ),
        ),
        OBSERVED_AT_MS,
      ).map(toParsedOpenStackResource);
      const stack: ParsedOpenStackResource | undefined = recorded.find(
        (row: ParsedOpenStackResource): boolean => {
          return row.name === "ou-cluster-real-rfhmez6mgxk3";
        },
      );
      expect(stack?.kind).toBe(OpenStackResourceKind.Stack);
      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: cloudId,
        resources: [
          ...recorded,
          // Its servers aren't recorded. What Magnum's driver names them is from its templates.
          resource({
            kind: OpenStackResourceKind.Instance,
            externalId: uuidOf(1),
            name: "ou-cluster-real-rfhmez6mgxk3-master-0",
            regionName: stack?.regionName,
          }),
        ],
      });
      const clusterId: ObjectID = await insert("KubernetesCluster", {
        projectId: projectId.toString(),
        name: "real",
        slug: `real-${ObjectID.generate().toString()}`,
        clusterIdentifier: "real",
      });
      await KubernetesResourceService.bulkUpsert({
        projectId,
        kubernetesClusterId: clusterId,
        resources: [
          extractInventoryResource({
            resourceType: "nodes",
            logBody: nodeLogBody({
              name: "master-0",
              providerID: `openstack:///${uuidOf(1)}`,
            }),
            lastSeenAt: new Date(),
          })!.resource,
        ],
      });

      expect(
        await OpenStackAcrossProducts.getMagnumClusterOfKubernetesCluster({
          projectId,
          kubernetesClusterId: clusterId,
        }),
      ).toEqual(
        expect.objectContaining({
          name: "ou-cluster-real",
          status: "CREATE_FAILED",
          kubernetesClusterId: clusterId.toString(),
        }),
      );
    });

    describe("what a failed part says of it", () => {
      test("an instance that is one of its servers names it", async () => {
        const { projectId, cloudId } = await setUp();
        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            projectId,
            openStackCloudId: cloudId,
            part: {
              kind: OpenStackResourceKind.Instance,
              name: `${STACK}-node-1`,
              regionName: "RegionOne",
            },
          });
        expect(radius.belongsTo).toEqual([
          {
            kind: OpenStackResourceKind.ContainerCluster,
            externalId: "magnum-1",
            name: "ou-cluster",
            status: "CREATE_COMPLETE",
          },
        ]);
        // It still can't say what an instance holds, and doesn't pretend to.
        expect(radius.isKnown).toBe(false);
      });

      test("an instance of another name names nothing, and asks nothing", async () => {
        const { projectId, cloudId } = await setUp();
        const asked: jest.SpyInstance = jest.spyOn(
          OpenStackResourceService.getRepository().manager,
          "query",
        );
        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            projectId,
            openStackCloudId: cloudId,
            part: {
              kind: OpenStackResourceKind.Instance,
              name: "web-1",
              regionName: "RegionOne",
            },
          });
        expect(radius.belongsTo).toEqual([]);
        expect(asked).not.toHaveBeenCalled();
        asked.mockRestore();
      });

      test("an instance in another region of the same name is not its server", async () => {
        const { projectId, cloudId } = await setUp();
        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            projectId,
            openStackCloudId: cloudId,
            part: {
              kind: OpenStackResourceKind.Instance,
              name: `${STACK}-node-1`,
              regionName: "RegionTwo",
            },
          });
        expect(radius.belongsTo).toEqual([]);
      });

      test("a hypervisor names the clusters with a server on it, once each", async () => {
        const { projectId, cloudId } = await setUp();
        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            projectId,
            openStackCloudId: cloudId,
            part: {
              kind: OpenStackResourceKind.Hypervisor,
              name: "compute-01",
              hypervisorName: "compute-01",
              regionName: "RegionOne",
            },
          });
        expect(radius.instanceCount).toBe(3);
        expect(
          radius.magnumClusters?.map(
            (owner: OpenStackBlastRadiusOwner): string => {
              return owner.externalId;
            },
          ),
        ).toEqual(["magnum-1"]);
      });

      test("a hypervisor with none of them on it names none", async () => {
        const { projectId, cloudId } = await setUp();
        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            projectId,
            openStackCloudId: cloudId,
            part: {
              kind: OpenStackResourceKind.Hypervisor,
              name: "compute-02",
              hypervisorName: "compute-02",
              regionName: "RegionOne",
            },
          });
        expect(radius.magnumClusters).toEqual([]);
      });
    });
  });

  describe("a pool and Ceph", () => {
    const FSID: string = "0f3e8f6a-4d1c-4f7a-9c11-2b6f1e0a9d33";

    const setUp: () => Promise<{
      projectId: ObjectID;
      cloudId: ObjectID;
      addCluster: (data: {
        name: string;
        fsid?: string;
        healthStatus?: number;
        pools?: Array<string>;
      }) => Promise<ObjectID>;
      addPool: (name: string, facts?: JSONObject) => Promise<string>;
    }> = async () => {
      const projectId: ObjectID = ObjectID.generate();
      const cloudId: ObjectID = await addCloud(projectId, "prod-eu");
      return {
        projectId,
        cloudId,
        addCluster: async (data: {
          name: string;
          fsid?: string;
          healthStatus?: number;
          pools?: Array<string>;
        }): Promise<ObjectID> => {
          const clusterId: ObjectID = await insert("CephCluster", {
            projectId: projectId.toString(),
            name: data.name,
            slug: `${data.name}-${ObjectID.generate().toString()}`,
            fsid: data.fsid || null,
            healthStatus:
              data.healthStatus === undefined ? null : data.healthStatus,
            lastSeenAt: new Date(),
          });
          for (const [index, pool] of (data.pools || []).entries()) {
            await insert("CephResource", {
              projectId: projectId.toString(),
              cephClusterId: clusterId.toString(),
              kind: "Pool",
              externalId: String(index + 1),
              name: pool,
              lastSeenAt: new Date(),
            });
          }
          return clusterId;
        },
        addPool: async (name: string, facts?: JSONObject): Promise<string> => {
          const externalId: string = `RegionOne/${name}`;
          await OpenStackResourceService.bulkUpsert({
            projectId,
            openStackCloudId: cloudId,
            resources: [
              resource({
                kind: OpenStackResourceKind.StoragePool,
                externalId,
                name,
                regionName: "RegionOne",
                diskCapacityBytes: 1000,
                diskAllocatedBytes: 100,
                facts: facts || {},
              }),
            ],
          });
          return externalId;
        },
      };
    };

    test("a fsid one cluster reports links on its own, and carries its trouble to Needs attention", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      const clusterId: ObjectID = await addCluster({
        name: "ceph-east",
        fsid: FSID,
        healthStatus: 2,
        pools: ["volumes"],
      });
      const externalId: string = await addPool("ctl@rbd#volumes", {
        cephFsid: FSID,
        cephPool: "volumes",
      });

      const answer: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(answer?.link.state).toBe("from-fsid");
      expect(answer?.link.clusterId).toBe(clusterId.toString());
      expect(answer?.health).toBe(2);

      // A pool that reads half empty is still what Needs attention picks, for its cluster.
      const attention: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId,
          openStackCloudId: cloudId,
          now: new Date(),
        });
      await OpenStackAcrossProducts.addCephStatusToPools({
        projectId,
        rows: attention.rows,
      });
      const pool: JSONObject | undefined = attention.rows.find(
        (row: JSONObject): boolean => {
          return row["kind"] === OpenStackResourceKind.StoragePool;
        },
      );
      expect((pool?.["facts"] as JSONObject)["cephStatus"]).toEqual({
        clusterId: clusterId.toString(),
        clusterName: "ceph-east",
        healthStatus: 2,
      });
      const assessment: OpenStackAssessment = assessOpenStackStoragePool(
        Object.assign(new OpenStackResource(), pool, {
          diskCapacityBytes: 1000,
          diskAllocatedBytes: 100,
        }),
      );
      expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    }, 120000);

    test("a pool's name is a suggestion, and a suggestion raises nothing", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      const clusterId: ObjectID = await addCluster({
        name: "ceph-east",
        healthStatus: 2,
        pools: ["volumes"],
      });
      const externalId: string = await addPool("ctl@rbd#volumes");

      const answer: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(answer?.link.state).toBe("suggested");
      expect(answer?.link.clusterId).toBe(clusterId.toString());

      const attention: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId,
          openStackCloudId: cloudId,
          now: new Date(),
        });
      expect(
        attention.rows.filter((row: JSONObject): boolean => {
          return row["kind"] === OpenStackResourceKind.StoragePool;
        }),
      ).toEqual([]);
    }, 120000);

    test("a name two clusters hold suggests neither", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      await addCluster({ name: "ceph-east", pools: ["volumes"] });
      await addCluster({ name: "ceph-west", pools: ["volumes"] });
      const externalId: string = await addPool("ctl@rbd#volumes");

      const answer: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(answer?.link).toEqual({
        state: "unknown",
        clusterId: null,
        clusterName: null,
        cephPoolName: null,
      });
      expect(answer?.clusters).toHaveLength(2);
    }, 120000);

    test("a name two Cinder pools hold suggests neither of them", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      await addCluster({ name: "ceph-east", pools: ["volumes"] });
      const first: string = await addPool("ctl-1@rbd#volumes");
      const second: string = await addPool("ctl-2@rbd#volumes");

      for (const externalId of [first, second]) {
        const answer: Awaited<
          ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
        > = await OpenStackAcrossProducts.getStoragePoolCephLink({
          projectId,
          openStackCloudId: cloudId,
          externalId,
        });
        expect(answer?.link.state).toBe("unknown");
      }
    }, 120000);

    test("two clusters saying one fsid is no fact at all", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      await addCluster({ name: "ceph-east", fsid: FSID });
      await addCluster({ name: "ceph-west", fsid: FSID });
      const externalId: string = await addPool("ctl@rbd#volumes", {
        cephFsid: FSID,
        cephPool: "volumes",
      });
      const answer: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(answer?.link.state).toBe("unknown");
    }, 120000);

    test("a cluster whose agent stopped raises nothing, however it last read", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      const clusterId: ObjectID = await addCluster({
        name: "ceph-east",
        fsid: FSID,
        healthStatus: 2,
      });
      await database.query(
        `UPDATE "CephCluster" SET "lastSeenAt" = now() - interval '1 hour' WHERE "_id" = $1`,
        [clusterId.toString()],
      );
      const externalId: string = await addPool("ctl@rbd#volumes", {
        cephFsid: FSID,
      });

      const answer: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(answer?.link.state).toBe("from-fsid");
      expect(answer?.health).toBeNull();

      const attention: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId,
          openStackCloudId: cloudId,
          now: new Date(),
        });
      await OpenStackAcrossProducts.addCephStatusToPools({
        projectId,
        rows: attention.rows,
      });
      const pool: JSONObject | undefined = attention.rows.find(
        (row: JSONObject): boolean => {
          return row["kind"] === OpenStackResourceKind.StoragePool;
        },
      );
      expect(
        assessOpenStackStoragePool(
          Object.assign(new OpenStackResource(), pool, {
            diskCapacityBytes: 1000,
            diskAllocatedBytes: 100,
          }),
        ).severity,
      ).toBeNull();
    }, 120000);

    test("an answer outlives the next scrape, and can be taken back", async () => {
      const { projectId, cloudId, addCluster, addPool } = await setUp();
      const clusterId: ObjectID = await addCluster({
        name: "ceph-east",
        healthStatus: 1,
      });
      const externalId: string = await addPool("ctl@rbd#rbd");

      await expect(
        OpenStackAcrossProducts.confirmStoragePoolCephLink({
          projectId,
          openStackCloudId: cloudId,
          externalId,
          cephClusterId: clusterId,
          isNotCeph: false,
        }),
      ).resolves.toBe(true);

      // The next scrape's facts say nothing of it, and merge key by key.
      await addPool("ctl@rbd#rbd", { backend: "rbd" });

      const answered: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(answered?.link.state).toBe("confirmed");
      expect(answered?.link.clusterId).toBe(clusterId.toString());

      await expect(
        OpenStackAcrossProducts.forgetStoragePoolCephLink({
          projectId,
          openStackCloudId: cloudId,
          externalId,
        }),
      ).resolves.toBe(true);
      const forgotten: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId,
      });
      expect(forgotten?.link.state).toBe("unknown");
    }, 120000);

    test("an answer about a pool that isn't there, or a cluster of another project, writes nothing", async () => {
      const { projectId, cloudId, addCluster } = await setUp();
      const clusterId: ObjectID = await addCluster({ name: "ceph-east" });
      await expect(
        OpenStackAcrossProducts.confirmStoragePoolCephLink({
          projectId,
          openStackCloudId: cloudId,
          externalId: "RegionOne/nope",
          cephClusterId: clusterId,
          isNotCeph: false,
        }),
      ).resolves.toBe(false);
      await expect(
        OpenStackAcrossProducts.forgetStoragePoolCephLink({
          projectId,
          openStackCloudId: cloudId,
          externalId: "RegionOne/nope",
        }),
      ).resolves.toBe(false);

      const elsewhere: Awaited<ReturnType<typeof setUp>> = await setUp();
      const theirs: ObjectID = await elsewhere.addCluster({ name: "theirs" });
      const externalId: string = await elsewhere.addPool("ctl@rbd#rbd");
      await expect(
        OpenStackAcrossProducts.confirmStoragePoolCephLink({
          projectId: elsewhere.projectId,
          openStackCloudId: elsewhere.cloudId,
          externalId,
          cephClusterId: clusterId,
          isNotCeph: false,
        }),
      ).resolves.toBe(false);
      await expect(
        OpenStackAcrossProducts.confirmStoragePoolCephLink({
          projectId: elsewhere.projectId,
          openStackCloudId: elsewhere.cloudId,
          externalId,
          cephClusterId: theirs,
          isNotCeph: false,
        }),
      ).resolves.toBe(true);
    }, 120000);
  });

  /*
   * The issue's own "Done when": a host agent on the hypervisor and on a guest, a Kubernetes
   * node with an OpenStack provider ID and a Ceph-backed pool, and each page linking to the
   * next. The cloud's rows are what a real DevStack answered, through the real scan.
   */
  describe("the estate the issue names", () => {
    const RELEASE: string = "gazpacho-ovs";
    const HYPERVISOR: string = "compute-01.example.internal";
    const GUEST_INSTANCE: string = "403fc51e-f769-4485-b58e-bacd0a6e6970";
    const NODE_INSTANCE: string = "3e958e96-3a71-4aca-937f-962b893c5cce";
    const FSID: string = "0f3e8f6a-4d1c-4f7a-9c11-2b6f1e0a9d33";

    let projectId: ObjectID;
    let cloudId: ObjectID;
    let clusterId: ObjectID;
    let machineHostId: ObjectID;
    let guestHostId: ObjectID;
    let apiServiceId: ObjectID;
    let checkoutServiceId: ObjectID;
    let cephClusterId: ObjectID;
    let hypervisor: ParsedOpenStackResource;

    beforeAll(async () => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockResolvedValue(true as never);

      projectId = ObjectID.generate();
      cloudId = await addCloud(projectId, "prod-eu");

      const recorded: Array<ParsedOpenStackResource> =
        readRecordedOpenStackResources({
          release: RELEASE,
          scene: "healthy",
          observedAtMs: OBSERVED_AT_MS,
        });
      hypervisor = recorded.find((row: ParsedOpenStackResource): boolean => {
        return row.kind === OpenStackResourceKind.Hypervisor;
      }) as ParsedOpenStackResource;

      /*
       * Made up, in the shape a probe at the Full view level sends: no recording holds an RBD
       * pool, because the rig's DevStacks run LVM.
       */
      const cephPool: Array<ParsedOpenStackResource> = scanRecordedSeries(
        [
          {
            name: "openstack_cinder_pool_capacity_total_gb",
            labels: {
              name: "ctl@rbd#volumes",
              volume_backend_name: "rbd",
              vendor_name: "Open Source",
              storage_protocol: "ceph",
              ceph_fsid: FSID,
              ceph_pool: "volumes",
            },
            value: 1000,
          },
        ],
        OBSERVED_AT_MS,
      ).map(toParsedOpenStackResource);

      await OpenStackResourceService.bulkUpsert({
        projectId,
        openStackCloudId: cloudId,
        resources: [...recorded, ...cephPool],
      });

      // The agent on the hypervisor reports its short name, and Nova its full one.
      machineHostId = await addHost(projectId, {
        name: "compute-01",
        hostId: "0123456789abcdef0123456789abcdef",
      });
      guestHostId = await addHost(projectId, {
        name: "web-guest",
        hostId: GUEST_INSTANCE,
      });

      clusterId = await insert("KubernetesCluster", {
        projectId: projectId.toString(),
        name: "prod",
        slug: `prod-${ObjectID.generate().toString()}`,
        clusterIdentifier: "prod",
      });
      await KubernetesResourceService.bulkUpsert({
        projectId,
        kubernetesClusterId: clusterId,
        resources: [
          extractInventoryResource({
            resourceType: "nodes",
            logBody: nodeLogBody({
              name: "k8s-worker-1",
              providerID: `openstack:///${NODE_INSTANCE}`,
            }),
            lastSeenAt: new Date(),
          })!.resource,
        ],
      });

      apiServiceId = await insert("Service", {
        projectId: projectId.toString(),
        name: "api",
        slug: `api-${ObjectID.generate().toString()}`,
      });
      checkoutServiceId = await insert("Service", {
        projectId: projectId.toString(),
        name: "checkout",
        slug: `checkout-${ObjectID.generate().toString()}`,
      });
      await insert("Service", {
        projectId: projectId.toString(),
        name: "nova-compute-agent",
        slug: `nova-compute-agent-${ObjectID.generate().toString()}`,
      });

      // What each service's own resource says, through the real registry.
      for (const attributes of [
        {
          "service.name": "api",
          "host.name": "web-guest",
          "host.id": GUEST_INSTANCE,
        },
        {
          "service.name": "nova-compute-agent",
          "host.name": "compute-01",
        },
        {
          "service.name": "checkout",
          "k8s.cluster.name": "prod",
          "k8s.namespace.name": "shop",
          "k8s.pod.name": "checkout-abc",
          "k8s.node.name": "k8s-worker-1",
        },
        // A service on a machine that is no part of any cloud.
        { "service.name": "billing", "host.name": "bare-metal-9" },
      ] as Array<Record<string, string>>) {
        await reconcileEntityRegistryThrottled({
          projectId,
          entities: InventoryItem.extractEntities({
            projectId: projectId.toString(),
            attributes,
          }),
        });
      }

      cephClusterId = await insert("CephCluster", {
        projectId: projectId.toString(),
        name: "ceph-east",
        slug: `ceph-east-${ObjectID.generate().toString()}`,
        fsid: FSID,
        healthStatus: 2,
        lastSeenAt: new Date(),
      });
    }, 600000);

    test("a hypervisor's page links to the host on its machine, and that host's page links back", async () => {
      const host: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getHostOfMachine>
      > = await OpenStackAcrossProducts.getHostOfMachine({
        projectId,
        machineName: HYPERVISOR,
        openStackCloudId: cloudId,
      });
      expect(host?.id?.toString()).toBe(machineHostId.toString());

      const found: ObjectID | null =
        await OpenStackAcrossProducts.findCloudOfHost({
          projectId,
          hostIdAttribute: "0123456789abcdef0123456789abcdef",
          hostIdentifier: "compute-01",
        });
      expect(found?.toString()).toBe(cloudId.toString());
      await database.query(
        `UPDATE "Host" SET "openStackCloudId" = $1 WHERE "_id" = $2`,
        [cloudId.toString(), machineHostId.toString()],
      );

      const placement: OpenStackPlacement | null =
        await OpenStackAcrossProducts.getPlacementOfHost({
          projectId,
          hostId: machineHostId,
        });
      expect(placement).toMatchObject({
        kind: "hypervisor",
        cloudName: "prod-eu",
        hypervisorName: HYPERVISOR,
        hypervisorExternalId: hypervisor.externalId,
      });
    }, 120000);

    test("a guest's host page links to its instance, on its hypervisor in its zone, and its instance's page links back", async () => {
      const found: ObjectID | null =
        await OpenStackAcrossProducts.findCloudOfHost({
          projectId,
          hostIdAttribute: GUEST_INSTANCE,
          hostIdentifier: "web-guest",
        });
      expect(found?.toString()).toBe(cloudId.toString());
      await database.query(
        `UPDATE "Host" SET "openStackCloudId" = $1 WHERE "_id" = $2`,
        [cloudId.toString(), guestHostId.toString()],
      );

      const placement: OpenStackPlacement | null =
        await OpenStackAcrossProducts.getPlacementOfHost({
          projectId,
          hostId: guestHostId,
        });
      expect(placement).toMatchObject({
        kind: "instance",
        externalId: GUEST_INSTANCE,
        name: "ou-running",
        hypervisorName: HYPERVISOR,
        hypervisorExternalId: hypervisor.externalId,
        availabilityZone: "nova",
      });

      const reach: OpenStackReachAcrossProducts =
        await OpenStackAcrossProducts.getReachOfInstance({
          projectId,
          openStackCloudId: cloudId,
          instanceId: GUEST_INSTANCE,
        });
      expect(
        reach.hosts.map((host: OpenStackLinkedHost): string => {
          return host.id;
        }),
      ).toEqual([guestHostId.toString()]);
      expect(
        reach.services.map((service: OpenStackLinkedService): string => {
          return service.id;
        }),
      ).toEqual([apiServiceId.toString()]);
    }, 120000);

    test("a Kubernetes node's page says which hypervisor and zone it is on", async () => {
      const placement: OpenStackPlacement | null =
        await OpenStackAcrossProducts.getPlacementOfKubernetesNode({
          projectId,
          kubernetesClusterId: clusterId,
          nodeName: "k8s-worker-1",
        });
      expect(placement).toMatchObject({
        externalId: NODE_INSTANCE,
        name: "ou-research-1",
        hypervisorName: HYPERVISOR,
        availabilityZone: "nova",
      });
    }, 120000);

    test("a service's page says where it runs, whether through a host or through its pods' node", async () => {
      const throughHost: Array<OpenStackServicePlacement> =
        await OpenStackAcrossProducts.getPlacementsOfService({
          projectId,
          serviceName: "api",
        });
      expect(throughHost).toHaveLength(1);
      expect(throughHost[0]).toMatchObject({
        hostName: "web-guest",
        kubernetesClusterId: null,
      });
      expect(throughHost[0]!.placement.externalId).toBe(GUEST_INSTANCE);

      const throughNode: Array<OpenStackServicePlacement> =
        await OpenStackAcrossProducts.getPlacementsOfService({
          projectId,
          serviceName: "checkout",
        });
      expect(throughNode).toHaveLength(1);
      expect(throughNode[0]).toMatchObject({
        hostName: "k8s-worker-1",
        kubernetesClusterId: clusterId.toString(),
      });
      expect(throughNode[0]!.placement.externalId).toBe(NODE_INSTANCE);

      await expect(
        OpenStackAcrossProducts.getPlacementsOfService({
          projectId,
          serviceName: "billing",
        }),
      ).resolves.toEqual([]);
    }, 120000);

    test("a storage pool's page names its Ceph cluster, and Ceph's trouble is in Needs attention", async () => {
      const answer: Awaited<
        ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
      > = await OpenStackAcrossProducts.getStoragePoolCephLink({
        projectId,
        openStackCloudId: cloudId,
        externalId: "RegionOne/ctl@rbd#volumes",
      });
      expect(answer?.link).toEqual({
        state: "from-fsid",
        clusterId: cephClusterId.toString(),
        clusterName: "ceph-east",
        cephPoolName: "volumes",
      });

      const attention: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId,
          openStackCloudId: cloudId,
          now: new Date(),
        });
      await OpenStackAcrossProducts.addCephStatusToPools({
        projectId,
        rows: attention.rows,
      });
      const pool: JSONObject | undefined = attention.rows.find(
        (row: JSONObject): boolean => {
          return row["externalId"] === "RegionOne/ctl@rbd#volumes";
        },
      );
      expect((pool?.["facts"] as JSONObject)["cephStatus"]).toMatchObject({
        clusterName: "ceph-east",
        healthStatus: 2,
      });
    }, 120000);

    test("a failed hypervisor's reach names its instances, the hosts and nodes they are, and the services on them", async () => {
      const reach: OpenStackReachAcrossProducts | null =
        await OpenStackAcrossProducts.getReachOfPart({
          projectId,
          openStackCloudId: cloudId,
          part: {
            kind: OpenStackResourceKind.Hypervisor,
            name: hypervisor.name,
            hypervisorName: hypervisor.hypervisorName,
            regionName: hypervisor.regionName,
          },
        });

      expect(
        (reach?.instances || []).map((instance: { id: string }): string => {
          return instance.id;
        }),
      ).toEqual(expect.arrayContaining([GUEST_INSTANCE, NODE_INSTANCE]));
      expect(reach?.instanceCount).toBeGreaterThanOrEqual(2);
      expect(
        (reach?.hosts || []).map(
          (host: OpenStackLinkedHost): [string, boolean] => {
            return [host.id, host.isHypervisor];
          },
        ),
      ).toEqual([
        [machineHostId.toString(), true],
        [guestHostId.toString(), false],
      ]);
      expect(reach?.kubernetesClusters).toEqual([
        { id: clusterId.toString(), name: "prod", nodeCount: 1 },
      ]);
      expect(
        (reach?.services || [])
          .map((service: OpenStackLinkedService): string => {
            return service.name;
          })
          .sort(),
      ).toEqual(["api", "checkout", "nova-compute-agent"]);
    }, 120000);

    test.each([
      [
        "a hypervisor's own series",
        () => {
          return {
            hostname: HYPERVISOR,
            "openstack.region.name": "RegionOne",
          };
        },
      ],
      [
        "a stopped nova-compute",
        () => {
          return {
            hostname: "compute-01",
            service: "nova-compute",
            "openstack.region.name": "RegionOne",
          };
        },
      ],
    ])(
      "an alert on %s lists what is affected across products",
      async (_name: string, labels: () => JSONObject) => {
        const context: OpenStackAlertContextResult =
          await OpenStackAlertContext.read({
            projectId,
            openStackCloudId: cloudId,
            seriesLabels: labels(),
          });
        const markdown: string = OpenStackAlertContext.toMarkdown(context);

        expect(markdown).toContain("**What this affects:**");
        expect(markdown).toContain("**Instances:**");
        expect(markdown).toContain("ou-running");
        expect(markdown).toContain("**Beyond the cloud:**");
        expect(markdown).toContain("Host compute-01: this machine");
        expect(markdown).toContain("Host web-guest");
        expect(markdown).toContain("Kubernetes cluster prod: 1 node");
        expect(markdown).toContain("Kubernetes node k8s-worker-1 in prod");
        expect(markdown).toContain("Service api");
        expect(markdown).toContain("Service checkout");
        expect(markdown).not.toContain("billing");
      },
      120000,
    );

    test("an investigation that starts at a slow service can walk down to its hypervisor", async () => {
      const resources: Array<LinkedInfrastructureResource> = [
        {
          type: LinkedAffectedResourceType.Service,
          id: checkoutServiceId.toString(),
          name: "checkout",
        },
      ];
      const placements: Array<OpenStackPlacementOfResource> | undefined =
        await (
          LinkedInfrastructureContext as unknown as {
            readOpenStackPlacements: (data: {
              projectId: ObjectID;
              resources: Array<LinkedInfrastructureResource>;
            }) => Promise<Array<OpenStackPlacementOfResource> | undefined>;
          }
        ).readOpenStackPlacements({ projectId, resources });

      expect(placements).toHaveLength(1);
      expect(placements?.[0]?.through).toBe('Kubernetes node "k8s-worker-1"');
      expect(placements?.[0]?.placement.hypervisorName).toBe(HYPERVISOR);

      const section: string = LinkedInfrastructureContext.buildContextSection({
        subjectKind: "incident",
        subjectCreatedAt: OneUptimeDate.getCurrentDate(),
        resources,
        alerts: [],
        hasMoreAlerts: false,
        windowStart: OneUptimeDate.getCurrentDate(),
        readAt: OneUptimeDate.getCurrentDate(),
        openStackPlacements: placements,
      });
      expect(section).toContain('through Kubernetes node "k8s-worker-1"');
      expect(section).toContain(`on hypervisor "${HYPERVISOR}"`);
    }, 120000);

    test("an investigation about a Kubernetes cluster can walk down from its nodes", async () => {
      const placements: Array<OpenStackPlacementOfResource> | undefined =
        await (
          LinkedInfrastructureContext as unknown as {
            readOpenStackPlacements: (data: {
              projectId: ObjectID;
              resources: Array<LinkedInfrastructureResource>;
            }) => Promise<Array<OpenStackPlacementOfResource> | undefined>;
          }
        ).readOpenStackPlacements({
          projectId,
          resources: [
            {
              type: LinkedAffectedResourceType.KubernetesCluster,
              id: clusterId.toString(),
              name: "prod",
            },
          ],
        });
      expect(placements).toHaveLength(1);
      expect(placements?.[0]?.through).toBe('node "k8s-worker-1"');
      expect(placements?.[0]?.placement.externalId).toBe(NODE_INSTANCE);
    }, 120000);

    test("a service whose own telemetry names its instance is drawn there, with no agent on that host", async () => {
      await OpenStackAcrossProducts.reconcileServiceOnInstance({
        projectId,
        instanceId: NODE_INSTANCE.toUpperCase(),
        serviceName: "lonely",
        serviceNamespace: "shop",
      });
      const edges: Array<{ to: string; relationshipType: string }> =
        await database.query(
          `SELECT target."entityType" AS "to", rel."relationshipType"
           FROM "InventoryItemRelationship" AS rel
           JOIN "InventoryItem" AS source
             ON source."projectId" = rel."projectId" AND source."entityKey" = rel."fromEntityKey"
           JOIN "InventoryItem" AS target
             ON target."projectId" = rel."projectId" AND target."entityKey" = rel."toEntityKey"
           WHERE rel."projectId" = $1 AND source."identifyingAttributes"->>'service.name' = 'lonely'`,
          [projectId.toString()],
        );
      expect(edges).toEqual(
        expect.arrayContaining([
          { to: "openstack.instance", relationshipType: "hosted-on" },
        ]),
      );
    }, 120000);

    test("Topology's Infrastructure view gets a linked host's services under their instance, without a phantom", async () => {
      const placement: OpenStackPlacement | null =
        await OpenStackAcrossProducts.getPlacementOfHost({
          projectId,
          hostId: guestHostId,
        });
      await OpenStackAcrossProducts.reconcilePlacementInTopology({
        projectId,
        host: { hostIdentifier: "web-guest" },
        placement: placement as OpenStackPlacement,
      });

      const edges: Array<{
        from: string;
        to: string;
        relationshipType: string;
      }> = await database.query(
        `SELECT source."entityType" AS "from", target."entityType" AS "to", rel."relationshipType"
         FROM "InventoryItemRelationship" AS rel
         JOIN "InventoryItem" AS source
           ON source."projectId" = rel."projectId" AND source."entityKey" = rel."fromEntityKey"
         JOIN "InventoryItem" AS target
           ON target."projectId" = rel."projectId" AND target."entityKey" = rel."toEntityKey"
         WHERE rel."projectId" = $1 AND source."identifyingAttributes"->>'service.name' = 'api'
            OR (rel."projectId" = $1 AND source."entityType" = 'openstack.instance')
            OR (rel."projectId" = $1 AND source."entityType" = 'openstack.hypervisor')`,
        [projectId.toString()],
      );
      expect(edges).toEqual(
        expect.arrayContaining([
          {
            from: "service",
            to: "openstack.instance",
            relationshipType: "hosted-on",
          },
          {
            from: "openstack.instance",
            to: "openstack.hypervisor",
            relationshipType: "runs-on",
          },
          {
            from: "openstack.hypervisor",
            to: "openstack.cloud",
            relationshipType: "member-of",
          },
        ]),
      );

      // One service "api", not one from its telemetry and one from this.
      const countOf: (name: string) => Promise<string | undefined> = async (
        name: string,
      ): Promise<string | undefined> => {
        const services: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*) AS "count" FROM "InventoryItem"
           WHERE "projectId" = $1 AND "entityType" = 'service'
             AND "identifyingAttributes"->>'service.name' = $2`,
          [projectId.toString(), name],
        );
        return services[0]?.count;
      };
      expect(await countOf("api")).toBe("1");

      // Nor a second one for a service whose identity has a namespace in it.
      await reconcileEntityRegistryThrottled({
        projectId,
        entities: InventoryItem.extractEntities({
          projectId: projectId.toString(),
          attributes: {
            "service.name": "ledger",
            "service.namespace": "payments",
            "host.name": "web-guest",
          },
        }),
      });
      await OpenStackAcrossProducts.reconcilePlacementInTopology({
        projectId,
        host: { hostIdentifier: "web-guest" },
        placement: placement as OpenStackPlacement,
      });
      expect(await countOf("ledger")).toBe("1");
    }, 120000);
  });
});
