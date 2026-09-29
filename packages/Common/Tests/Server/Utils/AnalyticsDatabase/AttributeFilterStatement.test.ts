import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import appendAttributeOperatorFilter from "../../../../Server/Utils/AnalyticsDatabase/AttributeFilterStatement";
import "../../TestingUtils/Init";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { ObjectType } from "../../../../Types/JSON";
import { MAX_WILDCARD_PATTERNS } from "../../../../Types/BaseDatabase/WildcardPattern";
import { describe, expect, test } from "@jest/globals";

/*
 * appendAttributeOperatorFilter is the single seam that turns a serialized
 * QueryOperator ({_type, value}) arriving as JSON into a ClickHouse map
 * predicate for the hand-written aggregation builders. The list query for the
 * same signal is compiled separately by StatementGenerator, so a divergence
 * here is exactly the "the chart and the table disagree on the same filter"
 * bug the module exists to prevent.
 *
 * Two properties matter most and are asserted throughout:
 *   1. Parameterization — the user's value is ALWAYS bound as a {pN:...}
 *      placeholder and never spliced into the SQL text. A regression that
 *      inlined it would be a ClickHouse injection.
 *   2. Refusal, not coercion — an operator or value the builder cannot honour
 *      raises BadDataException (a 400), never a TypeError/500 and never a
 *      silently-wrong predicate.
 */

const ATTR: string = "http.method";

// Run the filter against a fresh statement and return it for inspection.
function run(operator: Record<string, unknown>): Statement {
  const statement: Statement = SQL`WHERE true`;
  appendAttributeOperatorFilter({ statement, attributeKey: ATTR, operator });
  return statement;
}

describe("appendAttributeOperatorFilter", () => {
  describe("case-insensitive key matching (shared by every predicate)", () => {
    test("matches the attribute key case-insensitively as a bound param", () => {
      const statement: Statement = run({
        _type: ObjectType.EqualTo,
        value: "GET",
      });

      /*
       * The key is compared with lowerUTF8 on both sides so requestId and
       * requestid are the same filter.
       */
      expect(statement.query).toContain(
        "lowerUTF8(k) = lowerUTF8({p0:String})",
      );
      expect(statement.query).toContain("mapKeys(attributes)");
      expect(statement.query).toContain("mapValues(attributes)");
      // The key itself is a bound parameter, never inlined.
      expect(statement.query_params["p0"]).toBe(ATTR);
      expect(statement.query).not.toContain(ATTR);
    });
  });

  describe("EqualTo / NotEqual", () => {
    test("EqualTo binds the value and never inlines it", () => {
      const statement: Statement = run({
        _type: ObjectType.EqualTo,
        value: "GET",
      });

      expect(statement.query).toContain("arrayExists");
      expect(statement.query).toContain("v = {p1:String}");
      expect(statement.query_params["p1"]).toBe("GET");
      // The raw value must not appear as SQL text (injection guard).
      expect(statement.query).not.toContain("GET");
    });

    test("EqualTo with an empty value means 'is empty' (NOT non-empty)", () => {
      const statement: Statement = run({
        _type: ObjectType.EqualTo,
        value: "",
      });

      expect(statement.query).toContain("AND NOT ");
      expect(statement.query).toContain("v != ''");
    });

    test("NotEqual with a value negates the existence test so missing keys pass", () => {
      const statement: Statement = run({
        _type: ObjectType.NotEqual,
        value: "GET",
      });

      expect(statement.query).toContain("AND NOT ");
      expect(statement.query).toContain("v = {p1:String}");
      expect(statement.query_params["p1"]).toBe("GET");
    });

    test("NotEqual with an empty value means 'is not empty'", () => {
      const statement: Statement = run({
        _type: ObjectType.NotEqual,
        value: "",
      });

      // Not the negated form — the present-and-non-empty set.
      expect(statement.query).not.toContain("NOT ");
      expect(statement.query).toContain("v != ''");
    });
  });

  describe("text LIKE operators escape the value and bind the pattern", () => {
    test("Search wraps the value in %…% and binds it via ILIKE", () => {
      const statement: Statement = run({
        _type: ObjectType.Search,
        value: "web",
      });

      expect(statement.query).toContain("v ILIKE {p1:String}");
      expect(statement.query_params["p1"]).toBe("%web%");
    });

    test("Search escapes ILIKE metacharacters (% and _) so they match literally", () => {
      const statement: Statement = run({
        _type: ObjectType.Search,
        value: "50%_x",
      });

      // % and _ are backslash-escaped inside the bound pattern.
      expect(statement.query_params["p1"]).toBe("%50\\%\\_x%");
    });

    test("NotContains negates the ILIKE match", () => {
      const statement: Statement = run({
        _type: ObjectType.NotContains,
        value: "web",
      });

      expect(statement.query).toContain("AND NOT ");
      expect(statement.query_params["p1"]).toBe("%web%");
    });

    test("StartsWith anchors the pattern on the left", () => {
      const statement: Statement = run({
        _type: ObjectType.StartsWith,
        value: "web",
      });

      expect(statement.query_params["p1"]).toBe("web%");
    });

    test("EndsWith anchors the pattern on the right", () => {
      const statement: Statement = run({
        _type: ObjectType.EndsWith,
        value: "web",
      });

      expect(statement.query_params["p1"]).toBe("%web");
    });
  });

  describe("numeric comparisons cast the stored value and bind a Double", () => {
    test.each([
      [ObjectType.GreaterThan, ">"],
      [ObjectType.GreaterThanOrEqual, ">="],
      [ObjectType.LessThan, "<"],
      [ObjectType.LessThanOrEqual, "<="],
    ])(
      "%s emits toFloat64OrNull(v) %s a bound threshold",
      (type: ObjectType, comparison: string) => {
        const statement: Statement = run({ _type: type, value: "1.5" });

        expect(statement.query).toContain(`toFloat64OrNull(v) ${comparison} `);
        // Bound as a Double, not Int32 — thresholds can be fractional.
        expect(statement.query).toContain("{p1:Double}");
        expect(statement.query_params["p1"]).toBe(1.5);
      },
    );

    test("a non-numeric value is refused with BadDataException, not bound as NaN", () => {
      expect(() => {
        return run({ _type: ObjectType.GreaterThan, value: "not-a-number" });
      }).toThrow(BadDataException);
    });

    test("a missing value is refused rather than silently becoming '> 0'", () => {
      expect(() => {
        return run({ _type: ObjectType.GreaterThan });
      }).toThrow(BadDataException);
    });

    test("an empty-string value is refused", () => {
      expect(() => {
        return run({ _type: ObjectType.LessThan, value: "" });
      }).toThrow(BadDataException);
    });
  });

  describe("null / empty existence operators", () => {
    test("IsNull matches rows with no non-empty value under the key", () => {
      const statement: Statement = run({ _type: ObjectType.IsNull });

      expect(statement.query).toContain("AND NOT ");
      expect(statement.query).toContain("v != ''");
    });

    test("NotNull matches rows that carry a non-empty value", () => {
      const statement: Statement = run({ _type: ObjectType.NotNull });

      expect(statement.query).not.toContain("NOT ");
      expect(statement.query).toContain("v != ''");
    });
  });

  describe("membership (Includes / IncludesNone)", () => {
    test("Includes binds the list as a String array with IN", () => {
      const statement: Statement = run({
        _type: ObjectType.Includes,
        value: ["GET", "POST"],
      });

      expect(statement.query).toContain("v IN ({p1:Array(String)})");
      expect(statement.query_params["p1"]).toEqual(["GET", "POST"]);
    });

    test("IncludesNone negates the membership test", () => {
      const statement: Statement = run({
        _type: ObjectType.IncludesNone,
        value: ["GET"],
      });

      expect(statement.query).toContain("AND NOT ");
      expect(statement.query).toContain("v IN ({p1:Array(String)})");
    });

    test("an empty membership list constrains nothing (the 'All' reading)", () => {
      const statement: Statement = run({
        _type: ObjectType.Includes,
        value: [],
      });

      // Statement is left untouched — no dangling IN () emitted.
      expect(statement.query).toBe("WHERE true");
    });
  });

  describe("wildcard globs (Wildcard / NotWildcard)", () => {
    test("a single glob compiles to one ILIKE inside an OR group", () => {
      const statement: Statement = run({
        _type: ObjectType.Wildcard,
        value: ["GET*"],
      });

      expect(statement.query).toContain("AND ");
      expect(statement.query).toContain("v ILIKE {p1:String}");
    });

    test("multiple globs are OR-ed together", () => {
      const statement: Statement = run({
        _type: ObjectType.Wildcard,
        value: ["GET*", "POST*"],
      });

      expect(statement.query).toContain(" OR ");
      expect(statement.query).toContain("{p1:String}");
      expect(statement.query).toContain("{p2:String}");
    });

    test("NotWildcard negates the group", () => {
      const statement: Statement = run({
        _type: ObjectType.NotWildcard,
        value: ["GET*"],
      });

      expect(statement.query).toContain("AND NOT ");
    });

    test("an empty glob list constrains nothing", () => {
      const statement: Statement = run({
        _type: ObjectType.Wildcard,
        value: [],
      });

      expect(statement.query).toBe("WHERE true");
    });

    test("more than the pattern cap is refused with BadDataException", () => {
      const tooMany: Array<string> = Array.from(
        { length: MAX_WILDCARD_PATTERNS + 1 },
        (_v: unknown, i: number) => {
          return `p${i}*`;
        },
      );

      expect(() => {
        return run({ _type: ObjectType.Wildcard, value: tooMany });
      }).toThrow(BadDataException);
    });
  });

  describe("hostile / malformed values are refused as 400s, not 500s", () => {
    test("an object value is rejected with BadDataException", () => {
      expect(() => {
        return run({ _type: ObjectType.EqualTo, value: { nested: "x" } });
      }).toThrow(BadDataException);
    });

    test("an object that shadows toString with a non-callable still throws BadDataException, not TypeError", () => {
      /*
       * String({toString: 1}) throws a TypeError during ToPrimitive; the
       * builder must narrow to primitives first so this exits as a 400.
       */
      let thrown: unknown = null;
      try {
        run({ _type: ObjectType.EqualTo, value: { toString: 1 } });
      } catch (err: unknown) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(BadDataException);
    });

    test("an unrecognized operator type is refused", () => {
      expect(() => {
        return run({ _type: "TotallyMadeUpOperator", value: "x" });
      }).toThrow(BadDataException);
    });
  });

  describe("the predicate is appended, not replaced", () => {
    test("the existing statement text is preserved ahead of the predicate", () => {
      const statement: Statement = SQL`WHERE project_id = 'p1'`;
      appendAttributeOperatorFilter({
        statement,
        attributeKey: ATTR,
        operator: { _type: ObjectType.EqualTo, value: "GET" },
      });

      expect(statement.query.startsWith("WHERE project_id = 'p1'")).toBe(true);
      expect(statement.query).toContain(" AND ");
    });
  });
});
