import { toStoredBoolean } from "../../../Types/Database/BooleanColumnValue";
import TableColumnType from "../../../Types/Database/TableColumnType";
import JSONFunctions from "../../../Types/JSONFunctions";
import RelationValueUtil from "./RelationValueUtil";

/*
 * WHETHER AN UPDATE CHANGES WHAT A COLUMN HOLDS.
 *
 * Updates often write back what a record holds: an edit form sends every
 * field it shows, its switches among them, with each save; Terraform sends a
 * resource's whole state on every apply; a workflow or an API client may
 * write the whole record. What follows a change - the record's on-update
 * workflows, its live update and who hears it, its audit entry - must follow
 * a real one, so DatabaseService asks this of each column an update writes,
 * against the row as the read before the write found it (hasSameValues).
 *
 * Each column is compared as it is stored:
 *
 * - A column the update sends as undefined writes nothing (TypeORM leaves it
 *   out of the UPDATE), so it changes nothing.
 * - An SQL expression OneUptime writes itself (a function) is worked out by
 *   the database, so it is never known to leave the column as it is.
 * - A relation is the set of rows it names, whatever shape each is spelled
 *   in (RelationValueUtil); one that names none falls through to below.
 * - No value is no value: null, or a column the read did not load. Two of
 *   those are the same, and no value is not the same as any value - a switch
 *   set to null where it was off has changed what the database holds, and so
 *   has an empty text where there was none.
 * - JSON by its content, whatever order its keys are in.
 * - A switch as the boolean the database stores (toStoredBoolean): false is
 *   false - the comparison used to read false, 0 and "" as no value, so
 *   writing a switch back as off counted as a change - and a "false" written
 *   by hand is false too.
 * - A time as the instant it names, to the millisecond: the same instant sent
 *   as a Date or as an ISO string in another time zone is the same time.
 * - Anything else by its text, so an id and its ObjectID are the same value.
 */
export default class ColumnValueChange {
  public static isChanged(data: {
    columnType: TableColumnType | undefined | null;
    // What the column holds, as the read before the write returned it.
    storedValue: unknown;
    // What the update writes to it.
    writtenValue: unknown;
  }): boolean {
    const stored: unknown = data.storedValue;
    const written: unknown = data.writtenValue;

    if (written === undefined) {
      return false;
    }

    if (typeof written === "function") {
      return true;
    }

    if (
      data.columnType === TableColumnType.Entity ||
      data.columnType === TableColumnType.EntityArray
    ) {
      const sameRelationIds: boolean | null =
        RelationValueUtil.haveSameRelationIds(stored, written);

      if (sameRelationIds !== null) {
        return !sameRelationIds;
      }
    }

    const isStoredEmpty: boolean = stored === null || stored === undefined;
    const isWrittenEmpty: boolean = written === null;

    if (isStoredEmpty || isWrittenEmpty) {
      return !(isStoredEmpty && isWrittenEmpty);
    }

    if (data.columnType === TableColumnType.JSON) {
      return !JSONFunctions.deepEqual(stored, written);
    }

    if (data.columnType === TableColumnType.Boolean) {
      const storedSwitch: unknown = toStoredBoolean(stored);
      const writtenSwitch: unknown = toStoredBoolean(written);

      if (
        typeof storedSwitch === "boolean" &&
        typeof writtenSwitch === "boolean"
      ) {
        return storedSwitch !== writtenSwitch;
      }
    }

    if (data.columnType === TableColumnType.Date) {
      const storedInstant: number | null = this.toInstant(stored);
      const writtenInstant: number | null = this.toInstant(written);

      if (storedInstant !== null && writtenInstant !== null) {
        return storedInstant !== writtenInstant;
      }
    }

    /*
     * `toString()` so a wrapped value (an ObjectID) and its raw form (a
     * string) compare as the value they are.
     */
    return String(stored) !== String(written);
  }

  /*
   * The instant a time names, in milliseconds: a Date, an ISO string or a
   * number of milliseconds. Null for anything that names none.
   */
  private static toInstant(value: unknown): number | null {
    let instant: number = NaN;

    if (value instanceof Date) {
      instant = value.getTime();
    } else if (typeof value === "number") {
      instant = value;
    } else if (typeof value === "string" && value.trim()) {
      instant = new Date(value.trim()).getTime();
    }

    return Number.isFinite(instant) ? instant : null;
  }
}
