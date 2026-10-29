import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * listsAnyOf: a text column holding a list of values separated by commas -
 * a host's addresses ("192.168.1.42, 10.0.0.5"), a device's Other
 * Addresses - that lists any of these texts WHOLE (issue #5340: which
 * record holds an address a Traffic page shows). A substring search would
 * claim 10.0.0.1 is in "10.0.0.10, 10.0.0.2"; a whole-value match never
 * does. NetworkAddressNamesPostgres runs the SQL against real rows.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as unknown as RawOperator;
}

describe("QueryHelper.listsAnyOf", () => {
  it("splits the column's text at its commas, without case or spaces, and overlaps it with the values", () => {
    const operator: RawOperator = asRaw(QueryHelper.listsAnyOf(["10.0.0.5"]));

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const sql: string = operator.getSql('"Host"."hostIpAddresses"');

    expect(sql).toContain(
      `string_to_array(regexp_replace(LOWER(CAST("Host"."hostIpAddresses" AS TEXT)), '\\s+', '', 'g'), ',')`,
    );
    expect(sql).toContain("&& CAST(:");
    expect(sql).toContain("AS text[])");
  });

  it("binds the values as one parameter, never in the SQL", () => {
    const hostile: string = "10.0.0.5') OR TRUE --";
    const operator: RawOperator = asRaw(QueryHelper.listsAnyOf([hostile]));
    const sql: string = operator.getSql('"Host"."hostIpAddresses"');

    expect(sql).not.toContain("OR TRUE");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["10.0.0.5')ortrue--"],
    ]);
  });

  it("lowercases each value, drops its white space, and keeps each once", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.listsAnyOf([
        " 2001:DB8::5 ",
        "2001:db8::5",
        "10.0.0.5",
        "",
        "   ",
      ]),
    );

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["2001:db8::5", "10.0.0.5"],
    ]);
  });

  it("an empty list matches nothing, rather than everything", () => {
    for (const values of [[], [""], ["  "]]) {
      const operator: RawOperator = asRaw(QueryHelper.listsAnyOf(values));

      expect(operator.getSql('"Host"."hostIpAddresses"')).toBe("TRUE = FALSE");
    }
  });

  it("does not collide with another call's parameter name", () => {
    const first: RawOperator = asRaw(QueryHelper.listsAnyOf(["10.0.0.1"]));
    const second: RawOperator = asRaw(QueryHelper.listsAnyOf(["10.0.0.2"]));

    expect(Object.keys(first.objectLiteralParameters)[0]).not.toBe(
      Object.keys(second.objectLiteralParameters)[0],
    );
  });
});
