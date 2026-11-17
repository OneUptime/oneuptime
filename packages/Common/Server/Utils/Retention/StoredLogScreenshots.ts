import DataMigration from "../../../Models/DatabaseModels/DataMigration";
import BadDataException from "../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import StateChangeLogScreenshots from "../../../Utils/Monitor/StateChangeLogScreenshots";
import GlobalCache from "../../Infrastructure/GlobalCache";
import DataMigrationService from "../../Services/DataMigrationService";
import EventLoop from "../EventLoop";
import JobDeadline from "../JobDeadline";
import logger from "../Logger";
import { QueryRunner } from "typeorm";

/*
 * CLEARING THE SCREENSHOTS STATE CHANGES KEPT BEFORE THEY STOPPED KEEPING
 * THEM (OneUptime issues #6903, #6942).
 *
 * A Synthetic monitor's check carries a base64 screenshot for every browser
 * and screen size it ran on, and the check that opened an incident or an
 * alert, or changed its state or a monitor's status, used to be kept with
 * it, screenshots and all. One self-hosted installation's database grew to
 * 27 GB that way, nearly all of it these: 13 GB in IncidentStateTimeline
 * (46 thousand rows), 6.7 GB in AlertStateTimeline, 3.5 GB in Alert and 2.3
 * GB in Incident. Rows written now keep none (StateChangeLogScreenshots, in
 * each service's onBeforeCreate: incidents' and alerts' since #6940,
 * monitor status changes' since #6942). This clears the rows written
 * before, for the Workers job Monitor:ClearStoredLogScreenshots, in
 *
 *   - IncidentStateTimeline.stateChangeLog, AlertStateTimeline.stateChangeLog,
 *   - Alert.createdStateLog, Incident.createdStateLog,
 *   - MonitorStatusTimeline.statusChangeLog.
 *
 * WHAT CHANGES
 *
 * A log that holds a Synthetic run's screenshots loses them and keeps
 * everything else - the script's log lines, its result and error, the
 * evaluation - and each run that had some says it left them out
 * (areScreenshotsOmitted): what a row written today keeps, by the same rule
 * (StateChangeLogScreenshots.leaveOut). Nothing showed them there: these
 * logs are read as JSON text (View Logs). The monitor's own logs keep the
 * screenshots, and so does an incident's or an alert's monitor summary
 * (monitorSummary), which is another column.
 *
 * Only that column of that row is written: not "updatedAt", not "version" -
 * clearing storage is no change anyone made - and no hook, workflow or
 * notification runs. A row with nothing to clear is never written. Deleted
 * rows are cleared too: they take the space all the same.
 *
 * HOW
 *
 * Each table is walked once, in "_id" order, a page of SCAN_PAGE_SIZE rows
 * at a time: one read finds where the page ends, a second the page's rows
 * whose log is stored at CANDIDATE_MIN_STORED_BYTES or more. That size is
 * pg_column_size: the size Postgres stores the value at, compressed, read
 * from the row - from the TOAST pointer for a large value - so finding them
 * reads no log. A Synthetic run's screenshot is tens or hundreds of
 * kilobytes of base64, which hardly compresses, so a log that carries one
 * is stored far above 4 KB (the customer's averaged 280 KB a row), while
 * most logs without one - a status code, a time, a few headers - are stored
 * well under it: the walk reads few logs only to find nothing to clear.
 * A log under 4 KB can hold no more than a few kilobytes of screenshots, and
 * is left as it is. Every statement reads or writes a bounded number of
 * rows, so none runs long, whatever the table holds.
 *
 * The rows found are asked for a few at a time - READ_BATCH_SIZE, and no
 * more than READ_BATCH_MAX_STORED_BYTES of them, as each can be megabytes;
 * a bigger one is asked for alone - and Postgres, not this process, first
 * looks in each for a Synthetic run's screenshots (SCREENSHOTS_JSON_PATH,
 * jsonb_path_exists). Only a log that holds some comes back, as text, to be
 * judged here by StateChangeLogScreenshots: every other log stays in
 * Postgres (issue #9253). That matters for the checks a grouped Metrics
 * monitor kept before #9189 - the whole evaluation, up to 95 MB of JSON a
 * row, which hold no screenshots and which reading into this process would
 * be the very memory spike #9189 removed. Postgres looks through such a row
 * in a fraction of a second (some 130 ms for 70 MB of JSON), in one backend,
 * for one statement. The path is wider than StateChangeLogScreenshots' rule
 * - any depth, a single run as well as a list of them - so it never misses
 * a log the rule would clear; a log it lets through that the rule leaves as
 * it is, is read and not written. A log that holds screenshots but is stored
 * at more than READ_MAX_STORED_BYTES is not read either: it is logged and
 * left as it is.
 *
 * Each statement runs in a transaction of its own, with a statement timeout
 * and a lock timeout (STATEMENT_TIMEOUT_MS, LOCK_TIMEOUT_MS). A read that
 * Postgres cannot finish within its timeout or memory is asked again a row
 * at a time; a row it still cannot look through is logged and left as it is
 * (Monitor:TrimOversizedStoredChecks trims a log that big), so the walk
 * never stalls on it. Each log that changes is written back by its id, one
 * statement each, only if it is still stored at the size it was read at: a
 * log another job rewrote since (trimmed it, say) is not overwritten with
 * the copy read before.
 *
 * Where a table's walk got to is kept in the cache (GlobalCache) between
 * runs. If it is lost the walk starts over, which only costs time: a row
 * cleared once has nothing left to clear. A walk that reaches the end of its
 * table records it as done, as a row of the DataMigrations table named
 * ClearStoredLogScreenshots:<table> - the data migration runner reads only
 * the names of its own migrations - and the table is never walked again: a
 * row written since keeps no screenshots. Once every table is done, a run is
 * one read of those rows. During a rolling upgrade, a server still on an
 * older release can write a row with screenshots after the walk passed it;
 * that row keeps them.
 *
 * A row that fails - its read or its write, a lock waited for too long, a
 * lost connection - is logged and the rest of the
 * page goes on, but the walk stops there for the run, and the next run
 * starts at the row: a table is never marked done past a row it could not
 * clear. One table's failure is logged and the other tables go on.
 *
 * HOW MUCH, HOW OFTEN
 *
 * Hourly. A run stops starting work once CLEAR_TIME_BUDGET_MS is spent,
 * with where it got to kept, and works the tables in turn: the biggest the
 * installation measured first, so the space comes back soonest. A write
 * frees the old log's TOAST chunks, which Postgres logs (WAL) as it would
 * a delete of as much data; the budget bounds how much of that one run
 * writes. PostgreSQL reuses the space the cleared screenshots leave, but
 * does not give it back to the disk: a self-hosted install that wants the
 * disk back runs VACUUM FULL or pg_repack on the tables afterwards (the
 * Synthetic monitor docs say how).
 */

export type StoredLogScreenshotsQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

export interface StoredLogScreenshotsStatement {
  sql: string;
  params: Array<unknown>;
}

// The tables whose rows keep the check of a state change, as Postgres names them.
export enum StoredLogTable {
  IncidentStateTimeline = "IncidentStateTimeline",
  AlertStateTimeline = "AlertStateTimeline",
  Alert = "Alert",
  Incident = "Incident",
  MonitorStatusTimeline = "MonitorStatusTimeline",
}

/*
 * The column each table keeps the check in: fixed here, never taken from a
 * caller.
 */
export const STORED_LOG_COLUMNS: Record<StoredLogTable, string> = {
  [StoredLogTable.IncidentStateTimeline]: "stateChangeLog",
  [StoredLogTable.AlertStateTimeline]: "stateChangeLog",
  [StoredLogTable.Alert]: "createdStateLog",
  [StoredLogTable.Incident]: "createdStateLog",
  [StoredLogTable.MonitorStatusTimeline]: "statusChangeLog",
};

/*
 * The order a run walks them in: the biggest first, as the installation of
 * #6903 measured them. Its monitor status changes were not measured.
 */
export const STORED_LOG_TABLES: ReadonlyArray<StoredLogTable> = [
  StoredLogTable.IncidentStateTimeline,
  StoredLogTable.AlertStateTimeline,
  StoredLogTable.Alert,
  StoredLogTable.Incident,
  StoredLogTable.MonitorStatusTimeline,
];

// Rows one page of a walk covers, at most.
export const SCAN_PAGE_SIZE: number = 1000;

// The stored size from which a row's log is read: see HOW above.
export const CANDIDATE_MIN_STORED_BYTES: number = 4 * 1024;

// Logs read at a time, at most.
export const READ_BATCH_SIZE: number = 10;

// And at most this much of them, as stored; a bigger one is read alone.
export const READ_BATCH_MAX_STORED_BYTES: number = 32 * 1024 * 1024;

/*
 * The most a log with screenshots may be stored at to be read into this
 * process; a bigger one is logged and left as it is. A Synthetic run's
 * screenshots are some hundreds of kilobytes each, so a log is stored far
 * below this.
 */
export const READ_MAX_STORED_BYTES: number = READ_BATCH_MAX_STORED_BYTES;

/*
 * Where a log keeps a Synthetic run's screenshots, for Postgres to look:
 * a non-empty object under "screenshots", in a run of a
 * "syntheticMonitorResponse" at any depth. Lax, so a list of runs and a
 * lone run both match - wider than StateChangeLogScreenshots' rule, never
 * narrower - and a Custom Code script's own "screenshots" key does not.
 */
export const SCREENSHOTS_JSON_PATH: string =
  'lax $.**.syntheticMonitorResponse[*] ? (@.type() == "object").screenshots ? (@.type() == "object" && exists (@.*))';

/*
 * How long one read or one write may take in Postgres, and wait for a row's
 * lock: on its transaction alone.
 */
export const STATEMENT_TIMEOUT_MS: number = 30 * 1000;
export const LOCK_TIMEOUT_MS: number = 3 * 1000;

/*
 * Postgres errors that say a statement went past what the database allows
 * it: its statement timeout (query_canceled), or the memory the backend has
 * (out_of_memory, program_limit_exceeded).
 */
export const DATABASE_LIMIT_ERROR_CODES: ReadonlyArray<string> = [
  "57014",
  "53200",
  "54000",
];

/*
 * What a run may spend starting work; the job's own timeout is longer, so a
 * write already running finishes.
 */
export const CLEAR_TIME_BUDGET_MS: number = 10 * 60 * 1000;

// Where each table's walk got to: in the cache, under the table's name.
export const CURSOR_CACHE_NAMESPACE: string = "clear-stored-log-screenshots";

/*
 * How long the cache keeps where a walk got to. A walk that waits longer
 * than that between runs starts over.
 */
export const CURSOR_EXPIRES_IN_DAYS: number = 30;

// The DataMigrations row that says a table's walk is done.
export const DONE_MARKER_PREFIX: string = "ClearStoredLogScreenshots:";

export function getDoneMarkerName(table: StoredLogTable): string {
  return `${DONE_MARKER_PREFIX}${table}`;
}

// How much a run may read and write: the defaults, or smaller ones in tests.
export interface StoredLogScreenshotsLimits {
  scanPageSize: number;
  readBatchSize: number;
  readBatchMaxStoredBytes: number;
  readMaxStoredBytes: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

export const DEFAULT_LIMITS: StoredLogScreenshotsLimits = {
  scanPageSize: SCAN_PAGE_SIZE,
  readBatchSize: READ_BATCH_SIZE,
  readBatchMaxStoredBytes: READ_BATCH_MAX_STORED_BYTES,
  readMaxStoredBytes: READ_MAX_STORED_BYTES,
  statementTimeoutMs: STATEMENT_TIMEOUT_MS,
  lockTimeoutMs: LOCK_TIMEOUT_MS,
};

/*
 * Runs one statement in a transaction of its own, with a statement timeout
 * and a lock timeout set on that transaction alone.
 */
export type StoredLogStatementRunner = (data: {
  sql: string;
  params: Array<unknown>;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}) => Promise<Array<Record<string, unknown>>>;

// A row whose log is stored at the threshold or more.
export interface StoredLogCandidate {
  id: string;
  storedBytes: number;
}

// What one read batch did with each of its rows.
export interface StoredLogCandidateOutcome {
  candidate: StoredLogCandidate;
  // Its log was read into this process: it holds screenshots, by Postgres.
  isRead: boolean;
  /*
   * It holds screenshots, or may, but is too big to read - stored above
   * readMaxStoredBytes, or past what Postgres allows one statement: logged
   * and left as it is.
   */
  isTooBigToRead: boolean;
  // Its screenshots were cleared.
  isCleared: boolean;
  // Reading or writing it failed: logged, and tried again next run.
  isFailed: boolean;
}

export interface StoredLogTableResult {
  table: StoredLogTable;
  // Logs read into this process: those that hold screenshots.
  rowsRead: number;
  // Logs too big to read: logged and left as they are.
  rowsTooBigToRead: number;
  // Logs whose screenshots were cleared.
  rowsCleared: number;
  // What those logs took as stored, before.
  storedBytesCleared: number;
  // Rows that failed: logged, and tried again next run.
  failedRows: number;
  // The walk reached the table's end, and the table is marked done.
  isFinished: boolean;
  // The time budget ran out before the walk reached the end.
  isCutShort: boolean;
}

export interface StoredLogScreenshotsSummary {
  rowsRead: number;
  rowsTooBigToRead: number;
  rowsCleared: number;
  storedBytesCleared: number;
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

/*
 * Where a page that starts after `afterId` ends: its pageSize-th row by
 * "_id", or no row when fewer are left - the page then runs to the table's
 * end. Read from the primary key alone.
 */
export function buildPageEndStatement(data: {
  table: StoredLogTable;
  afterId?: string | undefined;
  pageSize: number;
}): StoredLogScreenshotsStatement {
  const params: StatementParams = new StatementParams();
  const filters: Array<string> = [];

  if (data.afterId) {
    filters.push(`t."_id" > ${params.add(data.afterId)}::uuid`);
  }

  const offset: string = params.add(toPositiveCount(data.pageSize) - 1);

  return {
    sql: `SELECT t."_id"::text AS "id"
FROM "${data.table}" t${filters.length > 0 ? `\nWHERE ${filters.join("\n  AND ")}` : ""}
ORDER BY t."_id" ASC
OFFSET ${offset}
LIMIT 1`,
    params: params.values,
  };
}

/*
 * The rows of one page - after `afterId`, up to and with `throughId` - whose
 * log is stored at `minStoredBytes` or more, in "_id" order, with the size
 * each is stored at. pg_column_size reads that size from the row, not the
 * log.
 */
export function buildPageCandidatesStatement(data: {
  table: StoredLogTable;
  afterId?: string | undefined;
  throughId?: string | undefined;
  minStoredBytes: number;
}): StoredLogScreenshotsStatement {
  const column: string = STORED_LOG_COLUMNS[data.table];
  const params: StatementParams = new StatementParams();
  const filters: Array<string> = [];

  if (data.afterId) {
    filters.push(`t."_id" > ${params.add(data.afterId)}::uuid`);
  }

  if (data.throughId) {
    filters.push(`t."_id" <= ${params.add(data.throughId)}::uuid`);
  }

  filters.push(`t."${column}" IS NOT NULL`);
  filters.push(
    `pg_column_size(t."${column}") >= ${params.add(toPositiveCount(data.minStoredBytes))}`,
  );

  return {
    sql: `SELECT t."_id"::text AS "id", pg_column_size(t."${column}") AS "storedBytes"
FROM "${data.table}" t
WHERE ${filters.join("\n  AND ")}
ORDER BY t."_id" ASC`,
    params: params.values,
  };
}

/*
 * Of some rows, those whose log holds a Synthetic run's screenshots, as
 * Postgres finds them (SCREENSHOTS_JSON_PATH): each with the size it is
 * stored at and, when that is `maxStoredBytes` or less, the log as text, to
 * be parsed here one at a time. Every other log stays in Postgres: a row
 * without screenshots is not returned at all, and a log stored bigger comes
 * back without its text.
 */
export function buildReadLogsStatement(data: {
  table: StoredLogTable;
  ids: Array<string>;
  maxStoredBytes?: number | undefined;
}): StoredLogScreenshotsStatement {
  const column: string = STORED_LOG_COLUMNS[data.table];

  return {
    sql: `SELECT t."_id"::text AS "id", pg_column_size(t."${column}") AS "storedBytes",
  CASE WHEN pg_column_size(t."${column}") <= $3 THEN t."${column}"::text END AS "log"
FROM "${data.table}" t
WHERE t."_id" = ANY($1::uuid[])
  AND t."${column}" IS NOT NULL
  AND jsonb_path_exists(t."${column}", $2::jsonpath, '{}'::jsonb, true)`,
    params: [
      data.ids.filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      }),
      SCREENSHOTS_JSON_PATH,
      toPositiveCount(data.maxStoredBytes ?? READ_MAX_STORED_BYTES),
    ],
  };
}

/*
 * One row's log, without its screenshots: that column alone, by the row's
 * id, and only if it is still stored at the size it was read at - a log
 * rewritten since is left to whoever rewrote it. Not "updatedAt", not
 * "version": clearing storage is no change anyone made. The row comes back
 * when it was written.
 */
export function buildClearLogStatement(data: {
  table: StoredLogTable;
  id: string;
  log: JSONValue;
  readStoredBytes: number;
}): StoredLogScreenshotsStatement {
  const column: string = STORED_LOG_COLUMNS[data.table];

  return {
    sql: `UPDATE "${data.table}" t
SET "${column}" = $2::jsonb
WHERE t."_id" = $1::uuid
  AND pg_column_size(t."${column}") = $3
RETURNING t."_id"::text AS "id"`,
    params: [data.id, JSON.stringify(data.log), data.readStoredBytes],
  };
}

// Was this error Postgres saying a statement went past what it allows?
export function isOverDatabaseLimits(error: unknown): boolean {
  const code: unknown =
    (error as { code?: unknown } | null)?.code ??
    (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

  return typeof code === "string" && DATABASE_LIMIT_ERROR_CODES.includes(code);
}

/*
 * What TypeORM returns for a statement run on a query runner: the rows, or
 * [rows, count] for an UPDATE ... RETURNING.
 */
export function readReturnedRows(
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

/*
 * One statement in a transaction of its own, on the DataMigration
 * repository's connection, with a statement timeout and a lock timeout set
 * on that transaction alone; committed straight away.
 */
export async function runInOwnTransaction(data: {
  sql: string;
  params: Array<unknown>;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}): Promise<Array<Record<string, unknown>>> {
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

      const rows: unknown = await queryRunner.query(data.sql, data.params);

      await queryRunner.commitTransaction();

      return readReturnedRows(rows);
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    }
  } finally {
    await queryRunner.release();
  }
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

/*
 * A page's rows split into read batches, in order: at most `maxRows` each,
 * and at most `maxStoredBytes` of them - a row bigger than that alone.
 */
export function toReadBatches(data: {
  candidates: Array<StoredLogCandidate>;
  maxRows: number;
  maxStoredBytes: number;
}): Array<Array<StoredLogCandidate>> {
  const maxRows: number = toPositiveCount(data.maxRows);
  const batches: Array<Array<StoredLogCandidate>> = [];
  let batch: Array<StoredLogCandidate> = [];
  let batchBytes: number = 0;

  for (const candidate of data.candidates) {
    if (
      batch.length > 0 &&
      (batch.length >= maxRows ||
        batchBytes + candidate.storedBytes > data.maxStoredBytes)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }

    batch.push(candidate);
    batchBytes += candidate.storedBytes;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

/*
 * A size as a person reads it in a log line - 512 KB, 3.4 MB, 2.1 GB - the
 * figure kept with its unit (NumbersKeepTheirUnitsInCodeGuard).
 */
export function formatStoredBytes(bytes: number): string {
  const kilobytes: number = bytes / 1024;

  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)}${NO_BREAK_SPACE}KB`;
  }

  const megabytes: number = kilobytes / 1024;

  if (megabytes < 1024) {
    return `${megabytes.toFixed(1)}${NO_BREAK_SPACE}MB`;
  }

  return `${(megabytes / 1024).toFixed(1)}${NO_BREAK_SPACE}GB`;
}

function readCandidates(
  rows: Array<Record<string, unknown>>,
): Array<StoredLogCandidate> {
  const candidates: Array<StoredLogCandidate> = [];

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

export default class StoredLogScreenshots {
  // Seams for tests: the statement runner, the clock, the cursor and the marker.
  public static runQuery: StoredLogScreenshotsQueryRunner = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return (await DataMigrationService.getRepository().manager.query(
      sql,
      params,
    )) as Array<Record<string, unknown>>;
  };

  public static runStatement: StoredLogStatementRunner = runInOwnTransaction;

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
        `Stored log screenshots: where the walk of ${table} got to could not be read from the cache; it starts at the beginning.`,
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
        `Stored log screenshots: where the walk of ${table} got to could not be kept in the cache; the next walk starts at the beginning.`,
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
        `Stored log screenshots: where the finished walk of ${table} got to could not be removed from the cache.`,
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
      marker.executedAt = StoredLogScreenshots.now();

      await DataMigrationService.create({
        data: marker,
        props: {
          isRoot: true,
        },
      });
    };

  // The tables whose walk is done.
  public static async readDoneTables(): Promise<Set<StoredLogTable>> {
    const statement: StoredLogScreenshotsStatement = buildDoneMarkersStatement({
      tables: STORED_LOG_TABLES,
    });

    const names: Set<string> = new Set<string>(
      (await this.runQuery(statement.sql, statement.params)).map(
        (row: Record<string, unknown>): string => {
          return String(row["name"] || "");
        },
      ),
    );

    return new Set<StoredLogTable>(
      STORED_LOG_TABLES.filter((table: StoredLogTable): boolean => {
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
    limits?: StoredLogScreenshotsLimits | undefined;
  }): Promise<StoredLogScreenshotsSummary> {
    const budgetMs: number = data?.timeBudgetMs ?? CLEAR_TIME_BUDGET_MS;
    const limits: StoredLogScreenshotsLimits = data?.limits || DEFAULT_LIMITS;
    const startedAt: number = this.now().getTime();

    const isOutOfTime: () => boolean = (): boolean => {
      return (
        this.now().getTime() - startedAt >= budgetMs ||
        Boolean(data?.deadline?.hasPassed())
      );
    };

    const summary: StoredLogScreenshotsSummary = {
      rowsRead: 0,
      rowsTooBigToRead: 0,
      rowsCleared: 0,
      storedBytesCleared: 0,
      failedRows: 0,
      failedTables: 0,
      finishedTables: [],
      isCutShort: false,
      isEveryTableDone: false,
    };

    const doneTables: Set<StoredLogTable> = await this.readDoneTables();

    const tablesLeft: Array<StoredLogTable> = STORED_LOG_TABLES.filter(
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
        const result: StoredLogTableResult = await this.clearTable({
          table: table,
          limits: limits,
          isOutOfTime: isOutOfTime,
        });

        summary.rowsRead += result.rowsRead;
        summary.rowsTooBigToRead += result.rowsTooBigToRead;
        summary.rowsCleared += result.rowsCleared;
        summary.storedBytesCleared += result.storedBytesCleared;
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
          `Stored log screenshots: clearing the screenshots kept in ${table}.${STORED_LOG_COLUMNS[table]} failed. It is tried again next run, from where its walk got to.`,
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
  public static async clearTable(data: {
    table: StoredLogTable;
    limits?: StoredLogScreenshotsLimits | undefined;
    isOutOfTime?: (() => boolean) | undefined;
  }): Promise<StoredLogTableResult> {
    const limits: StoredLogScreenshotsLimits = data.limits || DEFAULT_LIMITS;
    const isOutOfTime: () => boolean =
      data.isOutOfTime ||
      ((): boolean => {
        return false;
      });

    const result: StoredLogTableResult = {
      table: data.table,
      rowsRead: 0,
      rowsTooBigToRead: 0,
      rowsCleared: 0,
      storedBytesCleared: 0,
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

      const candidates: Array<StoredLogCandidate> = readCandidates(
        await this.runQuery(
          candidatesStatement.sql,
          candidatesStatement.params,
        ),
      );

      /*
       * The last row every row up to which is done: the walk keeps it when
       * it stops inside the page.
       */
      let doneThrough: string | undefined = cursor;
      let hasFailed: boolean = false;
      let isCutShort: boolean = false;

      for (const batch of toReadBatches({
        candidates: candidates,
        maxRows: limits.readBatchSize,
        maxStoredBytes: limits.readBatchMaxStoredBytes,
      })) {
        if (isOutOfTime()) {
          isCutShort = true;
          break;
        }

        for (const outcome of await this.clearBatch({
          table: data.table,
          candidates: batch,
          limits: limits,
        })) {
          if (outcome.isRead) {
            result.rowsRead += 1;
          }

          if (outcome.isTooBigToRead) {
            result.rowsTooBigToRead += 1;
          }

          if (outcome.isCleared) {
            result.rowsCleared += 1;
            result.storedBytesCleared += outcome.candidate.storedBytes;
          }

          if (outcome.isFailed) {
            result.failedRows += 1;
            hasFailed = true;
          } else if (!hasFailed) {
            doneThrough = outcome.candidate.id;
          }
        }
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
   * One read batch: Postgres looks in each row's log for screenshots, and
   * only a log that holds some is read here, judged by
   * StateChangeLogScreenshots and, when it changes, written back without
   * them. A row whose write fails is logged and the others go on. A read
   * that goes past what Postgres allows one statement is asked again a row
   * at a time, and a row that still does is left as it is; a read that
   * fails otherwise fails the batch's rows, logged once.
   */
  public static async clearBatch(data: {
    table: StoredLogTable;
    candidates: Array<StoredLogCandidate>;
    limits?: StoredLogScreenshotsLimits | undefined;
  }): Promise<Array<StoredLogCandidateOutcome>> {
    const limits: StoredLogScreenshotsLimits = data.limits || DEFAULT_LIMITS;
    const column: string = STORED_LOG_COLUMNS[data.table];
    const ids: Array<string> = data.candidates.map(
      (candidate: StoredLogCandidate): string => {
        return candidate.id;
      },
    );
    let found: Map<string, Record<string, unknown>>;

    try {
      const statement: StoredLogScreenshotsStatement = buildReadLogsStatement({
        table: data.table,
        ids: ids,
        maxStoredBytes: limits.readMaxStoredBytes,
      });

      found = new Map<string, Record<string, unknown>>(
        (
          await this.runStatement({
            sql: statement.sql,
            params: statement.params,
            statementTimeoutMs: limits.statementTimeoutMs,
            lockTimeoutMs: limits.lockTimeoutMs,
          })
        ).map(
          (row: Record<string, unknown>): [string, Record<string, unknown>] => {
            return [String(row["id"] || ""), row];
          },
        ),
      );
    } catch (error) {
      if (isOverDatabaseLimits(error)) {
        // Each row alone, so one row past the limits does not hold up the rest.
        if (data.candidates.length > 1) {
          const outcomes: Array<StoredLogCandidateOutcome> = [];

          for (const candidate of data.candidates) {
            outcomes.push(
              ...(await this.clearBatch({
                table: data.table,
                candidates: [candidate],
                limits: limits,
              })),
            );
          }

          return outcomes;
        }

        logger.warn(
          `Stored log screenshots: ${data.table}.${column} of row ${ids.join(", ")} could not be looked through within the database's limits, so it is left as it is.`,
        );

        return data.candidates.map(
          (candidate: StoredLogCandidate): StoredLogCandidateOutcome => {
            return {
              candidate: candidate,
              isRead: false,
              isTooBigToRead: true,
              isCleared: false,
              isFailed: false,
            };
          },
        );
      }

      logger.error(
        `Stored log screenshots: reading ${data.table}.${column} of rows ${ids.join(", ")} failed. They are tried again next run.`,
      );
      logger.error(error);

      return data.candidates.map(
        (candidate: StoredLogCandidate): StoredLogCandidateOutcome => {
          return {
            candidate: candidate,
            isRead: false,
            isTooBigToRead: false,
            isCleared: false,
            isFailed: true,
          };
        },
      );
    }

    const outcomes: Array<StoredLogCandidateOutcome> = [];

    for (const candidate of data.candidates) {
      const row: Record<string, unknown> | undefined = found.get(candidate.id);

      /*
       * No screenshots, by Postgres - or deleted, or emptied, since the page
       * was read: nothing to clear, and nothing read.
       */
      if (!row) {
        outcomes.push({
          candidate: candidate,
          isRead: false,
          isTooBigToRead: false,
          isCleared: false,
          isFailed: false,
        });
        continue;
      }

      const text: unknown = row["log"];
      const storedBytes: number = Number(row["storedBytes"]);

      // Screenshots, but stored too big to read here: left as it is.
      if (typeof text !== "string" || !Number.isFinite(storedBytes)) {
        logger.warn(
          `Stored log screenshots: ${data.table}.${column} of row ${candidate.id} holds screenshots but is stored at ${formatStoredBytes(Number.isFinite(storedBytes) ? storedBytes : candidate.storedBytes)}, too big to read, so it is left as it is.`,
        );
        outcomes.push({
          candidate: candidate,
          isRead: false,
          isTooBigToRead: true,
          isCleared: false,
          isFailed: false,
        });
        continue;
      }

      try {
        const log: JSONValue = JSON.parse(text) as JSONValue;
        const withoutScreenshots: JSONValue =
          StateChangeLogScreenshots.leaveOut(log as JSONObject);

        // A log with no screenshots comes back as it was: left untouched.
        if (withoutScreenshots === log) {
          outcomes.push({
            candidate: candidate,
            isRead: true,
            isTooBigToRead: false,
            isCleared: false,
            isFailed: false,
          });
          continue;
        }

        const statement: StoredLogScreenshotsStatement = buildClearLogStatement(
          {
            table: data.table,
            id: candidate.id,
            log: withoutScreenshots,
            readStoredBytes: storedBytes,
          },
        );

        const written: Array<Record<string, unknown>> = await this.runStatement(
          {
            sql: statement.sql,
            params: statement.params,
            statementTimeoutMs: limits.statementTimeoutMs,
            lockTimeoutMs: limits.lockTimeoutMs,
          },
        );

        // Not written: the log was rewritten since it was read, by someone else.
        outcomes.push({
          candidate: candidate,
          isRead: true,
          isTooBigToRead: false,
          isCleared: written.length > 0,
          isFailed: false,
        });
      } catch (error) {
        logger.error(
          `Stored log screenshots: clearing ${data.table}.${column} of row ${candidate.id} failed. It is tried again next run.`,
        );
        logger.error(error);

        outcomes.push({
          candidate: candidate,
          isRead: true,
          isTooBigToRead: false,
          isCleared: false,
          isFailed: true,
        });
      }

      // One log's work at a time: let the rest of the process run.
      await EventLoop.yieldToEventLoop();
    }

    return outcomes;
  }
}
