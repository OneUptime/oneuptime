import { JSONObject } from "../JSON";

/*
 * THE TABLES A DATABASE KEEPS REFUSING, REMEMBERED BETWEEN COLLECTIONS (#9541).
 *
 * A Dataverse table the app's role may not read, or one Dataverse cannot
 * count or describe, used to be found again at every collection, every
 * five minutes, at the cost of the requests that find it: a count of fifty
 * tables halved until the one at fault is left (about 13 requests), a
 * group of twenty tables' columns read one by one (up to 20), each against
 * the app's limit of 6,000 requests in five minutes. Now a collection keeps
 * the tables it was refused, on the store (DataStore.tableHealthSkippedTables),
 * and the next ones skip them until something could have changed:
 *
 *  - each is asked again after a wait that doubles with each refusal in a
 *    row - an hour, then two, four, up to a day - and on its own, so a
 *    healthy group of tables is never split for it again;
 *  - every one is asked again at once when the environment's table list or
 *    the app reading it changes (the fingerprint), and when someone presses
 *    Collect Now;
 *  - one that reads again is dropped at once, as is one no longer watched.
 *
 * The database's page lists them, with what is not read, the database's
 * own words, and when each is asked again. This file is what the server,
 * a probe and the Dashboard share: the shape, and a strict reader for a
 * value read back from the database or sent by a probe.
 */

export enum SkippedTableRead {
  // The table's row count (Dataverse's RetrieveTotalRecordCount).
  RowCount = "RowCount",
  // The table's columns (its attribute definitions), read once an hour.
  Columns = "Columns",
  // When the table last changed (its newest row's modifiedon).
  LastChange = "LastChange",
}

export interface SkippedTable {
  // The table, as the database names it: a Dataverse table's logical name.
  table: string;
  // What is not asked of it.
  read: SkippedTableRead;
  // Why: the database's answer, in its own words.
  reason: string;
  // When it was first refused, ISO 8601.
  since: string;
  // How many times in a row it was refused: the wait doubles with each.
  refusals: number;
  // When it is asked again, ISO 8601.
  nextTryAt: string;
}

export interface SkippedTables {
  /*
   * What could change the database's answers, as the collection that
   * wrote this saw it: the environment's table list and the app reading
   * it. A collection that sees another starts every table over.
   */
  fingerprint: string;
  tables: Array<SkippedTable>;
}

// The most tables a store remembers, so its column stays small.
export const MAX_SKIPPED_TABLES: number = 200;

// The most of the database's answer a skipped table keeps.
export const MAX_SKIPPED_TABLE_REASON_LENGTH: number = 300;

// The longest table name kept.
export const MAX_SKIPPED_TABLE_NAME_LENGTH: number = 240;

// The wait after a table's first refusal; it doubles with each refusal in a row.
export const SKIPPED_TABLE_FIRST_WAIT_IN_MINUTES: number = 60;

// The longest wait: a table is asked again at least once a day.
export const SKIPPED_TABLE_LONGEST_WAIT_IN_MINUTES: number = 24 * 60;

// The longest fingerprint kept.
const MAX_FINGERPRINT_LENGTH: number = 128;

// How far ahead a next try may be: a day, and slack for a clock that is ahead.
const LONGEST_NEXT_TRY_IN_MS: number =
  (SKIPPED_TABLE_LONGEST_WAIT_IN_MINUTES + 60) * 60 * 1000;

const READS: ReadonlyArray<string> = Object.values(SkippedTableRead);

// How long a table refused this many times in a row waits before it is asked again.
export function getSkippedTableWaitInMinutes(refusals: number): number {
  const times: number = Number.isFinite(refusals)
    ? Math.max(1, Math.floor(refusals))
    : 1;

  return Math.min(
    SKIPPED_TABLE_LONGEST_WAIT_IN_MINUTES,
    SKIPPED_TABLE_FIRST_WAIT_IN_MINUTES * 2 ** Math.min(times - 1, 30),
  );
}

function readTime(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) {
    return null;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? new Date(time) : null;
}

/*
 * One skipped table, read strictly: a table, a read OneUptime knows, a
 * reason, and times that parse. A next try further ahead than the longest
 * wait (a clock ahead, a value written by hand) is read as the longest
 * wait from now, so no table is left out for longer than a day.
 */
function readSkippedTable(value: unknown, now: Date): SkippedTable | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const table: unknown = item["table"];
  const read: unknown = item["read"];
  const reason: unknown = item["reason"];
  const since: Date | null = readTime(item["since"]);
  const nextTryAt: Date | null = readTime(item["nextTryAt"]);
  const refusals: number = Number(item["refusals"]);

  if (
    typeof table !== "string" ||
    !table.trim() ||
    typeof read !== "string" ||
    !READS.includes(read) ||
    !since ||
    !nextTryAt
  ) {
    return null;
  }

  const latest: number = now.getTime() + LONGEST_NEXT_TRY_IN_MS;

  return {
    table: table.trim().slice(0, MAX_SKIPPED_TABLE_NAME_LENGTH),
    read: read as SkippedTableRead,
    reason:
      typeof reason === "string"
        ? reason.slice(0, MAX_SKIPPED_TABLE_REASON_LENGTH)
        : "",
    since: since.toISOString(),
    refusals:
      Number.isFinite(refusals) && refusals >= 1
        ? Math.min(Math.floor(refusals), 1_000)
        : 1,
    nextTryAt: new Date(Math.min(nextTryAt.getTime(), latest)).toISOString(),
  };
}

/*
 * The skipped tables a value holds - the store's column, a probe's report -
 * read strictly; null when it holds none. One table and read is kept once,
 * the first time it is named.
 */
export function readSkippedTables(
  value: unknown,
  now: Date,
): SkippedTables | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const fingerprint: unknown = item["fingerprint"];
  const tables: Array<SkippedTable> = [];
  const seen: Set<string> = new Set();

  for (const raw of Array.isArray(item["tables"])
    ? (item["tables"] as Array<unknown>)
    : []) {
    const table: SkippedTable | null = readSkippedTable(raw, now);

    if (!table) {
      continue;
    }

    const key: string = `${table.read}\u0000${table.table}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tables.push(table);

    if (tables.length >= MAX_SKIPPED_TABLES) {
      break;
    }
  }

  if (tables.length === 0) {
    return null;
  }

  return {
    fingerprint:
      typeof fingerprint === "string"
        ? fingerprint.slice(0, MAX_FINGERPRINT_LENGTH)
        : "",
    tables,
  };
}
