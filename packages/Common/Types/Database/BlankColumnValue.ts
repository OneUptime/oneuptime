import { JSONObject, JSONValue } from "../JSON";
import { isDateTableColumnType } from "./DateColumnValue";
import {
  ColumnMetadataSource,
  isNumericTableColumnType,
} from "./NumericColumnValue";
import { TableColumnMetadata } from "./TableColumn";
import TableColumnType from "./TableColumnType";

/*
 * WHAT AN EMPTIED NUMBER, DATE OR PORT BOX IS SAVED AS.
 *
 * A form's number box is an <input type="number">, and a DOM input's value
 * is a string: emptied, it hands the form "", and so does an emptied date
 * or port box. A number, date or port column cannot hold "" - Postgres
 * refuses it ("invalid input syntax for type integer"), so emptying an
 * optional number on a form failed the save with an error about a column
 * the reader did not know was wrong. The server leaves a blank alone on
 * purpose (NumericColumnValue: turned into 0 or null there, it would write
 * a value nobody chose, or defeat a column's default), so the form, which
 * knows the reader emptied the box, says what the blank means:
 *
 *   - a column that may be empty: none (null) - "Leave empty for no limit",
 *     "Leave empty to not track it" - on a Create form and an Edit form
 *     alike, whatever the box showed before (a default, a stored value);
 *   - a column that may not be empty: the column's default - a sample
 *     percentage's 100, a budget's 0 - which is what an untouched Create
 *     form would have saved;
 *   - a column that may not be empty and has no default: nothing is sent,
 *     so an Edit keeps what is stored and a Create is told what is missing.
 *
 * Only a blank: every other value, and every other column, is left exactly
 * as it is. Run by ModelForm on what it is about to send, for every form in
 * the product - it replaces the page-by-page fixes the SLA rules and the
 * session replay policy carried.
 */

const COLUMN_TYPES_THAT_CANNOT_HOLD_A_BLANK: Set<TableColumnType> =
  new Set<TableColumnType>([TableColumnType.Port]);

// Whether a column of this type can never store an empty string.
export function cannotHoldBlank(
  type: TableColumnType | undefined | null,
): boolean {
  if (!type) {
    return false;
  }

  return (
    isNumericTableColumnType(type) ||
    isDateTableColumnType(type) ||
    COLUMN_TYPES_THAT_CANNOT_HOLD_A_BLANK.has(type)
  );
}

// What an emptied box hands the form: a string with nothing in it.
export function isBlankFormValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length === 0;
}

/*
 * The blanks of a form's values, for the columns that cannot hold one,
 * replaced with what they mean (see above). In place; returns the values.
 */
export function clearBlankColumnValues(
  json: JSONObject,
  model: ColumnMetadataSource,
): JSONObject {
  for (const key of Object.keys(json)) {
    if (!isBlankFormValue(json[key])) {
      continue;
    }

    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(key);

    if (!metadata || !cannotHoldBlank(metadata.type)) {
      continue;
    }

    if (!metadata.required) {
      json[key] = null;
      continue;
    }

    if (metadata.defaultValue !== undefined && metadata.defaultValue !== null) {
      json[key] = metadata.defaultValue as JSONValue;
      continue;
    }

    delete json[key];
  }

  return json;
}
