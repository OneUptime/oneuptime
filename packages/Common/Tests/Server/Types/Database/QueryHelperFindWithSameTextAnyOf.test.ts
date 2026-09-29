import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * findWithSameTextAnyOf is the multi-value twin of findWithSameText, added
 * so a monitor's step config — where a user TYPED the identifier and an
 * agent STAMPED the row's name, and the two legitimately differ by case —
 * can resolve several identifiers in one round-trip instead of one
 * findOneBy each.
 *
 * Two properties matter and neither is visible from the operator's JSON
 * (the SQL generator is a function on `.value`): the comparison must be
 * case-folded on BOTH sides, and the identifiers must be BOUND as
 * parameters, never interpolated — they come from user-editable monitor
 * configuration.
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

describe("QueryHelper.findWithSameTextAnyOf", () => {
  it("emits a case-insensitive IN over the column", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.findWithSameTextAnyOf(["prod-01", "prod-02"]),
    );

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const sql: string = operator.getSql('"Host"."hostIdentifier"');

    // LOWER() on the column is what makes the match case-insensitive.
    expect(sql).toContain('LOWER("Host"."hostIdentifier")');
    expect(sql).toContain("IN (");
  });

  it("binds the identifiers as parameters instead of interpolating them", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.findWithSameTextAnyOf(["prod-01"]),
    );

    const sql: string = operator.getSql('"Host"."hostIdentifier"');

    /*
     * The value must appear ONLY in the parameter bag. If it showed up in
     * the SQL text, a monitor step identifier would be an injection
     * vector.
     */
    expect(sql).not.toContain("prod-01");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["prod-01"],
    ]);
  });

  it("lower-cases and trims every identifier it binds", () => {
    /*
     * The column side is lower-cased by the SQL; the value side has to be
     * lower-cased here or the comparison never matches. Whitespace comes
     * from users pasting identifiers into the monitor form.
     */
    const operator: RawOperator = asRaw(
      QueryHelper.findWithSameTextAnyOf(["  PROD-01 ", "Prod-02"]),
    );

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["prod-01", "prod-02"],
    ]);
  });

  it("does not collide with another call's parameter name", () => {
    /*
     * Both operators can land in one query (two resource types resolved
     * in the same findBy), so the random parameter key must differ.
     */
    const first: RawOperator = asRaw(QueryHelper.findWithSameTextAnyOf(["a"]));
    const second: RawOperator = asRaw(QueryHelper.findWithSameTextAnyOf(["b"]));

    expect(Object.keys(first.objectLiteralParameters)[0]).not.toBe(
      Object.keys(second.objectLiteralParameters)[0],
    );
  });
});
