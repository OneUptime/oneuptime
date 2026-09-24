import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import ObjectID from "Common/Types/ObjectID";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import { EntityRelationshipEdge } from "Common/Utils/Telemetry/EntityRelationship";
import {
  computeEntityKey,
  keyForService,
} from "Common/Utils/Telemetry/EntityKey";
import {
  DATABASE_ENDPOINT_SQL_MARKER,
  DATABASE_SERVER_MIN_CALLS_ENV,
} from "Common/Server/Utils/Telemetry/DatabaseEndpointDiscovery";

/*
 * "TelemetryEntity:ComputeServiceDependencies" turns the recent telemetry window
 * into the Service Map's edges. These tests drive a whole run against mocked
 * ClickHouse and Postgres and pin what ends up in the registry: which edges,
 * which dependency rows, which source wins when two saw the same call, and
 * that one failing source or project never costs the others their edges.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/SpanService", () => {
  return { __esModule: true, default: { executeQuery: jest.fn() } };
});
jest.mock("Common/Server/Services/MetricService", () => {
  return { __esModule: true, default: { executeQuery: jest.fn() } };
});
jest.mock("Common/Server/Services/ServiceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/InventoryItemService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), reconcileEntities: jest.fn() },
  };
});
jest.mock("Common/Server/Services/InventoryItemRelationshipService", () => {
  return {
    __esModule: true,
    default: { reconcileRelationships: jest.fn() },
  };
});
jest.mock("Common/Server/Services/DatabaseServerService", () => {
  return {
    __esModule: true,
    default: {
      findOrCreateByEndpoint: jest.fn(),
      recordSighting: jest.fn(),
      isUnderAutoCreateBudget: jest.fn(),
    },
  };
});

import logger from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ServiceService from "Common/Server/Services/ServiceService";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "Common/Server/Services/InventoryItemRelationshipService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import {
  MAX_DATABASE_ENDPOINT_ROWS,
  computeDependenciesForProject,
  discoverDatabaseServersForProject,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies";

const JOB_NAME: string = "TelemetryEntity:ComputeServiceDependencies";

const PROJECT_ID: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";
const OTHER_PROJECT_ID: string = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";

const IDS: Record<string, string> = {
  dashboard: "11111111-1111-4111-8111-111111111111",
  api: "22222222-2222-4222-8222-222222222222",
  probe: "33333333-3333-4333-8333-333333333333",
  deleted: "44444444-4444-4444-8444-444444444444",
};

const spanMock: { executeQuery: jest.Mock } = SpanService as unknown as {
  executeQuery: jest.Mock;
};
const metricMock: { executeQuery: jest.Mock } = MetricService as unknown as {
  executeQuery: jest.Mock;
};
const serviceMock: { findBy: jest.Mock } = ServiceService as unknown as {
  findBy: jest.Mock;
};
const inventoryMock: { findBy: jest.Mock; reconcileEntities: jest.Mock } =
  InventoryItemService as unknown as {
    findBy: jest.Mock;
    reconcileEntities: jest.Mock;
  };
const relationshipMock: { reconcileRelationships: jest.Mock } =
  InventoryItemRelationshipService as unknown as {
    reconcileRelationships: jest.Mock;
  };
const databaseServerMock: {
  findOrCreateByEndpoint: jest.Mock;
  recordSighting: jest.Mock;
  isUnderAutoCreateBudget: jest.Mock;
} = DatabaseServerService as unknown as {
  findOrCreateByEndpoint: jest.Mock;
  recordSighting: jest.Mock;
  isUnderAutoCreateBudget: jest.Mock;
};

function rows(data: Array<unknown>): {
  json: () => Promise<{ data: Array<unknown> }>;
} {
  return {
    json: async () => {
      return { data };
    },
  };
}

interface Sources {
  projects?: Array<string>;
  metricProjects?: Array<string>;
  traced?: Array<unknown> | Error;
  clients?: Array<unknown> | Error;
  graph?: Array<unknown> | Error;
  // Rows of the database endpoint discovery query (routed by its marker).
  databases?: Array<unknown> | Error;
}

function arrange(sources: Sources): void {
  spanMock.executeQuery.mockImplementation(async (sql: string) => {
    if (sql.includes(DATABASE_ENDPOINT_SQL_MARKER)) {
      if (sources.databases instanceof Error) {
        throw sources.databases;
      }
      return rows(sources.databases || []);
    }
    if (sql.includes("SELECT DISTINCT projectId")) {
      return rows(
        (sources.projects || []).map((projectId: string) => {
          return { projectId };
        }),
      );
    }
    const result: Array<unknown> | Error | undefined = sql.includes("NOT IN")
      ? sources.clients
      : sources.traced;
    if (result instanceof Error) {
      throw result;
    }
    return rows(result || []);
  });
  metricMock.executeQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT DISTINCT projectId")) {
      return rows(
        (sources.metricProjects || []).map((projectId: string) => {
          return { projectId };
        }),
      );
    }
    if (sources.graph instanceof Error) {
      throw sources.graph;
    }
    return rows(sources.graph || []);
  });
}

const API_KEY: string = keyForService(PROJECT_ID, "api");
const DASHBOARD_KEY: string = keyForService(PROJECT_ID, "dashboard");
const PROBE_KEY: string = keyForService(PROJECT_ID, "probe");

function reconciledEdges(): Array<EntityRelationshipEdge> {
  return relationshipMock.reconcileRelationships.mock.calls.flatMap(
    (call: Array<unknown>) => {
      return (call[0] as { edges: Array<EntityRelationshipEdge> }).edges;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  serviceMock.findBy.mockResolvedValue([
    { _id: IDS["dashboard"], name: "dashboard" },
    { _id: IDS["api"], name: "api" },
    { _id: IDS["probe"], name: "Probe" },
  ]);
  inventoryMock.findBy.mockResolvedValue([
    { entityKey: API_KEY, displayName: "api" },
    { entityKey: DASHBOARD_KEY, displayName: "dashboard" },
    { entityKey: PROBE_KEY, displayName: "probe" },
  ]);
  inventoryMock.reconcileEntities.mockResolvedValue(undefined);
  relationshipMock.reconcileRelationships.mockResolvedValue(undefined);
  // Reset, not just cleared: a test below may swap an implementation.
  databaseServerMock.findOrCreateByEndpoint.mockReset();
  databaseServerMock.findOrCreateByEndpoint.mockResolvedValue(null);
  databaseServerMock.recordSighting.mockReset();
  databaseServerMock.recordSighting.mockResolvedValue(undefined);
  databaseServerMock.isUnderAutoCreateBudget.mockReset();
  databaseServerMock.isUnderAutoCreateBudget.mockResolvedValue(true);
});

const WINDOW: { projectId: string; startSql: string; endSql: string } = {
  projectId: PROJECT_ID,
  startSql: "toDateTime64('2026-09-07 09:45:00', 9)",
  endSql: "toDateTime64('2026-09-07 10:00:00', 9)",
};

describe("computeDependenciesForProject", () => {
  test("combines trace-linked calls, client spans and service graph metrics", async () => {
    arrange({
      traced: [
        {
          callerServiceId: IDS["probe"],
          calleeServiceId: IDS["api"],
          callCount: "900",
          errorCount: "9",
          avgDurationNano: "210000000",
        },
      ],
      clients: [
        {
          callerServiceId: IDS["api"],
          dbSystem: "postgresql",
          dbNamespace: "oneuptime",
          serverAddress: "postgres.oneuptime.svc.cluster.local:5432",
          callCount: "4000",
          errorCount: "0",
          avgDurationNano: "4000000",
        },
        {
          callerServiceId: IDS["api"],
          serverAddress: "hooks.slack.com",
          isHttp: "1",
          callCount: "30",
          errorCount: "1",
          avgDurationNano: "300000000",
        },
        {
          // A browser app whose calls the API did not answer with a span yet.
          callerServiceId: IDS["dashboard"],
          serverAddress: "api:3002",
          isHttp: "1",
          callCount: "500",
          errorCount: "2",
          avgDurationNano: "80000000",
        },
      ],
      graph: [
        // Same call the traces already measured: must not override them.
        { client: "probe", server: "api", requestCount: "5", failedCount: "5" },
        // A callee only eBPF saw.
        {
          client: "api",
          server: "10.4.0.9",
          requestCount: "12",
          failedCount: "0",
        },
        // A caller that is not a service does not belong on the map.
        {
          client: "10.4.0.10",
          server: "api",
          requestCount: "7",
          failedCount: "0",
        },
      ],
    });

    const count: number = await computeDependenciesForProject(WINDOW);

    const postgresKey: string = computeEntityKey({
      projectId: PROJECT_ID,
      entityType: EntityType.Database,
      identifyingAttributes: {
        "db.system.name": "postgresql",
        "server.address": "postgres.oneuptime.svc.cluster.local",
        "db.namespace": "oneuptime",
      },
    });
    const slackKey: string = computeEntityKey({
      projectId: PROJECT_ID,
      entityType: EntityType.RemoteService,
      identifyingAttributes: { "server.address": "hooks.slack.com" },
    });
    const ipKey: string = computeEntityKey({
      projectId: PROJECT_ID,
      entityType: EntityType.RemoteService,
      identifyingAttributes: { "server.address": "10.4.0.9" },
    });

    const edges: Array<EntityRelationshipEdge> = reconciledEdges();
    expect(count).toBe(5);
    expect(edges).toHaveLength(5);
    const byPair: Map<string, EntityRelationshipEdge> = new Map(
      edges.map((edge: EntityRelationshipEdge) => {
        return [`${edge.fromEntityKey}->${edge.toEntityKey}`, edge];
      }),
    );
    expect(byPair.get(`${PROBE_KEY}->${API_KEY}`)?.metrics).toEqual({
      callCount: 900,
      errorCount: 9,
      avgDurationMs: 210,
    });
    expect(byPair.get(`${API_KEY}->${postgresKey}`)?.metrics?.callCount).toBe(
      4000,
    );
    expect(byPair.get(`${API_KEY}->${slackKey}`)).toBeDefined();
    expect(byPair.get(`${DASHBOARD_KEY}->${API_KEY}`)?.metrics?.callCount).toBe(
      500,
    );
    expect(byPair.get(`${API_KEY}->${ipKey}`)?.metrics?.callCount).toBe(12);
    for (const edge of edges) {
      expect(edge.relationshipType).toBe(EntityRelationshipType.DependsOn);
    }

    // Dependency rows are registered for exactly the endpoints edges use.
    const registered: Array<{ entityType: EntityType; entityKey: string }> =
      inventoryMock.reconcileEntities.mock.calls[0][0].entities;
    expect(
      registered
        .map((entity: { entityKey: string }) => {
          return entity.entityKey;
        })
        .sort(),
    ).toEqual([postgresKey, slackKey, ipKey].sort());
    expect(
      inventoryMock.reconcileEntities.mock.invocationCallOrder[0],
    ).toBeLessThan(
      relationshipMock.reconcileRelationships.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("resolves service ids once, scoped to the project", async () => {
    arrange({
      traced: [
        {
          callerServiceId: IDS["probe"],
          calleeServiceId: IDS["api"],
          callCount: 1,
          errorCount: 0,
          avgDurationNano: 1,
        },
      ],
    });
    await computeDependenciesForProject(WINDOW);
    expect(serviceMock.findBy).toHaveBeenCalledTimes(1);
    const query: { projectId: { toString: () => string } } =
      serviceMock.findBy.mock.calls[0][0].query;
    expect(query.projectId.toString()).toBe(PROJECT_ID);
  });

  test("drops edges whose service no longer exists", async () => {
    arrange({
      traced: [
        {
          callerServiceId: IDS["deleted"],
          calleeServiceId: IDS["api"],
          callCount: 10,
          errorCount: 0,
          avgDurationNano: 1,
        },
        {
          callerServiceId: "not-a-uuid",
          calleeServiceId: IDS["api"],
          callCount: 10,
          errorCount: 0,
          avgDurationNano: 1,
        },
      ],
    });
    expect(await computeDependenciesForProject(WINDOW)).toBe(0);
    expect(relationshipMock.reconcileRelationships).not.toHaveBeenCalled();
  });

  test("a failing source costs only its own edges", async () => {
    arrange({
      traced: new Error("Memory limit exceeded"),
      clients: [
        {
          callerServiceId: IDS["api"],
          dbSystem: "redis",
          callCount: 10,
          errorCount: 0,
          avgDurationNano: 1000000,
        },
      ],
      graph: new Error("table does not exist"),
    });
    expect(await computeDependenciesForProject(WINDOW)).toBe(1);
    expect(reconciledEdges()).toHaveLength(1);
    expect((logger.error as jest.Mock).mock.calls.length).toBe(2);
  });

  test("nothing observed writes nothing", async () => {
    arrange({});
    expect(await computeDependenciesForProject(WINDOW)).toBe(0);
    expect(serviceMock.findBy).not.toHaveBeenCalled();
    expect(inventoryMock.reconcileEntities).not.toHaveBeenCalled();
    expect(relationshipMock.reconcileRelationships).not.toHaveBeenCalled();
  });

  test("service-only edges register no dependency rows", async () => {
    arrange({
      clients: [
        {
          callerServiceId: IDS["dashboard"],
          peerService: "API",
          callCount: 3,
          errorCount: 0,
          avgDurationNano: 1,
        },
      ],
    });
    expect(await computeDependenciesForProject(WINDOW)).toBe(1);
    expect(inventoryMock.reconcileEntities).not.toHaveBeenCalled();
    expect(reconciledEdges()[0]).toMatchObject({
      fromEntityKey: DASHBOARD_KEY,
      toEntityKey: API_KEY,
    });
  });
});

describe("the cron run", () => {
  test("registers under its documented name", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  });

  test("covers projects seen in spans or service graph metrics, and survives one failing", async () => {
    arrange({
      projects: [PROJECT_ID, "not-a-project"],
      metricProjects: [PROJECT_ID, OTHER_PROJECT_ID],
      traced: [
        {
          callerServiceId: IDS["probe"],
          calleeServiceId: IDS["api"],
          callCount: 1,
          errorCount: 0,
          avgDurationNano: 1,
        },
      ],
    });
    serviceMock.findBy.mockImplementation(
      async (args: { query: { projectId: { toString: () => string } } }) => {
        if (args.query.projectId.toString() === PROJECT_ID) {
          throw new Error("connection reset");
        }
        return [
          { _id: IDS["probe"], name: "probe" },
          { _id: IDS["api"], name: "api" },
        ];
      },
    );

    await mockCapturedJobs[JOB_NAME]!();

    const projectsRun: Array<string> = spanMock.executeQuery.mock.calls
      .map((call: Array<unknown>) => {
        return String(call[0]);
      })
      .filter((sql: string) => {
        return sql.includes("INNER JOIN");
      })
      .map((sql: string) => {
        return sql.match(/projectId = '([^']+)'/)![1]!;
      });
    expect(Array.from(new Set(projectsRun)).sort()).toEqual(
      [PROJECT_ID, OTHER_PROJECT_ID].sort(),
    );
    expect(relationshipMock.reconcileRelationships).toHaveBeenCalledTimes(1);
    expect(
      relationshipMock.reconcileRelationships.mock.calls[0][0].projectId.toString(),
    ).toBe(OTHER_PROJECT_ID);
  });

  test("a metrics outage never stops span-derived projects", async () => {
    arrange({ projects: [PROJECT_ID] });
    metricMock.executeQuery.mockRejectedValue(new Error("metrics down"));
    await mockCapturedJobs[JOB_NAME]!();
    expect(
      spanMock.executeQuery.mock.calls.some((call: Array<unknown>) => {
        return String(call[0]).includes("INNER JOIN");
      }),
    ).toBe(true);
  });
});

/*
 * ---- Databases from client spans --------------------------------------------
 *
 * The same run matches the database endpoints DB CLIENT spans call to their
 * DatabaseServer rows (creating them conservatively) and sights them. It is
 * an isolated step: it runs even when the window produced no edge, a failure
 * on either side never costs the other its run, and it never touches the
 * dependency queries or the Database registry identity.
 */

interface FindOrCreateArgs {
  projectId: ObjectID;
  dbSystem: string;
  endpoint: {
    host: string;
    port: number | null;
    kubernetesClusterName?: string;
  };
  discoverySource: DatabaseServerDiscoverySource;
  allowCreate: boolean;
}

function databaseRow(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    dbSystem: "postgresql",
    serverAddress: "orders.cjd8.eu-west-1.rds.amazonaws.com",
    serverPort: "5432",
    callerNamespace: "",
    callerCluster: "",
    callCount: "250",
    ...overrides,
  };
}

function findOrCreateCalls(): Array<FindOrCreateArgs> {
  return databaseServerMock.findOrCreateByEndpoint.mock.calls.map(
    (call: Array<unknown>): FindOrCreateArgs => {
      return call[0] as FindOrCreateArgs;
    },
  );
}

function createAttempts(): Array<FindOrCreateArgs> {
  return findOrCreateCalls().filter((args: FindOrCreateArgs): boolean => {
    return args.allowCreate;
  });
}

function databaseSql(): Array<string> {
  return spanMock.executeQuery.mock.calls
    .map((call: Array<unknown>): string => {
      return String(call[0]);
    })
    .filter((sql: string): boolean => {
      return sql.includes(DATABASE_ENDPOINT_SQL_MARKER);
    });
}

// A stand-in for the real service: rows exist for `known`, created when allowed.
function arrangeDatabaseRows(known: Array<string>): Set<string> {
  const existing: Set<string> = new Set<string>(known);
  databaseServerMock.findOrCreateByEndpoint.mockImplementation(
    async (args: FindOrCreateArgs) => {
      const endpoint: string = `${args.endpoint.host}:${args.endpoint.port}${
        args.endpoint.kubernetesClusterName
          ? `@${args.endpoint.kubernetesClusterName}`
          : ""
      }`;
      if (existing.has(endpoint)) {
        return { id: new ObjectID(`db-${endpoint}`) };
      }
      if (!args.allowCreate) {
        return null;
      }
      existing.add(endpoint);
      return { id: new ObjectID(`db-${endpoint}`) };
    },
  );
  return existing;
}

describe("database servers from client spans", () => {
  let savedMinCalls: string | undefined;

  beforeEach(() => {
    savedMinCalls = process.env[DATABASE_SERVER_MIN_CALLS_ENV];
    delete process.env[DATABASE_SERVER_MIN_CALLS_ENV];
  });

  afterEach(() => {
    if (savedMinCalls === undefined) {
      delete process.env[DATABASE_SERVER_MIN_CALLS_ENV];
    } else {
      process.env[DATABASE_SERVER_MIN_CALLS_ENV] = savedMinCalls;
    }
  });

  test("runs even when every dependency source is empty", async () => {
    arrange({ databases: [databaseRow({})] });
    arrangeDatabaseRows(["orders.cjd8.eu-west-1.rds.amazonaws.com:5432"]);

    expect(await computeDependenciesForProject(WINDOW)).toBe(0);

    expect(databaseServerMock.findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
    expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
    expect(databaseServerMock.recordSighting.mock.calls[0]![0].toString()).toBe(
      new ObjectID(
        "db-orders.cjd8.eu-west-1.rds.amazonaws.com:5432",
      ).toString(),
    );
    // The edge side still wrote nothing.
    expect(relationshipMock.reconcileRelationships).not.toHaveBeenCalled();
    expect(inventoryMock.reconcileEntities).not.toHaveBeenCalled();
  });

  test("reads one bounded, project- and window-scoped query", async () => {
    arrange({});

    await computeDependenciesForProject(WINDOW);

    const sql: Array<string> = databaseSql();
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain(`projectId = '${PROJECT_ID}'`);
    expect(sql[0]).toContain(`startTime >= ${WINDOW.startSql}`);
    expect(sql[0]).toContain(`startTime < ${WINDOW.endSql}`);
    expect(sql[0]).toContain(`LIMIT ${MAX_DATABASE_ENDPOINT_ROWS}`);
    expect(sql[0]).toContain("kind = 'SPAN_KIND_CLIENT'");
  });

  test("leaves the dependency queries exactly as they were", async () => {
    arrange({});

    await computeDependenciesForProject(WINDOW);

    const dependencySql: Array<string> = spanMock.executeQuery.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((sql: string): boolean => {
        return !sql.includes(DATABASE_ENDPOINT_SQL_MARKER);
      });
    // Trace-linked + client-span dependency queries, both untouched.
    expect(dependencySql).toHaveLength(2);
    for (const sql of dependencySql) {
      expect(sql).not.toContain(DATABASE_ENDPOINT_SQL_MARKER);
      expect(sql).not.toContain("resource.k8s.cluster.name");
    }
    expect(metricMock.executeQuery).toHaveBeenCalledTimes(1);
  });

  test("the Database registry identity of the edges is unchanged", async () => {
    arrange({
      clients: [
        {
          callerServiceId: IDS["api"],
          dbSystem: "postgresql",
          dbNamespace: "oneuptime",
          serverAddress: "postgres.oneuptime.svc.cluster.local:5432",
          callCount: "4000",
          errorCount: "0",
          avgDurationNano: "4000000",
        },
      ],
      databases: [
        databaseRow({
          serverAddress: "postgres.oneuptime.svc.cluster.local",
          callerCluster: "prod",
          callCount: "4000",
        }),
      ],
    });
    arrangeDatabaseRows([]);

    expect(await computeDependenciesForProject(WINDOW)).toBe(1);

    const postgresKey: string = computeEntityKey({
      projectId: PROJECT_ID,
      entityType: EntityType.Database,
      identifyingAttributes: {
        "db.system.name": "postgresql",
        "server.address": "postgres.oneuptime.svc.cluster.local",
        "db.namespace": "oneuptime",
      },
    });
    const registered: Array<{ entityType: EntityType; entityKey: string }> =
      inventoryMock.reconcileEntities.mock.calls[0][0].entities;
    expect(
      registered.map(
        (entity: { entityType: EntityType; entityKey: string }) => {
          return [entity.entityType, entity.entityKey];
        },
      ),
    ).toEqual([[EntityType.Database, postgresKey]]);
    expect(reconciledEdges()[0]).toMatchObject({
      fromEntityKey: API_KEY,
      toEntityKey: postgresKey,
    });

    // …while the Databases product got its row under the canonical endpoint.
    expect(createAttempts()).toHaveLength(1);
    expect(createAttempts()[0]!.endpoint).toEqual({
      host: "postgres.oneuptime.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("an existing row is matched WITHOUT create permission, sighted, and costs no budget query", async () => {
    arrange({ databases: [databaseRow({ callCount: "1" })] });
    arrangeDatabaseRows(["orders.cjd8.eu-west-1.rds.amazonaws.com:5432"]);

    expect(
      await discoverDatabaseServersForProject({
        projectId: PROJECT_ID,
        startSql: WINDOW.startSql,
        endSql: WINDOW.endSql,
      }),
    ).toBe(1);

    const calls: Array<FindOrCreateArgs> = findOrCreateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.allowCreate).toBe(false);
    expect(calls[0]!.projectId.toString()).toBe(PROJECT_ID);
    expect(calls[0]!.dbSystem).toBe("postgresql");
    expect(calls[0]!.discoverySource).toBe(
      DatabaseServerDiscoverySource.ClientSpans,
    );
    expect(calls[0]!.endpoint).toEqual({
      host: "orders.cjd8.eu-west-1.rds.amazonaws.com",
      port: 5432,
    });
    expect(databaseServerMock.isUnderAutoCreateBudget).not.toHaveBeenCalled();
    expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
  });

  test("a new, busy, global host endpoint of a known engine is created within budget and sighted", async () => {
    arrange({ databases: [databaseRow({ dbSystem: "postgres" })] });
    const existing: Set<string> = arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(
      findOrCreateCalls().map((args: FindOrCreateArgs): boolean => {
        return args.allowCreate;
      }),
    ).toEqual([false, true]);
    expect(createAttempts()[0]!.dbSystem).toBe("postgresql");
    expect(
      String(databaseServerMock.isUnderAutoCreateBudget.mock.calls[0]![0]),
    ).toBe(PROJECT_ID);
    expect(existing.has("orders.cjd8.eu-west-1.rds.amazonaws.com:5432")).toBe(
      true,
    );
    expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
  });

  const NEVER_CREATED: Array<{ why: string; row: Record<string, unknown> }> = [
    {
      why: "a LOCAL single-label name",
      row: { serverAddress: "postgres", callerNamespace: "" },
    },
    {
      why: "an unqualified cluster-local Service name",
      row: {
        serverAddress: "orders",
        callerNamespace: "shop",
        callerCluster: "",
      },
    },
    { why: "a public IP literal", row: { serverAddress: "34.120.1.9" } },
    {
      why: "a cluster-qualified private IP",
      row: { serverAddress: "10.0.0.5", callerCluster: "prod" },
    },
    {
      why: "an unknown engine",
      row: { dbSystem: "acmedb", serverAddress: "acme.example.com" },
    },
    {
      why: "a cloud-API engine",
      row: {
        dbSystem: "aws.dynamodb",
        serverAddress: "dynamodb.us-east-1.amazonaws.com",
        serverPort: "443",
      },
    },
    { why: "fewer calls than the minimum (10)", row: { callCount: "9" } },
  ];

  for (const entry of NEVER_CREATED) {
    test(`never creates for ${entry.why}, but still looks it up`, async () => {
      arrange({ databases: [databaseRow(entry.row)] });
      arrangeDatabaseRows([]);

      await computeDependenciesForProject(WINDOW);

      expect(findOrCreateCalls()).toHaveLength(1);
      expect(findOrCreateCalls()[0]!.allowCreate).toBe(false);
      expect(createAttempts()).toHaveLength(0);
      expect(databaseServerMock.isUnderAutoCreateBudget).not.toHaveBeenCalled();
      expect(databaseServerMock.recordSighting).not.toHaveBeenCalled();
    });
  }

  test("the call minimum is read from DATABASE_SERVER_MIN_CALLS", async () => {
    process.env[DATABASE_SERVER_MIN_CALLS_ENV] = "3";
    arrange({ databases: [databaseRow({ callCount: "5" })] });
    arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(createAttempts()).toHaveLength(1);
  });

  test("calls to one endpoint from several rows add up towards the minimum", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "db.example.com", callCount: "4" }),
        databaseRow({ serverAddress: "DB.example.com:5432", callCount: "6" }),
      ],
    });
    arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(createAttempts()).toHaveLength(1);
    expect(createAttempts()[0]!.endpoint).toEqual({
      host: "db.example.com",
      port: 5432,
    });
  });

  test("a cluster-qualified Service FQDN is created", async () => {
    arrange({
      databases: [
        databaseRow({
          serverAddress: "orders",
          callerNamespace: "shop",
          callerCluster: "prod-eu",
        }),
      ],
    });
    arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(createAttempts()[0]!.endpoint).toEqual({
      host: "orders.shop.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
  });

  test("over budget: nothing is created, and the budget is asked once per project", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "a.example.com" }),
        databaseRow({ serverAddress: "b.example.com" }),
      ],
    });
    arrangeDatabaseRows([]);
    databaseServerMock.isUnderAutoCreateBudget.mockResolvedValue(false);

    await computeDependenciesForProject(WINDOW);

    expect(createAttempts()).toHaveLength(0);
    expect(databaseServerMock.isUnderAutoCreateBudget).toHaveBeenCalledTimes(1);
    expect(databaseServerMock.recordSighting).not.toHaveBeenCalled();
    // The skipped creates are named once, with the project.
    expect(logger.warn as jest.Mock).toHaveBeenCalledTimes(1);
    expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("2 new database endpoint(s)"),
    );
    expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining(PROJECT_ID),
    );
  });

  test("an endpoint the policy refuses is not counted as over budget", async () => {
    arrange({ databases: [databaseRow({ callCount: "1" })] });
    arrangeDatabaseRows([]);
    databaseServerMock.isUnderAutoCreateBudget.mockResolvedValue(false);

    await computeDependenciesForProject(WINDOW);

    expect(logger.warn as jest.Mock).not.toHaveBeenCalled();
  });

  test("a query at its row cap is logged as partially matched", async () => {
    const capped: Array<unknown> = [];
    for (let index: number = 0; index < MAX_DATABASE_ENDPOINT_ROWS; index++) {
      capped.push(
        databaseRow({
          serverAddress: `db-${index}.example.com`,
          callCount: "1",
        }),
      );
    }
    arrange({ databases: capped });
    arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining(
        `at least ${MAX_DATABASE_ENDPOINT_ROWS} database endpoint groups`,
      ),
    );
    // Every row the cap let through is still matched.
    expect(findOrCreateCalls()).toHaveLength(MAX_DATABASE_ENDPOINT_ROWS);
  });

  test("a query below its row cap logs no warning", async () => {
    arrange({ databases: [databaseRow({})] });
    arrangeDatabaseRows(["orders.cjd8.eu-west-1.rds.amazonaws.com:5432"]);

    await computeDependenciesForProject(WINDOW);

    expect(logger.warn as jest.Mock).not.toHaveBeenCalled();
  });

  test("the budget is read again after every create", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "a.example.com", callCount: "30" }),
        databaseRow({ serverAddress: "b.example.com", callCount: "20" }),
        databaseRow({ serverAddress: "c.example.com", callCount: "10" }),
      ],
    });
    const existing: Set<string> = arrangeDatabaseRows([]);
    databaseServerMock.isUnderAutoCreateBudget
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await computeDependenciesForProject(WINDOW);

    // Busiest first: a.example.com got the last slot.
    expect(Array.from(existing)).toEqual(["a.example.com:5432"]);
    expect(databaseServerMock.isUnderAutoCreateBudget).toHaveBeenCalledTimes(2);
    expect(logger.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("2 new database endpoint(s)"),
    );
  });

  test("an unreadable budget fails closed", async () => {
    arrange({ databases: [databaseRow({})] });
    arrangeDatabaseRows([]);
    databaseServerMock.isUnderAutoCreateBudget.mockRejectedValue(
      new Error("count timed out"),
    );

    await computeDependenciesForProject(WINDOW);

    expect(createAttempts()).toHaveLength(0);
    expect(logger.error as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("count timed out"),
    );
  });

  test("loopback and unparseable addresses never reach the service", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "localhost" }),
        databaseRow({ serverAddress: "127.0.0.1" }),
        databaseRow({ serverAddress: "[REDACTED]" }),
      ],
    });

    await computeDependenciesForProject(WINDOW);

    expect(databaseServerMock.findOrCreateByEndpoint).not.toHaveBeenCalled();
  });

  describe("isolation", () => {
    test("a failing database query is logged and the edges are still computed", async () => {
      arrange({
        traced: [
          {
            callerServiceId: IDS["probe"],
            calleeServiceId: IDS["api"],
            callCount: 1,
            errorCount: 0,
            avgDurationNano: 1,
          },
        ],
        databases: new Error("Memory limit exceeded (database)"),
      });

      expect(await computeDependenciesForProject(WINDOW)).toBe(1);

      expect(relationshipMock.reconcileRelationships).toHaveBeenCalledTimes(1);
      expect(logger.error as jest.Mock).toHaveBeenCalledTimes(1);
      expect(logger.error as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("database endpoint discovery failed"),
      );
    });

    test("failing dependency sources never stop the database step", async () => {
      arrange({
        traced: new Error("trace query failed"),
        clients: new Error("client query failed"),
        graph: new Error("graph query failed"),
        databases: [databaseRow({})],
      });
      arrangeDatabaseRows(["orders.cjd8.eu-west-1.rds.amazonaws.com:5432"]);

      expect(await computeDependenciesForProject(WINDOW)).toBe(0);

      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
      expect((logger.error as jest.Mock).mock.calls.length).toBe(3);
    });

    test("one endpoint failing is logged and the next endpoint is still sighted", async () => {
      arrange({
        databases: [
          databaseRow({ serverAddress: "a.example.com", callCount: "30" }),
          databaseRow({ serverAddress: "b.example.com", callCount: "20" }),
        ],
      });
      databaseServerMock.findOrCreateByEndpoint.mockImplementation(
        async (args: FindOrCreateArgs) => {
          if (args.endpoint.host === "a.example.com") {
            throw new Error("claim race lost badly");
          }
          return { id: new ObjectID("db-b") };
        },
      );

      await computeDependenciesForProject(WINDOW);

      expect(logger.error as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("a.example.com:5432"),
      );
      expect(logger.error as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("claim race lost badly"),
      );
      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
      expect(
        databaseServerMock.recordSighting.mock.calls[0]![0].toString(),
      ).toBe(new ObjectID("db-b").toString());
    });

    test("a failing sighting is logged and the next endpoint continues", async () => {
      arrange({
        databases: [
          databaseRow({ serverAddress: "a.example.com", callCount: "30" }),
          databaseRow({ serverAddress: "b.example.com", callCount: "20" }),
        ],
      });
      arrangeDatabaseRows(["a.example.com:5432", "b.example.com:5432"]);
      databaseServerMock.recordSighting
        .mockRejectedValueOnce(new Error("heartbeat failed"))
        .mockResolvedValueOnce(undefined);

      await expect(
        discoverDatabaseServersForProject({
          projectId: PROJECT_ID,
          startSql: WINDOW.startSql,
          endSql: WINDOW.endSql,
        }),
      ).resolves.toBe(1);

      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(2);
      expect(logger.error as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("heartbeat failed"),
      );
    });

    test("never rejects, whatever fails underneath it", async () => {
      spanMock.executeQuery.mockImplementation(() => {
        throw new Error("synchronous client failure");
      });

      await expect(
        discoverDatabaseServersForProject({
          projectId: PROJECT_ID,
          startSql: WINDOW.startSql,
          endSql: WINDOW.endSql,
        }),
      ).resolves.toBe(0);
    });
  });

  test("the cron runs the database step for every project, even one whose edges fail", async () => {
    arrange({
      projects: [PROJECT_ID, OTHER_PROJECT_ID],
      traced: [
        {
          callerServiceId: IDS["probe"],
          calleeServiceId: IDS["api"],
          callCount: 1,
          errorCount: 0,
          avgDurationNano: 1,
        },
      ],
      databases: [databaseRow({})],
    });
    arrangeDatabaseRows(["orders.cjd8.eu-west-1.rds.amazonaws.com:5432"]);
    serviceMock.findBy.mockRejectedValue(new Error("connection reset"));

    await mockCapturedJobs[JOB_NAME]!();

    const projectsQueried: Array<string> = databaseSql().map((sql: string) => {
      return sql.match(/projectId = '([^']+)'/)![1]!;
    });
    expect(projectsQueried.sort()).toEqual(
      [PROJECT_ID, OTHER_PROJECT_ID].sort(),
    );
    expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(2);
  });
});
