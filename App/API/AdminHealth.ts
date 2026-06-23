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
import BadDataException from "Common/Types/Exception/BadDataException";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";

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
  const stats: JSONArray = [];

  for (const queueName of SUPPORT_QUEUE_NAMES) {
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
 * The four BullMQ work queues this instance runs. Kept in one place so the
 * stats, diagnostics and failed-job endpoints all report on the same set.
 */
const SUPPORT_QUEUE_NAMES: Array<QueueName> = [
  QueueName.Workflow,
  QueueName.Worker,
  QueueName.Telemetry,
  QueueName.Runbook,
];

/*
 * Caps for the failed-job detail we pull per queue. We include the full job
 * body now (operators asked for it to debug), so the size guards matter: they
 * bound a single bundle / response even when a job carries a large payload.
 */
const MAX_FAILED_JOBS_PER_QUEUE: number = 25;
const MAX_FAILED_REASON_LENGTH: number = 2000;
const MAX_STACK_TRACE_LENGTH: number = 8000;
const MAX_JOB_LOG_LINES: number = 200;
const MAX_JOB_LOG_LINE_LENGTH: number = 2000;

// Bounds for the recursive scrub of arbitrary job bodies / options.
const MAX_REDACT_DEPTH: number = 8;
const MAX_REDACT_STRING_LENGTH: number = 2000;
const MAX_REDACT_ARRAY_ITEMS: number = 100;
const MAX_REDACT_OBJECT_KEYS: number = 200;
const MAX_JOB_VALUE_BYTES: number = 32768;

/*
 * Mask credentials in free-form text we now surface (job bodies, log lines, DB
 * error messages). Reuses the DDL credential scrubber (keyword='value' + AWS
 * keys) and additionally masks the password in `scheme://user:pass@host`
 * connection strings. Best-effort — it is the second line of defence behind the
 * key-name redaction in deepRedactValue, not a guarantee that all data is safe.
 */
const CONNECTION_STRING_SECRET_PATTERN: RegExp =
  /([a-z][a-z0-9+.-]*:\/\/[^:@\s/]+):[^@\s/]+@/gi;

function scrubSecretsFromText(text: string): string {
  if (!text) {
    return text;
  }

  return redactDdlSecrets(text).replace(
    CONNECTION_STRING_SECRET_PATTERN,
    (_match: string, prefix: string): string => {
      return `${prefix}:***REDACTED***@`;
    },
  );
}

/*
 * Field names whose VALUE we always drop, regardless of type, when walking a
 * job body / options object. Catches camelCase and snake_case secrets that the
 * env-var-oriented SECRET_KEY_PATTERN above would miss.
 */
const SENSITIVE_FIELD_NAME_PATTERN: RegExp =
  /pass(word)?|secret|token|api[_-]?key|apikey|credential|private[_-]?key|authorization|auth[_-]?token|access[_-]?key|client[_-]?secret|cookie|session[_-]?id|bearer|signature|encryption/i;

/*
 * Recursively redact an arbitrary value for safe display: drop the values of
 * sensitive-looking keys, scrub credential patterns out of strings, and cap
 * depth / string length / collection size so a pathological payload can't blow
 * up the response. Returns JSON-safe data.
 */
function deepRedactValue(value: unknown, depth: number): JSONValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (depth > MAX_REDACT_DEPTH) {
    return "[redacted: max depth reached]";
  }

  const valueType: string = typeof value;

  if (valueType === "string") {
    const scrubbed: string = scrubSecretsFromText(value as string);
    return scrubbed.length > MAX_REDACT_STRING_LENGTH
      ? `${scrubbed.substring(0, MAX_REDACT_STRING_LENGTH)}… (truncated)`
      : scrubbed;
  }

  if (valueType === "number" || valueType === "boolean") {
    return value as number | boolean;
  }

  if (valueType === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items: Array<JSONValue> = value
      .slice(0, MAX_REDACT_ARRAY_ITEMS)
      .map((item: unknown): JSONValue => {
        return deepRedactValue(item, depth + 1);
      });

    if (value.length > MAX_REDACT_ARRAY_ITEMS) {
      items.push(`… ${value.length - MAX_REDACT_ARRAY_ITEMS} more items truncated`);
    }

    return items;
  }

  if (valueType === "object") {
    const objectValue: Record<string, unknown> = value as Record<
      string,
      unknown
    >;
    const allKeys: Array<string> = Object.keys(objectValue);
    const out: JSONObject = {};

    for (const key of allKeys.slice(0, MAX_REDACT_OBJECT_KEYS)) {
      out[key] = SENSITIVE_FIELD_NAME_PATTERN.test(key)
        ? "***REDACTED***"
        : deepRedactValue(objectValue[key], depth + 1);
    }

    if (allKeys.length > MAX_REDACT_OBJECT_KEYS) {
      out["_truncated"] = `… ${allKeys.length - MAX_REDACT_OBJECT_KEYS} more keys truncated`;
    }

    return out;
  }

  // functions, symbols, etc. — not representable in the bundle.
  return `[redacted: ${valueType}]`;
}

/*
 * Final size guard: if a redacted value still serializes larger than the cap,
 * replace it with a small placeholder so one big job can't bloat the response.
 */
function capSerializedSize(
  value: JSONValue,
  maxBytes: number,
  label: string,
): JSONValue {
  try {
    const serialized: string = JSON.stringify(value);

    if (serialized && serialized.length > maxBytes) {
      return {
        _truncated: true,
        _note: `${label} omitted — exceeds ${Math.round(maxBytes / 1024)} KB after redaction`,
        _approxSizeBytes: serialized.length,
      };
    }
  } catch {
    return { _note: `${label} could not be serialized` };
  }

  return value;
}

// Redacted, size-capped representation of one BullMQ failed job (with body).
function redactFullFailedJob(job: {
  id: string;
  name: string;
  data: JSONObject;
  opts: JSONObject;
  returnValue: unknown;
  progress: number | object | null;
  failedReason: string;
  stackTrace: Array<string>;
  logs: Array<string>;
  attemptsMade: number;
  attemptsStarted: number | null;
  stalledCounter: number | null;
  priority: number | null;
  delay: number | null;
  createdAt: Date | null;
  processedOn: Date | null;
  finishedOn: Date | null;
  queueQualifiedName: string | null;
  repeatJobKey: string | null;
  deduplicationId: string | null;
  processedBy: string | null;
  parentKey: string | null;
}): JSONObject {
  const dataKeys: Array<string> =
    job.data && typeof job.data === "object" && !Array.isArray(job.data)
      ? Object.keys(job.data)
      : [];

  const logs: Array<string> = (job.logs || [])
    .slice(-MAX_JOB_LOG_LINES)
    .map((line: string): string => {
      const scrubbed: string = scrubSecretsFromText(String(line));
      return scrubbed.length > MAX_JOB_LOG_LINE_LENGTH
        ? `${scrubbed.substring(0, MAX_JOB_LOG_LINE_LENGTH)}… (truncated)`
        : scrubbed;
    });

  const stackTrace: string = scrubSecretsFromText(
    (job.stackTrace || []).join("\n"),
  ).substring(0, MAX_STACK_TRACE_LENGTH);

  return {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    attemptsStarted: job.attemptsStarted,
    stalledCounter: job.stalledCounter,
    priority: job.priority,
    delayMs: job.delay,
    failedReason: scrubSecretsFromText(job.failedReason || "").substring(
      0,
      MAX_FAILED_REASON_LENGTH,
    ),
    stackTrace: stackTrace || null,
    logs: logs,
    progress: deepRedactValue(job.progress, 0),
    createdAt: toIsoOrNull(job.createdAt),
    processedAt: toIsoOrNull(job.processedOn),
    finishedAt: toIsoOrNull(job.finishedOn),
    queueQualifiedName: job.queueQualifiedName,
    repeatJobKey: job.repeatJobKey,
    deduplicationId: job.deduplicationId,
    processedBy: job.processedBy,
    parentKey: job.parentKey,
    dataKeys: dataKeys,
    data: capSerializedSize(
      deepRedactValue(job.data, 0),
      MAX_JOB_VALUE_BYTES,
      "Job body",
    ),
    options: capSerializedSize(
      deepRedactValue(job.opts, 0),
      MAX_JOB_VALUE_BYTES,
      "Job options",
    ),
    returnValue: capSerializedSize(
      deepRedactValue(job.returnValue, 0),
      MAX_JOB_VALUE_BYTES,
      "Return value",
    ),
  };
}

// Most-recent failed jobs for one queue, with full (redacted) detail.
async function getFailedJobsForQueue(queueName: QueueName): Promise<JSONArray> {
  const failedJobs: Awaited<
    ReturnType<typeof Queue.getFailedJobsWithDetails>
  > = await Queue.getFailedJobsWithDetails(queueName, {
    start: 0,
    // getFailed(start, end) is an inclusive range, so end = count - 1.
    end: MAX_FAILED_JOBS_PER_QUEUE - 1,
  });

  return failedJobs.map(redactFullFailedJob);
}

/*
 * Deeper queue diagnostics for the support bundle: per-queue job-state counts
 * plus the most-recent failed jobs (reason + stack trace, redacted). A growing
 * backlog or a burst of failures is the usual signal that a worker class is
 * wedged, and the failure reason/stack is what we need to diagnose it.
 */
async function getQueueDiagnostics(): Promise<JSONArray> {
  const diagnostics: JSONArray = [];

  for (const queueName of SUPPORT_QUEUE_NAMES) {
    try {
      const [queueStats, recentFailedJobs] = await Promise.all([
        Queue.getQueueStats(queueName),
        getFailedJobsForQueue(queueName),
      ]);

      diagnostics.push({
        name: queueName,
        waiting: queueStats.waiting,
        active: queueStats.active,
        completed: queueStats.completed,
        failed: queueStats.failed,
        delayed: queueStats.delayed,
        total: queueStats.total,
        recentFailedJobsReturned: recentFailedJobs.length,
        recentFailedJobs,
        error: false,
      });
    } catch (err) {
      logger.error(
        `AdminHealth: failed to read queue diagnostics for ${queueName}`,
      );
      logger.error(err);
      diagnostics.push({ name: queueName, error: true });
    }
  }

  return diagnostics;
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

/*
 * ---------------------------------------------------------------------------
 * Diagnostic logs
 *
 * Operators asked for datastore + container logs in the dashboard / bundle.
 * What is actually reachable from inside the app process:
 *   - Application logs: this process's OWN recent log lines (in-memory ring
 *     buffer in Logger). The app writes to stdout only, so this is the only
 *     in-app view of its logs; it cannot read its container's stdout, nor any
 *     other container's logs (no Docker socket / Kubernetes API access).
 *   - Postgres: the server log file IF logging_collector is on (we connect as
 *     superuser, so pg_read_file works) — otherwise unavailable, best-effort.
 *   - ClickHouse: system.errors / text_log / query_log / crash_log (OneUptime's
 *     ClickHouse config enables these), read-only and time-capped.
 *   - Redis: server log files are NOT reachable over the protocol; we surface
 *     SLOWLOG + INFO errorstats/stats as the closest equivalent.
 * Every log surface below contains potentially sensitive data, so all text is
 * run through scrubSecretsFromText before it leaves the process.
 * ---------------------------------------------------------------------------
 */

// How many bytes from the tail of the Postgres log file we read back.
const PG_LOG_TAIL_BYTES: number = 65536;
const PG_LOG_TAIL_MAX_LINES: number = 400;

/*
 * Postgres server log: only readable when the operator has turned on
 * logging_collector (off in OneUptime's default Postgres). We connect as
 * superuser, so when it IS on, pg_current_logfile()+pg_read_file() let us tail
 * it. Degrades gracefully (with a clear note) when logs aren't collected.
 */
async function getPostgresLogs(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    available: false,
    note: null,
    logFile: null,
    logTail: null,
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    result["connected"] = true;

    const logFileRows: Array<{ logfile: string | null }> =
      await dataSource.query("SELECT pg_current_logfile() AS logfile");
    const logFile: string | null = logFileRows?.[0]?.logfile || null;

    if (!logFile) {
      result["note"] =
        "Postgres is not writing server logs to a file on this instance (logging_collector is off). Turn on logging_collector with log_destination='stderr' or 'csvlog' to surface them here, or read them with `kubectl logs` / `docker logs` on the Postgres container.";
      return result;
    }

    result["logFile"] = logFile;

    // Read only the tail of the file so we never pull a multi-GB log.
    const sizeRows: Array<{ size: string }> = await dataSource.query(
      "SELECT size FROM pg_stat_file($1)",
      [logFile],
    );
    const size: number | null = toNumberOrNull(sizeRows?.[0]?.size);

    let offset: number = 0;
    let length: number = PG_LOG_TAIL_BYTES;

    if (size !== null && size > PG_LOG_TAIL_BYTES) {
      offset = size - PG_LOG_TAIL_BYTES;
    } else if (size !== null) {
      length = size;
    }

    const contentRows: Array<{ content: string }> = await dataSource.query(
      "SELECT pg_read_file($1, $2, $3) AS content",
      [logFile, offset, length],
    );
    const content: string = String(contentRows?.[0]?.content || "");
    const lines: Array<string> = scrubSecretsFromText(content).split(/\r?\n/);

    result["logTail"] = lines.slice(-PG_LOG_TAIL_MAX_LINES);
    result["available"] = true;
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres logs");
    logger.error(err);
    if (!result["note"]) {
      result["note"] =
        "Could not read the Postgres server log file (needs superuser / pg_read_server_files and logging_collector=on). Use `kubectl logs` / `docker logs` on the Postgres container instead.";
    }
  }

  return result;
}

/*
 * ClickHouse logs/errors from its system tables — error counters, recent server
 * log lines, failed queries and crashes. OneUptime's ClickHouse config enables
 * text_log / query_log / error_log / crash_log; each block degrades gracefully
 * if a table is missing or disabled. We deliberately omit the query TEXT from
 * failed queries (it can embed row predicates) and keep only the exception.
 */
async function getClickhouseLogs(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    note: "Recent ClickHouse errors and (when enabled) server log lines. For the full container log use `kubectl logs` / `docker logs` on the ClickHouse pod.",
    errors: [],
    recentLogEntries: [],
    failedQueries: [],
    crashes: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    result["connected"] = true;

    // system.errors — always available; aggregated error counters.
    try {
      const errorsResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT name, code, value AS count, toString(last_error_time) AS last_error_time, substring(last_error_message, 1, 1000) AS last_error_message FROM system.errors WHERE value > 0 ORDER BY last_error_time DESC LIMIT 100" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["errors"] = (errorsResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            name: String(row["name"]),
            code: toNumberOrNull(row["code"]),
            count: toNumberOrNull(row["count"]),
            lastErrorTime: toIsoOrNull(row["last_error_time"]),
            lastErrorMessage: row["last_error_message"]
              ? scrubSecretsFromText(String(row["last_error_message"]))
              : null,
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: system.errors unavailable");
      logger.debug(err);
    }

    // system.text_log — recent server log lines (Warning and above).
    try {
      const textLogResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT toString(event_time) AS event_time, level, logger_name, substring(message, 1, 1000) AS message FROM system.text_log WHERE level IN ('Fatal','Critical','Error','Warning') ORDER BY event_time DESC LIMIT 200" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["recentLogEntries"] = (textLogResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            time: toIsoOrNull(row["event_time"]),
            level: String(row["level"]),
            logger: String(row["logger_name"]),
            message: scrubSecretsFromText(String(row["message"])),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: system.text_log unavailable (not enabled)");
      logger.debug(err);
    }

    // system.query_log — recent failed queries (exception only, no query text).
    try {
      const failedQueriesResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT toString(event_time) AS event_time, query_id, type, exception_code, substring(exception, 1, 1000) AS exception FROM system.query_log WHERE exception != '' ORDER BY event_time DESC LIMIT 50" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["failedQueries"] = (failedQueriesResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            time: toIsoOrNull(row["event_time"]),
            queryId: String(row["query_id"]),
            type: String(row["type"]),
            exceptionCode: toNumberOrNull(row["exception_code"]),
            exception: scrubSecretsFromText(String(row["exception"])),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: system.query_log unavailable");
      logger.debug(err);
    }

    // system.crash_log — fatal crashes (usually empty).
    try {
      const crashResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT toString(event_time) AS event_time, signal, thread_id, query_id, arrayStringConcat(trace_full, '\\n') AS trace FROM system.crash_log ORDER BY event_time DESC LIMIT 5" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["crashes"] = (crashResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            time: toIsoOrNull(row["event_time"]),
            signal: toNumberOrNull(row["signal"]),
            threadId: toNumberOrNull(row["thread_id"]),
            queryId: String(row["query_id"]),
            trace: String(row["trace"] || "").substring(0, 4000),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: system.crash_log unavailable");
      logger.debug(err);
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse logs");
    logger.error(err);
  }

  return result;
}

// Parse a Redis INFO blob into a flat key/value map (drops `# Section` headers).
function parseRedisInfo(info: string): JSONObject {
  const result: JSONObject = {};

  for (const rawLine of info.split(/\r?\n/)) {
    const line: string = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex: number = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    result[line.substring(0, separatorIndex)] = line.substring(
      separatorIndex + 1,
    );
  }

  return result;
}

/*
 * Redis "logs": the server log file is not reachable over the protocol, so we
 * surface SLOWLOG (recent slow commands — the closest thing to a log) plus the
 * INFO errorstats / stats counters. Command arguments in SLOWLOG can contain
 * keys/values, so they are scrubbed and truncated.
 */
async function getRedisLogs(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    note: "Redis server log files are not reachable over the Redis protocol. Showing SLOWLOG and INFO counters instead — use `kubectl logs` / `docker logs` on the Redis container for the full server log.",
    slowlog: [],
    errorStats: [],
    stats: null,
  };

  try {
    const client: ReturnType<typeof Redis.getClient> = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return result;
    }

    result["connected"] = true;

    // SLOWLOG GET — recent slow commands.
    try {
      const rawSlowlog: unknown = await client.slowlog("GET", 32);

      if (Array.isArray(rawSlowlog)) {
        result["slowlog"] = rawSlowlog.map((entry: unknown): JSONObject => {
          const fields: Array<unknown> = Array.isArray(entry)
            ? (entry as Array<unknown>)
            : [];
          const args: Array<string> = Array.isArray(fields[3])
            ? (fields[3] as Array<unknown>).map((arg: unknown): string => {
                return String(arg);
              })
            : [];

          return {
            id: toNumberOrNull(fields[0]),
            at:
              typeof fields[1] === "number"
                ? toIsoOrNull(new Date((fields[1] as number) * 1000))
                : null,
            durationMs:
              fields[2] !== undefined && fields[2] !== null
                ? Number(fields[2]) / 1000
                : null,
            command: scrubSecretsFromText(args.join(" ")).substring(0, 500),
            client: fields[4] ? String(fields[4]) : null,
          };
        });
      }
    } catch (err) {
      logger.debug("AdminHealth: Redis SLOWLOG unavailable");
      logger.debug(err);
    }

    // INFO errorstats — per-error-type counters (Redis 6+).
    try {
      const errorStatsInfo: string = await client.info("errorstats");
      const parsed: JSONObject = parseRedisInfo(errorStatsInfo);

      result["errorStats"] = Object.keys(parsed).map(
        (key: string): JSONObject => {
          return {
            error: key.replace(/^errorstat_/, ""),
            detail: String(parsed[key]),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: Redis INFO errorstats unavailable");
      logger.debug(err);
    }

    // A few high-signal counters from INFO stats.
    try {
      const statsInfo: string = await client.info("stats");
      const parsed: JSONObject = parseRedisInfo(statsInfo);

      result["stats"] = {
        totalConnectionsReceived: toNumberOrNull(
          parsed["total_connections_received"],
        ),
        totalCommandsProcessed: toNumberOrNull(
          parsed["total_commands_processed"],
        ),
        rejectedConnections: toNumberOrNull(parsed["rejected_connections"]),
        expiredKeys: toNumberOrNull(parsed["expired_keys"]),
        evictedKeys: toNumberOrNull(parsed["evicted_keys"]),
        keyspaceHits: toNumberOrNull(parsed["keyspace_hits"]),
        keyspaceMisses: toNumberOrNull(parsed["keyspace_misses"]),
        instantaneousOpsPerSec: toNumberOrNull(
          parsed["instantaneous_ops_per_sec"],
        ),
      };
    } catch (err) {
      logger.debug("AdminHealth: Redis INFO stats unavailable");
      logger.debug(err);
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read Redis logs");
    logger.error(err);
  }

  return result;
}

/*
 * This app process's OWN recent log lines, from the in-memory ring buffer in
 * Logger. This is the only in-app view of the app's logs (it writes to stdout
 * only); it is NOT the container log and does not include other containers.
 */
function getApplicationLogs(): JSONObject {
  const entries: JSONArray = logger
    .getRecentLogs(500)
    .map((entry: { time: string; level: string; message: string }): JSONObject => {
      return {
        time: entry.time,
        level: entry.level,
        message: scrubSecretsFromText(entry.message),
      };
    });

  return {
    source: "In-process ring buffer (this app instance only).",
    note: "This OneUptime app process's own recent log lines, captured in memory. The app cannot read its container's stdout or other containers' logs from inside the process — use `kubectl logs` / `docker logs` for the full container logs.",
    count: entries.length,
    entries: entries,
  };
}

/*
 * Aggregate all log surfaces for the dashboard / support bundle. Container
 * stdout/stderr (for any container) is not reachable from the app process, so
 * we say so explicitly and provide the closest in-app equivalents.
 */
async function getDiagnosticLogs(): Promise<JSONObject> {
  const [postgres, clickhouse, redis] = await Promise.all([
    getPostgresLogs(),
    getClickhouseLogs(),
    getRedisLogs(),
  ]);

  return {
    application: getApplicationLogs(),
    postgres,
    clickhouse,
    redis,
    containerLogsNote:
      "Container stdout/stderr logs — for this app and for the Postgres / ClickHouse / Redis containers — cannot be read from inside the app process (it has no Docker socket or Kubernetes API access). Use `kubectl logs <pod>` (Kubernetes) or `docker logs <container>` (Docker Compose). The sections above are the closest in-app equivalents.",
  };
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
 * Recent failed jobs for a single queue, fetched on demand by the health
 * dashboard when an operator expands a queue. Like the overview it backs, it is
 * an Enterprise Edition feature and master-admin only. Each job includes its
 * full (redacted, size-capped) body, options, return value and per-job logs for
 * debugging — see redactFullFailedJob. Sensitive-looking fields and credential
 * patterns are scrubbed, but the body can still contain customer data.
 */
router.get(
  "/queues/:queueName/failed-jobs",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!IsEnterpriseEdition) {
        throw new PaymentRequiredException(
          "The instance health dashboard is only available on the OneUptime Enterprise Edition. " +
            "Please switch to the Enterprise Edition build to enable this feature. " +
            "See https://oneuptime.com/enterprise/overview for details.",
        );
      }

      const requestedQueue: string = String(req.params["queueName"]);

      // Only allow the known queue names — never feed arbitrary input to BullMQ.
      const queueName: QueueName | undefined = SUPPORT_QUEUE_NAMES.find(
        (name: QueueName): boolean => {
          return name === requestedQueue;
        },
      );

      if (!queueName) {
        throw new BadDataException(`Unknown queue: ${requestedQueue}`);
      }

      const [stats, failedJobs] = await Promise.all([
        Queue.getQueueStats(queueName),
        getFailedJobsForQueue(queueName),
      ]);

      return Response.sendJsonObjectResponse(req, res, {
        name: queueName,
        stats,
        failedJobs,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Diagnostic logs for the health dashboard: this app instance's own recent log
 * lines plus what we can read from the datastores (Postgres log tail when
 * collected, ClickHouse system-table errors/logs, Redis SLOWLOG + counters).
 * Enterprise Edition + master-admin only, matching the overview it sits beside.
 * Everything is scrubbed for credentials but logs can contain customer data.
 */
router.get(
  "/logs",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!IsEnterpriseEdition) {
        throw new PaymentRequiredException(
          "The instance health dashboard is only available on the OneUptime Enterprise Edition. " +
            "Please switch to the Enterprise Edition build to enable this feature. " +
            "See https://oneuptime.com/enterprise/overview for details.",
        );
      }

      const data: JSONObject = await getDiagnosticLogs();
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
        queueDiagnostics,
        postgresDiagnostics,
        clickhouseDiagnostics,
        logs,
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
        getClickhouseDiagnostics(),
        getDiagnosticLogs(),
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
        queueDiagnostics,
        postgresDiagnostics,
        clickhouseDiagnostics,
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

export default router;
