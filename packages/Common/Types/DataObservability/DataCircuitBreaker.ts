import BadDataException from "../Exception/BadDataException";
import { NO_BREAK_SPACE } from "../NoBreakSpaces";
import ObjectID from "../ObjectID";
import { DataAssetFreshness } from "./DataAssetFreshness";

/*
 * A CIRCUIT BREAKER: SHOULD A PIPELINE RUN, GIVEN THE TABLES IT READS? (#6548)
 *
 * When a check fails or a table is late, Data Observability tells its
 * owners - but the pipelines that read that table still run, and copy the
 * bad data downstream. A pipeline step asks first, with a project API key:
 * here are the tables I read (or my name, whose inputs lineage knows) -
 * go, or stop? The answer is the rules Data Observability already keeps,
 * applied to those tables:
 *
 *   - a check of a table that is failing (DataCheckHealth.Failing: its
 *     alert is open, or dbt's test failed) stops it, always;
 *   - a table well past its usual rhythm without a change
 *     (DataAssetFreshness.Late) stops it too, when the pipeline's setting -
 *     or the request - says late tables stop it. Off by default: a late
 *     table may only mean a quiet day.
 *
 * A check that could not run, one still waiting for its first run, and a
 * table with no checks stop nothing: nothing is known against them. Each
 * reason names the table, and the check or how late it is, so the step's
 * log says why. Kept free of the server, so the Dashboard and the tests read
 * the same rule.
 */

export enum DataCircuitBreakerVerdict {
  Go = "go",
  Stop = "stop",
}

export enum DataCircuitBreakerReasonKind {
  CheckFailing = "Check Failing",
  TableLate = "Table Late",
}

// Why the breaker said stop: one failing check, or one late table.
export interface DataCircuitBreakerReason {
  kind: DataCircuitBreakerReasonKind;
  dataAssetId: string;
  // The table's schema.table key.
  table: string;
  // The database it is in, by name; null when that is not known.
  database: string | null;
  // The failing check, by name and id; null for a late table.
  check: string | null;
  dataCheckId: string | null;
  // How long a late table has been late; 0 for a failing check.
  lateBySeconds: number;
}

// A table the breaker judged, as the answer lists it.
export interface DataCircuitBreakerTable {
  dataAssetId: string;
  table: string;
  database: string | null;
  freshness: DataAssetFreshness;
  lateBySeconds: number;
  checkCount: number;
  failingCheckCount: number;
}

// A table as the rule reads it: the server reads these from the records.
export interface DataCircuitBreakerInput {
  dataAssetId: string;
  table: string;
  database: string | null;
  freshness: DataAssetFreshness;
  lateBySeconds: number;
  checkCount: number;
  failingChecks: Array<{ dataCheckId: string; name: string }>;
}

export interface DataCircuitBreakerPipeline {
  dataPipelineId: string;
  name: string;
  namespace: string;
}

export interface DataCircuitBreakerAnswer {
  verdict: DataCircuitBreakerVerdict;
  // Worst first: failing checks, then late tables, the latest first.
  reasons: Array<DataCircuitBreakerReason>;
  // Every table judged, by name.
  tables: Array<DataCircuitBreakerTable>;
  // The names asked for that matched no table its caller may read.
  notFound: Array<string>;
  // Whether a late table stopped the run, as the request or the pipeline said.
  stopsOnLateTables: boolean;
  // The pipeline asked about, when one was named.
  pipeline: DataCircuitBreakerPipeline | null;
  // Whether the answer was kept on the pipeline: a pipeline named, and not a dry run.
  isRecorded: boolean;
  /*
   * Data Observability is switched off on the server: nothing was checked,
   * and the answer is go - switching a product off never stops what runs
   * elsewhere.
   */
  isSwitchedOff: boolean;
  // When it was asked, ISO 8601.
  checkedAt: string;
  // The answer in a few plain sentences, for the step's log.
  answer: string;
}

// What a request asks, read from its body (readDataCircuitBreakerRequest).
export interface DataCircuitBreakerRequest {
  // The pipeline by its ID, its namespace/name, or its name alone.
  pipeline: string | null;
  // Tables by their schema.table key, their name alone, or their ID.
  tables: Array<string>;
  // Whether a late table stops the run; null leaves it to the pipeline's setting.
  stopsOnLateTables: boolean | null;
  // A dry run answers without keeping the answer on the pipeline.
  isDryRun: boolean;
  /*
   * Answer a stop with HTTP 412 (DATA_CIRCUIT_BREAKER_STOP_STATUS_CODE)
   * instead of 200, for a step that reads only the status code: curl -f
   * then fails it.
   */
  failWithStatusCode: boolean;
}

// The status a stop answers with when the request asks for one (failWithStatusCode).
export const DATA_CIRCUIT_BREAKER_STOP_STATUS_CODE: number = 412;

// The most tables one request names, and the most reasons one answer gives.
export const MAX_CIRCUIT_BREAKER_TABLES: number = 50;
export const MAX_CIRCUIT_BREAKER_REASONS: number = 20;

// The longest name of a table or pipeline a request may give.
const MAX_REFERENCE_LENGTH: number = 500;

function readReference(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new BadDataException(
      `Name each ${what} as text: its ID, or its name.`,
    );
  }

  const reference: string = value.trim();

  if (reference.length > MAX_REFERENCE_LENGTH) {
    throw new BadDataException(
      `A ${what} name is at most ${MAX_REFERENCE_LENGTH} characters.`,
    );
  }

  return reference;
}

/*
 * What a request's body asks, or why it cannot be answered: a pipeline, or
 * tables, or both - at least one - each named as text.
 */
export function readDataCircuitBreakerRequest(
  body: unknown,
): DataCircuitBreakerRequest {
  const value: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const pipeline: string | null =
    value["pipeline"] === undefined || value["pipeline"] === null
      ? null
      : readReference(value["pipeline"], "pipeline") || null;

  if (
    value["tables"] !== undefined &&
    value["tables"] !== null &&
    !Array.isArray(value["tables"])
  ) {
    throw new BadDataException(
      "Name the tables as a list: each its schema.table key, its name, or its ID.",
    );
  }

  const tables: Array<string> = [];

  for (const item of (value["tables"] as Array<unknown> | undefined) || []) {
    const reference: string = readReference(item, "table");

    if (reference && !tables.includes(reference)) {
      tables.push(reference);
    }
  }

  if (tables.length > MAX_CIRCUIT_BREAKER_TABLES) {
    throw new BadDataException(
      `Name at most ${MAX_CIRCUIT_BREAKER_TABLES} tables in one request.`,
    );
  }

  if (!pipeline && tables.length === 0) {
    throw new BadDataException(
      "Name the pipeline that is about to run, or the tables it reads.",
    );
  }

  const stopsOnLateTables: unknown = value["stopsOnLateTables"];

  if (
    stopsOnLateTables !== undefined &&
    stopsOnLateTables !== null &&
    typeof stopsOnLateTables !== "boolean"
  ) {
    throw new BadDataException(
      "Send stopsOnLateTables as true or false, or leave it out to use the pipeline's setting.",
    );
  }

  return {
    pipeline,
    tables,
    stopsOnLateTables:
      typeof stopsOnLateTables === "boolean" ? stopsOnLateTables : null,
    isDryRun: value["dryRun"] === true,
    failWithStatusCode: value["failWithStatusCode"] === true,
  };
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

/*
 * THE RULE: go, or stop with every reason. A failing check always stops the
 * run; a late table stops it only when late tables do.
 */
export function decideDataCircuitBreaker(data: {
  tables: Array<DataCircuitBreakerInput>;
  stopsOnLateTables: boolean;
}): {
  verdict: DataCircuitBreakerVerdict;
  reasons: Array<DataCircuitBreakerReason>;
} {
  const failing: Array<DataCircuitBreakerReason> = [];
  const late: Array<DataCircuitBreakerReason> = [];

  for (const table of data.tables) {
    for (const check of table.failingChecks) {
      failing.push({
        kind: DataCircuitBreakerReasonKind.CheckFailing,
        dataAssetId: table.dataAssetId,
        table: table.table,
        database: table.database,
        check: check.name,
        dataCheckId: check.dataCheckId,
        lateBySeconds: 0,
      });
    }

    if (data.stopsOnLateTables && table.freshness === DataAssetFreshness.Late) {
      late.push({
        kind: DataCircuitBreakerReasonKind.TableLate,
        dataAssetId: table.dataAssetId,
        table: table.table,
        database: table.database,
        check: null,
        dataCheckId: null,
        lateBySeconds: Math.max(0, Math.floor(table.lateBySeconds)),
      });
    }
  }

  failing.sort((a: DataCircuitBreakerReason, b: DataCircuitBreakerReason) => {
    return byName(a.table, b.table) || byName(a.check || "", b.check || "");
  });
  late.sort((a: DataCircuitBreakerReason, b: DataCircuitBreakerReason) => {
    return b.lateBySeconds - a.lateBySeconds || byName(a.table, b.table);
  });

  const reasons: Array<DataCircuitBreakerReason> = [...failing, ...late].slice(
    0,
    MAX_CIRCUIT_BREAKER_REASONS,
  );

  return {
    verdict:
      reasons.length > 0
        ? DataCircuitBreakerVerdict.Stop
        : DataCircuitBreakerVerdict.Go,
    reasons,
  };
}

/*
 * "12 minutes", "6 hours", "3 days": how late, as a sentence says it. The
 * figure is held to its word with a no-break space, so the stop's line in
 * Needs Attention never ends with "12" and starts the next with "minutes".
 */
export function describeLateness(seconds: number): string {
  const minutes: number = Math.max(1, Math.round(seconds / 60));

  if (minutes < 60) {
    return minutes === 1
      ? `1${NO_BREAK_SPACE}minute`
      : `${minutes}${NO_BREAK_SPACE}minutes`;
  }

  const hours: number = Math.round(minutes / 60);

  if (hours < 48) {
    return hours === 1
      ? `1${NO_BREAK_SPACE}hour`
      : `${hours}${NO_BREAK_SPACE}hours`;
  }

  return `${Math.round(hours / 24)}${NO_BREAK_SPACE}days`;
}

// One reason as a sentence: "The check orders_not_null is failing on public.orders."
export function describeDataCircuitBreakerReason(
  reason: DataCircuitBreakerReason,
): string {
  const table: string = reason.database
    ? `${reason.table} (${reason.database})`
    : reason.table;

  if (reason.kind === DataCircuitBreakerReasonKind.CheckFailing) {
    return `The check ${reason.check || "of it"} is failing on ${table}.`;
  }

  return `${table} is late by ${describeLateness(reason.lateBySeconds)}.`;
}

/*
 * The answer in a few plain sentences, for the step's log: the verdict
 * first, then why, then what it could not find.
 */
export function formatDataCircuitBreakerAnswer(
  answer: Pick<
    DataCircuitBreakerAnswer,
    | "verdict"
    | "reasons"
    | "tables"
    | "notFound"
    | "pipeline"
    | "stopsOnLateTables"
    | "isSwitchedOff"
  >,
): string {
  const name: string = answer.pipeline ? answer.pipeline.name : "the pipeline";
  const lines: Array<string> = [];

  if (answer.isSwitchedOff) {
    return "Go: Data Observability is switched off on this server, so nothing was checked.";
  }

  if (answer.verdict === DataCircuitBreakerVerdict.Stop) {
    lines.push(`Stop: ${name} should not run.`);
    lines.push(...answer.reasons.map(describeDataCircuitBreakerReason));
  } else if (answer.tables.length === 0) {
    lines.push(
      `Go: ${name} may run, but OneUptime knows none of the tables it reads yet, so nothing was checked.`,
    );
  } else if (answer.tables.length === 1) {
    lines.push(
      answer.stopsOnLateTables
        ? `Go: ${name} may run. The table it reads, ${answer.tables[0]!.table}, has no failing check and is not late.`
        : `Go: ${name} may run. The table it reads, ${answer.tables[0]!.table}, has no failing check.`,
    );
  } else {
    lines.push(
      answer.stopsOnLateTables
        ? `Go: ${name} may run. None of the ${answer.tables.length} tables it reads has a failing check or is late.`
        : `Go: ${name} may run. None of the ${answer.tables.length} tables it reads has a failing check.`,
    );
  }

  if (answer.notFound.length > 0) {
    lines.push(
      `Not found, so not checked: ${answer.notFound.join(", ")}. Check each name, and that the API key may read the table.`,
    );
  }

  return lines.join(" ");
}

/*
 * The reasons a pipeline keeps, read back whatever the column holds: each
 * one a reason with its table, anything else left out.
 */
export function readDataCircuitBreakerReasons(
  value: unknown,
): Array<DataCircuitBreakerReason> {
  if (!Array.isArray(value)) {
    return [];
  }

  const reasons: Array<DataCircuitBreakerReason> = [];

  for (const item of value as Array<unknown>) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const reason: Record<string, unknown> = item as Record<string, unknown>;
    const kind: unknown = reason["kind"];
    const dataAssetId: unknown = reason["dataAssetId"];

    if (
      !(Object.values(DataCircuitBreakerReasonKind) as Array<unknown>).includes(
        kind,
      ) ||
      typeof dataAssetId !== "string" ||
      !ObjectID.isValidUUID(dataAssetId) ||
      typeof reason["table"] !== "string"
    ) {
      continue;
    }

    const lateBySeconds: number = Number(reason["lateBySeconds"]);

    reasons.push({
      kind: kind as DataCircuitBreakerReasonKind,
      dataAssetId,
      table: reason["table"] as string,
      database:
        typeof reason["database"] === "string" ? reason["database"] : null,
      check: typeof reason["check"] === "string" ? reason["check"] : null,
      dataCheckId:
        typeof reason["dataCheckId"] === "string" &&
        ObjectID.isValidUUID(reason["dataCheckId"])
          ? reason["dataCheckId"]
          : null,
      lateBySeconds:
        Number.isFinite(lateBySeconds) && lateBySeconds > 0
          ? Math.floor(lateBySeconds)
          : 0,
    });

    if (reasons.length >= MAX_CIRCUIT_BREAKER_REASONS) {
      break;
    }
  }

  return reasons;
}
