import os from "os";
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

/*
 * Normalise a timestamp to an ISO string for the JSON bundle. Accepts Date
 * (node-postgres) or string (ClickHouse JSON); anything else, an unparseable
 * value, or ClickHouse's 1970-01-01 zero-DateTime sentinel becomes null.
 */
function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (!(value instanceof Date) && typeof value !== "string") {
    return null;
  }

  const raw: string = value instanceof Date ? value.toISOString() : value;

  // ClickHouse returns an unset DateTime as the epoch — treat it as "no value".
  if (raw.startsWith("1970-01-01")) {
    return null;
  }

  const date: Date = new Date(raw);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

/*
 * Best-effort credential scrub for the verbatim DDL we dump (ClickHouse
 * create_table_query). Masks values in credential-like `keyword = 'value'`
 * settings and AWS-style access keys. OneUptime's own ClickHouse uses only
 * MergeTree-family engines with no inline secrets, but external / dictionary
 * engines can embed credentials, so we redact defensively to keep the bundle's
 * "no secrets" guarantee.
 */
const DDL_SECRET_PATTERN: RegExp =
  /(password|secret_access_key|aws_secret_access_key|secret_key|access_key_id|aws_access_key_id|private_key|auth_token|api_key|apikey|secret|token|credential)(\s*=\s*|\s+)('(?:[^']|'')*'|"[^"]*"|`[^`]*`|[^\s,)]+)/gi;

function redactDdlSecrets(ddl: string): string {
  if (!ddl) {
    return ddl;
  }

  return ddl
    .replace(
      DDL_SECRET_PATTERN,
      (_match: string, keyword: string, separator: string): string => {
        const joiner: string = separator.includes("=") ? " = " : " ";
        return `${keyword}${joiner}'***REDACTED***'`;
      },
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "***REDACTED***");
}

/*
 * Mask the contents of quoted string literals in a Postgres column default
 * (e.g. DEFAULT 'some-literal'). This keeps the useful structural signal — that
 * a column has a default, and whether it is a function or a constant — while
 * guaranteeing a literal default value can never leak a secret.
 */
function redactDefaultExpression(value: string | null): string | null {
  if (value === null || value === undefined) {
    return value;
  }

  return String(value).replace(/'(?:[^']|'')*'/g, "'***'");
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

  try {
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

  try {
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
        default: redactDefaultExpression(row.column_default),
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
          createTableQuery: redactDdlSecrets(String(row["create_table_query"])),
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

/*
 * Operationally-relevant configuration, redacted. We emit values ONLY for an
 * explicit allow-list of non-secret keys (pool sizes, timeouts, feature flags,
 * datastore host/port) — never usernames, passwords, secrets, tokens, OTLP auth
 * headers or TLS material. Knowing the effective tuning is most of what we need
 * to reason about pool exhaustion, timeouts and disabled subsystems.
 */
const SUPPORT_CONFIG_ALLOW_LIST: Array<string> = [
  "NODE_ENV",
  "HOST",
  "IS_ENTERPRISE_EDITION",
  "BILLING_ENABLED",
  "LOG_LEVEL",
  "APP_VERSION",
  "GIT_SHA",
  "RUN_DATABASE_MIGRATIONS_ON_BOOT",
  "DISABLE_TELEMETRY",
  "DISABLE_TELEMETRY_INGESTION",
  "DISABLE_QUEUE_WORKERS",
  "DISABLE_AUTOMATIC_INCIDENT_CREATION",
  "DISABLE_AUTOMATIC_ALERT_CREATION",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "DATABASE_HOST",
  "DATABASE_PORT",
  "DATABASE_NAME",
  "DATABASE_MAX_OPEN_CONNECTIONS",
  "DATABASE_STATEMENT_TIMEOUT_MS",
  "DATABASE_QUERY_TIMEOUT_MS",
  "DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS",
  "DATABASE_CONNECTION_TIMEOUT_MS",
  "DATABASE_IDLE_TIMEOUT_MS",
  "DATABASE_IDLE_SESSION_TIMEOUT_MS",
  "DATABASE_SLOW_QUERY_LOG_THRESHOLD_MS",
  "CLICKHOUSE_HOST",
  "CLICKHOUSE_PORT",
  "CLICKHOUSE_DATABASE",
  "CLICKHOUSE_IS_HOST_HTTPS",
  "CLICKHOUSE_MAX_OPEN_CONNECTIONS",
  "CLICKHOUSE_INGEST_MAX_OPEN_CONNECTIONS",
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_DB",
  "REDIS_IP_FAMILY",
  "WORKFLOW_TIMEOUT_IN_MS",
  "WORKFLOW_SCRIPT_TIMEOUT_IN_MS",
];

/*
 * Defence-in-depth: even though the allow-list above is curated, drop any key
 * that looks like a credential. This guarantees the "no secrets" promise holds
 * even if a sensitive key is mistakenly added to the allow-list in the future.
 */
const SECRET_KEY_PATTERN: RegExp =
  /PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|APIKEY|_KEY|HEADERS|CERT|_CA$|_SSL|AUTH/i;

function getRedactedConfig(): JSONObject {
  const config: JSONObject = {};

  for (const key of SUPPORT_CONFIG_ALLOW_LIST) {
    if (SECRET_KEY_PATTERN.test(key)) {
      // Allow-list entry looks sensitive — skip rather than risk a leak.
      continue;
    }

    const value: string | undefined = process.env[key];

    if (typeof value !== "undefined") {
      config[key] = value;
    }
  }

  return config;
}

/*
 * Process and host runtime: uptime, memory pressure, CPU count and load. This
 * is what we ask for when an instance is OOMing, restarting or running slow.
 * None of it is customer data.
 */
function getRuntimeInfo(): JSONObject {
  const memory: NodeJS.MemoryUsage = process.memoryUsage();

  return {
    processUptimeSeconds: Math.round(process.uptime()),
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    cpuCount: os.cpus().length,
    systemTotalMemoryBytes: os.totalmem(),
    systemFreeMemoryBytes: os.freemem(),
    loadAverage: os.loadavg(),
    processMemory: {
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
    },
  };
}

/*
 * Postgres runtime diagnostics: tuning settings, a connection-state summary and
 * per-table churn / vacuum stats. We read only counts, durations and settings
 * (never query text or row data), so this stays safe to share. The connection
 * summary surfaces lock convoys (idle-in-transaction pile-ups, lock waits); the
 * table stats surface dead-tuple bloat and stalled autovacuum.
 */
async function getPostgresDiagnostics(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    settings: [],
    connections: null,
    topTablesBySize: [],
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    result["connected"] = true;

    const settingRows: Array<{
      name: string;
      setting: string;
      unit: string | null;
    }> = await dataSource.query(
      `SELECT name, setting, unit FROM pg_settings WHERE name IN (
         'max_connections','shared_buffers','work_mem','maintenance_work_mem',
         'effective_cache_size','statement_timeout','idle_in_transaction_session_timeout',
         'autovacuum','autovacuum_max_workers','autovacuum_naptime',
         'max_parallel_workers','max_worker_processes','max_wal_size','server_version')
       ORDER BY name ASC`,
    );

    result["settings"] = settingRows.map(
      (row: {
        name: string;
        setting: string;
        unit: string | null;
      }): JSONObject => {
        return { name: row.name, value: row.setting, unit: row.unit };
      },
    );

    // Single aggregate over pg_stat_activity — no per-connection query text.
    const connectionRows: Array<{
      total: string;
      active: string;
      idle: string;
      idle_in_transaction: string;
      waiting_on_lock: string;
      longest_transaction_seconds: string;
      longest_active_query_seconds: string;
      longest_idle_in_transaction_seconds: string;
    }> = await dataSource.query(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE state = 'active') AS active,
         count(*) FILTER (WHERE state = 'idle') AS idle,
         count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_transaction,
         count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_on_lock,
         COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - xact_start))), 0) AS longest_transaction_seconds,
         COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - query_start)) FILTER (WHERE state = 'active')), 0) AS longest_active_query_seconds,
         COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - state_change)) FILTER (WHERE state = 'idle in transaction')), 0) AS longest_idle_in_transaction_seconds
       FROM pg_stat_activity
       WHERE datname = current_database()`,
    );

    const conn: (typeof connectionRows)[number] | undefined =
      connectionRows?.[0];

    if (conn) {
      result["connections"] = {
        total: toNumberOrNull(conn.total),
        active: toNumberOrNull(conn.active),
        idle: toNumberOrNull(conn.idle),
        idleInTransaction: toNumberOrNull(conn.idle_in_transaction),
        waitingOnLock: toNumberOrNull(conn.waiting_on_lock),
        longestTransactionSeconds: toNumberOrNull(
          conn.longest_transaction_seconds,
        ),
        longestActiveQuerySeconds: toNumberOrNull(
          conn.longest_active_query_seconds,
        ),
        longestIdleInTransactionSeconds: toNumberOrNull(
          conn.longest_idle_in_transaction_seconds,
        ),
      };
    }

    const tableRows: Array<{
      table: string;
      live_tuples: string;
      dead_tuples: string;
      updates: string;
      hot_updates: string;
      inserts: string;
      deletes: string;
      last_autovacuum: string | Date | null;
      last_autoanalyze: string | Date | null;
      total_bytes: string;
    }> = await dataSource.query(
      `SELECT
         relname AS table,
         n_live_tup AS live_tuples,
         n_dead_tup AS dead_tuples,
         n_tup_upd AS updates,
         n_tup_hot_upd AS hot_updates,
         n_tup_ins AS inserts,
         n_tup_del AS deletes,
         last_autovacuum,
         last_autoanalyze,
         pg_total_relation_size(relid) AS total_bytes
       FROM pg_stat_user_tables
       ORDER BY pg_total_relation_size(relid) DESC
       LIMIT 20`,
    );

    result["topTablesBySize"] = tableRows.map(
      (row: (typeof tableRows)[number]): JSONObject => {
        return {
          name: String(row.table),
          liveTuples: toNumberOrNull(row.live_tuples),
          deadTuples: toNumberOrNull(row.dead_tuples),
          updates: toNumberOrNull(row.updates),
          hotUpdates: toNumberOrNull(row.hot_updates),
          inserts: toNumberOrNull(row.inserts),
          deletes: toNumberOrNull(row.deletes),
          lastAutovacuum: toIsoOrNull(row.last_autovacuum),
          lastAutoanalyze: toIsoOrNull(row.last_autoanalyze),
          totalSizeInBytes: toNumberOrNull(row.total_bytes),
        };
      },
    );
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres diagnostics");
    logger.error(err);
  }

  return result;
}

/*
 * Hard server-side wall-clock cap for the (read-only, system-table) diagnostic
 * queries so a slow introspection on a large instance can't tie up a ClickHouse
 * thread for the full client request timeout.
 */
const CH_DIAG_QUERY_SETTINGS: string = " SETTINGS max_execution_time = 10";

/*
 * ClickHouse runtime diagnostics: concurrency / memory settings, mutation
 * progress and part-count pressure. Stuck or failing mutations and runaway part
 * counts are the usual causes of telemetry-ingest backlogs. We emit the engine
 * fail-reason (an infrastructure error, not row data) but never the mutation
 * command, which can embed row predicates.
 */
async function getClickhouseDiagnostics(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    serverSettings: [],
    sessionSettings: [],
    mutations: { total: null, unfinished: null, failed: null, items: [] },
    activeMerges: null,
    topTablesByParts: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    result["connected"] = true;

    // Server-level concurrency / memory ceilings (separate system table from session settings).
    try {
      const serverSettingsResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT name, value FROM system.server_settings WHERE name IN ('max_concurrent_queries','max_concurrent_select_queries','max_server_memory_usage','background_pool_size') ORDER BY name ASC" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["serverSettings"] = (serverSettingsResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return { name: String(row["name"]), value: String(row["value"]) };
        },
      );
    } catch {
      // system.server_settings is not present on older ClickHouse — degrade gracefully.
      logger.debug(
        "AdminHealth: system.server_settings unavailable on this ClickHouse version",
      );
    }

    const sessionSettingsResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT name, value FROM system.settings WHERE name IN ('max_threads','max_memory_usage','max_execution_time','max_bytes_before_external_group_by') ORDER BY name ASC" +
          CH_DIAG_QUERY_SETTINGS,
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["sessionSettings"] = (sessionSettingsResult.data || []).map(
      (row: JSONObject): JSONObject => {
        return { name: String(row["name"]), value: String(row["value"]) };
      },
    );

    const mutationSummaryResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT count() AS total, countIf(is_done = 0) AS unfinished, countIf(latest_fail_reason != '') AS failed FROM system.mutations" +
          CH_DIAG_QUERY_SETTINGS,
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    const mutationSummary: JSONObject = mutationSummaryResult.data?.[0] || {};

    // Only unfinished or failed mutations, oldest first. No `command` column (it can embed row predicates).
    const mutationItemsResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT database, table, mutation_id, is_done, parts_to_do, create_time, latest_fail_time, latest_fail_reason FROM system.mutations WHERE is_done = 0 OR latest_fail_reason != '' ORDER BY create_time ASC LIMIT 50" +
          CH_DIAG_QUERY_SETTINGS,
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["mutations"] = {
      total: toNumberOrNull(mutationSummary["total"]),
      unfinished: toNumberOrNull(mutationSummary["unfinished"]),
      failed: toNumberOrNull(mutationSummary["failed"]),
      items: (mutationItemsResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            database: String(row["database"]),
            table: String(row["table"]),
            mutationId: String(row["mutation_id"]),
            isDone: toNumberOrNull(row["is_done"]),
            partsToDo: toNumberOrNull(row["parts_to_do"]),
            createTime: toIsoOrNull(row["create_time"]),
            latestFailTime: toIsoOrNull(row["latest_fail_time"]),
            latestFailReason: row["latest_fail_reason"]
              ? String(row["latest_fail_reason"]).substring(0, 500)
              : null,
          };
        },
      ),
    };

    const mergesResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT count() AS merges FROM system.merges" +
          CH_DIAG_QUERY_SETTINGS,
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["activeMerges"] = toNumberOrNull(mergesResult.data?.[0]?.["merges"]);

    // Part-count pressure: too many active parts per table means merges aren't keeping up.
    const partsResult: ClickhouseJsonResult = (await (
      await client.query({
        query:
          "SELECT table, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS bytes FROM system.parts WHERE active GROUP BY table ORDER BY parts DESC LIMIT 15" +
          CH_DIAG_QUERY_SETTINGS,
        format: "JSON",
      })
    ).json()) as ClickhouseJsonResult;

    result["topTablesByParts"] = (partsResult.data || []).map(
      (row: JSONObject): JSONObject => {
        return {
          name: String(row["table"]),
          parts: toNumberOrNull(row["parts"]),
          rows: toNumberOrNull(row["rows"]),
          sizeInBytes: toNumberOrNull(row["bytes"]),
        };
      },
    );
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse diagnostics");
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
 * Support bundle: a single JSON document with the instance version & runtime,
 * redacted (non-secret) configuration, component health, migration status,
 * Postgres + ClickHouse runtime diagnostics and full schema. It contains only
 * structure, counts, timings and settings — no row data, no secrets — so a
 * self-hosting customer can download it and send it to OneUptime to diagnose
 * issues without giving us access to their cluster. Like the migration status
 * above, it is available on every edition for master admins.
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
      const [
        migrations,
        postgresSchema,
        clickhouseSchema,
        postgresStats,
        clickhouseStats,
        redisStats,
        queueStats,
        postgresDiagnostics,
        clickhouseDiagnostics,
      ] = await Promise.all([
        getMigrationStatus(),
        getPostgresSchema(),
        getClickhouseSchema(),
        getPostgresStats(),
        getClickhouseStats(),
        getRedisStats(),
        getQueueStats(),
        getPostgresDiagnostics(),
        getClickhouseDiagnostics(),
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
        runtime: getRuntimeInfo(),
        config: getRedactedConfig(),
        components: {
          postgres: postgresStats,
          clickhouse: clickhouseStats,
          redis: redisStats,
          queues: queueStats,
        },
        migrations,
        postgresDiagnostics,
        clickhouseDiagnostics,
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
