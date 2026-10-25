import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * The two operators Security Events' connections read with:
 *
 *   startsWithAnyOf                 the hosts whose name a bare name starts
 *                                   (web-1 for web-1.acme.internal)
 *   jsonArrayObjectsHaveTextAnyOf   the cases whose entities name a value,
 *                                   however an event spelled it
 *
 * Both take values an attacker can write (a host name in an EDR event), so
 * both bind every value as a parameter, and LIKE's own characters are
 * escaped so a prefix matches only itself. Their effect on real rows is
 * pinned on Postgres (SecurityConnectionsPostgres.test.ts).
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as RawOperator;
}

describe("QueryHelper.startsWithAnyOf", () => {
  it("one case-insensitive LIKE per prefix, OR-ed", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.startsWithAnyOf(["web-1.", "db-1."]),
    );
    const sql: string = operator.getSql('"Host"."hostIdentifier"');

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");
    expect(sql.split('LOWER("Host"."hostIdentifier") LIKE :').length - 1).toBe(
      2,
    );
    expect(sql).toContain(" OR ");
    expect(sql.startsWith("(")).toBe(true);
    expect(sql.endsWith(")")).toBe(true);
  });

  it("binds each prefix, folded and trimmed, with a trailing wildcard", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.startsWithAnyOf([" WEB-1. "]),
    );
    const sql: string = operator.getSql('"Host"."hostIdentifier"');

    expect(sql).not.toContain("web-1");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      "web-1.%",
    ]);
  });

  it("escapes LIKE's own characters, so a prefix matches only itself", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.startsWithAnyOf(["web_1.", "100%", "a\\b"]),
    );

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      "web\\_1.%",
      "100\\%%",
      "a\\\\b%",
    ]);
  });

  it("never reuses a parameter name across calls", () => {
    const first: RawOperator = asRaw(QueryHelper.startsWithAnyOf(["a"]));
    const second: RawOperator = asRaw(QueryHelper.startsWithAnyOf(["a"]));

    expect(Object.keys(first.objectLiteralParameters)[0]).not.toBe(
      Object.keys(second.objectLiteralParameters)[0],
    );
  });
});

describe("QueryHelper.jsonArrayObjectsHaveTextAnyOf", () => {
  it("an EXISTS over the array's objects, the key's text folded, guarded against anything that is not an array", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.jsonArrayObjectsHaveTextAnyOf({
        key: "value",
        texts: ["web-1"],
      }),
    );
    const sql: string = operator.getSql('"SecurityCase"."entities"');

    expect(operator.type).toBe("raw");
    expect(sql).toContain(
      `jsonb_array_elements(CASE WHEN jsonb_typeof("SecurityCase"."entities") = 'array' THEN "SecurityCase"."entities" ELSE '[]'::jsonb END)`,
    );
    expect(sql).toContain("jsonb_typeof(json_array_item.item) = 'object'");
    expect(sql).toContain("LOWER(json_array_item.item ->> :");
    expect(sql).toContain("= ANY(CAST(:");
  });

  it("binds the key and the texts - folded and trimmed - and writes neither into the SQL", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.jsonArrayObjectsHaveTextAnyOf({
        key: "value') OR 1=1 --",
        texts: [" WEB-1 ", "10.0.0.5'); DROP TABLE x; --"],
      }),
    );
    const sql: string = operator.getSql('"SecurityCase"."entities"');

    expect(sql).not.toContain("WEB-1");
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("1=1");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      "value') OR 1=1 --",
      ["web-1", "10.0.0.5'); drop table x; --"],
    ]);
  });
});
