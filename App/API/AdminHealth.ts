import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import {
  AppVersion,
  ClickhouseDatabase as ClickhouseDatabaseName,
  GitSha,
  Host,
  IsEnterpriseEdition,
} from "Common/Server/EnvironmentConfig";
import PostgresSchemaMigrations from "Common/Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DataMigrationsList from "../FeatureSet/Workers/DataMigrations/Index";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import OneUptimeDate from "Common/Types/Date";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import { JSONArray, JSONObject } from "Common/Types/JSON";

const router: ExpressRouter = Express.getRouter();

/*
 * The overview aggregates several DB-introspection queries. Master-admin
 * traffic is low-volume, but the page polls, so we cache the result briefly to
 * keep the queries off the datastores on every refresh.
 */
const CACHE_TTL_MS: number = 15000;
let overviewCache: { data: JSONObject; expiresAt: number } | null = null;

type ClickhouseJsonResult = { data: Array<JSONObject> };

// Parse a possibly-bigint-as-string value (Postgres/ClickHouse return UInt64/bigint as strings in JSON).
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed: number = Number(value);
  return isNaN(parsed) ? null : parsed;
}

async function getPostgresStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    databaseSizeInBytes: null,
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    const rows: Array<{ size: string }> = await dataSource.query(
      "SELECT pg_database_size(current_database()) AS size",
    );

    result["connected"] = true;
    result["databaseSizeInBytes"] = toNumberOrNull(rows?.[0]?.size);
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres stats");
    logger.error(err);
  }

  return result;
}

async function getClickhouseStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    dataSizeInBytes: null,
    diskFreeInBytes: null,
    diskTotalInBytes: null,
    topTables: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    // Total size of active parts on disk.
    const sizeResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT sum(bytes_on_disk) AS bytes FROM system.parts WHERE active",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["connected"] = true;
    result["dataSizeInBytes"] = toNumberOrNull(sizeResult.data?.[0]?.["bytes"]);

    // Underlying volume free/total capacity.
    const diskResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT sum(free_space) AS free, sum(total_space) AS total FROM system.disks",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["diskFreeInBytes"] = toNumberOrNull(diskResult.data?.[0]?.["free"]);
    result["diskTotalInBytes"] = toNumberOrNull(
      diskResult.data?.[0]?.["total"],
    );

    // Largest tables (usually the telemetry tables) so operators can see what consumes space.
    const tablesResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT table AS name, sum(bytes_on_disk) AS bytes FROM system.parts WHERE active GROUP BY table ORDER BY bytes DESC LIMIT 8",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["topTables"] = (tablesResult.data || []).map(
      (row: JSONObject): JSONObject => {
        return {
          name: String(row["name"]),
          sizeInBytes: toNumberOrNull(row["bytes"]),
        };
      },
    );
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse stats");
    logger.error(err);
  }

  return result;
}

// Read a single integer field out of the Redis INFO memory section.
function parseRedisInfoValue(info: string, key: string): number | null {
  const line: string | undefined = info
    .split(/\r?\n/)
    .find((current: string): boolean => {
      return current.startsWith(`${key}:`);
    });

  if (!line) {
    return null;
  }

  return toNumberOrNull(line.split(":")[1]);
}

async function getRedisStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    usedMemoryInBytes: null,
    maxMemoryInBytes: null,
  };

  try {
    const client: ReturnType<typeof Redis.getClient> = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return result;
    }

    const info: string = await client.info("memory");

    result["connected"] = true;
    result["usedMemoryInBytes"] = parseRedisInfoValue(info, "used_memory");
    result["maxMemoryInBytes"] = parseRedisInfoValue(info, "maxmemory");
  } catch (err) {
    logger.error("AdminHealth: failed to read Redis stats");
    logger.error(err);
  }

  return result;
}

async function getQueueStats(): Promise<JSONArray> {
  const queueNames: Array<QueueName> = [
    QueueName.Workflow,
    QueueName.Worker,
    QueueName.Telemetry,
    QueueName.Runbook,
  ];

  const stats: JSONArray = [];

  for (const queueName of queueNames) {
    try {
      const queueStats: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        total: number;
      } = await Queue.getQueueStats(queueName);

      stats.push({
        name: queueName,
        waiting: queueStats.waiting,
        active: queueStats.active,
        completed: queueStats.completed,
        failed: queueStats.failed,
        delayed: queueStats.delayed,
        total: queueStats.total,
        error: false,
      });
    } catch (err) {
      logger.error(`AdminHealth: failed to read queue stats for ${queueName}`);
      logger.error(err);
      stats.push({ name: queueName, error: true });
    }
  }

  return stats;
}

/*
 * Migration-name timestamps are the trailing epoch in the class name
 * (e.g. "AddArchiveToResources1782600000000"). TypeORM sorts and stores
 * migrations by this value, so it is also how we identify the newest one.
 */
function parseMigrationTimestamp(name: string): number | null {
  const match: RegExpMatchArray | null = name.match(/(\d{10,})$/);
  return match ? toNumberOrNull(match[1]) : null;
}

/*
 * De-duplicate migration names while preserving first-seen order. Both runners
 * key applied migrations by NAME, so a name that appears twice in a build (e.g.
 * a copy-paste mistake in a migration's super(name) call) is a single tracked
 * unit — counting it twice would make a fully-migrated instance look behind.
 */
function distinctNames(names: Array<string>): Array<string> {
  return Array.from(new Set(names));
}

/*
 * Postgres (TypeORM) schema migration status: compare the migrations shipped
 * in this build against the rows recorded in the `migrations` table so an
 * operator can tell at a glance whether the schema is fully migrated.
 */
async function getPostgresMigrationStatus(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    isUpToDate: false,
    totalDefined: 0,
    totalApplied: 0,
    totalPending: 0,
    latestDefinedMigration: null,
    latestAppliedMigration: null,
    pendingMigrations: [],
  };

  // Source-of-truth list of schema migrations compiled into this build.
  const definedNames: Array<string> = distinctNames(
    (PostgresSchemaMigrations as Array<new () => { name: string }>).map(
      (MigrationClass: new () => { name: string }): string => {
        return new MigrationClass().name;
      },
    ),
  );

  result["totalDefined"] = definedNames.length;

  // Newest migration this build knows about (highest epoch timestamp in name).
  const latestDefined: string | undefined = [...definedNames]
    .sort((a: string, b: string): number => {
      return (
        (parseMigrationTimestamp(a) || 0) - (parseMigrationTimestamp(b) || 0)
      );
    })
    .pop();

  if (latestDefined) {
    result["latestDefinedMigration"] = {
      name: latestDefined,
      timestamp: parseMigrationTimestamp(latestDefined),
    };
  }

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    const rows: Array<{ name: string; timestamp: string }> =
      await dataSource.query(
        "SELECT name, timestamp FROM migrations ORDER BY timestamp ASC",
      );

    result["connected"] = true;
    result["totalApplied"] = rows.length;

    const appliedNames: Set<string> = new Set(
      rows.map((row: { name: string }): string => {
        return row.name;
      }),
    );

    const pending: Array<string> = definedNames.filter(
      (name: string): boolean => {
        return !appliedNames.has(name);
      },
    );

    result["pendingMigrations"] = pending;
    result["totalPending"] = pending.length;
    result["isUpToDate"] = pending.length === 0;

    const lastRow: { name: string; timestamp: string } | undefined =
      rows[rows.length - 1];

    if (lastRow) {
      result["latestAppliedMigration"] = {
        name: lastRow.name,
        timestamp: toNumberOrNull(lastRow.timestamp),
      };
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres migration status");
    logger.error(err);
  }

  return result;
}

/*
 * Data migrations (ClickHouse schema + data backfills) run in a fixed array
 * order and record themselves in the Postgres `DataMigrations` table on
 * success. Because the runner halts the chain at the first failure, the first
 * pending migration is the one that is blocking every migration after it.
 */
async function getDataMigrationStatus(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    isUpToDate: false,
    totalDefined: 0,
    totalApplied: 0,
    totalPending: 0,
    latestDefinedMigration: null,
    lastExecutedMigration: null,
    nextPendingMigration: null,
    pendingMigrations: [],
  };

  // Ordered list of data / ClickHouse migrations compiled into this build.
  const definedNames: Array<string> = distinctNames(
    DataMigrationsList.map((migration: { name: string }): string => {
      return migration.name;
    }),
  );

  result["totalDefined"] = definedNames.length;

  if (definedNames.length > 0) {
    result["latestDefinedMigration"] = {
      name: definedNames[definedNames.length - 1],
    };
  }

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    const rows: Array<{ name: string; executedAt: string | null }> =
      await dataSource.query(
        'SELECT name, "executedAt" FROM "DataMigrations" WHERE executed = true',
      );

    result["connected"] = true;
    result["totalApplied"] = rows.length;

    const appliedNames: Set<string> = new Set(
      rows.map((row: { name: string }): string => {
        return row.name;
      }),
    );

    // Keep run order so the first pending migration is the one blocking the chain.
    const pending: Array<string> = definedNames.filter(
      (name: string): boolean => {
        return !appliedNames.has(name);
      },
    );

    result["pendingMigrations"] = pending;
    result["totalPending"] = pending.length;
    result["isUpToDate"] = pending.length === 0;
    result["nextPendingMigration"] = pending[0] || null;

    // Most-recently executed migration (executedAt may be null on very old rows).
    const lastExecuted: { name: string; executedAt: string | null } | null =
      rows
        .filter((row: { executedAt: string | null }): boolean => {
          return Boolean(row.executedAt);
        })
        .sort(
          (
            a: { executedAt: string | null },
            b: { executedAt: string | null },
          ): number => {
            return (
              new Date(a.executedAt as string).getTime() -
              new Date(b.executedAt as string).getTime()
            );
          },
        )
        .pop() || null;

    if (lastExecuted) {
      result["lastExecutedMigration"] = {
        name: lastExecuted.name,
        executedAt: lastExecuted.executedAt,
      };
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read data migration status");
    logger.error(err);
  }

  return result;
}

async function getMigrationStatus(): Promise<JSONObject> {
  const [postgres, dataMigrations] = await Promise.all([
    getPostgresMigrationStatus(),
    getDataMigrationStatus(),
  ]);

  return {
    postgres,
    dataMigrations,
  };
}

/*
 * Full Postgres schema (tables + columns) read from information_schema. We
 * deliberately dump structure only — never row data — so the support bundle is
 * safe to share with OneUptime for diagnostics.
 */
async function getPostgresSchema(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    serverVersion: null,
    databaseSizeInBytes: null,
    tableCount: 0,
    tables: [],
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    result["connected"] = true;

    const versionRows: Array<{ server_version: string }> =
      await dataSource.query("SHOW server_version");
    result["serverVersion"] = versionRows?.[0]?.server_version || null;

    const sizeRows: Array<{ size: string }> = await dataSource.query(
      "SELECT pg_database_size(current_database()) AS size",
    );
    result["databaseSizeInBytes"] = toNumberOrNull(sizeRows?.[0]?.size);

    const columnRows: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
    }> = await dataSource.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name ASC, ordinal_position ASC`,
    );

    // Group the flat column list into one entry per table, preserving order.
    const tableMap: Map<string, JSONArray> = new Map();

    for (const row of columnRows) {
      const columns: JSONArray = tableMap.get(row.table_name) || [];
      columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
        default: row.column_default,
        maxLength: toNumberOrNull(row.character_maximum_length),
      });
      tableMap.set(row.table_name, columns);
    }

    const tables: JSONArray = [];
    for (const [name, columns] of tableMap) {
      tables.push({ name, columns });
    }

    result["tables"] = tables;
    result["tableCount"] = tables.length;
  } catch (err) {
    logger.error("AdminHealth: failed to dump Postgres schema");
    logger.error(err);
  }

  return result;
}

/*
 * Full ClickHouse schema. system.tables.create_table_query gives the exact DDL
 * (engine, ordering keys, codecs) for every table and materialized view in the
 * configured database — exactly what we need to diagnose schema drift.
 */
async function getClickhouseSchema(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    database: ClickhouseDatabaseName,
    serverVersion: null,
    tableCount: 0,
    tables: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    result["connected"] = true;

    const versionResult: ClickhouseJsonResult = (await (
      await client.query({
        query: "SELECT version() AS version",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;
    result["serverVersion"] = versionResult.data?.[0]?.["version"] || null;

    const tablesResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT name, engine, create_table_query FROM system.tables WHERE database = currentDatabase() ORDER BY name ASC",
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    const tables: JSONArray = (tablesResult.data || []).map(
      (row: JSONObject): JSONObject => {
        return {
          name: String(row["name"]),
          engine: String(row["engine"]),
          createTableQuery: String(row["create_table_query"]),
        };
      },
    );

    result["tables"] = tables;
    result["tableCount"] = tables.length;
  } catch (err) {
    logger.error("AdminHealth: failed to dump ClickHouse schema");
    logger.error(err);
  }

  return result;
}

router.get(
  "/overview",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Instance health is an Enterprise Edition feature — gate server-side to match the UI.
      if (!IsEnterpriseEdition) {
        throw new PaymentRequiredException(
          "The instance health dashboard is only available on the OneUptime Enterprise Edition. " +
            "Please switch to the Enterprise Edition build to enable this feature. " +
            "See https://oneuptime.com/enterprise/overview for details.",
        );
      }

      if (overviewCache && overviewCache.expiresAt > Date.now()) {
        return Response.sendJsonObjectResponse(req, res, overviewCache.data);
      }

      const [postgres, clickhouse, redis, queues] = await Promise.all([
        getPostgresStats(),
        getClickhouseStats(),
        getRedisStats(),
        getQueueStats(),
      ]);

      const data: JSONObject = {
        postgres,
        clickhouse,
        redis,
        queues,
      };

      overviewCache = {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };

      return Response.sendJsonObjectResponse(req, res, data);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Migration status is intentionally NOT gated behind the Enterprise Edition:
 * every self-hosting operator (Community included) needs to confirm their
 * schema is fully migrated, and this is the data we ask them for when they
 * report an upgrade problem.
 */
router.get(
  "/migrations",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = await getMigrationStatus();
      return Response.sendJsonObjectResponse(req, res, data);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Support bundle: a single JSON document with the instance version, migration
 * status and full Postgres + ClickHouse schema (structure only, no row data).
 * Self-hosting customers download this and send it to OneUptime so we can
 * diagnose schema / migration issues without access to their cluster. Like the
 * migration status above, it is available on every edition for master admins.
 */
router.get(
  "/support-bundle",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const [migrations, postgresSchema, clickhouseSchema] = await Promise.all([
        getMigrationStatus(),
        getPostgresSchema(),
        getClickhouseSchema(),
      ]);

      const bundle: JSONObject = {
        generatedAt: OneUptimeDate.getCurrentDate().toISOString(),
        instance: {
          appVersion: AppVersion,
          gitSha: GitSha,
          edition: IsEnterpriseEdition ? "Enterprise" : "Community",
          host: Host,
          nodeVersion: process.version,
        },
        migrations,
        postgres: postgresSchema,
        clickhouse: clickhouseSchema,
      };

      return Response.sendJsonObjectResponse(req, res, bundle);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
