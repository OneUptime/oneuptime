import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { ClickhouseDatabase as ClickhouseDatabaseName } from "Common/Server/EnvironmentConfig";
import logger from "Common/Server/Utils/Logger";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import { getClickhouseClusterName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  getClickhouseDiskSnapshots,
  getClickhouseLocalTableSizes,
  ClickhouseLocalTableSize,
} from "Common/Server/Utils/AnalyticsDatabase/ClickhouseCapacity";
import {
  getRedisInfoSnapshot,
  RedisInfoSnapshot,
} from "Common/Server/Utils/InstanceHealth/RedisHealth";
import { getTelemetryIngestionBySignal } from "Common/Server/Utils/InstanceHealth/TelemetryIngestion";

/*
 * ---------------------------------------------------------------------------
 * OneUptime Health probes
 *
 * The read-only datastore, queue and log probes behind the OneUptime Health
 * API, plus the credential scrubbing every one of them runs its output
 * through. Two callers share them:
 *
 *   - core's AdminHealth router (./AdminHealth.ts): the support bundle,
 *     ClickHouse capacity and migration status, available on every edition;
 *   - the live Health dashboards in the Enterprise Edition module
 *     (ee/Server/AdminHealth), which import this module and never the router,
 *     so the dashboards and the downloaded bundle cannot disagree.
 *
 * Only probes the support bundle (or another Community route) also uses
 * belong here. A probe that only a live dashboard reads is enterprise code
 * and lives in ee/, which the Community image does not contain.
 * ---------------------------------------------------------------------------
 */

export type ClickhouseJsonResult = { data: Array<JSONObject> };

// Per-node ClickHouse storage: data footprint (bytes_on_disk) + disk capacity.
type HostStorage = {
  dataSizeInBytes: number | null;
  diskFreeInBytes: number | null;
  diskTotalInBytes: number | null;
};

/*
 * Normalise a ClickHouse host identifier to its first DNS label, lower-cased, so
 * a shard/replica's `system.clusters.host_name` can be matched to the per-node
 * `hostName()` that storage metrics are keyed by — the two can differ by domain
 * suffix (short pod name vs FQDN) in a Kubernetes / Altinity-operator cluster.
 */
function normalizeHostLabel(host: string): string {
  const label: string = host.split(".")[0] || host;
  return label.toLowerCase();
}

// Parse a possibly-bigint-as-string value (Postgres/ClickHouse return UInt64/bigint as strings in JSON).
export function toNumberOrNull(value: unknown): number | null {
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
export function toIsoOrNull(value: unknown): string | null {
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

export function redactDdlSecrets(ddl: string): string {
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

export async function getPostgresStats(): Promise<JSONObject> {
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

export async function getClickhouseStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    dataSizeInBytes: null,
    diskFreeInBytes: null,
    diskTotalInBytes: null,
    diskByNode: [],
    topTables: [],
    localTableSizesByShard: [],
  };

  try {
    const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
      ClickhouseAppInstance.getDataSource();

    if (!client) {
      return result;
    }

    const clusterNameLiteral: string = getClickhouseClusterName().replace(
      /'/g,
      "''",
    );
    const databaseNameLiteral: string = ClickhouseDatabaseName.replace(
      /'/g,
      "''",
    );

    /*
     * Total on-disk (compressed) size of active parts, summed ACROSS THE CLUSTER.
     * system.parts is node-local, so we read it through `cluster(<name>, …)` —
     * which hits one replica per shard — and sum: every shard counted once, no
     * replica double-counting (clusterAllReplicas would overcount by the
     * replication factor). On a single-node "cluster of one" this equals a plain
     * system.parts read. Independently guarded so a failure here doesn't drop the
     * disk / table stats below.
     */
    try {
      const sizeResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            `SELECT sum(bytes_on_disk) AS bytes FROM cluster('${clusterNameLiteral}', system.parts) WHERE active AND database = '${databaseNameLiteral}'` +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["connected"] = true;
      result["dataSizeInBytes"] = toNumberOrNull(
        sizeResult.data?.[0]?.["bytes"],
      );
    } catch (err) {
      logger.error("AdminHealth: failed to read ClickHouse data size");
      logger.error(err);
    }

    /*
     * Disk capacity stays separate per writable physical disk, so a roomy
     * volume on the same host cannot hide one that is nearly full. Aggregate
     * totals remain available for the support bundle and UI fallback.
     */
    try {
      const nodes: JSONArray = [];
      let totalSum: number = 0;
      let freeSum: number = 0;

      for (const disk of await getClickhouseDiskSnapshots()) {
        const totalInBytes: number = disk.totalInBytes;
        const freeInBytes: number = disk.freeInBytes;
        nodes.push({
          shardNum: disk.shardNum,
          host: disk.host,
          diskName: disk.diskName,
          path: disk.path,
          freeInBytes: freeInBytes,
          unreservedInBytes: disk.unreservedInBytes,
          totalInBytes: totalInBytes,
          utilizationPercent: disk.utilizationPercent,
        });
        totalSum += totalInBytes;
        freeSum += freeInBytes;
      }

      result["connected"] = true;
      result["diskByNode"] = nodes;
      result["diskTotalInBytes"] = nodes.length > 0 ? totalSum : null;
      result["diskFreeInBytes"] = nodes.length > 0 ? freeSum : null;
    } catch (err) {
      logger.error("AdminHealth: failed to read ClickHouse disk capacity");
      logger.error(err);
    }

    /*
     * Largest tables across the cluster — same `cluster(<name>)`
     * one-replica-per-shard read as the data size, so each table is totalled once.
     * Groups by the physical (…Local) storage-table name, which is what actually
     * holds the bytes.
     */
    try {
      const tablesResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            `SELECT table AS name, sum(bytes_on_disk) AS bytes FROM cluster('${clusterNameLiteral}', system.parts) WHERE active AND database = '${databaseNameLiteral}' AND endsWith(table, 'Local') GROUP BY table ORDER BY bytes DESC LIMIT 8` +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      result["connected"] = true;
      result["topTables"] = (tablesResult.data || []).map(
        (row: JSONObject): JSONObject => {
          return {
            name: String(row["name"]),
            sizeInBytes: toNumberOrNull(row["bytes"]),
          };
        },
      );
    } catch (err) {
      logger.error("AdminHealth: failed to read ClickHouse top tables");
      logger.error(err);
    }

    try {
      result["localTableSizesByShard"] = (
        await getClickhouseLocalTableSizes()
      ).map((table: ClickhouseLocalTableSize): JSONObject => {
        return {
          shardNum: table.shardNum,
          host: table.host,
          tableName: table.tableName,
          sizeInBytes: table.sizeInBytes,
          rowCount: table.rowCount,
          partCount: table.partCount,
        };
      });
      result["connected"] = true;
    } catch (err) {
      logger.error(
        "AdminHealth: failed to read local ClickHouse table sizes by shard",
      );
      logger.error(err);
    }
  } catch (err) {
    logger.error("AdminHealth: failed to read ClickHouse stats");
    logger.error(err);
  }

  return result;
}

/*
 * Reads the same INFO fields the Redis health notifications watch, so the page
 * an operator lands on from a notification shows the signal that fired it.
 * getRedisInfoSnapshot is deliberately the read-only variant — the worker's
 * delta-bearing snapshot advances a stored counter baseline, and calling that
 * from a page refresh would consume the very eviction delta the notification
 * needs.
 */
export async function getRedisStats(): Promise<JSONObject> {
  const result: JSONObject = {
    connected: false,
    usedMemoryInBytes: null,
    maxMemoryInBytes: null,
    maxMemoryPolicy: null,
    connectedClients: null,
    maxClients: null,
    blockedClients: null,
    evictedKeys: null,
    rejectedConnections: null,
    rdbLastBgsaveStatus: null,
    aofEnabled: null,
    aofLastWriteStatus: null,
    aofLastBgrewriteStatus: null,
  };

  try {
    const snapshot: RedisInfoSnapshot | null = await getRedisInfoSnapshot();

    if (!snapshot) {
      return result;
    }

    result["connected"] = true;
    result["usedMemoryInBytes"] = snapshot.usedMemoryInBytes;
    result["maxMemoryInBytes"] = snapshot.maxMemoryInBytes;
    result["maxMemoryPolicy"] = snapshot.maxMemoryPolicy;
    result["connectedClients"] = snapshot.connectedClients;
    result["maxClients"] = snapshot.maxClients;
    result["blockedClients"] = snapshot.blockedClients;
    result["evictedKeys"] = snapshot.evictedKeys;
    result["rejectedConnections"] = snapshot.rejectedConnections;
    result["rdbLastBgsaveStatus"] = snapshot.rdbLastBgsaveStatus;
    result["aofEnabled"] = snapshot.isAofEnabled;
    result["aofLastWriteStatus"] = snapshot.aofLastWriteStatus;
    result["aofLastBgrewriteStatus"] = snapshot.aofLastBgrewriteStatus;
  } catch (err) {
    logger.error("AdminHealth: failed to read Redis stats");
    logger.error(err);
  }

  return result;
}

export async function getQueueStats(): Promise<JSONArray> {
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
export const SUPPORT_QUEUE_NAMES: Array<QueueName> = [
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

export function scrubSecretsFromText(text: string): string {
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
 * env-var-oriented SECRET_KEY_PATTERN in ./AdminHealth.ts would miss.
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
export async function getFailedJobsForQueue(
  queueName: QueueName,
): Promise<JSONArray> {
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
export async function getQueueDiagnostics(): Promise<JSONArray> {
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
 * Postgres runtime diagnostics: tuning settings, a connection-state summary and
 * per-table churn / vacuum stats. We read only counts, durations and settings
 * (never query text or row data), so this stays safe to share. The connection
 * summary surfaces lock convoys (idle-in-transaction pile-ups, lock waits); the
 * table stats surface dead-tuple bloat and stalled autovacuum.
 */
export async function getPostgresDiagnostics(): Promise<JSONObject> {
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
         COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - query_start) FILTER (WHERE state = 'active'))), 0) AS longest_active_query_seconds,
         COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - state_change) FILTER (WHERE state = 'idle in transaction'))), 0) AS longest_idle_in_transaction_seconds
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
export async function getPostgresClusterHealth(): Promise<JSONObject> {
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
    topTablesBySize: [],
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
           COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - query_start) FILTER (WHERE state = 'active'))), 0) AS longest_active_query_seconds,
           COALESCE(ROUND(EXTRACT(EPOCH FROM max(now() - state_change) FILTER (WHERE state = 'idle in transaction'))), 0) AS longest_idle_in_transaction_seconds
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

    /*
     * 8. Largest tables by total size — where the disk actually goes. The three
     * component sizes are reported so they sum back to the total: pg_table_size
     * already INCLUDES the toast heap + toast index, so toast is subtracted out
     * of it to leave the main heap (plus fsm/vm). Without that subtraction toast
     * would be counted twice and a toast-heavy table (large JSONB / text columns)
     * would read as a bloated heap, pointing the operator at a vacuum instead of
     * at the column that is actually costing the disk.
     */
    try {
      const sizeTableRows: Array<{
        schemaname: string;
        relname: string;
        total_bytes: string;
        table_bytes: string;
        index_bytes: string;
        toast_bytes: string;
        live_tuples: string;
        dead_tuples: string;
      }> = await dataSource.query(
        `SELECT
           s.schemaname,
           s.relname,
           pg_total_relation_size(s.relid) AS total_bytes,
           pg_table_size(s.relid)
             - COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS table_bytes,
           pg_indexes_size(s.relid) AS index_bytes,
           COALESCE(pg_total_relation_size(c.reltoastrelid), 0) AS toast_bytes,
           s.n_live_tup AS live_tuples,
           s.n_dead_tup AS dead_tuples
         FROM pg_stat_user_tables s
         JOIN pg_class c ON c.oid = s.relid
         ORDER BY pg_total_relation_size(s.relid) DESC
         LIMIT 10`,
      );

      result["topTablesBySize"] = sizeTableRows.map(
        (row: (typeof sizeTableRows)[number]): JSONObject => {
          return {
            name: `${row.schemaname}.${row.relname}`,
            totalSizeInBytes: toNumberOrNull(row.total_bytes),
            tableSizeInBytes: toNumberOrNull(row.table_bytes),
            indexSizeInBytes: toNumberOrNull(row.index_bytes),
            toastSizeInBytes: toNumberOrNull(row.toast_bytes),
            liveTuples: toNumberOrNull(row.live_tuples),
            deadTuples: toNumberOrNull(row.dead_tuples),
          };
        },
      );
    } catch (err) {
      logger.debug("AdminHealth: table size probe failed");
      logger.debug(err);
    }

    // 9. Total database size.
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
export const CH_DIAG_QUERY_SETTINGS: string =
  " SETTINGS max_execution_time = 10";

/*
 * ClickHouse runtime diagnostics: concurrency / memory settings, mutation
 * progress and part-count pressure. Stuck or failing mutations and runaway part
 * counts are the usual causes of telemetry-ingest backlogs. We emit the engine
 * fail-reason (an infrastructure error, not row data) but never the mutation
 * command, which can embed row predicates.
 */
export async function getClickhouseDiagnostics(): Promise<JSONObject> {
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

    /*
     * Per-node storage, so each shard/replica below can show how much data it
     * holds and its disk headroom. Read through `clusterAllReplicas(<name>, …)`
     * (EVERY node, not one per shard) and keyed by hostName(): data footprint from
     * system.parts (bytes_on_disk), disk capacity from system.disks. Each replica
     * of a shard keeps its own copy, so per-replica figures also surface a replica
     * that has drifted from its peers. Joined to system.clusters.host_name by
     * normalised host label. Independently guarded — this is best-effort
     * enrichment and must never drop the topology below.
     */
    const storageByHost: Map<string, HostStorage> = new Map();

    try {
      const partsByHostResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            `SELECT hostName() AS host, sum(bytes_on_disk) AS data_bytes FROM clusterAllReplicas('${clusterNameLiteral}', system.parts) WHERE active GROUP BY host` +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      for (const row of partsByHostResult.data || []) {
        const key: string = normalizeHostLabel(String(row["host"]));
        const entry: HostStorage = storageByHost.get(key) || {
          dataSizeInBytes: null,
          diskFreeInBytes: null,
          diskTotalInBytes: null,
        };
        entry.dataSizeInBytes = toNumberOrNull(row["data_bytes"]);
        storageByHost.set(key, entry);
      }
    } catch {
      logger.debug("AdminHealth: per-node ClickHouse data size unavailable");
    }

    try {
      const disksByHostResult: ClickhouseJsonResult = (await (
        await client.query({
          query:
            `SELECT hostName() AS host, sum(free_space) AS free, sum(total_space) AS total FROM clusterAllReplicas('${clusterNameLiteral}', system.disks) GROUP BY host` +
            CH_DIAG_QUERY_SETTINGS,
          format: "JSON",
        })
      ).json()) as ClickhouseJsonResult;

      for (const row of disksByHostResult.data || []) {
        const key: string = normalizeHostLabel(String(row["host"]));
        const entry: HostStorage = storageByHost.get(key) || {
          dataSizeInBytes: null,
          diskFreeInBytes: null,
          diskTotalInBytes: null,
        };
        entry.diskFreeInBytes = toNumberOrNull(row["free"]);
        entry.diskTotalInBytes = toNumberOrNull(row["total"]);
        storageByHost.set(key, entry);
      }
    } catch {
      logger.debug(
        "AdminHealth: per-node ClickHouse disk capacity unavailable",
      );
    }

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
          const hostName: string = String(row["host_name"]);
          const storage: HostStorage | undefined = storageByHost.get(
            normalizeHostLabel(hostName),
          );
          return {
            shardNum: toNumberOrNull(row["shard_num"]),
            replicaNum: toNumberOrNull(row["replica_num"]),
            hostName: hostName,
            errorsCount: toNumberOrNull(row["errors_count"]),
            slowdownsCount: toNumberOrNull(row["slowdowns_count"]),
            estimatedRecoveryTime: toNumberOrNull(
              row["estimated_recovery_time"],
            ),
            dataSizeInBytes: storage?.dataSizeInBytes ?? null,
            diskFreeInBytes: storage?.diskFreeInBytes ?? null,
            diskTotalInBytes: storage?.diskTotalInBytes ?? null,
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
 * Telemetry ingestion rate for the dashboard, by signal: how many log, metric
 * and trace rows landed in ClickHouse over the last minute, hour and day, plus
 * each signal's actual (uncompressed) footprint. The probe itself lives in
 * Common/Server/Utils/InstanceHealth/TelemetryIngestion so the by-signal and
 * by-project views cannot drift apart on which tables and event-time columns
 * count as "telemetry". The support bundle carries these figures on every
 * edition; the live dashboard route in ee/Server/AdminHealth is licensed.
 */
export async function getClickhouseTelemetryIngestion(): Promise<JSONObject> {
  return (await getTelemetryIngestionBySignal()) as unknown as JSONObject;
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
    note: "Valkey server log files are not reachable over the Redis protocol. Showing SLOWLOG and INFO counters instead — use `kubectl logs` / `docker logs` on the Valkey container for the full server log.",
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
export async function getDiagnosticLogs(): Promise<JSONObject> {
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
      "Container stdout/stderr logs — for this app and for the Postgres / ClickHouse / Valkey containers — cannot be read from inside the app process (it has no Docker socket or Kubernetes API access). Use `kubectl logs <pod>` (Kubernetes) or `docker logs <container>` (Docker Compose). The sections above are the closest in-app equivalents.",
  };
}
