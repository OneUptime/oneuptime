import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * Companion to QueryHelperOperators.test.ts (numeric/date comparison + range
 * operators) and QueryHelperManyToManyAndEmptyValues.test.ts. This file pins
 * the operators those two do not touch: the ILIKE text builders, the null /
 * inequality predicates, `modulo`, the `inRelationArray` id extractor, and
 * `queryJson`.
 *
 * The same two properties are load-bearing for all of them and neither is
 * visible from the FindOperator's JSON — the SQL is produced by a function on
 * `.value`, given the column alias:
 *
 *   1. VALUES (and jsonb KEYS) ARE BOUND, NEVER INTERPOLATED. These operators
 *      filter on user-typed text and user-named custom fields, so anything
 *      spliced into the SQL string instead of the parameter bag is an
 *      injection vector.
 *
 *   2. THE PREDICATE IS THE ONE THE NAME PROMISES. `startsWith` anchors the
 *      pattern on the left, `endsWith` on the right; `notContains` must still
 *      admit NULL rows; `notNull` binds nothing.
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
const ALIAS: string = '"Monitor"."name"';

function paramValues(operator: RawOperator): Array<unknown> {
  return Object.values(operator.objectLiteralParameters);
}

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

describe("QueryHelper null + inequality operators", () => {
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
