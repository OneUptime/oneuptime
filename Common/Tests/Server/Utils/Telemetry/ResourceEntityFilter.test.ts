import "../../TestingUtils/Init";
import ObjectID from "../../../../Types/ObjectID";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "../../../../Utils/Telemetry/EntityKey";

/*
 * The four resource tables are mocked at module level: the unit under test
 * is the id -> identifier -> entity-key translation, not Postgres. Each
 * mock records the query it was handed so the tests can assert the lookup
 * is project-scoped (a cluster id from another tenant must not resolve).
 */
const hostFindBy: jest.Mock = jest.fn();
const dockerHostFindBy: jest.Mock = jest.fn();
const podmanHostFindBy: jest.Mock = jest.fn();
const kubernetesClusterFindBy: jest.Mock = jest.fn();

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

describe("ResourceEntityFilter", () => {
  beforeEach(() => {
    hostFindBy.mockReset();
    dockerHostFindBy.mockReset();
    podmanHostFindBy.mockReset();
    kubernetesClusterFindBy.mockReset();

    hostFindBy.mockResolvedValue([]);
    dockerHostFindBy.mockResolvedValue([]);
    podmanHostFindBy.mockResolvedValue([]);
    kubernetesClusterFindBy.mockResolvedValue([]);
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
