/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseServerService, {
  DatabaseSystemDetermination,
  DatabaseSystemEvidence,
  UpsertWorkloadDatabaseData,
  decideDatabaseSystem,
  getDatabaseSystemEvidenceForSource,
  getDatabaseSystemsOfFamily,
  getStoredDatabaseSystemEvidence,
  renameForDatabaseSystem,
} from "../../../Server/Services/DatabaseServerService";
import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
  DatabaseServerEndpointOwner,
} from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "../../../Server/Services/DatabaseServerLabelRuleEngineService";
import DatabaseServerOwnerRuleEngineService from "../../../Server/Services/DatabaseServerOwnerRuleEngineService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import logger from "../../../Server/Utils/Logger";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import DatabaseServerOwnerUser from "../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import { DatabaseServerFeedEventType } from "../../../Models/DatabaseModels/DatabaseServerFeed";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseServerDiscoverySource from "../../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import { DatabaseEndpoint } from "../../../Types/DatabaseServer/DatabaseEndpoint";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

/*
 * The lifecycle of a DatabaseServer row once it exists: which evidence may
 * change its engine and version, how discovered endpoints are kept honest,
 * handed over and released, which labels and owners count as a person
 * caring about it, and the collector path's auto-create budget.
 *
 * Everything external is mocked at its seam (no Postgres, no Redis); the SQL
 * itself is executed by DatabaseServerSqlPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const CLUSTER_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

const service: any = DatabaseServerService;

function databaseRow(overrides: Partial<DatabaseServer> = {}): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer(ObjectID.generate());
  row.projectId = PROJECT_ID;
  row.name = "PostgreSQL orders-db.example.com:5432";
  row.dbSystem = "postgresql";
  row.databaseIdentifier = "postgresql|orders-db.example.com:5432";
  row.serverAddress = "orders-db.example.com";
  row.serverPort = 5432;
  row.isArchived = false;
  Object.assign(row, overrides);
  return row;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

function silenceLogs(): {
  error: jest.SpyInstance;
  warn: jest.SpyInstance;
  info: jest.SpyInstance;
  debug: jest.SpyInstance;
} {
  return {
    error: jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    }),
    warn: jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    }),
    info: jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    }),
    debug: jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined as never;
    }),
  };
}

function mockFeed(): jest.SpyInstance {
  getJestSpyOn(service, "getDatabaseServerMarkdownLink").mockResolvedValue(
    "[Database x](/x)",
  );
  getJestSpyOn(
    DatabaseServerLabelRuleEngineService,
    "applyRulesToDatabaseServer",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    DatabaseServerOwnerRuleEngineService,
    "applyRulesToDatabaseServer",
  ).mockResolvedValue(undefined);
  return getJestSpyOn(
    DatabaseServerFeedService,
    "createDatabaseServerFeedItem",
  ).mockResolvedValue(undefined);
}

function mockRawQuery(result: unknown = []): jest.Mock {
  const query: jest.Mock = jest.fn(async () => {
    return result;
  });
  getJestSpyOn(service, "getRepository").mockReturnValue({
    manager: { query },
  } as never);
  return query;
}

function withEnv(name: string, value: string | undefined): () => void {
  const previous: string | undefined = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  };
}

function memberProps(): DatabaseCommonInteractionProps {
  const permission: UserPermission = {
    permission: Permission.ProjectMember,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [permission],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  DatabaseServerService.clearAutoCreateBudgetMemo();
});

/*
 * ---------------------------------------------------------------------------
 * Engine evidence - pure
 * ---------------------------------------------------------------------------
 */
describe("decideDatabaseSystem", () => {
  function decide(
    current: [string | null, DatabaseSystemEvidence | null],
    incoming: [string | null, DatabaseSystemEvidence],
  ): DatabaseSystemDetermination | null {
    return decideDatabaseSystem({
      current: { system: current[0], evidence: current[1] },
      incoming: { system: incoming[0], evidence: incoming[1] },
    });
  }

  const {
    Manual,
    Collector,
    Container,
    ClientSpans,
  }: typeof DatabaseSystemEvidence = DatabaseSystemEvidence;

  test("an engine a person chose is never changed - whatever the evidence", () => {
    for (const evidence of [Collector, Container, ClientSpans]) {
      expect(decide(["postgresql", Manual], ["mysql", evidence])).toBeNull();
      expect(decide(["redis", Manual], ["valkey", evidence])).toBeNull();
      expect(
        decide(["postgresql", Manual], ["postgresql", evidence]),
      ).toBeNull();
    }
  });

  test("a container image corrects the engine client spans guessed (pgx said PostgreSQL, the image says MySQL)", () => {
    expect(decide(["postgresql", ClientSpans], ["mysql", Container])).toEqual({
      system: "mysql",
      evidence: Container,
    });
  });

  test("a collector corrects what a container image said", () => {
    expect(decide(["mysql", Container], ["postgresql", Collector])).toEqual({
      system: "postgresql",
      evidence: Collector,
    });
  });

  test.each([
    [
      "client spans cannot override an image",
      "mysql",
      Container,
      "postgresql",
      ClientSpans,
    ],
    [
      "client spans cannot override a collector",
      "mysql",
      Collector,
      "postgresql",
      ClientSpans,
    ],
    [
      "an image cannot override a collector",
      "mysql",
      Collector,
      "mongodb",
      Container,
    ],
    [
      "equal evidence never flips a different engine back and forth",
      "postgresql",
      ClientSpans,
      "mysql",
      ClientSpans,
    ],
    [
      "two images disagreeing do not flip either",
      "mysql",
      Container,
      "mongodb",
      Container,
    ],
  ])(
    "%s",
    (
      _label: string,
      currentSystem: string,
      currentEvidence: DatabaseSystemEvidence,
      incomingSystem: string,
      incomingEvidence: DatabaseSystemEvidence,
    ) => {
      expect(
        decide(
          [currentSystem, currentEvidence],
          [incomingSystem, incomingEvidence],
        ),
      ).toBeNull();
    },
  );

  test.each([
    [
      "an image refines a collector's Redis to Valkey",
      "redis",
      Collector,
      "valkey",
      Container,
    ],
    [
      "client spans refine a collector's MySQL to MariaDB",
      "mysql",
      Collector,
      "mariadb",
      ClientSpans,
    ],
    [
      "an image refines trace-found PostgreSQL to CockroachDB",
      "postgresql",
      ClientSpans,
      "cockroachdb",
      Container,
    ],
    ["equal evidence may refine too", "redis", Container, "keydb", Container],
  ])(
    "within one family any source may refine the family engine to a fork: %s",
    (
      _label: string,
      currentSystem: string,
      currentEvidence: DatabaseSystemEvidence,
      incomingSystem: string,
      incomingEvidence: DatabaseSystemEvidence,
    ) => {
      expect(
        decide(
          [currentSystem, currentEvidence],
          [incomingSystem, incomingEvidence],
        ),
      ).toEqual({ system: incomingSystem, evidence: incomingEvidence });
    },
  );

  test("a fork is never downgraded back to its family engine - not even by a collector (the mysql receiver cannot tell MariaDB apart)", () => {
    expect(decide(["mariadb", Container], ["mysql", Collector])).toBeNull();
    expect(decide(["valkey", ClientSpans], ["redis", Collector])).toBeNull();
  });

  test("one fork replaces another only on stronger evidence", () => {
    expect(decide(["valkey", ClientSpans], ["keydb", Container])).toEqual({
      system: "keydb",
      evidence: Container,
    });
    expect(decide(["valkey", Container], ["keydb", Container])).toBeNull();
    expect(decide(["valkey", Collector], ["keydb", Container])).toBeNull();
  });

  test("the same engine on stronger evidence records that evidence, so weaker evidence cannot move it later", () => {
    expect(
      decide(["postgresql", ClientSpans], ["postgres", Container]),
    ).toEqual({
      system: "postgresql",
      evidence: Container,
    });
    expect(
      decide(["postgresql", Container], ["postgresql", Container]),
    ).toBeNull();
    expect(
      decide(["postgresql", Collector], ["postgresql", Container]),
    ).toBeNull();
  });

  test("aliases are compared normalized", () => {
    expect(decide(["postgresql", ClientSpans], ["PG", ClientSpans])).toBeNull();
  });

  test("a row with no engine takes the incoming one; empty evidence changes nothing", () => {
    expect(decide([null, null], ["Redis", ClientSpans])).toEqual({
      system: "redis",
      evidence: ClientSpans,
    });
    expect(decide(["redis", Collector], ["  ", Collector])).toBeNull();
    expect(decide(["redis", Collector], [null, Collector])).toBeNull();
  });

  test("a row whose evidence is unknown (no discovery source) yields to any source", () => {
    expect(decide(["postgresql", null], ["mysql", ClientSpans])).toEqual({
      system: "mysql",
      evidence: ClientSpans,
    });
  });
});

describe("getDatabaseSystemsOfFamily", () => {
  test("the family engine first, then its forks", () => {
    const redis: Array<string> = getDatabaseSystemsOfFamily("valkey");
    expect(redis[0]).toBe("redis");
    expect(redis).toEqual(expect.arrayContaining(["valkey", "keydb"]));
    expect(getDatabaseSystemsOfFamily("mariadb")).toEqual(
      expect.arrayContaining(["mysql", "mariadb"]),
    );
  });

  test("families never mix, and an unknown engine is a family of one", () => {
    expect(getDatabaseSystemsOfFamily("redis")).not.toContain("mysql");
    expect(getDatabaseSystemsOfFamily("acme-db")).toEqual(["acme-db"]);
    expect(getDatabaseSystemsOfFamily("")).toEqual([]);
  });
});

describe("engine evidence of a row", () => {
  test.each([
    [DatabaseServerDiscoverySource.Manual, DatabaseSystemEvidence.Manual],
    [DatabaseServerDiscoverySource.Collector, DatabaseSystemEvidence.Collector],
    [
      DatabaseServerDiscoverySource.Kubernetes,
      DatabaseSystemEvidence.Container,
    ],
    [DatabaseServerDiscoverySource.Docker, DatabaseSystemEvidence.Container],
    [DatabaseServerDiscoverySource.Podman, DatabaseSystemEvidence.Container],
    [
      DatabaseServerDiscoverySource.ClientSpans,
      DatabaseSystemEvidence.ClientSpans,
    ],
  ])("the %s source is %s evidence", (source: string, evidence: string) => {
    expect(getDatabaseSystemEvidenceForSource(source)).toBe(evidence);
  });

  test("an unknown source is no evidence", () => {
    expect(getDatabaseSystemEvidenceForSource("carrier-pigeon")).toBeNull();
    expect(getDatabaseSystemEvidenceForSource(undefined)).toBeNull();
  });

  test("a refinement's recorded evidence wins over the creating source; nonsense falls back to it", () => {
    expect(
      getStoredDatabaseSystemEvidence({
        dbSystemSource: "collector",
        discoverySource: "client-spans",
      }),
    ).toBe(DatabaseSystemEvidence.Collector);
    expect(
      getStoredDatabaseSystemEvidence({
        dbSystemSource: "guesswork",
        discoverySource: "kubernetes",
      }),
    ).toBe(DatabaseSystemEvidence.Container);
    expect(getStoredDatabaseSystemEvidence({ discoverySource: "manual" })).toBe(
      DatabaseSystemEvidence.Manual,
    );
  });
});

describe("renameForDatabaseSystem", () => {
  test("an endpoint row still carrying its generated name is renamed for the new engine", () => {
    expect(
      renameForDatabaseSystem(
        {
          name: "PostgreSQL cockroachdb-public.crdb.svc.cluster.local:26257",
          dbSystem: "postgresql",
          serverAddress: "cockroachdb-public.crdb.svc.cluster.local",
          serverPort: 26257,
        },
        "cockroachdb",
      ),
    ).toBe("CockroachDB cockroachdb-public.crdb.svc.cluster.local:26257");
  });

  test("a workload row still carrying its generated name is renamed for the new engine", () => {
    expect(
      renameForDatabaseSystem(
        {
          name: "Redis cache/redis",
          dbSystem: "redis",
          serverAddress: "redis.cache.svc.cluster.local",
          serverPort: 6379,
          kubernetesNamespace: "cache",
          workloadName: "redis",
        },
        "valkey",
      ),
    ).toBe("Valkey cache/redis");
  });

  test("a name a person chose is kept", () => {
    expect(
      renameForDatabaseSystem(
        {
          name: "Orders primary",
          dbSystem: "postgresql",
          serverAddress: "orders-db.example.com",
          serverPort: 5432,
        },
        "cockroachdb",
      ),
    ).toBeNull();
  });

  test("nothing to rename without a name or an engine", () => {
    expect(
      renameForDatabaseSystem(
        { dbSystem: "postgresql", serverAddress: "x.example.com" },
        "mysql",
      ),
    ).toBeNull();
    expect(
      renameForDatabaseSystem(
        {
          name: "PostgreSQL x.example.com:5432",
          serverAddress: "x.example.com",
        },
        "mysql",
      ),
    ).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The workload path: engine, version and the alias lifecycle
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.upsertWorkloadDatabase - lifecycle", () => {
  interface StoredEndpointFixture {
    id: ObjectID;
    databaseServerId: string;
    source: string;
    isPrimary: boolean;
    lastMatchedAt: Date | null;
  }

  interface World {
    rows: Map<string, DatabaseServer>;
    endpoints: Map<string, StoredEndpointFixture>;
    writes: Array<{ id: string; data: Record<string, unknown>; expected: any }>;
    claims: Array<any>;
    transfers: Array<any>;
    untouchedTraceRows: Set<string>;
  }

  let world: World;
  let feed: jest.SpyInstance;
  let logs: ReturnType<typeof silenceLogs>;
  let refresh: jest.SpyInstance;
  let release: jest.SpyInstance;
  let hasPrimary: jest.SpyInstance;
  let rawQuery: jest.Mock;

  const WORKLOAD: string = "redis|kubernetes:prod/cache/statefulset/redis";
  const OLD_WORKLOAD: string = "redis|kubernetes:prod/cache/deployment/redis";
  const SERVICE_ALIAS: string = "redis.cache.svc.cluster.local:6379@prod";
  const POD_ALIAS: string =
    "redis-0.redis-hl.cache.svc.cluster.local:6379@prod";

  function input(
    overrides: Partial<UpsertWorkloadDatabaseData> = {},
  ): UpsertWorkloadDatabaseData {
    return {
      projectId: PROJECT_ID,
      workloadIdentifier: WORKLOAD,
      dbSystem: "redis",
      displayName: "Redis cache/redis",
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      aliases: [SERVICE_ALIAS, POD_ALIAS],
      memberKeysSeenNow: [],
      instanceCount: 1,
      dbVersion: "7.2",
      kubernetesClusterId: CLUSTER_ID,
      kubernetesNamespace: "cache",
      workloadKind: "StatefulSet",
      workloadName: "redis",
      allowCreate: true,
      ...overrides,
    };
  }

  function addRow(row: DatabaseServer): DatabaseServer {
    world.rows.set(row.id!.toString(), row);
    return row;
  }

  function workloadRow(
    overrides: Partial<DatabaseServer> = {},
  ): DatabaseServer {
    return addRow(
      databaseRow({
        name: "Redis cache/redis",
        dbSystem: "redis",
        databaseIdentifier: WORKLOAD,
        workloadIdentifier: WORKLOAD,
        workloadName: "redis",
        kubernetesNamespace: "cache",
        serverAddress: "redis.cache.svc.cluster.local",
        serverPort: 6379,
        discoverySource: DatabaseServerDiscoverySource.Kubernetes,
        workloadLastSeenAt: new Date(),
        ...overrides,
      }),
    );
  }

  function own(
    endpoint: string,
    row: DatabaseServer,
    overrides: Partial<StoredEndpointFixture> = {},
  ): StoredEndpointFixture {
    const stored: StoredEndpointFixture = {
      id: ObjectID.generate(),
      databaseServerId: row.id!.toString(),
      source: "workload",
      isPrimary: false,
      lastMatchedAt: new Date(),
      ...overrides,
    };
    world.endpoints.set(endpoint, stored);
    return stored;
  }

  function lastWriteFor(row: DatabaseServer): Record<string, unknown> {
    const writes: Array<{ id: string; data: Record<string, unknown> }> =
      world.writes.filter((w: { id: string }) => {
        return w.id === row.id!.toString();
      });
    return writes[writes.length - 1]!.data;
  }

  beforeEach(() => {
    logs = silenceLogs();
    world = {
      rows: new Map(),
      endpoints: new Map(),
      writes: [],
      claims: [],
      transfers: [],
      untouchedTraceRows: new Set(),
    };
    feed = mockFeed();

    getJestSpyOn(service, "findOneBy").mockImplementation(
      async (findOneBy: any) => {
        for (const row of world.rows.values()) {
          if (
            findOneBy.query.workloadIdentifier !== undefined &&
            row.workloadIdentifier !== findOneBy.query.workloadIdentifier
          ) {
            continue;
          }
          if (
            findOneBy.query._id &&
            row.id!.toString() !== findOneBy.query._id.toString()
          ) {
            continue;
          }
          return row;
        }
        return null;
      },
    );

    getJestSpyOn(service, "findBy").mockImplementation(async (findBy: any) => {
      const wanted: Array<string> = [];
      const operator: any = findBy.query._id || findBy.query.workloadIdentifier;
      for (const values of Object.values(
        operator.objectLiteralParameters || {},
      )) {
        wanted.push(...(values as Array<string>));
      }
      if (findBy.query.workloadIdentifier) {
        // The engine-family lookup: rows by workload identifier.
        return Array.from(world.rows.values()).filter((row: DatabaseServer) => {
          return Boolean(
            row.workloadIdentifier && wanted.includes(row.workloadIdentifier),
          );
        });
      }
      return wanted
        .map((id: string) => {
          return world.rows.get(id);
        })
        .filter(Boolean);
    });

    getJestSpyOn(DatabaseServerEndpointService, "findBy").mockImplementation(
      async (findBy: any) => {
        const wanted: Array<string> = [];
        for (const values of Object.values(
          findBy.query.endpoint.objectLiteralParameters || {},
        )) {
          wanted.push(...(values as Array<string>));
        }
        const rows: Array<DatabaseServerEndpoint> = [];
        for (const endpoint of wanted) {
          const stored: StoredEndpointFixture | undefined =
            world.endpoints.get(endpoint);
          if (stored) {
            const row: DatabaseServerEndpoint = new DatabaseServerEndpoint(
              stored.id,
            );
            row.endpoint = endpoint;
            row.databaseServerId = new ObjectID(stored.databaseServerId);
            row.source = stored.source;
            row.isPrimary = stored.isPrimary;
            if (stored.lastMatchedAt) {
              row.lastMatchedAt = stored.lastMatchedAt;
            }
            rows.push(row);
          }
        }
        return rows;
      },
    );

    getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockImplementation(
      async (claim: any): Promise<DatabaseServerEndpointClaimResult> => {
        world.claims.push(claim);
        if (world.endpoints.has(claim.endpoint)) {
          return "owned-by-other";
        }
        world.endpoints.set(claim.endpoint, {
          id: ObjectID.generate(),
          databaseServerId: claim.databaseServerId.toString(),
          source: claim.source,
          isPrimary: claim.isPrimary,
          lastMatchedAt: new Date(),
        });
        return "claimed";
      },
    );

    getJestSpyOn(
      DatabaseServerEndpointService,
      "transferEndpoint",
    ).mockImplementation(async (transfer: any) => {
      world.transfers.push(transfer);
      for (const stored of world.endpoints.values()) {
        if (stored.id.toString() === transfer.endpointId.toString()) {
          if (
            stored.databaseServerId !== transfer.fromDatabaseServerId.toString()
          ) {
            return false;
          }
          stored.databaseServerId = transfer.toDatabaseServerId.toString();
          stored.source = "workload";
          stored.isPrimary = transfer.isPrimary;
          return true;
        }
      }
      return false;
    });

    refresh = getJestSpyOn(
      DatabaseServerEndpointService,
      "refreshMatchedEndpoints",
    ).mockResolvedValue(undefined);
    release = getJestSpyOn(
      DatabaseServerEndpointService,
      "releaseUnproducedWorkloadEndpoints",
    ).mockResolvedValue([]);
    hasPrimary = getJestSpyOn(
      DatabaseServerEndpointService,
      "hasPrimaryEndpoint",
    ).mockResolvedValue(true);

    getJestSpyOn(service, "updateColumnsByIdWithoutHooks").mockImplementation(
      async (update: any) => {
        const row: DatabaseServer | undefined = world.rows.get(
          update.id.toString(),
        );
        if (!row) {
          return;
        }
        world.writes.push({
          id: update.id.toString(),
          data: update.data,
          expected: update.expectedData,
        });
        Object.assign(row, update.data);
      },
    );

    getJestSpyOn(service, "create").mockImplementation(
      async (createBy: any) => {
        const row: DatabaseServer = createBy.data;
        row._id = ObjectID.generate().toString();
        addRow(row);
        return row;
      },
    );

    // Raw SQL: the untouched-duplicate lookup, and restores.
    rawQuery = jest.fn(async (sql: string, params: Array<unknown>) => {
      if (sql.includes(`ds."workloadIdentifier" IS NULL`)) {
        return (params[1] as Array<string>)
          .filter((id: string) => {
            return world.untouchedTraceRows.has(id);
          })
          .map((id: string) => {
            return { _id: id };
          });
      }
      return [];
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      manager: { query: rawQuery },
    } as never);
  });

  describe("engine and version", () => {
    test("an adopted trace row named after the wrong engine is corrected by the image, and renamed", async () => {
      const tracesRow: DatabaseServer = addRow(
        databaseRow({
          name: "PostgreSQL cockroachdb-public.crdb.svc.cluster.local:26257",
          dbSystem: "postgresql",
          serverAddress: "cockroachdb-public.crdb.svc.cluster.local",
          serverPort: 26257,
          discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        }),
      );
      const alias: string =
        "cockroachdb-public.crdb.svc.cluster.local:26257@prod";
      own(alias, tracesRow, { source: "auto", isPrimary: true });

      const result: DatabaseServer | null =
        await DatabaseServerService.upsertWorkloadDatabase(
          input({
            workloadIdentifier:
              "cockroachdb|kubernetes:prod/crdb/statefulset/cockroachdb",
            dbSystem: "cockroachdb",
            aliases: [alias],
            kubernetesNamespace: "crdb",
            workloadName: "cockroachdb",
          }),
        );

      expect(result).toBe(tracesRow);
      const write: Record<string, unknown> = lastWriteFor(tracesRow);
      expect(write["dbSystem"]).toBe("cockroachdb");
      expect(write["dbSystemSource"]).toBe("container");
      expect(write["name"]).toBe(
        "CockroachDB cockroachdb-public.crdb.svc.cluster.local:26257",
      );
      expect(tracesRow.dbSystem).toBe("cockroachdb");

      await flushPromises();
      const item: any = feed.mock.calls.find((call: any) => {
        return (
          call[0].databaseServerFeedEventType ===
          DatabaseServerFeedEventType.DatabaseServerUpdated
        );
      })![0];
      expect(item.feedInfoInMarkdown).toContain(
        "is now identified as **CockroachDB** (it was shown as PostgreSQL), from its container image.",
      );
    });

    test("a name a person gave the adopted row survives the engine correction", async () => {
      const tracesRow: DatabaseServer = addRow(
        databaseRow({
          name: "Orders (prod)",
          dbSystem: "postgresql",
          discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        }),
      );
      own("orders-db.example.com:5432", tracesRow, { source: "auto" });

      await DatabaseServerService.upsertWorkloadDatabase(
        input({
          workloadIdentifier: "mysql|kubernetes:prod/data/statefulset/orders",
          dbSystem: "mysql",
          aliases: ["orders-db.example.com:5432"],
        }),
      );

      const write: Record<string, unknown> = lastWriteFor(tracesRow);
      expect(write["dbSystem"]).toBe("mysql");
      expect("name" in write).toBe(false);
      expect(tracesRow.name).toBe("Orders (prod)");
    });

    test("a manually added database adopted by a workload keeps the engine the person chose", async () => {
      const manual: DatabaseServer = addRow(
        databaseRow({
          name: "Orders",
          dbSystem: "postgresql",
          discoverySource: DatabaseServerDiscoverySource.Manual,
        }),
      );
      own("orders-db.example.com:5432", manual, {
        source: "user",
        isPrimary: true,
      });

      await DatabaseServerService.upsertWorkloadDatabase(
        input({
          workloadIdentifier: "mysql|kubernetes:prod/data/statefulset/orders",
          dbSystem: "mysql",
          aliases: ["orders-db.example.com:5432"],
        }),
      );

      const write: Record<string, unknown> = lastWriteFor(manual);
      expect("dbSystem" in write).toBe(false);
      expect("dbSystemSource" in write).toBe(false);
      expect(manual.dbSystem).toBe("postgresql");
    });

    test("an image refines the workload's Redis to Valkey", async () => {
      const row: DatabaseServer = workloadRow();

      await DatabaseServerService.upsertWorkloadDatabase(
        input({ dbSystem: "valkey" }),
      );

      const write: Record<string, unknown> = lastWriteFor(row);
      expect(write["dbSystem"]).toBe("valkey");
      expect(write["name"]).toBe("Valkey cache/redis");
    });

    test("an image moving from Redis to Valkey keeps the SAME database: re-keyed, refined and renamed", async () => {
      const row: DatabaseServer = workloadRow();
      own(SERVICE_ALIAS, row, { isPrimary: true });
      const valkeyWorkload: string =
        "valkey|kubernetes:prod/cache/statefulset/redis";

      const result: DatabaseServer | null =
        await DatabaseServerService.upsertWorkloadDatabase(
          input({ workloadIdentifier: valkeyWorkload, dbSystem: "valkey" }),
        );

      expect(result).toBe(row);
      expect(Array.from(world.rows.values())).toHaveLength(1);
      // Re-keyed with a compare-and-set on the old identifier.
      const rekey: any = world.writes.find((write: any) => {
        return write.data.workloadIdentifier === valkeyWorkload;
      });
      expect(rekey.expected).toEqual({ workloadIdentifier: WORKLOAD });
      const write: Record<string, unknown> = lastWriteFor(row);
      expect(write["dbSystem"]).toBe("valkey");
      expect(write["name"]).toBe("Valkey cache/redis");
      // Its endpoints stayed where they were.
      expect(world.endpoints.get(SERVICE_ALIAS)!.databaseServerId).toBe(
        row.id!.toString(),
      );
      expect(logs.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `workload ${WORKLOAD} is now ${valkeyWorkload}`,
        ),
        expect.anything(),
      );
    });

    test("a workload of another engine family is a different database - never re-keyed", async () => {
      workloadRow({
        workloadIdentifier:
          "postgresql|kubernetes:prod/cache/statefulset/redis",
        dbSystem: "postgresql",
      });

      await DatabaseServerService.upsertWorkloadDatabase(
        input({
          workloadIdentifier: "mysql|kubernetes:prod/cache/statefulset/redis",
          dbSystem: "mysql",
          aliases: [],
        }),
      );

      expect(Array.from(world.rows.values())).toHaveLength(2);
    });

    test("two same-family candidates are ambiguous: neither is re-keyed", async () => {
      const redis: DatabaseServer = workloadRow();
      const keydb: DatabaseServer = workloadRow({
        workloadIdentifier: "keydb|kubernetes:prod/cache/statefulset/redis",
        dbSystem: "keydb",
      });

      await DatabaseServerService.upsertWorkloadDatabase(
        input({
          workloadIdentifier: "valkey|kubernetes:prod/cache/statefulset/redis",
          dbSystem: "valkey",
          aliases: [],
        }),
      );

      expect(Array.from(world.rows.values())).toHaveLength(3);
      expect(redis.workloadIdentifier).toBe(WORKLOAD);
      expect(keydb.workloadIdentifier).toBe(
        "keydb|kubernetes:prod/cache/statefulset/redis",
      );
    });

    test("a row created in this run is not re-weighed", async () => {
      await DatabaseServerService.upsertWorkloadDatabase(input());

      const created: DatabaseServer = Array.from(world.rows.values())[0]!;
      expect("dbSystemSource" in lastWriteFor(created)).toBe(false);
    });

    test("while a collector reports the engine's own version, the image tag does not overwrite it", async () => {
      const row: DatabaseServer = workloadRow({
        dbVersion: "7.2.4",
        collectorLastSeenAt: new Date(Date.now() - 2 * MINUTE_MS),
      });

      await DatabaseServerService.upsertWorkloadDatabase(
        input({ dbVersion: "7.2" }),
      );

      expect("dbVersion" in lastWriteFor(row)).toBe(false);
      expect(row.dbVersion).toBe("7.2.4");
    });

    test("once the collector is quiet, the image tag is the version again", async () => {
      const row: DatabaseServer = workloadRow({
        dbVersion: "7.2.4",
        collectorLastSeenAt: new Date(Date.now() - 2 * HOUR_MS),
      });

      await DatabaseServerService.upsertWorkloadDatabase(
        input({ dbVersion: "7.4" }),
      );

      expect(lastWriteFor(row)["dbVersion"]).toBe("7.4");
    });

    test("a live collector that reported no version leaves the image tag to fill it", async () => {
      const row: DatabaseServer = workloadRow({
        collectorLastSeenAt: new Date(),
      });

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(lastWriteFor(row)["dbVersion"]).toBe("7.2");
    });

    test("the workload's last sighting is stamped on every run", async () => {
      const row: DatabaseServer = workloadRow({
        workloadLastSeenAt: new Date(Date.now() - 3 * HOUR_MS),
      });
      const before: number = Date.now();

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(
        (lastWriteFor(row)["workloadLastSeenAt"] as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);
    });
  });

  describe("endpoints held by another row", () => {
    test("a Deployment moved to a StatefulSet: the gone workload's Service alias is handed to the new one", async () => {
      const oldRow: DatabaseServer = workloadRow({
        workloadIdentifier: OLD_WORKLOAD,
        databaseIdentifier: OLD_WORKLOAD,
        workloadLastSeenAt: new Date(Date.now() - 2 * HOUR_MS),
      });
      const moved: StoredEndpointFixture = own(SERVICE_ALIAS, oldRow, {
        isPrimary: true,
      });

      const result: DatabaseServer | null =
        await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(result).not.toBe(oldRow);
      expect(world.transfers).toHaveLength(1);
      const transfer: any = world.transfers[0];
      expect(transfer.endpointId.toString()).toBe(moved.id.toString());
      expect(transfer.fromDatabaseServerId.toString()).toBe(
        oldRow.id!.toString(),
      );
      expect(transfer.toDatabaseServerId.toString()).toBe(
        result!.id!.toString(),
      );
      // The new row's first alias was taken, so the moved one is its primary.
      expect(transfer.isPrimary).toBe(true);
      expect(world.endpoints.get(SERVICE_ALIAS)!.databaseServerId).toBe(
        result!.id!.toString(),
      );
      expect(logs.info).toHaveBeenCalledWith(
        expect.stringContaining("its workload is gone"),
        expect.anything(),
      );
    });

    test("a workload that is still running keeps its aliases - no tie-break between two live workloads", async () => {
      const liveRow: DatabaseServer = workloadRow({
        workloadIdentifier: OLD_WORKLOAD,
        databaseIdentifier: OLD_WORKLOAD,
        workloadLastSeenAt: new Date(Date.now() - 10 * MINUTE_MS),
      });
      own(SERVICE_ALIAS, liveRow);

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(world.transfers).toHaveLength(0);
      expect(world.endpoints.get(SERVICE_ALIAS)!.databaseServerId).toBe(
        liveRow.id!.toString(),
      );
    });

    test("a person's endpoint is never taken, whoever holds it", async () => {
      const oldRow: DatabaseServer = workloadRow({
        workloadIdentifier: OLD_WORKLOAD,
        databaseIdentifier: OLD_WORKLOAD,
        workloadLastSeenAt: new Date(Date.now() - 10 * HOUR_MS),
      });
      own(SERVICE_ALIAS, oldRow, { source: "user" });

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(world.transfers).toHaveLength(0);
    });

    test("the create race: an untouched duplicate that application traces created hands its endpoint over", async () => {
      const row: DatabaseServer = workloadRow();
      const duplicate: DatabaseServer = addRow(
        databaseRow({
          name: "Redis redis.cache.svc.cluster.local:6379",
          dbSystem: "redis",
          discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        }),
      );
      own(SERVICE_ALIAS, duplicate, { source: "auto", isPrimary: true });
      world.untouchedTraceRows.add(duplicate.id!.toString());
      hasPrimary.mockResolvedValue(false);

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(world.transfers).toHaveLength(1);
      expect(world.transfers[0].toDatabaseServerId.toString()).toBe(
        row.id!.toString(),
      );
      // An existing row with no primary is asked, then given one.
      expect(hasPrimary).toHaveBeenCalledTimes(1);
      expect(world.transfers[0].isPrimary).toBe(true);
      expect(logs.info).toHaveBeenCalledWith(
        expect.stringContaining("an untouched duplicate"),
        expect.anything(),
      );

      // The duplicate lookup is one project-scoped statement for the candidates.
      const [sql, params] = rawQuery.mock.calls.find((call: any) => {
        return String(call[0]).includes(`ds."workloadIdentifier" IS NULL`);
      }) as [string, Array<unknown>];
      expect(sql).toContain(`ds."projectId" = $1`);
      expect(sql).toContain(`ds."_id" = ANY($2::uuid[])`);
      expect(sql).toContain(`ds."discoverySource" = $3`);
      expect(sql).toContain(`NOT EXISTS`);
      expect(params[0]).toBe(PROJECT_ID.toString());
      expect(params[1]).toEqual([duplicate.id!.toString()]);
      expect(params[2]).toBe("client-spans");
    });

    test("a trace-discovered row somebody invested in keeps its endpoint", async () => {
      workloadRow();
      const invested: DatabaseServer = addRow(
        databaseRow({
          dbSystem: "redis",
          discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        }),
      );
      own(SERVICE_ALIAS, invested, { source: "auto" });
      // Not in world.untouchedTraceRows: labelled, owned, linked ...

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(world.transfers).toHaveLength(0);
    });

    test.each([
      [DatabaseServerDiscoverySource.Collector],
      [DatabaseServerDiscoverySource.Manual],
    ])(
      "a %s row never hands over its endpoints to a workload",
      async (source: DatabaseServerDiscoverySource) => {
        workloadRow();
        const configured: DatabaseServer = addRow(
          databaseRow({ dbSystem: "redis", discoverySource: source }),
        );
        own(SERVICE_ALIAS, configured, { source: "auto" });
        world.untouchedTraceRows.add(configured.id!.toString());

        await DatabaseServerService.upsertWorkloadDatabase(input());

        expect(world.transfers).toHaveLength(0);
      },
    );

    test("an existing row that already has a primary gets a moved alias as a plain alias", async () => {
      workloadRow();
      const oldRow: DatabaseServer = workloadRow({
        workloadIdentifier: OLD_WORKLOAD,
        databaseIdentifier: OLD_WORKLOAD,
        workloadLastSeenAt: new Date(Date.now() - 2 * HOUR_MS),
      });
      own(POD_ALIAS, oldRow);

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(world.transfers).toHaveLength(1);
      expect(world.transfers[0].isPrimary).toBe(false);
    });

    test("a failing hand-over never fails the run", async () => {
      const row: DatabaseServer = workloadRow();
      const oldRow: DatabaseServer = workloadRow({
        workloadIdentifier: OLD_WORKLOAD,
        databaseIdentifier: OLD_WORKLOAD,
        workloadLastSeenAt: new Date(Date.now() - 2 * HOUR_MS),
      });
      own(POD_ALIAS, oldRow);
      (
        DatabaseServerEndpointService.transferEndpoint as unknown as jest.SpyInstance
      ).mockRejectedValue(new Error("deadlock detected"));

      await expect(
        DatabaseServerService.upsertWorkloadDatabase(input()),
      ).resolves.toBe(row);
      expect(logs.warn).toHaveBeenCalledWith(
        expect.stringContaining("taking over endpoints"),
        expect.anything(),
      );
    });
  });

  describe("endpoints this row holds", () => {
    test("aliases produced again are re-stamped when their last match is over an hour old", async () => {
      const row: DatabaseServer = workloadRow();
      own(SERVICE_ALIAS, row, {
        lastMatchedAt: new Date(Date.now() - 2 * HOUR_MS),
      });
      own(POD_ALIAS, row, { lastMatchedAt: new Date() });

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(refresh).toHaveBeenCalledTimes(1);
      const call: any = refresh.mock.calls[0]![0];
      expect(call.endpoints).toEqual([SERVICE_ALIAS]);
      expect(call.databaseServerId.toString()).toBe(row.id!.toString());
      expect(call.now.getTime() - call.staleBefore.getTime()).toBe(HOUR_MS);
    });

    test("nothing stale, nothing re-stamped", async () => {
      const row: DatabaseServer = workloadRow();
      own(SERVICE_ALIAS, row);
      own(POD_ALIAS, row);

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(refresh).not.toHaveBeenCalled();
    });

    test("aliases the workload no longer produces are released after two hours - an unqualified alias once the project has two clusters", async () => {
      const row: DatabaseServer = workloadRow();

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(release).toHaveBeenCalledTimes(1);
      const call: any = release.mock.calls[0]![0];
      expect(call.projectId).toBe(PROJECT_ID);
      expect(call.databaseServerId.toString()).toBe(row.id!.toString());
      expect(call.keepEndpoints).toEqual([SERVICE_ALIAS, POD_ALIAS]);
      expect(Date.now() - call.staleBefore.getTime()).toBeGreaterThanOrEqual(
        2 * HOUR_MS - 1000,
      );
      expect(Date.now() - call.staleBefore.getTime()).toBeLessThanOrEqual(
        2 * HOUR_MS + 5000,
      );
    });

    test("a released alias is logged", async () => {
      workloadRow();
      release.mockResolvedValue(["redis.cache.svc.cluster.local:6379"]);

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(logs.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "released 1 endpoint(s) workload redis|kubernetes:prod/cache/statefulset/redis no longer serves: redis.cache.svc.cluster.local:6379",
        ),
        expect.anything(),
      );
    });

    test("a container workload has no aliases to release", async () => {
      await DatabaseServerService.upsertWorkloadDatabase(
        input({
          workloadIdentifier: "redis|docker:web-01/cache",
          discoverySource: DatabaseServerDiscoverySource.Docker,
          aliases: [],
          kubernetesClusterId: undefined,
          kubernetesNamespace: undefined,
          workloadKind: "Container",
          workloadName: "cache",
        }),
      );

      expect(release).not.toHaveBeenCalled();
    });

    test("a failing release never fails the run", async () => {
      const row: DatabaseServer = workloadRow();
      release.mockRejectedValue(new Error("connection terminated"));

      await expect(
        DatabaseServerService.upsertWorkloadDatabase(input()),
      ).resolves.toBe(row);
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * The endpoint path: sightings and the collector's auto-create budget
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.findOrCreateByEndpoint - lifecycle", () => {
  const ENDPOINT: DatabaseEndpoint = {
    host: "orders-db.example.com",
    port: 5432,
  };

  let findOwner: jest.SpyInstance;
  let findOneBy: jest.SpyInstance;
  let create: jest.SpyInstance;
  let mark: jest.SpyInstance;
  let writes: jest.SpyInstance;
  let rawQuery: jest.Mock;
  let logs: ReturnType<typeof silenceLogs>;

  function ownedBy(row: DatabaseServer): DatabaseServerEndpointOwner {
    return {
      databaseServerId: row.id!,
      isPrimary: true,
      endpointId: ObjectID.generate(),
      source: "auto",
      lastMatchedAt: new Date(Date.now() - 2 * HOUR_MS),
    };
  }

  beforeEach(() => {
    logs = silenceLogs();
    mockFeed();
    findOwner = getJestSpyOn(
      DatabaseServerEndpointService,
      "findOwnerByEndpoint",
    ).mockResolvedValue(null);
    findOneBy = getJestSpyOn(service, "findOneBy").mockResolvedValue(null);
    create = getJestSpyOn(service, "create").mockImplementation(
      async (input: any) => {
        input.data._id = ObjectID.generate().toString();
        return input.data;
      },
    );
    getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("claimed");
    mark = getJestSpyOn(
      DatabaseServerEndpointService,
      "markEndpointMatched",
    ).mockResolvedValue(undefined);
    writes = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    rawQuery = mockRawQuery([]);
  });

  test("a sighting of an owned endpoint records the match on the endpoint", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    const owner: DatabaseServerEndpointOwner = ownedBy(row);
    findOwner.mockResolvedValue(owner);
    findOneBy.mockResolvedValue(row);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "postgresql",
      endpoint: ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      allowCreate: false,
    });

    expect(mark).toHaveBeenCalledWith(owner);
  });

  test("a collector reporting a different engine corrects a trace-found row - one compare-and-set write, renamed", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "mysql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      });

    expect(result).toBe(row);
    expect(create).not.toHaveBeenCalled();
    expect(writes).toHaveBeenCalledTimes(1);
    const write: any = writes.mock.calls[0]![0];
    expect(write.id.toString()).toBe(row.id!.toString());
    expect(write.data).toEqual({
      dbSystem: "mysql",
      dbSystemSource: "collector",
      name: "MySQL orders-db.example.com:5432",
    });
    expect(write.expectedData).toEqual({ dbSystem: "postgresql" });
    expect(write.skipUpdateDateColumn).toBe(false);
    expect(row.dbSystem).toBe("mysql");
    expect(row.name).toBe("MySQL orders-db.example.com:5432");
  });

  test("client spans reporting a different engine change nothing on a collector row", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.Collector,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "mysql",
      endpoint: ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      allowCreate: false,
    });

    expect(writes).not.toHaveBeenCalled();
    expect(row.dbSystem).toBe("postgresql");
  });

  test("a failed engine write never fails the lookup", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    writes.mockRejectedValue(new Error("connection terminated"));

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "mysql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: false,
      }),
    ).resolves.toBe(row);
    expect(row.dbSystem).toBe("postgresql");
    expect(logs.warn).toHaveBeenCalled();
  });

  test("an auto-archived row of a workload that is gone is NOT brought back by a stale alias", async () => {
    const row: DatabaseServer = databaseRow({
      workloadIdentifier: "redis|kubernetes:prod/cache/deployment/redis",
      workloadLastSeenAt: new Date(Date.now() - 8 * 24 * HOUR_MS),
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: false,
      });

    expect(result).toBe(row);
    expect(rawQuery).not.toHaveBeenCalled();
    expect(row.isArchived).toBe(true);
  });

  test("an auto-archived row that is not a gone workload is restored as before", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    rawQuery.mockResolvedValue([{ _id: row.id!.toString() }]);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "postgresql",
      endpoint: ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      allowCreate: false,
    });

    expect(row.isArchived).toBe(false);
  });

  describe("the collector's auto-create budget", () => {
    let restoreEnv: () => void;

    beforeEach(() => {
      restoreEnv = withEnv("DATABASE_SERVER_AUTO_CREATE_BUDGET", "2");
    });

    afterEach(() => {
      restoreEnv();
    });

    function collectorCreate(host: string): Promise<DatabaseServer | null> {
      return DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: { host: host, port: 5432 },
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      });
    }

    test("under budget: created, and the count is read once for the minute", async () => {
      rawQuery.mockResolvedValue([{ count: 0 }]);

      await expect(collectorCreate("a.example.com")).resolves.not.toBeNull();

      expect(create).toHaveBeenCalledTimes(1);
      const countCalls: Array<any> = rawQuery.mock.calls.filter((call: any) => {
        return String(call[0]).includes(`COUNT(*)`);
      });
      expect(countCalls).toHaveLength(1);
      expect(countCalls[0][1]).toEqual([PROJECT_ID.toString(), "manual"]);
    });

    test("over budget: nothing is created, null is returned, and one warning says why", async () => {
      rawQuery.mockResolvedValue([{ count: 2 }]);

      await expect(collectorCreate("a.example.com")).resolves.toBeNull();
      await expect(collectorCreate("b.example.com")).resolves.toBeNull();

      expect(create).not.toHaveBeenCalled();
      const budgetWarnings: Array<any> = logs.warn.mock.calls.filter(
        (call: any) => {
          return String(call[0]).includes("reached its auto-create budget");
        },
      );
      expect(budgetWarnings).toHaveLength(1);
      expect(budgetWarnings[0][0]).toContain(
        "DATABASE_SERVER_AUTO_CREATE_BUDGET=2",
      );
      expect(budgetWarnings[0][0]).toContain("a.example.com:5432");
    });

    test("creates in between count against the cached number, so a burst stops at the budget", async () => {
      rawQuery.mockResolvedValue([{ count: 1 }]);

      await expect(collectorCreate("a.example.com")).resolves.not.toBeNull();
      await expect(collectorCreate("b.example.com")).resolves.toBeNull();

      expect(create).toHaveBeenCalledTimes(1);
      const countCalls: Array<any> = rawQuery.mock.calls.filter((call: any) => {
        return String(call[0]).includes(`COUNT(*)`);
      });
      expect(countCalls).toHaveLength(1);
    });

    test("an unreadable count creates nothing (fail closed) and says so", async () => {
      rawQuery.mockRejectedValue(new Error("connection terminated"));

      await expect(collectorCreate("a.example.com")).resolves.toBeNull();

      expect(create).not.toHaveBeenCalled();
      expect(logs.error).toHaveBeenCalledWith(
        expect.stringContaining("auto-create budget check failed"),
        expect.anything(),
      );
    });

    test("a known endpoint costs no budget read at all", async () => {
      const row: DatabaseServer = databaseRow({
        discoverySource: DatabaseServerDiscoverySource.Collector,
      });
      findOwner.mockResolvedValue(ownedBy(row));
      findOneBy.mockResolvedValue(row);

      await collectorCreate("orders-db.example.com");

      expect(
        rawQuery.mock.calls.filter((call: any) => {
          return String(call[0]).includes(`COUNT(*)`);
        }),
      ).toHaveLength(0);
    });

    test("the trace path asks its own budget (AutoCreateBudget) - none is read here", async () => {
      rawQuery.mockResolvedValue([{ count: 99 }]);

      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

      expect(create).toHaveBeenCalledTimes(1);
    });

    test("a zero budget turns collector auto-creation off without a query", async () => {
      restoreEnv();
      restoreEnv = withEnv("DATABASE_SERVER_AUTO_CREATE_BUDGET", "0");

      await expect(collectorCreate("a.example.com")).resolves.toBeNull();
      expect(rawQuery).not.toHaveBeenCalled();
    });
  });
});

describe("DatabaseServerService.isUnderAutoCreateBudgetCached", () => {
  test("reads the count once a minute per project", async () => {
    const query: jest.Mock = mockRawQuery([{ count: 3 }]);
    const nowSpy: jest.SpyInstance = jest.spyOn(Date, "now");
    const start: number = Date.parse("2026-09-24T10:00:00Z");
    nowSpy.mockReturnValue(start);

    await expect(
      DatabaseServerService.isUnderAutoCreateBudgetCached(PROJECT_ID),
    ).resolves.toBe(true);
    nowSpy.mockReturnValue(start + 30 * 1000);
    await DatabaseServerService.isUnderAutoCreateBudgetCached(PROJECT_ID);
    expect(query).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(start + 61 * 1000);
    await DatabaseServerService.isUnderAutoCreateBudgetCached(PROJECT_ID);
    expect(query).toHaveBeenCalledTimes(2);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Collector heartbeat: engine evidence behind the ten-minute gate
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.recordCollectorHeartbeat - engine evidence", () => {
  const DATABASE_ID: ObjectID = ObjectID.generate();
  let cache: Map<string, string>;
  let findOneById: jest.SpyInstance;
  let writes: jest.SpyInstance;

  beforeEach(() => {
    silenceLogs();
    mockFeed();
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    DatabaseServerService.clearAutoRestoreCheckMemo();
    getJestSpyOn(GlobalCache, "setStringIfNotExists").mockImplementation(
      async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
    getJestSpyOn(GlobalCache, "setStringIfChanged").mockResolvedValue(true);
    getJestSpyOn(
      service,
      "updateColumnsByIdIfUnlockedWithoutHooks",
    ).mockResolvedValue(true);
    writes = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    findOneById = getJestSpyOn(service, "findOneById");
    mockRawQuery([]);
  });

  afterEach(() => {
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    DatabaseServerService.clearAutoRestoreCheckMemo();
  });

  test("the engine the receiver reports corrects a container row, once per window", async () => {
    const row: DatabaseServer = databaseRow({
      name: "PostgreSQL data/orders",
      dbSystem: "postgresql",
      workloadName: "orders",
      kubernetesNamespace: "data",
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
    });
    row._id = DATABASE_ID.toString();
    findOneById.mockResolvedValue(row);

    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
      dbSystem: "mysql",
    });

    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0]![0].data).toEqual({
      dbSystem: "mysql",
      dbSystemSource: "collector",
      name: "MySQL data/orders",
    });

    // Later batches in the same window never look again.
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
      dbSystem: "mongodb",
    });
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("the same engine on stronger evidence is recorded without bumping updatedAt", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    row._id = DATABASE_ID.toString();
    findOneById.mockResolvedValue(row);

    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
      dbSystem: "postgres",
    });

    expect(writes.mock.calls[0]![0].data).toEqual({
      dbSystemSource: "collector",
    });
    expect(writes.mock.calls[0]![0].skipUpdateDateColumn).toBe(true);
  });

  test("no reported engine, no engine write", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    row._id = DATABASE_ID.toString();
    findOneById.mockResolvedValue(row);

    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {});

    expect(writes).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Who invested in a row: automatic labels and owners, and a person's restore
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService automatic assignments", () => {
  const DATABASE_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const LABEL_ID: string = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";

  beforeEach(() => {
    silenceLogs();
  });

  test("records ids atomically, deduped, as lowercase UUID strings", async () => {
    const query: jest.Mock = mockRawQuery([]);

    await DatabaseServerService.recordAutomaticAssignments({
      databaseServerId: DATABASE_ID,
      kind: "labelIds",
      ids: [LABEL_ID.toUpperCase(), new ObjectID(LABEL_ID), "not-a-uuid"],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`UPDATE "DatabaseServer"`);
    expect(sql).toContain(`jsonb_agg(DISTINCT assigned.id)`);
    expect(sql).toContain(`WHERE "_id" = $1`);
    expect(params).toEqual([
      DATABASE_ID.toString(),
      "labelIds",
      JSON.stringify([LABEL_ID]),
    ]);
  });

  test("forgets ids a person added, only from a list that exists", async () => {
    const query: jest.Mock = mockRawQuery([]);

    await DatabaseServerService.forgetAutomaticAssignments({
      databaseServerId: DATABASE_ID,
      kind: "ownerUserIds",
      ids: [USER_ID],
    });

    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`WHERE NOT (assigned.id = ANY($3::text[]))`);
    expect(sql).toContain(
      `jsonb_typeof("automaticAssignments" -> $2::text) = 'array'`,
    );
    expect(params).toEqual([
      DATABASE_ID.toString(),
      "ownerUserIds",
      [USER_ID.toString()],
    ]);
  });

  test("nothing to record or forget, no statement", async () => {
    const query: jest.Mock = mockRawQuery([]);

    await DatabaseServerService.recordAutomaticAssignments({
      databaseServerId: DATABASE_ID,
      kind: "labelIds",
      ids: [],
    });
    await DatabaseServerService.forgetAutomaticAssignments({
      databaseServerId: DATABASE_ID,
      kind: "labelIds",
      ids: ["nope"],
    });

    expect(query).not.toHaveBeenCalled();
  });

  test("an unknown kind is refused before any SQL", async () => {
    const query: jest.Mock = mockRawQuery([]);

    await DatabaseServerService.recordAutomaticAssignments({
      databaseServerId: DATABASE_ID,
      kind: "monitorIds" as never,
      ids: [LABEL_ID],
    });

    expect(query).not.toHaveBeenCalled();
  });

  test("a failing write is logged, never thrown - it only annotates a write that happened", async () => {
    getJestSpyOn(service, "getRepository").mockReturnValue({
      manager: {
        query: jest.fn(async () => {
          throw new Error("connection terminated");
        }),
      },
    } as never);
    const warn: jest.SpyInstance = logger.warn as unknown as jest.SpyInstance;

    await expect(
      DatabaseServerService.recordAutomaticAssignments({
        databaseServerId: DATABASE_ID,
        kind: "labelIds",
        ids: [LABEL_ID],
      }),
    ).resolves.toBeUndefined();
    await expect(
      DatabaseServerService.forgetAutomaticAssignments({
        databaseServerId: DATABASE_ID,
        kind: "labelIds",
        ids: [LABEL_ID],
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("labels promoted from telemetry are recorded as automatic - only the ones actually added", async () => {
    const existing: Label = new Label(ObjectID.generate());
    const added: ObjectID = ObjectID.generate();
    const builder: any = {
      createQueryBuilder: () => {
        return builder;
      },
      relation: () => {
        return builder;
      },
      of: () => {
        return builder;
      },
      loadMany: async () => {
        return [existing];
      },
      add: jest.fn(async () => {
        return undefined;
      }),
    };
    const query: jest.Mock = jest.fn(async () => {
      return [];
    });
    builder.manager = { query };
    getJestSpyOn(service, "getRepository").mockReturnValue(builder as never);
    getJestSpyOn(GlobalCache, "getString").mockResolvedValue(null);
    getJestSpyOn(GlobalCache, "setString").mockResolvedValue(undefined);

    await DatabaseServerService.attachLabels({
      databaseServerId: DATABASE_ID,
      labelIds: [existing.id!, added],
    });

    expect(builder.add).toHaveBeenCalledWith([added.toString()]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toEqual([
      DATABASE_ID.toString(),
      "labelIds",
      JSON.stringify([added.toString()]),
    ]);
  });
});

describe("DatabaseServerService.onUpdateSuccess - a person's edits", () => {
  let writes: jest.SpyInstance;
  let forget: jest.SpyInstance;

  function onUpdate(data: Record<string, unknown>): any {
    return {
      updateBy: {
        query: {},
        data: data,
        props: { userId: USER_ID },
      },
      carryForward: null,
    };
  }

  beforeEach(() => {
    silenceLogs();
    mockFeed();
    writes = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    forget = getJestSpyOn(
      service,
      "forgetAutomaticAssignments",
    ).mockResolvedValue(undefined);
    getJestSpyOn(service, "findOneById").mockResolvedValue(databaseRow());
  });

  test("labels a person saves count as theirs, whichever rule first attached them", async () => {
    const id: ObjectID = ObjectID.generate();
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();
    const label: Label = new Label(b);

    await service.onUpdateSuccess(
      onUpdate({ labels: [{ _id: a.toString() }, label, "not-an-object"] }),
      [id],
    );

    expect(forget).toHaveBeenCalledTimes(1);
    const call: any = forget.mock.calls[0]![0];
    expect(call.databaseServerId).toBe(id);
    expect(call.kind).toBe("labelIds");
    expect(call.ids).toEqual([a.toString(), b.toString(), "not-an-object"]);
  });

  test("an engine a person sets is recorded as theirs", async () => {
    const id: ObjectID = ObjectID.generate();

    await service.onUpdateSuccess(onUpdate({ dbSystem: "mysql" }), [id]);

    expect(writes).toHaveBeenCalledWith({
      id: id,
      data: { dbSystemSource: "manual" },
      skipUpdateDateColumn: true,
    });
  });

  test("an edit touching neither leaves both alone", async () => {
    await service.onUpdateSuccess(onUpdate({ name: "Orders" }), [
      ObjectID.generate(),
    ]);

    expect(forget).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("DatabaseServerService.autoArchiveStaleDatabaseServers - restore grace", () => {
  beforeEach(() => {
    silenceLogs();
    mockFeed();
  });

  test("an archive window longer than thirty days stretches a person's restore grace with it", async () => {
    const query: jest.Mock = mockRawQuery([]);
    const restore: () => void = withEnv(
      "DATABASE_SERVER_AUTO_ARCHIVE_DAYS",
      "45",
    );

    try {
      const before: number = Date.now();
      await DatabaseServerService.autoArchiveStaleDatabaseServers();

      const params: Array<unknown> = query.mock.calls[0]![1] as Array<unknown>;
      const grace: number = before - (params[4] as Date).getTime();
      expect(grace).toBeGreaterThanOrEqual(45 * 24 * HOUR_MS - 1000);
      expect(grace).toBeLessThanOrEqual(45 * 24 * HOUR_MS + 5000);
    } finally {
      restore();
    }
  });

  test("the feed says which investment keeps a row, and that rule-applied labels do not count", async () => {
    mockRawQuery([
      { _id: ObjectID.generate().toString(), projectId: PROJECT_ID.toString() },
    ]);
    const feed: jest.SpyInstance =
      DatabaseServerFeedService.createDatabaseServerFeedItem as unknown as jest.SpyInstance;

    await DatabaseServerService.autoArchiveStaleDatabaseServers();

    const more: string = feed.mock.calls[0]![0].moreInformationInMarkdown;
    expect(more).toContain("recently restored it from the archive");
    expect(more).toContain(
      "Labels and owners that rules or telemetry attached on their own do not count.",
    );
    expect(more).toContain("kept reporting");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Child rows created by a caller: the database must be theirs
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerService.assertDatabaseServerReferenceInProject", () => {
  const DATABASE_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const OTHER_DATABASE_ID: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );

  let findOneBy: jest.SpyInstance;

  function ownerRequest(reference: Partial<DatabaseServerOwnerUser>): {
    data: DatabaseServerOwnerUser;
    props: DatabaseCommonInteractionProps;
  } {
    const data: DatabaseServerOwnerUser = new DatabaseServerOwnerUser();
    data.userId = USER_ID;
    Object.assign(data, reference);
    return { data: data, props: memberProps() };
  }

  beforeEach(() => {
    findOneBy = getJestSpyOn(service, "findOneBy").mockImplementation(
      async (args: any) => {
        return args.query._id === DATABASE_ID.toString() &&
          args.query.projectId.toString() === PROJECT_ID.toString()
          ? databaseRow()
          : null;
      },
    );
  });

  test("a database of the caller's project is accepted, as the FK column only", async () => {
    const request: any = ownerRequest({
      databaseServer: new DatabaseServer(DATABASE_ID),
    });

    await expect(
      DatabaseServerService.assertDatabaseServerReferenceInProject(request),
    ).resolves.toEqual(DATABASE_ID);

    expect(request.data.databaseServerId.toString()).toBe(
      DATABASE_ID.toString(),
    );
    expect(request.data.databaseServer).toBeUndefined();
    expect(findOneBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("another project's database is refused", async () => {
    await expect(
      DatabaseServerService.assertDatabaseServerReferenceInProject(
        ownerRequest({ databaseServerId: OTHER_DATABASE_ID }) as any,
      ),
    ).rejects.toThrow("Database not found.");
  });

  test("a relation object that disagrees with the FK column is refused before any lookup", async () => {
    await expect(
      DatabaseServerService.assertDatabaseServerReferenceInProject(
        ownerRequest({
          databaseServerId: DATABASE_ID,
          databaseServer: new DatabaseServer(OTHER_DATABASE_ID),
        }) as any,
      ),
    ).rejects.toThrow("Conflicting database references were provided.");
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("no database at all is refused", async () => {
    await expect(
      DatabaseServerService.assertDatabaseServerReferenceInProject(
        ownerRequest({}) as any,
      ),
    ).rejects.toThrow("Select a database.");
  });
});

describe("DatabaseServerService.getDatabaseServerNameIfReadable", () => {
  test("as root (or without a caller) the name is read as root", async () => {
    const rootName: jest.SpyInstance = getJestSpyOn(
      service,
      "getDatabaseServerName",
    ).mockResolvedValue("Orders");
    const id: ObjectID = ObjectID.generate();

    await expect(
      DatabaseServerService.getDatabaseServerNameIfReadable({
        databaseServerId: id,
      }),
    ).resolves.toBe("Orders");
    await expect(
      DatabaseServerService.getDatabaseServerNameIfReadable({
        databaseServerId: id,
        props: { isRoot: true },
      }),
    ).resolves.toBe("Orders");
    expect(rootName).toHaveBeenCalledTimes(2);
  });

  test("a caller's lookup runs with the caller's own props", async () => {
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findOneBy",
    ).mockResolvedValue(databaseRow({ name: "Orders" }));
    const props: DatabaseCommonInteractionProps = memberProps();

    await expect(
      DatabaseServerService.getDatabaseServerNameIfReadable({
        databaseServerId: ObjectID.generate(),
        props: props,
      }),
    ).resolves.toBe("Orders");
    expect(findOneBy.mock.calls[0]![0].props).toBe(props);
  });

  test("a row the caller cannot read, or any error, is an empty name", async () => {
    getJestSpyOn(service, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("not allowed"));

    for (let i: number = 0; i < 2; i++) {
      await expect(
        DatabaseServerService.getDatabaseServerNameIfReadable({
          databaseServerId: ObjectID.generate(),
          props: memberProps(),
        }),
      ).resolves.toBe("");
    }
  });
});
