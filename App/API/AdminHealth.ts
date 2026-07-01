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
import { getClickhouseClusterName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";

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
/*
 * Mask the password in `scheme://user:pass@host`. The password class allows `@`
 * (greedy up to the LAST `@` before a `/` or whitespace) so passwords that
 * themselves contain `@` are fully masked rather than leaking the tail.
 */
const CONNECTION_STRING_SECRET_PATTERN: RegExp =
  /([a-z][a-z0-9+.-]*:\/\/[^:@\s/]+):[^\s/]+@/gi;

/*
 * Auth material that the keyword='value' DDL scrubber misses: HTTP auth headers
 * (`Authorization: Bearer …`, `X-Api-Key: …`), standalone `Bearer <token>`, and
 * raw JWTs (three base64url segments starting `eyJ`). These commonly show up in
 * job stack traces and log lines from failed outbound HTTP calls.
 */
const AUTH_HEADER_SECRET_PATTERN: RegExp =
  /\b(authorization|proxy-authorization|x-api-key|x-auth-token|x-functions-key|api[-_]?key|access[-_]?token)\b(\s*[:=]\s*)(bearer\s+|basic\s+|token\s+)?([^\s,;"']+)/gi;
const BEARER_TOKEN_PATTERN: RegExp = /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN: RegExp =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function scrubSecretsFromText(text: string): string {
  if (!text) {
    return text;
  }

  return redactDdlSecrets(text)
    .replace(
      CONNECTION_STRING_SECRET_PATTERN,
      (_match: string, prefix: string): string => {
        return `${prefix}:***REDACTED***@`;
      },
    )
    .replace(
      AUTH_HEADER_SECRET_PATTERN,
      (
        _match: string,
        name: string,
        separator: string,
        scheme: string,
      ): string => {
        return `${name}${separator}${scheme || ""}***REDACTED***`;
      },
    )
    .replace(BEARER_TOKEN_PATTERN, (_match: string, scheme: string): string => {
      return `${scheme} ***REDACTED***`;
    })
    .replace(JWT_PATTERN, "***REDACTED-JWT***");
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
      items.push(
        `… ${value.length - MAX_REDACT_ARRAY_ITEMS} more items truncated`,
      );
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
      out["_truncated"] =
        `… ${allKeys.length - MAX_REDACT_OBJECT_KEYS} more keys truncated`;
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
  progress: number | Record<string, unknown> | null;
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
  const failedJobs: Awaited<ReturnType<typeof Queue.getFailedJobsWithDetails>> =
    await Queue.getFailedJobsWithDetails(queueName, {
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
 * Postgres cluster health for the dashboard: streaming-replication lag, slot
 * health, connection saturation, lock/blocking pressure, cache-hit ratio and
 * transaction-ID wraparound headroom — the signals behind a failed
 * CloudNativePG failover, a stalled primary, a runaway connection pool or a
 * lock convoy. The app always connects to the read-write (primary) service, so
 * pg_stat_replication here lists the standbys from the primary's point of view.
 * Each probe is independently guarded so the default single-instance
 * StatefulSet (no replication) and a clustered CloudNativePG deployment both
 * render gracefully, and so a missing pg_monitor grant on one view never drops
 * the whole payload. We read only counts, durations, settings and topology —
 * never query text or row data — so this stays safe to share.
 */
async function getPostgresClusterHealth(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    clusterName: null,
    serverVersion: null,
    isInRecovery: false,
    role: null,
    uptimeSeconds: null,
    replication: [],
    replicationSlots: [],
    connections: null,
    database: null,
    wraparound: null,
    topTablesByDeadTuples: [],
    databaseSizeInBytes: null,
  };

  try {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return result;
    }

    result["connected"] = true;

    // 1. Node identity & role — is this the primary or a standby, and for how long.
    try {
      const identityRows: Array<{
        cluster_name: string | null;
        server_version: string | null;
        in_recovery: boolean;
        uptime_seconds: string | null;
      }> = await dataSource.query(
        `SELECT
           current_setting('cluster_name', true) AS cluster_name,
           current_setting('server_version') AS server_version,
           pg_is_in_recovery() AS in_recovery,
           ROUND(EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))) AS uptime_seconds`,
      );

      const identity: (typeof identityRows)[number] | undefined =
        identityRows?.[0];

      if (identity) {
        result["clusterName"] = identity.cluster_name || null;
        result["serverVersion"] = identity.server_version || null;
        result["isInRecovery"] = Boolean(identity.in_recovery);
        result["role"] = identity.in_recovery ? "standby" : "primary";
        result["uptimeSeconds"] = toNumberOrNull(identity.uptime_seconds);
      }
    } catch (err) {
      logger.debug("AdminHealth: postgres identity probe failed");
      logger.debug(err);
    }

    // 2. Streaming replication — the primary's view of every connected standby.
    try {
      const replicationRows: Array<{
        application_name: string | null;
        client_addr: string | null;
        state: string | null;
        sync_state: string | null;
        write_lag_seconds: string | null;
        flush_lag_seconds: string | null;
        replay_lag_seconds: string | null;
        bytes_behind: string | null;
      }> = await dataSource.query(
        `SELECT
           application_name,
           host(client_addr) AS client_addr,
           state,
           sync_state,
           COALESCE(EXTRACT(EPOCH FROM write_lag), 0) AS write_lag_seconds,
           COALESCE(EXTRACT(EPOCH FROM flush_lag), 0) AS flush_lag_seconds,
           COALESCE(EXTRACT(EPOCH FROM replay_lag), 0) AS replay_lag_seconds,
           CASE WHEN pg_is_in_recovery() THEN NULL
                ELSE pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) END AS bytes_behind
         FROM pg_stat_replication
         ORDER BY application_name ASC`,
      );

      result["replication"] = replicationRows.map(
        (row: (typeof replicationRows)[number]): JSONObject => {
          return {
            applicationName: row.application_name
              ? String(row.application_name)
              : null,
            clientAddr: row.client_addr ? String(row.client_addr) : null,
            state: row.state ? String(row.state) : null,
            syncState: row.sync_state ? String(row.sync_state) : null,
            writeLagSeconds: toNumberOrNull(row.write_lag_seconds),
            flushLagSeconds: toNumberOrNull(row.flush_lag_seconds),
            replayLagSeconds: toNumberOrNull(row.replay_lag_seconds),
            bytesBehind: toNumberOrNull(row.bytes_behind),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: pg_stat_replication unavailable");
      logger.debug(err);
    }

    // 3. Replication slots — inactive or 'lost' slots silently retain or drop WAL.
    try {
      const slotRows: Array<{
        slot_name: string | null;
        slot_type: string | null;
        active: boolean;
        wal_status: string | null;
        retained_bytes: string | null;
        safe_wal_size: string | null;
      }> = await dataSource.query(
        `SELECT
           slot_name,
           slot_type,
           active,
           COALESCE(wal_status, 'unknown') AS wal_status,
           CASE WHEN pg_is_in_recovery() THEN NULL
                ELSE pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) END AS retained_bytes,
           safe_wal_size
         FROM pg_replication_slots
         ORDER BY slot_name ASC`,
      );

      result["replicationSlots"] = slotRows.map(
        (row: (typeof slotRows)[number]): JSONObject => {
          return {
            slotName: row.slot_name ? String(row.slot_name) : null,
            slotType: row.slot_type ? String(row.slot_type) : null,
            active: Boolean(row.active),
            walStatus: row.wal_status ? String(row.wal_status) : null,
            retainedBytes: toNumberOrNull(row.retained_bytes),
            safeWalSizeBytes: toNumberOrNull(row.safe_wal_size),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: pg_replication_slots unavailable");
      logger.debug(err);
    }

    // 4. Connection saturation + lock/blocking pressure (aggregate, no query text).
    try {
      const connectionRows: Array<{
        max_connections: string;
        total: string;
        active: string;
        idle: string;
        idle_in_transaction: string;
        waiting_on_lock: string;
        blocked: string;
        longest_transaction_seconds: string;
        longest_active_query_seconds: string;
        longest_idle_in_transaction_seconds: string;
      }> = await dataSource.query(
        `SELECT
           (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
           count(*) FILTER (WHERE backend_type = 'client backend') AS total,
           count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active') AS active,
           count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'idle') AS idle,
           count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'idle in transaction') AS idle_in_transaction,
           count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_on_lock,
           count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0) AS blocked,
           COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - xact_start))), 0) AS longest_transaction_seconds,
           COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - query_start)) FILTER (WHERE state = 'active')), 0) AS longest_active_query_seconds,
           COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - state_change)) FILTER (WHERE state = 'idle in transaction')), 0) AS longest_idle_in_transaction_seconds
         FROM pg_stat_activity`,
      );

      const conn: (typeof connectionRows)[number] | undefined =
        connectionRows?.[0];

      if (conn) {
        result["connections"] = {
          maxConnections: toNumberOrNull(conn.max_connections),
          total: toNumberOrNull(conn.total),
          active: toNumberOrNull(conn.active),
          idle: toNumberOrNull(conn.idle),
          idleInTransaction: toNumberOrNull(conn.idle_in_transaction),
          waitingOnLock: toNumberOrNull(conn.waiting_on_lock),
          blocked: toNumberOrNull(conn.blocked),
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
    } catch (err) {
      logger.debug("AdminHealth: postgres connection probe failed");
      logger.debug(err);
    }

    // 5. Database throughput + cache-hit ratio (per-node counters, since last reset).
    try {
      const databaseRows: Array<{
        numbackends: string;
        xact_commit: string;
        xact_rollback: string;
        cache_hit_ratio: string | null;
        deadlocks: string;
        conflicts: string;
        temp_files: string;
        temp_bytes: string;
        stats_reset: string | Date | null;
      }> = await dataSource.query(
        `SELECT
           numbackends,
           xact_commit,
           xact_rollback,
           CASE WHEN (blks_hit + blks_read) > 0
                THEN ROUND(blks_hit::numeric / (blks_hit + blks_read) * 100, 2)
                ELSE NULL END AS cache_hit_ratio,
           deadlocks,
           conflicts,
           temp_files,
           temp_bytes,
           stats_reset
         FROM pg_stat_database
         WHERE datname = current_database()`,
      );

      const db: (typeof databaseRows)[number] | undefined = databaseRows?.[0];

      if (db) {
        result["database"] = {
          numBackends: toNumberOrNull(db.numbackends),
          xactCommit: toNumberOrNull(db.xact_commit),
          xactRollback: toNumberOrNull(db.xact_rollback),
          cacheHitRatio: toNumberOrNull(db.cache_hit_ratio),
          deadlocks: toNumberOrNull(db.deadlocks),
          conflicts: toNumberOrNull(db.conflicts),
          tempFiles: toNumberOrNull(db.temp_files),
          tempBytes: toNumberOrNull(db.temp_bytes),
          statsReset: toIsoOrNull(db.stats_reset),
        };
      }
    } catch (err) {
      logger.debug("AdminHealth: pg_stat_database probe failed");
      logger.debug(err);
    }

    // 6. Transaction-ID wraparound headroom — the one silent failure that halts writes.
    try {
      const wraparoundRows: Array<{
        max_xid_age: string | null;
        freeze_max_age: string | null;
      }> = await dataSource.query(
        `SELECT
           max(age(datfrozenxid)) AS max_xid_age,
           (SELECT setting::bigint FROM pg_settings WHERE name = 'autovacuum_freeze_max_age') AS freeze_max_age
         FROM pg_database`,
      );

      const wrap: (typeof wraparoundRows)[number] | undefined =
        wraparoundRows?.[0];

      if (wrap) {
        result["wraparound"] = {
          maxXidAge: toNumberOrNull(wrap.max_xid_age),
          autovacuumFreezeMaxAge: toNumberOrNull(wrap.freeze_max_age),
        };
      }
    } catch (err) {
      logger.debug("AdminHealth: wraparound probe failed");
      logger.debug(err);
    }

    // 7. Dead-tuple / autovacuum hotspots — bloat and stalled autovacuum.
    try {
      const tableRows: Array<{
        schemaname: string;
        relname: string;
        dead_tuples: string;
        live_tuples: string;
        last_autovacuum: string | Date | null;
        last_autoanalyze: string | Date | null;
        total_bytes: string;
      }> = await dataSource.query(
        `SELECT
           schemaname,
           relname,
           n_dead_tup AS dead_tuples,
           n_live_tup AS live_tuples,
           last_autovacuum,
           last_autoanalyze,
           pg_total_relation_size(relid) AS total_bytes
         FROM pg_stat_user_tables
         ORDER BY n_dead_tup DESC
         LIMIT 8`,
      );

      result["topTablesByDeadTuples"] = tableRows.map(
        (row: (typeof tableRows)[number]): JSONObject => {
          return {
            name: `${row.schemaname}.${row.relname}`,
            deadTuples: toNumberOrNull(row.dead_tuples),
            liveTuples: toNumberOrNull(row.live_tuples),
            lastAutovacuum: toIsoOrNull(row.last_autovacuum),
            lastAutoanalyze: toIsoOrNull(row.last_autoanalyze),
            totalSizeInBytes: toNumberOrNull(row.total_bytes),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: pg_stat_user_tables probe failed");
      logger.debug(err);
    }

    // 8. Total database size.
    try {
      const sizeRows: Array<{ size: string }> = await dataSource.query(
        "SELECT pg_database_size(current_database()) AS size",
      );
      result["databaseSizeInBytes"] = toNumberOrNull(sizeRows?.[0]?.size);
    } catch (err) {
      logger.debug("AdminHealth: pg_database_size probe failed");
      logger.debug(err);
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read Postgres cluster health");
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
    clusterHealth: {
      clusterName: null,
      clusters: [],
      distributedDdlQueue: { unfinished: null, byStatus: [], items: [] },
      distributedInsertQueue: { tables: [], items: [] },
      unhealthyReplicas: [],
      replicationQueue: [],
      keeperConnection: [],
    },
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
              ? scrubSecretsFromText(
                  String(row["latest_fail_reason"]),
                ).substring(0, 500)
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

    /*
     * Cluster health — the distributed-DDL / replication / Keeper state needed
     * to diagnose a wedged ON CLUSTER schema sync (the class of incident where
     * the migrate Job or boot schema-sync times out because a DDL task never
     * finishes on some shards). Each probe is independently guarded so a
     * single-node deployment, or an older ClickHouse missing one of these system
     * tables, degrades gracefully instead of dropping the whole payload. None of
     * these emit row data — only schema/topology and engine-level error text
     * (scrubbed + truncated).
     */
    const clusterName: string = getClickhouseClusterName();
    const clusterNameLiteral: string = clusterName.replace(/'/g, "''");
    const clusterHealth: JSONObject = {
      clusterName: clusterName,
      clusters: [],
      distributedDdlQueue: { unfinished: null, byStatus: [], items: [] },
      distributedInsertQueue: { tables: [], items: [] },
      unhealthyReplicas: [],
      replicationQueue: [],
      keeperConnection: [],
    };

    // 1. Cluster topology + per-host error counters (is every shard reachable?).
    try {
      const clustersResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            `SELECT shard_num, replica_num, host_name, errors_count, slowdowns_count, estimated_recovery_time FROM system.clusters WHERE cluster = '${clusterNameLiteral}' ORDER BY shard_num ASC, replica_num ASC` +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;
      clusterHealth["clusters"] = (clustersResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            shardNum: toNumberOrNull(row["shard_num"]),
            replicaNum: toNumberOrNull(row["replica_num"]),
            hostName: String(row["host_name"]),
            errorsCount: toNumberOrNull(row["errors_count"]),
            slowdownsCount: toNumberOrNull(row["slowdowns_count"]),
            estimatedRecoveryTime: toNumberOrNull(
              row["estimated_recovery_time"],
            ),
          };
        },
      );
    } catch {
      logger.debug("AdminHealth: system.clusters unavailable");
    }

    // 2. Distributed DDL queue — unfinished tasks are the signature of a wedge.
    try {
      const ddlByStatusResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT host, status, count() AS n FROM system.distributed_ddl_queue WHERE status != 'Finished' GROUP BY host, status ORDER BY host ASC" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      const ddlItemsResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT entry, host, status, exception_code, exception_text, query_duration_ms FROM system.distributed_ddl_queue WHERE status != 'Finished' ORDER BY entry ASC LIMIT 50" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      const ddlByStatus: JSONArray = (ddlByStatusResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            host: String(row["host"]),
            status: String(row["status"]),
            count: toNumberOrNull(row["n"]),
          };
        },
      );

      let ddlUnfinished: number = 0;
      for (const row of ddlByStatus) {
        ddlUnfinished += toNumberOrNull((row as JSONObject)["count"]) || 0;
      }

      clusterHealth["distributedDdlQueue"] = {
        unfinished: ddlUnfinished,
        byStatus: ddlByStatus,
        items: (ddlItemsResult.data || []).map(
          (row: JSONObject): JSONObject => {
            return {
              entry: String(row["entry"]),
              host: String(row["host"]),
              status: String(row["status"]),
              exceptionCode: toNumberOrNull(row["exception_code"]),
              exceptionText: row["exception_text"]
                ? scrubSecretsFromText(String(row["exception_text"])).substring(
                    0,
                    500,
                  )
                : null,
              queryDurationMs: toNumberOrNull(row["query_duration_ms"]),
            };
          },
        ),
      };
    } catch {
      logger.debug("AdminHealth: system.distributed_ddl_queue unavailable");
    }

    // 3. Distributed INSERT queue — rows accepted by Distributed tables but not yet delivered to shard-local tables.
    try {
      const insertQueueSummaryResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT database, table, count() AS queue_rows, sum(data_files) AS pending_files, sum(data_compressed_bytes) AS pending_bytes, max(error_count) AS max_error_count, toString(max(last_exception_time)) AS last_exception_time FROM system.distribution_queue GROUP BY database, table ORDER BY pending_files DESC, pending_bytes DESC LIMIT 50" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      const insertQueueItemsResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT database, table, data_path, is_blocked, error_count, substring(last_exception, 1, 1000) AS last_exception, toString(last_exception_time) AS last_exception_time, data_files, data_compressed_bytes FROM system.distribution_queue ORDER BY data_files DESC, data_compressed_bytes DESC LIMIT 50" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      clusterHealth["distributedInsertQueue"] = {
        tables: (insertQueueSummaryResult.data || []).map(
          (row: JSONObject): JSONObject => {
            return {
              database: String(row["database"]),
              table: String(row["table"]),
              queueRows: toNumberOrNull(row["queue_rows"]),
              pendingFiles: toNumberOrNull(row["pending_files"]),
              pendingBytes: toNumberOrNull(row["pending_bytes"]),
              maxErrorCount: toNumberOrNull(row["max_error_count"]),
              lastExceptionTime: toIsoOrNull(row["last_exception_time"]),
            };
          },
        ),
        items: (insertQueueItemsResult.data || []).map(
          (row: JSONObject): JSONObject => {
            return {
              database: String(row["database"]),
              table: String(row["table"]),
              dataPath: String(row["data_path"]),
              isBlocked: toNumberOrNull(row["is_blocked"]),
              errorCount: toNumberOrNull(row["error_count"]),
              lastException: row["last_exception"]
                ? scrubSecretsFromText(String(row["last_exception"])).substring(
                    0,
                    500,
                  )
                : null,
              lastExceptionTime: toIsoOrNull(row["last_exception_time"]),
              dataFiles: toNumberOrNull(row["data_files"]),
              dataCompressedBytes: toNumberOrNull(row["data_compressed_bytes"]),
            };
          },
        ),
      };
    } catch {
      logger.debug("AdminHealth: system.distribution_queue unavailable");
    }

    // 4. Replicas that are read-only / session-expired / lagging / missing peers.
    try {
      const replicasResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT database, table, is_readonly, is_session_expired, absolute_delay, queue_size, total_replicas, active_replicas FROM system.replicas WHERE is_readonly OR is_session_expired OR active_replicas < total_replicas OR absolute_delay > 60 ORDER BY absolute_delay DESC LIMIT 50" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;
      clusterHealth["unhealthyReplicas"] = (replicasResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            database: String(row["database"]),
            table: String(row["table"]),
            isReadonly: toNumberOrNull(row["is_readonly"]),
            isSessionExpired: toNumberOrNull(row["is_session_expired"]),
            absoluteDelay: toNumberOrNull(row["absolute_delay"]),
            queueSize: toNumberOrNull(row["queue_size"]),
            totalReplicas: toNumberOrNull(row["total_replicas"]),
            activeReplicas: toNumberOrNull(row["active_replicas"]),
          };
        },
      );
    } catch {
      logger.debug("AdminHealth: system.replicas unavailable");
    }

    // 5. Replication queue backlog per table (stuck fetches / merges).
    try {
      const replQueueResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT database, table, count() AS n, max(num_tries) AS max_tries, max(num_postponed) AS max_postponed FROM system.replication_queue GROUP BY database, table ORDER BY n DESC LIMIT 20" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;
      clusterHealth["replicationQueue"] = (replQueueResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            database: String(row["database"]),
            table: String(row["table"]),
            count: toNumberOrNull(row["n"]),
            maxTries: toNumberOrNull(row["max_tries"]),
            maxPostponed: toNumberOrNull(row["max_postponed"]),
          };
        },
      );
    } catch {
      logger.debug("AdminHealth: system.replication_queue unavailable");
    }

    // 6. Keeper/ZooKeeper connection state (is this node talking to Keeper?).
    try {
      const keeperResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT name, host, is_expired, session_uptime_elapsed_seconds, keeper_api_version FROM system.zookeeper_connection" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;
      clusterHealth["keeperConnection"] = (keeperResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            name: String(row["name"]),
            host: String(row["host"]),
            isExpired: toNumberOrNull(row["is_expired"]),
            sessionUptimeSeconds: toNumberOrNull(
              row["session_uptime_elapsed_seconds"],
            ),
            keeperApiVersion: toNumberOrNull(row["keeper_api_version"]),
          };
        },
      );
    } catch {
      logger.debug("AdminHealth: system.zookeeper_connection unavailable");
    }

    result["clusterHealth"] = clusterHealth;
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse diagnostics");
    logger.error(err);
  }

  return result;
}

/*
 * The three telemetry signals OneUptime ingests into ClickHouse and the
 * event-time column each table is partitioned + primary-key ordered on. We count
 * ingestion on THIS column (never `createdAt`) precisely because it is the
 * partition key (toYYYYMMDD) and the leading primary-key column: ClickHouse can
 * prune to the last day's partitions and use the primary index, so the count
 * stays cheap even on multi-billion-row tables. `createdAt` — the true write
 * time — is unindexed and unpartitioned here, so filtering on it would force a
 * full-table scan; for a live pipeline event-time and write-time agree to within
 * seconds, and the only divergence (historical backfill) is not what a
 * "current ingestion rate" view is meant to show.
 */
const TELEMETRY_INGESTION_TABLES: Array<{
  telemetryType: string;
  table: AnalyticsTableName;
  timeColumn: string;
}> = [
  { telemetryType: "Logs", table: AnalyticsTableName.Log, timeColumn: "time" },
  {
    telemetryType: "Metrics",
    table: AnalyticsTableName.Metric,
    timeColumn: "time",
  },
  {
    telemetryType: "Traces",
    table: AnalyticsTableName.Span,
    timeColumn: "startTime",
  },
];

/*
 * Telemetry ingestion rate for the dashboard. For each telemetry table it counts
 * the rows whose event time falls in the last minute, the last hour and the last
 * day — so an operator can see how fast telemetry is flowing into ClickHouse and
 * spot a stall or a flood at a glance. Every window is bounded by the same
 * `WHERE eventTime >= now() - INTERVAL 1 DAY AND eventTime <= now()` so the scan
 * only ever touches the last day's partitions; the smaller windows are picked
 * out with countIf. The upper `<= now()` bound stops a future-dated event from
 * inflating the counts. Each table is probed independently so a missing table
 * (e.g. an instance that only ingests logs) degrades gracefully. Alongside the
 * counts it reports each table's total ACTUAL (uncompressed) data volume read
 * from system.parts metadata — the real data size, not the compressed
 * bytes_on_disk. No row data is read — only counts and size metadata. Enterprise
 * Edition + master-admin gated at the route.
 */
async function getClickhouseTelemetryIngestion(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    tables: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    result["connected"] = true;

    /*
     * Total ACTUAL (uncompressed) data volume per telemetry table, read from
     * system.parts metadata — this is the real data size, not the compressed
     * bytes_on_disk. It is a metadata aggregate (no data scan), so it stays cheap
     * regardless of table size. Guarded independently so a failure here never
     * drops the ingestion counts below.
     */
    const uncompressedBytesByTable: Map<string, number | null> = new Map();
    try {
      const databaseLiteral: string = ClickhouseDatabaseName.replace(
        /'/g,
        "''",
      );
      const tableListLiteral: string = TELEMETRY_INGESTION_TABLES.map(
        (spec: { table: AnalyticsTableName }): string => {
          return `'${String(spec.table).replace(/'/g, "''")}'`;
        },
      ).join(", ");

      const sizesResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            "SELECT table, sum(data_uncompressed_bytes) AS uncompressed_bytes " +
            "FROM system.parts " +
            `WHERE active AND database = '${databaseLiteral}' AND table IN (${tableListLiteral}) ` +
            "GROUP BY table" +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      for (const row of sizesResult.data || []) {
        uncompressedBytesByTable.set(
          String(row["table"]),
          toNumberOrNull(row["uncompressed_bytes"]),
        );
      }
    } catch (err) {
      logger.debug("AdminHealth: telemetry uncompressed-size query failed");
      logger.debug(err);
    }

    const tables: JSONArray = [];

    for (const spec of TELEMETRY_INGESTION_TABLES) {
      const entry: JSONObject = {
        telemetryType: spec.telemetryType,
        table: spec.table,
        lastMinute: null,
        lastHour: null,
        lastDay: null,
        uncompressedBytes: uncompressedBytesByTable.get(spec.table) ?? null,
        available: false,
      };

      try {
        const ingestionResult: ClickhouseJsonResult = (await (
          await client.query({
            query:
              "SELECT " +
              `countIf(${spec.timeColumn} >= now() - INTERVAL 1 MINUTE) AS last_minute, ` +
              `countIf(${spec.timeColumn} >= now() - INTERVAL 1 HOUR) AS last_hour, ` +
              "count() AS last_day " +
              `FROM \`${ClickhouseDatabaseName}\`.\`${spec.table}\` ` +
              `WHERE ${spec.timeColumn} >= now() - INTERVAL 1 DAY AND ${spec.timeColumn} <= now()` +
              CH_DIAG_QUERY_SETTINGS,
            format: "JSON",
          })
        ).json()) as ClickhouseJsonResult;

        const row: JSONObject = ingestionResult.data?.[0] || {};
        entry["lastMinute"] = toNumberOrNull(row["last_minute"]);
        entry["lastHour"] = toNumberOrNull(row["last_hour"]);
        entry["lastDay"] = toNumberOrNull(row["last_day"]);
        entry["available"] = true;
      } catch (err) {
        logger.debug(
          `AdminHealth: telemetry ingestion query failed for ${spec.table}`,
        );
        logger.debug(err);
      }

      tables.push(entry);
    }

    result["tables"] = tables;
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse telemetry ingestion");
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
            trace: scrubSecretsFromText(String(row["trace"] || "")).substring(
              0,
              4000,
            ),
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
    .map(
      (entry: { time: string; level: string; message: string }): JSONObject => {
        return {
          time: entry.time,
          level: entry.level,
          message: scrubSecretsFromText(entry.message),
        };
      },
    );

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
 * ClickHouse cluster health for the dashboard: shard reachability, the
 * distributed-DDL queue, replica / replication-queue state and the Keeper
 * connection — the signals that reveal a wedged ON CLUSTER schema sync (where
 * the migrate Job or boot schema-sync times
 * out because a DDL task never finishes on some shards). Enterprise Edition +
 * master-admin only, like the overview and logs beside it. Reuses the support
 * bundle's diagnostics so the dashboard and the downloaded bundle never disagree.
 */
router.get(
  "/clickhouse-cluster",
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

      const diagnostics: JSONObject = await getClickhouseDiagnostics();
      const clusterHealth: JSONObject = (diagnostics["clusterHealth"] ||
        {}) as JSONObject;

      return Response.sendJsonObjectResponse(req, res, {
        connected: Boolean(diagnostics["connected"]),
        ...clusterHealth,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Telemetry ingestion rate for the dashboard: how many log / metric / trace rows
 * landed in ClickHouse over the last minute, hour and day, so an operator can
 * see the live ingestion throughput and spot a stalled or flooding pipeline.
 * Enterprise Edition + master-admin only, like the ClickHouse cluster endpoint
 * beside it. Counts only — no telemetry row data leaves the process.
 */
router.get(
  "/clickhouse-telemetry-ingestion",
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

      const data: JSONObject = await getClickhouseTelemetryIngestion();
      return Response.sendJsonObjectResponse(req, res, data);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Postgres cluster health for the dashboard: streaming-replication lag, slot
 * health, connection saturation, lock/blocking pressure, cache-hit ratio and
 * transaction-ID wraparound headroom — the signals behind a failed
 * CloudNativePG failover or a stalled primary. Enterprise Edition + master-admin
 * only, like the ClickHouse cluster endpoint beside it. Reuses the same probe
 * used by the support bundle so the dashboard and the downloaded bundle agree.
 */
router.get(
  "/postgres-cluster",
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

      const data: JSONObject = await getPostgresClusterHealth();
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
        postgresClusterHealth,
        clickhouseDiagnostics,
        clickhouseTelemetryIngestion,
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
        getPostgresClusterHealth(),
        getClickhouseDiagnostics(),
        getClickhouseTelemetryIngestion(),
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
 * Query console
 *
 * Master-admin, Enterprise-Edition-only ad-hoc query execution against the
 * three datastores backing this instance (Postgres, ClickHouse, Redis). This is
 * a power tool for operators who already hold the datastore credentials, so it
 * deliberately allows arbitrary statements — but defends the instance with:
 *   - read-only by default (an explicit opt-in is required to run writes / DDL),
 *   - hard row caps + per-cell size caps on the data returned,
 *   - server-side statement / execution timeouts, and
 *   - an always-blocked denylist for catastrophic Redis admin commands.
 * Unlike the support bundle, results are returned VERBATIM (not
 * credential-scrubbed): the operator is intentionally inspecting their own data,
 * and scrubbing would defeat the purpose of a query console.
 * ---------------------------------------------------------------------------
 */

// Hard ceiling on rows returned to the console, regardless of the requested limit.
const QUERY_MAX_ROWS: number = 1000;
const QUERY_DEFAULT_ROWS: number = 100;
// Per-cell string cap so a single huge value can't bloat the response.
const QUERY_MAX_CELL_LENGTH: number = 10000;
// Wall-clock caps for the executed statement.
const QUERY_PG_TIMEOUT_MS: number = 30000;
const QUERY_CH_TIMEOUT_SECONDS: number = 30;
const QUERY_REDIS_TIMEOUT_MS: number = 15000;
const QUERY_REDIS_MAX_COMMANDS: number = 50;

type QueryEngine = "postgres" | "clickhouse" | "redis";

function assertEnterpriseQueryConsole(): void {
  if (!IsEnterpriseEdition) {
    throw new PaymentRequiredException(
      "The instance health query console is only available on the OneUptime Enterprise Edition. " +
        "Please switch to the Enterprise Edition build to enable this feature. " +
        "See https://oneuptime.com/enterprise/overview for details.",
    );
  }
}

// Clamp a requested row limit into [1, QUERY_MAX_ROWS]; default QUERY_DEFAULT_ROWS.
function resolveRowLimit(value: unknown): number {
  const parsed: number = Number(value);

  if (!isFinite(parsed) || parsed <= 0) {
    return QUERY_DEFAULT_ROWS;
  }

  return Math.min(Math.floor(parsed), QUERY_MAX_ROWS);
}

// A short, safe-to-show error message for a failed query (capped, never thrown).
function getQueryErrorMessage(err: unknown): string {
  let message: string = "Query failed.";

  if (err instanceof Error && err.message) {
    message = err.message;
  } else if (typeof err === "string" && err) {
    message = err;
  }

  return message.length > 4000 ? `${message.substring(0, 4000)}…` : message;
}

// Convert one DB cell into a JSON-safe, size-capped value for the response.
function toQueryCell(value: unknown): JSONValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    const hex: string = value.toString("hex");
    return hex.length > QUERY_MAX_CELL_LENGTH
      ? `0x${hex.substring(0, QUERY_MAX_CELL_LENGTH)}… (truncated)`
      : `0x${hex}`;
  }

  if (typeof value === "string") {
    return value.length > QUERY_MAX_CELL_LENGTH
      ? `${value.substring(0, QUERY_MAX_CELL_LENGTH)}… (truncated)`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  // Objects / arrays (jsonb, Postgres arrays, nested ClickHouse types) — serialize once, capped.
  try {
    const serialized: string = JSON.stringify(value);

    if (serialized.length > QUERY_MAX_CELL_LENGTH) {
      return `${serialized.substring(0, QUERY_MAX_CELL_LENGTH)}… (truncated)`;
    }

    return JSON.parse(serialized) as JSONValue;
  } catch {
    return String(value);
  }
}

// Collect column names across a set of row objects, preserving first-seen order.
function deriveColumns(rows: Array<Record<string, unknown>>): Array<string> {
  const columns: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
  }

  return columns;
}

// Project an array of row objects onto an ordered column list, with JSON-safe cells.
function rowsToCells(
  rows: Array<Record<string, unknown>>,
  columns: Array<string>,
): JSONArray {
  return rows.map((row: Record<string, unknown>): JSONObject => {
    const out: JSONObject = {};

    for (const column of columns) {
      out[column] = toQueryCell(row ? row[column] : null);
    }

    return out;
  });
}

// Race a promise against a timeout so a hung datastore call can't pin the request.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        reject(new Error(label));
      }, ms);

      promise
        .then((value: T): void => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err: Error): void => {
          clearTimeout(timer);
          reject(err);
        });
    },
  );
}

/*
 * Strip leading line (--) and block comments + whitespace so statement
 * classification sees the real first keyword.
 */
function stripLeadingSqlComments(sql: string): string {
  let trimmed: string = sql.trim();
  let previousLength: number = -1;

  while (trimmed.length !== previousLength) {
    previousLength = trimmed.length;
    trimmed = trimmed
      .replace(/^--[^\n]*\n?/, "")
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .trim();
  }

  return trimmed;
}

function firstSqlKeyword(sql: string): string {
  return (
    stripLeadingSqlComments(sql)
      .replace(/^\(+/, "")
      .split(/[\s(;]/)[0]
      ?.toUpperCase() || ""
  );
}

const POSTGRES_READ_KEYWORDS: Set<string> = new Set([
  "SELECT",
  "WITH",
  "TABLE",
  "VALUES",
  "SHOW",
  "EXPLAIN",
]);

// Statements whose row stream we can safely page through a server-side cursor.
const POSTGRES_CURSORABLE_KEYWORDS: Set<string> = new Set([
  "SELECT",
  "WITH",
  "TABLE",
  "VALUES",
]);

/*
 * Host-level escape hatches a query console must never expose, even in write
 * mode: COPY ... TO/FROM PROGRAM (arbitrary command execution on the DB host),
 * COPY to/from a server file, large-object / server-file IO, and dblink. This is
 * a best-effort textual blocklist — the real defence is connecting the console
 * with a least-privilege Postgres role — but it stops the obvious one-liners.
 */
const POSTGRES_BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcopy\b[\s\S]*?\bprogram\b/i, label: "COPY ... PROGRAM" },
  {
    pattern: /\bcopy\b[\s\S]*?\b(?:to|from)\b\s*'/i,
    label: "COPY to/from a server file",
  },
  { pattern: /\blo_export\s*\(/i, label: "lo_export" },
  { pattern: /\blo_import\s*\(/i, label: "lo_import" },
  { pattern: /\bpg_read_file\s*\(/i, label: "pg_read_file" },
  { pattern: /\bpg_read_binary_file\s*\(/i, label: "pg_read_binary_file" },
  { pattern: /\bpg_ls_dir\s*\(/i, label: "pg_ls_dir" },
  { pattern: /\bpg_stat_file\s*\(/i, label: "pg_stat_file" },
  { pattern: /\bdblink\w*\s*\(/i, label: "dblink" },
];

function assertPostgresStatementAllowed(sql: string): void {
  for (const blocked of POSTGRES_BLOCKED_PATTERNS) {
    if (blocked.pattern.test(sql)) {
      throw new BadDataException(
        `${blocked.label} is blocked in the query console because it can act on the database host. Use psql directly if you genuinely need it.`,
      );
    }
  }
}

/*
 * Run an arbitrary SQL statement against Postgres. Read-only mode wraps it in a
 * `READ ONLY` transaction (rolled back afterwards) so it cannot mutate the
 * database; write mode commits. For plain read queries in read-only mode we page
 * the result through a server-side cursor (`DECLARE ... FETCH FORWARD n`) so a
 * huge SELECT can never buffer an unbounded result set into the app process. A
 * `SET LOCAL statement_timeout` bounds the wall-clock. Note: read-only prevents
 * DATABASE mutation but is not a full sandbox against a privileged connecting
 * role — assertPostgresStatementAllowed() blocks the obvious host-level escapes.
 * Column metadata is derived from the returned rows; duplicate column names
 * collapse to the last value.
 */
async function runPostgresQuery(
  sql: string,
  readOnly: boolean,
  rowLimit: number,
): Promise<JSONObject> {
  assertPostgresStatementAllowed(sql);

  const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
    PostgresAppInstance.getDataSource();

  if (!dataSource) {
    throw new BadDataException("Postgres is not connected on this instance.");
  }

  const firstKeyword: string = firstSqlKeyword(sql);
  const isRead: boolean = POSTGRES_READ_KEYWORDS.has(firstKeyword);
  /*
   * Cursor paging is only safe for pure read queries (a data-modifying CTE
   * cannot back a cursor), so we restrict it to read-only mode.
   */
  const useCursor: boolean =
    readOnly && POSTGRES_CURSORABLE_KEYWORDS.has(firstKeyword);

  const startedAt: number = Date.now();
  const queryRunner: ReturnType<typeof dataSource.createQueryRunner> =
    dataSource.createQueryRunner();

  try {
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // READ ONLY must precede any data-accessing statement in the transaction.
      if (readOnly) {
        await queryRunner.query("SET TRANSACTION READ ONLY");
      }

      await queryRunner.query(
        `SET LOCAL statement_timeout = ${QUERY_PG_TIMEOUT_MS}`,
      );

      let records: Array<Record<string, unknown>> = [];
      let affected: number | null = null;

      if (useCursor) {
        // Strip a trailing ';' so it sits cleanly inside the DECLARE.
        const inner: string = sql.trim().replace(/;\s*$/, "");
        await queryRunner.query(
          `DECLARE oneuptime_console_cursor NO SCROLL CURSOR FOR ${inner}`,
        );
        const fetched: { records?: Array<Record<string, unknown>> } =
          await queryRunner.query(
            `FETCH FORWARD ${rowLimit + 1} FROM oneuptime_console_cursor`,
            undefined,
            true,
          );
        records = Array.isArray(fetched?.records) ? fetched.records : [];
        await queryRunner.query("CLOSE oneuptime_console_cursor");
      } else {
        const result: {
          records?: Array<Record<string, unknown>>;
          affected?: number;
        } = await queryRunner.query(sql, undefined, true);
        records = Array.isArray(result?.records) ? result.records : [];
        affected =
          typeof result?.affected === "number" ? result.affected : null;
      }

      // Read-only changes nothing, so roll back; writes commit.
      if (readOnly) {
        await queryRunner.rollbackTransaction();
      } else {
        await queryRunner.commitTransaction();
      }

      const limited: Array<Record<string, unknown>> = records.slice(
        0,
        rowLimit,
      );
      const columns: Array<string> = deriveColumns(limited);
      const rows: JSONArray = rowsToCells(limited, columns);
      const truncated: boolean = records.length > rowLimit;

      let message: string | null = null;
      if (!isRead && rows.length === 0) {
        message =
          affected !== null
            ? `Statement executed. ${affected} row(s) affected.`
            : "Statement(s) executed successfully.";
      }

      return {
        engine: "postgres",
        columns,
        rows,
        rowsReturned: rows.length,
        /*
         * With cursor paging we only fetched up to rowLimit+1, so rely on
         * `truncated` rather than reporting a real (unknown) total.
         */
        totalRows: useCursor ? rows.length : records.length,
        affectedRows: isRead ? null : affected,
        truncated,
        readOnly,
        executionTimeMs: Date.now() - startedAt,
        message,
      };
    } catch (innerErr) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw innerErr;
    }
  } finally {
    await queryRunner.release();
  }
}

/*
 * The leading keywords that identify a ClickHouse read statement. Anything else
 * is treated as a write / DDL and is only allowed when read-only mode is off.
 */
const CLICKHOUSE_READ_KEYWORDS: Set<string> = new Set([
  "SELECT",
  "WITH",
  "SHOW",
  "DESC",
  "DESCRIBE",
  "EXPLAIN",
  "EXISTS",
]);

function clickhouseStatementIsRead(sql: string): boolean {
  return CLICKHOUSE_READ_KEYWORDS.has(firstSqlKeyword(sql));
}

/*
 * Run an arbitrary statement against ClickHouse. Reads go through query() in
 * JSON format (which gives us typed column metadata); writes / DDL go through
 * command(). Read-only mode additionally pins `readonly = 2` (read queries only,
 * but still allows the row/time-limit settings below to be applied) and rejects
 * anything that isn't a recognised read statement. max_execution_time and
 * max_result_rows bound the work and the result set server-side.
 */
async function runClickhouseQuery(
  sql: string,
  readOnly: boolean,
  rowLimit: number,
): Promise<JSONObject> {
  const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
    ClickhouseAppInstance.getDataSource();

  if (!client) {
    throw new BadDataException("ClickHouse is not connected on this instance.");
  }

  const startedAt: number = Date.now();
  const isRead: boolean = clickhouseStatementIsRead(sql);

  if (readOnly && !isRead) {
    throw new BadDataException(
      "This looks like a write or DDL statement. Turn off read-only mode to run it.",
    );
  }

  if (isRead) {
    const resultSet: Awaited<ReturnType<typeof client.query>> =
      await client.query({
        query: sql,
        format: "JSON",
        clickhouse_settings: {
          max_execution_time: QUERY_CH_TIMEOUT_SECONDS,
          max_result_rows: String(rowLimit + 1),
          result_overflow_mode: "break",
          ...(readOnly ? { readonly: "2" } : {}),
        },
      });

    const json: {
      meta?: Array<{ name: string; type: string }>;
      data?: Array<Record<string, unknown>>;
    } = (await resultSet.json()) as {
      meta?: Array<{ name: string; type: string }>;
      data?: Array<Record<string, unknown>>;
    };

    const meta: Array<{ name: string; type: string }> = json.meta || [];
    const allRows: Array<Record<string, unknown>> = json.data || [];
    const limited: Array<Record<string, unknown>> = allRows.slice(0, rowLimit);
    const columns: Array<string> = meta.length
      ? meta.map((column: { name: string }): string => {
          return String(column.name);
        })
      : deriveColumns(limited);
    const rows: JSONArray = rowsToCells(limited, columns);

    return {
      engine: "clickhouse",
      columns,
      columnTypes: meta.map(
        (column: { name: string; type: string }): JSONObject => {
          return { name: String(column.name), type: String(column.type) };
        },
      ),
      rows,
      rowsReturned: rows.length,
      totalRows: allRows.length,
      truncated: allRows.length > rowLimit,
      readOnly,
      executionTimeMs: Date.now() - startedAt,
      message: null,
    };
  }

  await client.command({
    query: sql,
    clickhouse_settings: { max_execution_time: QUERY_CH_TIMEOUT_SECONDS },
  });

  return {
    engine: "clickhouse",
    columns: [],
    columnTypes: [],
    rows: [],
    rowsReturned: 0,
    totalRows: 0,
    truncated: false,
    readOnly,
    executionTimeMs: Date.now() - startedAt,
    message: "Statement executed successfully.",
  };
}

/*
 * Redis commands that are ALWAYS refused from the console, in either mode —
 * server-destroying, server-config, replication-altering or connection-blocking
 * commands that have no place in an ad-hoc query tool. `redis-cli` remains the
 * escape hatch for these.
 */
const REDIS_ALWAYS_BLOCKED: Set<string> = new Set([
  "SHUTDOWN",
  "DEBUG",
  "MONITOR",
  "SYNC",
  "PSYNC",
  "SUBSCRIBE",
  "PSUBSCRIBE",
  "SSUBSCRIBE",
  "FLUSHALL",
  "FLUSHDB",
  "SWAPDB",
  "REPLICAOF",
  "SLAVEOF",
  "FAILOVER",
  "SAVE",
  "BGSAVE",
  "BGREWRITEAOF",
  "CLUSTER",
  "MIGRATE",
  "RESET",
  "CONFIG",
  "ACL",
  /*
   * Connection-scoped / DB-switching commands: even on a dedicated console
   * connection these have no place in an ad-hoc query tool, and SELECT/CLIENT
   * would change the connection's selected DB or reply state.
   */
  "SELECT",
  "CLIENT",
  // Server-side scripting — arbitrary code execution against Redis.
  "EVAL",
  "EVALSHA",
  "EVAL_RO",
  "EVALSHA_RO",
  "FCALL",
  "FCALL_RO",
  "SCRIPT",
  "FUNCTION",
  "BLPOP",
  "BRPOP",
  "BLMOVE",
  "BRPOPLPUSH",
  "BLMPOP",
  "BZPOPMIN",
  "BZPOPMAX",
  "BZMPOP",
  "WAIT",
]);

/*
 * Redis read-only commands the console permits when read-only mode is on. A
 * curated allow-list (rather than a write denylist) so a command we have not
 * vetted defaults to "blocked in read-only mode".
 */
const REDIS_READONLY_ALLOWED: Set<string> = new Set([
  "GET",
  "MGET",
  "STRLEN",
  "GETRANGE",
  "SUBSTR",
  "EXISTS",
  "TYPE",
  "TTL",
  "PTTL",
  "EXPIRETIME",
  "PEXPIRETIME",
  "OBJECT",
  "DUMP",
  "RANDOMKEY",
  "KEYS",
  "SCAN",
  "DBSIZE",
  "HGET",
  "HMGET",
  "HGETALL",
  "HKEYS",
  "HVALS",
  "HLEN",
  "HEXISTS",
  "HSTRLEN",
  "HSCAN",
  "HRANDFIELD",
  "LRANGE",
  "LINDEX",
  "LLEN",
  "LPOS",
  "SMEMBERS",
  "SISMEMBER",
  "SMISMEMBER",
  "SCARD",
  "SSCAN",
  "SRANDMEMBER",
  "SINTER",
  "SUNION",
  "SDIFF",
  "ZRANGE",
  "ZRANGEBYSCORE",
  "ZRANGEBYLEX",
  "ZREVRANGE",
  "ZREVRANGEBYSCORE",
  "ZREVRANGEBYLEX",
  "ZSCORE",
  "ZMSCORE",
  "ZCARD",
  "ZCOUNT",
  "ZRANK",
  "ZREVRANK",
  "ZSCAN",
  "ZRANDMEMBER",
  "ZLEXCOUNT",
  "XRANGE",
  "XREVRANGE",
  "XLEN",
  "XINFO",
  "XPENDING",
  "GETBIT",
  "BITCOUNT",
  "BITPOS",
  "GEOPOS",
  "GEODIST",
  "GEOSEARCH",
  "GEOHASH",
  "PFCOUNT",
  "MEMORY",
  "INFO",
  "PING",
  "ECHO",
  "TIME",
  "LASTSAVE",
  "COMMAND",
  "LOLWUT",
]);

// Tokenise one Redis command line into command + args, respecting quotes.
function parseRedisCommandLine(line: string): Array<string> {
  const tokens: Array<string> = [];
  const tokenPattern: RegExp = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match: RegExpExecArray | null = null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\(.)/g, "$1"));
    } else if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\(.)/g, "$1"));
    } else if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }

  return tokens;
}

// MEMORY is allow-listed for its read subcommands; these are the safe ones.
const REDIS_MEMORY_READONLY_SUBCOMMANDS: Set<string> = new Set([
  "USAGE",
  "STATS",
  "DOCTOR",
  "MALLOC-STATS",
]);

/*
 * Run one or more Redis commands (one per non-comment line, redis-cli style).
 * Each command is checked against the always-blocked denylist and, in read-only
 * mode, the read-only allow-list. A failure on one line is reported inline
 * without aborting the rest of the batch.
 *
 * Commands run on a DEDICATED, disposable connection (a duplicate of the app's
 * client) — never the shared singleton — so a stateful command can't corrupt the
 * cache/session/queue traffic on the app connection, and a slow command that
 * times out can't head-of-line-block it. After a timeout we recycle the
 * connection (the abandoned command may still be running on it) so the remaining
 * lines in the batch run on a fresh connection.
 */
async function runRedisCommands(
  input: string,
  readOnly: boolean,
): Promise<JSONObject> {
  const baseClient: ReturnType<typeof Redis.getClient> = Redis.getClient();

  if (!baseClient || !Redis.isConnected()) {
    throw new BadDataException("Redis is not connected on this instance.");
  }

  const lines: Array<string> = input
    .split(/\r?\n/)
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0 && !line.startsWith("#");
    });

  if (lines.length === 0) {
    throw new BadDataException("No Redis command provided.");
  }

  if (lines.length > QUERY_REDIS_MAX_COMMANDS) {
    throw new BadDataException(
      `Too many commands — a maximum of ${QUERY_REDIS_MAX_COMMANDS} commands can be run at once.`,
    );
  }

  const startedAt: number = Date.now();
  const results: JSONArray = [];
  const timeoutMessage: string = `Redis command timed out after ${QUERY_REDIS_TIMEOUT_MS}ms`;

  let consoleClient: NonNullable<ReturnType<typeof Redis.getClient>> =
    baseClient.duplicate();

  try {
    for (const line of lines) {
      const tokens: Array<string> = parseRedisCommandLine(line);

      if (tokens.length === 0) {
        continue;
      }

      const command: string = tokens[0]!.toUpperCase();
      const args: Array<string> = tokens.slice(1);

      if (REDIS_ALWAYS_BLOCKED.has(command)) {
        results.push({
          command: line,
          ok: false,
          error: `The ${command} command is not allowed from the query console. Use redis-cli for this operation.`,
        });
        continue;
      }

      if (readOnly && !REDIS_READONLY_ALLOWED.has(command)) {
        results.push({
          command: line,
          ok: false,
          error: `${command} is not a permitted read-only command. Turn off read-only mode to run write commands.`,
        });
        continue;
      }

      // MEMORY PURGE (and any non-read MEMORY subcommand) mutates server state.
      if (
        readOnly &&
        command === "MEMORY" &&
        !REDIS_MEMORY_READONLY_SUBCOMMANDS.has((args[0] || "").toUpperCase())
      ) {
        results.push({
          command: line,
          ok: false,
          error: `MEMORY ${(args[0] || "").toUpperCase()} is not a permitted read-only subcommand. Turn off read-only mode to run it.`,
        });
        continue;
      }

      try {
        const reply: unknown = await withTimeout(
          consoleClient.call(command, ...args),
          QUERY_REDIS_TIMEOUT_MS,
          timeoutMessage,
        );

        results.push({ command: line, ok: true, reply: toQueryCell(reply) });
      } catch (err) {
        results.push({
          command: line,
          ok: false,
          error: getQueryErrorMessage(err),
        });

        /*
         * The timed-out command may still be executing on this connection — drop
         * it and start fresh so the rest of the batch isn't blocked behind it.
         */
        if (err instanceof Error && err.message === timeoutMessage) {
          consoleClient.disconnect();
          consoleClient = baseClient.duplicate();
        }
      }
    }
  } finally {
    consoleClient.disconnect();
  }

  return {
    engine: "redis",
    results,
    commandsRun: results.length,
    readOnly,
    executionTimeMs: Date.now() - startedAt,
  };
}

// Shared handler: validate, dispatch to the engine runner, and shape the response.
async function handleQueryRequest(
  engine: QueryEngine,
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> {
  try {
    assertEnterpriseQueryConsole();

    const body: JSONObject = (req.body || {}) as JSONObject;
    const query: string = (body["query"] ?? "").toString();

    if (!query.trim()) {
      throw new BadDataException("A query is required.");
    }

    const readOnly: boolean = body["readOnly"] !== false;
    const rowLimit: number = resolveRowLimit(body["maxRows"]);

    const startedAt: number = Date.now();

    try {
      let data: JSONObject;

      if (engine === "postgres") {
        data = await runPostgresQuery(query, readOnly, rowLimit);
      } else if (engine === "clickhouse") {
        data = await runClickhouseQuery(query, readOnly, rowLimit);
      } else {
        data = await runRedisCommands(query, readOnly);
      }

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        ...data,
      });
    } catch (queryErr) {
      // Surface the datastore error inline (200) so the console can render it.
      return Response.sendJsonObjectResponse(req, res, {
        success: false,
        engine,
        readOnly,
        error: getQueryErrorMessage(queryErr),
        executionTimeMs: Date.now() - startedAt,
      });
    }
  } catch (err) {
    return next(err);
  }
}

router.post(
  "/query/postgres",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return handleQueryRequest("postgres", req, res, next);
  },
);

router.post(
  "/query/clickhouse",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return handleQueryRequest("clickhouse", req, res, next);
  },
);

router.post(
  "/query/redis",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return handleQueryRequest("redis", req, res, next);
  },
);

export default router;
