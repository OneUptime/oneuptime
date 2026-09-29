import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Query from "../../../../Types/BaseDatabase/Query";
import { describe, expect, it } from "@jest/globals";

/*
 * The Postgres half of the wildcard operator.
 *
 * There is ONE operator vocabulary and two executors: `StatementGenerator`
 * for ClickHouse and `QueryUtil.serializeQuery` + `QueryHelper` for Postgres.
 * An operator that reaches TypeORM without a `serializeQuery` branch does not
 * throw — it arrives as a raw class instance and silently degrades to an
 * exact equality (the documented cause of the Owner picker's "search" doing
 * nothing). So a wildcard landing on a Postgres column has to be pinned here,
 * not just on the analytics side.
 *
 * As in the sibling suites, the SQL is produced by a function on `.value`
 * given the column alias, so both properties below are invisible from the
 * FindOperator's JSON and have to be rendered to be checked.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

type AsRawFunction = (operator: unknown) => RawOperator;

const asRaw: AsRawFunction = (operator: unknown): RawOperator => {
  return operator as unknown as RawOperator;
};

const ALIAS: string = '"Monitor"."name"';

type ParamValuesFunction = (operator: RawOperator) => Array<unknown>;

const paramValues: ParamValuesFunction = (
  operator: RawOperator,
): Array<unknown> => {
  return Object.values(operator.objectLiteralParameters);
};

describe("QueryHelper.wildcard", () => {
  it("anchors a prefix glob instead of matching a substring", () => {
    const operator: RawOperator = asRaw(QueryHelper.wildcard("api-*"));

    expect(operator.getSql(ALIAS).toUpperCase()).toContain("ILIKE");
    expect(paramValues(operator)).toEqual(["api-%"]);
  });

  it.each([
    ["a*", "a%"],
    ["*a", "%a"],
    ["a*b", "a%b"],
    ["a?c", "a_c"],
  ])(
    "translates the glob %p to the pattern %p",
    (glob: string, pattern: string) => {
      expect(paramValues(asRaw(QueryHelper.wildcard(glob)))).toEqual([pattern]);
    },
  );

  it("escapes a percent the user typed, so 100%* is not a double wildcard", () => {
    expect(paramValues(asRaw(QueryHelper.wildcard("100%*")))).toEqual([
      "100\\%%",
    ]);
  });

  it("does NOT lower-case the value, which would corrupt an escape", () => {
    /*
     * The older helpers lower-case their needle, which is harmless for ILIKE
     * but would turn a `\A` escape into `\a` — a different literal.
     */
    expect(paramValues(asRaw(QueryHelper.wildcard("API-*")))).toEqual([
      "API-%",
    ]);
  });

  it("binds the pattern rather than interpolating it", () => {
    const hostile: string = "'; DROP TABLE monitor; --*";
    const operator: RawOperator = asRaw(QueryHelper.wildcard(hostile));

    expect(operator.getSql(ALIAS)).not.toContain("DROP TABLE");
    expect(paramValues(operator)).toEqual(["'; DROP TABLE monitor; --%"]);
  });
});

describe("QueryHelper.notWildcard", () => {
  it("excludes the match but keeps NULL rows", () => {
    /*
     * `NULL NOT ILIKE 'api-%'` is NULL, so without the explicit OR a row with
     * no name at all would be filtered out of "not api-*" — which is exactly
     * the set it belongs in.
     */
    const operator: RawOperator = asRaw(QueryHelper.notWildcard("api-*"));
    const sql: string = operator.getSql(ALIAS).toUpperCase();

    expect(sql).toContain("NOT ILIKE");
    expect(sql).toContain("IS NULL");
    expect(paramValues(operator)).toEqual(["api-%"]);
  });
});

describe("QueryUtil.serializeQuery routes the operator to the helper", () => {
  it("a Wildcard becomes a Raw ILIKE, not a silent equality", () => {
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: new Wildcard("api-*"),
    } as Query<Monitor>);

    const operator: RawOperator = asRaw(query["name"]);

    expect(operator.getSql(ALIAS).toUpperCase()).toContain("ILIKE");
    expect(paramValues(operator)).toEqual(["api-%"]);
  });

  it("a NotWildcard becomes the NULL-tolerant negation", () => {
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: new NotWildcard("api-*"),
    } as Query<Monitor>);

    expect(asRaw(query["name"]).getSql(ALIAS).toUpperCase()).toContain(
      "IS NULL",
    );
  });

  it("neither operator survives as a bare class instance", () => {
    /*
     * This is the failure mode the branch exists to prevent: an unhandled
     * operator reaches TypeORM as an object and quietly means `name = <the
     * object>` instead of a pattern match.
     */
    const query: Query<Monitor> = QueryUtil.serializeQuery<Monitor>(Monitor, {
      name: new Wildcard("api-*"),
    } as Query<Monitor>);

    expect(query["name"]).not.toBeInstanceOf(Wildcard);
  });
});
