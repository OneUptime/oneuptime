import { PostgresStatementTimeoutMs } from "../../../../Server/EnvironmentConfig";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import TopologyQueries, {
  statementTimeoutSql,
} from "../../../../Server/Utils/Topology/TopologyQueries";
import {
  CONTAINER_SPECIFICITY_RANKS,
  NESTING_RELATIONSHIP_RANKS,
} from "../../../../Server/Utils/Topology/TopologySql";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiLimits,
  TopologyCollectionResponseJSON,
  TopologyCollectionSearchResponseJSON,
  TopologyConnectionRowJSON,
  TopologyEntityAllTimeConnectionsResponseJSON,
  TopologyEntityAllTimeResponseJSON,
  TopologyEntityConnectionsResponseJSON,
  TopologyEntityJSON,
  TopologyEntityResponseJSON,
  TopologyInfrastructureNodeJSON,
  TopologyInfrastructureResponseJSON,
  TopologyServiceMapEntityJSON,
  TopologyServiceMapResponseJSON,
} from "../../../../Types/Topology/TopologyApi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Services/InventoryItemService", () => {
  return {
    __esModule: true,
    default: { getRepository: jest.fn() },
  };
});

/*
 * TopologyQueries with the database replaced by a scripted runner: which
 * statements run, in what order, inside what transaction, bound to which
 * project — and how rows (as node-postgres returns them: bigint and numeric
 * as strings, jsonb parsed, booleans) become the contract JSON. The SQL's own
 * behaviour is TopologyQueriesPostgres's job.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RANGE_START: Date = new Date("2026-09-20T10:00:00.000Z");

interface RecordedStatement {
  sql: string;
  params: Array<unknown>;
}

type Responder = (sql: string, params: Array<unknown>) => Array<JSONObject>;

interface FakeDatabase {
  statements: Array<RecordedStatement>;
  isolationLevels: Array<string>;
}

const repositoryMock: jest.Mock = (
  InventoryItemService as unknown as { getRepository: jest.Mock }
).getRepository;

/*
 * Routes each statement to the first rule whose pattern it contains. A
 * statement no rule expects fails the test: a query the code should not have
 * run is as much a regression as a wrong answer.
 */
function useDatabase(rules: Array<[string, Responder]>): FakeDatabase {
  const database: FakeDatabase = { statements: [], isolationLevels: [] };
  const query: (
    sql: string,
    params?: Array<unknown>,
  ) => Promise<unknown> = async (
    sql: string,
    params: Array<unknown> = [],
  ): Promise<unknown> => {
    database.statements.push({ sql, params });
    if (sql.startsWith("SET ")) {
      return [];
    }
    for (const [pattern, responder] of rules) {
      if (sql.includes(pattern)) {
        return responder(sql, params);
      }
    }
    throw new Error(`unexpected statement: ${sql.slice(0, 160)}`);
  };
  repositoryMock.mockReturnValue({
    manager: {
      transaction: async (
        isolationLevel: string,
        work: (manager: unknown) => Promise<unknown>,
      ): Promise<unknown> => {
        database.isolationLevels.push(isolationLevel);
        return await work({ query });
      },
    },
  });
  return database;
}

function rows(data: Array<JSONObject>): Responder {
  return (): Array<JSONObject> => {
    return data;
  };
}

function typesRule(types: Array<string>): [string, Responder] {
  return [
    "WITH RECURSIVE project_types",
    rows(
      types.map((type: string): JSONObject => {
        return { entityType: type };
      }),
    ),
  ];
}

function duplicatesRule(keys: Array<string> = []): [string, Responder] {
  return [
    "HAVING COUNT(*) > 1",
    rows(
      keys.map((key: string): JSONObject => {
        return { key };
      }),
    ),
  ];
}

function dataStatements(database: FakeDatabase): Array<RecordedStatement> {
  return database.statements.filter((statement: RecordedStatement) => {
    return !statement.sql.startsWith("SET ");
  });
}

function scope(): { projectId: ObjectID; rangeStart: Date } {
  return { projectId: PROJECT_ID, rangeStart: RANGE_START };
}

describe("TopologyQueries", () => {
  beforeEach(() => {
    repositoryMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the read snapshot", () => {
    test("one REPEATABLE READ transaction, made read-only, with the server-side statement timeout, without parallel workers or JIT, before any read", async () => {
      const database: FakeDatabase = useDatabase([typesRule([])]);

      await TopologyQueries.getServiceMap(scope());

      expect(database.isolationLevels).toEqual(["REPEATABLE READ"]);
      expect(PostgresStatementTimeoutMs).toBeGreaterThan(0);
      expect(
        database.statements.slice(0, 4).map((statement: RecordedStatement) => {
          return statement.sql;
        }),
      ).toEqual([
        "SET TRANSACTION READ ONLY",
        `SET LOCAL statement_timeout = ${Math.floor(PostgresStatementTimeoutMs)}`,
        "SET LOCAL max_parallel_workers_per_gather = 0",
        "SET LOCAL jit = off",
      ]);
      expect(database.statements[4]!.sql).toContain("project_types");
    });

    test("every endpoint's snapshot sets the statement timeout before its first read", async () => {
      const runs: Array<() => Promise<unknown>> = [
        () => {
          return TopologyQueries.getInfrastructure(scope());
        },
        () => {
          return TopologyQueries.getEntity({
            ...scope(),
            entityKey: "svc-a",
            entityType: null,
          });
        },
        () => {
          return TopologyQueries.getEntityAllTime({
            projectId: PROJECT_ID,
            entityKey: "svc-a",
            entityType: null,
          });
        },
        () => {
          return TopologyQueries.getCollectionPage({
            ...scope(),
            entityType: EntityType.IoTDevice,
            includeInactive: false,
            nameTerms: [],
            cursor: null,
            limit: 10,
          });
        },
        () => {
          return TopologyQueries.getCollectionSearch({
            ...scope(),
            includeInactive: false,
            types: [{ entityType: EntityType.IoTDevice, nameTerms: [] }],
          });
        },
      ];
      for (const run of runs) {
        const database: FakeDatabase = useDatabase([
          typesRule([]),
          ["COUNT(*)", rows([{ total: 0, count: 0 }])],
          ['"InventoryItem" i', rows([])],
        ]);
        await run();
        const timeoutAt: number = database.statements.findIndex(
          (statement: RecordedStatement): boolean => {
            return statement.sql.startsWith("SET LOCAL statement_timeout");
          },
        );
        const firstRead: number = database.statements.findIndex(
          (statement: RecordedStatement): boolean => {
            return !statement.sql.startsWith("SET ");
          },
        );
        expect(timeoutAt).toBe(1);
        expect(firstRead).toBeGreaterThan(timeoutAt);
      }
    });

    test.each([
      [30_000, "SET LOCAL statement_timeout = 30000"],
      [1, "SET LOCAL statement_timeout = 1"],
      [2500.9, "SET LOCAL statement_timeout = 2500"],
      [0, null],
      [-5, null],
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, null],
    ])(
      "statementTimeoutSql(%p) = %p: an integer, or the connection's own when none is configured",
      (timeoutMs: number, expected: string | null) => {
        expect(statementTimeoutSql(timeoutMs)).toBe(expected);
      },
    );

    test("a failing statement rejects the request", async () => {
      useDatabase([
        [
          "project_types",
          (): Array<JSONObject> => {
            throw new Error("canceling statement due to statement timeout");
          },
        ],
      ]);
      await expect(TopologyQueries.getInfrastructure(scope())).rejects.toThrow(
        "statement timeout",
      );
    });

    test("every statement binds the authorized project as $1", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Service, EntityType.KubernetesPod]),
        duplicatesRule(),
        ['GROUP BY i."entityType"', rows([])],
        [
          "candidates AS MATERIALIZED",
          rows([{ key: "pod-1", type: "k8s.pod" }]),
        ],
        ['i."displayName" AS "name" FROM', rows([{ key: "svc-a", name: "A" }])],
        ["SELECT DISTINCT", rows([])],
      ]);
      await TopologyQueries.getInfrastructure(scope());
      const statements: Array<RecordedStatement> = dataStatements(database);
      expect(statements.length).toBeGreaterThanOrEqual(5);
      for (const statement of statements) {
        expect(statement.params[0]).toBe(PROJECT_ID.toString());
      }
    });
  });

  describe("service map", () => {
    test("a project without services reads nothing else", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Host]),
      ]);
      const response: TopologyServiceMapResponseJSON =
        await TopologyQueries.getServiceMap(scope());
      expect(dataStatements(database)).toHaveLength(1);
      expect(response).toMatchObject({
        formatVersion: TOPOLOGY_API_FORMAT_VERSION,
        rangeStart: RANGE_START.toISOString(),
        entities: [],
        dependencies: [],
        runsOn: [],
        entityTruncation: null,
        dependencyTruncation: null,
      });
      expect(Number.isNaN(Date.parse(response.generatedAt))).toBe(false);
    });

    test("decodes services, calls, callees and runs-on counts", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([
          EntityType.Service,
          EntityType.Database,
          EntityType.KubernetesPod,
        ]),
        duplicatesRule(),
        [
          '"entityType" <> $',
          rows([
            {
              key: "db-1",
              type: EntityType.Database,
              name: "orders",
              source: "discovered",
              lastSeenAt: "1790000000000",
              descriptiveAttributes: { "db.system.name": "postgresql" },
              identifyingAttributes: null,
            },
          ]),
        ],
        [
          "jsonb_object_agg",
          rows([
            {
              key: "svc-a",
              type: EntityType.Service,
              name: "checkout",
              source: null,
              lastSeenAt: 1790000000123,
              descriptiveAttributes: {
                "telemetry.sdk.language": "nodejs",
                sneaky: 42,
              },
              identifyingAttributes: {},
            },
            {
              key: "svc-b",
              type: EntityType.Service,
              name: null,
              source: "manual",
              lastSeenAt: null,
              descriptiveAttributes: null,
              identifyingAttributes: null,
            },
          ]),
        ],
        [
          'r."callCount" AS "callCount"',
          rows([
            {
              from: "svc-a",
              to: "db-1",
              callCount: 10,
              errorCount: "2",
              avgDurationMs: null,
            },
            {
              from: "svc-a",
              to: "svc-b",
              callCount: null,
              errorCount: null,
              avgDurationMs: 7,
            },
            {
              from: "svc-b",
              to: "ghost",
              callCount: 1,
              errorCount: 0,
              avgDurationMs: 3,
            },
          ]),
        ],
        [
          'AS "target"',
          rows([
            { service: "svc-b", target: "pod-2" },
            { service: "svc-a", target: "pod-1" },
            { service: "svc-a", target: "pod-2" },
            { service: "svc-a", target: "gone" },
          ]),
        ],
        [
          '"active" FROM "InventoryItem" i',
          rows([
            { key: "pod-1", type: EntityType.KubernetesPod, active: true },
            { key: "pod-2", type: EntityType.KubernetesPod, active: false },
          ]),
        ],
      ]);

      const response: TopologyServiceMapResponseJSON =
        await TopologyQueries.getServiceMap(scope());

      expect(response.entities).toEqual([
        {
          key: "svc-a",
          type: EntityType.Service,
          name: "checkout",
          source: "",
          lastSeenAt: 1790000000123,
          descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
        },
        {
          key: "svc-b",
          type: EntityType.Service,
          name: null,
          source: "manual",
          lastSeenAt: null,
        },
        {
          key: "db-1",
          type: EntityType.Database,
          name: "orders",
          source: "discovered",
          lastSeenAt: 1790000000000,
          descriptiveAttributes: { "db.system.name": "postgresql" },
        },
      ]);
      expect(response.dependencies).toEqual([
        {
          from: "svc-a",
          to: "db-1",
          callCount: 10,
          errorCount: 2,
          avgDurationMs: null,
        },
        {
          from: "svc-a",
          to: "svc-b",
          callCount: null,
          errorCount: null,
          avgDurationMs: 7,
        },
        {
          from: "svc-b",
          to: "ghost",
          callCount: 1,
          errorCount: 0,
          avgDurationMs: 3,
        },
      ]);
      expect(response.runsOn).toEqual([
        {
          service: "svc-a",
          type: EntityType.KubernetesPod,
          active: 1,
          total: 2,
        },
        {
          service: "svc-b",
          type: EntityType.KubernetesPod,
          active: 0,
          total: 1,
        },
      ]);

      const statements: Array<RecordedStatement> = dataStatements(database);
      // Callees: the called keys that are not services, in code-unit order.
      const callees: RecordedStatement = statements.find(
        (statement: RecordedStatement): boolean => {
          return statement.sql.includes('"entityType" <> $');
        },
      )!;
      expect(callees.params).toContainEqual(["db-1", "ghost"]);
      // Calls and placements are read for the listed services.
      for (const pattern of ['r."callCount" AS "callCount"', 'AS "target"']) {
        const statement: RecordedStatement = statements.find(
          (candidate: RecordedStatement): boolean => {
            return candidate.sql.includes(pattern);
          },
        )!;
        expect(statement.params).toContainEqual(["svc-a", "svc-b"]);
        expect(statement.params[1]).toBe(RANGE_START.toISOString());
      }
      // Targets are looked up once each, sorted.
      const targets: RecordedStatement = statements.find(
        (statement: RecordedStatement): boolean => {
          return statement.sql.includes('"active" FROM "InventoryItem" i');
        },
      )!;
      expect(targets.params).toContainEqual(["gone", "pod-1", "pod-2"]);
    });

    test("the duplicated keys found up front reach every item statement", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Service, EntityType.Host]),
        duplicatesRule(["twin-b", "twin-a"]),
        ['"entityType" <> $', rows([])],
        ["jsonb_object_agg", rows([{ key: "svc-a", type: "service" }])],
        [
          'r."callCount" AS "callCount"',
          rows([{ from: "svc-a", to: "host-1" }]),
        ],
        ['AS "target"', rows([{ service: "svc-a", target: "host-1" }])],
        ['"active" FROM "InventoryItem" i', rows([])],
      ]);
      await TopologyQueries.getServiceMap(scope());
      const itemStatements: Array<RecordedStatement> = dataStatements(
        database,
      ).filter((statement: RecordedStatement): boolean => {
        return (
          statement.sql.includes('FROM "InventoryItem" i') &&
          !statement.sql.includes("project_types") &&
          !statement.sql.includes("HAVING")
        );
      });
      expect(itemStatements).toHaveLength(3);
      for (const statement of itemStatements) {
        expect(statement.sql).toContain(
          'NOT EXISTS (SELECT 1 FROM "InventoryItem" dup',
        );
        expect(statement.params).toContainEqual(["twin-a", "twin-b"]);
      }
    });

    test("over the caps: the first rows and exact totals", async () => {
      const entityCap: number = TopologyApiLimits.MaxServiceMapEntities;
      const dependencyCap: number = TopologyApiLimits.MaxServiceMapDependencies;
      TopologyApiLimits.MaxServiceMapEntities = 2;
      TopologyApiLimits.MaxServiceMapDependencies = 1;
      try {
        const database: FakeDatabase = useDatabase([
          typesRule([EntityType.Service]),
          duplicatesRule(),
          [
            'SELECT COUNT(*)::int AS "total" FROM "InventoryItemRelationship"',
            rows([{ total: "40" }]),
          ],
          [
            'SELECT COUNT(*)::int AS "total" FROM "InventoryItem"',
            rows([{ total: 9 }]),
          ],
          [
            "jsonb_object_agg",
            rows([
              { key: "svc-a", type: "service" },
              { key: "svc-b", type: "service" },
              { key: "svc-c", type: "service" },
            ]),
          ],
          [
            'r."callCount" AS "callCount"',
            rows([
              { from: "svc-a", to: "svc-b" },
              { from: "svc-a", to: "svc-z" },
            ]),
          ],
          ['AS "target"', rows([])],
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(
          response.entities.map(
            (entity: TopologyServiceMapEntityJSON): string => {
              return entity.key;
            },
          ),
        ).toEqual(["svc-a", "svc-b"]);
        expect(response.entityTruncation).toEqual({ shown: 2, total: 9 });
        expect(response.dependencies).toHaveLength(1);
        expect(response.dependencyTruncation).toEqual({ shown: 1, total: 40 });
        // Row statements ask for one more than the cap.
        const serviceRows: RecordedStatement = dataStatements(database).find(
          (statement: RecordedStatement): boolean => {
            return statement.sql.includes("jsonb_object_agg");
          },
        )!;
        expect(serviceRows.params[serviceRows.params.length - 1]).toBe(3);
        // Every call went to a listed service: no callee lookup was needed.
        expect(
          dataStatements(database).some((statement: RecordedStatement) => {
            return statement.sql.includes('"entityType" <> $');
          }),
        ).toBe(false);
      } finally {
        TopologyApiLimits.MaxServiceMapEntities = entityCap;
        TopologyApiLimits.MaxServiceMapDependencies = dependencyCap;
      }
    });
  });

  describe("infrastructure", () => {
    function nodeRow(
      key: string,
      type: string,
      extra: JSONObject = {},
    ): JSONObject {
      return {
        key,
        type,
        name: key,
        source: "discovered",
        lastSeenAt: 1790000000000,
        active: true,
        parent: null,
        parentVia: null,
        parentInactive: false,
        activeParent: null,
        activeParentVia: null,
        ...extra,
      };
    }

    test("collections, nodes with container indexes, services, placements and totals", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([
          EntityType.Service,
          EntityType.ServiceInstance,
          EntityType.KubernetesPod,
          EntityType.KubernetesNamespace,
          EntityType.NetworkDevice,
          EntityType.IoTDevice,
        ]),
        duplicatesRule(),
        [
          'GROUP BY i."entityType"',
          rows([
            {
              type: EntityType.IoTDevice,
              total: TopologyApiLimits.InlineFlatItemsPerType,
              active: 3,
              lastSeenAt: 1,
              activeLastSeenAt: 1,
            },
            { type: EntityType.KubernetesNamespace, total: 2, active: 1 },
            {
              type: EntityType.KubernetesPod,
              total: TopologyApiLimits.InlineFlatItemsPerType + 50,
              active: 2,
            },
            {
              type: EntityType.NetworkDevice,
              total: String(TopologyApiLimits.InlineFlatItemsPerType + 1),
              active: "7",
              lastSeenAt: 1790000000999,
              activeLastSeenAt: null,
            },
          ]),
        ],
        [
          "candidates AS MATERIALIZED",
          rows([
            nodeRow("ns-a", EntityType.KubernetesNamespace),
            nodeRow("ns-old", EntityType.KubernetesNamespace, {
              active: false,
            }),
            nodeRow("pod-1", EntityType.KubernetesPod, {
              parent: "ns-a",
              parentVia: "part-of",
            }),
            nodeRow("pod-2", EntityType.KubernetesPod, {
              parent: "ns-old",
              parentVia: "part-of",
              parentInactive: true,
              activeParent: "ns-a",
              activeParentVia: "member-of",
            }),
            nodeRow("pod-3", EntityType.KubernetesPod, {
              parent: "ns-old",
              parentVia: "part-of",
              parentInactive: "t",
              activeParent: null,
            }),
            nodeRow("pod-4", EntityType.KubernetesPod, {
              parent: "not-shipped",
              parentVia: "part-of",
            }),
          ]),
        ],
        [
          'i."displayName" AS "name" FROM',
          rows([
            { key: "svc-a", name: "A" },
            { key: "svc-b", name: null },
          ]),
        ],
        [
          'AS "target"',
          rows([
            { service: "svc-b", target: "pod-1" },
            { service: "svc-a", target: "pod-2" },
            { service: "svc-a", target: "pod-1" },
            { service: "svc-a", target: "switch-1" },
            { service: "svc-z", target: "pod-1" },
          ]),
        ],
        [
          'r."callCount" AS "callCount"',
          rows([
            {
              from: "svc-b",
              to: "svc-a",
              callCount: "12",
              errorCount: 0,
              avgDurationMs: null,
            },
            {
              from: "svc-a",
              to: "svc-b",
              callCount: 1200,
              errorCount: "6",
              avgDurationMs: "45.5",
            },
          ]),
        ],
      ]);

      const response: TopologyInfrastructureResponseJSON =
        await TopologyQueries.getInfrastructure(scope());

      expect(response.collections).toEqual([
        {
          type: EntityType.NetworkDevice,
          total: TopologyApiLimits.InlineFlatItemsPerType + 1,
          active: 7,
          lastSeenAt: 1790000000999,
          activeLastSeenAt: null,
        },
      ]);
      expect(response.nodes).toEqual([
        {
          key: "ns-a",
          type: EntityType.KubernetesNamespace,
          name: "ns-a",
          source: "discovered",
          lastSeenAt: 1790000000000,
        },
        {
          key: "ns-old",
          type: EntityType.KubernetesNamespace,
          name: "ns-old",
          source: "discovered",
          lastSeenAt: 1790000000000,
        },
        {
          key: "pod-1",
          type: EntityType.KubernetesPod,
          name: "pod-1",
          source: "discovered",
          lastSeenAt: 1790000000000,
          parent: 0,
          parentVia: "part-of",
        },
        {
          key: "pod-2",
          type: EntityType.KubernetesPod,
          name: "pod-2",
          source: "discovered",
          lastSeenAt: 1790000000000,
          parent: 1,
          parentVia: "part-of",
          activeParent: 0,
          activeParentVia: "member-of",
        },
        {
          key: "pod-3",
          type: EntityType.KubernetesPod,
          name: "pod-3",
          source: "discovered",
          lastSeenAt: 1790000000000,
          parent: 1,
          parentVia: "part-of",
          activeParent: -1,
        },
        {
          key: "pod-4",
          type: EntityType.KubernetesPod,
          name: "pod-4",
          source: "discovered",
          lastSeenAt: 1790000000000,
        },
      ]);
      expect(response.services).toEqual([
        { key: "svc-a", name: "A" },
        { key: "svc-b", name: null },
      ]);
      // Onto shipped nodes only, from listed services only, sorted.
      expect(response.placements).toEqual([
        [0, 2],
        [0, 3],
        [1, 2],
      ]);
      // Calls between the placed services, by index, sorted by (from, to).
      expect(response.dependencies).toEqual([
        {
          from: 0,
          to: 1,
          callCount: 1200,
          errorCount: 6,
          avgDurationMs: 45.5,
        },
        { from: 1, to: 0, callCount: 12, errorCount: 0, avgDurationMs: null },
      ]);
      expect(response.dependencyTruncation).toBeNull();
      const calls: RecordedStatement = dataStatements(database).find(
        (statement: RecordedStatement): boolean => {
          return statement.sql.includes('r."callCount" AS "callCount"');
        },
      )!;
      // Callers and callees are both the placed services, in key order.
      expect(calls.params[3]).toEqual(["svc-a", "svc-b"]);
      expect(calls.params[4]).toEqual(["svc-a", "svc-b"]);
      expect(calls.params[calls.params.length - 1]).toBe(
        TopologyApiLimits.MaxServiceMapDependencies + 1,
      );
      expect(response.totals).toEqual({
        resources: 6 + TopologyApiLimits.InlineFlatItemsPerType + 1,
        activeResources: 5 + 7,
      });
      expect(response.truncation).toBeNull();

      // Only infrastructure types are counted; only uncollected ones listed.
      const counts: RecordedStatement = dataStatements(database).find(
        (statement: RecordedStatement): boolean => {
          return statement.sql.includes('GROUP BY i."entityType"');
        },
      )!;
      expect(counts.params).toContainEqual([
        EntityType.KubernetesPod,
        EntityType.KubernetesNamespace,
        EntityType.NetworkDevice,
        EntityType.IoTDevice,
      ]);
      const nodes: RecordedStatement = dataStatements(database).find(
        (statement: RecordedStatement): boolean => {
          return statement.sql.includes("candidates AS MATERIALIZED");
        },
      )!;
      expect(nodes.params).toContainEqual([
        EntityType.KubernetesPod,
        EntityType.KubernetesNamespace,
        EntityType.IoTDevice,
      ]);
      expect(nodes.params).toContainEqual(NESTING_RELATIONSHIP_RANKS.ranks);
      expect(nodes.params).toContainEqual(CONTAINER_SPECIFICITY_RANKS.ranks);
      expect(nodes.params[nodes.params.length - 1]).toBe(
        TopologyApiLimits.MaxInfrastructureNodes + 1,
      );
    });

    test("over the node cap: exact totals from a count, truncation reported", async () => {
      const cap: number = TopologyApiLimits.MaxInfrastructureNodes;
      TopologyApiLimits.MaxInfrastructureNodes = 2;
      try {
        useDatabase([
          typesRule([EntityType.Host]),
          duplicatesRule(),
          [
            'GROUP BY i."entityType"',
            rows([{ type: "host", total: 5, active: 3 }]),
          ],
          [
            "candidates AS MATERIALIZED",
            rows([
              nodeRow("h-1", EntityType.Host),
              nodeRow("h-2", EntityType.Host, { parent: "h-3" }),
              nodeRow("h-3", EntityType.Host),
            ]),
          ],
          [
            'COUNT(*) FILTER (WHERE n."active")',
            rows([{ total: "5", active: "3" }]),
          ],
        ]);
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        expect(
          response.nodes.map((node: TopologyInfrastructureNodeJSON): string => {
            return node.key;
          }),
        ).toEqual(["h-1", "h-2"]);
        // h-2's container was not shipped, so it has none.
        expect(response.nodes[1]!.parent).toBeUndefined();
        expect(response.truncation).toEqual({ shown: 2, total: 5 });
        expect(response.totals).toEqual({ resources: 5, activeResources: 3 });
        expect(response.services).toEqual([]);
      } finally {
        TopologyApiLimits.MaxInfrastructureNodes = cap;
      }
    });

    /*
     * Issue #3972: the map draws the traffic between resources from the calls
     * between the services placed on them.
     */
    describe("calls between placed services", () => {
      function tracedDatabase(
        placements: Array<JSONObject>,
        calls: Array<JSONObject>,
        extra: Array<[string, Responder]> = [],
      ): FakeDatabase {
        return useDatabase([
          typesRule([EntityType.Service, EntityType.KubernetesPod]),
          duplicatesRule(),
          ...extra,
          [
            'GROUP BY i."entityType"',
            rows([{ type: EntityType.KubernetesPod, total: 3, active: 3 }]),
          ],
          [
            "candidates AS MATERIALIZED",
            rows([
              nodeRow("pod-a", EntityType.KubernetesPod),
              nodeRow("pod-b", EntityType.KubernetesPod),
              nodeRow("pod-c", EntityType.KubernetesPod),
            ]),
          ],
          [
            'i."displayName" AS "name" FROM',
            rows([
              { key: "svc-a", name: "a" },
              { key: "svc-b", name: "b" },
              { key: "svc-c", name: "c" },
              { key: "svc-idle", name: "idle" },
            ]),
          ],
          ['AS "target"', rows(placements)],
          ['r."callCount" AS "callCount"', rows(calls)],
        ]);
      }

      function callStatements(
        database: FakeDatabase,
      ): Array<RecordedStatement> {
        return dataStatements(database).filter(
          (statement: RecordedStatement): boolean => {
            return (
              statement.sql.includes(
                'FROM "InventoryItemRelationship" r WHERE',
              ) && statement.sql.includes('r."toEntityKey" = ANY(')
            );
          },
        );
      }

      test("only services placed on a shipped node are asked about, as callers and callees", async () => {
        const database: FakeDatabase = tracedDatabase(
          [
            { service: "svc-c", target: "pod-c" },
            { service: "svc-a", target: "pod-a" },
            { service: "svc-a", target: "pod-b" },
            /* Placed only on something that was not shipped. */
            { service: "svc-b", target: "switch-9" },
          ],
          [{ from: "svc-a", to: "svc-c", callCount: 3 }],
        );
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        const [statement] = callStatements(database);
        expect(statement!.params[3]).toEqual(["svc-a", "svc-c"]);
        expect(statement!.params[4]).toEqual(["svc-a", "svc-c"]);
        expect(response.dependencies).toEqual([
          {
            from: 0,
            to: 2,
            callCount: 3,
            errorCount: null,
            avgDurationMs: null,
          },
        ]);
      });

      test("fewer than two placed services cannot call each other: nothing is read", async () => {
        const database: FakeDatabase = tracedDatabase(
          [
            { service: "svc-a", target: "pod-a" },
            { service: "svc-a", target: "pod-b" },
          ],
          [],
        );
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        expect(callStatements(database)).toEqual([]);
        expect(response.dependencies).toEqual([]);
        expect(response.dependencyTruncation).toBeNull();
      });

      test("rows naming an unknown service or calling themselves are dropped", async () => {
        tracedDatabase(
          [
            { service: "svc-a", target: "pod-a" },
            { service: "svc-b", target: "pod-b" },
          ],
          [
            { from: "svc-a", to: "svc-a", callCount: 1 },
            { from: "svc-a", to: "svc-gone", callCount: 1 },
            { from: "svc-gone", to: "svc-b", callCount: 1 },
            { from: "svc-b", to: "svc-a", callCount: 2, errorCount: 1 },
          ],
        );
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        expect(response.dependencies).toEqual([
          { from: 1, to: 0, callCount: 2, errorCount: 1, avgDurationMs: null },
        ]);
      });

      test("over the call cap: the first calls and the exact total", async () => {
        const cap: number = TopologyApiLimits.MaxServiceMapDependencies;
        TopologyApiLimits.MaxServiceMapDependencies = 1;
        try {
          const database: FakeDatabase = tracedDatabase(
            [
              { service: "svc-a", target: "pod-a" },
              { service: "svc-b", target: "pod-b" },
              { service: "svc-c", target: "pod-c" },
            ],
            [
              { from: "svc-c", to: "svc-a", callCount: 9 },
              { from: "svc-a", to: "svc-b", callCount: 5 },
            ],
            [
              [
                'SELECT COUNT(*)::int AS "total" FROM "InventoryItemRelationship"',
                rows([{ total: "17" }]),
              ],
            ],
          );
          const response: TopologyInfrastructureResponseJSON =
            await TopologyQueries.getInfrastructure(scope());
          /* The first row in the Service Map's order is the one kept. */
          expect(response.dependencies).toEqual([
            {
              from: 2,
              to: 0,
              callCount: 9,
              errorCount: null,
              avgDurationMs: null,
            },
          ]);
          expect(response.dependencyTruncation).toEqual({
            shown: 1,
            total: 17,
          });
          const counted: RecordedStatement = dataStatements(database).find(
            (statement: RecordedStatement): boolean => {
              return statement.sql.startsWith(
                'SELECT COUNT(*)::int AS "total" FROM "InventoryItemRelationship"',
              );
            },
          )!;
          expect(counted.params[4]).toEqual(["svc-a", "svc-b", "svc-c"]);
        } finally {
          TopologyApiLimits.MaxServiceMapDependencies = cap;
        }
      });
    });

    test("only collections and no services: no node, service or duplicate reads", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.NetworkDevice]),
        [
          'GROUP BY i."entityType"',
          rows([{ type: EntityType.NetworkDevice, total: 79_600, active: 1 }]),
        ],
      ]);
      const response: TopologyInfrastructureResponseJSON =
        await TopologyQueries.getInfrastructure(scope());
      expect(dataStatements(database)).toHaveLength(2);
      expect(response.nodes).toEqual([]);
      expect(response.totals).toEqual({
        resources: 79_600,
        activeResources: 1,
      });
    });
  });

  describe("collections", () => {
    test("a page: total, items and the next cursor from the extra row", async () => {
      const database: FakeDatabase = useDatabase([
        ['SELECT COUNT(*)::int AS "total"', rows([{ total: "3" }])],
        [
          "ORDER BY COALESCE",
          rows([
            {
              key: "k-1",
              type: "network.device",
              name: null,
              source: "discovered",
              lastSeenAt: null,
            },
            {
              key: "k-2",
              type: "network.device",
              name: "b",
              source: "discovered",
              lastSeenAt: 5,
            },
            {
              key: "k-3",
              type: "network.device",
              name: "c",
              source: "discovered",
              lastSeenAt: 6,
            },
          ]),
        ],
      ]);
      const page: TopologyCollectionResponseJSON =
        await TopologyQueries.getCollectionPage({
          ...scope(),
          entityType: EntityType.NetworkDevice,
          includeInactive: true,
          nameTerms: [],
          cursor: null,
          limit: 2,
        });
      expect(page.total).toBe(3);
      expect(
        page.items.map((item: TopologyEntityJSON): string => {
          return item.key;
        }),
      ).toEqual(["k-1", "k-2"]);
      expect(page.nextCursor).toEqual({ name: "b", key: "k-2" });
      expect(page.entityType).toBe(EntityType.NetworkDevice);
      const pageStatement: RecordedStatement = dataStatements(database)[1]!;
      expect(pageStatement.params[pageStatement.params.length - 1]).toBe(3);
    });

    test("an unnamed last row continues from the empty name", async () => {
      useDatabase([
        ['SELECT COUNT(*)::int AS "total"', rows([{ total: 2 }])],
        [
          "ORDER BY COALESCE",
          rows([
            { key: "k-1", type: "network.device", name: null },
            { key: "k-2", type: "network.device", name: null },
          ]),
        ],
      ]);
      const page: TopologyCollectionResponseJSON =
        await TopologyQueries.getCollectionPage({
          ...scope(),
          entityType: EntityType.NetworkDevice,
          includeInactive: true,
          nameTerms: [],
          cursor: null,
          limit: 1,
        });
      expect(page.nextCursor).toEqual({ name: "", key: "k-1" });
    });

    test("the last page has no cursor", async () => {
      useDatabase([
        ['SELECT COUNT(*)::int AS "total"', rows([{ total: 1 }])],
        ["ORDER BY COALESCE", rows([{ key: "k-1", type: "network.device" }])],
      ]);
      const page: TopologyCollectionResponseJSON =
        await TopologyQueries.getCollectionPage({
          ...scope(),
          entityType: EntityType.NetworkDevice,
          includeInactive: false,
          nameTerms: ["core"],
          cursor: { name: "a", key: "k-0" },
          limit: 50,
        });
      expect(page.nextCursor).toBeNull();
    });

    test("search: no types, no read; otherwise matches in request order, zero counts dropped", async () => {
      const none: FakeDatabase = useDatabase([]);
      const empty: TopologyCollectionSearchResponseJSON =
        await TopologyQueries.getCollectionSearch({
          ...scope(),
          includeInactive: true,
          types: [],
        });
      expect(empty.matches).toEqual([]);
      expect(none.statements).toEqual([]);

      useDatabase([
        [
          "UNION ALL",
          rows([
            { entityType: EntityType.NetworkDevice, count: "12" },
            { entityType: EntityType.IoTDevice, count: 0 },
            { entityType: EntityType.CloudResource, count: 4 },
          ]),
        ],
      ]);
      const response: TopologyCollectionSearchResponseJSON =
        await TopologyQueries.getCollectionSearch({
          ...scope(),
          includeInactive: true,
          types: [
            { entityType: EntityType.CloudResource, nameTerms: ["a"] },
            { entityType: EntityType.IoTDevice, nameTerms: ["a"] },
            { entityType: EntityType.NetworkDevice, nameTerms: ["a"] },
          ],
        });
      expect(response.matches).toEqual([
        { entityType: EntityType.CloudResource, count: 4 },
        { entityType: EntityType.NetworkDevice, count: 12 },
      ]);
    });
  });

  describe("the drawer", () => {
    const entityRow: JSONObject = {
      id: "0b9c0d4e-0000-4000-8000-000000000001",
      key: "svc-a",
      type: EntityType.Service,
      name: "checkout",
      source: "discovered",
      lastSeenAt: 1790000000000,
      firstSeenAt: 1780000000000,
      resourceType: "Service",
      resourceId: null,
      identifyingAttributes: { "service.name": "checkout" },
      descriptiveAttributes: [],
    };

    function sectionsRow(scanned: number): JSONObject {
      return {
        scanned,
        sections: [
          { section: "calls", total: 3, unknownTotal: 1 },
          { section: "runsOn", total: 1, unknownTotal: 0 },
          { section: "bogus", total: 9, unknownTotal: 9 },
        ],
        rows: [
          {
            section: "calls",
            relationshipType: "depends-on",
            direction: "out",
            otherKey: "db-1",
            otherKnown: true,
            otherName: "orders",
            otherType: "database",
            callCount: 10,
            errorCount: null,
            avgDurationMs: 2,
            lastSeenAt: 1790000000000,
          },
          {
            section: "calls",
            relationshipType: "depends-on",
            direction: "out",
            otherKey: "ghost",
            otherKnown: false,
            otherName: null,
            otherType: null,
            callCount: null,
            errorCount: null,
            avgDurationMs: null,
            lastSeenAt: null,
          },
          {
            section: "runsOn",
            relationshipType: "runs-on",
            direction: "out",
            otherKey: "pod-1",
            otherKnown: true,
            otherName: "pod",
            otherType: "k8s.pod",
            callCount: null,
            errorCount: null,
            avgDurationMs: null,
            lastSeenAt: 1,
          },
        ],
      };
    }

    test("the entity and its sections", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Service]),
        ["LIMIT 1", rows([entityRow])],
        ["scan_out AS MATERIALIZED", rows([sectionsRow(5)])],
      ]);
      const response: TopologyEntityResponseJSON =
        await TopologyQueries.getEntity({
          ...scope(),
          entityKey: "svc-a",
          entityType: null,
        });

      expect(response.entity).toEqual({
        id: "0b9c0d4e-0000-4000-8000-000000000001",
        key: "svc-a",
        type: EntityType.Service,
        name: "checkout",
        source: "discovered",
        lastSeenAt: 1790000000000,
        firstSeenAt: 1780000000000,
        resourceType: "Service",
        resourceId: null,
        identifyingAttributes: { "service.name": "checkout" },
        descriptiveAttributes: null,
      });
      expect(response.isScanLimited).toBe(false);
      expect(response.sections.calls.total).toBe(3);
      expect(response.sections.calls.unknownTotal).toBe(1);
      expect(response.sections.calls.rows).toHaveLength(2);
      expect(response.sections.calls.rows[0]).not.toHaveProperty("section");
      expect(response.sections.calls.nextOffset).toBe(2);
      expect(response.sections.runsOn.nextOffset).toBeNull();
      expect(response.sections.calledBy).toEqual({
        total: 0,
        unknownTotal: 0,
        rows: [],
        nextOffset: null,
      });

      const sections: RecordedStatement = dataStatements(database)[2]!;
      // A service: outbound runs-on / hosted-on are its runsOn section.
      expect(sections.params).toContain(true);
      expect(sections.params).toContain(
        TopologyApiLimits.EntityConnectionScanLimit + 1,
      );
      expect(sections.params).toContain(TopologyApiLimits.EntityDependencyRows);
      expect(sections.params).toContain(TopologyApiLimits.EntityOtherRows);
    });

    test("more relationships than the scan limit: totals are lower bounds", async () => {
      useDatabase([
        typesRule([EntityType.Service]),
        ["LIMIT 1", rows([{ ...entityRow, type: EntityType.KubernetesNode }])],
        [
          "scan_out AS MATERIALIZED",
          rows([sectionsRow(TopologyApiLimits.EntityConnectionScanLimit + 1)]),
        ],
      ]);
      const response: TopologyEntityResponseJSON =
        await TopologyQueries.getEntity({
          ...scope(),
          entityKey: "node-1",
          entityType: EntityType.KubernetesNode,
        });
      expect(response.isScanLimited).toBe(true);
    });

    test("not found: no sections are read", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Service]),
        ["LIMIT 1", rows([])],
      ]);
      const response: TopologyEntityResponseJSON =
        await TopologyQueries.getEntity({
          ...scope(),
          entityKey: "nope",
          entityType: "k8s.pod",
        });
      expect(response.entity).toBeNull();
      expect(response.sections.related.total).toBe(0);
      expect(dataStatements(database)).toHaveLength(2);
      expect(dataStatements(database)[1]!.params).toEqual([
        PROJECT_ID.toString(),
        [EntityType.Service],
        "nope",
        "k8s.pod",
      ]);
    });

    test("an empty project: nothing past the type list", async () => {
      const database: FakeDatabase = useDatabase([typesRule([])]);
      const response: TopologyEntityResponseJSON =
        await TopologyQueries.getEntity({
          ...scope(),
          entityKey: "svc-a",
          entityType: null,
        });
      expect(response.entity).toBeNull();
      expect(dataStatements(database)).toHaveLength(1);
    });

    test("show more: one section's page, offsets continue from the request's", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Service]),
        ["LIMIT 1", rows([entityRow])],
        ["scan_out AS MATERIALIZED", rows([sectionsRow(5)])],
      ]);
      const response: TopologyEntityConnectionsResponseJSON =
        await TopologyQueries.getEntityConnections({
          ...scope(),
          entityKey: "svc-a",
          entityType: null,
          section: "calls",
          offset: 0,
          limit: 2,
        });
      expect(response.section).toBe("calls");
      expect(response.connections.rows).toHaveLength(2);
      expect(response.connections.nextOffset).toBe(2);
      const sections: RecordedStatement = dataStatements(database)[2]!;
      expect(sections.params.slice(-3)).toEqual([0, "calls", 2]);

      useDatabase([
        typesRule([EntityType.Service]),
        ["LIMIT 1", rows([entityRow])],
        ["scan_out AS MATERIALIZED", rows([sectionsRow(5)])],
      ]);
      const later: TopologyEntityConnectionsResponseJSON =
        await TopologyQueries.getEntityConnections({
          ...scope(),
          entityKey: "svc-a",
          entityType: null,
          section: "calls",
          offset: 1,
          limit: 2,
        });
      // 1 + 2 rows reaches the total of 3.
      expect(later.connections.nextOffset).toBeNull();
    });
  });
  /*
   * The inventory item page: the drawer's reads with no range, archived
   * items found, and the other end's id on every row.
   */
  describe("all time", () => {
    const entityRow: JSONObject = {
      id: "0b9c0d4e-0000-4000-8000-000000000002",
      key: "ns-a",
      type: EntityType.KubernetesNamespace,
      name: "payments",
      source: "discovered",
      lastSeenAt: null,
      firstSeenAt: null,
      resourceType: null,
      resourceId: null,
      identifyingAttributes: null,
      descriptiveAttributes: null,
    };

    const sectionsRow: JSONObject = {
      scanned: 3,
      sections: [{ section: "related", total: 3, unknownTotal: 1 }],
      rows: [
        {
          section: "related",
          relationshipType: "part-of",
          direction: "in",
          otherKey: "pod-1",
          otherKnown: true,
          otherId: "0b9c0d4e-0000-4000-8000-000000000003",
          otherName: "api-7d9f",
          otherType: "k8s.pod",
          callCount: null,
          errorCount: null,
          avgDurationMs: null,
          lastSeenAt: 1790000000000,
        },
        {
          section: "related",
          relationshipType: "part-of",
          direction: "out",
          otherKey: "gone",
          otherKnown: false,
          otherId: null,
          otherName: null,
          otherType: null,
          callCount: null,
          errorCount: null,
          avgDurationMs: null,
          lastSeenAt: null,
        },
      ],
    };

    function allTimeDatabase(): FakeDatabase {
      return useDatabase([
        typesRule([EntityType.KubernetesNamespace, EntityType.KubernetesPod]),
        ["LIMIT 1", rows([entityRow])],
        ["scan_out AS MATERIALIZED", rows([sectionsRow])],
      ]);
    }

    test("the entity and its sections: no range read or echoed, other ends carry their ids", async () => {
      const database: FakeDatabase = allTimeDatabase();
      const response: TopologyEntityAllTimeResponseJSON =
        await TopologyQueries.getEntityAllTime({
          projectId: PROJECT_ID,
          entityKey: "ns-a",
          entityType: EntityType.KubernetesNamespace,
        });

      expect(response.formatVersion).toBe(TOPOLOGY_API_FORMAT_VERSION);
      expect(response).not.toHaveProperty("rangeStart");
      expect(Number.isNaN(Date.parse(response.generatedAt))).toBe(false);
      expect(response.entity).toMatchObject({
        id: "0b9c0d4e-0000-4000-8000-000000000002",
        key: "ns-a",
      });
      expect(response.isScanLimited).toBe(false);
      expect(response.sections.related.total).toBe(3);
      expect(response.sections.related.unknownTotal).toBe(1);
      expect(response.sections.related.nextOffset).toBe(2);
      expect(response.sections.related.rows[0]).toEqual({
        relationshipType: "part-of",
        direction: "in",
        otherKey: "pod-1",
        otherKnown: true,
        otherId: "0b9c0d4e-0000-4000-8000-000000000003",
        otherName: "api-7d9f",
        otherType: "k8s.pod",
        callCount: null,
        errorCount: null,
        avgDurationMs: null,
        lastSeenAt: 1790000000000,
      });
      expect(response.sections.related.rows[1]!.otherId).toBeNull();

      const [types, entity, sections] = dataStatements(database);
      expect(types!.sql).toContain("project_types");
      // Archived items are found, so nothing filters them out.
      expect(entity!.sql).not.toContain(`"isArchived" = false`);
      expect(entity!.sql).toContain(`i."isArchived" ASC`);
      expect(sections!.sql).not.toContain(`"lastSeenAt" >=`);
      expect(sections!.sql).toContain(`o."id" AS "otherId"`);
      // Not a service: its outbound runs-on is not a runsOn section.
      expect(sections!.params).toContain(false);
      expect(sections!.params).toContain(
        TopologyApiLimits.EntityConnectionScanLimit + 1,
      );
      for (const statement of [types!, entity!, sections!]) {
        expect(statement.params[0]).toBe(PROJECT_ID.toString());
      }
    });

    test("the drawer's rows never gain an id", async () => {
      const drawerRows: Array<JSONObject> = (
        sectionsRow["rows"] as Array<JSONObject>
      ).map((row: JSONObject): JSONObject => {
        const rest: JSONObject = { ...row };
        delete rest["otherId"];
        return rest;
      });
      useDatabase([
        typesRule([EntityType.KubernetesNamespace]),
        ["LIMIT 1", rows([entityRow])],
        [
          "scan_out AS MATERIALIZED",
          (sql: string): Array<JSONObject> => {
            expect(sql).not.toContain("otherId");
            return [{ ...sectionsRow, rows: drawerRows }];
          },
        ],
      ]);
      const response: TopologyEntityResponseJSON =
        await TopologyQueries.getEntity({
          ...scope(),
          entityKey: "ns-a",
          entityType: null,
        });
      expect(response.rangeStart).toBe(RANGE_START.toISOString());
      expect(response.sections.related.rows).toHaveLength(2);
      for (const row of response.sections.related.rows) {
        expect(row).not.toHaveProperty("otherId");
      }
    });

    test("not found: no sections are read", async () => {
      const database: FakeDatabase = useDatabase([
        typesRule([EntityType.Service]),
        ["LIMIT 1", rows([])],
      ]);
      const response: TopologyEntityAllTimeResponseJSON =
        await TopologyQueries.getEntityAllTime({
          projectId: PROJECT_ID,
          entityKey: "nope",
          entityType: null,
        });
      expect(response.entity).toBeNull();
      expect(response.sections.related).toEqual({
        total: 0,
        unknownTotal: 0,
        rows: [],
        nextOffset: null,
      });
      expect(dataStatements(database)).toHaveLength(2);
    });

    test("show more: one section's page, from the request's offset, with no range", async () => {
      const database: FakeDatabase = allTimeDatabase();
      const response: TopologyEntityAllTimeConnectionsResponseJSON =
        await TopologyQueries.getEntityAllTimeConnections({
          projectId: PROJECT_ID,
          entityKey: "ns-a",
          entityType: null,
          section: "related",
          offset: 1,
          limit: 2,
        });
      expect(response).not.toHaveProperty("rangeStart");
      expect(response.section).toBe("related");
      expect(response.connections.total).toBe(3);
      expect(
        response.connections.rows.map(
          (row: TopologyConnectionRowJSON): string | null | undefined => {
            return row.otherId;
          },
        ),
      ).toEqual(["0b9c0d4e-0000-4000-8000-000000000003", null]);
      // 1 + 2 rows reaches the total of 3.
      expect(response.connections.nextOffset).toBeNull();
      const sections: RecordedStatement = dataStatements(database)[2]!;
      expect(sections.params.slice(-3)).toEqual([1, "related", 2]);
    });

    test("more relationships than the scan limit: totals are lower bounds", async () => {
      useDatabase([
        typesRule([EntityType.KubernetesNamespace]),
        ["LIMIT 1", rows([entityRow])],
        [
          "scan_out AS MATERIALIZED",
          rows([
            {
              ...sectionsRow,
              scanned: TopologyApiLimits.EntityConnectionScanLimit + 1,
            },
          ]),
        ],
      ]);
      const response: TopologyEntityAllTimeResponseJSON =
        await TopologyQueries.getEntityAllTime({
          projectId: PROJECT_ID,
          entityKey: "ns-a",
          entityType: null,
        });
      expect(response.isScanLimited).toBe(true);
    });
  });
});
