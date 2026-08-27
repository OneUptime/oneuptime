import TraceAggregationService, {
  FacetRequest,
  HistogramRequest,
  TraceAttributeFilterValue,
} from "../../../Server/Services/TraceAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Attribute filters carry an operator, not just a value. The span *list*
 * compiles those through StatementGenerator, which understands every
 * operator; the histogram / facets / analytics used to treat anything that
 * was not an array as a plain string, so `@url.host:api-*` narrowed the list
 * of spans while the chart above it kept counting the whole project.
 *
 * Operators travel as the `{_type, value}` shape every QueryOperator's
 * toJSON() emits, which is exactly what lands in the request body.
 *
 * appendCommonFilters is shared by histogram / facets / analytics, so
 * exercising it through the histogram covers all of them; the facet case at
 * the end pins that sharing.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START_TIME: Date = new Date("2026-03-01T00:00:00.000Z");
const END_TIME: Date = new Date("2026-03-12T00:00:00.000Z");

// The predicate this builder wraps every attribute match in.
const KEY_MATCH: string = "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(";
const MAP_TAIL: string = ", mapKeys(attributes), mapValues(attributes))";

function histogramStatement(overrides: Partial<HistogramRequest>): Statement {
  const request: HistogramRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    bucketSizeInMinutes: 60,
    ...overrides,
  };

  return (TraceAggregationService as any).buildHistogramStatement(request);
}

function histogramFor(
  attributes: Record<string, TraceAttributeFilterValue>,
): Statement {
  return histogramStatement({ attributes });
}

function operator(
  type: string,
  value: unknown,
): Record<string, TraceAttributeFilterValue> {
  return {
    "url.host": { _type: type, value } as TraceAttributeFilterValue,
  };
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

/*
 * The query getter dedents the rendered SQL, so an appended predicate can
 * land at line start with no leading space — normalize all whitespace before
 * asserting on SQL fragments (same reason as TraceAggregationService.test.ts).
 */
function normalizedQuery(statement: Statement): string {
  return statement.query.replace(/\s+/g, " ");
}

function countOccurrences(statement: Statement, fragment: string): number {
  return normalizedQuery(statement).split(fragment).length - 1;
}

describe("trace attribute filters — operator support", () => {
  describe("wildcards compile to one ILIKE per glob", () => {
    test("a prefix glob anchors at the front", () => {
      const statement: Statement = histogramFor(
        operator("Wildcard", ["api-*"]),
      );

      expect(normalizedQuery(statement)).toContain(` AND ${KEY_MATCH}`);
      expect(normalizedQuery(statement)).toContain("AND (v ILIKE ");
      expect(paramValues(statement)).toContain("api-%");
    });

    test("a suffix glob anchors at the back", () => {
      const statement: Statement = histogramFor(
        operator("Wildcard", ["*.internal"]),
      );

      expect(paramValues(statement)).toContain("%.internal");
    });

    test("an infix glob keeps the literal text on both sides", () => {
      const statement: Statement = histogramFor(operator("Wildcard", ["a*b"]));

      expect(paramValues(statement)).toContain("a%b");
    });

    test("`?` matches exactly one character", () => {
      const statement: Statement = histogramFor(
        operator("Wildcard", ["svc-?"]),
      );

      expect(paramValues(statement)).toContain("svc-_");
    });

    test("a scalar glob is accepted as well as a one-element array", () => {
      /*
       * Wildcard's payload is an array, but a client that sends the scalar
       * form must not silently filter nothing.
       */
      const scalar: Statement = histogramFor(operator("Wildcard", "api-*"));
      const array: Statement = histogramFor(operator("Wildcard", ["api-*"]));

      expect(scalar.query).toBe(array.query);
      expect(scalar.query_params).toStrictEqual(array.query_params);
    });

    test("a multi-glob list ORs inside a single key match", () => {
      /*
       * `Query<T>` has no OR node, so an any-of list that mixes patterns with
       * literals is carried by the operator itself — it has to stay one
       * arrayExists or the globs would AND and match nothing.
       */
      const statement: Statement = histogramFor(
        operator("Wildcard", ["api-*", "web", "*.internal"]),
      );

      expect(countOccurrences(statement, KEY_MATCH)).toBe(1);
      expect(countOccurrences(statement, "v ILIKE ")).toBe(3);
      expect(countOccurrences(statement, " OR ")).toBe(2);
      expect(paramValues(statement)).toContain("api-%");
      expect(paramValues(statement)).toContain("web");
      expect(paramValues(statement)).toContain("%.internal");
    });

    test("NotWildcard negates the whole existence test", () => {
      /*
       * Negating outside arrayExists is what lets a span that does not carry
       * the attribute pass — it trivially fails to match the glob.
       */
      const statement: Statement = histogramFor(
        operator("NotWildcard", ["api-*"]),
      );

      expect(normalizedQuery(statement)).toContain(`AND NOT ${KEY_MATCH}`);
      expect(paramValues(statement)).toContain("api-%");
    });

    test("an empty glob list constrains nothing", () => {
      const empty: Statement = histogramFor(operator("Wildcard", []));
      const none: Statement = histogramFor({});

      expect(empty.query).toBe(none.query);
    });

    describe("`%` and `_` the user typed stay literal", () => {
      /*
       * The glob alphabet (`*`, `?`) and the LIKE alphabet (`%`, `_`) overlap
       * in the worst way: a `%` in the value is match-anything to the
       * database. toLikePattern escapes those in the same pass that expands
       * the globs, so a filter for `100%` cannot widen to everything.
       */
      test("a percent in the value is escaped", () => {
        const statement: Statement = histogramFor(
          operator("Wildcard", ["100%*"]),
        );

        expect(paramValues(statement)).toContain("100\\%%");
      });

      test("an underscore in the value is escaped", () => {
        const statement: Statement = histogramFor(
          operator("Wildcard", ["req_id-*"]),
        );

        expect(paramValues(statement)).toContain("req\\_id-%");
      });

      test("a value with no glob at all is a fully escaped literal", () => {
        const statement: Statement = histogramFor(
          operator("Wildcard", ["100%"]),
        );

        expect(paramValues(statement)).toContain("100\\%");
      });
    });
  });

  describe("substring operators compile to ILIKE with the right anchors", () => {
    test("Search wraps the needle on both sides", () => {
      const statement: Statement = histogramFor(operator("Search", "web"));

      expect(normalizedQuery(statement)).toContain(` AND ${KEY_MATCH}`);
      expect(normalizedQuery(statement)).toContain("AND v ILIKE ");
      expect(paramValues(statement)).toContain("%web%");
    });

    test("StartsWith anchors at the front", () => {
      const statement: Statement = histogramFor(operator("StartsWith", "web"));

      expect(paramValues(statement)).toContain("web%");
    });

    test("EndsWith anchors at the back", () => {
      const statement: Statement = histogramFor(operator("EndsWith", "web"));

      expect(paramValues(statement)).toContain("%web");
    });

    test("NotContains negates the whole existence test", () => {
      const statement: Statement = histogramFor(operator("NotContains", "web"));

      expect(normalizedQuery(statement)).toContain(`AND NOT ${KEY_MATCH}`);
      expect(paramValues(statement)).toContain("%web%");
    });

    test.each([
      ["a percent", "100%", "%100\\%%"],
      ["an underscore", "req_id", "%req\\_id%"],
    ])(
      "%s in a Search value is escaped rather than treated as a wildcard",
      (_label: string, value: string, expected: string) => {
        const statement: Statement = histogramFor(operator("Search", value));

        expect(paramValues(statement)).toContain(expected);
      },
    );
  });

  describe("equality operators", () => {
    test("EqualTo compiles to the same predicate a bare string does", () => {
      const wrapped: Statement = histogramFor(operator("EqualTo", "web"));
      const bare: Statement = histogramFor({ "url.host": "web" });

      expect(wrapped.query).toBe(bare.query);
      expect(wrapped.query_params).toStrictEqual(bare.query_params);
    });

    test("a bare '' filter reads the same as an explicit EqualTo('')", () => {
      /*
       * A Map subscript returns the value type's default for a key the row
       * does not carry, so the list's `attributes['k'] = ''` matches spans
       * that lack the attribute entirely. The two spellings of that filter
       * must not compile differently.
       */
      const bare: Statement = histogramFor({ "url.host": "" });
      const wrapped: Statement = histogramFor(operator("EqualTo", ""));
      const isEmpty: Statement = histogramFor(operator("IsNull", null));

      expect(bare.query).toBe(wrapped.query);
      expect(bare.query_params).toStrictEqual(wrapped.query_params);
      expect(bare.query).toBe(isEmpty.query);
    });

    test("NotEqual negates, so spans without the attribute still match", () => {
      const statement: Statement = histogramFor(operator("NotEqual", "web"));

      expect(normalizedQuery(statement)).toContain(`AND NOT ${KEY_MATCH}`);
      expect(normalizedQuery(statement)).toContain("AND v = ");
      expect(paramValues(statement)).toContain("web");
    });
  });

  describe("membership operators", () => {
    test("Includes compiles to IN", () => {
      const statement: Statement = histogramFor(
        operator("Includes", ["web", "api"]),
      );

      expect(normalizedQuery(statement)).toContain("AND v IN (");
      expect(normalizedQuery(statement)).not.toContain("AND NOT arrayExists");
      expect(paramValues(statement)).toContainEqual(["web", "api"]);
    });

    test("IncludesNone compiles to a negated IN", () => {
      const statement: Statement = histogramFor(
        operator("IncludesNone", ["web", "api"]),
      );

      expect(normalizedQuery(statement)).toContain(`AND NOT ${KEY_MATCH}`);
      expect(normalizedQuery(statement)).toContain("AND v IN (");
    });

    test("an empty selection means All — no predicate at all", () => {
      const empty: Statement = histogramFor(operator("Includes", []));
      const none: Statement = histogramFor({});

      expect(empty.query).toBe(none.query);
    });
  });

  describe("numeric operators cast the stored text", () => {
    test.each([
      ["GreaterThan", ">"],
      ["GreaterThanOrEqual", ">="],
      ["LessThan", "<"],
      ["LessThanOrEqual", "<="],
    ])("%s compiles to toFloat64OrNull(v) %s", (type: string, sql: string) => {
      const statement: Statement = histogramFor(operator(type, 5));

      expect(normalizedQuery(statement)).toContain(
        `AND toFloat64OrNull(v) ${sql} `,
      );
      expect(paramValues(statement)).toContain(5);
    });

    test("a fractional threshold binds as Double, not Int32", () => {
      /*
       * The left-hand side is a Float64 and the value box is free text, so a
       * threshold bound as Int32 is a parse error at the database rather than
       * a comparison.
       */
      const statement: Statement = histogramFor(operator("GreaterThan", 1.5));

      expect(statement.query).toMatch(/toFloat64OrNull\(v\) > \{p\d+:Double\}/);
      expect(paramValues(statement)).toContain(1.5);
    });

    test("a non-numeric threshold is refused instead of bound as nan", () => {
      expect(() => {
        return histogramFor(operator("GreaterThan", "not-a-number"));
      }).toThrow(/needs a numeric value/);
    });
  });

  describe("presence operators", () => {
    test("IsEmpty matches spans with no non-empty value under the key", () => {
      const statement: Statement = histogramFor(operator("IsNull", null));

      expect(normalizedQuery(statement)).toContain(`AND NOT ${KEY_MATCH}`);
      expect(normalizedQuery(statement)).toContain("AND v != ''");
    });

    test("IsNotEmpty matches spans that do have one", () => {
      const statement: Statement = histogramFor(operator("NotNull", null));

      expect(normalizedQuery(statement)).toContain(`AND ${KEY_MATCH}`);
      expect(normalizedQuery(statement)).toContain("AND v != ''");
      expect(normalizedQuery(statement)).not.toContain("AND NOT arrayExists");
    });
  });

  describe("the existing shapes are untouched", () => {
    test("a bare string still compiles to case-insensitive equality", () => {
      const statement: Statement = histogramFor({ "url.host": "api.example" });

      expect(normalizedQuery(statement)).toContain(KEY_MATCH);
      expect(normalizedQuery(statement)).toContain(MAP_TAIL);
      expect(paramValues(statement)).toContain("url.host");
      expect(paramValues(statement)).toContain("api.example");
    });

    test("a bare array still compiles to IN", () => {
      const statement: Statement = histogramFor({
        region: ["eu-west-1", "us-east-1"],
      });

      expect(normalizedQuery(statement)).toContain("AND v IN (");
      expect(paramValues(statement)).toContainEqual(["eu-west-1", "us-east-1"]);
    });

    test("attributeSearches still compiles to a contains match", () => {
      /*
       * Saved views and existing deep links still send this channel, so it
       * has to keep working alongside the operator dispatch — a Search
       * operator in `attributes` produces the same predicate.
       */
      const viaChannel: Statement = histogramStatement({
        attributeSearches: { "url.host": "web" },
      });
      const viaOperator: Statement = histogramFor(operator("Search", "web"));

      expect(normalizedQuery(viaChannel)).toContain("AND v ILIKE ");
      expect(paramValues(viaChannel)).toContain("%web%");
      expect(paramValues(viaOperator)).toContain("%web%");
    });

    test("an attributeSearches value with % or _ matches literally", () => {
      /*
       * Unescaped, `100%` in the chart's contains-filter counted every span
       * in the project while the list beside it counted only the matching
       * ones.
       */
      const statement: Statement = histogramStatement({
        attributeSearches: { "url.host": "100%_x" },
      });

      expect(paramValues(statement)).toContain("%100\\%\\_x%");
    });
  });

  describe("top-level substring filters escape the same way", () => {
    test.each([
      ["spanNameSearches", { spanNameSearches: ["GET /100%"] }],
      ["nameSearchText", { nameSearchText: "GET /100%" }],
    ])(
      "%s escapes a percent so the chart matches what the list matches",
      (_label: string, overrides: Partial<HistogramRequest>) => {
        const statement: Statement = histogramStatement(overrides);

        expect(paramValues(statement)).toContain("%GET /100\\%%");
      },
    );

    test("statusMessageSearchText escapes an underscore", () => {
      const statement: Statement = histogramStatement({
        statusMessageSearchText: "timed_out",
      });

      expect(paramValues(statement)).toContain("%timed\\_out%");
    });
  });

  describe("safety", () => {
    test("values are bound as parameters, never inlined", () => {
      const statement: Statement = histogramFor(
        operator("Wildcard", ["web'; DROP TABLE span; --*"]),
      );

      expect(statement.query).not.toContain("DROP TABLE");
      expect(paramValues(statement)).toContain("web'; DROP TABLE span; --%");
    });

    test("an injection-shaped attribute key is still rejected", () => {
      /*
       * validateFacetKey has to run on every attribute key regardless of the
       * shape of its value — the operator branch must not become a way past
       * it.
       */
      expect(() => {
        return histogramFor({
          "url.host') OR 1=1 --": { _type: "Wildcard", value: ["a*"] },
        });
      }).toThrow(BadDataException);
    });

    test("a non-primitive glob is refused, not coerced", () => {
      /*
       * `value` is unvalidated JSON. String() THROWS a TypeError on an object
       * that shadows toString with a non-callable, which would escape as a
       * 500 rather than the 400 this filter deserves.
       */
      expect(() => {
        return histogramFor(operator("Wildcard", [{ toString: 1 }]));
      }).toThrow(BadDataException);
    });

    test("an unknown operator is refused rather than silently mis-filtered", () => {
      /*
       * `_type` comes off the wire. Binding an unrecognised object as text is
       * how this broke for logs — counts that quietly disagreed with the
       * list. Fail loudly instead.
       */
      expect(() => {
        return histogramFor(operator("SomethingElse", "web"));
      }).toThrow(/Unsupported attribute filter/);
    });
  });

  describe("every consumer of appendCommonFilters gets the same predicate", () => {
    test("facets compile operators exactly like the histogram does", () => {
      const request: FacetRequest = {
        projectId: PROJECT_ID,
        startTime: START_TIME,
        endTime: END_TIME,
        facetKey: "name",
        limit: 15,
        attributes: operator("Wildcard", ["api-*"]),
      };

      const facetStatement: Statement = (
        TraceAggregationService as any
      ).buildFacetStatement(request);

      expect(normalizedQuery(facetStatement)).toContain(KEY_MATCH);
      expect(normalizedQuery(facetStatement)).toContain("v ILIKE ");
      expect(paramValues(facetStatement)).toContain("api-%");
    });
  });

  describe("several filters combine", () => {
    test("mixed operators all land in the same WHERE clause", () => {
      const statement: Statement = histogramFor({
        "url.host": {
          _type: "Wildcard",
          value: ["api-*"],
        } as TraceAttributeFilterValue,
        env: "production",
        region: {
          _type: "Includes",
          value: ["eu"],
        } as TraceAttributeFilterValue,
      });

      expect(countOccurrences(statement, KEY_MATCH)).toBe(3);
      expect(paramValues(statement)).toContain("api-%");
      expect(paramValues(statement)).toContain("production");
      expect(paramValues(statement)).toContainEqual(["eu"]);
    });
  });
});
