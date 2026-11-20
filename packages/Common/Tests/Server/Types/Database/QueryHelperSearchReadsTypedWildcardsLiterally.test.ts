import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Search from "../../../../Types/BaseDatabase/Search";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import Query from "../../../../Types/BaseDatabase/Query";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A POSTGRES SEARCH READS A TYPED % OR _ AS ITSELF (#10545).
 *
 * Contains, does not contain, starts with, ends with and a search over
 * several columns put what was typed between LIKE wildcards as it was, so a
 * `%` someone typed matched any run of characters and an `_` any one: "100%
 * full" in a Postgres list also matched "100 is not full", while the
 * ClickHouse chart beside it, whose compiler escapes them, matched it
 * literally. Each now escapes them (and a backslash), as searchAllWords and
 * the search grammar's own wildcard already did. The needle is still
 * lowercased and trimmed, as it was.
 * ---------------------------------------------------------------------------
 */

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

const paramsOf: (operator: unknown) => Array<unknown> = (
  operator: unknown,
): Array<unknown> => {
  return Object.values((operator as RawOperator).objectLiteralParameters);
};

describe("each helper escapes what was typed", () => {
  it.each([
    ["contains", QueryHelper.search, "100% Full", "%100\\% full%"],
    ["does not contain", QueryHelper.notContains, "user_id", "%user\\_id%"],
    ["starts with", QueryHelper.startsWith, "50%_", "50\\%\\_%"],
    ["ends with", QueryHelper.endsWith, "C:\\temp", "%c:\\\\temp"],
  ])(
    "%s",
    (
      _helper: string,
      helper: (value: string) => unknown,
      typed: string,
      pattern: string,
    ) => {
      expect(paramsOf(helper(typed))).toEqual([pattern]);
    },
  );

  it("a search over several columns too", () => {
    expect(
      paramsOf(QueryHelper.multiSearch(["name", "description"], " 100%_x ")),
    ).toEqual(["%100\\%\\_x%"]);
  });

  it("a needle with nothing to escape reads as it always did", () => {
    expect(paramsOf(QueryHelper.search("  Payments  "))).toEqual([
      "%payments%",
    ]);
    expect(paramsOf(QueryHelper.startsWith("Prod"))).toEqual(["prod%"]);
  });
});

describe("a query's operators reach the escaping helpers", () => {
  it.each([
    ["contains", new Search("a_b%")],
    ["does not contain", new NotContains("a_b%")],
    ["starts with", new StartsWith("a_b%")],
    ["ends with", new EndsWith("a_b%")],
  ])("%s", (_operator: string, value: unknown) => {
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: value,
    } as Query<Monitor>);

    expect(String(paramsOf(query["name"])[0])).toContain("a\\_b\\%");
  });
});
