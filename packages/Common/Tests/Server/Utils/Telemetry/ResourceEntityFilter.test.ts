import "../../TestingUtils/Init";
import ObjectID from "../../../../Types/ObjectID";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import {
  keyForCephCluster,
  keyForContainer,
  keyForDatabaseEndpoint,
  keyForDockerSwarmCluster,
  keyForHost,
  keyForKubernetesCluster,
  keyForKubernetesPod,
  keyForProxmoxCluster,
  keyForVMwareVCenter,
} from "../../../../Utils/Telemetry/EntityKey";
import { getDatabaseServerTelemetryEntityKeys } from "../../../../Utils/Telemetry/DatabaseServerEntityKeys";
import { getDatabaseServerScopeKeys } from "../../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseTelemetryScope";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../../Types/Telemetry/ResourceFacetCatalog";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * The resource tables are mocked at module level: the unit under test is
 * the id -> identifier -> entity-key translation, not Postgres. Each mock
 * records the query it was handed so the tests can assert the lookup is
 * project-scoped (a cluster id from another tenant must not resolve).
 */
const hostFindBy: jest.Mock = jest.fn();
const dockerHostFindBy: jest.Mock = jest.fn();
const podmanHostFindBy: jest.Mock = jest.fn();
const kubernetesClusterFindBy: jest.Mock = jest.fn();
const dockerSwarmClusterFindBy: jest.Mock = jest.fn();
const proxmoxClusterFindBy: jest.Mock = jest.fn();
const vmwareVCenterFindBy: jest.Mock = jest.fn();
const cephClusterFindBy: jest.Mock = jest.fn();
const serverlessFunctionFindBy: jest.Mock = jest.fn();
const iotFleetFindBy: jest.Mock = jest.fn();
const cloudResourceFindBy: jest.Mock = jest.fn();
const rumApplicationFindBy: jest.Mock = jest.fn();
const databaseServerFindBy: jest.Mock = jest.fn();
const databaseServerEndpointFindBy: jest.Mock = jest.fn();

jest.mock("../../../../Server/Services/HostService", () => {
  return { __esModule: true, default: { findBy: hostFindBy } };
});
jest.mock("../../../../Server/Services/DockerHostService", () => {
  return { __esModule: true, default: { findBy: dockerHostFindBy } };
});
jest.mock("../../../../Server/Services/PodmanHostService", () => {
  return { __esModule: true, default: { findBy: podmanHostFindBy } };
});
jest.mock("../../../../Server/Services/KubernetesClusterService", () => {
  return { __esModule: true, default: { findBy: kubernetesClusterFindBy } };
});
jest.mock("../../../../Server/Services/DockerSwarmClusterService", () => {
  return { __esModule: true, default: { findBy: dockerSwarmClusterFindBy } };
});
jest.mock("../../../../Server/Services/ProxmoxClusterService", () => {
  return { __esModule: true, default: { findBy: proxmoxClusterFindBy } };
});
jest.mock("../../../../Server/Services/VMwareVCenterService", () => {
  return { __esModule: true, default: { findBy: vmwareVCenterFindBy } };
});
jest.mock("../../../../Server/Services/CephClusterService", () => {
  return { __esModule: true, default: { findBy: cephClusterFindBy } };
});
jest.mock("../../../../Server/Services/ServerlessFunctionService", () => {
  return { __esModule: true, default: { findBy: serverlessFunctionFindBy } };
});
jest.mock("../../../../Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findBy: iotFleetFindBy } };
});
jest.mock("../../../../Server/Services/CloudResourceService", () => {
  return { __esModule: true, default: { findBy: cloudResourceFindBy } };
});
jest.mock("../../../../Server/Services/RumApplicationService", () => {
  return { __esModule: true, default: { findBy: rumApplicationFindBy } };
});
jest.mock("../../../../Server/Services/DatabaseServerService", () => {
  return { __esModule: true, default: { findBy: databaseServerFindBy } };
});
jest.mock("../../../../Server/Services/DatabaseServerEndpointService", () => {
  return {
    __esModule: true,
    default: { findBy: databaseServerEndpointFindBy },
  };
});

import ResourceEntityFilter, {
  ResourceEntityScope,
  appendResourceScopeFilters,
} from "../../../../Server/Utils/Telemetry/ResourceEntityFilter";

const PROJECT_ID: ObjectID = new ObjectID(
  "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
);
const CLUSTER_ID: string = "8c0f2f1e-2e4f-4a8c-9a1a-2f5b6c7d8e9f";
const OTHER_CLUSTER_ID: string = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";
const RESOURCE_ID: string = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";
const OTHER_RESOURCE_ID: string = "2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091";

const ALL_FIND_BY_MOCKS: Array<jest.Mock> = [
  hostFindBy,
  dockerHostFindBy,
  podmanHostFindBy,
  kubernetesClusterFindBy,
  dockerSwarmClusterFindBy,
  proxmoxClusterFindBy,
  vmwareVCenterFindBy,
  cephClusterFindBy,
  serverlessFunctionFindBy,
  iotFleetFindBy,
  cloudResourceFindBy,
  rumApplicationFindBy,
  databaseServerFindBy,
  databaseServerEndpointFindBy,
];

/*
 * The cluster-shaped types whose identity is the Postgres row's `name`:
 * ingest writes the row with findOrCreateByName and hashes
 * `<type>.name` into entityKeys, so the scope carries both the key and
 * the attribute fallback.
 */
const NAME_KEYED_CLUSTERS: Array<{
  facetKey: string;
  findBy: jest.Mock;
  attributeKey: string;
  keyFor: (projectId: string, name: string) => string;
}> = [
  {
    facetKey: "dockerSwarmClusterId",
    findBy: dockerSwarmClusterFindBy,
    attributeKey: "resource.docker.swarm.cluster.name",
    keyFor: keyForDockerSwarmCluster,
  },
  {
    facetKey: "proxmoxClusterId",
    findBy: proxmoxClusterFindBy,
    attributeKey: "resource.proxmox.cluster.name",
    keyFor: keyForProxmoxCluster,
  },
  {
    facetKey: "vmwareVCenterId",
    findBy: vmwareVCenterFindBy,
    attributeKey: "resource.vmware.vcenter.name",
    keyFor: keyForVMwareVCenter,
  },
  {
    facetKey: "cephClusterId",
    findBy: cephClusterFindBy,
    attributeKey: "resource.ceph.cluster.name",
    keyFor: keyForCephCluster,
  },
];

describe("ResourceEntityFilter", () => {
  beforeEach(() => {
    for (const findBy of ALL_FIND_BY_MOCKS) {
      findBy.mockReset();
      findBy.mockResolvedValue([]);
    }
  });

  describe("resolveScopes", () => {
    test("resolves a Kubernetes cluster id to the entity key ingest stamped", async () => {
      kubernetesClusterFindBy.mockResolvedValue([
        { clusterIdentifier: "prod-eu" },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { kubernetesClusterId: [CLUSTER_ID] },
        });

      expect(scopes).toHaveLength(1);
      /*
       * The key MUST be the one InventoryItem's k8s.cluster resolver
       * computes at ingest — a read-side key that does not byte-match finds
       * nothing, which is the failure this whole change exists to fix.
       */
      expect(scopes[0]!.entityKeys).toEqual([
        keyForKubernetesCluster(PROJECT_ID.toString(), "prod-eu"),
      ]);
      // The id branch stays so agent-ingested cluster telemetry still matches.
      expect(scopes[0]!.entityIds).toEqual([CLUSTER_ID]);
      // And the pre-entityKeys fallback mirrors the cluster detail page.
      expect(scopes[0]!.attributeKey).toBe("resource.k8s.cluster.name");
      expect(scopes[0]!.attributeValues).toEqual(["prod-eu"]);
    });

    test("scopes the identifier lookup to the requesting project", async () => {
      kubernetesClusterFindBy.mockResolvedValue([
        { clusterIdentifier: "prod-eu" },
      ]);

      await ResourceEntityFilter.resolveScopes({
        projectId: PROJECT_ID,
        selections: { kubernetesClusterId: [CLUSTER_ID] },
      });

      const call: Record<string, any> = kubernetesClusterFindBy.mock
        .calls[0]![0] as Record<string, any>;

      expect(call["query"]["projectId"]).toBe(PROJECT_ID);
      expect(call["query"]["_id"].values.map(String)).toEqual([CLUSTER_ID]);
    });

    test("host / docker host / podman host all key on the Host entity (host.name)", async () => {
      hostFindBy.mockResolvedValue([{ hostIdentifier: "web-1" }]);
      dockerHostFindBy.mockResolvedValue([{ hostIdentifier: "web-1" }]);
      podmanHostFindBy.mockResolvedValue([{ hostIdentifier: "web-1" }]);

      for (const facetKey of ["hostId", "dockerHostId", "podmanHostId"]) {
        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { [facetKey]: [HOST_ID] },
          });

        expect(scopes[0]!.entityKeys).toEqual([
          keyForHost(PROJECT_ID.toString(), "web-1"),
        ]);
        expect(scopes[0]!.attributeKey).toBe("resource.host.name");
      }
    });

    test("emits one scope per facet so two facets intersect rather than union", async () => {
      kubernetesClusterFindBy.mockResolvedValue([
        { clusterIdentifier: "prod-eu" },
      ]);
      hostFindBy.mockResolvedValue([{ hostIdentifier: "web-1" }]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: {
            kubernetesClusterId: [CLUSTER_ID],
            hostId: [HOST_ID],
          },
        });

      expect(scopes).toHaveLength(2);
    });

    test("multiple values inside one facet stay in one scope (they OR)", async () => {
      kubernetesClusterFindBy.mockResolvedValue([
        { clusterIdentifier: "prod-eu" },
        { clusterIdentifier: "prod-us" },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: {
            kubernetesClusterId: [CLUSTER_ID, OTHER_CLUSTER_ID],
          },
        });

      expect(scopes).toHaveLength(1);
      expect(scopes[0]!.entityKeys).toEqual([
        keyForKubernetesCluster(PROJECT_ID.toString(), "prod-eu"),
        keyForKubernetesCluster(PROJECT_ID.toString(), "prod-us"),
      ]);
    });

    test("an id that no longer resolves keeps the primaryEntityId branch", async () => {
      kubernetesClusterFindBy.mockResolvedValue([]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { kubernetesClusterId: [CLUSTER_ID] },
        });

      /*
       * Degrading to the id-only predicate reproduces the old behavior for
       * that facet. Dropping the scope instead would silently WIDEN the
       * result set to every row in the window.
       */
      expect(scopes[0]!.entityIds).toEqual([CLUSTER_ID]);
      expect(scopes[0]!.entityKeys).toEqual([]);
      expect(scopes[0]!.attributeValues).toBeUndefined();
    });

    test("a Postgres failure degrades to the id branch instead of throwing", async () => {
      kubernetesClusterFindBy.mockRejectedValue(
        new Error("connection refused") as never,
      );

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { kubernetesClusterId: [CLUSTER_ID] },
        });

      expect(scopes[0]!.entityIds).toEqual([CLUSTER_ID]);
      expect(scopes[0]!.entityKeys).toEqual([]);
    });

    test("rows with a blank identifier contribute no key", async () => {
      kubernetesClusterFindBy.mockResolvedValue([{ clusterIdentifier: "   " }]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { kubernetesClusterId: [CLUSTER_ID] },
        });

      expect(scopes[0]!.entityKeys).toEqual([]);
    });

    test("no selection means no scope and no Postgres round trip", async () => {
      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: {},
        });

      expect(scopes).toEqual([]);
      expect(kubernetesClusterFindBy).not.toHaveBeenCalled();
    });

    test("an empty id list for a facet is not a filter", async () => {
      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { kubernetesClusterId: [] },
        });

      expect(scopes).toEqual([]);
    });

    test("a key outside the catalog is ignored entirely", async () => {
      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: {
            primaryEntityId: [RESOURCE_ID],
            iotDeviceId: [RESOURCE_ID],
          },
        });

      expect(scopes).toEqual([]);
      for (const findBy of ALL_FIND_BY_MOCKS) {
        expect(findBy).not.toHaveBeenCalled();
      }
    });

    test("every catalog resource type yields exactly one scope that keeps its ids", async () => {
      for (const facetKey of RESOURCE_FACET_CATALOG_KEYS) {
        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { [facetKey]: [RESOURCE_ID] },
          });

        expect(scopes).toHaveLength(1);
        expect(scopes[0]!.entityIds).toEqual([RESOURCE_ID]);
      }
    });
  });

  describe("resolveScopes — name-keyed clusters (Docker Swarm / Proxmox / vCenter / Ceph)", () => {
    for (const cluster of NAME_KEYED_CLUSTERS) {
      test(`${cluster.facetKey} resolves to the ${cluster.attributeKey} entity key and attribute`, async () => {
        cluster.findBy.mockResolvedValue([{ name: "Prod-EU" }]);

        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { [cluster.facetKey]: [RESOURCE_ID] },
          });

        expect(scopes).toEqual([
          {
            entityIds: [RESOURCE_ID],
            entityKeys: [cluster.keyFor(PROJECT_ID.toString(), "Prod-EU")],
            attributeKey: cluster.attributeKey,
            // The attribute match is exact, so the stored casing is kept.
            attributeValues: ["Prod-EU"],
          },
        ]);
      });

      test(`${cluster.facetKey} looks up the row's name, scoped to the project`, async () => {
        cluster.findBy.mockResolvedValue([{ name: "prod-eu" }]);

        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { [cluster.facetKey]: [RESOURCE_ID, OTHER_RESOURCE_ID] },
        });

        expect(cluster.findBy).toHaveBeenCalledTimes(1);

        const call: Record<string, any> = cluster.findBy.mock
          .calls[0]![0] as Record<string, any>;

        expect(call["query"]["projectId"]).toBe(PROJECT_ID);
        expect(call["query"]["_id"].values.map(String)).toEqual([
          RESOURCE_ID,
          OTHER_RESOURCE_ID,
        ]);
        expect(call["select"]).toEqual({ name: true });
        expect(call["props"]).toEqual({ isRoot: true });
        expect(call["limit"].toNumber()).toBe(2);
        expect(call["skip"].toNumber()).toBe(0);

        // Only this facet's table is consulted.
        for (const findBy of ALL_FIND_BY_MOCKS) {
          if (findBy !== cluster.findBy) {
            expect(findBy).not.toHaveBeenCalled();
          }
        }
      });

      test(`${cluster.facetKey} entity keys ignore casing and surrounding whitespace, as ingest's canonicalization does`, async () => {
        cluster.findBy.mockResolvedValue([{ name: "  PROD-eu " }]);

        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { [cluster.facetKey]: [RESOURCE_ID] },
          });

        expect(scopes[0]!.entityKeys).toEqual([
          cluster.keyFor(PROJECT_ID.toString(), "prod-eu"),
        ]);
      });

      test(`${cluster.facetKey} de-duplicates keys but keeps each distinct name`, async () => {
        cluster.findBy.mockResolvedValue([
          { name: "prod-eu" },
          { name: "prod-us" },
          { name: "prod-eu" },
        ]);

        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: {
              [cluster.facetKey]: [RESOURCE_ID, OTHER_RESOURCE_ID],
            },
          });

        expect(scopes[0]!.entityKeys).toEqual([
          cluster.keyFor(PROJECT_ID.toString(), "prod-eu"),
          cluster.keyFor(PROJECT_ID.toString(), "prod-us"),
        ]);
        expect(scopes[0]!.attributeValues).toEqual(["prod-eu", "prod-us"]);
      });

      test(`${cluster.facetKey} degrades to the id branch when the lookup fails`, async () => {
        cluster.findBy.mockRejectedValue(
          new Error("connection refused") as never,
        );

        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { [cluster.facetKey]: [RESOURCE_ID] },
          });

        expect(scopes).toEqual([{ entityIds: [RESOURCE_ID], entityKeys: [] }]);
      });
    }

    test("the cluster keys are type-scoped: the same name under two types is two different keys", () => {
      const keys: Array<string> = NAME_KEYED_CLUSTERS.map(
        (cluster: {
          keyFor: (projectId: string, name: string) => string;
        }): string => {
          return cluster.keyFor(PROJECT_ID.toString(), "prod");
        },
      );

      expect(new Set(keys).size).toBe(NAME_KEYED_CLUSTERS.length);
    });
  });

  describe("resolveScopes — attribute-only types (Serverless function / IoT fleet)", () => {
    test("serverlessFunctionId matches the id or resource.faas.name, with no entity key", async () => {
      serverlessFunctionFindBy.mockResolvedValue([
        { functionIdentifier: "checkout-handler" },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { serverlessFunctionId: [RESOURCE_ID] },
        });

      expect(scopes).toEqual([
        {
          entityIds: [RESOURCE_ID],
          entityKeys: [],
          attributeKey: "resource.faas.name",
          attributeValues: ["checkout-handler"],
        },
      ]);

      const call: Record<string, any> = serverlessFunctionFindBy.mock
        .calls[0]![0] as Record<string, any>;
      expect(call["query"]["projectId"]).toBe(PROJECT_ID);
      expect(call["select"]).toEqual({ functionIdentifier: true });
    });

    test("iotFleetId matches the id or resource.iot.fleet.name, with no entity key", async () => {
      iotFleetFindBy.mockResolvedValue([{ name: "warehouse-sensors" }]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { iotFleetId: [RESOURCE_ID] },
        });

      expect(scopes).toEqual([
        {
          entityIds: [RESOURCE_ID],
          entityKeys: [],
          attributeKey: "resource.iot.fleet.name",
          attributeValues: ["warehouse-sensors"],
        },
      ]);

      const call: Record<string, any> = iotFleetFindBy.mock
        .calls[0]![0] as Record<string, any>;
      expect(call["query"]["projectId"]).toBe(PROJECT_ID);
      expect(call["select"]).toEqual({ name: true });
    });

    test("a blank function identifier leaves the id branch alone", async () => {
      serverlessFunctionFindBy.mockResolvedValue([
        { functionIdentifier: "  " },
        { functionIdentifier: null },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { serverlessFunctionId: [RESOURCE_ID] },
        });

      expect(scopes).toEqual([{ entityIds: [RESOURCE_ID], entityKeys: [] }]);
    });

    test("an attribute-only scope compiles to id OR attribute, never an empty hasAny", async () => {
      iotFleetFindBy.mockResolvedValue([{ name: "warehouse-sensors" }]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { iotFleetId: [RESOURCE_ID] },
        });

      const statement: Statement = new Statement();
      appendResourceScopeFilters(statement, scopes);

      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)}) OR attributes[{p1:String}] IN ({p2:Array(String)}))",
      );
      expect(statement.query).not.toContain("hasAny");
      expect(statement.query_params).toStrictEqual({
        p0: [RESOURCE_ID],
        p1: "resource.iot.fleet.name",
        p2: ["warehouse-sensors"],
      });
    });
  });

  describe("resolveScopes — id-only types (Cloud resource / RUM application)", () => {
    test.each(["cloudResourceId", "rumApplicationId"])(
      "%s stays primaryEntityId-only and costs no Postgres lookup",
      async (facetKey: string) => {
        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { [facetKey]: [RESOURCE_ID, OTHER_RESOURCE_ID] },
          });

        expect(scopes).toEqual([
          { entityIds: [RESOURCE_ID, OTHER_RESOURCE_ID], entityKeys: [] },
        ]);
        expect(cloudResourceFindBy).not.toHaveBeenCalled();
        expect(rumApplicationFindBy).not.toHaveBeenCalled();

        const statement: Statement = new Statement();
        appendResourceScopeFilters(statement, scopes);

        expect(statement.query).toBe(
          "AND (primaryEntityId IN ({p0:Array(String)}))",
        );
      },
    );

    test("an id-only facet still intersects with a resolved one", async () => {
      proxmoxClusterFindBy.mockResolvedValue([{ name: "pve" }]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: {
            rumApplicationId: [RESOURCE_ID],
            proxmoxClusterId: [OTHER_RESOURCE_ID],
          },
        });

      expect(scopes).toHaveLength(2);

      const statement: Statement = new Statement();
      appendResourceScopeFilters(statement, scopes);

      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)})) AND (primaryEntityId IN ({p1:Array(String)}) OR hasAny(entityKeys, {p2:Array(String)}) OR attributes[{p3:String}] IN ({p4:Array(String)}))",
      );
    });
  });

  describe("resolveScopes — databases (entity-key set)", () => {
    const PROJECT: string = PROJECT_ID.toString();
    const POD_KEY: string = keyForKubernetesPod(PROJECT, {
      clusterName: "prod-eu",
      namespace: "data",
      podName: "postgres-0",
    });
    const OLD_POD_KEY: string = keyForKubernetesPod(PROJECT, {
      clusterName: "prod-eu",
      namespace: "data",
      podName: "postgres-0-before-restart",
    });
    const CONTAINER_KEY: string = keyForContainer(
      PROJECT,
      "4f1c9a2b7d3e8f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a",
    );

    const POSTGRES_ROW: Record<string, unknown> = {
      _id: RESOURCE_ID,
      dbSystem: "postgresql",
      memberEntityKeys: {
        [POD_KEY]: "2026-09-23T10:00:00.000Z",
        [OLD_POD_KEY]: "2026-09-01T10:00:00.000Z",
      },
    };
    const REDIS_ROW: Record<string, unknown> = {
      _id: OTHER_RESOURCE_ID,
      dbSystem: "redis",
      memberEntityKeys: { [CONTAINER_KEY]: "2026-09-22T08:30:00.000Z" },
    };

    // Endpoint rows in the order the lookup returns them (primary first).
    const ENDPOINT_ROWS: Array<Record<string, unknown>> = [
      { databaseServerId: RESOURCE_ID, endpoint: "db.prod.example.com:5432" },
      {
        databaseServerId: RESOURCE_ID,
        endpoint: "postgres.data.svc.cluster.local:5432@prod-eu",
      },
      // A legacy port-less alias: the engine default port applies.
      { databaseServerId: RESOURCE_ID, endpoint: "pg-replica.example.com" },
      {
        databaseServerId: OTHER_RESOURCE_ID,
        endpoint: "cache.example.com:6379",
      },
    ];

    function endpointsOf(id: string): Array<string> {
      return ENDPOINT_ROWS.filter((row: Record<string, unknown>): boolean => {
        return row["databaseServerId"] === id;
      }).map((row: Record<string, unknown>): string => {
        return row["endpoint"] as string;
      });
    }

    // What the Database page computes for one row (the shared helper).
    function pageKeysFor(row: Record<string, unknown>): Array<string> {
      return getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: endpointsOf(row["_id"] as string),
        dbSystem: row["dbSystem"] as string,
        memberEntityKeys: row["memberEntityKeys"],
      });
    }

    test("selects a database by exactly the entity keys its page scopes Logs / Traces / Metrics with", async () => {
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(
        ENDPOINT_ROWS.filter((row: Record<string, unknown>): boolean => {
          return row["databaseServerId"] === RESOURCE_ID;
        }),
      );

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      expect(scopes).toHaveLength(1);
      expect(scopes[0]!.entityIds).toEqual([RESOURCE_ID]);
      expect(scopes[0]!.entityKeys).toEqual(pageKeysFor(POSTGRES_ROW));
      // No attribute branch: no single resource attribute names a database.
      expect(scopes[0]!.attributeKey).toBeUndefined();
      expect(scopes[0]!.attributeValues).toBeUndefined();
    });

    test("equals what the Database page's own scope helper (DatabaseTelemetryScope) queries for the same row", async () => {
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(
        ENDPOINT_ROWS.filter((row: Record<string, unknown>): boolean => {
          return row["databaseServerId"] === RESOURCE_ID;
        }),
      );

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      /*
       * The page loads the row and its endpoints (primary first) and hands
       * them to getDatabaseServerScopeKeys; the explorer facet must select
       * exactly those rows, key for key and in the same order.
       */
      const pageKeys: Array<string> = getDatabaseServerScopeKeys({
        projectId: PROJECT_ID,
        endpoints: endpointsOf(RESOURCE_ID).map(
          (endpoint: string): { endpoint: string } => {
            return { endpoint };
          },
        ),
        dbSystem: POSTGRES_ROW["dbSystem"] as string,
        memberEntityKeys: POSTGRES_ROW["memberEntityKeys"],
      });

      expect(pageKeys.length).toBeGreaterThan(0);
      expect(scopes[0]!.entityKeys).toEqual(pageKeys);
    });

    test("the key set is the endpoint keys ingest stamps plus the member keys — engine default port applied", async () => {
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(
        ENDPOINT_ROWS.filter((row: Record<string, unknown>): boolean => {
          return row["databaseServerId"] === RESOURCE_ID;
        }),
      );

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      expect(new Set(scopes[0]!.entityKeys)).toEqual(
        new Set<string>([
          keyForDatabaseEndpoint(PROJECT, {
            host: "db.prod.example.com",
            port: 5432,
          }),
          keyForDatabaseEndpoint(PROJECT, {
            host: "postgres.data.svc.cluster.local",
            port: 5432,
            kubernetesClusterName: "prod-eu",
          }),
          keyForDatabaseEndpoint(PROJECT, {
            host: "pg-replica.example.com",
            port: 5432,
          }),
          POD_KEY,
          // A pod seen before a restart keeps its logs on the page.
          OLD_POD_KEY,
        ]),
      );
    });

    test("several databases OR inside one scope: the union of each page's keys", async () => {
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW, REDIS_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(ENDPOINT_ROWS);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID, OTHER_RESOURCE_ID] },
        });

      expect(scopes).toHaveLength(1);
      expect(scopes[0]!.entityIds).toEqual([RESOURCE_ID, OTHER_RESOURCE_ID]);
      expect(scopes[0]!.entityKeys).toEqual(
        Array.from(
          new Set<string>([
            ...pageKeysFor(POSTGRES_ROW),
            ...pageKeysFor(REDIS_ROW),
          ]),
        ),
      );
      // Each endpoint is attributed to its own row, never the other's.
      expect(scopes[0]!.entityKeys).toContain(
        keyForDatabaseEndpoint(PROJECT, {
          host: "cache.example.com",
          port: 6379,
        }),
      );
      expect(scopes[0]!.entityKeys).toContain(CONTAINER_KEY);
    });

    test("an endpoint is parsed with its OWN row's engine for the default port", async () => {
      databaseServerFindBy.mockResolvedValue([
        { _id: RESOURCE_ID, dbSystem: "postgresql", memberEntityKeys: {} },
        { _id: OTHER_RESOURCE_ID, dbSystem: "redis", memberEntityKeys: {} },
      ]);
      databaseServerEndpointFindBy.mockResolvedValue([
        { databaseServerId: RESOURCE_ID, endpoint: "pg.example.com" },
        { databaseServerId: OTHER_RESOURCE_ID, endpoint: "redis.example.com" },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID, OTHER_RESOURCE_ID] },
        });

      expect(scopes[0]!.entityKeys).toEqual([
        keyForDatabaseEndpoint(PROJECT, { host: "pg.example.com", port: 5432 }),
        keyForDatabaseEndpoint(PROJECT, {
          host: "redis.example.com",
          port: 6379,
        }),
      ]);
    });

    test("looks up the rows and then their endpoints, both project-scoped and as root", async () => {
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW, REDIS_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(ENDPOINT_ROWS);

      await ResourceEntityFilter.resolveScopes({
        projectId: PROJECT_ID,
        selections: { databaseServerId: [RESOURCE_ID, OTHER_RESOURCE_ID] },
      });

      expect(databaseServerFindBy).toHaveBeenCalledTimes(1);
      const rowCall: Record<string, any> = databaseServerFindBy.mock
        .calls[0]![0] as Record<string, any>;
      expect(rowCall["query"]["projectId"]).toBe(PROJECT_ID);
      expect(rowCall["query"]["_id"].values.map(String)).toEqual([
        RESOURCE_ID,
        OTHER_RESOURCE_ID,
      ]);
      expect(rowCall["select"]).toEqual({
        _id: true,
        dbSystem: true,
        memberEntityKeys: true,
      });
      expect(rowCall["props"]).toEqual({ isRoot: true });
      expect(rowCall["limit"].toNumber()).toBe(2);
      expect(rowCall["skip"].toNumber()).toBe(0);

      expect(databaseServerEndpointFindBy).toHaveBeenCalledTimes(1);
      const endpointCall: Record<string, any> = databaseServerEndpointFindBy
        .mock.calls[0]![0] as Record<string, any>;
      expect(endpointCall["query"]["projectId"]).toBe(PROJECT_ID);
      // Only the rows that resolved in THIS project are asked about.
      expect(
        endpointCall["query"]["databaseServerId"].values.map(String),
      ).toEqual([RESOURCE_ID, OTHER_RESOURCE_ID]);
      expect(endpointCall["select"]).toEqual({
        databaseServerId: true,
        endpoint: true,
      });
      // The page's order, so the per-row key cap keeps the same keys.
      expect(endpointCall["sort"]).toEqual({
        isPrimary: SortOrder.Descending,
        createdAt: SortOrder.Ascending,
      });
      expect(endpointCall["props"]).toEqual({ isRoot: true });

      // No other resource table is consulted.
      for (const findBy of ALL_FIND_BY_MOCKS) {
        if (
          findBy !== databaseServerFindBy &&
          findBy !== databaseServerEndpointFindBy
        ) {
          expect(findBy).not.toHaveBeenCalled();
        }
      }
    });

    test("an id from another project resolves to nothing and skips the endpoint lookup", async () => {
      databaseServerFindBy.mockResolvedValue([]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      expect(scopes).toEqual([{ entityIds: [RESOURCE_ID], entityKeys: [] }]);
      expect(databaseServerEndpointFindBy).not.toHaveBeenCalled();
    });

    test("endpoint rows owned by an unselected database are ignored", async () => {
      databaseServerFindBy.mockResolvedValue([
        { _id: RESOURCE_ID, dbSystem: "postgresql", memberEntityKeys: {} },
      ]);
      databaseServerEndpointFindBy.mockResolvedValue([
        { databaseServerId: RESOURCE_ID, endpoint: "db.prod.example.com:5432" },
        {
          databaseServerId: OTHER_RESOURCE_ID,
          endpoint: "someone-else.example.com:5432",
        },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      expect(scopes[0]!.entityKeys).toEqual([
        keyForDatabaseEndpoint(PROJECT, {
          host: "db.prod.example.com",
          port: 5432,
        }),
      ]);
    });

    test("a database with no endpoints and no members keeps the id-only predicate — never an empty hasAny", async () => {
      databaseServerFindBy.mockResolvedValue([
        { _id: RESOURCE_ID, dbSystem: "postgresql", memberEntityKeys: null },
      ]);
      databaseServerEndpointFindBy.mockResolvedValue([]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      expect(scopes).toEqual([{ entityIds: [RESOURCE_ID], entityKeys: [] }]);

      const statement: Statement = new Statement();
      appendResourceScopeFilters(statement, scopes);
      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)}))",
      );
    });

    test("unparseable endpoints and malformed member keys are skipped, never thrown on", async () => {
      databaseServerFindBy.mockResolvedValue([
        {
          _id: RESOURCE_ID,
          dbSystem: "postgresql",
          memberEntityKeys: {
            "not-a-key": "2026-09-23T10:00:00.000Z",
            [POD_KEY]: "not-a-date",
          },
        },
      ]);
      databaseServerEndpointFindBy.mockResolvedValue([
        { databaseServerId: RESOURCE_ID, endpoint: "localhost:5432" },
        { databaseServerId: RESOURCE_ID, endpoint: "" },
        { databaseServerId: RESOURCE_ID, endpoint: null },
        { databaseServerId: null, endpoint: "orphan.example.com:5432" },
        { databaseServerId: RESOURCE_ID, endpoint: "db.prod.example.com:5432" },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      expect(scopes[0]!.entityKeys).toEqual([
        keyForDatabaseEndpoint(PROJECT, {
          host: "db.prod.example.com",
          port: 5432,
        }),
      ]);
    });

    test("the same endpoint key reached twice is bound once", async () => {
      databaseServerFindBy.mockResolvedValue([
        { _id: RESOURCE_ID, dbSystem: "postgresql", memberEntityKeys: {} },
        {
          _id: OTHER_RESOURCE_ID,
          dbSystem: "postgresql",
          memberEntityKeys: {},
        },
      ]);
      // Port-less and explicit-default forms name the same listener.
      databaseServerEndpointFindBy.mockResolvedValue([
        { databaseServerId: RESOURCE_ID, endpoint: "db.prod.example.com" },
        {
          databaseServerId: OTHER_RESOURCE_ID,
          endpoint: "db.prod.example.com:5432",
        },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID, OTHER_RESOURCE_ID] },
        });

      expect(scopes[0]!.entityKeys).toEqual([
        keyForDatabaseEndpoint(PROJECT, {
          host: "db.prod.example.com",
          port: 5432,
        }),
      ]);
    });

    test.each([
      ["the row lookup", "rows"],
      ["the endpoint lookup", "endpoints"],
    ])(
      "a failure in %s degrades to the id branch instead of throwing",
      async (_label: string, which: string) => {
        databaseServerFindBy.mockResolvedValue([POSTGRES_ROW]);
        databaseServerEndpointFindBy.mockResolvedValue(ENDPOINT_ROWS);
        (which === "rows"
          ? databaseServerFindBy
          : databaseServerEndpointFindBy
        ).mockRejectedValue(new Error("connection refused") as never);

        const scopes: Array<ResourceEntityScope> =
          await ResourceEntityFilter.resolveScopes({
            projectId: PROJECT_ID,
            selections: { databaseServerId: [RESOURCE_ID] },
          });

        expect(scopes).toEqual([{ entityIds: [RESOURCE_ID], entityKeys: [] }]);
      },
    );

    test("compiles to id OR hasAny(entityKeys) — the receiver batches primary-keyed on the row, and every span naming an endpoint", async () => {
      databaseServerFindBy.mockResolvedValue([
        { _id: RESOURCE_ID, dbSystem: "postgresql", memberEntityKeys: {} },
      ]);
      databaseServerEndpointFindBy.mockResolvedValue([
        { databaseServerId: RESOURCE_ID, endpoint: "db.prod.example.com:5432" },
      ]);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: { databaseServerId: [RESOURCE_ID] },
        });

      const statement: Statement = new Statement();
      appendResourceScopeFilters(statement, scopes);

      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)}) OR hasAny(entityKeys, {p1:Array(String)}))",
      );
      expect(statement.query).not.toContain("attributes[");
      expect(statement.query_params).toStrictEqual({
        p0: [RESOURCE_ID],
        p1: [
          keyForDatabaseEndpoint(PROJECT, {
            host: "db.prod.example.com",
            port: 5432,
          }),
        ],
      });
    });

    test("a database selection intersects with a host selection", async () => {
      hostFindBy.mockResolvedValue([{ hostIdentifier: "web-1" }]);
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(ENDPOINT_ROWS);

      const scopes: Array<ResourceEntityScope> =
        await ResourceEntityFilter.resolveScopes({
          projectId: PROJECT_ID,
          selections: {
            databaseServerId: [RESOURCE_ID],
            hostId: [HOST_ID],
          },
        });

      expect(scopes).toHaveLength(2);
      expect(
        scopes.map((scope: ResourceEntityScope): string => {
          return scope.entityIds[0]!;
        }),
      ).toEqual([RESOURCE_ID, HOST_ID]);
    });

    test("without a tenant the database scope keeps its ids and skips both lookups", async () => {
      const query: Record<string, unknown> = {
        resourceFilters: { databaseServerId: [RESOURCE_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({ query });

      expect(query["resourceEntityScopes"]).toEqual([
        { entityIds: [RESOURCE_ID], entityKeys: [] },
      ]);
      expect(databaseServerFindBy).not.toHaveBeenCalled();
      expect(databaseServerEndpointFindBy).not.toHaveBeenCalled();
    });

    test("rewrites an analytics query's database selection to its entity keys", async () => {
      databaseServerFindBy.mockResolvedValue([POSTGRES_ROW]);
      databaseServerEndpointFindBy.mockResolvedValue(
        ENDPOINT_ROWS.filter((row: Record<string, unknown>): boolean => {
          return row["databaseServerId"] === RESOURCE_ID;
        }),
      );

      const query: Record<string, unknown> = {
        resourceFilters: { databaseServerId: [RESOURCE_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query["resourceFilters"]).toBeUndefined();
      expect(query["resourceEntityScopes"]).toEqual([
        { entityIds: [RESOURCE_ID], entityKeys: pageKeysFor(POSTGRES_ROW) },
      ]);
    });
  });

  describe("rewriteAnalyticsQuery", () => {
    test("replaces the client's ids with resolved scopes", async () => {
      kubernetesClusterFindBy.mockResolvedValue([
        { clusterIdentifier: "prod-eu" },
      ]);

      const query: Record<string, unknown> = {
        resourceFilters: { kubernetesClusterId: [CLUSTER_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query["resourceFilters"]).toBeUndefined();

      const scopes: Array<ResourceEntityScope> = query[
        "resourceEntityScopes"
      ] as Array<ResourceEntityScope>;

      expect(scopes).toHaveLength(1);
      expect(scopes[0]!.entityKeys).toEqual([
        keyForKubernetesCluster(PROJECT_ID.toString(), "prod-eu"),
      ]);
    });

    test("leaves the rest of the query untouched", async () => {
      kubernetesClusterFindBy.mockResolvedValue([
        { clusterIdentifier: "prod-eu" },
      ]);

      const query: Record<string, unknown> = {
        severityText: "Error",
        resourceFilters: { kubernetesClusterId: [CLUSTER_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query["severityText"]).toBe("Error");
    });

    test("discards a hand-crafted resourceEntityScopes so only the resolver writes it", async () => {
      const query: Record<string, unknown> = {
        resourceEntityScopes: [
          { entityIds: [], entityKeys: ["deadbeefdeadbeef"] },
        ],
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query["resourceEntityScopes"]).toBeUndefined();
    });

    test("a query with no resource filter is left alone", async () => {
      const query: Record<string, unknown> = { severityText: "Error" };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query).toEqual({ severityText: "Error" });
      expect(kubernetesClusterFindBy).not.toHaveBeenCalled();
    });

    test("without a tenant the scope keeps its ids and drops the entity keys", async () => {
      const query: Record<string, unknown> = {
        resourceFilters: { kubernetesClusterId: [CLUSTER_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({ query });

      const scopes: Array<ResourceEntityScope> = query[
        "resourceEntityScopes"
      ] as Array<ResourceEntityScope>;

      expect(scopes).toEqual([{ entityIds: [CLUSTER_ID], entityKeys: [] }]);
      expect(kubernetesClusterFindBy).not.toHaveBeenCalled();
    });

    test("a malformed filter carries no constraint at all", async () => {
      const query: Record<string, unknown> = {
        resourceFilters: { kubernetesClusterId: ["not-an-id"] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query["resourceEntityScopes"]).toBeUndefined();
      expect(query["resourceFilters"]).toBeUndefined();
    });

    test("rewrites a Docker Swarm selection that the parser used to drop", async () => {
      dockerSwarmClusterFindBy.mockResolvedValue([{ name: "swarm-a" }]);

      const query: Record<string, unknown> = {
        resourceFilters: { dockerSwarmClusterId: [RESOURCE_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({
        query,
        projectId: PROJECT_ID,
      });

      expect(query["resourceFilters"]).toBeUndefined();
      expect(query["resourceEntityScopes"]).toEqual([
        {
          entityIds: [RESOURCE_ID],
          entityKeys: [
            keyForDockerSwarmCluster(PROJECT_ID.toString(), "swarm-a"),
          ],
          attributeKey: "resource.docker.swarm.cluster.name",
          attributeValues: ["swarm-a"],
        },
      ]);
    });

    test("without a tenant a new resource type keeps its ids and skips the lookup", async () => {
      const query: Record<string, unknown> = {
        resourceFilters: { iotFleetId: [RESOURCE_ID] },
      };

      await ResourceEntityFilter.rewriteAnalyticsQuery({ query });

      expect(query["resourceEntityScopes"]).toEqual([
        { entityIds: [RESOURCE_ID], entityKeys: [] },
      ]);
      expect(iotFleetFindBy).not.toHaveBeenCalled();
    });

    test("an absent query is a no-op", async () => {
      await expect(
        ResourceEntityFilter.rewriteAnalyticsQuery({
          query: undefined,
          projectId: PROJECT_ID,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("appendResourceScopeFilters", () => {
    test("emits one OR group per scope, every branch parameter-bound", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, [
        {
          entityIds: [CLUSTER_ID],
          entityKeys: ["210dac24142f1baa"],
          attributeKey: "resource.k8s.cluster.name",
          attributeValues: ["prod-eu"],
        },
      ]);

      /*
       * Statement.query trims the fragment's leading separator when it is
       * the whole statement; in the aggregation services it is appended to
       * a WHERE that already has predicates (covered below).
       */
      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)}) OR hasAny(entityKeys, {p1:Array(String)}) OR attributes[{p2:String}] IN ({p3:Array(String)}))",
      );
      expect(statement.query_params).toStrictEqual({
        p0: [CLUSTER_ID],
        p1: ["210dac24142f1baa"],
        p2: "resource.k8s.cluster.name",
        p3: ["prod-eu"],
      });
    });

    test("two scopes AND with each other", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, [
        { entityIds: [CLUSTER_ID], entityKeys: [] },
        { entityIds: [HOST_ID], entityKeys: [] },
      ]);

      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)})) AND (primaryEntityId IN ({p1:Array(String)}))",
      );
    });

    test("a scope with nothing to match on appends no predicate", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, [
        { entityIds: [], entityKeys: [], attributeValues: [] },
      ]);

      expect(statement.query).toBe("");
    });

    test("separates cleanly from the predicates already in the statement", () => {
      const statement: Statement = SQL`WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: PROJECT_ID,
      }}`;

      appendResourceScopeFilters(statement, [
        { entityIds: [CLUSTER_ID], entityKeys: [] },
      ]);

      expect(statement.query).toBe(
        "WHERE projectId = {p0:String} AND (primaryEntityId IN ({p1:Array(String)}))",
      );
    });

    test("an absent scope list appends nothing", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, undefined);

      expect(statement.query).toBe("");
    });

    test("an attribute-only scope (no entity keys) emits no hasAny branch", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, [
        {
          entityIds: [],
          entityKeys: [],
          attributeKey: "resource.faas.name",
          attributeValues: ["checkout-handler"],
        },
      ]);

      expect(statement.query).toBe(
        "AND (attributes[{p0:String}] IN ({p1:Array(String)}))",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "resource.faas.name",
        p1: ["checkout-handler"],
      });
    });

    test("blank entity keys and attribute values are dropped rather than bound", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, [
        {
          entityIds: [RESOURCE_ID],
          entityKeys: [""],
          attributeKey: "resource.iot.fleet.name",
          attributeValues: [""],
        },
      ]);

      expect(statement.query).toBe(
        "AND (primaryEntityId IN ({p0:Array(String)}))",
      );
    });

    test("the attribute fallback needs both a key and values", () => {
      const statement: Statement = new Statement();

      appendResourceScopeFilters(statement, [
        {
          entityIds: [],
          entityKeys: ["210dac24142f1baa"],
          attributeValues: ["prod-eu"],
        },
      ]);

      expect(statement.query).toBe(
        "AND (hasAny(entityKeys, {p0:Array(String)}))",
      );
    });
  });
});
