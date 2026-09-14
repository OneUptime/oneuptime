import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { describe, expect, it } from "@jest/globals";

/*
 * Fills the last two gaps in QueryHelper coverage that the sibling
 * QueryHelper*.test.ts files leave untouched: the case-insensitive single-value
 * `findWithSameText` and the parameterless `isNull` predicate.
 *
 * As with every QueryHelper operator, the SQL is produced by a function on the
 * FindOperator's `.value`, given a column alias, and the comparand must live in
 * the bound-parameter bag rather than the SQL text — these operators filter on
 * user-typed / ingest-stamped identifiers, so an interpolated value would be an
 * injection vector.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as unknown as RawOperator;
}

const ALIAS: string = '"Monitor"."name"';

function paramValues(operator: RawOperator): Array<unknown> {
  return Object.values(operator.objectLiteralParameters ?? {});
}

describe("QueryHelper.findWithSameText", () => {
  it("wraps the column in LOWER() and lower-cases a string comparand", () => {
    const op: RawOperator = asRaw(QueryHelper.findWithSameText("Production"));
    const sql: string = op.getSql(ALIAS);

    // A string comparison must be case-insensitive on BOTH sides.
    expect(sql.toUpperCase()).toContain("LOWER(");
    expect(sql).toContain(`LOWER(${ALIAS}) =`);

    // Value is bound, lower-cased, never interpolated.
    expect(sql).not.toContain("Production");
    expect(sql).not.toContain("production");
    expect(paramValues(op)).toEqual(["production"]);
  });

  it("trims surrounding whitespace off a string comparand", () => {
    const op: RawOperator = asRaw(QueryHelper.findWithSameText("  Prod  "));
    expect(paramValues(op)).toEqual(["prod"]);
  });

  it("compares a number without LOWER() and binds it as a string", () => {
    const op: RawOperator = asRaw(QueryHelper.findWithSameText(42));
    const sql: string = op.getSql(ALIAS);

    // Numbers can't be lower-cased; the column must be compared directly.
    expect(sql.toUpperCase()).not.toContain("LOWER(");
    expect(sql).toContain(`(${ALIAS} =`);

    // The value is still routed through the parameter bag, stringified.
    expect(sql).not.toContain("42");
    expect(paramValues(op)).toEqual(["42"]);
  });

  it("binds exactly one parameter", () => {
    const op: RawOperator = asRaw(QueryHelper.findWithSameText("anything"));
    expect(Object.keys(op.objectLiteralParameters)).toHaveLength(1);
  });
});

describe("QueryHelper.isNull", () => {
  it("emits IS NULL and binds nothing", () => {
    const op: RawOperator = asRaw(QueryHelper.isNull());
    const sql: string = op.getSql(ALIAS);

    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(sql.toUpperCase()).not.toContain("IS NOT NULL");
    expect(sql).toContain(ALIAS);

    // A pure IS NULL predicate has no comparand to bind.
    expect(Object.keys(op.objectLiteralParameters ?? {})).toHaveLength(0);
  });
});
