import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * The numeric/date comparison builders on QueryHelper (greaterThan,
 * lessThanEqualTo, inBetween, and their `...OrNull` siblings) each compile to a
 * TypeORM `Raw` FindOperator whose entire contract is the SQL fragment it
 * renders. That fragment is NOT visible from the operator's JSON: TypeORM hides
 * the SQL behind a `getSql(alias)` generator and the bound value behind
 * `objectLiteralParameters`. So every test here reaches through the operator to
 * those two surfaces and asserts the EXACT predicate string.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 *  1. THE OPERATOR CHARACTER. `>` and `>=` differ by one boundary row, and the
 *     names encode which one is meant: a bare `greaterThan` / `lessThan` (and
 *     their `...OrNull` forms) are STRICT, while the `...EqualTo` forms are
 *     INCLUSIVE. `greaterThanOrNull` once emitted `>=` by a copy-paste slip,
 *     making it a silent duplicate of `greaterThanEqualToOrNull`; these tests
 *     pin the strict `>` so that can't regress.
 *
 *  2. THE VALUE IS BOUND, NOT INLINED. The compared value must live only in the
 *     parameter bag, never spliced into the SQL text, or it would be an
 *     injection vector. A fresh parameter name is minted per call so two
 *     filters can coexist in one query.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  /* TypeORM renders the SQL through this, given the column alias. */
  getSql: (aliasPath: string) => string;
}

const asRaw: (operator: unknown) => RawOperator = (
  operator: unknown,
): RawOperator => {
  return operator as unknown as RawOperator;
};

/* A representative column alias, quoted the way TypeORM passes it in. */
const ALIAS: string = '"MonitorStatusTimeline"."endsAt"';

/* The single bound parameter name (operators here mint one, except inBetween). */
const soleParamName: (operator: RawOperator) => string = (
  operator: RawOperator,
): string => {
  const keys: Array<string> = Object.keys(operator.objectLiteralParameters);
  expect(keys).toHaveLength(1);
  return keys[0]!;
};

describe("QueryHelper comparison operators — exact rendered SQL", () => {
  describe("greaterThan / greaterThanEqualTo (no null arm)", () => {
    it("greaterThan emits a STRICT `>` with the value bound", () => {
      const operator: RawOperator = asRaw(QueryHelper.greaterThan(5));

      expect(operator).toBeInstanceOf(FindOperator);
      expect(operator.type).toBe("raw");

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(`(${ALIAS} > :${param})`);
      expect(operator.objectLiteralParameters[param]).toBe(5);
    });

    it("greaterThanEqualTo emits an INCLUSIVE `>=`", () => {
      const operator: RawOperator = asRaw(QueryHelper.greaterThanEqualTo(5));

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(`(${ALIAS} >= :${param})`);
    });

    it("greaterThan is strictly `>` — never the inclusive `>=`", () => {
      const sql: string = asRaw(QueryHelper.greaterThan(5)).getSql(ALIAS);

      expect(sql).toContain("> :");
      expect(sql).not.toContain(">=");
      expect(sql).not.toContain("IS NULL");
    });
  });

  describe("lessThan / lessThanEqualTo (no null arm)", () => {
    it("lessThan emits a STRICT `<`", () => {
      const operator: RawOperator = asRaw(QueryHelper.lessThan(5));

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(`(${ALIAS} < :${param})`);
    });

    it("lessThanEqualTo emits an INCLUSIVE `<=`", () => {
      const operator: RawOperator = asRaw(QueryHelper.lessThanEqualTo(5));

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(`(${ALIAS} <= :${param})`);
    });

    it("lessThan is strictly `<` — never the inclusive `<=`", () => {
      const sql: string = asRaw(QueryHelper.lessThan(5)).getSql(ALIAS);

      expect(sql).toContain("< :");
      expect(sql).not.toContain("<=");
      expect(sql).not.toContain("IS NULL");
    });
  });

  describe("`...OrNull` forms add an `IS NULL` arm and keep the name's operator", () => {
    it("greaterThanOrNull emits a STRICT `>` OR IS NULL (the copy-paste-bug regression guard)", () => {
      const operator: RawOperator = asRaw(QueryHelper.greaterThanOrNull(5));

      const param: string = soleParamName(operator);
      /*
       * The whole point of the fix: the name says "greater than", so the
       * operator must be a strict `>`, not the `>=` it used to render.
       */
      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} > :${param} or ${ALIAS} IS NULL)`,
      );
    });

    it("greaterThanOrNull does NOT render `>=` — it is not a duplicate of greaterThanEqualToOrNull", () => {
      const sql: string = asRaw(QueryHelper.greaterThanOrNull(5)).getSql(ALIAS);

      expect(sql).toContain("> :");
      expect(sql).not.toContain(">=");
    });

    it("greaterThanEqualToOrNull emits an INCLUSIVE `>=` OR IS NULL", () => {
      const operator: RawOperator = asRaw(
        QueryHelper.greaterThanEqualToOrNull(5),
      );

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} >= :${param} or ${ALIAS} IS NULL)`,
      );
    });

    it("greaterThanOrNull and greaterThanEqualToOrNull now render DIFFERENT operators", () => {
      /*
       * Before the fix these two produced byte-identical SQL. Bind the same
       * value into both, normalize away the random parameter name, and assert
       * the strings genuinely diverge — one strict, one inclusive.
       */
      const strict: RawOperator = asRaw(QueryHelper.greaterThanOrNull(5));
      const inclusive: RawOperator = asRaw(
        QueryHelper.greaterThanEqualToOrNull(5),
      );

      const normalize: (op: RawOperator) => string = (
        op: RawOperator,
      ): string => {
        return op.getSql(ALIAS).replace(`:${soleParamName(op)}`, ":P");
      };

      expect(normalize(strict)).toBe(`(${ALIAS} > :P or ${ALIAS} IS NULL)`);
      expect(normalize(inclusive)).toBe(`(${ALIAS} >= :P or ${ALIAS} IS NULL)`);
      expect(normalize(strict)).not.toBe(normalize(inclusive));
    });

    it("lessThanOrNull emits a STRICT `<` OR IS NULL", () => {
      const operator: RawOperator = asRaw(QueryHelper.lessThanOrNull(5));

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} < :${param} or ${ALIAS} IS NULL)`,
      );
    });

    it("lessThanEqualToOrNull emits an INCLUSIVE `<=` OR IS NULL", () => {
      const operator: RawOperator = asRaw(
        QueryHelper.lessThanEqualToOrNull(5),
      );

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} <= :${param} or ${ALIAS} IS NULL)`,
      );
    });

    it("the strict `...OrNull` pair (greater/less) are mirror images", () => {
      /*
       * greaterThanOrNull is to `>` what lessThanOrNull is to `<`. Locking them
       * together makes an accidental flip of just one obvious.
       */
      const greater: RawOperator = asRaw(QueryHelper.greaterThanOrNull(5));
      const less: RawOperator = asRaw(QueryHelper.lessThanOrNull(5));

      const swap: (op: RawOperator) => string = (op: RawOperator): string => {
        return op.getSql(ALIAS).replace(`:${soleParamName(op)}`, ":P");
      };

      expect(swap(greater)).toBe(`(${ALIAS} > :P or ${ALIAS} IS NULL)`);
      expect(swap(less)).toBe(`(${ALIAS} < :P or ${ALIAS} IS NULL)`);
    });
  });

  describe("range operators", () => {
    it("inBetween is an inclusive `>=` … `<=` band binding both bounds", () => {
      const operator: RawOperator = asRaw(QueryHelper.inBetween(1, 9));

      const keys: Array<string> = Object.keys(
        operator.objectLiteralParameters,
      );
      expect(keys).toHaveLength(2);
      const [lo, hi] = keys as [string, string];

      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} >= :${lo} and ${ALIAS} <= :${hi})`,
      );
      expect(operator.objectLiteralParameters[lo]).toBe(1);
      expect(operator.objectLiteralParameters[hi]).toBe(9);
    });

    it("inBetweenOrNull ORs the inclusive band with an IS NULL arm", () => {
      const operator: RawOperator = asRaw(QueryHelper.inBetweenOrNull(1, 9));

      const [lo, hi] = Object.keys(operator.objectLiteralParameters) as [
        string,
        string,
      ];

      expect(operator.getSql(ALIAS)).toBe(
        `(((${ALIAS} >= :${lo} and ${ALIAS} <= :${hi})) or (${ALIAS} IS NULL))`,
      );
    });

    it("notInBetween is the strict `<` … `>` complement of the band", () => {
      const operator: RawOperator = asRaw(QueryHelper.notInBetween(1, 9));

      const [lo, hi] = Object.keys(operator.objectLiteralParameters) as [
        string,
        string,
      ];

      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} < :${lo} or ${ALIAS} > :${hi})`,
      );
    });
  });

  describe("value binding and parameter hygiene", () => {
    it("never inlines the compared value into the SQL text", () => {
      const operator: RawOperator = asRaw(QueryHelper.greaterThanOrNull(12345));

      const sql: string = operator.getSql(ALIAS);
      expect(sql).not.toContain("12345");
      expect(Object.values(operator.objectLiteralParameters)).toEqual([12345]);
    });

    it("binds a Date value at full precision, unchanged", () => {
      const when: Date = new Date("2026-07-21T14:35:12.345Z");
      const operator: RawOperator = asRaw(QueryHelper.greaterThanOrNull(when));

      const param: string = soleParamName(operator);
      expect(operator.getSql(ALIAS)).toBe(
        `(${ALIAS} > :${param} or ${ALIAS} IS NULL)`,
      );
      expect(operator.objectLiteralParameters[param]).toBe(when);
    });

    it("mints a fresh parameter name per call so two filters can share one query", () => {
      const first: RawOperator = asRaw(QueryHelper.greaterThanOrNull(1));
      const second: RawOperator = asRaw(QueryHelper.greaterThanOrNull(2));

      expect(soleParamName(first)).not.toBe(soleParamName(second));
    });
  });
});
