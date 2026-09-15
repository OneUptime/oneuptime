import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import { EntityRelationshipEdge } from "Common/Utils/Telemetry/EntityRelationship";
import {
  computeEntityKey,
  keyForService,
} from "Common/Utils/Telemetry/EntityKey";

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

import logger from "Common/Server/Utils/Logger";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ServiceService from "Common/Server/Services/ServiceService";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "Common/Server/Services/InventoryItemRelationshipService";
import { computeDependenciesForProject } from "../../../../FeatureSet/Workers/Jobs/TelemetryEntity/ComputeServiceDependencies";

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
}

function arrange(sources: Sources): void {
  spanMock.executeQuery.mockImplementation(async (sql: string) => {
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
