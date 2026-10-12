import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { orderByColumns, outerOrderBy } from "../TestingUtils/AnalyticsOrderBy";
import { describe, expect, test } from "@jest/globals";

/*
 * The ORDER BY reader the analytics find suites share
 * (TestingUtils/AnalyticsOrderBy; AnalyticsDatabaseSortKeyBoundary and
 * AnalyticsDatabasePaginationStability). It reads each term whole, so a
 * term the statement generator writes in any other shape than a bound name
 * and a direction comes back as written and fails the suites' assertions,
 * where taking the first "{" off the term's start read past it.
 */

// A statement as the reader sees it: its text and its bound parameters.
const statementOf: (
  query: string,
  parameters?: Record<string, unknown>,
) => Statement = (
  query: string,
  parameters: Record<string, unknown> = {},
): Statement => {
  return { query: query, query_params: parameters } as unknown as Statement;
};

const FIND: string =
  "SELECT {p0:Identifier} FROM {p1:Identifier} WHERE {p2:Identifier} = {p3:String}";
const BOUNDARY_SUBQUERY: string =
  " AND {p4:Identifier} >= (SELECT {p4:Identifier} FROM {p1:Identifier} ORDER BY {p4:Identifier} DESC LIMIT 1 OFFSET 99)";

describe("outerOrderBy", () => {
  test("reads the terms of the ORDER BY, up to its LIMIT", () => {
    expect(
      outerOrderBy(
        `${FIND} ORDER BY {p5:Identifier} DESC, {p6:Identifier} DESC LIMIT 50 OFFSET 100`,
      ),
    ).toBe("{p5:Identifier} DESC, {p6:Identifier} DESC");
  });

  test("reads the last ORDER BY, past the boundary subquery's in the WHERE", () => {
    expect(
      outerOrderBy(
        `${FIND}${BOUNDARY_SUBQUERY} ORDER BY {p5:Identifier} ASC, {p6:Identifier} ASC LIMIT 50`,
      ),
    ).toBe("{p5:Identifier} ASC, {p6:Identifier} ASC");
  });

  test("reads to the end of a query with no LIMIT", () => {
    expect(outerOrderBy(`${FIND} ORDER BY {p5:Identifier} DESC`)).toBe(
      "{p5:Identifier} DESC",
    );
  });

  test("is empty for a query with no ORDER BY", () => {
    expect(outerOrderBy(`${FIND} LIMIT 50`)).toBe("");
  });
});

describe("orderByColumns", () => {
  const PARAMETERS: Record<string, unknown> = {
    p5: "time",
    p6: "_id",
  };

  test("resolves each bound term to its column, in order, whatever the numbering", () => {
    expect(
      orderByColumns(
        statementOf(
          `${FIND}${BOUNDARY_SUBQUERY} ORDER BY {p5:Identifier} DESC, {p6:Identifier} DESC LIMIT 50`,
          PARAMETERS,
        ),
      ),
    ).toStrictEqual(["time", "_id"]);
    expect(
      orderByColumns(
        statementOf(
          `${FIND} ORDER BY {p6:Identifier} ASC, {p5:Identifier} ASC LIMIT 50`,
          PARAMETERS,
        ),
      ),
    ).toStrictEqual(["_id", "time"]);
  });

  test.each([
    ["another direction", "{p5:Identifier} DESC NULLS LAST"],
    ["no direction", "{p5:Identifier}"],
    ["a name written in place", "time DESC"],
    ["a parameter that is no identifier", "{p5:String} DESC"],
    ["two terms run together", "{p5:Identifier} DESC{p6:Identifier} DESC"],
  ])(
    "returns a term with %s as written, so an assertion on the names shows it",
    (_shape: string, term: string) => {
      expect(
        orderByColumns(
          statementOf(
            `${FIND} ORDER BY ${term}, {p6:Identifier} DESC LIMIT 50`,
            PARAMETERS,
          ),
        ),
      ).toStrictEqual([term, "_id"]);
    },
  );

  test("is empty for a statement with no ORDER BY", () => {
    expect(
      orderByColumns(statementOf(`${FIND} LIMIT 50`, PARAMETERS)),
    ).toStrictEqual([]);
  });
});
