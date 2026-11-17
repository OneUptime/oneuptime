import DataMigration from "../../../Models/DatabaseModels/DataMigration";
import BadDataException from "../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import {
  EVIDENCE_SCOPE_FIELD,
  EVIDENCE_TRUNCATED_FIELD,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
} from "../../../Utils/Monitor/StoredCheckEvidence";
import GlobalCache from "../../Infrastructure/GlobalCache";
import DataMigrationService from "../../Services/DataMigrationService";
import EventLoop from "../EventLoop";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";
import {
  STORED_LOG_COLUMNS,
  StoredLogScreenshotsStatement,
  StoredLogTable,
  buildPageCandidatesStatement,
  buildPageEndStatement,
} from "./StoredLogScreenshots";
import { QueryRunner } from "typeorm";

/*
 * TRIMMING THE OVERSIZED CHECKS STORED BEFORE THEY WERE BOUNDED (OneUptime
 * issue #9232, a follow-up of #9189).
 *
 * A Metrics monitor grouped by attributes opens one alert or incident per
 * series, and each of them used to keep the whole evaluation - every series
 * of every query - as the check that opened it: 95 MB of JSON a row (12 MB
 * as stored) at 16,000 series, on the record and again on each of its state
 * timeline rows. Rows written now keep their own series only and never pass
 * STORED_CHECK_MAX_SIZE_IN_BYTES (MonitorStoredCheck, #9189). This trims the
 * rows written before, for the Workers job Monitor:TrimOversizedStoredChecks,
 * in
 *
 *   - AlertStateTimeline.stateChangeLog, Alert.createdStateLog,
 *   - IncidentStateTimeline.stateChangeLog, Incident.createdStateLog,
 *   - MonitorStatusTimeline.statusChangeLog.
 *
 * WHAT A TRIMMED ROW KEEPS
 *
 * What a row written today keeps, as near as SQL can make it:
 *
 *   - Every top-level field but the series lists (SERIES_LIST_FIELDS) and
 *     the points (POINTS_FIELDS): the evaluation summary, the status, the
 *     dates and ids. That is what the dashboard reads of an old record's
 *     check (MonitorSummarySnapshotUtil.fromLegacyCreatedStateLog).
 *   - For a record about one series (its seriesFingerprint - the record's
 *     own for an alert or an incident, its alert's or its incident's for a
 *     state timeline row): that series' entry of each series list, its
 *     points in metricResult (its aggregatedResults), its arrivals, and
 *     evidenceScope - as MonitorStoredCheck.scopeToSeries does. A series
 *     the evaluation did not have keeps an empty list.
 *   - For any other row: no series list and no points.
 *   - isEvidenceTruncated: true, so View Logs says the check was trimmed
 *     (TrimmedLogNote), and TRIMMED_BY_CLEANUP_FIELD: what was removed and
 *     why.
 *
 * A result still past the limit (a huge response body, say) keeps only its
 * top-level fields of SMALL_FIELD_MAX_BYTES or less, and no series; one
 * still past it keeps the markers alone. So no trimmed row passes the limit.
 *
 * Only that column of that row is written: not "updatedAt", not "version" -
 * trimming storage is no change anyone made - and no hook, workflow or
 * notification runs. Deleted rows are trimmed too: they take the space all
 * the same.
 *
 * HOW, WITHOUT READING 95 MB INTO NODE
 *
 * Each table is walked once, in "_id" order, a page of SCAN_PAGE_SIZE rows
 * at a time, as StoredLogScreenshots walks them (the same page statements):
 * one read finds where the page ends, from the primary key alone, a second
 * the page's rows whose check is stored at CANDIDATE_MIN_STORED_BYTES or
 * more. That size is pg_column_size, which reads the size from the TOAST
 * pointer in the row: measured on a 55 MB check (4 MB stored),
 * pg_column_size takes 0.5 ms and octet_length(log::text) 250 ms, as it
 * decompresses and prints the whole value. JSON is never smaller than what
 * Postgres stores of it, so a check stored at 256 KB or more is past the
 * limit; a check past the limit but stored under it - one that compresses
 * well - is left as it is, which costs the walk nothing and the disk little.
 *
 * Each candidate is trimmed by one UPDATE of its own (buildTrimStatement),
 * in Postgres: the check is never read into Node. Postgres decompresses it
 * in the backend that runs the statement, once for each part the statement
 * takes from it, and writes the small result back: 255 ms, transaction
 * included, for a check of 16,158 series (35 MB of JSON, 5 MB stored), in
 * OversizedStoredChecksPostgres. Each UPDATE runs in a transaction of its own with
 * TRIM_STATEMENT_TIMEOUT_MS and TRIM_LOCK_TIMEOUT_MS set on it (SET LOCAL),
 * holds one row's lock for as long as it takes, and commits. Its WHERE
 * checks the stored size again, so a row trimmed since - by an earlier run,
 * another server - is not written twice.
 *
 * A check Postgres cannot trim within its statement timeout, or without
 * running out of memory, is replaced by the markers alone
 * (buildMarkersOnlyStatement), which reads none of it: the walk never
 * stalls on one row. A row that fails otherwise - a lock it waited too long
 * for, a lost connection - is logged, and the walk stops there for the run:
 * the next run starts at that row, so a table is never marked done past a
 * row it could not trim.
 *
 * Where a table's walk got to is kept in the cache (GlobalCache) between
 * runs. If it is lost the walk starts over, which only costs time: a row
 * trimmed once is stored far under the threshold and is not read again. A
 * walk that reaches the end of its table records it as done, as a row of
 * the DataMigrations table named TrimOversizedStoredChecks:<table> - the
 * data migration runner reads only the names of its own migrations - and
 * the table is never walked again: a row written since is bounded. Once
 * every table is done, a run is one read of those rows. During a rolling
 * upgrade, a server still on an older release can write an oversized row
 * after the walk passed it; that row stays as it is.
 *
 * HOW MUCH, HOW OFTEN
 *
 * Hourly. A run stops starting work once TRIM_TIME_BUDGET_MS is spent, with
 * where it got to kept, and works the tables in turn: the biggest the
 * report of #9189 measured first. Between two rows it yields to the event
 * loop, and it trims one row at a time: one Postgres backend, one row's
 * memory. A trim frees the old check's TOAST chunks, which Postgres logs
 * (WAL) as it would a delete of as much data; the budget bounds how much of
 * that one run writes. PostgreSQL reuses the space trimmed checks leave,
 * but does not give it back to the disk: a self-hosted install that wants
 * the disk back runs VACUUM FULL or pg_repack on the tables afterwards (the
 * Metrics monitor docs say how).
 */

export type OversizedStoredChecksQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

/*
 * Runs one statement in a transaction of its own, with a statement timeout
 * and a lock timeout set on that transaction alone.
 */
export type OversizedStoredChecksStatementRunner = (data: {
  sql: string;
  params: Array<unknown>;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}) => Promise<Array<Record<string, unknown>>>;

// The order a run walks the tables in: the biggest first, as #9189 measured.
export const OVERSIZED_CHECK_TABLES: ReadonlyArray<StoredLogTable> = [
  StoredLogTable.AlertStateTimeline,
  StoredLogTable.Alert,
  StoredLogTable.IncidentStateTimeline,
  StoredLogTable.Incident,
  StoredLogTable.MonitorStatusTimeline,
];

/*
 * Where each table's row finds the series it is about: the record's own
 * seriesFingerprint, or its alert's or its incident's. A monitor status
 * change is about the whole monitor. Fixed here, never taken from a caller.
 */
export interface SeriesFingerprintSource {
  // The table holding seriesFingerprint: the row's own, or the one joined.
  recordTable: "Alert" | "Incident";
  // The row's column naming that record; none when it is the row itself.
  recordIdColumn?: "alertId" | "incidentId" | undefined;
}

export const SERIES_FINGERPRINT_SOURCES: Record<
  StoredLogTable,
  SeriesFingerprintSource | null
> = {
  [StoredLogTable.AlertStateTimeline]: {
    recordTable: "Alert",
    recordIdColumn: "alertId",
  },
  [StoredLogTable.Alert]: { recordTable: "Alert" },
  [StoredLogTable.IncidentStateTimeline]: {
    recordTable: "Incident",
    recordIdColumn: "incidentId",
  },
  [StoredLogTable.Incident]: { recordTable: "Incident" },
  [StoredLogTable.MonitorStatusTimeline]: null,
};

/*
 * The lists of a check that hold one entry per series or group, in the
 * order the first one present counts the series (MonitorStoredCheck).
 */
export const SERIES_LIST_FIELDS: ReadonlyArray<string> = [
  "seriesBreakdown",
  "groupBreakdown",
  "resolvedGroups",
];

// A metric check's points: every series' of each query and formula.
export const POINTS_FIELDS: ReadonlyArray<string> = [
  "metricResult",
  "metricResultArrivals",
];

// Says how the row was trimmed, beside isEvidenceTruncated.
export const TRIMMED_BY_CLEANUP_FIELD: string = "evidenceTrimmedByCleanup";

export const TRIMMED_BY_CLEANUP_NOTE: string =
  "This check was stored before stored checks were limited in size, and was trimmed afterwards: it kept the series this record is about, if any, and the evaluation's other fields, not every series of the evaluation.";

// The stored size from which a check is trimmed: see HOW above.
export const CANDIDATE_MIN_STORED_BYTES: number =
  STORED_CHECK_MAX_SIZE_IN_BYTES;

// The most a trimmed check's JSON may take: what a check stored today may.
export const TRIMMED_MAX_JSON_BYTES: number = STORED_CHECK_MAX_SIZE_IN_BYTES;

/*
 * A trimmed check still past the limit keeps its top-level fields of this
 * size or less, as JSON.
 */
export const SMALL_FIELD_MAX_BYTES: number = 16 * 1024;

// Rows one page of a walk covers, at most.
export const SCAN_PAGE_SIZE: number = 1000;

/*
 * How long one row's trim may take in Postgres. Measured at 255 ms for a
 * 35 MB check: this is a hundred times that.
 */
export const TRIM_STATEMENT_TIMEOUT_MS: number = 30 * 1000;

/*
 * How long one row's trim may wait for the row's lock: an alert being
 * written now is trimmed next run.
 */
export const TRIM_LOCK_TIMEOUT_MS: number = 3 * 1000;

/*
 * What a run may spend starting work; the job's own timeout is longer, so a
 * trim already running finishes.
 */
export const TRIM_TIME_BUDGET_MS: number = 10 * 60 * 1000;

// Where each table's walk got to: in the cache, under the table's name.
export const CURSOR_CACHE_NAMESPACE: string = "trim-oversized-stored-checks";

/*
 * How long the cache keeps where a walk got to. A walk that waits longer
 * than that between runs starts over.
 */
export const CURSOR_EXPIRES_IN_DAYS: number = 30;

// The DataMigrations row that says a table's walk is done.
export const DONE_MARKER_PREFIX: string = "TrimOversizedStoredChecks:";

export function getDoneMarkerName(table: StoredLogTable): string {
  return `${DONE_MARKER_PREFIX}${table}`;
}

/*
 * Postgres errors after which a check is replaced by the markers alone: it
 * could not be trimmed within its statement timeout (query_canceled), or in
 * the memory the backend has (out_of_memory, program_limit_exceeded). Any
 * other error - a lock waited for too long (lock_not_available), a lost
 * connection - is tried again next run.
 */
export const TOO_BIG_TO_TRIM_ERROR_CODES: ReadonlyArray<string> = [
  "57014",
  "53200",
  "54000",
];

// How much a run may read and write: the defaults, or smaller ones in tests.
export interface OversizedStoredChecksLimits {
  scanPageSize: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

export const DEFAULT_LIMITS: OversizedStoredChecksLimits = {
  scanPageSize: SCAN_PAGE_SIZE,
  statementTimeoutMs: TRIM_STATEMENT_TIMEOUT_MS,
  lockTimeoutMs: TRIM_LOCK_TIMEOUT_MS,
};

// A row whose check is stored at the threshold or more.
export interface OversizedCheckCandidate {
  id: string;
  storedBytes: number;
}

// How one row's trim went.
export enum TrimOutcome {
  // Trimmed in SQL: its own series, if any, and its small fields kept.
  Trimmed = "Trimmed",
  // Too big to trim in SQL: replaced by the markers alone.
  ReplacedByMarkers = "ReplacedByMarkers",
  // Trimmed, deleted or emptied since the page was read: nothing written.
  Skipped = "Skipped",
  // Logged, and tried again next run.
  Failed = "Failed",
}

export interface OversizedChecksTableResult {
  table: StoredLogTable;
  rowsTrimmed: number;
  rowsReplacedByMarkers: number;
  // What the rows trimmed or replaced took as stored, before.
  storedBytesBefore: number;
  // And after.
  storedBytesAfter: number;
  failedRows: number;
  // The walk reached the table's end, and the table is marked done.
  isFinished: boolean;
  // The time budget ran out before the walk reached the end.
  isCutShort: boolean;
}

export interface OversizedStoredChecksSummary {
  rowsTrimmed: number;
  rowsReplacedByMarkers: number;
  storedBytesBefore: number;
  storedBytesAfter: number;
  failedRows: number;
  // Tables whose walk failed this run: logged, and tried again next run.
  failedTables: number;
  // Tables whose walk reached its end this run: never walked again.
  finishedTables: Array<StoredLogTable>;
  // The time budget ran out before every table was done.
  isCutShort: boolean;
  // Every table was done before the run: it read nothing else.
  isEveryTableDone: boolean;
}

// Collects a statement's parameters, numbering them as Postgres does.
class StatementParams {
  public readonly values: Array<unknown> = [];

  public add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

function toPositiveCount(value: number): number {
  return Math.max(1, Math.floor(value));
}

// An id as Postgres gave it, or undefined when it is none.
function readId(value: unknown): string | undefined {
  const id: string = typeof value === "string" ? value : "";

  return ObjectID.isValidUUID(id) ? id : undefined;
}

// What a field name written into a statement may be: letters only.
const FIELD_NAME_PATTERN: RegExp = /^[A-Za-z]+$/;

// A list of fixed field names as a SQL text array.
function toSqlTextArray(names: ReadonlyArray<string>): string {
  return `ARRAY[${names
    .map((name: string): string => {
      if (!FIELD_NAME_PATTERN.test(name)) {
        throw new BadDataException(`"${name}" is not a field name.`);
      }

      return `'${name}'`;
    })
    .join(", ")}]::text[]`;
}

/*
 * The markers a trimmed check carries, as a jsonb expression:
 * isEvidenceTruncated, and what was removed and why.
 */
function markersExpression(data: {
  noteParam: string;
  trimmedFieldsExpression: string;
}): string {
  return `jsonb_build_object('${EVIDENCE_TRUNCATED_FIELD}', true, '${TRIMMED_BY_CLEANUP_FIELD}', jsonb_build_object('note', ${data.noteParam}::text, 'trimmedFields', ${data.trimmedFieldsExpression}))`;
}

/*
 * One row's check, trimmed in SQL (see WHAT A TRIMMED ROW KEEPS above), by
 * the row's id, while it is still stored at minStoredBytes or more. Returns
 * the row's id and the size its check is stored at now, or no row when
 * there was nothing to trim. The check is read only by Postgres.
 */
export function buildTrimStatement(data: {
  table: StoredLogTable;
  id: string;
  minStoredBytes?: number | undefined;
  maxJsonBytes?: number | undefined;
  smallFieldMaxBytes?: number | undefined;
}): StoredLogScreenshotsStatement {
  const column: string = STORED_LOG_COLUMNS[data.table];
  const source: SeriesFingerprintSource | null =
    SERIES_FINGERPRINT_SOURCES[data.table];
  const params: StatementParams = new StatementParams();

  const idParam: string = params.add(data.id);
  const minStoredParam: string = params.add(
    toPositiveCount(data.minStoredBytes ?? CANDIDATE_MIN_STORED_BYTES),
  );
  const maxJsonParam: string = params.add(
    toPositiveCount(data.maxJsonBytes ?? TRIMMED_MAX_JSON_BYTES),
  );
  const smallFieldParam: string = params.add(
    toPositiveCount(data.smallFieldMaxBytes ?? SMALL_FIELD_MAX_BYTES),
  );
  const noteParam: string = params.add(TRIMMED_BY_CLEANUP_NOTE);

  const seriesLists: string = toSqlTextArray(SERIES_LIST_FIELDS);
  const bigFields: string = toSqlTextArray([
    ...SERIES_LIST_FIELDS,
    ...POINTS_FIELDS,
  ]);

  let fingerprint: string | null = null;
  let join: string = "";

  if (source && source.recordIdColumn) {
    fingerprint = `r."seriesFingerprint"`;
    join = `\n  LEFT JOIN "${source.recordTable}" r ON r."_id" = t."${source.recordIdColumn}"`;
  } else if (source) {
    fingerprint = `t."seriesFingerprint"`;
  }

  // A record about the whole monitor (or no record) is about no series.
  const fingerprintColumn: string = fingerprint
    ? `CASE WHEN ${fingerprint} = '' OR ${fingerprint} = ${params.add(MetricSeriesFingerprint.WholeMonitorFingerprint)}::text THEN NULL ELSE ${fingerprint} END`
    : `NULL::text`;

  /*
   * target: the row, while it still needs trimming; its series, when it is
   * about one.
   * lists: each series list the check has, with its length and the entry of
   * the row's series.
   * scoped: what a record about one series keeps of the lists and points.
   * trimmed: the three results, from the most kept to the least.
   */
  const sql: string = `WITH "target" AS (
  SELECT t."_id" AS "id", t."${column}" AS "log",
    ${fingerprintColumn} AS "fingerprint"
  FROM "${data.table}" t${join}
  WHERE t."_id" = ${idParam}::uuid
    AND pg_column_size(t."${column}") >= ${minStoredParam}
    AND jsonb_typeof(t."${column}") = 'object'
),
"lists" AS (
  SELECT g."id", l."name", l."position",
    jsonb_array_length(g."log" -> l."name") AS "length",
    CASE WHEN g."fingerprint" IS NULL THEN NULL
      ELSE jsonb_path_query_first(g."log" -> l."name", '$[*] ? (@."fingerprint" == $fingerprint)', jsonb_build_object('fingerprint', g."fingerprint")) END AS "entry"
  FROM "target" g
  CROSS JOIN LATERAL unnest(${seriesLists}) WITH ORDINALITY AS l("name", "position")
  WHERE jsonb_typeof(g."log" -> l."name") = 'array'
),
"scoped" AS (
  SELECT g."id",
    g."log" - ${bigFields} AS "rest",
    (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_object_keys(g."log") k WHERE k = ANY(${bigFields})) AS "trimmedFields",
    (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_object_keys(g."log") k) AS "allFields",
    CASE WHEN g."fingerprint" IS NULL OR NOT EXISTS (SELECT 1 FROM "lists" x WHERE x."id" = g."id") THEN '{}'::jsonb
    ELSE (
      SELECT jsonb_object_agg(x."name", CASE WHEN x."entry" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(x."entry") END) FROM "lists" x WHERE x."id" = g."id"
    ) || COALESCE((
      SELECT jsonb_strip_nulls(jsonb_build_object(
        'metricResult', CASE WHEN jsonb_typeof(g."log" -> 'metricResult') IS DISTINCT FROM 'array' THEN NULL
          WHEN jsonb_typeof(x."entry" -> 'aggregatedResults') = 'array' THEN x."entry" -> 'aggregatedResults'
          ELSE '[]'::jsonb END,
        'metricResultArrivals', CASE WHEN NOT (g."log" ? 'metricResultArrivals') THEN NULL
          WHEN jsonb_typeof(x."entry" -> 'arrivals') = 'array' THEN x."entry" -> 'arrivals'
          ELSE NULL END
      )) FROM "lists" x WHERE x."id" = g."id" AND x."name" = 'seriesBreakdown'
    ), '{}'::jsonb) || jsonb_build_object('${EVIDENCE_SCOPE_FIELD}', jsonb_build_object(
      'seriesFingerprint', g."fingerprint",
      'seriesInEvaluation', (SELECT x."length" FROM "lists" x WHERE x."id" = g."id" ORDER BY x."position" LIMIT 1)
    ))
    END AS "series"
  FROM "target" g
),
"trimmed" AS (
  SELECT s."id",
    s."rest" || s."series" || ${markersExpression({ noteParam, trimmedFieldsExpression: `s."trimmedFields"` })} AS "withSeries",
    s."rest",
    s."allFields"
  FROM "scoped" s
),
"result" AS (
  SELECT m."id",
    CASE WHEN octet_length(m."withSeries"::text) <= ${maxJsonParam} THEN m."withSeries"
    ELSE (
      SELECT CASE WHEN octet_length(f."log"::text) <= ${maxJsonParam} THEN f."log"
        ELSE ${markersExpression({ noteParam, trimmedFieldsExpression: `m."allFields"` })} END
      FROM (
        SELECT k."small" || ${markersExpression({
          noteParam,
          trimmedFieldsExpression: `(SELECT COALESCE(jsonb_agg(a ORDER BY a), '[]'::jsonb) FROM jsonb_array_elements_text(m."allFields") a WHERE NOT (k."small" ? a))`,
        })} AS "log"
        FROM (
          SELECT COALESCE(jsonb_object_agg(e."key", e."value"), '{}'::jsonb) AS "small"
          FROM jsonb_each(m."rest") e
          WHERE octet_length(e."value"::text) <= ${smallFieldParam}
        ) k
      ) f
    ) END AS "log"
  FROM "trimmed" m
)
UPDATE "${data.table}" t
SET "${column}" = r."log"
FROM "result" r
WHERE t."_id" = r."id"
  AND pg_column_size(t."${column}") >= ${minStoredParam}
RETURNING t."_id"::text AS "id", pg_column_size(t."${column}") AS "storedBytes"`;

  return { sql, params: params.values };
}

/*
 * One row's check replaced by the markers alone, by the row's id, while it is
 * still stored at minStoredBytes or more: for a check too big to trim in
 * SQL. Reads none of it - pg_column_size reads the TOAST pointer.
 */
export function buildMarkersOnlyStatement(data: {
  table: StoredLogTable;
  id: string;
  minStoredBytes?: number | undefined;
}): StoredLogScreenshotsStatement {
  const column: string = STORED_LOG_COLUMNS[data.table];
  const params: StatementParams = new StatementParams();

  const idParam: string = params.add(data.id);
  const minStoredParam: string = params.add(
    toPositiveCount(data.minStoredBytes ?? CANDIDATE_MIN_STORED_BYTES),
  );
  const noteParam: string = params.add(TRIMMED_BY_CLEANUP_NOTE);

  return {
    sql: `UPDATE "${data.table}" t
SET "${column}" = ${markersExpression({ noteParam, trimmedFieldsExpression: `'"all"'::jsonb` })}
WHERE t."_id" = ${idParam}::uuid
  AND pg_column_size(t."${column}") >= ${minStoredParam}
RETURNING t."_id"::text AS "id", pg_column_size(t."${column}") AS "storedBytes"`,
    params: params.values,
  };
}

// The tables whose walk is done: one read of their DataMigrations rows.
export function buildDoneMarkersStatement(data: {
  tables: ReadonlyArray<StoredLogTable>;
}): StoredLogScreenshotsStatement {
  return {
    sql: `SELECT DISTINCT m."name" AS "name"
FROM "DataMigrations" m
WHERE m."name" = ANY($1::text[])
  AND m."executed" = true
  AND m."deletedAt" IS NULL`,
    params: [data.tables.map(getDoneMarkerName)],
  };
}

// Was this error Postgres saying the check is too big to trim in SQL?
export function isTooBigToTrim(error: unknown): boolean {
  const code: unknown =
    (error as { code?: unknown } | null)?.code ??
    (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

  return typeof code === "string" && TOO_BIG_TO_TRIM_ERROR_CODES.includes(code);
}

function readCandidates(
  rows: Array<Record<string, unknown>>,
): Array<OversizedCheckCandidate> {
  const candidates: Array<OversizedCheckCandidate> = [];

  for (const row of rows) {
    const id: string | undefined = readId(row["id"]);

    if (!id) {
      continue;
    }

    const storedBytes: number = Number(row["storedBytes"]);

    candidates.push({
      id: id,
      storedBytes: Number.isFinite(storedBytes) ? storedBytes : 0,
    });
  }

  return candidates;
}

export default class OversizedStoredChecks {
  // Seams for tests: the runners, the clock, the cursor and the marker.
  public static runQuery: OversizedStoredChecksQueryRunner = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return (await DataMigrationService.getRepository().manager.query(
      sql,
      params,
    )) as Array<Record<string, unknown>>;
  };

  public static runStatement: OversizedStoredChecksStatementRunner =
    async (data: {
      sql: string;
      params: Array<unknown>;
      statementTimeoutMs: number;
      lockTimeoutMs: number;
    }): Promise<Array<Record<string, unknown>>> => {
      const queryRunner: QueryRunner =
        DataMigrationService.getRepository().manager.connection.createQueryRunner();

      await queryRunner.connect();

      try {
        await queryRunner.startTransaction();

        try {
          await queryRunner.query(
            `SET LOCAL statement_timeout = ${toPositiveCount(data.statementTimeoutMs)}`,
          );
          await queryRunner.query(
            `SET LOCAL lock_timeout = ${toPositiveCount(data.lockTimeoutMs)}`,
          );

          const rows: Array<Record<string, unknown>> = (await queryRunner.query(
            data.sql,
            data.params,
          )) as Array<Record<string, unknown>>;

          await queryRunner.commitTransaction();

          return OversizedStoredChecks.readReturnedRows(rows);
        } catch (error) {
          if (queryRunner.isTransactionActive) {
            await queryRunner.rollbackTransaction();
          }

          throw error;
        }
      } finally {
        await queryRunner.release();
      }
    };

  public static now: () => Date = (): Date => {
    return new Date();
  };

  /*
   * Where a table's walk got to: the last row it is done with, or undefined
   * to start at the beginning - also when the cache cannot be read.
   */
  public static readCursor: (
    table: StoredLogTable,
  ) => Promise<string | undefined> = async (
    table: StoredLogTable,
  ): Promise<string | undefined> => {
    try {
      return readId(await GlobalCache.getString(CURSOR_CACHE_NAMESPACE, table));
    } catch (error) {
      logger.debug(
        `Oversized stored checks: where the walk of ${table} got to could not be read from the cache; it starts at the beginning.`,
      );
      logger.debug(error);
      return undefined;
    }
  };

  // Keeps where a table's walk got to, as far as the cache allows.
  public static saveCursor: (
    table: StoredLogTable,
    id: string,
  ) => Promise<void> = async (
    table: StoredLogTable,
    id: string,
  ): Promise<void> => {
    try {
      await GlobalCache.setString(CURSOR_CACHE_NAMESPACE, table, id, {
        expiresInSeconds: OneUptimeDate.getSecondsInDays(
          CURSOR_EXPIRES_IN_DAYS,
        ),
      });
    } catch (error) {
      logger.debug(
        `Oversized stored checks: where the walk of ${table} got to could not be kept in the cache; the next walk starts at the beginning.`,
      );
      logger.debug(error);
    }
  };

  /*
   * Forgets where a finished walk got to, so a walk asked for again (its
   * DataMigrations row deleted) starts at the beginning.
   */
  public static forgetCursor: (table: StoredLogTable) => Promise<void> = async (
    table: StoredLogTable,
  ): Promise<void> => {
    try {
      await GlobalCache.deleteKey(CURSOR_CACHE_NAMESPACE, table);
    } catch (error) {
      logger.debug(
        `Oversized stored checks: where the finished walk of ${table} got to could not be removed from the cache.`,
      );
      logger.debug(error);
    }
  };

  /*
   * Records a table's walk as done, as the data migration runner records a
   * migration: a DataMigrations row, by name.
   */
  public static markTableDone: (table: StoredLogTable) => Promise<void> =
    async (table: StoredLogTable): Promise<void> => {
      const marker: DataMigration = new DataMigration();
      marker.name = getDoneMarkerName(table);
      marker.executed = true;
      marker.executedAt = OversizedStoredChecks.now();

      await DataMigrationService.create({
        data: marker,
        props: {
          isRoot: true,
        },
      });
    };

  /*
   * What TypeORM returns for an UPDATE ... RETURNING: [rows, count] from a
   * query runner, or the rows alone.
   */
  public static readReturnedRows(
    result: unknown,
  ): Array<Record<string, unknown>> {
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[0] as Array<Record<string, unknown>>;
    }

    return Array.isArray(result)
      ? (result as Array<Record<string, unknown>>)
      : [];
  }

  // The tables whose walk is done.
  public static async readDoneTables(): Promise<Set<StoredLogTable>> {
    const statement: StoredLogScreenshotsStatement = buildDoneMarkersStatement({
      tables: OVERSIZED_CHECK_TABLES,
    });

    const names: Set<string> = new Set<string>(
      (await this.runQuery(statement.sql, statement.params)).map(
        (row: Record<string, unknown>): string => {
          return String(row["name"] || "");
        },
      ),
    );

    return new Set<StoredLogTable>(
      OVERSIZED_CHECK_TABLES.filter((table: StoredLogTable): boolean => {
        return names.has(getDoneMarkerName(table));
      }),
    );
  }

  /*
   * Every table not done yet, in turn, as far as the time budget - and the
   * job's deadline - go. One table's failure is logged and the rest go on:
   * it is tried again next run.
   */
  public static async run(data?: {
    timeBudgetMs?: number | undefined;
    deadline?: JobDeadline | undefined;
    limits?: OversizedStoredChecksLimits | undefined;
  }): Promise<OversizedStoredChecksSummary> {
    const budgetMs: number = data?.timeBudgetMs ?? TRIM_TIME_BUDGET_MS;
    const limits: OversizedStoredChecksLimits = data?.limits || DEFAULT_LIMITS;
    const startedAt: number = this.now().getTime();

    const isOutOfTime: () => boolean = (): boolean => {
      return (
        this.now().getTime() - startedAt >= budgetMs ||
        Boolean(data?.deadline?.hasPassed())
      );
    };

    const summary: OversizedStoredChecksSummary = {
      rowsTrimmed: 0,
      rowsReplacedByMarkers: 0,
      storedBytesBefore: 0,
      storedBytesAfter: 0,
      failedRows: 0,
      failedTables: 0,
      finishedTables: [],
      isCutShort: false,
      isEveryTableDone: false,
    };

    const doneTables: Set<StoredLogTable> = await this.readDoneTables();

    const tablesLeft: Array<StoredLogTable> = OVERSIZED_CHECK_TABLES.filter(
      (table: StoredLogTable): boolean => {
        return !doneTables.has(table);
      },
    );

    if (tablesLeft.length === 0) {
      summary.isEveryTableDone = true;
      return summary;
    }

    for (const table of tablesLeft) {
      if (isOutOfTime()) {
        summary.isCutShort = true;
        return summary;
      }

      try {
        const result: OversizedChecksTableResult = await this.trimTable({
          table: table,
          limits: limits,
          isOutOfTime: isOutOfTime,
        });

        summary.rowsTrimmed += result.rowsTrimmed;
        summary.rowsReplacedByMarkers += result.rowsReplacedByMarkers;
        summary.storedBytesBefore += result.storedBytesBefore;
        summary.storedBytesAfter += result.storedBytesAfter;
        summary.failedRows += result.failedRows;

        if (result.isFinished) {
          summary.finishedTables.push(table);
        }

        if (result.isCutShort) {
          summary.isCutShort = true;
          return summary;
        }
      } catch (error) {
        summary.failedTables += 1;
        logger.error(
          `Oversized stored checks: trimming the checks kept in ${table}.${STORED_LOG_COLUMNS[table]} failed. It is tried again next run, from where its walk got to.`,
        );
        logger.error(error);
      }
    }

    return summary;
  }

  /*
   * One table's walk, from where it got to, a page at a time, until it
   * reaches the table's end - then the table is marked done - or the time
   * budget runs out, or a row fails: then where it got to is kept, and the
   * next run starts there.
   */
  public static async trimTable(data: {
    table: StoredLogTable;
    limits?: OversizedStoredChecksLimits | undefined;
    isOutOfTime?: (() => boolean) | undefined;
  }): Promise<OversizedChecksTableResult> {
    const limits: OversizedStoredChecksLimits = data.limits || DEFAULT_LIMITS;
    const isOutOfTime: () => boolean =
      data.isOutOfTime ||
      ((): boolean => {
        return false;
      });

    const result: OversizedChecksTableResult = {
      table: data.table,
      rowsTrimmed: 0,
      rowsReplacedByMarkers: 0,
      storedBytesBefore: 0,
      storedBytesAfter: 0,
      failedRows: 0,
      isFinished: false,
      isCutShort: false,
    };

    let cursor: string | undefined = await this.readCursor(data.table);

    for (;;) {
      if (isOutOfTime()) {
        result.isCutShort = true;
        return result;
      }

      const endStatement: StoredLogScreenshotsStatement = buildPageEndStatement(
        {
          table: data.table,
          afterId: cursor,
          pageSize: limits.scanPageSize,
        },
      );

      const endRows: Array<Record<string, unknown>> = await this.runQuery(
        endStatement.sql,
        endStatement.params,
      );

      const pageEnd: string | undefined = readId(endRows[0]?.["id"]);

      if (endRows.length > 0 && !pageEnd) {
        throw new BadDataException(
          `The end of a page of ${data.table} could not be read.`,
        );
      }

      const candidatesStatement: StoredLogScreenshotsStatement =
        buildPageCandidatesStatement({
          table: data.table,
          afterId: cursor,
          throughId: pageEnd,
          minStoredBytes: CANDIDATE_MIN_STORED_BYTES,
        });

      const candidates: Array<OversizedCheckCandidate> = readCandidates(
        await this.runQuery(
          candidatesStatement.sql,
          candidatesStatement.params,
        ),
      );

      // The last row every row up to which is done.
      let doneThrough: string | undefined = cursor;
      let hasFailed: boolean = false;
      let isCutShort: boolean = false;

      for (const candidate of candidates) {
        if (isOutOfTime()) {
          isCutShort = true;
          break;
        }

        const trim: { outcome: TrimOutcome; storedBytesAfter: number } =
          await this.trimRow({
            table: data.table,
            candidate: candidate,
            limits: limits,
          });

        if (
          trim.outcome === TrimOutcome.Trimmed ||
          trim.outcome === TrimOutcome.ReplacedByMarkers
        ) {
          if (trim.outcome === TrimOutcome.Trimmed) {
            result.rowsTrimmed += 1;
          } else {
            result.rowsReplacedByMarkers += 1;
          }

          result.storedBytesBefore += candidate.storedBytes;
          result.storedBytesAfter += trim.storedBytesAfter;
        }

        if (trim.outcome === TrimOutcome.Failed) {
          result.failedRows += 1;
          hasFailed = true;
          break;
        }

        doneThrough = candidate.id;

        // One row's work at a time: let the rest of the process run.
        await EventLoop.yieldToEventLoop();
      }

      if (hasFailed || isCutShort) {
        if (doneThrough && doneThrough !== cursor) {
          await this.saveCursor(data.table, doneThrough);
        }

        result.isCutShort = isCutShort;
        return result;
      }

      if (!pageEnd) {
        await this.markTableDone(data.table);
        await this.forgetCursor(data.table);
        result.isFinished = true;
        return result;
      }

      cursor = pageEnd;
      await this.saveCursor(data.table, cursor);
    }
  }

  /*
   * One row: trimmed in SQL, or, when Postgres cannot trim it within its
   * limits, replaced by the markers alone. Never throws: a failure is logged
   * and reported.
   */
  public static async trimRow(data: {
    table: StoredLogTable;
    candidate: OversizedCheckCandidate;
    limits?: OversizedStoredChecksLimits | undefined;
  }): Promise<{ outcome: TrimOutcome; storedBytesAfter: number }> {
    const limits: OversizedStoredChecksLimits = data.limits || DEFAULT_LIMITS;
    const column: string = STORED_LOG_COLUMNS[data.table];

    const written: (
      rows: Array<Record<string, unknown>>,
      outcome: TrimOutcome,
    ) => { outcome: TrimOutcome; storedBytesAfter: number } = (
      rows: Array<Record<string, unknown>>,
      outcome: TrimOutcome,
    ): { outcome: TrimOutcome; storedBytesAfter: number } => {
      if (rows.length === 0) {
        return { outcome: TrimOutcome.Skipped, storedBytesAfter: 0 };
      }

      const storedBytesAfter: number = Number(rows[0]?.["storedBytes"]);

      return {
        outcome: outcome,
        storedBytesAfter: Number.isFinite(storedBytesAfter)
          ? storedBytesAfter
          : 0,
      };
    };

    try {
      const statement: StoredLogScreenshotsStatement = buildTrimStatement({
        table: data.table,
        id: data.candidate.id,
      });

      return written(
        await this.runStatement({
          sql: statement.sql,
          params: statement.params,
          statementTimeoutMs: limits.statementTimeoutMs,
          lockTimeoutMs: limits.lockTimeoutMs,
        }),
        TrimOutcome.Trimmed,
      );
    } catch (error) {
      if (!isTooBigToTrim(error)) {
        logger.error(
          `Oversized stored checks: trimming ${data.table}.${column} of row ${data.candidate.id} failed. It is tried again next run.`,
        );
        logger.error(error);
        return { outcome: TrimOutcome.Failed, storedBytesAfter: 0 };
      }

      logger.warn(
        `Oversized stored checks: ${data.table}.${column} of row ${data.candidate.id} could not be trimmed within the database's limits, so it is replaced by a note that it was trimmed.`,
      );
    }

    try {
      const statement: StoredLogScreenshotsStatement =
        buildMarkersOnlyStatement({
          table: data.table,
          id: data.candidate.id,
        });

      return written(
        await this.runStatement({
          sql: statement.sql,
          params: statement.params,
          statementTimeoutMs: limits.statementTimeoutMs,
          lockTimeoutMs: limits.lockTimeoutMs,
        }),
        TrimOutcome.ReplacedByMarkers,
      );
    } catch (error) {
      logger.error(
        `Oversized stored checks: replacing ${data.table}.${column} of row ${data.candidate.id} failed. It is tried again next run.`,
      );
      logger.error(error);
      return { outcome: TrimOutcome.Failed, storedBytesAfter: 0 };
    }
  }
}
