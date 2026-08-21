import LogAggregationService, {
  FacetRequest,
  HistogramRequest,
  LogAttributeFilterValue,
} from "../../../Server/Services/LogAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Attribute filters carry an operator, not just a value. The logs *list*
 * compiles those through StatementGenerator; these aggregation endpoints
 * (histogram, facets, export) used to treat anything that was not an array as
 * a plain string, so an operator arrived as an object, bound as
 * "[object Object]" and matched nothing — the log monitor's preview showed an
 * empty chart beside a populated list of logs.
 *
 * Operators travel as the `{_type, value}` shape every QueryOperator's
 * toJSON() emits, which is exactly what lands in the request body.
 *
 * appendCommonFilters is shared by histogram / facets / analytics / export,
 * so exercising it through the histogram covers all of them; the facet case
 * at the end pins that sharing.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START_TIME: Date = new Date("2026-03-01T00:00:00.000Z");
const END_TIME: Date = new Date("2026-03-12T00:00:00.000Z");

function histogramFor(
  attributes: Record<string, LogAttributeFilterValue>,
): Statement {
  const request: HistogramRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    bucketSizeInMinutes: 60,
    attributes,
  };

  return (LogAggregationService as any).buildHistogramStatement(request);
}

function operator(
  type: string,
  value: unknown,
): Record<string, LogAttributeFilterValue> {
  return {
    logtype: { _type: type, value } as LogAttributeFilterValue,
  };
}

// The predicate this builder wraps every attribute match in.
const KEY_MATCH: string = "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(";
const MAP_TAIL: string = ", mapKeys(attributes), mapValues(attributes))";

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("log attribute filters — operator support", () => {
  describe("substring operators compile to ILIKE with the right anchors", () => {
    test("Contains wraps the needle on both sides", () => {
      const statement: Statement = histogramFor(operator("Search", "web"));

      expect(statement.query).toContain(`${KEY_MATCH}`);
      expect(statement.query).toContain("AND v ILIKE ");
      expect(paramValues(statement)).toContain("%web%");
    });

    test("StartsWith anchors at the front", () => {
      const statement: Statement = histogramFor(operator("StartsWith", "web"));

      expect(statement.query).toContain("AND v ILIKE ");
      expect(paramValues(statement)).toContain("web%");
    });

    test("EndsWith anchors at the back", () => {
      const statement: Statement = histogramFor(operator("EndsWith", "web"));

      expect(paramValues(statement)).toContain("%web");
    });

    test("NotContains negates the whole existence test", () => {
      const statement: Statement = histogramFor(operator("NotContains", "web"));

      expect(statement.query).toContain(`AND NOT ${KEY_MATCH}`);
      expect(paramValues(statement)).toContain("%web%");
    });
  });

  describe("equality operators", () => {
    test("EqualTo compiles to the same predicate a bare string does", () => {
      const wrapped: Statement = histogramFor(operator("EqualTo", "web"));
      const bare: Statement = histogramFor({ logtype: "web" });

      expect(wrapped.query).toBe(bare.query);
      expect(wrapped.query_params).toStrictEqual(bare.query_params);
    });

    test("NotEqual negates, so rows without the attribute still match", () => {
      /*
       * Mirrors StatementGenerator's map-subscript form, where a missing key
       * reads as '' and therefore satisfies `!= value`.
       */
      const statement: Statement = histogramFor(operator("NotEqual", "web"));

      expect(statement.query).toContain(`AND NOT ${KEY_MATCH}`);
      expect(statement.query).toContain("AND v = ");
      expect(paramValues(statement)).toContain("web");
    });
  });

  describe("membership operators", () => {
    test("Includes compiles to IN", () => {
      const statement: Statement = histogramFor(
        operator("Includes", ["web", "api"]),
      );

      expect(statement.query).toContain("AND v IN (");
      expect(statement.query).not.toContain("AND NOT arrayExists");
      expect(paramValues(statement)).toContainEqual(["web", "api"]);
    });

    test("IncludesNone compiles to a negated IN", () => {
      const statement: Statement = histogramFor(
        operator("IncludesNone", ["web", "api"]),
      );

      expect(statement.query).toContain(`AND NOT ${KEY_MATCH}`);
      expect(statement.query).toContain("AND v IN (");
      expect(paramValues(statement)).toContainEqual(["web", "api"]);
    });

    test("non-string members are stringified rather than bound as objects", () => {
      const statement: Statement = histogramFor(operator("Includes", [1, 2]));

      expect(paramValues(statement)).toContainEqual(["1", "2"]);
    });

    test("an empty selection means All — no predicate at all", () => {
      /*
       * `IN ()` is a ClickHouse syntax error and "match nothing" is never
       * what a cleared multi-select means; StatementGenerator and the form
       * both treat it as All, so this must too.
       */
      const empty: Statement = histogramFor(operator("Includes", []));
      const none: Statement = histogramFor({});

      expect(empty.query).toBe(none.query);
      expect(empty.query).not.toContain(KEY_MATCH);

      const emptyExclusion: Statement = histogramFor(
        operator("IncludesNone", []),
      );

      expect(emptyExclusion.query).toBe(none.query);
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

      expect(statement.query).toContain(`AND toFloat64OrNull(v) ${sql} `);
      expect(paramValues(statement)).toContain(5);
    });

    test("the comparison is literal SQL, never a bound identifier", () => {
      /*
       * An interpolation inside the SQL tag becomes an Identifier parameter,
       * which `>` is not — so the comparison has to be appended raw.
       */
      const statement: Statement = histogramFor(operator("GreaterThan", 5));

      expect(statement.query).not.toContain("toFloat64OrNull(v) {p");
    });
  });

  describe("presence operators", () => {
    test("IsEmpty matches rows with no non-empty value under the key", () => {
      const statement: Statement = histogramFor(operator("IsNull", null));

      expect(statement.query).toContain(`AND NOT ${KEY_MATCH}`);
      expect(statement.query).toContain("AND v != ''");
    });

    test("IsNotEmpty matches rows that do have one", () => {
      const statement: Statement = histogramFor(operator("NotNull", null));

      expect(statement.query).toContain(`AND ${KEY_MATCH}`);
      expect(statement.query).toContain("AND v != ''");
      expect(statement.query).not.toContain("AND NOT arrayExists");
    });
  });

  describe("the existing shapes are untouched", () => {
    test("a bare string still compiles to case-insensitive equality", () => {
      const statement: Statement = histogramFor({ requestid: "uuid-123" });

      expect(statement.query).toContain(KEY_MATCH);
      expect(statement.query).toContain(MAP_TAIL);
      expect(paramValues(statement)).toContain("requestid");
      expect(paramValues(statement)).toContain("uuid-123");
    });

    test("a bare array still compiles to IN", () => {
      const statement: Statement = histogramFor({
        region: ["eu-west-1", "us-east-1"],
      });

      expect(statement.query).toContain("AND v IN (");
      expect(paramValues(statement)).toContainEqual(["eu-west-1", "us-east-1"]);
    });
  });

  describe("safety", () => {
    test("values are bound as parameters, never inlined", () => {
      const statement: Statement = histogramFor(
        operator("Search", "web'; DROP TABLE log; --"),
      );

      expect(statement.query).not.toContain("DROP TABLE");
      expect(paramValues(statement)).toContain("%web'; DROP TABLE log; --%");
    });

    test("an injection-shaped attribute key is still rejected by key validation", () => {
      expect(() => {
        return histogramFor({
          "logtype') OR 1=1 --": { _type: "Search", value: "web" },
        });
      }).toThrow();
    });

    test("an unknown operator is refused rather than silently mis-filtered", () => {
      /*
       * `_type` comes off the wire. Binding an unrecognised object as text
       * is how this broke in the first place — counts that quietly disagreed
       * with the logs list. Fail loudly instead.
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
        facetKey: "severityText",
        limit: 15,
        attributes: operator("Search", "web"),
      };

      const facetStatement: Statement = (
        LogAggregationService as any
      ).buildFacetStatement(request);

      expect(facetStatement.query).toContain(KEY_MATCH);
      expect(facetStatement.query).toContain("AND v ILIKE ");
      expect(paramValues(facetStatement)).toContain("%web%");
    });
  });

  describe("several filters combine", () => {
    test("mixed operators all land in the same WHERE clause", () => {
      const statement: Statement = histogramFor({
        logtype: { _type: "Search", value: "web" } as LogAttributeFilterValue,
        env: "production",
        region: { _type: "Includes", value: ["eu"] } as LogAttributeFilterValue,
      });

      expect(statement.query.match(/arrayExists/g)).toHaveLength(3);
      expect(paramValues(statement)).toContain("%web%");
      expect(paramValues(statement)).toContain("production");
      expect(paramValues(statement)).toContainEqual(["eu"]);
    });
  });
});
