import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import appendAttributeOperatorFilter, {
  appendAttributeFilters,
  attributeValuesPresent,
  toAttributeOperator,
} from "../../../../Server/Utils/AnalyticsDatabase/AttributeFilterStatement";
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

const KEY_PLACEHOLDER: RegExp = /lowerUTF8\(k\) = lowerUTF8\(\{(p\d+):String\}\)/;
const EQUALS_PLACEHOLDER: RegExp = / AND v = \{(p\d+):String\}/;
const IN_PLACEHOLDER: RegExp = / AND v IN \(\{(p\d+):Array\(String\)\}\)/;
const HAS_PLACEHOLDER: RegExp =
  /has\(mapValues\(attributes\), \{(p\d+):String\}\)/;
const HAS_ANY_PLACEHOLDER: RegExp =
  /hasAny\(mapValues\(attributes\), \{(p\d+):Array\(String\)\}\)/;
const VALUE_PREFILTER: RegExp = /has(Any)?\(mapValues\(attributes\)/;

// The name of the parameter a placeholder pattern captures.
function placeholder(statement: Statement, pattern: RegExp): string {
  const match: RegExpExecArray | null = pattern.exec(statement.query);

  if (!match) {
    throw new Error(`${pattern} not found in: ${statement.query}`);
  }

  return match[1]!;
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
      expect(statement.query).toMatch(KEY_PLACEHOLDER);
      expect(statement.query).toContain("mapKeys(attributes)");
      expect(statement.query).toContain("mapValues(attributes)");
      // The key itself is a bound parameter, never inlined.
      expect(statement.query_params[placeholder(statement, KEY_PLACEHOLDER)]).toBe(
        ATTR,
      );
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
      expect(
        statement.query_params[placeholder(statement, EQUALS_PLACEHOLDER)],
      ).toBe("GET");
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

      expect(statement.query).toMatch(IN_PLACEHOLDER);
      expect(
        statement.query_params[placeholder(statement, IN_PLACEHOLDER)],
      ).toEqual(["GET", "POST"]);
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

  describe("the attribute value pre-filter (idx_attribute_values, #4706)", () => {
    /*
     * The case-insensitive lambda hides the value from every index, so a
     * search for one exact value used to read the whole attributes map of
     * every row in the window. Each predicate that needs one exact value to
     * be PRESENT is now preceded by `has(mapValues(attributes), v)` - true
     * wherever the lambda can be true, so the result is the same - which the
     * value index can skip granules on, and which keeps the lambda off the
     * rows that do not hold the value.
     */
    test("EqualTo checks the same bound value with has(mapValues(attributes), ...) first", () => {
      const statement: Statement = run({
        _type: ObjectType.EqualTo,
        value: "GET",
      });

      const prefilter: string = placeholder(statement, HAS_PLACEHOLDER);
      const compared: string = placeholder(statement, EQUALS_PLACEHOLDER);

      expect(statement.query_params[prefilter]).toBe("GET");
      expect(statement.query_params[compared]).toBe("GET");
      // Never inlined, in either place.
      expect(statement.query).not.toContain("'GET'");
      // Before the lambda, AND-ed, so the lambda only sees rows that hold it.
      expect(statement.query).toMatch(
        /^WHERE true AND has\(mapValues\(attributes\), \{p\d+:String\}\) AND arrayExists\(/,
      );
    });

    test("Includes checks the whole list with hasAny(mapValues(attributes), ...) first", () => {
      const statement: Statement = run({
        _type: ObjectType.Includes,
        value: ["GET", "POST"],
      });

      expect(
        statement.query_params[placeholder(statement, HAS_ANY_PLACEHOLDER)],
      ).toEqual(["GET", "POST"]);
      expect(statement.query).toMatch(
        /^WHERE true AND hasAny\(mapValues\(attributes\), \{p\d+:Array\(String\)\}\) AND arrayExists\(/,
      );
    });

    test("a one-value list uses has(), the same check EqualTo makes", () => {
      const list: Statement = run({ _type: ObjectType.Includes, value: ["GET"] });

      expect(list.query).toMatch(HAS_PLACEHOLDER);
      expect(list.query).not.toMatch(HAS_ANY_PLACEHOLDER);
      expect(list.query_params[placeholder(list, HAS_PLACEHOLDER)]).toBe("GET");
    });

    test("numbers are bound as the strings the attributes hold (hasAny has no String/Int32 common type)", () => {
      const equals: Statement = run({ _type: ObjectType.EqualTo, value: 500 });
      const list: Statement = run({
        _type: ObjectType.Includes,
        value: [500, 503],
      });

      expect(equals.query_params[placeholder(equals, HAS_PLACEHOLDER)]).toBe(
        "500",
      );
      expect(list.query_params[placeholder(list, HAS_ANY_PLACEHOLDER)]).toEqual(
        ["500", "503"],
      );
      expect(list.query_params[placeholder(list, IN_PLACEHOLDER)]).toEqual([
        "500",
        "503",
      ]);
    });

    test("a blank inside an 'is any of' list stays in the pre-filter: in the lambda '' means present and empty", () => {
      const statement: Statement = run({
        _type: ObjectType.Includes,
        value: ["", "GET"],
      });

      expect(
        statement.query_params[placeholder(statement, HAS_ANY_PLACEHOLDER)],
      ).toEqual(["", "GET"]);
    });

    test.each([
      ["NotEqual", { _type: ObjectType.NotEqual, value: "GET" }],
      ["NotEqual blank", { _type: ObjectType.NotEqual, value: "" }],
      ["EqualTo blank", { _type: ObjectType.EqualTo, value: "" }],
      ["EqualTo missing value", { _type: ObjectType.EqualTo }],
      ["IsNull", { _type: ObjectType.IsNull }],
      ["NotNull", { _type: ObjectType.NotNull }],
      ["Search", { _type: ObjectType.Search, value: "GET" }],
      ["NotContains", { _type: ObjectType.NotContains, value: "GET" }],
      ["StartsWith", { _type: ObjectType.StartsWith, value: "GET" }],
      ["EndsWith", { _type: ObjectType.EndsWith, value: "GET" }],
      ["Wildcard", { _type: ObjectType.Wildcard, value: ["GE*"] }],
      ["NotWildcard", { _type: ObjectType.NotWildcard, value: ["GE*"] }],
      ["GreaterThan", { _type: ObjectType.GreaterThan, value: 5 }],
      ["GreaterThanOrEqual", { _type: ObjectType.GreaterThanOrEqual, value: 5 }],
      ["LessThan", { _type: ObjectType.LessThan, value: 5 }],
      ["LessThanOrEqual", { _type: ObjectType.LessThanOrEqual, value: 5 }],
      ["IncludesNone", { _type: ObjectType.IncludesNone, value: ["GET"] }],
    ])(
      "%s needs no exact value to be present, so it gets no pre-filter",
      (_label: string, operator: Record<string, unknown>) => {
        const statement: Statement = run(operator);

        expect(statement.query).toContain("arrayExists");
        expect(statement.query).not.toMatch(VALUE_PREFILTER);
      },
    );

    test("attributeValuesPresent refuses an empty list rather than emit hasAny(..., [])", () => {
      expect(() => {
        return attributeValuesPresent([]);
      }).toThrow(BadDataException);
    });

    test("attributeValuesPresent binds every value and inlines none", () => {
      const statement: Statement = attributeValuesPresent([
        "a'b",
        "c\\d",
      ]);

      expect(statement.query).toBe(
        "hasAny(mapValues(attributes), {p0:Array(String)})",
      );
      expect(statement.query_params["p0"]).toEqual(["a'b", "c\\d"]);
    });
  });

  describe("toAttributeOperator: the four shapes a filter value arrives in", () => {
    test("an array means 'is any of'", () => {
      expect(toAttributeOperator(["a", "b"])).toEqual({
        _type: ObjectType.Includes,
        value: ["a", "b"],
      });
    });

    test("an operator object is itself", () => {
      const operator: Record<string, unknown> = {
        _type: ObjectType.Search,
        value: "web",
      };

      expect(toAttributeOperator(operator)).toBe(operator);
    });

    test("a blank string means 'is empty'", () => {
      expect(toAttributeOperator("")).toEqual({ _type: ObjectType.IsNull });
    });

    test.each([["web"], [500], [true]])(
      "any other scalar (%p) means 'equals'",
      (value: unknown) => {
        expect(toAttributeOperator(value)).toEqual({
          _type: ObjectType.EqualTo,
          value: value,
        });
      },
    );

    test("null means 'equals' nothing, which the builder reads as 'is empty'", () => {
      expect(toAttributeOperator(null)).toEqual({
        _type: ObjectType.EqualTo,
        value: null,
      });

      const viaNull: Statement = SQL`WHERE true`;
      appendAttributeFilters({
        statement: viaNull,
        attributes: { [ATTR]: null },
        validateKey: (): void => {},
      });

      expect(viaNull.query).toBe(run({ _type: ObjectType.IsNull }).query);
    });
  });

  describe("appendAttributeFilters: a whole attribute map", () => {
    function compile(attributes: Record<string, unknown> | undefined): {
      statement: Statement;
      validated: Array<string>;
    } {
      const statement: Statement = SQL`WHERE true`;
      const validated: Array<string> = [];

      appendAttributeFilters({
        statement,
        attributes,
        validateKey: (attributeKey: string): void => {
          validated.push(attributeKey);
        },
      });

      return { statement, validated };
    }

    test("no map, or an empty one, adds nothing", () => {
      expect(compile(undefined).statement.query).toBe("WHERE true");
      expect(compile({}).statement.query).toBe("WHERE true");
    });

    test("every key is validated, in order, before it reaches SQL", () => {
      expect(compile({ "http.route": "/a", "user.id": ["u1"] }).validated).toEqual(
        ["http.route", "user.id"],
      );
    });

    test("a key the validator refuses stops the compile with its exception", () => {
      const statement: Statement = SQL`WHERE true`;

      expect(() => {
        appendAttributeFilters({
          statement,
          attributes: { "bad key": "x" },
          validateKey: (): void => {
            throw new BadDataException("Invalid facetKey");
          },
        });
      }).toThrow(BadDataException);
      expect(statement.query).toBe("WHERE true");
    });

    test("each shape compiles exactly as the operator it means", () => {
      const scalar: Statement = compile({ [ATTR]: "GET" }).statement;
      const list: Statement = compile({ [ATTR]: ["GET", "POST"] }).statement;
      const blank: Statement = compile({ [ATTR]: "" }).statement;
      const operator: Statement = compile({
        [ATTR]: { _type: ObjectType.StartsWith, value: "G" },
      }).statement;

      expect(scalar.query).toBe(
        run({ _type: ObjectType.EqualTo, value: "GET" }).query,
      );
      expect(scalar.query_params).toStrictEqual(
        run({ _type: ObjectType.EqualTo, value: "GET" }).query_params,
      );
      expect(list.query).toBe(
        run({ _type: ObjectType.Includes, value: ["GET", "POST"] }).query,
      );
      expect(list.query_params).toStrictEqual(
        run({ _type: ObjectType.Includes, value: ["GET", "POST"] }).query_params,
      );
      expect(blank.query).toBe(run({ _type: ObjectType.IsNull }).query);
      expect(operator.query).toBe(
        run({ _type: ObjectType.StartsWith, value: "G" }).query,
      );
    });

    test("an empty list constrains nothing, the 'All' reading", () => {
      expect(compile({ [ATTR]: [] }).statement.query).toBe("WHERE true");
    });

    test("two keys AND two predicates, each with its own key", () => {
      const statement: Statement = compile({
        "http.route": "/a",
        "user.id": "u1",
      }).statement;

      expect(statement.query.match(/arrayExists/g)).toHaveLength(2);
      expect(Object.values(statement.query_params)).toEqual([
        "/a",
        "http.route",
        "/a",
        "u1",
        "user.id",
        "u1",
      ]);
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
