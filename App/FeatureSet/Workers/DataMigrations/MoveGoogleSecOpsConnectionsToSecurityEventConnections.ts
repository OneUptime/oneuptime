import DataMigrationBase from "./DataMigrationBase";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceClass,
} from "Common/Server/Services/SecurityEventConnectionService";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import Encryption from "Common/Server/Utils/Encryption";
import { redactLogString } from "Common/Server/Utils/LogRedaction";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectorCheckStatus } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ConnectionRepository = ReturnType<
  (typeof SecurityEventConnectionService)["getRepository"]
>;

type LegacyQuery = (
  sql: string,
  parameters?: Array<unknown>,
) => Promise<unknown>;

/*
 * Run history is never cleaned up, so a connection polling every five
 * minutes has written about 100,000 rows a year. The dashboard lists the
 * latest 20. The most recent 500 per connection keep more than a day and a
 * half of a five-minute poller's history (far more for anything slower)
 * without turning an upgrade into a bulk copy of every row ever written.
 * Older runs stay in "GoogleSecOpsConnectionRun".
 */
export const RUN_HISTORY_COPY_LIMIT: number = 500;

/*
 * Rows per INSERT. A run's result JSON carries samples and checks, so a
 * statement of 50 stays far inside statement_timeout and the bind limit.
 */
export const RUN_INSERT_BATCH_SIZE: number = 50;

/*
 * A queued or running legacy run has an outcome nobody here can know. During
 * a rolling deploy an old worker still has the handler for
 * "SecurityEvents:RunGoogleSecOpsConnection": it may be executing the run
 * right now, or pick its queued job up and finish it, importing events and
 * writing success to "GoogleSecOpsConnectionRun" only (a manual run ignores
 * the disable below, and a scheduled one already past its check does too).
 * Once no pod knows the name, the job fails with "No job found" instead. So
 * the message states only what is certain, and warns that a re-run may
 * import the same window twice while an old run is still going (the two
 * pollers hold different source locks).
 *
 * Still copied as failed: copied as active, it would block admission for its
 * connection until the twenty-minute stale sweep failed it with an error
 * blaming worker health.
 */
export const INTERRUPTED_RUN_ERROR: string =
  "This operation was still in progress when Google SecOps moved to Security Event Connections, so its outcome was not recorded here. Check the imported security events before running it again.";

/*
 * Postgres SQLSTATEs a repeat of the same statement can succeed after:
 * serialization_failure, deadlock_detected, query_canceled (statement_timeout
 * or a cancel), admin_shutdown, crash_shutdown, cannot_connect_now (a server
 * starting or failing over), too_many_connections and
 * configuration_limit_exceeded. The whole of class 08 (connection exception)
 * is matched by prefix below.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const TRANSIENT_SQLSTATES: Array<string> = [
  "40001",
  "40P01",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "53300",
  "53400",
];

const CONNECTION_EXCEPTION_SQLSTATE_CLASS: string = "08";

const SQLSTATE_PATTERN: RegExp = /^[0-9A-Z]{5}$/;

// Node socket errors, which pg passes through with the code on the error.
const TRANSIENT_SOCKET_CODES: Array<string> = [
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
];

/*
 * Lower-cased message fragments of failures that carry no SQLSTATE: pg's
 * "Connection terminated unexpectedly" / "... due to connection timeout",
 * pg-pool's "timeout exceeded when trying to connect", and socket errors
 * whose code was lost on the way ("read ECONNRESET").
 */
const TRANSIENT_MESSAGE_FRAGMENTS: Array<string> = [
  "connection terminated",
  "timeout exceeded when trying to connect",
  "econnreset",
  "etimedout",
  "econnrefused",
];

export const UNTITLED_DETECTION_TITLE: string = "Untitled detection";

export const UNKNOWN_SEVERITY: string = "Unknown";

/*
 * Google-only result fields. The generic run result has no slot for them,
 * so they move under providerDetails, the slot the Google SecOps connector
 * fills on new runs.
 */
export const GOOGLE_SECOPS_PROVIDER_DETAIL_KEYS: Array<string> = [
  "includeNonAlertingDetections",
  "basis",
  "sourceCounts",
  "creationLag",
];

const ACTIVE_RUN_STATUSES: Array<string> = ["queued", "running"];

const GENERIC_CHECK_STATUSES: Array<SecurityConnectorCheckStatus> = [
  "pass",
  "fail",
  "warn",
  "skip",
];

/*
 * Resolved through search_path, like every unqualified statement below,
 * rather than pinned to public: the probe must find the table exactly when
 * the SELECT that follows it would.
 */
const LEGACY_TABLES_SQL: string = `SELECT to_regclass('"GoogleSecOpsConnection"') IS NOT NULL AS "hasConnectionTable", to_regclass('"GoogleSecOpsConnectionRun"') IS NOT NULL AS "hasRunTable"`;

const LEGACY_CONNECTIONS_SQL: string = `SELECT "_id", "createdAt", "updatedAt", "projectId", "name", "region", "instanceResourceName", "serviceAccountJson", "isEnabled", "pollIntervalInMinutes", "includeNonAlertingDetections", "lastSuccessfulPollAt", "lastEventIngestedAt", "lastPollResult", "lastPolledAt", "cursor", "lastError", "createdByUserId", "deletedByUserId" FROM "GoogleSecOpsConnection" WHERE "deletedAt" IS NULL ORDER BY "_id"`;

const LEGACY_RUNS_SQL: string = `SELECT "_id", "createdAt", "updatedAt", "requestedByUserId", "type", "status", "startedAt", "completedAt", "request", "result", "error" FROM "GoogleSecOpsConnectionRun" WHERE "googleSecOpsConnectionId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC, "_id" DESC LIMIT $2`;

const DISABLE_LEGACY_CONNECTION_SQL: string = `UPDATE "GoogleSecOpsConnection" SET "isEnabled" = false WHERE "_id" = $1`;

/*
 * "version" is NOT NULL with no default (the @VersionColumn a service
 * create fills in), so a raw insert has to supply it.
 */
const RUN_INSERT_COLUMNS_SQL: string = `"_id", "createdAt", "updatedAt", "version", "projectId", "securityEventConnectionId", "requestedByUserId", "type", "status", "startedAt", "completedAt", "request", "result", "error"`;

// Zero-based positions, in each row's bound values, of the jsonb columns.
const RUN_INSERT_JSON_POSITIONS: Array<number> = [10, 11];

type LegacyTimestamp = Date | string | null;

// A GoogleSecOpsConnection row as the Postgres driver returns it.
export interface LegacyGoogleSecOpsConnectionRow {
  _id: string;
  createdAt: LegacyTimestamp;
  updatedAt: LegacyTimestamp;
  projectId: string;
  name: string | null;
  region: string | null;
  instanceResourceName: string | null;
  serviceAccountJson: string | null;
  isEnabled: boolean | null;
  pollIntervalInMinutes: number | null;
  includeNonAlertingDetections: boolean | null;
  lastSuccessfulPollAt: LegacyTimestamp;
  lastEventIngestedAt: LegacyTimestamp;
  lastPollResult: unknown;
  lastPolledAt: LegacyTimestamp;
  cursor: string | null;
  lastError: string | null;
  createdByUserId: string | null;
  deletedByUserId: string | null;
}

// A GoogleSecOpsConnectionRun row as the Postgres driver returns it.
export interface LegacyGoogleSecOpsRunRow {
  _id: string;
  createdAt: LegacyTimestamp;
  updatedAt: LegacyTimestamp;
  requestedByUserId: string | null;
  type: string;
  status: string;
  startedAt: LegacyTimestamp;
  completedAt: LegacyTimestamp;
  request: unknown;
  result: unknown;
  error: string | null;
}

export interface RunHistoryInsert {
  sql: string;
  parameters: Array<unknown>;
}

interface LegacyTables {
  hasConnectionTable: boolean;
  hasRunTable: boolean;
}

interface LegacyConnections {
  query: LegacyQuery;
  hasRunTable: boolean;
  rows: Array<LegacyGoogleSecOpsConnectionRow>;
}

type ConnectionOutcome = "copied" | "already-copied" | "skipped";

interface MovedConnection {
  outcome: ConnectionOutcome;
  runCount: number;
  // The connection moved, but a transient error stopped its run history copy.
  runHistoryFailedTransiently: boolean;
}

interface MoveTally {
  copied: number;
  alreadyCopied: number;
  skipped: number;
  failed: number;
  runs: number;
  // Legacy ids a retry of the migration can still finish, named in its error.
  notMovedTransiently: Array<string>;
  runHistoryNotCopiedTransiently: Array<string>;
}

function isJSONObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(source: JSONObject, key: string): string {
  const value: unknown = source[key];
  return typeof value === "string" ? value : "";
}

function toDate(value: LegacyTimestamp | undefined): Date | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function isTransientCode(code: unknown): boolean {
  if (typeof code !== "string") {
    return false;
  }

  if (TRANSIENT_SOCKET_CODES.includes(code)) {
    return true;
  }

  return (
    SQLSTATE_PATTERN.test(code) &&
    (code.startsWith(CONNECTION_EXCEPTION_SQLSTATE_CLASS) ||
      TRANSIENT_SQLSTATES.includes(code))
  );
}

function hasTransientMessage(message: unknown): boolean {
  if (typeof message !== "string") {
    return false;
  }

  const lowered: string = message.toLowerCase();

  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment: string): boolean => {
    return lowered.includes(fragment);
  });
}

/*
 * True when the same statement could succeed if run again: a failover, a
 * dropped or refused connection, a deadlock, a serialization failure, a
 * statement timeout, a server at its connection limit. Such a failure must
 * not be recorded as a finished migration; anything else would fail the same
 * way on every retry.
 *
 * TypeORM's QueryFailedError hoists pg's fields onto itself and keeps the
 * original under driverError, so both are read, as PostgresErrorTranslator
 * does. DatabaseService.create rethrows these untouched (it only translates
 * 23503 and 23505). OneUptime's own exceptions carry a NUMERIC code and are
 * never transient. A thrown value that is not an object has no code to read,
 * so it is treated as deterministic. Pure, and never throws.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  try {
    const candidate: { code?: unknown; message?: unknown } = error as {
      code?: unknown;
      message?: unknown;
    };
    const driverError: unknown = (error as { driverError?: unknown })
      .driverError;
    const driver: { code?: unknown; message?: unknown } =
      driverError && typeof driverError === "object"
        ? (driverError as { code?: unknown; message?: unknown })
        : {};

    return (
      isTransientCode(candidate.code) ||
      isTransientCode(driver.code) ||
      hasTransientMessage(candidate.message) ||
      hasTransientMessage(driver.message)
    );
  } catch {
    // A Proxy or a throwing getter: nothing trustworthy to classify.
    return false;
  }
}

/*
 * DatabaseService.unwrapHashedStringEnvelope, which is private there. Until
 * issue #3807 was fixed a secret saved from a dashboard Password field was
 * stored as '{"_type":"HashedString","value":"<ciphertext>"}', and a raw
 * read gets that envelope rather than the ciphertext inside it.
 */
export function unwrapHashedStringEnvelope(storedValue: string): string {
  if (!storedValue.startsWith("{")) {
    return storedValue;
  }

  try {
    const parsed: unknown = JSON.parse(storedValue);

    if (
      isJSONObject(parsed) &&
      parsed["_type"] === ObjectType.HashedString &&
      typeof parsed["value"] === "string"
    ) {
      return parsed["value"];
    }
  } catch {
    // Not JSON, so not the envelope.
  }

  return storedValue;
}

// "Read rule detections by created time" -> "read-rule-detections-by-created-time".
export function toCheckKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function mapLegacyCheckStatus(
  status: unknown,
): SecurityConnectorCheckStatus {
  if (status === "success") {
    return "pass";
  }

  if (status === "failed") {
    return "fail";
  }

  if (
    typeof status === "string" &&
    (GENERIC_CHECK_STATUSES as Array<string>).includes(status)
  ) {
    return status as SecurityConnectorCheckStatus;
  }

  /*
   * Google SecOps only ever wrote success, failed and warn. Anything else is
   * a value nobody can interpret any more. "skip" shows it as a step with no
   * verdict: "pass" would claim a success that may not have happened, and
   * "warn" would ask the reader to act on something they cannot.
   */
  return "skip";
}

function transformLegacyCheck(check: unknown, index: number): unknown {
  if (!isJSONObject(check)) {
    return check;
  }

  const name: string = readText(check, "name");

  return {
    ...check,
    key: readText(check, "key") || toCheckKey(name) || `check-${index + 1}`,
    name,
    status: mapLegacyCheckStatus(check["status"]),
    durationMs:
      typeof check["durationMs"] === "number" ? check["durationMs"] : 0,
    message: readText(check, "message"),
  };
}

function transformLegacySample(sample: unknown): unknown {
  if (!isJSONObject(sample)) {
    return sample;
  }

  const mapped: JSONObject = {
    id:
      typeof sample["id"] === "string"
        ? sample["id"]
        : String(sample["id"] ?? ""),
    title:
      readText(sample, "title") ||
      readText(sample, "ruleName") ||
      UNTITLED_DETECTION_TITLE,
    severity: readText(sample, "severity") || UNKNOWN_SEVERITY,
  };

  const createdTime: string = readText(sample, "createdTime");

  if (createdTime) {
    mapped["createdTime"] = createdTime;
  }

  const eventTime: string =
    readText(sample, "eventTime") || readText(sample, "detectionTime");

  if (eventTime) {
    mapped["eventTime"] = eventTime;
  }

  if (typeof sample["isAlert"] === "boolean") {
    mapped["isAlert"] = sample["isAlert"];
  }

  return mapped;
}

/*
 * A synchronous "Test connection" row already stored the shared report
 * shape (the Google SecOps tester wrote provider "google-secops", keyed
 * checks and a summary), so it needs no translation.
 */
export function isSecurityConnectorTestReport(value: unknown): boolean {
  return (
    isJSONObject(value) &&
    typeof value["provider"] === "string" &&
    typeof value["summary"] === "string" &&
    Array.isArray(value["checks"]) &&
    (value["checks"] as Array<unknown>).every((check: unknown): boolean => {
      return isJSONObject(check) && typeof check["key"] === "string";
    })
  );
}

/*
 * A Google SecOps run result in the generic SecurityEventConnectionRunResult
 * shape the run-history view reads: provider set, checks keyed with
 * pass/fail/warn/skip (a legacy "failed" check would otherwise render
 * green), samples titled, the Google-only fields under providerDetails, and
 * eventAttributeKey naming the attribute those events were stamped with.
 * Every other field is kept. Pure and idempotent.
 */
export function transformLegacyRunResult(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isJSONObject(value) || isSecurityConnectorTestReport(value)) {
    return value;
  }

  const transformed: JSONObject = {};
  const providerDetails: JSONObject = isJSONObject(value["providerDetails"])
    ? { ...value["providerDetails"] }
    : {};

  for (const key of Object.keys(value)) {
    const field: unknown = value[key];

    if (GOOGLE_SECOPS_PROVIDER_DETAIL_KEYS.includes(key)) {
      providerDetails[key] = field as JSONObject;
      continue;
    }

    if (key === "providerDetails") {
      continue;
    }

    if (key === "checks" && Array.isArray(field)) {
      transformed[key] = field.map((check: unknown, index: number) => {
        return transformLegacyCheck(check, index);
      }) as Array<JSONObject>;
      continue;
    }

    if (key === "samples" && Array.isArray(field)) {
      transformed[key] = field.map((sample: unknown) => {
        return transformLegacySample(sample);
      }) as Array<JSONObject>;
      continue;
    }

    transformed[key] = field as JSONObject;
  }

  transformed["provider"] = SecurityEventConnectorProvider.GoogleSecOps;

  if (Object.keys(providerDetails).length > 0) {
    transformed["providerDetails"] = providerDetails;
  }

  transformed["eventAttributeKey"] =
    LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE;

  return transformed;
}

/*
 * The connection's lastPollResult, plus the resume state the generic poller
 * reads. After a forced advance the Google SecOps poller started the next
 * window at the cursor without its one-minute overlap, when the stored poll
 * either skipped up to the cursor (forcedAdvance with windowEnd equal to
 * it) or already started there (windowStart equal to it). The generic
 * poller honours only overlapFloor; without it the first generic poll
 * re-reads the minute that overflowed and forces a second advance.
 */
export function transformLegacyLastPollResult(
  value: unknown,
  cursor: string | null | undefined,
): unknown {
  const transformed: unknown = transformLegacyRunResult(value);

  if (!isJSONObject(transformed) || typeof cursor !== "string") {
    return transformed;
  }

  if (
    transformed["type"] !== "poll" ||
    typeof transformed["overlapFloor"] === "string"
  ) {
    return transformed;
  }

  const cursorTime: number = Date.parse(cursor);

  if (!Number.isFinite(cursorTime)) {
    return transformed;
  }

  const readTime: (key: string) => number = (key: string): number => {
    const stored: unknown = transformed[key];
    return typeof stored === "string" ? Date.parse(stored) : Number.NaN;
  };

  if (
    (transformed["forcedAdvance"] === true &&
      readTime("windowEnd") === cursorTime) ||
    readTime("windowStart") === cursorTime
  ) {
    transformed["overlapFloor"] = new Date(cursorTime).toISOString();
  }

  return transformed;
}

/*
 * One multi-row INSERT for a batch of legacy runs of one connection. Each
 * run keeps its _id (so a second runner's insert is a no-op) and is attached
 * to the copied connection, which kept the legacy connection's _id, within
 * that connection's project.
 */
export function buildRunHistoryInsert(data: {
  runs: Array<LegacyGoogleSecOpsRunRow>;
  connectionId: string;
  projectId: string;
  migratedAt: Date;
}): RunHistoryInsert {
  const rows: Array<string> = [];
  const parameters: Array<unknown> = [];

  for (const run of data.runs) {
    const interrupted: boolean = ACTIVE_RUN_STATUSES.includes(run.status);
    const result: unknown = transformLegacyRunResult(run.result);

    const values: Array<unknown> = [
      run._id,
      run.createdAt,
      run.updatedAt ?? run.createdAt,
      data.projectId,
      data.connectionId,
      run.requestedByUserId ?? null,
      run.type,
      interrupted ? "failed" : run.status,
      run.startedAt ?? null,
      interrupted ? data.migratedAt : run.completedAt ?? null,
      run.request === null || run.request === undefined
        ? null
        : JSON.stringify(run.request),
      result === null ? null : JSON.stringify(result),
      interrupted ? INTERRUPTED_RUN_ERROR : run.error ?? null,
    ];

    const offset: number = parameters.length;
    const placeholders: Array<string> = values.map(
      (_value: unknown, index: number): string => {
        const placeholder: string = `$${offset + index + 1}`;
        return RUN_INSERT_JSON_POSITIONS.includes(index)
          ? `${placeholder}::jsonb`
          : placeholder;
      },
    );

    rows.push(
      `(${placeholders.slice(0, 3).join(", ")}, 1, ${placeholders.slice(3).join(", ")})`,
    );
    parameters.push(...values);
  }

  return {
    sql: `INSERT INTO "SecurityEventConnectionRun" (${RUN_INSERT_COLUMNS_SQL}) VALUES ${rows.join(", ")} ON CONFLICT ("_id") DO NOTHING`,
    parameters,
  };
}

export function buildSecurityEventConnection(data: {
  row: LegacyGoogleSecOpsConnectionRow;
  serviceAccountJson: string;
}): SecurityEventConnection {
  const row: LegacyGoogleSecOpsConnectionRow = data.row;
  const connection: SecurityEventConnection = new SecurityEventConnection();

  connection.id = new ObjectID(String(row._id));

  const createdAt: Date | undefined = toDate(row.createdAt);
  if (createdAt) {
    connection.createdAt = createdAt;
  }

  const updatedAt: Date | undefined = toDate(row.updatedAt);
  if (updatedAt) {
    connection.updatedAt = updatedAt;
  }

  connection.projectId = new ObjectID(String(row.projectId));
  connection.name = row.name || "";
  connection.provider = SecurityEventConnectorProvider.GoogleSecOps;
  connection.config = {
    region: row.region || "",
    instanceResourceName: row.instanceResourceName || "",
  };

  /*
   * A STRING, never an object. The whole JSON text is encrypted once, which
   * is what getConnectorSettings decrypts and parses. Handed an object on
   * this hook-free create, DatabaseService.encrypt would encrypt each key
   * separately and store '{"serviceAccountJson":"U2Fsd..."}', which no read
   * path can decrypt: the connection would look saved with no usable key.
   */
  connection.secrets = JSON.stringify({
    serviceAccountJson: data.serviceAccountJson,
  });

  connection.isEnabled = row.isEnabled !== false;

  if (typeof row.pollIntervalInMinutes === "number") {
    connection.pollIntervalInMinutes = row.pollIntervalInMinutes;
  }

  // Inverted: alerts are always imported; detections only when asked for.
  connection.alertingOnly = row.includeNonAlertingDetections !== true;

  if (typeof row.cursor === "string") {
    connection.cursor = row.cursor;
  }

  const lastPolledAt: Date | undefined = toDate(row.lastPolledAt);
  if (lastPolledAt) {
    connection.lastPolledAt = lastPolledAt;
  }

  const lastSuccessfulPollAt: Date | undefined = toDate(
    row.lastSuccessfulPollAt,
  );
  if (lastSuccessfulPollAt) {
    connection.lastSuccessfulPollAt = lastSuccessfulPollAt;
  }

  const lastEventIngestedAt: Date | undefined = toDate(row.lastEventIngestedAt);
  if (lastEventIngestedAt) {
    connection.lastEventIngestedAt = lastEventIngestedAt;
  }

  if (typeof row.lastError === "string") {
    connection.lastError = row.lastError;
  }

  if (row.createdByUserId) {
    connection.createdByUserId = new ObjectID(String(row.createdByUserId));
  }

  if (row.deletedByUserId) {
    connection.deletedByUserId = new ObjectID(String(row.deletedByUserId));
  }

  const lastPollResult: unknown = transformLegacyLastPollResult(
    row.lastPollResult,
    row.cursor,
  );

  if (isJSONObject(lastPollResult)) {
    connection.lastPollResult = lastPollResult;
  }

  return connection;
}

/*
 * Google SecOps moved from its own GoogleSecOpsConnection model into the
 * Security Event Connections framework (provider "google-secops"). This
 * carries every connection a customer saved over, so polling resumes where
 * it stopped:
 *
 *   - the SecurityEventConnection keeps the legacy _id, which the events
 *     already imported carry (oneuptime.google_secops.connection_id), the
 *     copied runs point at, and lastPollResult.runId names;
 *   - the cursor and poll bookkeeping are copied, with the resume state
 *     translated (transformLegacyLastPollResult);
 *   - the service account key is decrypted and re-encrypted as the
 *     connection's secrets, which is why this cannot be SQL alone;
 *   - the most recent RUN_HISTORY_COPY_LIMIT runs are copied.
 *
 * It is a data migration, not a schema migration, because the key is
 * encrypted by the application and schema migrations run before data
 * migrations. For the same reason the legacy tables are never dropped
 * here: a customer skipping versions would lose them before this ran.
 *
 * Each copied legacy row is then disabled. During a rolling deploy an old
 * pod still runs the Google SecOps poller, under a different source lock
 * than the generic one, so both would poll the same instance and import
 * duplicates. ROLLING BACK to a version with the Google SecOps poller
 * requires setting "isEnabled" back to true on those GoogleSecOpsConnection
 * rows.
 *
 * Safe to run twice, concurrently: a connection whose _id already exists is
 * not created again (a unique violation from a racing runner means the same),
 * runs insert with ON CONFLICT DO NOTHING, and the disable is idempotent.
 *
 * WHEN migrate() THROWS. Every connection is attempted, whatever happens to
 * the others. What a failure then does depends on whether repeating it can
 * succeed, because a throw is how this gets retried: the runner does not
 * record a migration that threw as executed, halts the chain, and runs it
 * again on the next migrate Job or worker boot. Recording it instead is
 * permanent and silent: the Google SecOps poller is gone, so a connection
 * left in the legacy table stops importing and is listed nowhere.
 *
 *   - The table probe or the connection read failing, for any reason:
 *     rethrown at once. Nothing was moved, so recording the migration would
 *     lose every connection, and halting puts the error on the admin health
 *     page. (A disconnected DataSource never gets here; the runner skips.)
 *   - A transient database error (isTransientDatabaseError) on one
 *     connection's existence check, create, disable or run history copy:
 *     logged, the remaining connections are still moved, and then migrate()
 *     throws naming those connections. The retry finds a created connection
 *     already copied, disables its legacy row if that had not happened, and
 *     re-copies its runs, skipping the ones already there. Polling resumes
 *     from the copied cursor, so the delay costs a gap, not events.
 *   - Anything else on one connection (a key that is missing or cannot be
 *     decrypted is skipped; a create rejected by validation fails): logged
 *     with its id, and never thrown. It would fail the same way on every
 *     retry, and halting on it would hold back every later data migration
 *     for good. The connection stays untouched in the legacy table.
 */
export default class MoveGoogleSecOpsConnectionsToSecurityEventConnections extends DataMigrationBase {
  public constructor() {
    super("MoveGoogleSecOpsConnectionsToSecurityEventConnections");
  }

  public override async migrate(): Promise<void> {
    const legacy: LegacyConnections | null = await this.readLegacyConnections();

    if (!legacy || legacy.rows.length === 0) {
      return;
    }

    await this.moveConnections(legacy);
  }

  private async readLegacyConnections(): Promise<LegacyConnections | null> {
    try {
      const repository: ConnectionRepository =
        SecurityEventConnectionService.getRepository();

      const query: LegacyQuery = (
        sql: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        return repository.manager.query(sql, parameters);
      };

      const tables: LegacyTables = await this.findLegacyTables(query);

      if (!tables.hasConnectionTable) {
        return null;
      }

      const rows: unknown = await query(LEGACY_CONNECTIONS_SQL);

      return {
        query,
        hasRunTable: tables.hasRunTable,
        rows: Array.isArray(rows)
          ? (rows as Array<LegacyGoogleSecOpsConnectionRow>)
          : [],
      };
    } catch (err) {
      /*
       * Rethrown, whether transient or not (see the class comment): nothing
       * has been moved yet, and only a throw keeps the runner from recording
       * this migration as done.
       */
      logger.error(
        `${this.name}: could not read the Google SecOps connections to move. They are untouched in the GoogleSecOpsConnection table, and the migration will run again:`,
      );
      logger.error(err);
      throw err;
    }
  }

  private async moveConnections(legacy: LegacyConnections): Promise<void> {
    const migratedAt: Date = OneUptimeDate.getCurrentDate();
    const tally: MoveTally = {
      copied: 0,
      alreadyCopied: 0,
      skipped: 0,
      failed: 0,
      runs: 0,
      notMovedTransiently: [],
      runHistoryNotCopiedTransiently: [],
    };

    for (const row of legacy.rows) {
      const legacyId: string = String(row._id);

      try {
        const moved: MovedConnection = await this.moveConnection({
          query: legacy.query,
          row,
          hasRunTable: legacy.hasRunTable,
          migratedAt,
        });

        if (moved.outcome === "copied") {
          tally.copied++;
        } else if (moved.outcome === "already-copied") {
          tally.alreadyCopied++;
        } else {
          tally.skipped++;
        }

        tally.runs += moved.runCount;

        if (moved.runHistoryFailedTransiently) {
          tally.runHistoryNotCopiedTransiently.push(legacyId);
        }
      } catch (err) {
        tally.failed++;

        if (isTransientDatabaseError(err)) {
          tally.notMovedTransiently.push(legacyId);
          logger.error(
            `${this.name}: could not move Google SecOps connection ${legacyId} because of a transient database error; it stays in the GoogleSecOpsConnection table until the migration runs again:`,
          );
        } else {
          logger.error(
            `${this.name}: could not move Google SecOps connection ${legacyId}; it stays in the GoogleSecOpsConnection table:`,
          );
        }

        logger.error(err);
      }
    }

    logger.info(
      `${this.name}: ${tally.copied} Google SecOps connection(s) copied to Security Event Connections, ${tally.alreadyCopied} already copied, ${tally.skipped} skipped because no usable service account key could be read, ${tally.failed} failed. ${tally.runs} run(s) of history carried over (at most the ${RUN_HISTORY_COPY_LIMIT} most recent per connection).`,
    );

    const unfinished: Array<string> = [];

    if (tally.notMovedTransiently.length > 0) {
      unfinished.push(
        `Google SecOps connection(s) ${tally.notMovedTransiently.join(", ")} were not moved`,
      );
    }

    if (tally.runHistoryNotCopiedTransiently.length > 0) {
      unfinished.push(
        `the run history of Google SecOps connection(s) ${tally.runHistoryNotCopiedTransiently.join(", ")} was not fully copied`,
      );
    }

    if (unfinished.length > 0) {
      // Ids only: the underlying errors, logged above, stay out of the record.
      throw new Error(
        `${unfinished.join("; ")}, because of a transient database error. Every other connection was attempted. The migration is left unrecorded so it runs again, and every step is safe to repeat.`,
      );
    }
  }

  private async findLegacyTables(query: LegacyQuery): Promise<LegacyTables> {
    const result: unknown = await query(LEGACY_TABLES_SQL);
    const first: unknown = Array.isArray(result) ? result[0] : undefined;

    return {
      hasConnectionTable:
        isJSONObject(first) && first["hasConnectionTable"] === true,
      hasRunTable: isJSONObject(first) && first["hasRunTable"] === true,
    };
  }

  private async moveConnection(data: {
    query: LegacyQuery;
    row: LegacyGoogleSecOpsConnectionRow;
    hasRunTable: boolean;
    migratedAt: Date;
  }): Promise<MovedConnection> {
    const legacyId: string = String(data.row._id);
    const connectionId: ObjectID = new ObjectID(legacyId);

    const existing: SecurityEventConnection | null =
      await SecurityEventConnectionService.findOneById({
        id: connectionId,
        select: { _id: true },
        props: { isRoot: true },
      });

    let outcome: ConnectionOutcome = "already-copied";

    if (!existing) {
      const serviceAccountJson: string | null =
        await this.readServiceAccountJson(data.row);

      if (!serviceAccountJson) {
        // Never create a connection with no key; the legacy row stays as is.
        return {
          outcome: "skipped",
          runCount: 0,
          runHistoryFailedTransiently: false,
        };
      }

      const connection: SecurityEventConnection = buildSecurityEventConnection({
        row: data.row,
        serviceAccountJson,
      });

      await this.warnWhenInvalidToday({
        legacyId,
        connection,
        serviceAccountJson,
      });

      try {
        /*
         * Hooks off: onBeforeCreate re-validates with today's rules, which
         * have tightened since some of these rows were saved, and a
         * rejection here would silently cost the customer a connection
         * that worked. Encryption and required-field checks still run.
         */
        await SecurityEventConnectionService.create({
          data: connection,
          props: { isRoot: true, ignoreHooks: true },
        });
        outcome = "copied";
      } catch (err) {
        // A concurrent runner inserted the same _id first: already copied.
        if (!PostgresErrorTranslator.isUniqueViolation(err)) {
          throw err;
        }
      }
    }

    await data.query(DISABLE_LEGACY_CONNECTION_SQL, [legacyId]);

    let runCount: number = 0;
    let runHistoryFailedTransiently: boolean = false;

    if (data.hasRunTable) {
      try {
        runCount = await this.copyRunHistory({
          query: data.query,
          row: data.row,
          migratedAt: data.migratedAt,
        });
      } catch (err) {
        /*
         * The connection is copied and its legacy row disabled either way,
         * so it counts as moved. A transient failure is handed back so that
         * migrate() throws once every connection has been tried: the retry
         * finds the copy, skips the create, and offers every run again with
         * ON CONFLICT DO NOTHING, so the history it missed goes in and
         * nothing is duplicated. Any other failure would repeat on every
         * retry and hold the whole migration chain for history alone, so it
         * is only logged, and those runs stay in "GoogleSecOpsConnectionRun".
         */
        runHistoryFailedTransiently = isTransientDatabaseError(err);

        logger.error(
          `${this.name}: copied Google SecOps connection ${legacyId}, but not its run history${runHistoryFailedTransiently ? " because of a transient database error; the migration will run again and copy it then" : ""}:`,
        );
        logger.error(err);
      }
    }

    return { outcome, runCount, runHistoryFailedTransiently };
  }

  private async readServiceAccountJson(
    row: LegacyGoogleSecOpsConnectionRow,
  ): Promise<string | null> {
    const legacyId: string = String(row._id);

    if (typeof row.serviceAccountJson !== "string" || !row.serviceAccountJson) {
      logger.error(
        `${this.name}: skipped Google SecOps connection ${legacyId}: it has no stored service account key. It stays in the GoogleSecOpsConnection table; add it again under Security Events > Connections.`,
      );
      return null;
    }

    let decrypted: string = "";

    try {
      decrypted = await Encryption.decrypt(
        unwrapHashedStringEnvelope(row.serviceAccountJson),
      );
    } catch {
      // A wrong ENCRYPTION_SECRET throws "Malformed UTF-8 data" or yields "".
      decrypted = "";
    }

    if (typeof decrypted !== "string" || !decrypted.trim()) {
      logger.error(
        `${this.name}: skipped Google SecOps connection ${legacyId}: its service account key could not be decrypted with this server's ENCRYPTION_SECRET. It stays in the GoogleSecOpsConnection table; add it again under Security Events > Connections.`,
      );
      return null;
    }

    return decrypted;
  }

  /*
   * Copied either way (see the create above); this only tells the operator
   * which connections will fail their polls until someone edits them.
   */
  private async warnWhenInvalidToday(data: {
    legacyId: string;
    connection: SecurityEventConnection;
    serviceAccountJson: string;
  }): Promise<void> {
    try {
      await SecurityEventConnectionServiceClass.validateSettings({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: data.connection.config || {},
        secrets: { serviceAccountJson: data.serviceAccountJson },
        alertingOnly: data.connection.alertingOnly !== false,
        requireRequiredSecrets: true,
      });
    } catch (err) {
      const reason: string = redactLogString(
        err instanceof Error ? err.message : String(err),
      );

      logger.warn(
        `${this.name}: Google SecOps connection ${data.legacyId} was copied, but its saved settings do not pass today's validation, so its polls will fail until the connection is edited: ${reason}`,
      );
    }
  }

  private async copyRunHistory(data: {
    query: LegacyQuery;
    row: LegacyGoogleSecOpsConnectionRow;
    migratedAt: Date;
  }): Promise<number> {
    const legacyId: string = String(data.row._id);

    const runs: unknown = await data.query(LEGACY_RUNS_SQL, [
      legacyId,
      RUN_HISTORY_COPY_LIMIT,
    ]);

    if (!Array.isArray(runs) || runs.length === 0) {
      return 0;
    }

    const legacyRuns: Array<LegacyGoogleSecOpsRunRow> =
      runs as Array<LegacyGoogleSecOpsRunRow>;

    for (
      let start: number = 0;
      start < legacyRuns.length;
      start += RUN_INSERT_BATCH_SIZE
    ) {
      const insert: RunHistoryInsert = buildRunHistoryInsert({
        runs: legacyRuns.slice(start, start + RUN_INSERT_BATCH_SIZE),
        connectionId: legacyId,
        projectId: String(data.row.projectId),
        migratedAt: data.migratedAt,
      });

      await data.query(insert.sql, insert.parameters);
    }

    return legacyRuns.length;
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the legacy rows are still there. Re-enabling them is
     * part of rolling back the release (see the note above), not of this.
     */
    return;
  }
}
