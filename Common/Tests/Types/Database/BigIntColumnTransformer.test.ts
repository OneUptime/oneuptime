import { getBigIntDatabaseTransformer } from "../../../Types/Database/BigIntColumnTransformer";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the Postgres bigint round-trip used by counter
 * columns.
 *
 * The interesting half is `to(undefined)`. TypeORM applies a column
 * transformer BEFORE it decides whether the column was supplied at all:
 *
 *   InsertQueryBuilder.createColumnValueExpression
 *     -> driver.preparePersistentValue   (runs transformer.to)
 *     -> if (value === undefined) expression += "DEFAULT"
 *
 * so a transformer that answers `null` for `undefined` has already turned
 * "the caller did not set this column" into "the caller set it to NULL" by
 * the time that check runs, and the column DEFAULT is unreachable. On the
 * drop-filter `droppedCount` columns — NOT NULL DEFAULT 0, written only by
 * the ingest path — that made every single insert fail:
 *
 *   null value in column "droppedCount" of relation "LogDropFilter"
 *   violates not-null constraint
 *
 * i.e. creating any log drop filter in the dashboard returned HTTP 500.
 * github.com/OneUptime/oneuptime/issues/3026
 */

const transformer: ValueTransformer = getBigIntDatabaseTransformer();

describe("getBigIntDatabaseTransformer().to", () => {
  /*
   * The regression. `undefined` and `null` are NOT interchangeable here:
   * one means "use the column default", the other means "write NULL".
   */
  it("passes undefined through so the column DEFAULT applies", () => {
    expect(transformer.to(undefined)).toBeUndefined();
  });

  it("does not confuse undefined with null", () => {
    expect(transformer.to(undefined)).not.toBeNull();
  });

  it("keeps an explicit null as null", () => {
    expect(transformer.to(null)).toBeNull();
  });

  it("stringifies a number, because the pg driver binds bigint as text", () => {
    expect(transformer.to(0)).toBe("0");
    expect(transformer.to(1)).toBe("1");
    expect(transformer.to(42)).toBe("42");
  });

  it("truncates rather than emitting a decimal Postgres would reject", () => {
    expect(transformer.to(10.9)).toBe("10");
    expect(transformer.to(-10.9)).toBe("-10");
  });

  /*
   * The reason these columns are bigint at all: a sample filter on a
   * high-volume project passes 2^31 well within a year, and a silently
   * wrapped diagnostic counter is worse than no counter.
   */
  it("carries a value past the 32-bit range without losing precision", () => {
    expect(transformer.to(4_294_967_296)).toBe("4294967296");
    expect(transformer.to(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
  });

  /*
   * `Math.trunc(NaN).toString()` is the string "NaN", which Postgres
   * rejects with a syntax error naming neither the column nor the caller.
   */
  it("refuses to emit a non-finite value as text", () => {
    expect(transformer.to(NaN)).toBeNull();
    expect(transformer.to(Infinity)).toBeNull();
    expect(transformer.to(-Infinity)).toBeNull();
  });
});

describe("getBigIntDatabaseTransformer().from", () => {
  /*
   * node-postgres hands bigint back as a string — it does not fit a JS
   * number in the general case. Every value stored in these counters is
   * inside MAX_SAFE_INTEGER, and the dashboard renders them as numbers.
   */
  it("parses the string the driver returns into a number", () => {
    expect(transformer.from("0")).toBe(0);
    expect(transformer.from("42")).toBe(42);
    expect(transformer.from("9007199254740991")).toBe(9007199254740991);
  });

  it("accepts a number unchanged, in case a driver already parsed it", () => {
    expect(transformer.from(7)).toBe(7);
  });

  it("maps a null column to null rather than 0", () => {
    expect(transformer.from(null)).toBeNull();
    expect(transformer.from(undefined)).toBeNull();
  });

  it("maps unparsable text to null rather than NaN", () => {
    expect(transformer.from("not a number")).toBeNull();
    expect(transformer.from("")).toBeNull();
  });

  it("round-trips a counter value", () => {
    for (const value of [0, 1, 999, 4_294_967_296]) {
      expect(transformer.from(transformer.to(value))).toBe(value);
    }
  });
});

/*
 * A miniature of TypeORM's own decision, so the consequence of the
 * transformer's answer is asserted rather than left to a comment. Mirrors
 * PostgresDriver.preparePersistentValue followed by
 * InsertQueryBuilder.createColumnValueExpression.
 */
describe("the INSERT expression TypeORM derives from this transformer", () => {
  type InsertExpression = "DEFAULT" | "NULL" | string;

  function insertExpressionFor(value: number | null | undefined): string {
    const prepared: unknown = transformer.to(value);

    if (prepared === undefined) {
      return "DEFAULT";
    }

    if (prepared === null) {
      return "NULL";
    }

    return String(prepared);
  }

  it("emits DEFAULT for a counter the caller never set", () => {
    const expression: InsertExpression = insertExpressionFor(undefined);

    expect(expression).toBe("DEFAULT");
    // The old inline transformer produced this, and NOT NULL rejected it.
    expect(expression).not.toBe("NULL");
  });

  it("emits the value for a counter the caller did set", () => {
    expect(insertExpressionFor(5)).toBe("5");
  });
});
