import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  getRowsKeptOnDelete,
  KEPT_STATUS_HISTORY_DAYS,
  RowsKeptOnDelete,
} from "../../../Types/StateTimeline/RowsKeptOnDelete";
import Text from "../../../Types/Text";

/*
 * THE ROWS OF A STATE TIMELINE A DELETE BY QUERY LEAVES, AS SQL.
 *
 * What they are, and why, is in Types/StateTimeline/RowsKeptOnDelete: each
 * record's current row and, for a status timeline, every row that covers
 * part of the last KEPT_STATUS_HISTORY_DAYS days. DatabaseService narrows a
 * delete by query to the rows outside them (keepRowsOnDeleteByQuery) before
 * it reads any row of the delete - the caller's window, a hook's, its own -
 * so the rows that stay never take a place in a window, and a delete run
 * again and again (the retention job's loop, a workflow on a schedule)
 * still reaches every row it may take.
 *
 * The condition is the row's own: it reads no other row of the delete, so
 * any query can carry it, whatever it says. Per row it costs one probe of
 * the (record, startsAt) index every state timeline has: the first row of
 * the same record after this one.
 *
 * ORDER. A row comes after another of its record when it starts later, or
 * starts at the same moment and ends later - an open row last - or, alike in
 * both, has the greater id: the order every reader takes a timeline in
 * (startsAt, then endsAt NULLS LAST; getDailyUptimeAggregate, UptimeUtil).
 * The newest row is the one no row comes after.
 *
 * IN EFFECT. A row covers time up to its end, or - an open row that is not
 * the newest, an orphan two racing writers left - up to the start of the
 * row after it, as every reader caps it. A row covers part of the kept
 * history when that end is after its start. A row with no start is kept: no
 * reader can place it, and nothing can be said of what it covers.
 *
 * Rows deleted before (deletedAt set) are never kept: no reader sees them,
 * so the retention job purges them as it purges any other table's.
 */

export interface BoundRowsKept {
  // The values the condition names, under names no other condition uses.
  parameters: Dictionary<unknown>;
  // SQL true for a row that stays, for the row whose table goes by `row` (quoted).
  sqlForRowKept: (row: string) => string;
}

export interface RowsKeptOnDeleteRule {
  tableName: string;
  kept: RowsKeptOnDelete;
  // The condition for one statement: the oldest moment kept is read here.
  bind: () => BoundRowsKept;
}

// A table, column or alias name that is safe to write into SQL as it is.
const PLAIN_IDENTIFIER: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A quoted alias as QueryIdCondition.rowAliasOf answers it: "MonitorStatusTimeline".
const QUOTED_IDENTIFIER: RegExp = /^"[A-Za-z_][A-Za-z0-9_]*"$/;

// The alias of the later row the condition looks for.
const LATER_ROW: string = '"rowKeptOnDeleteLater"';

function quoted(identifier: string): string {
  if (!PLAIN_IDENTIFIER.test(identifier)) {
    throw new BadDataException(
      `"${identifier}" is not a table or column name a state timeline can be read by.`,
    );
  }

  return `"${identifier}"`;
}

export default class StateTimelineRowsKept {
  /*
   * The rule for one state timeline table, as Types/StateTimeline lists it.
   * `now` is when the kept history ends: the clock, unless a test holds it.
   */
  public static forTable(
    tableName: string,
    options: { now?: (() => Date) | undefined } = {},
  ): RowsKeptOnDeleteRule {
    const kept: RowsKeptOnDelete | null = getRowsKeptOnDelete(tableName);

    if (!kept) {
      throw new BadDataException(
        `${tableName} is not a state timeline: nothing says which of its rows a delete keeps.`,
      );
    }

    // Checked once here, so a bad name fails when the service is made.
    quoted(tableName);
    quoted(kept.parentColumn);

    const now: () => Date =
      options.now ||
      ((): Date => {
        return OneUptimeDate.getCurrentDate();
      });

    return {
      tableName: tableName,
      kept: kept,
      bind: (): BoundRowsKept => {
        if (!kept.keepsHistoryInEffect) {
          return {
            parameters: {},
            sqlForRowKept: (row: string): string => {
              return StateTimelineRowsKept.sqlForRowKept({
                tableName: tableName,
                parentColumn: kept.parentColumn,
                row: row,
                historyFromParameter: null,
              });
            },
          };
        }

        const historyFrom: string = `keptHistoryFrom${Text.generateRandomText(10)}`;

        return {
          parameters: {
            [historyFrom]: OneUptimeDate.addRemoveDays(
              now(),
              -KEPT_STATUS_HISTORY_DAYS,
            ),
          },
          sqlForRowKept: (row: string): string => {
            return StateTimelineRowsKept.sqlForRowKept({
              tableName: tableName,
              parentColumn: kept.parentColumn,
              row: row,
              historyFromParameter: historyFrom,
            });
          },
        };
      },
    };
  }

  /*
   * SQL true for a row that stays. `row` is the row's table alias, quoted;
   * `historyFromParameter` names the bound oldest moment of the history kept
   * in full, or is null for a timeline that keeps its current row alone.
   */
  public static sqlForRowKept(data: {
    tableName: string;
    parentColumn: string;
    row: string;
    historyFromParameter: string | null;
  }): string {
    const table: string = quoted(data.tableName);
    const parent: string = quoted(data.parentColumn);

    if (!QUOTED_IDENTIFIER.test(data.row)) {
      throw new BadDataException(
        `${data.row} is not a quoted table alias a state timeline can be read by.`,
      );
    }

    const row: string = data.row;
    const later: string = LATER_ROW;

    // Postgres sorts an open row (no end) after every row that ends.
    const endOf: (alias: string) => string = (alias: string): string => {
      return `COALESCE(${alias}."endsAt", CAST('infinity' AS timestamptz))`;
    };

    /*
     * A live row of the same record that comes after this one (see ORDER),
     * meeting `alsoThat` too. The first comparison is the index's range; the
     * row comparison orders rows that start at the same moment.
     */
    const aLaterRow: (alsoThat: string) => string = (
      alsoThat: string,
    ): string => {
      return (
        `EXISTS (SELECT 1 FROM ${table} AS ${later} ` +
        `WHERE ${later}.${parent} = ${row}.${parent} ` +
        `AND ${later}."deletedAt" IS NULL ` +
        `AND ${later}."startsAt" >= ${row}."startsAt" ` +
        `AND (${later}."startsAt", ${endOf(later)}, ${later}."_id") > (${row}."startsAt", ${endOf(row)}, ${row}."_id")` +
        `${alsoThat})`
      );
    };

    if (!data.historyFromParameter) {
      // The current row: none comes after it.
      return `(${row}."deletedAt" IS NULL AND NOT ${aLaterRow("")})`;
    }

    if (!PLAIN_IDENTIFIER.test(data.historyFromParameter)) {
      throw new BadDataException(
        `"${data.historyFromParameter}" is not a parameter name a state timeline can be read by.`,
      );
    }

    const historyFrom: string = `:${data.historyFromParameter}`;

    /*
     * A row that is over: a later row exists, and the row ended by the oldest
     * moment kept - or, open, the row after it started by then (see IN
     * EFFECT). Read one way for a closed row and the other for an open one,
     * so neither scans past the first later row it needs.
     */
    const over: string =
      `(CASE WHEN ${row}."endsAt" IS NOT NULL ` +
      `THEN (${row}."endsAt" <= ${historyFrom} AND ${aLaterRow("")}) ` +
      `ELSE ${aLaterRow(` AND ${later}."startsAt" <= ${historyFrom}`)} END)`;

    return `(${row}."deletedAt" IS NULL AND NOT ${over})`;
  }
}
