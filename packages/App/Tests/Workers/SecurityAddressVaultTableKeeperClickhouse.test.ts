import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Security Events' address vault table (#10395), made by boot itself,
 * against a ClickHouse cluster of one shard and two replicas coordinated
 * by Keeper - the layout every install runs (a single node is a cluster
 * of one).
 *
 * The vault is a new table, so it needs no hand-written migration
 * (Docs/migrations/README.md): boot creates it from its model, with the
 * statements TableManegement runs on every start - the Replicated local
 * table ON CLUSTER, the Distributed table in front of it - and reconciles
 * it there each time (missing columns, skip indexes, projections, the
 * Distributed wrapper), reporting any column whose type or codec drifted
 * from the model. Here AnalyticsTableManagement.createTables() runs that
 * with the vault's service alone, twice, and:
 *
 *   - every replica holds the local table as the model says it - its
 *     engine, partition, keys, TTL and settings - and the Distributed one
 *     in front of it;
 *   - every column, on both tables and both replicas, is the type the
 *     model renders, and boot reports no drift, the first time or again;
 *   - rows written through the Distributed table are named by the vault's
 *     one read, and every replica holds them.
 *
 * Opt-in: it needs the cluster, which the docker compose file beside the
 * erasure suite starts (Tests/Workers/Fixtures/ClickhouseKeeperCluster):
 *
 *   docker compose -f Tests/Workers/Fixtures/ClickhouseKeeperCluster/docker-compose.yml up -d --wait
 *   TEST_CLICKHOUSE_KEEPER_CLUSTER_URL=http://default:test@localhost:18461 \
 *     npx jest Tests/Workers/SecurityAddressVaultTableKeeperClickhouse.test.ts
 *   docker compose -f Tests/Workers/Fixtures/ClickhouseKeeperCluster/docker-compose.yml down
 *
 * The suite creates and drops only its own database, on both replicas.
 * ------------------------------------------------------------------
 */

const mockLogged: Array<{ level: string; detail: unknown }> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  const record: (level: string) => (detail: unknown) => void = (
    level: string,
  ): ((detail: unknown) => void) => {
    return (detail: unknown): void => {
      mockLogged.push({ level, detail });
    };
  };

  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(record("warn")),
      error: jest.fn(record("error")),
    },
  };
});

// Boot's table creation, with the vault's service alone.
jest.mock("Common/Server/Services/Index", () => {
  const vault: unknown = (
    jest.requireActual(
      "Common/Server/Services/SecurityAddressVaultService",
    ) as {
      default: unknown;
    }
  ).default;

  return {
    __esModule: true,
    AnalyticsServices: [vault],
    default: [],
  };
});

import SecurityAddressVault from "Common/Models/AnalyticsModels/SecurityAddressVault";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import SecurityAddressVaultService, {
  SecurityAddressVaultService as SecurityAddressVaultServiceClass,
} from "Common/Server/Services/SecurityAddressVaultService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsTableManagement from "../../FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement";

const endpoint: string | undefined =
  process.env["TEST_CLICKHOUSE_KEEPER_CLUSTER_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const CLUSTER: string = "oneuptime";
const REPLICAS: Array<string> = ["replica-1", "replica-2"];

const database: string = `address_vault_keeper_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-0000000000f1",
);

const MODEL: SecurityAddressVault = new SecurityAddressVault();
const LOCAL_TABLE: string = `${MODEL.tableName}Local`;

// What a type reads as, with the spaces ClickHouse and the generator may differ by.
function normalized(type: string): string {
  return type.replace(/\s+/g, "");
}

// What boot reported about drift: every error and warning that names it.
function driftReports(): Array<unknown> {
  return mockLogged
    .filter((entry: { level: string; detail: unknown }): boolean => {
      return JSON.stringify(entry.detail).toLowerCase().includes("drift");
    })
    .map((entry: { level: string; detail: unknown }): unknown => {
      return entry.detail;
    });
}

integration("the address vault's table, as boot makes it on a cluster", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: Record<string, unknown> = {};
  const savedEnvironment: Record<string, string | undefined> = {};

  async function rows(query: string): Promise<Array<JSONObject>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<JSONObject>;
  }

  async function waitUntil(
    description: string,
    condition: () => Promise<boolean>,
  ): Promise<void> {
    const deadline: number = Date.now() + 120000;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 500);
      });
    }

    throw new Error(`Timed out waiting until ${description}`);
  }

  // Each replica's tables of the suite's database.
  async function tablesOnEachReplica(): Promise<Array<JSONObject>> {
    return rows(
      `SELECT hostName() AS replica, name, engine, engine_full, partition_key, sorting_key, primary_key, create_table_query, uuid FROM clusterAllReplicas('${CLUSTER}', system.tables) WHERE database = '${database}' ORDER BY replica, name`,
    );
  }

  async function waitForBothTablesOnEveryReplica(): Promise<void> {
    await waitUntil("every replica holds both tables", async () => {
      const tables: Array<JSONObject> = await tablesOnEachReplica();

      return tables.length === REPLICAS.length * 2;
    });
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_KEEPER_CLUSTER_URL must point at a local, disposable ClickHouse cluster.",
      );
    }

    // The cluster and database boot's statements name.
    for (const [key, value] of [
      ["CLICKHOUSE_CLUSTER_NAME", CLUSTER],
      ["CLICKHOUSE_DATABASE", database],
    ] as Array<[string, string]>) {
      savedEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${database} ON CLUSTER '${CLUSTER}'`,
    });

    original = {
      database: SecurityAddressVaultService.database,
      databaseClient: SecurityAddressVaultService.databaseClient,
      ingestDatabase: SecurityAddressVaultService.ingestDatabase,
      ingestDatabaseClient: SecurityAddressVaultService.ingestDatabaseClient,
      migrationDatabase: SecurityAddressVaultService.migrationDatabase,
      migrationDatabaseClient:
        SecurityAddressVaultService.migrationDatabaseClient,
      statementGenerator: SecurityAddressVaultService.statementGenerator,
    };

    SecurityAddressVaultService.database = clickhouse;
    SecurityAddressVaultService.databaseClient = client;
    SecurityAddressVaultService.ingestDatabase = clickhouse;
    SecurityAddressVaultService.ingestDatabaseClient = client;
    SecurityAddressVaultService.migrationDatabase = clickhouse;
    SecurityAddressVaultService.migrationDatabaseClient = client;
    // Boot's statements name the database the service's generator was made with.
    SecurityAddressVaultService.statementGenerator =
      new StatementGenerator<SecurityAddressVault>({
        modelType: SecurityAddressVault,
        database: clickhouse,
      });
  });

  afterAll(async (): Promise<void> => {
    Object.assign(SecurityAddressVaultService, original);

    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (client) {
      await client.command({
        query: `DROP DATABASE IF EXISTS ${database} ON CLUSTER '${CLUSTER}' SYNC`,
      });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("boot makes the local table on every replica as the model says, and the Distributed one in front of it", async () => {
    await AnalyticsTableManagement.createTables();
    await waitForBothTablesOnEveryReplica();

    const tables: Array<JSONObject> = await tablesOnEachReplica();

    for (const replica of REPLICAS) {
      const local: JSONObject | undefined = tables.find(
        (table: JSONObject): boolean => {
          return table["replica"] === replica && table["name"] === LOCAL_TABLE;
        },
      );
      const distributed: JSONObject | undefined = tables.find(
        (table: JSONObject): boolean => {
          return (
            table["replica"] === replica && table["name"] === MODEL.tableName
          );
        },
      );

      expect(local).toBeDefined();
      expect(local!["engine"]).toBe("ReplicatedAggregatingMergeTree");
      // Boot writes PARTITION BY (...): 26.7 keeps the brackets, 24.8 drops them.
      expect(String(local!["partition_key"]).replace(/^\((.*)\)$/, "$1")).toBe(
        "toYYYYMMDD(lastSeenAt)",
      );
      expect(local!["sorting_key"]).toBe("projectId, token, address");
      expect(local!["primary_key"]).toBe("projectId, token");
      expect(String(local!["create_table_query"])).toContain(
        "TTL lastSeenAt + toIntervalDay(30)",
      );
      expect(String(local!["create_table_query"])).toContain(
        "ttl_only_drop_parts = 1",
      );

      expect(distributed).toBeDefined();
      expect(distributed!["engine"]).toBe("Distributed");
      expect(String(distributed!["engine_full"])).toContain(
        `Distributed('${CLUSTER}', '${database}', '${LOCAL_TABLE}', cityHash64(projectId))`,
      );
    }
  });

  test("the drift check: every column on both tables and replicas is the model's type, and boot reports none", async () => {
    const columns: Array<JSONObject> = await rows(
      `SELECT hostName() AS replica, table, name, type FROM clusterAllReplicas('${CLUSTER}', system.columns) WHERE database = '${database}' ORDER BY replica, table, position`,
    );

    for (const replica of REPLICAS) {
      for (const table of [LOCAL_TABLE, MODEL.tableName]) {
        const physical: Array<JSONObject> = columns.filter(
          (column: JSONObject): boolean => {
            return column["replica"] === replica && column["table"] === table;
          },
        );

        expect(
          physical.map((column: JSONObject): string => {
            return `${String(column["name"])} ${normalized(String(column["type"]))}`;
          }),
        ).toEqual(
          MODEL.tableColumns.map((column: AnalyticsTableColumn): string => {
            return `${column.key} ${normalized(
              SecurityAddressVaultService.statementGenerator
                .toFullColumnType(column)
                .query.trim(),
            )}`;
          }),
        );
      }
    }

    expect(driftReports()).toEqual([]);
  });

  test("boot again changes nothing: the same tables, and still no drift", async () => {
    const before: Array<JSONObject> = await tablesOnEachReplica();

    await AnalyticsTableManagement.createTables();
    await waitForBothTablesOnEveryReplica();

    const after: Array<JSONObject> = await tablesOnEachReplica();

    // The Distributed table is not made again (CREATE OR REPLACE would change its UUID).
    expect(
      after.map((table: JSONObject): string => {
        return `${String(table["replica"])} ${String(table["name"])} ${String(table["uuid"])}`;
      }),
    ).toEqual(
      before.map((table: JSONObject): string => {
        return `${String(table["replica"])} ${String(table["name"])} ${String(table["uuid"])}`;
      }),
    );
    expect(driftReports()).toEqual([]);
  });

  test("rows written through the Distributed table are named by the vault's one read, and every replica holds them", async () => {
    const token: string = ScrubHashToken.ofIpAddress({
      projectId: PROJECT_ID,
      address: "203.0.113.7",
    });

    await SecurityAddressVaultService.insertJsonRows(
      SecurityAddressVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [{ token, address: "203.0.113.7" }],
        seenAt: new Date(),
      }),
      {
        clickhouseSettings: {
          wait_for_async_insert: 1,
          insert_distributed_sync: 1,
        },
      },
    );

    const found: Map<string, string> =
      await SecurityAddressVaultService.findAddressesOfTokens({
        projectId: PROJECT_ID,
        tokens: [token],
      });

    expect(found.get(token)).toBe("203.0.113.7");

    await waitUntil("both replicas hold the row", async () => {
      const held: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, toString(count()) AS c FROM clusterAllReplicas('${CLUSTER}', ${database}.${LOCAL_TABLE}) GROUP BY replica`,
      );

      return (
        held.length === REPLICAS.length &&
        held.every((row: JSONObject): boolean => {
          return Number(row["c"]) === 1;
        })
      );
    });
  });
});
