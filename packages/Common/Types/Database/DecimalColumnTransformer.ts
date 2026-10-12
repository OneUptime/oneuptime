import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * Round-trip for columns declared `ColumnType.Decimal` (Postgres `numeric`)
 * that the rest of the codebase - and the API - read as a plain number.
 *
 * node-postgres hands every numeric value back as text ("99.65", "100.00"):
 * a numeric can hold more digits than a JavaScript number, so the driver
 * does not guess. Without a transformer the model holds that text where its
 * type says `number`, and the API answers it as a JSON string,
 *
 *   "uptimePercentGreaterThanOrEqualTo": "100"
 *
 * for a field its OpenAPI spec declares a number. A client that believes
 * the spec reads it as missing: the Terraform provider read a status page
 * bar color rule's uptime percent as null, so every apply of one failed with
 * "Provider produced inconsistent result after apply" (#4719).
 *
 * `from` turns the text into the number it spells. A JavaScript number keeps
 * about 15 significant digits, and that is all the API ever writes: request
 * bodies are JSON, read into JavaScript numbers before anything stores them.
 * Text that spells no finite number (Postgres also stores 'NaN' and, since
 * 14, 'Infinity') reads as null, which JSON can carry, rather than as a
 * number JSON cannot.
 *
 * `to` passes `undefined` through untouched, so a column DEFAULT still
 * applies (BigIntColumnTransformer says why that matters), and every other
 * value - a number, numeric text, a query operator's value, a raw SQL
 * expression - goes to the driver as it came. Only a number that is not
 * finite becomes null: `String(NaN)` is the text 'NaN', which Postgres would
 * store in a numeric column as a value no reader can use.
 *
 * Every decimal column of every model reads back through a transformer like
 * this one; Tests/Types/Database/DecimalColumnsReadAsNumbers.test.ts fails
 * for a new one that does not.
 */
export function getDecimalDatabaseTransformer(): ValueTransformer {
  return {
    to: (value: unknown): unknown => {
      if (typeof value === "number" && !Number.isFinite(value)) {
        return null;
      }

      return value;
    },

    from: (value: unknown): number | null => {
      return readDecimalColumnValue(value);
    },
  };
}

/*
 * A decimal column's value as Postgres hands it over - text, or a number
 * when something already turned it into one - as the number it spells, or
 * null when it spells none.
 */
export function readDecimalColumnValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  // Number("") is 0: a blank is no value, not zero.
  if (text.length === 0) {
    return null;
  }

  const parsed: number = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}
