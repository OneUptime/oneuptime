import {
  coerceNumericColumnValue,
  isNumericTableColumnType,
} from "../../../Types/Database/NumericColumnValue";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — normalizing a JSON value bound for a number column.
 *
 * HTML has no numeric input event: `<input type="number">` hands back
 * `e.target.value`, a string. So the dashboard posted the JSON string "10"
 * for every number field, and Postgres quietly coerced '10' to 10 on the way
 * in — which is why nobody noticed until a server-side check read the value
 * BEFORE it was stored:
 *
 *   BadDataException: Sample percentage is required when the action is
 *   "Sample". Enter the percentage of matching logs to keep, between 1 and 99.
 *
 * on a form where the user had typed a percentage. HTTP 400 on a valid
 * submission. github.com/OneUptime/oneuptime/issues/3027
 */

describe("isNumericTableColumnType", () => {
  it("covers every column type stored as a plain JS number", () => {
    for (const type of [
      TableColumnType.Number,
      TableColumnType.SmallNumber,
      TableColumnType.BigNumber,
      TableColumnType.PositiveNumber,
      TableColumnType.SmallPositiveNumber,
      TableColumnType.BigPositiveNumber,
    ]) {
      expect(isNumericTableColumnType(type)).toBe(true);
    }
  });

  /*
   * The types that would be destroyed by coercion. `Port` and `Version` are
   * wrapped objects and `Date` is a Date, however numeric they look.
   */
  it("excludes types that only look numeric", () => {
    for (const type of [
      TableColumnType.Port,
      TableColumnType.Version,
      TableColumnType.Date,
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.Boolean,
      TableColumnType.ObjectID,
      TableColumnType.Entity,
      TableColumnType.EntityArray,
      TableColumnType.JSON,
    ]) {
      expect(isNumericTableColumnType(type)).toBe(false);
    }
  });

  it("treats a missing type as not numeric", () => {
    expect(isNumericTableColumnType(undefined)).toBe(false);
    expect(isNumericTableColumnType(null)).toBe(false);
  });
});

describe("coerceNumericColumnValue", () => {
  it("converts the string an <input type=number> produces", () => {
    expect(coerceNumericColumnValue("10")).toBe(10);
    expect(coerceNumericColumnValue("1")).toBe(1);
    expect(coerceNumericColumnValue("99")).toBe(99);
  });

  it("handles the shapes a browser can put in that string", () => {
    expect(coerceNumericColumnValue("0")).toBe(0);
    expect(coerceNumericColumnValue("-5")).toBe(-5);
    expect(coerceNumericColumnValue("2.5")).toBe(2.5);
    expect(coerceNumericColumnValue(" 42 ")).toBe(42);
    expect(coerceNumericColumnValue("1e3")).toBe(1000);
  });

  it("leaves a value that is already a number alone", () => {
    expect(coerceNumericColumnValue(10)).toBe(10);
    expect(coerceNumericColumnValue(0)).toBe(0);
  });

  it("leaves null and undefined alone", () => {
    expect(coerceNumericColumnValue(null)).toBeNull();
    expect(coerceNumericColumnValue(undefined)).toBeUndefined();
  });

  /*
   * `Number("")` is 0. Writing a real 0 for a field the user cleared would
   * be a silent data change, and for a sample percentage specifically, 0 is
   * the value that used to mean "throw away half". Leave it untouched and
   * let the field's own validation speak.
   */
  it("does not turn a cleared field into zero", () => {
    expect(coerceNumericColumnValue("")).toBe("");
    expect(coerceNumericColumnValue("   ")).toBe("   ");
  });

  it("leaves unparsable text alone so validation can reject it by name", () => {
    for (const garbage of ["abc", "10abc", "NaN", "Infinity", "--1", "1,000"]) {
      expect(coerceNumericColumnValue(garbage)).toBe(garbage);
    }
  });

  it("never invents a non-finite number", () => {
    const results: Array<unknown> = ["Infinity", "-Infinity", "NaN"].map(
      (value: string) => {
        return coerceNumericColumnValue(value);
      },
    );

    for (const result of results) {
      expect(typeof result).toBe("string");
    }
  });

  it("passes non-string, non-number values through untouched", () => {
    const object: Record<string, string> = { a: "1" };
    const array: Array<number> = [1];

    expect(coerceNumericColumnValue(object)).toBe(object);
    expect(coerceNumericColumnValue(array)).toBe(array);
    expect(coerceNumericColumnValue(true)).toBe(true);
  });
});
