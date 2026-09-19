import os from "os";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import {
  AppVersion,
  ClickhouseDatabase as ClickhouseDatabaseName,
  GitSha,
  Host,
} from "Common/Server/EnvironmentConfig";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
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
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import InstanceHealthLog from "Common/Models/DatabaseModels/InstanceHealthLog";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  ClickhouseJsonResult,
  getClickhouseDiagnostics,
  getClickhouseStats,
  getClickhouseTelemetryIngestion,
  getDiagnosticLogs,
  getPostgresClusterHealth,
  getPostgresDiagnostics,
  getPostgresStats,
  getQueueDiagnostics,
  getQueueStats,
  getRedisStats,
  redactDdlSecrets,
  scrubSecretsFromText,
  toIsoOrNull,
  toNumberOrNull,
} from "./AdminHealthProbes";

/*
 * The OneUptime Health API that ships with every edition: ClickHouse
 * capacity, the instance health log, migration status and the support
 * bundle, plus 402 fallbacks for the paths the Enterprise Edition module
 * serves (the live dashboards and the query console). The probes these
 * routes share with the enterprise dashboards live in ./AdminHealthProbes.ts.
 */
const router: ExpressRouter = Express.getRouter();

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

// Most-recent failed attempts we surface per migration runner.
const MAX_MIGRATION_FAILURES: number = 25;

/*
 * Read the persisted failed-migration attempts for one runner
 * ("PostgresSchema" or "DataMigration"). This is what lets the status card
 * answer WHY a migration is pending — the error and when it last ran — instead
 * of only that it is behind. The table is written by the migration runners
 * (see Common/Server/Utils/Database/MigrationFailureLog). Guarded: on an
 * instance whose schema predates the MigrationFailure table (its own migration
 * still pending) the query throws and we simply report no failures. Error text
 * is re-scrubbed here with the fuller support-bundle scrubber even though it is
 * masked at write time.
 */
async function getMigrationFailures(
  dataSource: NonNullable<ReturnType<typeof PostgresAppInstance.getDataSource>>,
  migrationType: string,
): Promise<JSONArray> {
  try {
    const rows: Array<{
      migrationName: string;
      errorMessage: string | null;
      errorStack: string | null;
      attemptedAt: Date | string | null;
      hostName: string | null;
      appVersion: string | null;
    }> = await dataSource.query(
      `SELECT "migrationName", "errorMessage", "errorStack", "attemptedAt", "hostName", "appVersion"
       FROM "MigrationFailure"
       WHERE "migrationType" = $1 AND "deletedAt" IS NULL
       ORDER BY "attemptedAt" DESC
       LIMIT $2`,
      [migrationType, MAX_MIGRATION_FAILURES],
    );

    return rows.map((row: (typeof rows)[number]): JSONObject => {
      return {
        migrationName: String(row.migrationName),
        errorMessage: scrubSecretsFromText(String(row.errorMessage || "")),
        errorStack: row.errorStack
          ? scrubSecretsFromText(String(row.errorStack))
          : null,
        attemptedAt: toIsoOrNull(row.attemptedAt),
        hostName: row.hostName ? String(row.hostName) : null,
        appVersion: row.appVersion ? String(row.appVersion) : null,
      };
    });
  } catch {
    /*
     * Table absent (its migration is itself pending) or unreadable — the
     * status payload should still render, just without failure detail.
     */
    logger.debug(
      "AdminHealth: MigrationFailure table not readable (may be pending); reporting no failures",
    );
    return [];
  }
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
    recentFailures: [],
    lastFailedAt: null,
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

    // Why any of the above are pending: persisted failed attempts + last try.
    const failures: JSONArray = await getMigrationFailures(
      dataSource,
      "PostgresSchema",
    );
    result["recentFailures"] = failures;
    result["lastFailedAt"] =
      failures.length > 0 ? (failures[0] as JSONObject)["attemptedAt"] : null;
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
    recentFailures: [],
    lastFailedAt: null,
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

    // Persisted failed attempts so the card can explain a halted chain.
    const failures: JSONArray = await getMigrationFailures(
      dataSource,
      "DataMigration",
    );
    result["recentFailures"] = failures;
    result["lastFailedAt"] =
      failures.length > 0 ? (failures[0] as JSONObject)["attemptedAt"] : null;
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
export const SUPPORT_CONFIG_ALLOW_LIST: Array<string> = [
  "NODE_ENV",
  "HOST",
  /*
   * What the operator asked for, as configured. The edition this process
   * actually runs is instance.edition (with instance.license).
   */
  "IS_ENTERPRISE_EDITION",
  "ONEUPTIME_EDITION",
  "BILLING_ENABLED",
  "LOG_LEVEL",
  "APP_VERSION",
  "GIT_SHA",
  "RUN_DATABASE_MIGRATIONS_ON_BOOT",
  /*
   * The first thing to check when an IP allowlist matches nobody, or matches
   * everybody: a wrong hop count is the usual cause of both.
   */
  "TRUSTED_PROXY_HOPS",
  "DISABLE_TELEMETRY",
  "DISABLE_TELEMETRY_INGESTION",
  "DISABLE_UPDATE_CHECK",
  "DISABLE_QUEUE_WORKERS",
  "DISABLE_AUTOMATIC_INCIDENT_CREATION",
  "DISABLE_AUTOMATIC_ALERT_CREATION",
  /*
   * On-call calendar feeds: the kill switch answers "503 on every feed" and
   * the rate-limit tuning answers "429 for a whole office" — the two feed
   * troubleshooting scenarios the docs point operators at. All non-secret:
   * a boolean and three small integers (requests per window).
   */
  "DISABLE_ON_CALL_CALENDAR_FEED",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW",
  "DATABASE_HOST",
  "DATABASE_PORT",
  "DATABASE_NAME",
  "DATABASE_MAX_OPEN_CONNECTIONS",
  "DATABASE_STATEMENT_TIMEOUT_MS",
  "DATABASE_LOCK_TIMEOUT_MS",
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
  "VALKEY_HOST",
  "VALKEY_PORT",
  "VALKEY_DB",
  "VALKEY_IP_FAMILY",
  /*
   * The names these carried until 13.0.0. getRedactedConfig() reports only keys
   * actually present in process.env, so dropping them would leave an instance
   * still on the deprecated spelling with no cache host, port or database in its
   * support bundle at all -- silently, and precisely when the cache is the
   * suspect.
   */
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

/*
 * Allow-listed keys that trip SECRET_KEY_PATTERN on a substring but are not
 * credentials. ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW contains
 * "TOKEN" only because the limit is counted PER feed token — the value itself
 * is a small integer (requests per window), never a token. Add a key here
 * only when its VALUE is provably non-secret.
 */
export const SECRET_KEY_PATTERN_EXCEPTIONS: Set<string> = new Set<string>([
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
]);

export function getRedactedConfig(): JSONObject {
  const config: JSONObject = {};

  for (const key of SUPPORT_CONFIG_ALLOW_LIST) {
    if (
      !SECRET_KEY_PATTERN_EXCEPTIONS.has(key) &&
      SECRET_KEY_PATTERN.test(key)
    ) {
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
 * The edition and license this process actually runs with, for the support
 * bundle. Never the raw IS_ENTERPRISE_EDITION variable: that only says what an
 * operator asked for, and an install that set it on the Community image (or
 * runs the Enterprise image with a lapsed license) is exactly the kind we get
 * support bundles from.
 */
function getSupportBundleEdition(): string {
  return EnterpriseEdition.isLoaded() ? "Enterprise" : "Community";
}

/*
 * License status for the support bundle: the state and dates support needs to
 * explain a locked dashboard or a read-only setting, never the key or token.
 * Null on the Community Edition. A failed read is reported, not thrown, so the
 * bundle still downloads.
 */
async function getSupportBundleLicense(): Promise<JSONObject | null> {
  if (!EnterpriseEdition.isLoaded()) {
    return null;
  }

  try {
    const snapshot: EnterpriseLicenseSnapshot | null =
      await EnterpriseEdition.getLicenseSnapshot();

    if (!snapshot) {
      return { status: "unknown" };
    }

    return {
      status: snapshot.status,
      verification: snapshot.verification,
      graceReason: snapshot.graceReason || null,
      expiresAt: toIsoOrNull(snapshot.expiresAt || null),
      graceEndsAt: toIsoOrNull(snapshot.graceEndsAt || null),
      isEvaluation: snapshot.isEvaluation,
      userLimit: snapshot.userLimit,
      features:
        snapshot.features === "all" ? "all" : [...snapshot.features].sort(),
      instanceHealthAvailable: await EnterpriseEdition.isFeatureAvailable(
        EnterpriseFeature.InstanceHealth,
      ),
    };
  } catch (err) {
    logger.error("AdminHealth: failed to read the license for the bundle");
    logger.error(err);
    return { status: "unknown" };
  }
}

/*
 * ---------------------------------------------------------------------------
 * Editions
 *
 * The routes below that do real work answer on every edition:
 * /clickhouse-capacity and /instance-health-logs (ClickHouse capacity alerts
 * and automatic pruning are Community features, and the instance log is their
 * audit trail), /migrations and /support-bundle.
 *
 * The live OneUptime Health dashboards and the query console are part of the
 * OneUptime Enterprise Edition and live in the enterprise module
 * (ee/Server/AdminHealth); the fallbacks at the end of this file answer their
 * paths when that module does not. The raw IS_ENTERPRISE_EDITION variable is
 * never read here.
 * ---------------------------------------------------------------------------
 */

/*
 * ClickHouse capacity is available on every edition: the capacity alerts and
 * automatic pruning it backs run on the Community Edition too, and an
 * operator has to be able to see how full the disk is before turning pruning
 * on.
 */
router.get(
  "/clickhouse-capacity",
  MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      return Response.sendJsonObjectResponse(
        req,
        res,
        await getClickhouseStats(),
      );
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * The instance health log: every capacity notification and automatic
 * ClickHouse pruning run this instance recorded (plus the Postgres and Valkey
 * notifications on the Enterprise Edition). Available on every edition, because
 * pruning is a Community feature that drops telemetry partitions, and this is
 * the only record of what it dropped and why.
 */
router.get(
  "/instance-health-logs",
  MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const logs: Array<InstanceHealthLog> =
        await InstanceHealthLogService.findBy({
          query: {},
          select: {
            _id: true,
            eventType: true,
            status: true,
            message: true,
            completedAt: true,
            nextCheckAt: true,
            capacityBeforePercent: true,
            capacityAfterPercent: true,
            thresholdPercent: true,
            targetPercent: true,
            estimatedFreedBytes: true,
            metadata: true,
            createdAt: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          skip: 0,
          limit: 50,
          props: {
            isRoot: true,
          },
        });

      const items: JSONArray = logs.map(
        (log: InstanceHealthLog): JSONObject => {
          return {
            _id: log._id || null,
            eventType: log.eventType || null,
            status: log.status || null,
            message: log.message || "",
            completedAt: toIsoOrNull(log.completedAt),
            nextCheckAt: toIsoOrNull(log.nextCheckAt),
            capacityBeforePercent: log.capacityBeforePercent ?? null,
            capacityAfterPercent: log.capacityAfterPercent ?? null,
            thresholdPercent: log.thresholdPercent ?? null,
            targetPercent: log.targetPercent ?? null,
            estimatedFreedBytes: log.estimatedFreedBytes ?? null,
            metadata: log.metadata || null,
            createdAt: toIsoOrNull(log.createdAt),
          };
        },
      );

      return Response.sendJsonObjectResponse(req, res, { logs: items });
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
  MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
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
 * Postgres + ClickHouse runtime diagnostics, full schema, deep failed-job
 * detail and diagnostic logs. Credentials are scrubbed everywhere (config,
 * DDL, connection strings, sensitive field names), but — because operators
 * asked for it to debug — this bundle now DOES include failed-job bodies and
 * application / datastore logs, which can contain customer data. So it is no
 * longer guaranteed free of customer data: it should be reviewed before being
 * shared externally. Like the migration status above, it is available on every
 * edition for master admins.
 */
router.get(
  "/support-bundle",
  MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
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
        queueDiagnostics,
        postgresDiagnostics,
        postgresClusterHealth,
        clickhouseDiagnostics,
        clickhouseTelemetryIngestion,
        logs,
        supportBundleLicense,
      ] = await Promise.all([
        getMigrationStatus(),
        getPostgresSchema(),
        getClickhouseSchema(),
        getPostgresStats(),
        getClickhouseStats(),
        getRedisStats(),
        getQueueStats(),
        getQueueDiagnostics(),
        getPostgresDiagnostics(),
        getPostgresClusterHealth(),
        getClickhouseDiagnostics(),
        getClickhouseTelemetryIngestion(),
        getDiagnosticLogs(),
        getSupportBundleLicense(),
      ]);

      const bundle: JSONObject = {
        generatedAt: OneUptimeDate.getCurrentDate().toISOString(),
        instance: {
          appVersion: AppVersion,
          gitSha: GitSha,
          // The edition this process actually runs, not the raw env flag.
          edition: getSupportBundleEdition(),
          license: supportBundleLicense,
          host: Host,
          nodeVersion: process.version,
        },
        runtime: getRuntimeInfo(),
        config: getRedactedConfig(),
        components: {
          postgres: postgresStats,
          clickhouse: clickhouseStats,
          /*
           * Stays `redis` deliberately. This is a wire key, not display text:
           * the admin dashboard reads summary["redis"] / data["redis"], and the
           * shape is published in the API reference. The engine underneath it is
           * Valkey.
           */
          redis: redisStats,
          queues: queueStats,
        },
        migrations,
        queueDiagnostics,
        postgresDiagnostics,
        postgresClusterHealth,
        clickhouseDiagnostics,
        clickhouseTelemetryIngestion,
        logs,
        postgres: postgresSchema,
        clickhouse: clickhouseSchema,
      };

      return Response.sendJsonObjectResponse(req, res, bundle);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * ---------------------------------------------------------------------------
 * Live dashboard fallbacks
 *
 * The live OneUptime Health dashboards (the overview, background queues and
 * their failed jobs, Valkey, diagnostic logs, the ClickHouse cluster,
 * telemetry ingestion, the Postgres cluster and live Postgres activity) are
 * part of the OneUptime Enterprise Edition and are served by the enterprise
 * module's router, which App/Index.ts mounts ahead of this one. These routes
 * answer the same GET paths when that router is not there - the Community
 * Edition - with a 402 instead of a 404, so the admin dashboard and API
 * callers can say why. Each keeps the middleware the enterprise route uses,
 * so nobody learns anything about the edition without the same credentials,
 * and nothing here touches a datastore.
 * ---------------------------------------------------------------------------
 */

export const HEALTH_DASHBOARD_PATHS: ReadonlyArray<string> = [
  "/overview",
  "/queues",
  "/queues/:queueName/failed-jobs",
  "/redis",
  "/logs",
  "/clickhouse-cluster",
  "/clickhouse-telemetry-ingestion",
  "/clickhouse-telemetry-ingestion-by-project",
  "/postgres-cluster",
  "/postgres-activity",
];

/*
 * Live Postgres activity returns statement text, so - like the query console -
 * it takes a signed-in master admin only, never the static master API key.
 * Every other dashboard path also accepts the master API key.
 */
export const JWT_ONLY_HEALTH_DASHBOARD_PATHS: ReadonlyArray<string> = [
  "/postgres-activity",
];

export const HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE: string =
  "The OneUptime Health dashboards are provided by the OneUptime Enterprise Edition module, " +
  "which did not serve this request. Check the server log for enterprise module errors.";

// Both master-admin middlewares share this signature.
export type HealthDashboardMiddleware =
  typeof MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware;

export const getHealthDashboardMiddleware: (
  path: string,
) => HealthDashboardMiddleware = (path: string): HealthDashboardMiddleware => {
  return JWT_ONLY_HEALTH_DASHBOARD_PATHS.includes(path)
    ? MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware
    : MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware;
};

for (const healthDashboardPath of HEALTH_DASHBOARD_PATHS) {
  router.get(
    healthDashboardPath,
    getHealthDashboardMiddleware(healthDashboardPath),
    async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        // The Community Edition and license answers, with their own messages.
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        // Enterprise is loaded and licensed, yet its dashboards did not answer.
        throw new PaymentRequiredException(
          HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
        );
      } catch (err) {
        return next(err);
      }
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * Query console fallbacks
 *
 * The query console (POST /query/postgres, /query/clickhouse, /query/redis) is
 * part of the OneUptime Enterprise Edition and is served by the enterprise
 * module's router, which App/Index.ts mounts ahead of this one. These routes
 * answer the same paths when that router is not there - the Community Edition
 * - with a 402 instead of a 404, so the admin dashboard can say why. They keep
 * the console's JWT-only master-admin middleware: nobody learns anything about
 * the edition without a master-admin session.
 * ---------------------------------------------------------------------------
 */

export const QUERY_CONSOLE_PATHS: ReadonlyArray<string> = [
  "/query/postgres",
  "/query/clickhouse",
  "/query/redis",
];

export const QUERY_CONSOLE_UNAVAILABLE_MESSAGE: string =
  "The OneUptime Health query console is provided by the OneUptime Enterprise Edition module, " +
  "which did not serve this request. Check the server log for enterprise module errors.";

for (const queryConsolePath of QUERY_CONSOLE_PATHS) {
  router.post(
    queryConsolePath,
    MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        // The Community Edition and license answers, with their own messages.
        await EnterpriseEdition.assertFeatureAvailable(
          EnterpriseFeature.InstanceHealth,
        );

        // Enterprise is loaded and licensed, yet its console did not answer.
        throw new PaymentRequiredException(QUERY_CONSOLE_UNAVAILABLE_MESSAGE);
      } catch (err) {
        return next(err);
      }
    },
  );
}

export default router;
