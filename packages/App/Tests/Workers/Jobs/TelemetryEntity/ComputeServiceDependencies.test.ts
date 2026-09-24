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
  DatabaseEndpointRow,
  DiscoveredDatabaseEndpoint,
  resolveDatabaseEndpointRows,
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
jest.mock("Common/Server/Services/DatabaseServerEndpointService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), claimEndpoint: jest.fn() },
  };
});
// The batch owner lookup's IN (...) filter, made readable for assertions.
jest.mock("Common/Server/Types/Database/QueryHelper", () => {
  return {
    __esModule: true,
    default: {
      any: (values: Array<string>): { anyOf: Array<string> } => {
        return { anyOf: values };
      },
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
import DatabaseServerEndpointService from "Common/Server/Services/DatabaseServerEndpointService";
import { formatDatabaseEndpoint } from "Common/Types/DatabaseServer/DatabaseEndpoint";
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

const endpointMock: { findBy: jest.Mock; claimEndpoint: jest.Mock } =
  DatabaseServerEndpointService as unknown as {
    findBy: jest.Mock;
    claimEndpoint: jest.Mock;
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
  endpointMock.findBy.mockReset();
  endpointMock.findBy.mockResolvedValue([]);
  endpointMock.claimEndpoint.mockReset();
  endpointMock.claimEndpoint.mockResolvedValue("claimed");
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
  displayName?: string | undefined;
  allowCreate: boolean;
}

interface ClaimArgs {
  projectId: ObjectID;
  databaseServerId: ObjectID;
  endpoint: string;
  isPrimary: boolean;
  source: string;
}

function databaseRow(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    dbSystem: "postgresql",
    serverAddress: "orders.cjd8.eu-west-1.rds.amazonaws.com",
    serverPort: "5432",
    dbInstance: "",
    callerNamespace: "",
    callerInKubernetes: 0,
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

function claims(): Array<ClaimArgs> {
  return endpointMock.claimEndpoint.mock.calls.map(
    (call: Array<unknown>): ClaimArgs => {
      return call[0] as ClaimArgs;
    },
  );
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

function rowId(owner: string): ObjectID {
  return new ObjectID(`db-${owner}`);
}

/*
 * A stand-in for the real services: `owners` maps a formatted endpoint to
 * the database that owns it; the batch lookup, findOrCreateByEndpoint and
 * claimEndpoint all read and write it, as the real tables would.
 */
function arrangeDatabaseRows(
  known: Array<string> | Record<string, string>,
): Map<string, string> {
  const owners: Map<string, string> = new Map<string, string>(
    Array.isArray(known)
      ? known.map((endpoint: string): [string, string] => {
          return [endpoint, endpoint];
        })
      : Object.entries(known),
  );

  endpointMock.findBy.mockImplementation(
    async (args: { query: { endpoint: { anyOf: Array<string> } } }) => {
      return args.query.endpoint.anyOf
        .filter((endpoint: string): boolean => {
          return owners.has(endpoint);
        })
        .map((endpoint: string) => {
          return {
            endpoint: endpoint,
            databaseServerId: rowId(owners.get(endpoint)!),
          };
        });
    },
  );

  databaseServerMock.findOrCreateByEndpoint.mockImplementation(
    async (args: FindOrCreateArgs) => {
      const endpoint: string = formatDatabaseEndpoint(args.endpoint);
      const owner: string | undefined = owners.get(endpoint);
      if (owner) {
        return { id: rowId(owner) };
      }
      if (!args.allowCreate) {
        return null;
      }
      owners.set(endpoint, endpoint);
      return { id: rowId(endpoint) };
    },
  );

  endpointMock.claimEndpoint.mockImplementation(async (args: ClaimArgs) => {
    const owner: string | undefined = owners.get(args.endpoint);
    if (owner) {
      return rowId(owner).toString() === args.databaseServerId.toString()
        ? "already-owned-by-this"
        : "owned-by-other";
    }
    owners.set(args.endpoint, args.databaseServerId.toString().substring(3));
    return "claimed";
  });

  return owners;
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
      rowId("orders.cjd8.eu-west-1.rds.amazonaws.com:5432").toString(),
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
    expect(sql[0]).toContain("hasAny(attributeKeys,");
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

  test("the database query runs after the dependency queries, never beside them", async () => {
    arrange({ databases: [databaseRow({})] });
    arrangeDatabaseRows(["orders.cjd8.eu-west-1.rds.amazonaws.com:5432"]);

    let inFlight: number = 0;
    const overlapped: Array<number> = [];
    const delayed: (result: unknown) => Promise<unknown> = (
      result: unknown,
    ): Promise<unknown> => {
      inFlight++;
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        setTimeout(() => {
          inFlight--;
          resolve(result);
        }, 20);
      });
    };

    spanMock.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes(DATABASE_ENDPOINT_SQL_MARKER)) {
        overlapped.push(inFlight);
        return rows([databaseRow({})]);
      }
      return delayed(rows([]));
    });
    metricMock.executeQuery.mockImplementation(() => {
      return delayed(rows([]));
    });

    await computeDependenciesForProject(WINDOW);

    expect(overlapped).toEqual([0]);
    expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
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
    const owners: Map<string, string> = arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    // The batch lookup already said "nobody owns it": straight to the create.
    expect(
      findOrCreateCalls().map((args: FindOrCreateArgs): boolean => {
        return args.allowCreate;
      }),
    ).toEqual([true]);
    expect(createAttempts()[0]!.dbSystem).toBe("postgresql");
    expect(createAttempts()[0]!.displayName).toBeUndefined();
    expect(
      String(databaseServerMock.isUnderAutoCreateBudget.mock.calls[0]![0]),
    ).toBe(PROJECT_ID);
    expect(owners.has("orders.cjd8.eu-west-1.rds.amazonaws.com:5432")).toBe(
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
    {
      why: "a <service>.<namespace> name from pods that report no cluster",
      row: { serverAddress: "postgres.data", callerInKubernetes: 1 },
    },
    { why: "a public IP literal", row: { serverAddress: "34.120.1.9" } },
    {
      why: "a cluster-qualified private IP",
      row: { serverAddress: "10.0.0.5", callerCluster: "prod" },
    },
    {
      why: "a link-local IP, even qualified",
      row: { serverAddress: "169.254.1.10", callerCluster: "prod" },
    },
    {
      why: "a private-zone name seen from outside any cluster",
      row: { serverAddress: "ip-10-0-0-5.ec2.internal" },
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
    test(`never creates for ${entry.why}, and costs no per-endpoint lookup`, async () => {
      arrange({ databases: [databaseRow(entry.row)] });
      arrangeDatabaseRows([]);

      await computeDependenciesForProject(WINDOW);

      // One batch owner query, and nothing per endpoint.
      expect(endpointMock.findBy).toHaveBeenCalledTimes(1);
      expect(findOrCreateCalls()).toHaveLength(0);
      expect(databaseServerMock.isUnderAutoCreateBudget).not.toHaveBeenCalled();
      expect(databaseServerMock.recordSighting).not.toHaveBeenCalled();
    });

    test(`still matches and sights ${entry.why} when a row owns it`, async () => {
      arrange({ databases: [databaseRow(entry.row)] });
      const [discovered]: Array<DiscoveredDatabaseEndpoint> =
        resolveDatabaseEndpointRows([
          databaseRow(entry.row) as DatabaseEndpointRow,
        ]);
      arrangeDatabaseRows([formatDatabaseEndpoint(discovered!.endpoint)]);

      await computeDependenciesForProject(WINDOW);

      expect(findOrCreateCalls()).toHaveLength(1);
      expect(findOrCreateCalls()[0]!.allowCreate).toBe(false);
      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
    });
  }

  test("owners are read in ONE query for every endpoint of the window, scoped to the project", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "a.example.com" }),
        databaseRow({ serverAddress: "10.0.0.5", callerCluster: "prod" }),
        databaseRow({ serverAddress: "postgres" }),
        databaseRow({
          dbSystem: "mongodb",
          serverAddress: "c0-shard-00-00.abcd.mongodb.net",
          serverPort: "",
        }),
        databaseRow({
          dbSystem: "mongodb",
          serverAddress: "c0-shard-00-01.abcd.mongodb.net",
          serverPort: "",
        }),
      ],
    });
    arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(endpointMock.findBy).toHaveBeenCalledTimes(1);
    const args: {
      query: { projectId: ObjectID; endpoint: { anyOf: Array<string> } };
      props: { isRoot: boolean };
    } = endpointMock.findBy.mock.calls[0]![0];
    expect(args.query.projectId.toString()).toBe(PROJECT_ID);
    expect(args.props.isRoot).toBe(true);
    expect([...args.query.endpoint.anyOf].sort()).toEqual(
      [
        "a.example.com:5432",
        "10.0.0.5:5432@prod",
        "postgres:5432",
        "c0-shard-00-00.abcd.mongodb.net:27017",
        "c0-shard-00-01.abcd.mongodb.net:27017",
      ].sort(),
    );
  });

  test("nothing resolved, nothing queried", async () => {
    arrange({ databases: [databaseRow({ serverAddress: "localhost" })] });
    arrangeDatabaseRows([]);

    await computeDependenciesForProject(WINDOW);

    expect(endpointMock.findBy).not.toHaveBeenCalled();
  });

  test("a failing owner lookup is logged and the step returns 0", async () => {
    arrange({ databases: [databaseRow({})] });
    endpointMock.findBy.mockRejectedValue(new Error("pool exhausted"));

    await expect(
      discoverDatabaseServersForProject({
        projectId: PROJECT_ID,
        startSql: WINDOW.startSql,
        endSql: WINDOW.endSql,
      }),
    ).resolves.toBe(0);
    expect(logger.error as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("pool exhausted"),
    );
  });

  test("a row that owns several endpoints of the window is sighted once", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "a.example.com", callCount: "30" }),
        databaseRow({ serverAddress: "b.example.com", callCount: "20" }),
      ],
    });
    arrangeDatabaseRows({
      "a.example.com:5432": "shared",
      "b.example.com:5432": "shared",
    });

    expect(
      await discoverDatabaseServersForProject({
        projectId: PROJECT_ID,
        startSql: WINDOW.startSql,
        endSql: WINDOW.endSql,
      }),
    ).toBe(1);

    // Each owned endpoint is still matched (its "last matched" moves)…
    expect(findOrCreateCalls()).toHaveLength(2);
    // …but the database is sighted once.
    expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
    expect(databaseServerMock.recordSighting.mock.calls[0]![0].toString()).toBe(
      rowId("shared").toString(),
    );
  });

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

  test("the audit's two-cluster postgres.data: one row per cluster, each the workload's own Service alias", async () => {
    arrange({
      databases: [
        databaseRow({
          serverAddress: "postgres.data",
          serverPort: "",
          callerInKubernetes: 1,
          callerCluster: "staging",
          callCount: "40",
        }),
        databaseRow({
          serverAddress: "postgres.data",
          serverPort: "",
          callerInKubernetes: 1,
          callerCluster: "production",
          callCount: "40",
        }),
      ],
    });
    // Production's Kubernetes worker already owns its Service alias.
    arrangeDatabaseRows({
      "postgres.data.svc.cluster.local:5432@production": "workload-prod",
    });

    await computeDependenciesForProject(WINDOW);

    // Production's spans join the workload row…
    const matched: Array<FindOrCreateArgs> = findOrCreateCalls().filter(
      (args: FindOrCreateArgs): boolean => {
        return !args.allowCreate;
      },
    );
    expect(
      matched.map((args: FindOrCreateArgs) => {
        return args.endpoint;
      }),
    ).toEqual([
      {
        host: "postgres.data.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "production",
      },
    ]);
    // …staging's get a row of their own, never one global row for both.
    expect(
      createAttempts().map((args: FindOrCreateArgs) => {
        return args.endpoint;
      }),
    ).toEqual([
      {
        host: "postgres.data.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "staging",
      },
    ]);
    for (const args of findOrCreateCalls()) {
      expect(args.endpoint.host).not.toBe("postgres.data");
    }
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
    const known: Array<string> = [];
    for (let index: number = 0; index < MAX_DATABASE_ENDPOINT_ROWS; index++) {
      known.push(`db-${index}.example.com:5432`);
    }
    arrangeDatabaseRows(known);

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
    const owners: Map<string, string> = arrangeDatabaseRows([]);
    databaseServerMock.isUnderAutoCreateBudget
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await computeDependenciesForProject(WINDOW);

    // Busiest first: a.example.com got the last slot.
    expect(Array.from(owners.keys())).toEqual(["a.example.com:5432"]);
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

  test("loopback and unparseable addresses never reach the services", async () => {
    arrange({
      databases: [
        databaseRow({ serverAddress: "localhost" }),
        databaseRow({ serverAddress: "127.0.0.1" }),
        databaseRow({ serverAddress: "[REDACTED]" }),
        databaseRow({ serverAddress: "host.minikube.internal" }),
      ],
    });

    await computeDependenciesForProject(WINDOW);

    expect(databaseServerMock.findOrCreateByEndpoint).not.toHaveBeenCalled();
    expect(endpointMock.findBy).not.toHaveBeenCalled();
  });

  describe("managed clusters (members of one logical database)", () => {
    const MEMBERS: Array<string> = [
      "c0-shard-00-00.abcd.mongodb.net:27017",
      "c0-shard-00-01.abcd.mongodb.net:27017",
      "c0-shard-00-02.abcd.mongodb.net:27017",
    ];

    function atlasRows(calls: Array<number>): Array<unknown> {
      return MEMBERS.map((member: string, index: number) => {
        return databaseRow({
          dbSystem: "mongodb",
          serverAddress: member.split(":")[0],
          serverPort: "",
          callCount: String(calls[index]),
        });
      });
    }

    test("the audit's three Atlas members create ONE row, named after the cluster, and claim the rest", async () => {
      arrange({ databases: atlasRows([10, 50, 20]) });
      arrangeDatabaseRows([]);

      await computeDependenciesForProject(WINDOW);

      expect(createAttempts()).toHaveLength(1);
      expect(formatDatabaseEndpoint(createAttempts()[0]!.endpoint)).toBe(
        MEMBERS[1],
      );
      expect(createAttempts()[0]!.displayName).toBe(
        "MongoDB c0.abcd.mongodb.net:27017",
      );
      expect(databaseServerMock.isUnderAutoCreateBudget).toHaveBeenCalledTimes(
        1,
      );

      const created: ObjectID = rowId(MEMBERS[1]!);
      expect(
        claims().map((args: ClaimArgs) => {
          return [
            args.endpoint,
            args.databaseServerId.toString(),
            args.isPrimary,
            args.source,
          ];
        }),
      ).toEqual([
        [MEMBERS[0], created.toString(), false, "auto"],
        [MEMBERS[2], created.toString(), false, "auto"],
      ]);
      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
    });

    test("members whose calls are each below the minimum still create the cluster's row together", async () => {
      arrange({ databases: atlasRows([4, 4, 4]) });
      arrangeDatabaseRows([]);

      await computeDependenciesForProject(WINDOW);

      expect(createAttempts()).toHaveLength(1);
    });

    test("a new member of an existing cluster row joins it instead of becoming a database", async () => {
      arrange({ databases: atlasRows([10, 50, 20]) });
      // An earlier run created the row under member 00.
      arrangeDatabaseRows({ [MEMBERS[0]!]: "atlas" });

      await computeDependenciesForProject(WINDOW);

      expect(createAttempts()).toHaveLength(0);
      expect(findOrCreateCalls()).toHaveLength(1);
      expect(
        claims().map((args: ClaimArgs) => {
          return [args.endpoint, args.databaseServerId.toString()];
        }),
      ).toEqual([
        [MEMBERS[1], rowId("atlas").toString()],
        [MEMBERS[2], rowId("atlas").toString()],
      ]);
      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
    });

    test("members owned by two different rows are both sighted and nothing is claimed", async () => {
      arrange({ databases: atlasRows([10, 50, 20]) });
      arrangeDatabaseRows({ [MEMBERS[0]!]: "one", [MEMBERS[1]!]: "two" });

      await computeDependenciesForProject(WINDOW);

      expect(createAttempts()).toHaveLength(0);
      expect(claims()).toHaveLength(0);
      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(2);
    });

    test("a failing claim is logged and the other members are still claimed", async () => {
      arrange({ databases: atlasRows([10, 50, 20]) });
      arrangeDatabaseRows([]);
      endpointMock.claimEndpoint.mockImplementationOnce(async () => {
        throw new Error("deadlock detected");
      });

      await computeDependenciesForProject(WINDOW);

      expect(claims()).toHaveLength(2);
      expect(logger.error as jest.Mock).toHaveBeenCalledWith(
        expect.stringContaining("deadlock detected"),
      );
      expect(databaseServerMock.recordSighting).toHaveBeenCalledTimes(1);
    });

    test("a member someone else owns is never taken", async () => {
      arrange({ databases: atlasRows([10, 50, 20]) });
      const owners: Map<string, string> = arrangeDatabaseRows({
        [MEMBERS[0]!]: "atlas",
      });
      // Claimed by a person for another database between lookup and claim.
      endpointMock.claimEndpoint.mockImplementationOnce(async () => {
        return "owned-by-other";
      });

      await computeDependenciesForProject(WINDOW);

      expect(claims()).toHaveLength(2);
      expect(owners.get(MEMBERS[1]!)).toBeUndefined();
    });
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
      arrangeDatabaseRows(["a.example.com:5432", "b.example.com:5432"]);
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
