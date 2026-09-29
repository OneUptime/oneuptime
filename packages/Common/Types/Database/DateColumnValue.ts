import OneUptimeDate from "../Date";
import { JSONObject, JSONValue } from "../JSON";
import { TableColumnMetadata } from "./TableColumn";
import TableColumnType from "./TableColumnType";

/*
 * Column types whose in-memory representation is a JavaScript `Date`.
 *
 * One entry today, but named rather than compared inline so the set is
 * discoverable from the coercion below and from the tests that pin it.
 */
const DATE_TABLE_COLUMN_TYPES: Set<TableColumnType> = new Set<TableColumnType>([
  TableColumnType.Date,
]);

export function isDateTableColumnType(
  type: TableColumnType | undefined | null,
): boolean {
  if (!type) {
    return false;
  }

  return DATE_TABLE_COLUMN_TYPES.has(type);
}

/*
 * The shapes a date column may arrive in as a bare string, and only those.
 *
 * The gate is deliberately narrow. moment's fallback parser accepts almost
 * anything and invents a date for it — "12" becomes 2001-12-01 and "0"
 * becomes 2000-01-01 — so handing it every string that lands on a date column
 * would silently manufacture values. Everything the product actually produces
 * is ISO-shaped: `<input type="date">` yields "YYYY-MM-DD",
 * `<input type="datetime-local">` yields "YYYY-MM-DDTHH:mm", JSON.stringify of
 * a Date yields a Z-suffixed instant, and Postgres renders "YYYY-MM-DD
 * HH:mm:ss". Anything else is left exactly as it was.
 */
const ISO_DATE_ONLY: RegExp = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_WITHOUT_ZONE: RegExp =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?)$/;
const ISO_DATE_TIME_WITH_ZONE: RegExp =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

/*
 * Rewrite a recognised date string into an unambiguous instant, or return null
 * when it is not one of the recognised shapes.
 *
 * A string with no timezone designator is read as UTC, which is not an
 * arbitrary choice: it is exactly what happened before this coercion existed.
 * The raw string used to travel to Postgres untouched, where a `timestamptz`
 * column parses an offset-less literal in the session timezone — UTC in every
 * OneUptime deployment. Reading it as UTC here keeps the stored instant
 * identical, and makes it independent of whatever timezone the Node process
 * happens to run in, which the local-time parse in moment's default mode is
 * not.
 */
type NormalizeIsoDateStringFunction = (value: string) => string | null;

const normalizeIsoDateString: NormalizeIsoDateStringFunction = (
  value: string,
): string | null => {
  if (ISO_DATE_ONLY.test(value)) {
    return `${value}T00:00:00.000Z`;
  }

  const withoutZone: RegExpMatchArray | null = value.match(
    ISO_DATE_TIME_WITHOUT_ZONE,
  );

  if (withoutZone) {
    return `${withoutZone[1]}T${withoutZone[2]}Z`;
  }

  if (ISO_DATE_TIME_WITH_ZONE.test(value)) {
    return value.replace(" ", "T");
  }

  return null;
};

/*
 * Normalize a JSON value destined for a date column.
 *
 * The dashboard's date form field is an `<input type="date">`, and a DOM
 * input's value is a *string* — there is no Date input event in HTML. So a
 * date picked in a form reached the API as the JSON string "2027-01-01", and
 * `BaseModel.fromJSON` assigned it to the model verbatim. Postgres accepts
 * that string happily, which is why it went unnoticed on every date field in
 * the product: the string only becomes visible when something reads the column
 * back off the saved model, because TypeORM's `save()` returns the entity it
 * was handed rather than a re-read row.
 *
 * That is what broke enterprise licence creation. The row was inserted, and
 * then `EnterpriseLicenseService.onCreateSuccess` called
 * `createdItem.expiresAt.toISOString()` on a string — a TypeError, thrown
 * after the INSERT had already committed. The admin saw "Server Error" while
 * a licence row was created for every attempt.
 *
 * Normalizing here — where the column's declared type is known, on both the
 * browser side (ModelForm -> BaseModel.fromJSON) and the server side
 * (BaseAPI -> BaseModel.fromJSON) — means a date column holds a Date by the
 * time any hook, validator or query sees it. Mirrors
 * Types/Database/NumericColumnValue, which fixed the same class of bug for
 * `<input type="number">`.
 *
 * Only strings in a recognised ISO shape that parse to a valid date are
 * converted. A blank string, a garbage string and an impossible date like
 * "2027-13-45" are all left alone, so validation rejects them with a message
 * about the field instead of this function inventing a value.
 */
export function coerceDateColumnValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0) {
    return value;
  }

  const normalized: string | null = normalizeIsoDateString(trimmed);

  if (!normalized) {
    return value;
  }

  let parsed: Date;

  try {
    parsed = OneUptimeDate.fromString(normalized);
  } catch {
    return value;
  }

  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed;
}

/*
 * The minimum a model has to offer for its date columns to be found.
 * Every DatabaseBaseModel satisfies it; asking for only this keeps the
 * coercion usable from the API layer without dragging the model class in.
 */
export interface ColumnMetadataSource {
  getTableColumnMetadata: (columnName: string) => TableColumnMetadata;
}

/*
 * Coerce the date columns of a loose JSON patch, in place.
 *
 * `BaseModel.fromJSON` does this on its way to building a model, but an update
 * never builds one — `BaseAPI.updateItem` goes from the request body straight
 * to a partial entity — so without this a PUT and a POST disagree about
 * whether "2027-01-01" is a Date. That matters because the save-time hooks
 * read these values before the database gets a chance to parse them.
 *
 * Values that are not strings are left exactly as they are, including the
 * `() => string` raw SQL expressions a PartialEntity may carry.
 */
export function coerceDateColumnsInJSON(
  json: JSONObject,
  model: ColumnMetadataSource,
): JSONObject {
  for (const key of Object.keys(json)) {
    const tableColumnMetadata: TableColumnMetadata =
      model.getTableColumnMetadata(key);

    if (!tableColumnMetadata) {
      continue;
    }

    if (!isDateTableColumnType(tableColumnMetadata.type)) {
      continue;
    }

    json[key] = coerceDateColumnValue(json[key]) as JSONValue;
  }

  return json;
}
