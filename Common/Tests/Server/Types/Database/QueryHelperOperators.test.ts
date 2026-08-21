import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * QueryHelper turns a browser-built filter into the WHERE clause the
 * database layer runs. Two properties are load-bearing for every operator
 * here and neither is visible from the FindOperator's JSON — the SQL is
 * produced by a function on `.value`, given the column alias:
 *
 *   1. VALUES ARE BOUND, NEVER INTERPOLATED. The comparands come from
 *      user-editable filters, so an interpolated value would be an
 *      injection vector. Every test that inspects the parameter bag rather
 *      than the SQL text is guarding that.
 *
 *   2. THE OPERATOR IS THE ONE THE NAME PROMISES. `lessThan` must emit `<`,
 *      not `<=`; `inBetween` must be inclusive on both ends; the `*OrNull`
 *      variants must add an `IS NULL` branch. A wrong operator produces a
 *      query that runs, returns rows, and is silently wrong.
 *
 * These operators were previously exercised only indirectly (or not at
 * all); this file pins them directly. It complements
 * QueryHelperManyToManyAndEmptyValues.test.ts (the many-to-many + empty-
 * list operators) and QueryHelperFindWithSameTextAnyOf.test.ts.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  // TypeORM builds the SQL through this, given the column alias.
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as unknown as RawOperator;
}

// A stable alias to render every operator against.
const ALIAS: string = '"Monitor"."responseTimeInMs"';

function paramValues(operator: RawOperator): Array<unknown> {
  return Object.values(operator.objectLiteralParameters);
}

describe("QueryHelper comparison operators", () => {
  it("greaterThan emits a strict `>` and binds the value", () => {
    const op: RawOperator = asRaw(QueryHelper.greaterThan(100));
    expect(op).toBeInstanceOf(FindOperator);
    expect(op.type).toBe("raw");

    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} >`);
    // Strict: must not be `>=`.
    expect(sql).not.toContain(">=");
    // The value is bound, not interpolated.
    expect(sql).not.toContain("100");
    expect(paramValues(op)).toEqual([100]);
  });

  it("lessThan emits a strict `<` and binds the value", () => {
    const op: RawOperator = asRaw(QueryHelper.lessThan(50));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} <`);
    expect(sql).not.toContain("<=");
    expect(sql).not.toContain("50");
    expect(paramValues(op)).toEqual([50]);
  });

  it("lessThanEqualTo emits `<=`", () => {
    const op: RawOperator = asRaw(QueryHelper.lessThanEqualTo(50));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} <=`);
    expect(paramValues(op)).toEqual([50]);
  });

  it("greaterThanEqualToOrNull emits `>=` with an IS NULL branch", () => {
    const op: RawOperator = asRaw(QueryHelper.greaterThanEqualToOrNull(10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} >=`);
    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(paramValues(op)).toEqual([10]);
  });

  it("lessThanOrNull emits a strict `<` with an IS NULL branch", () => {
    const op: RawOperator = asRaw(QueryHelper.lessThanOrNull(10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} <`);
    expect(sql).not.toContain("<=");
    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(paramValues(op)).toEqual([10]);
  });

  it("lessThanEqualToOrNull emits `<=` with an IS NULL branch", () => {
    const op: RawOperator = asRaw(QueryHelper.lessThanEqualToOrNull(10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} <=`);
    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(paramValues(op)).toEqual([10]);
  });

  it("greaterThanOrNull adds an IS NULL branch and binds the value", () => {
    /*
     * NOTE: greaterThanOrNull currently renders `>=` (identical to
     * greaterThanEqualToOrNull), which reads as inconsistent with its
     * name. This test pins the two properties that are unambiguously
     * required — the value is bound and a NULL row is included — rather
     * than blessing the `>=`/`>` choice, so it will not have to change if
     * that inconsistency is later corrected.
     */
    const op: RawOperator = asRaw(QueryHelper.greaterThanOrNull(10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(ALIAS);
    expect(sql).toContain(">");
    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(sql).not.toContain("10");
    expect(paramValues(op)).toEqual([10]);
  });

  it("preserves Date comparands as Date objects in the parameter bag", () => {
    /*
     * Callers pass Date for time-column comparisons; the value must reach
     * the driver as a Date, not a pre-stringified timestamp.
     */
    const when: Date = new Date("2026-01-01T00:00:00.000Z");
    const op: RawOperator = asRaw(QueryHelper.greaterThan(when));
    expect(paramValues(op)).toEqual([when]);
    expect(paramValues(op)[0]).toBeInstanceOf(Date);
  });
});

describe("QueryHelper range operators", () => {
  it("inBetween is inclusive on both ends and binds both bounds", () => {
    const op: RawOperator = asRaw(QueryHelper.inBetween(5, 10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} >=`);
    expect(sql).toContain(`${ALIAS} <=`);
    expect(sql.toLowerCase()).toContain("and");
    // Both bounds bound as parameters, in order.
    expect(paramValues(op)).toEqual([5, 10]);
    // Two distinct parameter names so the bounds cannot alias each other.
    expect(Object.keys(op.objectLiteralParameters)).toHaveLength(2);
    expect(Object.keys(op.objectLiteralParameters)[0]).not.toBe(
      Object.keys(op.objectLiteralParameters)[1],
    );
  });

  it("inBetweenOrNull is the inclusive range OR NULL", () => {
    const op: RawOperator = asRaw(QueryHelper.inBetweenOrNull(5, 10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} >=`);
    expect(sql).toContain(`${ALIAS} <=`);
    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(sql.toLowerCase()).toContain(" or ");
    expect(paramValues(op)).toEqual([5, 10]);
  });

  it("notInBetween is the complement — strict `<` start OR strict `>` end", () => {
    const op: RawOperator = asRaw(QueryHelper.notInBetween(5, 10));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} <`);
    expect(sql).toContain(`${ALIAS} >`);
    // Complement of an inclusive range uses strict comparisons.
    expect(sql).not.toContain("<=");
    expect(sql).not.toContain(">=");
    expect(sql.toLowerCase()).toContain(" or ");
    expect(paramValues(op)).toEqual([5, 10]);
  });
});

describe("QueryHelper text operators", () => {
  it("startsWith / endsWith anchor the ILIKE pattern on the correct side", () => {
    const starts: RawOperator = asRaw(QueryHelper.startsWith("Prod"));
    const ends: RawOperator = asRaw(QueryHelper.endsWith("Prod"));

    expect(starts.getSql(ALIAS).toUpperCase()).toContain("ILIKE");
    expect(ends.getSql(ALIAS).toUpperCase()).toContain("ILIKE");

    // Pattern lives only in the parameter bag, lower-cased and anchored.
    expect(paramValues(starts)).toEqual(["prod%"]);
    expect(paramValues(ends)).toEqual(["%prod"]);
  });

  it("notContains excludes the substring but keeps NULL rows", () => {
    const op: RawOperator = asRaw(QueryHelper.notContains("Down"));
    const sql: string = op.getSql(ALIAS);
    expect(sql.toUpperCase()).toContain("NOT ILIKE");
    // A row with no value should not be excluded by a "does not contain".
    expect(sql.toUpperCase()).toContain("IS NULL");
    expect(paramValues(op)).toEqual(["%down%"]);
  });

  it("notContains lower-cases and trims the needle", () => {
    const op: RawOperator = asRaw(QueryHelper.notContains("  DOWN  "));
    expect(paramValues(op)).toEqual(["%down%"]);
  });

  it("multiSearch ORs a case-insensitive ILIKE across every property", () => {
    const op: RawOperator = asRaw(
      QueryHelper.multiSearch(["title", "description"], "Payments"),
    );
    // multiSearch derives the table alias from a `table.column` alias.
    const sql: string = op.getSql('"Incident"."title"');

    expect(sql).toContain('"Incident".title');
    expect(sql).toContain('"Incident".description');
    expect(sql.toUpperCase()).toContain("ILIKE");
    expect(sql.toUpperCase()).toContain(" OR ");
    // One shared bound parameter for all fields; value lower-cased + wrapped.
    expect(paramValues(op)).toEqual(["%payments%"]);
    expect(sql).not.toContain("Payments");
  });

  it("multiSearch handles a bare (dot-less) alias by using it directly", () => {
    const op: RawOperator = asRaw(QueryHelper.multiSearch(["name"], "abc"));
    const sql: string = op.getSql("Incident");
    expect(sql).toContain("Incident.name");
  });
});

describe("QueryHelper null + equality operators", () => {
  it("notNull emits IS NOT NULL and binds nothing", () => {
    const op: RawOperator = asRaw(QueryHelper.notNull());
    const sql: string = op.getSql(ALIAS);
    expect(sql.toUpperCase()).toContain("IS NOT NULL");
    // A pure IS NOT NULL predicate binds no parameters at all.
    expect(Object.keys(op.objectLiteralParameters ?? {})).toHaveLength(0);
  });

  it("notEquals emits `!=` and binds the value as a string", () => {
    const op: RawOperator = asRaw(QueryHelper.notEquals("active"));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} !=`);
    expect(sql).not.toContain("active");
    expect(paramValues(op)).toEqual(["active"]);
  });

  it("notEquals stringifies an ObjectID comparand", () => {
    const id: ObjectID = ObjectID.generate();
    const op: RawOperator = asRaw(QueryHelper.notEquals(id));
    expect(paramValues(op)).toEqual([id.toString()]);
    expect(typeof paramValues(op)[0]).toBe("string");
  });
});

describe("QueryHelper.modulo", () => {
  it("emits `(col % :by = :remainder)` with both operands bound", () => {
    const op: RawOperator = asRaw(QueryHelper.modulo(4, 1));
    const sql: string = op.getSql(ALIAS);
    expect(sql).toContain(`${ALIAS} %`);
    expect(sql).toContain("=");
    // Neither operand interpolated.
    expect(sql).not.toContain(" 4 ");
    const values: Array<unknown> = paramValues(op);
    expect(values).toContain(4);
    expect(values).toContain(1);
    // Two distinct parameter names.
    expect(Object.keys(op.objectLiteralParameters)).toHaveLength(2);
  });
});

describe("QueryHelper.inRelationArray", () => {
  it("returns ObjectID values unchanged", () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();
    const result: Array<any> = QueryHelper.inRelationArray([a, b]);
    expect(result).toEqual([a, b]);
  });

  it("maps a model to its id", () => {
    const id: ObjectID = ObjectID.generate();
    const model: BaseModel = new BaseModel();
    model.id = id;
    const result: Array<any> = QueryHelper.inRelationArray([model]);
    expect(result).toEqual([id]);
  });

  it("handles a mix of models and ObjectIDs", () => {
    const modelId: ObjectID = ObjectID.generate();
    const model: BaseModel = new BaseModel();
    model.id = modelId;
    const directId: ObjectID = ObjectID.generate();

    const result: Array<any> = QueryHelper.inRelationArray([model, directId]);
    expect(result).toEqual([modelId, directId]);
  });

  it("returns an empty array for empty input", () => {
    expect(QueryHelper.inRelationArray([])).toEqual([]);
  });
});

describe("QueryHelper.queryJson", () => {
  it("returns a passed-in FindOperator unchanged", () => {
    // If the caller already built an operator, queryJson must not re-wrap it.
    const existing: FindOperator<any> = QueryHelper.equalTo(
      "x",
    ) as unknown as FindOperator<any>;
    const result: unknown = QueryHelper.queryJson(existing as any);
    expect(result).toBe(existing);
  });

  it("builds a Raw operator that quotes the column and binds the value", () => {
    const op: RawOperator = asRaw(QueryHelper.queryJson({ team: "Payments" }));
    expect(op).toBeInstanceOf(FindOperator);

    // Alias arrives as `table.column`; queryJson must quote each segment.
    const sql: string = op.getSql("Incident.customFields");
    expect(sql).toContain('"Incident"."customFields"');

    /*
     * The value is a bound parameter, never spliced into the SQL text —
     * custom-field values arrive from the browser.
     */
    expect(sql).not.toContain("Payments");
    expect(paramValues(op)).toContain("Payments");
  });

  it("binds the jsonb KEY as a parameter, never interpolates it", () => {
    /*
     * The key is a user-named custom field; interpolating it would let a
     * field name inject SQL. It must appear only in the parameter bag.
     */
    const op: RawOperator = asRaw(
      QueryHelper.queryJson({ "weird key": "value" }),
    );
    const sql: string = op.getSql("Incident.customFields");
    expect(sql).not.toContain("weird key");
    expect(paramValues(op)).toContain("weird key");
  });
});
