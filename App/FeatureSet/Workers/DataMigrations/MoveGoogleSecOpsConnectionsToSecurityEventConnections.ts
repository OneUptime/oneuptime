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
 * A queued or running legacy run has lost its worker job: the handler for
 * "SecurityEvents:RunGoogleSecOpsConnection" is gone. Copied as active, it
 * would block admission for its connection until the twenty-minute stale
 * sweep failed it with an error blaming worker health.
 */
export const INTERRUPTED_RUN_ERROR: string =
  "Interrupted when Google SecOps moved to Security Event Connections. Run it again.";

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

type ConnectionOutcome = "copied" | "already-copied" | "skipped";

interface MovedConnection {
  outcome: ConnectionOutcome;
  runCount: number;
}

interface MoveTally {
  copied: number;
  alreadyCopied: number;
  skipped: number;
  failed: number;
  runs: number;
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
 * One connection that cannot be moved never stops the others, and migrate()
 * never throws, so no later migration is held back. A connection that could
 * not be moved stays untouched in the legacy table and is named in the log.
 */
export default class MoveGoogleSecOpsConnectionsToSecurityEventConnections extends DataMigrationBase {
  public constructor() {
    super("MoveGoogleSecOpsConnectionsToSecurityEventConnections");
  }

  public override async migrate(): Promise<void> {
    try {
      await this.moveConnections();
    } catch (err) {
      /*
       * Only the table probe and the connection read reach here; every
       * connection has its own catch. The legacy rows are untouched, and
       * the migration is idempotent, so it can be run again.
       */
      logger.error(
        `${this.name}: could not read the Google SecOps connections to move. They are untouched in the GoogleSecOpsConnection table:`,
      );
      logger.error(err);
    }
  }

  private async moveConnections(): Promise<void> {
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
      return;
    }

    const rows: unknown = await query(LEGACY_CONNECTIONS_SQL);

    if (!Array.isArray(rows) || rows.length === 0) {
      return;
    }

    const migratedAt: Date = OneUptimeDate.getCurrentDate();
    const tally: MoveTally = {
      copied: 0,
      alreadyCopied: 0,
      skipped: 0,
      failed: 0,
      runs: 0,
    };

    for (const row of rows as Array<LegacyGoogleSecOpsConnectionRow>) {
      try {
        const moved: MovedConnection = await this.moveConnection({
          query,
          row,
          hasRunTable: tables.hasRunTable,
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
      } catch (err) {
        tally.failed++;
        logger.error(
          `${this.name}: could not move Google SecOps connection ${String(row._id)}; it stays in the GoogleSecOpsConnection table:`,
        );
        logger.error(err);
      }
    }

    logger.info(
      `${this.name}: ${tally.copied} Google SecOps connection(s) copied to Security Event Connections, ${tally.alreadyCopied} already copied, ${tally.skipped} skipped because no usable service account key could be read, ${tally.failed} failed. ${tally.runs} run(s) of history carried over (at most the ${RUN_HISTORY_COPY_LIMIT} most recent per connection).`,
    );
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
        return { outcome: "skipped", runCount: 0 };
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

    if (data.hasRunTable) {
      try {
        runCount = await this.copyRunHistory({
          query: data.query,
          row: data.row,
          migratedAt: data.migratedAt,
        });
      } catch (err) {
        logger.error(
          `${this.name}: copied Google SecOps connection ${legacyId}, but not its run history:`,
        );
        logger.error(err);
      }
    }

    return { outcome, runCount };
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
