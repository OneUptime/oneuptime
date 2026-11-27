import {
  DataCheckType,
  MAX_ACCEPTED_VALUES,
} from "../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";

/*
 * A DATABASE READ FOR DATA OBSERVABILITY BY THE DATABASE AGENT BESIDE IT
 * (#11148).
 *
 * The probe arrangement (Server/Utils/DataObservability/
 * DataObservabilityProbeCollect), for the agent a customer already runs next
 * to a database server - the resource AI agent of agents/DatabaseAgent -
 * with one difference that decides everything else: the server sends the
 * agent WHAT to read, never HOW. Every few minutes:
 *
 *   POST /resource-ai-agent-ingest/data-observability/work
 *       the databases of this agent's server that are due, claimed so no
 *       other poll gets them: which database, the limits, the exclusions,
 *       and each due check as its type and the names it reads - never a
 *       statement, never a credential;
 *   POST /resource-ai-agent-ingest/data-observability/result
 *       what one collection read (the table health snapshot the probe and
 *       the workers report: catalog facts and each check's number, never a
 *       row), or why it could not run.
 *
 * The agent builds every statement itself, from the query shapes in
 * DatabaseAgentStatements, which is copied byte for byte into
 * agents/ResourceAIAgent/Common - so what it may run is decided on the
 * agent, by the agent's own copy, whatever the server sends. A name a check
 * reads is checked against the catalog the agent has just read, and the
 * values a check compares with are bound parameters. Custom SQL, the one
 * shape a person writes, runs only where the agent's owner turned it on in
 * the agent's own environment. Reads only, in read-only transactions with
 * time limits, with the logins of the agent's own environment.
 *
 * This file is that conversation's contract, read strictly on both sides.
 * It imports nothing the agent does not copy.
 */

export const DATABASE_AGENT_WORK_ROUTE: string = "/data-observability/work";
export const DATABASE_AGENT_RESULT_ROUTE: string = "/data-observability/result";

/*
 * The version of this conversation an agent speaks, reported in its posture:
 * a server hands work only to an agent that speaks it.
 */
export const DATABASE_AGENT_WORK_VERSION: number = 1;

// The engines a Database Agent reads for Data Observability, by its drivers.
export type DatabaseAgentEngine = "postgresql" | "mysql";

export const DATABASE_AGENT_ENGINES: ReadonlyArray<DatabaseAgentEngine> = [
  "postgresql",
  "mysql",
];

export function isDatabaseAgentEngine(
  value: unknown,
): value is DatabaseAgentEngine {
  return (
    typeof value === "string" &&
    (DATABASE_AGENT_ENGINES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * The engine a database system's name is read with: a fork reads as its
 * family (MariaDB as MySQL), and anything else is no engine the agent
 * reads for Data Observability yet.
 */
export function getDatabaseAgentEngineOfSystem(
  system: string | null | undefined,
): DatabaseAgentEngine | null {
  switch ((system || "").trim().toLowerCase()) {
    case "postgresql":
    case "postgres":
      return "postgresql";
    case "mysql":
    case "mariadb":
      return "mysql";
    default:
      return null;
  }
}

// How often an agent asks for work, and how many databases one answer hands it.
export const DATABASE_AGENT_POLL_INTERVAL_IN_MS: number = 60_000;
export const DATABASE_AGENT_STORES_PER_POLL: number = 5;

// The most a collection reads: the same limits a probe's and a worker's have.
export const DATABASE_AGENT_MAX_TABLES: number = 5_000;
export const DATABASE_AGENT_MAX_COLUMNS: number = 200_000;
export const DATABASE_AGENT_MAX_CHECKS: number = 50;
export const DATABASE_AGENT_MAX_FRESHNESS_READS: number = 50;
export const DATABASE_AGENT_MAX_EXCLUSIONS: number = 200;
export const DATABASE_AGENT_MAX_LINEAGE_EDGES: number = 5_000;

// The longest name a check reads, the longest value it compares with, and the longest query.
export const DATABASE_AGENT_MAX_IDENTIFIER_LENGTH: number = 240;
export const DATABASE_AGENT_MAX_VALUE_LENGTH: number = 500;
export const DATABASE_AGENT_MAX_PATTERN_LENGTH: number = 500;
export const DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH: number = 10_000;

// The longest database name: PostgreSQL's is 63 bytes, MySQL's 64 characters.
export const DATABASE_AGENT_MAX_DATABASE_NAME_LENGTH: number = 64;

// The longest error a report carries, and the most warnings.
export const DATABASE_AGENT_MAX_ERROR_LENGTH: number = 1_000;
export const DATABASE_AGENT_MAX_WARNINGS: number = 20;
export const DATABASE_AGENT_MAX_WARNING_LENGTH: number = 300;

// A character no name holds: control characters, NUL among them.
function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * A database's name as an agent connects to it: a name, never a path, a URL
 * or anything with a control character in it. It is handed to the driver as
 * the database to connect to, never written into a statement.
 */
export function isDatabaseAgentDatabaseName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DATABASE_AGENT_MAX_DATABASE_NAME_LENGTH &&
    value.trim() === value &&
    !hasControlCharacter(value) &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

// A name a check reads: a table, a column or a schema, as the catalog names it.
export function isDatabaseAgentIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DATABASE_AGENT_MAX_IDENTIFIER_LENGTH &&
    !hasControlCharacter(value)
  );
}

/*
 * One due check, as the server names it: its type and the names it reads,
 * with the values it compares with. Never a statement: the agent builds the
 * one it runs (DatabaseAgentStatements.buildDatabaseAgentCheckStatement).
 */
export interface DatabaseAgentCheck {
  checkId: string;
  type: DataCheckType;
  // The table it reads: its schema ("" where the engine has none) and name.
  schemaName: string;
  tableName: string;
  columnName: string | null;
  // The column it reads one value per, when it has a segment.
  segmentColumn: string | null;
  acceptedValues: Array<string> | null;
  pattern: string | null;
  // The table and column an Orphan Count check's values refer to.
  referenceSchemaName: string | null;
  referenceTableName: string | null;
  referenceColumnName: string | null;
  /*
   * A Custom SQL or Failing Rows check's own query, as the person wrote it.
   * The agent runs it only when its owner turned that on locally.
   */
  customSql: string | null;
  // Read this percent of the rows instead of all of them, where the type allows.
  samplePercent: number | null;
}

// A table whose change time comes from a column of its own: its newest value.
export interface DatabaseAgentFreshnessRead {
  // "schema.table", as the server keys the table.
  tableKey: string;
  schemaName: string;
  tableName: string;
  columnName: string;
}

// One database to collect, as the agent is handed it.
export interface DatabaseAgentWork {
  dataStoreId: string;
  engine: DatabaseAgentEngine;
  // The database on the agent's server to read.
  databaseName: string;
  maxTables: number;
  maxColumns: number;
  // "schema", "schema.table" or "table": the store's exclusions, never read.
  exclusions: Array<string>;
  checks: Array<DatabaseAgentCheck>;
  freshnessReads: Array<DatabaseAgentFreshnessRead>;
  // Leave the checks for the next collection when the database is busy.
  waitWhenBusy: boolean;
  // Read which views select from which tables: once an hour.
  readsViewLineage: boolean;
}

function readIdentifierOrNull(value: unknown): string | null {
  return isDatabaseAgentIdentifier(value) ? value : null;
}

function readSchemaName(value: unknown): string | null {
  // MySQL's tables have no schema of their own beyond the database.
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  return isDatabaseAgentIdentifier(value) ? value : null;
}

function boundedWholeNumber(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const number: number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(number), max);
}

// The checks a person adds and OneUptime runs: every type but dbt's, whose tests dbt runs.
function isRunnableCheckType(value: unknown): value is DataCheckType {
  return (
    typeof value === "string" &&
    value !== DataCheckType.DbtTest &&
    (Object.values(DataCheckType) as Array<string>).includes(value)
  );
}

/*
 * One check of a work item, read strictly: anything malformed is not a
 * check. What a well-formed check may read is decided later, against the
 * catalog (getDatabaseAgentCheckRefusal).
 */
export function readDatabaseAgentCheck(
  value: unknown,
): DatabaseAgentCheck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: Record<string, unknown> = value as Record<string, unknown>;
  const checkId: unknown = item["checkId"];
  const type: unknown = item["type"];
  const schemaName: string | null = readSchemaName(item["schemaName"]);
  const tableName: unknown = item["tableName"];

  if (
    typeof checkId !== "string" ||
    !UUID.test(checkId) ||
    !isRunnableCheckType(type) ||
    schemaName === null ||
    !isDatabaseAgentIdentifier(tableName)
  ) {
    return null;
  }

  const acceptedValues: unknown = item["acceptedValues"];
  const pattern: unknown = item["pattern"];
  const customSql: unknown = item["customSql"];
  const samplePercent: number = Number(item["samplePercent"]);

  if (
    acceptedValues !== null &&
    acceptedValues !== undefined &&
    (!Array.isArray(acceptedValues) ||
      acceptedValues.length > MAX_ACCEPTED_VALUES ||
      !acceptedValues.every((entry: unknown): boolean => {
        return (
          typeof entry === "string" &&
          entry.length <= DATABASE_AGENT_MAX_VALUE_LENGTH
        );
      }))
  ) {
    return null;
  }

  if (
    pattern !== null &&
    pattern !== undefined &&
    (typeof pattern !== "string" ||
      pattern.length > DATABASE_AGENT_MAX_PATTERN_LENGTH)
  ) {
    return null;
  }

  if (
    customSql !== null &&
    customSql !== undefined &&
    (typeof customSql !== "string" ||
      customSql.length > DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH)
  ) {
    return null;
  }

  const referenceSchemaName: string | null =
    item["referenceTableName"] === null ||
    item["referenceTableName"] === undefined
      ? null
      : readSchemaName(item["referenceSchemaName"]);

  return {
    checkId,
    type,
    schemaName,
    tableName,
    columnName: readIdentifierOrNull(item["columnName"]),
    segmentColumn: readIdentifierOrNull(item["segmentColumn"]),
    acceptedValues: Array.isArray(acceptedValues)
      ? (acceptedValues as Array<string>)
      : null,
    pattern: typeof pattern === "string" && pattern ? pattern : null,
    referenceSchemaName,
    referenceTableName: readIdentifierOrNull(item["referenceTableName"]),
    referenceColumnName: readIdentifierOrNull(item["referenceColumnName"]),
    customSql: typeof customSql === "string" && customSql ? customSql : null,
    samplePercent:
      Number.isFinite(samplePercent) && samplePercent > 0 && samplePercent < 100
        ? samplePercent
        : null,
  };
}

export function readDatabaseAgentFreshnessRead(
  value: unknown,
): DatabaseAgentFreshnessRead | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: Record<string, unknown> = value as Record<string, unknown>;
  const tableKey: unknown = item["tableKey"];
  const schemaName: string | null = readSchemaName(item["schemaName"]);

  if (
    typeof tableKey !== "string" ||
    !tableKey ||
    tableKey.length > 2 * DATABASE_AGENT_MAX_IDENTIFIER_LENGTH + 1 ||
    schemaName === null ||
    !isDatabaseAgentIdentifier(item["tableName"]) ||
    !isDatabaseAgentIdentifier(item["columnName"])
  ) {
    return null;
  }

  return {
    tableKey,
    schemaName,
    tableName: item["tableName"] as string,
    columnName: item["columnName"] as string,
  };
}

/*
 * A work item from the server, read strictly: anything malformed is not
 * work, and every list and number is held to this agent's own limits.
 */
export function readDatabaseAgentWork(
  value: unknown,
): DatabaseAgentWork | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: Record<string, unknown> = value as Record<string, unknown>;
  const dataStoreId: unknown = item["dataStoreId"];
  const engine: unknown = item["engine"];
  const databaseName: unknown = item["databaseName"];

  if (
    typeof dataStoreId !== "string" ||
    !UUID.test(dataStoreId) ||
    !isDatabaseAgentEngine(engine) ||
    !isDatabaseAgentDatabaseName(databaseName)
  ) {
    return null;
  }

  const checks: Array<DatabaseAgentCheck> = [];

  for (const raw of Array.isArray(item["checks"])
    ? (item["checks"] as Array<unknown>).slice(0, DATABASE_AGENT_MAX_CHECKS)
    : []) {
    const check: DatabaseAgentCheck | null = readDatabaseAgentCheck(raw);

    if (check) {
      checks.push(check);
    }
  }

  const freshnessReads: Array<DatabaseAgentFreshnessRead> = [];

  for (const raw of Array.isArray(item["freshnessReads"])
    ? (item["freshnessReads"] as Array<unknown>).slice(
        0,
        DATABASE_AGENT_MAX_FRESHNESS_READS,
      )
    : []) {
    const read: DatabaseAgentFreshnessRead | null =
      readDatabaseAgentFreshnessRead(raw);

    if (read) {
      freshnessReads.push(read);
    }
  }

  return {
    dataStoreId,
    engine,
    databaseName,
    maxTables: boundedWholeNumber(
      item["maxTables"],
      DATABASE_AGENT_MAX_TABLES,
      DATABASE_AGENT_MAX_TABLES,
    ),
    maxColumns: boundedWholeNumber(
      item["maxColumns"],
      DATABASE_AGENT_MAX_COLUMNS,
      DATABASE_AGENT_MAX_COLUMNS,
    ),
    exclusions: Array.isArray(item["exclusions"])
      ? (item["exclusions"] as Array<unknown>)
          .filter((exclusion: unknown): exclusion is string => {
            return (
              typeof exclusion === "string" &&
              exclusion.length <= 2 * DATABASE_AGENT_MAX_IDENTIFIER_LENGTH + 1
            );
          })
          .slice(0, DATABASE_AGENT_MAX_EXCLUSIONS)
      : [],
    checks,
    freshnessReads,
    waitWhenBusy: item["waitWhenBusy"] === true,
    readsViewLineage: item["readsViewLineage"] === true,
  };
}

// Every work item of a work answer, the malformed ones left out.
export function readDatabaseAgentWorkList(
  body: unknown,
): Array<DatabaseAgentWork> {
  const stores: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)["stores"]
      : null;

  if (!Array.isArray(stores)) {
    return [];
  }

  const work: Array<DatabaseAgentWork> = [];

  for (const raw of stores.slice(0, DATABASE_AGENT_STORES_PER_POLL)) {
    const item: DatabaseAgentWork | null = readDatabaseAgentWork(raw);

    if (item) {
      work.push(item);
    }
  }

  return work;
}

/*
 * WHAT A COLLECTION REPORTS: the shape of the table health snapshot the
 * server reads from a probe (readTableHealthSnapshot), written here so the
 * agent builds it without the server's code. Catalog facts and numbers,
 * never a row, never a credential.
 */
export interface DatabaseAgentColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  position: number;
}

export interface DatabaseAgentTable {
  schema: string;
  name: string;
  kind: DataAssetKind;
  estimatedRows: number | null;
  sizeInBytes: number | null;
  writeCount: number | null;
  secondsSinceChange: number | null;
  readCount: number | null;
  secondsSinceRead: number | null;
  // Null when the collection could not read all of them (the column list was cut).
  columns: Array<DatabaseAgentColumn> | null;
  // True when secondsSinceChange came from the table's freshness column.
  isChangeTimeFromData?: boolean | undefined;
}

export interface DatabaseAgentLineageEdge {
  source: "View Definition";
  upstreamDatabase: null;
  upstreamSchema: string;
  upstreamTable: string;
  downstreamSchema: string;
  downstreamTable: string;
  secondsSinceSeen: null;
  seenBy: null;
}

export interface DatabaseAgentCheckValue {
  // The segment column's value as text; null for an unsegmented check.
  segment: string | null;
  value: number;
}

export interface DatabaseAgentCheckResult {
  checkId: string;
  values: Array<DatabaseAgentCheckValue>;
  // Why the check did not run: refused on the agent, or the database's error.
  error: string | null;
}

export interface DatabaseAgentSnapshot {
  engine: DatabaseAgentEngine;
  collectedAt: string;
  tables: Array<DatabaseAgentTable>;
  // False when the table list was cut at its limit, so absence proves nothing.
  isComplete: boolean;
  warnings: Array<string>;
  secondsSinceStatsReset: number | null;
  // The database read: its name, host and port. Never a login.
  target: {
    databaseName: string | null;
    host: string | null;
    port: number | null;
  };
  // Set when checks were due and the database was not too busy for them.
  checkResults?: Array<DatabaseAgentCheckResult> | undefined;
  // Set when view lineage was read this time.
  lineage?: Array<DatabaseAgentLineageEdge> | undefined;
  isViewLineageComplete?: boolean | undefined;
}

export interface DatabaseAgentReport {
  dataStoreId: string;
  startedAt: string;
  snapshot?: DatabaseAgentSnapshot | undefined;
  error?: string | undefined;
}

/*
 * WHAT AN AGENT SAYS OF ITSELF, IN ITS POSTURE: whether its owner turned
 * Data Observability on (ONEUPTIME_DATA_OBSERVABILITY), whether it runs the
 * project's checks and Custom SQL, and which version of this conversation
 * it speaks. The server hands work only to an agent that is on and speaks
 * it; a database's page says what stands in the way otherwise.
 */
export interface DatabaseAgentDataObservabilityPosture {
  isOn: boolean;
  // ONEUPTIME_DATA_OBSERVABILITY as set, for "set X=true" messages.
  setting: string | null;
  // Why it is off though it was asked to be on, in the agent's words.
  offReason: string | null;
  // The engine it reads for Data Observability, when it reads one.
  engine: DatabaseAgentEngine | null;
  runsChecks: boolean;
  runsCustomSql: boolean;
  workVersion: number;
}

const MAX_POSTURE_TEXT_LENGTH: number = 256;

function readPostureText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim().slice(0, MAX_POSTURE_TEXT_LENGTH);
}

/*
 * Read from an agent's posture strictly, failing closed: on only for the
 * boolean true with a version spoken, Custom SQL only for the boolean true.
 * Null when the agent says nothing of Data Observability: one older than it.
 */
export function readDatabaseAgentDataObservabilityPosture(
  value: unknown,
): DatabaseAgentDataObservabilityPosture | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const workVersion: number = Number(raw["workVersion"]);
  const engine: unknown = raw["engine"];

  if (!Number.isInteger(workVersion) || workVersion <= 0) {
    return null;
  }

  return {
    isOn: raw["isOn"] === true,
    setting: readPostureText(raw["setting"]),
    offReason: readPostureText(raw["offReason"]),
    engine: isDatabaseAgentEngine(engine) ? engine : null,
    runsChecks: raw["runsChecks"] === true,
    runsCustomSql: raw["runsCustomSql"] === true,
    workVersion,
  };
}
