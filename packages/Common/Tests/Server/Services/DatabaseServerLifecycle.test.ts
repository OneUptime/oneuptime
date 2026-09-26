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
  hasDiscoveryGeneratedName,
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
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getMoreSpecificDatabaseSystem,
} from "../../../Types/DatabaseServer/DatabaseSystem";
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

/*
 * The engine compare-and-sets applyDatabaseSystemEvidence ran, among every
 * raw statement of a test: their SQL and parameters.
 */
interface RawStatement {
  sql: string;
  params: Array<unknown>;
}

function isEngineWrite(sql: unknown): boolean {
  return typeof sql === "string" && sql.includes('SET "dbSystemSource" =');
}

function engineWrites(query: jest.Mock): Array<RawStatement> {
  return query.mock.calls
    .filter((call: Array<unknown>) => {
      return isEngineWrite(call[0]);
    })
    .map((call: Array<unknown>): RawStatement => {
      return { sql: call[0] as string, params: call[1] as Array<unknown> };
    });
}

/*
 * Postgres answering the engine compare-and-set: `matched` rows back (the
 * row as written, name included) or none when another writer got there
 * first. Every other statement answers `others`.
 */
function answerEngineWrites(
  query: jest.Mock,
  matched: Array<{ _id: string; name: string }>,
  others: unknown = [],
): void {
  query.mockImplementation(async (sql: unknown) => {
    return isEngineWrite(sql) ? matched : others;
  });
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
      "an image refines a collector's Redis to Valkey (the redis receiver cannot tell them apart; the image names the engine)",
      "redis",
      Collector,
      "valkey",
      Container,
    ],
    [
      "a collector names the fork an image's family engine hid",
      "mysql",
      Container,
      "mariadb",
      Collector,
    ],
    [
      "an image refines trace-found PostgreSQL to CockroachDB",
      "postgresql",
      ClientSpans,
      "cockroachdb",
      Container,
    ],
    ["equal evidence may refine too", "redis", Container, "keydb", Container],
    [
      "client spans may refine what only client spans named",
      "mysql",
      ClientSpans,
      "mariadb",
      ClientSpans,
    ],
  ])(
    "within one family a fork refines the family engine on evidence at least as strong, or from an image: %s",
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

  /*
   * A client names the protocol it speaks, not always the server it
   * reached: MariaDB Connector/J (jdbc:mariadb:) reports "mariadb" against a
   * MySQL server. So a fork named only by client spans never overrides what
   * an image or a collector determined - and never lowers that evidence.
   */
  test.each([
    [
      "client spans cannot turn an image's MySQL into MariaDB",
      "mysql",
      Container,
      "mariadb",
    ],
    [
      "client spans cannot turn a collector's MySQL into MariaDB",
      "mysql",
      Collector,
      "mariadb",
    ],
    [
      "client spans cannot turn a collector's Redis into Valkey",
      "redis",
      Collector,
      "valkey",
    ],
    [
      "client spans cannot turn an image's PostgreSQL into CockroachDB",
      "postgresql",
      Container,
      "cockroachdb",
    ],
  ])(
    "a fork named only by weaker evidence refines nothing: %s",
    (
      _label: string,
      currentSystem: string,
      currentEvidence: DatabaseSystemEvidence,
      incomingSystem: string,
    ) => {
      expect(
        decide([currentSystem, currentEvidence], [incomingSystem, ClientSpans]),
      ).toBeNull();
    },
  );

  test("a fork is never downgraded back to its family engine by a collector or client spans (the mysql receiver cannot tell MariaDB apart)", () => {
    expect(decide(["mariadb", Container], ["mysql", Collector])).toBeNull();
    expect(decide(["valkey", ClientSpans], ["redis", Collector])).toBeNull();
    expect(decide(["mariadb", ClientSpans], ["mysql", ClientSpans])).toBeNull();
    expect(decide(["mariadb", Collector], ["mysql", Collector])).toBeNull();
  });

  test("an image naming the family engine undoes a fork that only client spans named", () => {
    expect(decide(["mariadb", ClientSpans], ["mysql", Container])).toEqual({
      system: "mysql",
      evidence: Container,
    });
    expect(decide(["valkey", null], ["redis", Container])).toEqual({
      system: "redis",
      evidence: Container,
    });
    // An image or a collector that named the fork is not overruled by an image.
    expect(decide(["mariadb", Container], ["mysql", Container])).toBeNull();
    expect(decide(["mariadb", Collector], ["mysql", Container])).toBeNull();
  });

  /*
   * The review's sequence: a MySQL StatefulSet whose applications use
   * MariaDB Connector/J. The spans never move the engine, so the image and
   * the collector keep being heard.
   */
  test("a MySQL server reached through a MariaDB client stays MySQL, whatever order the evidence arrives in", () => {
    type Stored = [string, DatabaseSystemEvidence | null];

    function apply(
      stored: Stored,
      incoming: [string, DatabaseSystemEvidence],
    ): Stored {
      const decision: DatabaseSystemDetermination | null = decide(
        stored,
        incoming,
      );
      return decision ? [decision.system, decision.evidence] : stored;
    }

    let fromImage: Stored = ["mysql", Container];
    fromImage = apply(fromImage, ["mariadb", ClientSpans]);
    expect(fromImage).toEqual(["mysql", Container]);
    fromImage = apply(fromImage, ["mysql", Collector]);
    expect(fromImage).toEqual(["mysql", Collector]);

    let fromTraces: Stored = ["mariadb", ClientSpans];
    fromTraces = apply(fromTraces, ["mysql", Container]);
    expect(fromTraces).toEqual(["mysql", Container]);
    fromTraces = apply(fromTraces, ["mariadb", ClientSpans]);
    expect(fromTraces).toEqual(["mysql", Container]);
  });

  test("client spans never move a collector's Redis, so only an image naming the engine refines it later", () => {
    expect(decide(["redis", Collector], ["valkey", ClientSpans])).toBeNull();
    expect(decide(["redis", Collector], ["keydb", Container])).toEqual({
      system: "keydb",
      evidence: Container,
    });
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

  test("a sibling fork is a different engine, not a refinement: only stronger evidence moves it", () => {
    expect(decide(["tidb", Container], ["mariadb", ClientSpans])).toBeNull();
    expect(decide(["tidb", ClientSpans], ["mariadb", Container])).toEqual({
      system: "mariadb",
      evidence: Container,
    });
  });

  test("an engine outside the catalog is never refined by a fork - only replaced on stronger evidence", () => {
    expect(decide(["acmedb", Container], ["mariadb", Container])).toBeNull();
    expect(decide(["acmedb", ClientSpans], ["mariadb", Container])).toEqual({
      system: "mariadb",
      evidence: Container,
    });
  });

  /*
   * ONE rule for "more specific": within a family, what decideDatabaseSystem
   * does is exactly what getMoreSpecificDatabaseSystem (the rule the docs
   * state) says - for every pair of catalogued engines, whatever evidence
   * either side carries short of a person's choice.
   */
  describe("agrees with getMoreSpecificDatabaseSystem across the catalog", () => {
    const systems: Array<string> = DATABASE_SYSTEMS.map(
      (descriptor: DatabaseSystemDescriptor): string => {
        return descriptor.system;
      },
    );
    const evidences: Array<DatabaseSystemEvidence> = [
      Collector,
      Container,
      ClientSpans,
    ];

    test("the catalog has forks to check", () => {
      expect(
        DATABASE_SYSTEMS.filter((descriptor: DatabaseSystemDescriptor) => {
          return Boolean(descriptor.family);
        }).length,
      ).toBeGreaterThan(5);
    });

    /*
     * A refinement is taken on evidence at least as strong as what named the
     * current engine, or from an image (it names the exact engine); a fork
     * is undone only by an image, and only when no more than client spans
     * named it.
     */
    test("a refinement is taken on evidence at least as strong or from an image, and a fork is undone only by an image over client spans", () => {
      const rank: Record<DatabaseSystemEvidence, number> = {
        [Manual]: 4,
        [Collector]: 3,
        [Container]: 2,
        [ClientSpans]: 1,
      };
      const disagreements: Array<string> = [];
      let refinements: number = 0;
      let undoings: number = 0;

      for (const current of systems) {
        for (const observed of systems) {
          if (current === observed) {
            continue;
          }

          const refines: boolean =
            getMoreSpecificDatabaseSystem(current, observed) === observed;
          const undoes: boolean =
            getMoreSpecificDatabaseSystem(observed, current) === current;

          if (!refines && !undoes) {
            continue;
          }

          if (refines) {
            refinements++;
          } else {
            undoings++;
          }

          for (const currentEvidence of evidences) {
            for (const incomingEvidence of evidences) {
              const decision: DatabaseSystemDetermination | null = decide(
                [current, currentEvidence],
                [observed, incomingEvidence],
              );
              let expected: DatabaseSystemDetermination | null = null;

              if (
                refines &&
                (rank[incomingEvidence] >= rank[currentEvidence] ||
                  incomingEvidence === Container)
              ) {
                expected = { system: observed, evidence: incomingEvidence };
              }

              if (
                undoes &&
                incomingEvidence === Container &&
                currentEvidence === ClientSpans
              ) {
                expected = { system: observed, evidence: Container };
              }

              if (JSON.stringify(decision) !== JSON.stringify(expected)) {
                disagreements.push(
                  `${current} (${currentEvidence}) seen as ${observed} (${incomingEvidence}): ${JSON.stringify(decision)}`,
                );
              }
            }
          }
        }
      }

      expect(disagreements).toEqual([]);
      expect(refinements).toBeGreaterThan(5);
      expect(undoings).toBe(refinements);
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

describe("hasDiscoveryGeneratedName", () => {
  test("true while the row carries the endpoint or workload name discovery generated for its engine", () => {
    expect(
      hasDiscoveryGeneratedName({
        name: "Redis redis.cache.svc.cluster.local:6379",
        dbSystem: "redis",
        serverAddress: "redis.cache.svc.cluster.local",
        serverPort: 6379,
      }),
    ).toBe(true);
    expect(
      hasDiscoveryGeneratedName({
        name: "PostgreSQL data/orders",
        dbSystem: "postgresql",
        kubernetesNamespace: "data",
        workloadName: "orders",
      }),
    ).toBe(true);
    expect(
      hasDiscoveryGeneratedName({
        name: "PostgreSQL db.example.com",
        dbSystem: "postgres",
        serverAddress: "db.example.com",
      }),
    ).toBe(true);
  });

  test("false for a name a person chose, a name of another engine, or nothing to compare with", () => {
    const endpoint: {
      dbSystem: string;
      serverAddress: string;
      serverPort: number;
    } = {
      dbSystem: "redis",
      serverAddress: "redis.cache.svc.cluster.local",
      serverPort: 6379,
    };
    expect(
      hasDiscoveryGeneratedName({ ...endpoint, name: "Orders cache (prod)" }),
    ).toBe(false);
    expect(
      hasDiscoveryGeneratedName({
        ...endpoint,
        name: "Valkey redis.cache.svc.cluster.local:6379",
      }),
    ).toBe(false);
    expect(hasDiscoveryGeneratedName({ ...endpoint, name: "  " })).toBe(false);
    expect(
      hasDiscoveryGeneratedName({ name: "Redis", dbSystem: "redis" }),
    ).toBe(false);
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

  // A row application traces created for the Service name, as discovery named it.
  function traceDuplicate(
    overrides: Partial<DatabaseServer> = {},
  ): DatabaseServer {
    return databaseRow({
      name: "Redis redis.cache.svc.cluster.local:6379",
      dbSystem: "redis",
      databaseIdentifier: "redis|redis.cache.svc.cluster.local:6379@prod",
      serverAddress: "redis.cache.svc.cluster.local",
      serverPort: 6379,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      ...overrides,
    });
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

    /*
     * Raw SQL: the untouched-duplicate lookup, and restores. The lookup's
     * SQL-side conditions are world.untouchedTraceRows plus a person's
     * restore within the grace window ($4); it answers the columns the
     * service reads back.
     */
    rawQuery = jest.fn(async (sql: string, params: Array<unknown>) => {
      if (sql.includes(`ds."workloadIdentifier" IS NULL`)) {
        return (params[1] as Array<string>)
          .filter((id: string) => {
            const row: DatabaseServer | undefined = world.rows.get(id);
            return (
              world.untouchedTraceRows.has(id) &&
              (!row?.manuallyRestoredAt ||
                row.manuallyRestoredAt < (params[3] as Date)) &&
              !(row?.description || "").trim()
            );
          })
          .map((id: string) => {
            const row: DatabaseServer | undefined = world.rows.get(id);
            return {
              _id: id,
              name: row?.name ?? null,
              dbSystem: row?.dbSystem ?? null,
              serverAddress: row?.serverAddress ?? null,
              serverPort: row?.serverPort ?? null,
            };
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

    test("a row stored under the old fork-keyed identifier is re-keyed to the family key while the fork is still reported - not duplicated", async () => {
      const legacyWorkload: string =
        "valkey|kubernetes:prod/cache/statefulset/redis";
      const row: DatabaseServer = workloadRow({
        name: "Valkey cache/redis",
        dbSystem: "valkey",
        databaseIdentifier: legacyWorkload,
        workloadIdentifier: legacyWorkload,
      });
      own(SERVICE_ALIAS, row, { isPrimary: true });

      // What buildWorkloadDatabaseServerIdentifier produces for Valkey now.
      const result: DatabaseServer | null =
        await DatabaseServerService.upsertWorkloadDatabase(
          input({
            workloadIdentifier: WORKLOAD,
            dbSystem: "valkey",
            displayName: "Valkey cache/redis",
          }),
        );

      expect(result).toBe(row);
      expect(Array.from(world.rows.values())).toHaveLength(1);
      expect(row.workloadIdentifier).toBe(WORKLOAD);
      // A compare-and-set on the legacy identifier.
      const rekey: any = world.writes.find((write: any) => {
        return write.data.workloadIdentifier === WORKLOAD;
      });
      expect(rekey.expected).toEqual({ workloadIdentifier: legacyWorkload });
      expect(row.dbSystem).toBe("valkey");
      expect(world.endpoints.get(SERVICE_ALIAS)!.databaseServerId).toBe(
        row.id!.toString(),
      );

      // The next run finds it by the family key: nothing re-keyed again.
      const writesBefore: number = world.writes.length;
      const again: DatabaseServer | null =
        await DatabaseServerService.upsertWorkloadDatabase(
          input({
            workloadIdentifier: WORKLOAD,
            dbSystem: "valkey",
            displayName: "Valkey cache/redis",
          }),
        );
      expect(again).toBe(row);
      expect(Array.from(world.rows.values())).toHaveLength(1);
      expect(
        world.writes.slice(writesBefore).some((write: any) => {
          return "workloadIdentifier" in write.data;
        }),
      ).toBe(false);
    });

    test("the engine-family lookup asks for every legacy key of the family - the reported fork's too - but never the family key itself", async () => {
      const findBy: jest.SpyInstance = service.findBy as jest.SpyInstance;

      await DatabaseServerService.upsertWorkloadDatabase(
        input({ workloadIdentifier: WORKLOAD, dbSystem: "valkey" }),
      );

      const lookup: any = findBy.mock.calls.find((call: any) => {
        return Boolean(call[0].query.workloadIdentifier);
      });
      const candidates: Array<string> = [];
      for (const values of Object.values(
        lookup[0].query.workloadIdentifier.objectLiteralParameters || {},
      )) {
        candidates.push(...(values as Array<string>));
      }
      expect(candidates).toContain(
        "valkey|kubernetes:prod/cache/statefulset/redis",
      );
      expect(candidates).toContain(
        "keydb|kubernetes:prod/cache/statefulset/redis",
      );
      expect(candidates).not.toContain(WORKLOAD);
      // Nothing to adopt: one new row, under the family key.
      const rows: Array<DatabaseServer> = Array.from(world.rows.values());
      expect(rows).toHaveLength(1);
      expect(rows[0]!.workloadIdentifier).toBe(WORKLOAD);
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

    test("a row created in this run is neither re-weighed nor written a second time", async () => {
      await DatabaseServerService.upsertWorkloadDatabase(input());

      const created: DatabaseServer = Array.from(world.rows.values())[0]!;
      // The create itself wrote every workload column.
      expect(created.dbSystem).toBe("redis");
      expect(created.dbSystemSource).toBeUndefined();
      expect(
        world.writes.filter((write: { id: string }) => {
          return write.id === created.id!.toString();
        }),
      ).toEqual([]);
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

    test("the workload's last sighting is stamped once it was last written long ago", async () => {
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

  /*
   * Discovery sees every workload every five minutes. Rewriting a row whose
   * columns would not change (the member-key JSON included) costs a write
   * per database per run for nothing, so it is skipped while the row was
   * written within the last quarter hour - which keeps its lastSeenAt inside
   * the dashboard's 30-minute "seen recently" window, and far inside the
   * hour after which a workload counts as gone.
   */
  describe("a workload seen again with nothing new", () => {
    const MEMBER_KEY_A: string = "0123456789abcdef";
    const MEMBER_KEY_B: string = "fedcba9876543210";

    // The row exactly as input() would write it, last written `ageMs` ago.
    function unchangedRow(
      ageMs: number,
      overrides: Partial<DatabaseServer> = {},
    ): DatabaseServer {
      const writtenAt: Date = new Date(Date.now() - ageMs);
      return workloadRow({
        instanceCount: 1,
        dbVersion: "7.2",
        workloadKind: "StatefulSet",
        workloadName: "redis",
        kubernetesNamespace: "cache",
        kubernetesClusterId: new ObjectID(CLUSTER_ID.toString()),
        dbSystemSource: DatabaseSystemEvidence.Container,
        memberEntityKeys: { [MEMBER_KEY_A]: writtenAt.toISOString() },
        lastSeenAt: writtenAt,
        workloadLastSeenAt: writtenAt,
        ...overrides,
      });
    }

    function writesFor(row: DatabaseServer): Array<Record<string, unknown>> {
      return world.writes
        .filter((write: { id: string }) => {
          return write.id === row.id!.toString();
        })
        .map((write: { data: Record<string, unknown> }) => {
          return write.data;
        });
    }

    function seenAgain(
      overrides: Partial<UpsertWorkloadDatabaseData> = {},
    ): UpsertWorkloadDatabaseData {
      return input({ memberKeysSeenNow: [MEMBER_KEY_A], ...overrides });
    }

    test("a row written five minutes ago is not rewritten - and is returned as it was read", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);
      const writtenAt: Date = row.lastSeenAt!;

      const result: DatabaseServer | null =
        await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(result).toBe(row);
      expect(writesFor(row)).toEqual([]);
      expect(row.lastSeenAt).toBe(writtenAt);
      expect(row.memberEntityKeys).toEqual({
        [MEMBER_KEY_A]: writtenAt.toISOString(),
      });
    });

    test("its endpoints are still claimed and refreshed", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);
      own(SERVICE_ALIAS, row, {
        lastMatchedAt: new Date(Date.now() - 2 * HOUR_MS),
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(writesFor(row)).toEqual([]);
      // The Service alias is re-stamped, the pod alias claimed.
      expect(refresh.mock.calls[0]![0].endpoints).toEqual([SERVICE_ALIAS]);
      expect(
        world.claims.map((claim: any) => {
          return claim.endpoint;
        }),
      ).toEqual([POD_ALIAS]);
      expect(release).toHaveBeenCalled();
    });

    test("an auto-archived row is still restored", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        isArchived: true,
        autoArchivedAt: new Date(Date.now() - HOUR_MS),
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(writesFor(row)).toEqual([]);
      expect(
        rawQuery.mock.calls.some((call: Array<unknown>) => {
          return String(call[0]).includes(`WITH "restored" AS`);
        }),
      ).toBe(true);
    });

    test("14 minutes after the last write it is still skipped, 16 minutes after it is written - so lastSeenAt never ages past the 30-minute seen-recently window", async () => {
      const recent: DatabaseServer = unchangedRow(14 * MINUTE_MS);
      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());
      expect(writesFor(recent)).toEqual([]);

      world.rows.clear();
      const stale: DatabaseServer = unchangedRow(16 * MINUTE_MS);
      const before: number = Date.now();
      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      const writes: Array<Record<string, unknown>> = writesFor(stale);
      expect(writes).toHaveLength(1);
      expect((writes[0]!["lastSeenAt"] as Date).getTime()).toBeGreaterThan(
        before - 1,
      );
      expect(
        (writes[0]!["workloadLastSeenAt"] as Date).getTime(),
      ).toBeGreaterThan(before - 1);
      // The member keys' own timestamps move with it.
      expect(
        Date.parse(
          (writes[0]!["memberEntityKeys"] as Record<string, string>)[
            MEMBER_KEY_A
          ]!,
        ),
      ).toBeGreaterThan(before - 1);
    });

    test("an application querying the row keeps lastSeenAt fresh - the workload's own stamp still decides", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        workloadLastSeenAt: new Date(Date.now() - 20 * MINUTE_MS),
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(writesFor(row)).toHaveLength(1);
    });

    test("a row with no liveness stamp is written", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);
      delete row.lastSeenAt;

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(writesFor(row)).toHaveLength(1);
    });

    test("a new member (a pod restarted under a new name) is written at once", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);

      await DatabaseServerService.upsertWorkloadDatabase(
        seenAgain({ memberKeysSeenNow: [MEMBER_KEY_A, MEMBER_KEY_B] }),
      );

      const write: Record<string, unknown> = lastWriteFor(row);
      expect(
        Object.keys(
          write["memberEntityKeys"] as Record<string, unknown>,
        ).sort(),
      ).toEqual([MEMBER_KEY_A, MEMBER_KEY_B].sort());
      expect(row.memberEntityKeys).toBe(write["memberEntityKeys"]);
    });

    test("a member that aged out is dropped at once", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        memberEntityKeys: {
          [MEMBER_KEY_A]: new Date(Date.now() - 5 * MINUTE_MS).toISOString(),
          [MEMBER_KEY_B]: new Date(
            Date.now() - 31 * 24 * HOUR_MS,
          ).toISOString(),
        },
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(
        Object.keys(
          lastWriteFor(row)["memberEntityKeys"] as Record<string, unknown>,
        ),
      ).toEqual([MEMBER_KEY_A]);
    });

    test.each([
      ["the instance count", { instanceCount: 3 }, "instanceCount", 3],
      ["the image version", { dbVersion: "7.4" }, "dbVersion", "7.4"],
      [
        "the workload kind",
        { workloadKind: "Deployment" },
        "workloadKind",
        "Deployment",
      ],
      [
        "the workload name",
        { workloadName: "redis-main" },
        "workloadName",
        "redis-main",
      ],
      [
        "the namespace",
        { kubernetesNamespace: "cache-v2" },
        "kubernetesNamespace",
        "cache-v2",
      ],
    ])(
      "a change of %s is written at once",
      async (
        _label: string,
        change: Partial<UpsertWorkloadDatabaseData>,
        column: string,
        value: unknown,
      ) => {
        const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);

        await DatabaseServerService.upsertWorkloadDatabase(seenAgain(change));

        expect(lastWriteFor(row)[column]).toBe(value);
      },
    );

    test("a scaled-to-zero row whose pods came back is written at once", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        instanceCount: 0,
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(lastWriteFor(row)["instanceCount"]).toBe(1);
      expect(row.instanceCount).toBe(1);
    });

    test("another parent is written at once, compared by id", async () => {
      const otherCluster: ObjectID = new ObjectID(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      );
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);

      await DatabaseServerService.upsertWorkloadDatabase(
        seenAgain({ kubernetesClusterId: otherCluster }),
      );

      expect(String(lastWriteFor(row)["kubernetesClusterId"])).toBe(
        otherCluster.toString(),
      );
    });

    test("the same parent as another ObjectID instance, in another case, is no change", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        kubernetesClusterId: new ObjectID(CLUSTER_ID.toString().toUpperCase()),
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(writesFor(row)).toEqual([]);
    });

    test("an image that refines the engine is written at once, with its feed item", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS);

      await DatabaseServerService.upsertWorkloadDatabase(
        seenAgain({ dbSystem: "valkey" }),
      );

      expect(lastWriteFor(row)["dbSystem"]).toBe("valkey");
      expect(row.dbSystem).toBe("valkey");
      await flushPromises();
      expect(feed).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseServerFeedEventType:
            DatabaseServerFeedEventType.DatabaseServerUpdated,
        }),
      );
    });

    test("stronger evidence for the same engine is recorded at once", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        dbSystemSource: DatabaseSystemEvidence.ClientSpans,
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(lastWriteFor(row)["dbSystemSource"]).toBe(
        DatabaseSystemEvidence.Container,
      );
    });

    test("a version the live collector reported is no change, however the image is tagged", async () => {
      const row: DatabaseServer = unchangedRow(5 * MINUTE_MS, {
        dbVersion: "7.2.4",
        collectorLastSeenAt: new Date(Date.now() - 2 * MINUTE_MS),
      });

      await DatabaseServerService.upsertWorkloadDatabase(seenAgain());

      expect(writesFor(row)).toEqual([]);
      expect(row.dbVersion).toBe("7.2.4");
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
      const duplicate: DatabaseServer = addRow(traceDuplicate());
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
      // A person's recent Restore and a person's description are investment.
      expect(sql).toContain(
        `(ds."manuallyRestoredAt" IS NULL OR ds."manuallyRestoredAt" < $4)`,
      );
      expect(sql).toContain(`COALESCE(BTRIM(ds."description"), '') = ''`);
      expect(params[0]).toBe(PROJECT_ID.toString());
      expect(params[1]).toEqual([duplicate.id!.toString()]);
      expect(params[2]).toBe("client-spans");
      // The same grace a person's Restore gets from the archive sweep.
      const thirtyDays: number = 30 * 24 * HOUR_MS;
      const graceCutoff: number = (params[3] as Date).getTime();
      expect(Date.now() - graceCutoff).toBeGreaterThanOrEqual(
        thirtyDays - 5000,
      );
      expect(Date.now() - graceCutoff).toBeLessThanOrEqual(thirtyDays + 5000);
    });

    /*
     * Moving a row's endpoints empties it: the sweep then archives it. So a
     * row a person renamed, described or restored from the archive is theirs,
     * whatever the untouched predicate says - its endpoints stay, and the
     * workload takes only what nobody invested in.
     */
    test.each([
      ["a person renamed it", { name: "Orders cache (prod)" }],
      ["a person described it", { description: "Checkout sessions" }],
      [
        "a person restored it from the archive last week",
        { manuallyRestoredAt: new Date(Date.now() - 7 * 24 * HOUR_MS) },
      ],
    ])(
      "a trace-discovered duplicate keeps its endpoints when %s",
      async (_label: string, overrides: Partial<DatabaseServer>) => {
        workloadRow();
        const kept: DatabaseServer = addRow(traceDuplicate(overrides));
        own(SERVICE_ALIAS, kept, { source: "auto", isPrimary: true });
        world.untouchedTraceRows.add(kept.id!.toString());
        const other: DatabaseServer = addRow(
          traceDuplicate({
            serverAddress: "redis-0.redis-hl.cache.svc.cluster.local",
            name: "Redis redis-0.redis-hl.cache.svc.cluster.local:6379",
          }),
        );
        own(POD_ALIAS, other, { source: "auto", isPrimary: true });
        world.untouchedTraceRows.add(other.id!.toString());

        await DatabaseServerService.upsertWorkloadDatabase(input());

        expect(world.endpoints.get(SERVICE_ALIAS)!.databaseServerId).toBe(
          kept.id!.toString(),
        );
        // ...while the untouched one hands its endpoint over.
        expect(world.transfers).toHaveLength(1);
        expect(world.transfers[0].fromDatabaseServerId.toString()).toBe(
          other.id!.toString(),
        );
      },
    );

    test("a Restore older than the grace window no longer holds the endpoints", async () => {
      workloadRow();
      const duplicate: DatabaseServer = addRow(
        traceDuplicate({
          manuallyRestoredAt: new Date(Date.now() - 45 * 24 * HOUR_MS),
        }),
      );
      own(SERVICE_ALIAS, duplicate, { source: "auto", isPrimary: true });
      world.untouchedTraceRows.add(duplicate.id!.toString());

      await DatabaseServerService.upsertWorkloadDatabase(input());

      expect(world.transfers).toHaveLength(1);
    });

    test("a duplicate whose engine a fork refined still carries its generated name, and hands over", async () => {
      workloadRow({ dbSystem: "valkey", name: "Valkey cache/redis" });
      const duplicate: DatabaseServer = addRow(
        traceDuplicate({
          dbSystem: "valkey",
          name: "Valkey redis.cache.svc.cluster.local:6379",
        }),
      );
      own(SERVICE_ALIAS, duplicate, { source: "auto", isPrimary: true });
      world.untouchedTraceRows.add(duplicate.id!.toString());

      await DatabaseServerService.upsertWorkloadDatabase(
        input({ dbSystem: "valkey" }),
      );

      expect(world.transfers).toHaveLength(1);
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
    answerEngineWrites(rawQuery, [
      { _id: row.id!.toString(), name: "MySQL orders-db.example.com:5432" },
    ]);
    const feed: jest.SpyInstance = mockFeed();

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
    expect(writes).not.toHaveBeenCalled();
    const statements: Array<RawStatement> = engineWrites(rawQuery);
    expect(statements).toHaveLength(1);
    const { sql, params } = statements[0]!;
    expect(sql).toContain('"dbSystem" = $2');
    // The name moves only while it is still the generated one that was read.
    expect(sql).toContain(
      '"name" = CASE WHEN "name" IS NOT DISTINCT FROM $3 THEN $4 ELSE "name" END',
    );
    expect(sql).toContain('"updatedAt" = CURRENT_TIMESTAMP');
    // Compare-and-set on the engine AND the evidence it was weighed against.
    expect(sql).toContain('"dbSystem" IS NOT DISTINCT FROM $7');
    expect(sql).toContain('"dbSystemSource" IS NOT DISTINCT FROM $8');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('RETURNING "_id", "name"');
    expect(params).toEqual([
      "collector",
      "mysql",
      "PostgreSQL orders-db.example.com:5432",
      "MySQL orders-db.example.com:5432",
      row.id!.toString(),
      PROJECT_ID.toString(),
      "postgresql",
      null,
    ]);
    expect(row.dbSystem).toBe("mysql");
    expect(row.dbSystemSource).toBe("collector");
    expect(row.name).toBe("MySQL orders-db.example.com:5432");
    expect(feed).toHaveBeenCalledTimes(1);
  });

  /*
   * Two writers read the row at once and both decide to change the engine:
   * only the one whose compare-and-set matched may say so. The other leaves
   * its in-memory row as read and writes no feed item.
   */
  test("a writer that loses the engine compare-and-set changes nothing and announces nothing", async () => {
    const row: DatabaseServer = databaseRow({
      name: "Redis cache.example.com:6379",
      dbSystem: "redis",
      serverAddress: "cache.example.com",
      serverPort: 6379,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    answerEngineWrites(rawQuery, []);
    const feed: jest.SpyInstance = mockFeed();

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "valkey",
        endpoint: { host: "cache.example.com", port: 6379 },
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: false,
      });

    expect(result).toBe(row);
    expect(engineWrites(rawQuery)).toHaveLength(1);
    expect(row.dbSystem).toBe("redis");
    expect(row.dbSystemSource).toBeUndefined();
    expect(row.name).toBe("Redis cache.example.com:6379");
    expect(feed).not.toHaveBeenCalled();
  });

  test("the compare-and-set carries the evidence as read, so a concurrent stronger report is not overwritten", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      dbSystemSource: DatabaseSystemEvidence.ClientSpans,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    answerEngineWrites(rawQuery, [
      { _id: row.id!.toString(), name: row.name! },
    ]);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "postgres",
      endpoint: ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.Collector,
      allowCreate: false,
    });

    const { sql, params } = engineWrites(rawQuery)[0]!;
    // Same engine, stronger evidence: bookkeeping, no rename, no updatedAt.
    expect(sql).not.toContain('"dbSystem" = $');
    expect(sql).not.toContain('"name" =');
    expect(sql).not.toContain('"updatedAt"');
    expect(params).toEqual([
      "collector",
      row.id!.toString(),
      PROJECT_ID.toString(),
      "postgresql",
      "client-spans",
    ]);
    expect(row.dbSystemSource).toBe("collector");
  });

  test("a person's rename made after the read survives the engine change: the database answers with their name", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    answerEngineWrites(rawQuery, [
      { _id: row.id!.toString(), name: "Orders (prod)" },
    ]);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "mysql",
      endpoint: ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.Collector,
      allowCreate: false,
    });

    expect(row.dbSystem).toBe("mysql");
    expect(row.name).toBe("Orders (prod)");
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

    expect(engineWrites(rawQuery)).toHaveLength(0);
    expect(row.dbSystem).toBe("postgresql");
  });

  test("a failed engine write never fails the lookup", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    rawQuery.mockRejectedValue(new Error("connection terminated"));

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

  /*
   * The row of a workload that is gone, archived by discovery: application
   * traces never restore it, so a trace naming one of its endpoints is not
   * a sighting of it either. The trace path gets no row back - it records
   * no lastSeenAt on it and claims no sibling endpoints for it - and
   * nothing about the row changes: not its engine, not its endpoint's
   * "last matched".
   */
  test("an auto-archived row of a workload that is gone is not a trace's to sight: no row, no restore, no write", async () => {
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
        dbSystem: "mysql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: false,
      });

    expect(result).toBeNull();
    expect(rawQuery).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(row.isArchived).toBe(true);
  });

  test("a collector reporting that retired row still resolves to it - its heartbeat is what restores it", async () => {
    const row: DatabaseServer = databaseRow({
      workloadIdentifier: "postgresql|kubernetes:prod/data/statefulset/pg",
      workloadLastSeenAt: new Date(Date.now() - 8 * 24 * HOUR_MS),
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: false,
      }),
    ).resolves.toBe(row);
  });

  test("a workload row archived while its workload was still reporting is sighted and restored as before", async () => {
    const row: DatabaseServer = databaseRow({
      workloadIdentifier: "postgresql|kubernetes:prod/data/statefulset/pg",
      workloadLastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner.mockResolvedValue(ownedBy(row));
    findOneBy.mockResolvedValue(row);
    rawQuery.mockResolvedValue([{ _id: row.id!.toString() }]);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: false,
      }),
    ).resolves.toBe(row);
    expect(row.isArchived).toBe(false);
  });

  test("losing the create race to a retired workload row: the trace gets no row back", async () => {
    const retired: DatabaseServer = databaseRow({
      workloadIdentifier: "postgresql|kubernetes:prod/data/statefulset/pg",
      workloadLastSeenAt: new Date(Date.now() - 8 * 24 * HOUR_MS),
      discoverySource: DatabaseServerDiscoverySource.Kubernetes,
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    findOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ownedBy(retired));
    findOneBy.mockResolvedValue(retired);
    getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("owned-by-other");
    getJestSpyOn(service, "deleteBy").mockResolvedValue(1);

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBeNull();
    expect(rawQuery).not.toHaveBeenCalled();
    expect(retired.isArchived).toBe(true);
  });

  test("the identifier race landing on a retired workload row: the trace neither claims the endpoint for it nor restores it", async () => {
    const retired: DatabaseServer = databaseRow({
      workloadIdentifier: "postgresql|kubernetes:prod/data/statefulset/pg",
      workloadLastSeenAt: new Date(Date.now() - 8 * 24 * HOUR_MS),
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      isArchived: true,
      autoArchivedAt: new Date(),
    });
    create.mockRejectedValue(new Error("duplicate key value"));
    findOneBy.mockResolvedValue(retired);
    const claim: jest.SpyInstance = getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("claimed");

    await expect(
      DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "postgresql",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      }),
    ).resolves.toBeNull();
    expect(claim).not.toHaveBeenCalled();
    expect(rawQuery).not.toHaveBeenCalled();
    expect(retired.isArchived).toBe(true);
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

  /*
   * Two writers saw the endpoint unowned; ours lost the claim. The row that
   * won is the owner, and our report is a sighting of it like any other: a
   * fork our client named refines the family engine it was created with.
   */
  test("losing the create race, the report still refines the winner's engine", async () => {
    const winner: DatabaseServer = databaseRow({
      name: "MySQL orders-db.example.com:5432",
      dbSystem: "mysql",
      databaseIdentifier: "mysql|orders-db.example.com:5432",
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    findOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ownedBy(winner));
    findOneBy.mockResolvedValue(winner);
    getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("owned-by-other");
    const deleteBy: jest.SpyInstance = getJestSpyOn(
      service,
      "deleteBy",
    ).mockResolvedValue(1);
    answerEngineWrites(rawQuery, [
      {
        _id: winner.id!.toString(),
        name: "MariaDB orders-db.example.com:5432",
      },
    ]);

    const result: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: PROJECT_ID,
        dbSystem: "mariadb",
        endpoint: ENDPOINT,
        discoverySource: DatabaseServerDiscoverySource.ClientSpans,
        allowCreate: true,
      });

    expect(result).toBe(winner);
    // Our orphan is gone...
    expect(deleteBy).toHaveBeenCalledTimes(1);
    // ...and the winner now shows the fork, renamed from its generated name.
    const { params } = engineWrites(rawQuery)[0]!;
    expect(params).toEqual([
      "client-spans",
      "mariadb",
      "MySQL orders-db.example.com:5432",
      "MariaDB orders-db.example.com:5432",
      winner.id!.toString(),
      PROJECT_ID.toString(),
      "mysql",
      null,
    ]);
    expect(winner.dbSystem).toBe("mariadb");
    expect(winner.name).toBe("MariaDB orders-db.example.com:5432");
  });

  test("losing the create race, a family name never undoes the winner's fork", async () => {
    const winner: DatabaseServer = databaseRow({
      dbSystem: "mariadb",
      discoverySource: DatabaseServerDiscoverySource.Collector,
    });
    findOwner
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ownedBy(winner));
    findOneBy.mockResolvedValue(winner);
    getJestSpyOn(
      DatabaseServerEndpointService,
      "claimEndpoint",
    ).mockResolvedValue("owned-by-other");
    getJestSpyOn(service, "deleteBy").mockResolvedValue(1);

    await DatabaseServerService.findOrCreateByEndpoint({
      projectId: PROJECT_ID,
      dbSystem: "mysql",
      endpoint: ENDPOINT,
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
      allowCreate: true,
    });

    expect(engineWrites(rawQuery)).toHaveLength(0);
    expect(winner.dbSystem).toBe("mariadb");
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
  let rawQuery: jest.Mock;

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
    rawQuery = mockRawQuery([]);
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
    answerEngineWrites(rawQuery, [
      { _id: DATABASE_ID.toString(), name: "MySQL data/orders" },
    ]);

    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
      dbSystem: "mysql",
    });

    expect(writes).not.toHaveBeenCalled();
    const statements: Array<RawStatement> = engineWrites(rawQuery);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.params).toEqual([
      "collector",
      "mysql",
      "PostgreSQL data/orders",
      "MySQL data/orders",
      DATABASE_ID.toString(),
      PROJECT_ID.toString(),
      "postgresql",
      null,
    ]);
    expect(row.name).toBe("MySQL data/orders");

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
    answerEngineWrites(rawQuery, [
      { _id: DATABASE_ID.toString(), name: row.name! },
    ]);

    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {
      dbSystem: "postgres",
    });

    const { sql, params } = engineWrites(rawQuery)[0]!;
    expect(params[0]).toBe("collector");
    expect(sql).not.toContain('"updatedAt"');
    expect(row.dbSystemSource).toBe("collector");
  });

  test("no reported engine, no engine write", async () => {
    const row: DatabaseServer = databaseRow({
      discoverySource: DatabaseServerDiscoverySource.ClientSpans,
    });
    row._id = DATABASE_ID.toString();
    findOneById.mockResolvedValue(row);

    await DatabaseServerService.recordCollectorHeartbeat(DATABASE_ID, {});

    expect(writes).not.toHaveBeenCalled();
    expect(engineWrites(rawQuery)).toHaveLength(0);
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
