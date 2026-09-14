/*
 * The identifier lookup is stubbed: these tests are about what the SQL and
 * the rewritten query look like, and leaving it live would make them depend
 * on a reachable Postgres.
 */
const kubernetesClusterFindBy: jest.Mock = jest.fn();
const proxmoxClusterFindBy: jest.Mock = jest.fn();
const serverlessFunctionFindBy: jest.Mock = jest.fn();
const rumApplicationFindBy: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/KubernetesClusterService", () => {
  return { __esModule: true, default: { findBy: kubernetesClusterFindBy } };
});
jest.mock("../../../Server/Services/ProxmoxClusterService", () => {
  return { __esModule: true, default: { findBy: proxmoxClusterFindBy } };
});
jest.mock("../../../Server/Services/ServerlessFunctionService", () => {
  return { __esModule: true, default: { findBy: serverlessFunctionFindBy } };
});
jest.mock("../../../Server/Services/RumApplicationService", () => {
  return { __esModule: true, default: { findBy: rumApplicationFindBy } };
});

import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import LogService from "../../../Server/Services/LogService";
import SpanService from "../../../Server/Services/SpanService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { ResourceEntityScope } from "../../../Server/Utils/Telemetry/ResourceEntityFilter";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  keyForKubernetesCluster,
  keyForProxmoxCluster,
} from "../../../Utils/Telemetry/EntityKey";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * End of the read path for issue #3216. Selecting a Kubernetes cluster used to
 * compile to `primaryEntityId = '<clusterId>'`, and OTLP telemetry that
 * carries a `service.name` is primary-keyed on its SERVICE — the cluster only
 * appears in `entityKeys`. So the predicate matched zero rows, and pairing the
 * cluster with a service made results reappear because both ids shared one
 * `IN (...)` list.
 *
 * These tests pin the two surfaces that have to agree on what a resource facet
 * selects: the aggregation statements behind the histogram / facets / analytics
 * panels, and the list query the rows themselves come from. A chart that
 * disagrees with its list is its own bug.
 */

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-08-14T11:00:00.000Z");
const endTime: Date = new Date("2026-08-14T12:00:00.000Z");

const clusterId: string = ObjectID.generate().toString();
const serviceId: string = ObjectID.generate().toString();
const clusterEntityKey: string = keyForKubernetesCluster(
  projectId.toString(),
  "prod-eu",
);

const clusterScope: ResourceEntityScope = {
  entityIds: [clusterId],
  entityKeys: [clusterEntityKey],
  attributeKey: "resource.k8s.cluster.name",
  attributeValues: ["prod-eu"],
};

/*
 * A resource type with a resource attribute but no signal entity key
 * (Serverless function / IoT fleet): the scope carries no `entityKeys`.
 */
const functionId: string = ObjectID.generate().toString();
const functionScope: ResourceEntityScope = {
  entityIds: [functionId],
  entityKeys: [],
  attributeKey: "resource.faas.name",
  attributeValues: ["checkout-handler"],
};

/*
 * Capture the statements a service builds instead of running them. The
 * assertions are about the SQL shape (which branches, how they are combined),
 * which is what decides whether a row matches.
 */
function captureStatements(
  service: { executeQuery: (statement: Statement) => Promise<Results> },
  rows: Array<JSONObject> = [],
): Array<Statement> {
  const captured: Array<Statement> = [];

  jest.spyOn(service as never, "executeQuery").mockImplementation(((
    statement: Statement,
  ): Promise<Results> => {
    captured.push(statement);

    return Promise.resolve({
      json: (): Promise<unknown> => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results);
  }) as never);

  return captured;
}

describe("resource facet filters reach the telemetry read path", () => {
  beforeEach(() => {
    kubernetesClusterFindBy.mockReset();
    kubernetesClusterFindBy.mockResolvedValue([
      { clusterIdentifier: "prod-eu" },
    ]);
    proxmoxClusterFindBy.mockReset();
    proxmoxClusterFindBy.mockResolvedValue([{ name: "pve-lab" }]);
    serverlessFunctionFindBy.mockReset();
    serverlessFunctionFindBy.mockResolvedValue([
      { functionIdentifier: "checkout-handler" },
    ]);
    rumApplicationFindBy.mockReset();
    rumApplicationFindBy.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("LogAggregationService", () => {
    test("the histogram matches a cluster by entity key, not only by primaryEntityId", async () => {
      const captured: Array<Statement> = captureStatements(LogService);

      await LogAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        resourceScopes: [clusterScope],
      });

      const query: string = captured[0]!.query;

      expect(query).toContain("primaryEntityId IN");
      expect(query).toContain("hasAny(entityKeys,");
      expect(query).toContain("attributes[");
      expect(Object.values(captured[0]!.query_params)).toContainEqual([
        clusterEntityKey,
      ]);
    });

    test("a cluster and a service are separate predicates, so they intersect", async () => {
      const captured: Array<Statement> = captureStatements(LogService);

      await LogAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        serviceIds: [new ObjectID(serviceId)],
        resourceScopes: [clusterScope],
      });

      const query: string = captured[0]!.query;

      /*
       * Two AND-ed predicates. Before the fix both ids went into ONE
       * `primaryEntityId IN (...)`, which OR-ed them — that is why adding a
       * service "fixed" the empty result while dropping the cluster.
       */
      expect(query).toContain("AND primaryEntityId IN");
      expect(query).toContain("AND (primaryEntityId IN");
      expect(query).toContain("hasAny(entityKeys,");
    });

    test("facet value queries carry the same scope as the histogram", async () => {
      const captured: Array<Statement> = captureStatements(LogService);

      await LogAggregationService.getFacetValues({
        projectId,
        startTime,
        endTime,
        facetKey: "severityText",
        resourceScopes: [clusterScope],
      });

      expect(captured[0]!.query).toContain("hasAny(entityKeys,");
    });

    test("an attribute-only scope matches by id or attribute and never emits hasAny", async () => {
      const captured: Array<Statement> = captureStatements(LogService);

      await LogAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        resourceScopes: [functionScope],
      });

      const query: string = captured[0]!.query;

      expect(query).toContain("AND (primaryEntityId IN");
      expect(query).toContain("attributes[");
      expect(query).not.toContain("hasAny(entityKeys,");
      expect(Object.values(captured[0]!.query_params)).toContainEqual([
        "checkout-handler",
      ]);
    });

    test("facet counts for a newly counted resource type carry the other facets' scopes", async () => {
      const captured: Array<Statement> = captureStatements(LogService);

      await LogAggregationService.getFacetValues({
        projectId,
        startTime,
        endTime,
        facetKey: "dockerSwarmClusterId",
        resourceScopes: [clusterScope],
      });

      const query: string = captured[0]!.query;

      expect(query).toContain("toString(primaryEntityId) AS val");
      expect(query).toContain("AND primaryEntityType = ");
      expect(query).not.toContain("mapContains(attributes");
      expect(Object.values(captured[0]!.query_params)).toContain(
        "DockerSwarmCluster",
      );
      expect(query).toContain("hasAny(entityKeys,");
    });

    test("no resource scope leaves the statement exactly as it was", async () => {
      const captured: Array<Statement> = captureStatements(LogService);

      await LogAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
      });

      expect(captured[0]!.query).not.toContain("hasAny(entityKeys,");
      expect(captured[0]!.query).not.toContain("AND (primaryEntityId IN");
    });
  });

  describe("TraceAggregationService", () => {
    test("the span histogram matches a cluster by entity key too", async () => {
      const captured: Array<Statement> = captureStatements(SpanService);

      await TraceAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        resourceScopes: [clusterScope],
      });

      const query: string = captured[0]!.query;

      expect(query).toContain("primaryEntityId IN");
      expect(query).toContain("hasAny(entityKeys,");
    });

    test("the span histogram honours an attribute-only scope without hasAny", async () => {
      const captured: Array<Statement> = captureStatements(SpanService);

      await TraceAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        resourceScopes: [functionScope],
      });

      const query: string = captured[0]!.query;

      expect(query).toContain("primaryEntityId IN");
      expect(query).toContain("attributes[");
      expect(query).not.toContain("hasAny(entityKeys,");
    });

    test("no resource scope leaves the span statement unchanged", async () => {
      const captured: Array<Statement> = captureStatements(SpanService);

      await TraceAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
      });

      expect(captured[0]!.query).not.toContain("hasAny(entityKeys,");
    });
  });

  describe("list queries", () => {
    /*
     * The list runs through the generic analytics endpoint, so the ids the
     * explorer sends have to be resolved in the service's own onBeforeFind
     * hook — that is the last point where Postgres is still reachable.
     */
    type FindByShape = {
      query: Record<string, unknown>;
      props: { tenantId: ObjectID };
    };

    test("LogService resolves the explorer's resource ids before compiling", async () => {
      const findBy: FindByShape = {
        query: { resourceFilters: { kubernetesClusterId: [clusterId] } },
        props: { tenantId: projectId },
      };

      await (
        LogService as unknown as {
          onBeforeFind: (input: FindByShape) => Promise<unknown>;
        }
      ).onBeforeFind(findBy);

      expect(findBy.query["resourceFilters"]).toBeUndefined();
      expect(findBy.query["resourceEntityScopes"]).toBeDefined();

      const scopes: Array<ResourceEntityScope> = findBy.query[
        "resourceEntityScopes"
      ] as Array<ResourceEntityScope>;

      expect(scopes[0]!.entityIds).toEqual([clusterId]);
      // Resolved through Postgres to the key ingest stamped on the rows.
      expect(scopes[0]!.entityKeys).toEqual([clusterEntityKey]);
    });

    test("SpanService resolves them the same way", async () => {
      const findBy: FindByShape = {
        query: { resourceFilters: { kubernetesClusterId: [clusterId] } },
        props: { tenantId: projectId },
      };

      await (
        SpanService as unknown as {
          onBeforeFind: (input: FindByShape) => Promise<unknown>;
        }
      ).onBeforeFind(findBy);

      expect(findBy.query["resourceFilters"]).toBeUndefined();
      expect(findBy.query["resourceEntityScopes"]).toBeDefined();
    });

    test("LogService resolves a Proxmox cluster selection to its entity key and attribute", async () => {
      const proxmoxId: string = ObjectID.generate().toString();
      const findBy: FindByShape = {
        query: { resourceFilters: { proxmoxClusterId: [proxmoxId] } },
        props: { tenantId: projectId },
      };

      await (
        LogService as unknown as {
          onBeforeFind: (input: FindByShape) => Promise<unknown>;
        }
      ).onBeforeFind(findBy);

      expect(findBy.query["resourceFilters"]).toBeUndefined();
      expect(findBy.query["resourceEntityScopes"]).toEqual([
        {
          entityIds: [proxmoxId],
          entityKeys: [keyForProxmoxCluster(projectId.toString(), "pve-lab")],
          attributeKey: "resource.proxmox.cluster.name",
          attributeValues: ["pve-lab"],
        },
      ]);
    });

    test("SpanService resolves a serverless function selection to an attribute-only scope", async () => {
      const findBy: FindByShape = {
        query: { resourceFilters: { serverlessFunctionId: [functionId] } },
        props: { tenantId: projectId },
      };

      await (
        SpanService as unknown as {
          onBeforeFind: (input: FindByShape) => Promise<unknown>;
        }
      ).onBeforeFind(findBy);

      expect(findBy.query["resourceEntityScopes"]).toEqual([functionScope]);
    });

    test("a RUM application selection stays primaryEntityId-only with no Postgres lookup", async () => {
      const appId: string = ObjectID.generate().toString();
      const findBy: FindByShape = {
        query: { resourceFilters: { rumApplicationId: [appId] } },
        props: { tenantId: projectId },
      };

      await (
        SpanService as unknown as {
          onBeforeFind: (input: FindByShape) => Promise<unknown>;
        }
      ).onBeforeFind(findBy);

      expect(findBy.query["resourceEntityScopes"]).toEqual([
        { entityIds: [appId], entityKeys: [] },
      ]);
      expect(rumApplicationFindBy).not.toHaveBeenCalled();
    });

    test("a query without resource filters is handed through untouched", async () => {
      const findBy: FindByShape = {
        query: { severityText: "Error" },
        props: { tenantId: projectId },
      };

      await (
        LogService as unknown as {
          onBeforeFind: (input: FindByShape) => Promise<unknown>;
        }
      ).onBeforeFind(findBy);

      expect(findBy.query).toEqual({ severityText: "Error" });
    });
  });
});
