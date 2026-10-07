import { JSONObject, JSONValue } from "../JSON";
import { TableColumnMetadata } from "./TableColumn";
import TableColumnType from "./TableColumnType";

/*
 * A SWITCH WRITTEN AS TEXT IS THE SWITCH THE DATABASE STORES.
 *
 * Every Boolean column is a Postgres `boolean` (held to that by a test), and
 * Postgres reads a written value the way its boolin function does: true and
 * false, and the literals "true", "yes", "on", "1" (true) and "false", "no",
 * "off", "0" (false) - with their unique prefixes, in any case, with
 * whitespace around them. The driver sends the numbers 1 and 0 as those
 * literals. Anything else is refused with "invalid input syntax for type
 * boolean", which reached a caller as a bare 500.
 *
 * The API, Terraform, a workflow step and a script all pass a value through
 * as it was sent, so a hand-written "true" for a switch used to be stored as
 * true while every check that read the write before the database did saw a
 * string: `=== true` read it as off, `Boolean("false")` as on. The images of
 * a scheduled maintenance event created with Visible on Status Page "true"
 * stayed private and broke on its status page; an update with Archived
 * "false" was stamped as archived by the person who sent it.
 *
 * So a write's Boolean columns are turned into the booleans the database
 * stores before anything reads them - the API on the way in
 * (coerceBooleanColumnsInJSON beside the number and date coercions,
 * BaseModel.fromJSON for a create) and DatabaseService for every write,
 * whoever makes it - and a value the database would refuse is refused there,
 * with one plain message (getBooleanColumnWriteError), before any hook runs.
 * Readers that look at a value the write did not turn - a record read back,
 * an older row - read it the same way (toStoredBoolean).
 */

// Column types whose value is a JavaScript boolean.
const BOOLEAN_TABLE_COLUMN_TYPES: Set<TableColumnType> =
  new Set<TableColumnType>([TableColumnType.Boolean]);

export function isBooleanTableColumnType(
  type: TableColumnType | undefined | null,
): boolean {
  if (!type) {
    return false;
  }

  return BOOLEAN_TABLE_COLUMN_TYPES.has(type);
}

// Postgres reads these as true and false in a boolean column, and their prefixes (boolin).
const TRUE_WORDS: ReadonlyArray<string> = ["true", "yes"];
const FALSE_WORDS: ReadonlyArray<string> = ["false", "no"];

/*
 * A value written to a boolean column as Postgres stores it: true and false
 * as they are, and a literal it reads as one of them - "true", "yes", "on",
 * "1" and their unique prefixes ("t", "y"), "false", "no", "off", "0" ("f",
 * "n"), in any case and with whitespace around it - or the numbers 1 and 0,
 * which the driver sends as such literals. Anything else is returned as it
 * is: null, undefined (not written), or a value the database refuses.
 */
export function toStoredBoolean(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }

    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const text: string = value.trim().toLowerCase();

  if (text.length === 0) {
    return value;
  }

  if (text === "1" || text === "on") {
    return true;
  }

  if (text === "0" || text === "off" || text === "of") {
    return false;
  }

  // "o" alone could be on or off: Postgres refuses it.
  if (
    TRUE_WORDS.some((word: string): boolean => {
      return word.startsWith(text);
    })
  ) {
    return true;
  }

  if (
    FALSE_WORDS.some((word: string): boolean => {
      return word.startsWith(text);
    })
  ) {
    return false;
  }

  return value;
}

/*
 * Whether a Boolean column may be written with this value: true, false or
 * null (no value - whether the column takes none is the column's to say), a
 * literal the database stores as true or false (toStoredBoolean), or an SQL
 * expression - a function, which only OneUptime's own code can write, never
 * a request. Undefined writes nothing, so it is fine too.
 */
export function isWritableBooleanValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "function") {
    return true;
  }

  return typeof toStoredBoolean(value) === "boolean";
}

// The one message a Boolean column written with anything else is refused with.
export function getBooleanColumnValueMessage(columnName: string): string {
  return `${columnName} must be true or false.`;
}

/*
 * The minimum a model has to offer for its Boolean columns to be found.
 * Every DatabaseBaseModel satisfies it; asking for only this keeps the
 * coercion usable from the API layer without dragging the model class in.
 */
export interface ColumnMetadataSource {
  getTableColumnMetadata: (columnName: string) => TableColumnMetadata;
}

// Whether `columnName` is a Boolean column of the model.
function isBooleanColumn(
  model: ColumnMetadataSource,
  columnName: string,
): boolean {
  const tableColumnMetadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(columnName);

  return Boolean(
    tableColumnMetadata && isBooleanTableColumnType(tableColumnMetadata.type),
  );
}

/*
 * Coerce the Boolean columns of a write, in place: each value the database
 * would store as true or false becomes that boolean. Everything else is left
 * exactly as it is - null, undefined, the `() => string` SQL expressions a
 * PartialEntity may carry, and a value the database would refuse, which
 * getBooleanColumnWriteError then names. Columns of other types are not
 * touched. Works on a plain object of columns and on a model alike.
 */
export function coerceBooleanColumnsInJSON(
  json: JSONObject,
  model: ColumnMetadataSource,
): JSONObject {
  for (const key of Object.keys(json)) {
    if (!isBooleanColumn(model, key)) {
      continue;
    }

    const value: unknown = json[key];
    const stored: unknown = toStoredBoolean(value);

    if (stored !== value) {
      json[key] = stored as JSONValue;
    }
  }

  return json;
}

/*
 * The message to refuse a write with when one of its Boolean columns holds a
 * value no Boolean column stores (isWritableBooleanValue) - the first such
 * column, by the order the write names them - or null when there is none.
 */
export function getBooleanColumnWriteError(
  json: JSONObject,
  model: ColumnMetadataSource,
): string | null {
  for (const key of Object.keys(json)) {
    if (!isBooleanColumn(model, key)) {
      continue;
    }

    if (!isWritableBooleanValue(json[key])) {
      return getBooleanColumnValueMessage(key);
    }
  }

  return null;
}
