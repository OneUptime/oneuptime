import { JSONObject, JSONValue } from "../JSON";
import { TableColumnMetadata } from "./TableColumn";
import TableColumnType from "./TableColumnType";

/*
 * Column types whose in-memory representation is a plain JavaScript number.
 *
 * Deliberately excludes the types that merely *look* numeric — `Port`,
 * `Version`, `Date` — because coercing those would destroy them.
 *
 * The declared type is not a perfect proxy for the in-memory one: an SMTP
 * port is declared `Number` but typed `Port`, and a usage figure is declared
 * `Number` but typed `Decimal`. Coercing a string to a number is safe for
 * those only because each of their transformers accepts a raw number —
 * which is a property their tests pin, not an accident.
 */
const NUMERIC_TABLE_COLUMN_TYPES: Set<TableColumnType> =
  new Set<TableColumnType>([
    TableColumnType.Number,
    TableColumnType.SmallNumber,
    TableColumnType.BigNumber,
    TableColumnType.PositiveNumber,
    TableColumnType.SmallPositiveNumber,
    TableColumnType.BigPositiveNumber,
  ]);

export function isNumericTableColumnType(
  type: TableColumnType | undefined | null,
): boolean {
  if (!type) {
    return false;
  }

  return NUMERIC_TABLE_COLUMN_TYPES.has(type);
}

/*
 * Normalize a JSON value destined for a number column.
 *
 * The dashboard's number form field is an `<input type="number">`, and a DOM
 * input's value is a *string* — there is no numeric input event in HTML. So
 * "10" typed into "Sample Percentage" reached the API as the JSON string
 * "10", and any server-side check spelled `typeof value === "number"`
 * rejected a perfectly valid form submission:
 *
 *   BadDataException: Sample percentage is required when the action is
 *   "Sample" ... between 1 and 99.
 *
 * Postgres silently coerces '10' to 10 on the way in, which is why this had
 * gone unnoticed on every other number field in the product: the string only
 * becomes visible when something reads the value before it is stored.
 *
 * Normalizing here — where the column's declared type is known, on both the
 * browser side (ModelForm -> BaseModel.fromJSON) and the server side
 * (BaseAPI -> BaseModel.fromJSON) — means a number column holds a number by
 * the time any hook, validator or query sees it.
 *
 * Only strings that parse cleanly to a finite number are converted. A blank
 * string is left alone rather than turned into `0` (`Number("")` is 0, which
 * would silently write a real value for a field the user cleared) or into
 * `null` (which would defeat a column DEFAULT the same way the bigint
 * transformer used to). Garbage like "abc" is left alone too, so validation
 * rejects it with a message about the field instead of this function
 * inventing a value.
 */
export function coerceNumericColumnValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0) {
    return value;
  }

  const parsed: number = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return value;
  }

  return parsed;
}

/*
 * The minimum a model has to offer for its number columns to be found.
 * Every DatabaseBaseModel satisfies it; asking for only this keeps the
 * coercion usable from the API layer without dragging the model class in.
 */
export interface ColumnMetadataSource {
  getTableColumnMetadata: (columnName: string) => TableColumnMetadata;
}

/*
 * Coerce the number columns of a loose JSON patch, in place.
 *
 * `BaseModel.fromJSON` does this on its way to building a model, but an
 * update never builds one — `BaseAPI.updateItem` goes from the request body
 * straight to a partial entity — so without this a PATCH and a POST
 * disagree about whether "10" is a number. That matters because the
 * save-time hooks read these values before the database gets a chance to
 * coerce them.
 *
 * Values that are not strings are left exactly as they are, including the
 * `() => string` raw SQL expressions a PartialEntity may carry.
 */
export function coerceNumericColumnsInJSON(
  json: JSONObject,
  model: ColumnMetadataSource,
): JSONObject {
  for (const key of Object.keys(json)) {
    const tableColumnMetadata: TableColumnMetadata =
      model.getTableColumnMetadata(key);

    if (!tableColumnMetadata) {
      continue;
    }

    if (!isNumericTableColumnType(tableColumnMetadata.type)) {
      continue;
    }

    json[key] = coerceNumericColumnValue(json[key]) as JSONValue;
  }

  return json;
}
