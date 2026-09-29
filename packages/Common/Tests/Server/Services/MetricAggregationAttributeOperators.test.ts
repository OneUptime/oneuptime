import MetricAggregationService, {
  FacetRequest,
  MetricAttributeFilterValue,
} from "../../../Server/Services/MetricAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The metrics sidebar counts facet values with no attribute channel at all,
 * so nothing the user selected could narrow those counts — every facet
 * reported the whole window regardless of the rest of the selection.
 *
 * The predicates come from the same compiler the log and trace builders use
 * (AttributeFilterStatement), which those suites exercise operator by
 * operator; what this file pins is that the metric facet builder dispatches
 * every wire shape to it and validates keys on the way through.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const START_TIME: Date = new Date("2026-03-01T00:00:00.000Z");
const END_TIME: Date = new Date("2026-03-12T00:00:00.000Z");

// The predicate the compiler wraps every attribute match in.
const KEY_MATCH: string = "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(";

function facetStatement(overrides: Partial<FacetRequest>): Statement {
  const request: FacetRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    facetKey: "name",
    ...overrides,
  };

  return (MetricAggregationService as any).buildFacetStatement(request);
}

function facetFor(
  attributes: Record<string, MetricAttributeFilterValue>,
): Statement {
  return facetStatement({ attributes });
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

/*
 * The query getter dedents the rendered SQL, so an appended predicate can
 * land at line start with no leading space — normalize before asserting.
 */
function normalizedQuery(statement: Statement): string {
  return statement.query.replace(/\s+/g, " ");
}

describe("metric facets — attribute filters", () => {
  test("a bare value compiles to a case-insensitive key/value match", () => {
    const statement: Statement = facetFor({ "host.name": "web-1" });

    expect(normalizedQuery(statement)).toContain(KEY_MATCH);
    expect(normalizedQuery(statement)).toContain("AND v = ");
    expect(paramValues(statement)).toContain("host.name");
    expect(paramValues(statement)).toContain("web-1");
  });

  test("a list of values compiles to IN", () => {
    const statement: Statement = facetFor({ "host.name": ["web-1", "web-2"] });

    expect(normalizedQuery(statement)).toContain("AND v IN (");
    expect(paramValues(statement)).toContainEqual(["web-1", "web-2"]);
  });

  test("a wildcard operator compiles to ILIKE over the glob", () => {
    const statement: Statement = facetFor({
      "host.name": { _type: "Wildcard", value: ["web-*"] },
    });

    expect(normalizedQuery(statement)).toContain("AND (v ILIKE ");
    expect(paramValues(statement)).toContain("web-%");
  });

  test("a negated operator negates the whole existence test", () => {
    /*
     * Negating outside arrayExists is what lets a row that does not carry
     * the attribute pass — it trivially fails to match.
     */
    const statement: Statement = facetFor({
      "host.name": { _type: "NotWildcard", value: ["web-*"] },
    });

    expect(normalizedQuery(statement)).toContain(`AND NOT ${KEY_MATCH}`);
  });

  test("a blank value reads as 'is empty', like an explicit IsNull", () => {
    /*
     * A ClickHouse Map subscript returns the value type's default for a key
     * the row does not carry, so '' has to mean "missing or empty" here as
     * well as in the list.
     */
    const bare: Statement = facetFor({ "host.name": "" });
    const isEmpty: Statement = facetFor({
      "host.name": { _type: "IsNull" },
    });

    expect(bare.query).toBe(isEmpty.query);
    expect(normalizedQuery(bare)).toContain(`AND NOT ${KEY_MATCH}`);
  });

  test("an empty selection means All — no predicate at all", () => {
    const empty: Statement = facetFor({ "host.name": [] });
    const none: Statement = facetStatement({});

    expect(empty.query).toBe(none.query);
  });

  test("the filter also reaches the mutable-metric facet path", () => {
    /*
     * Incident / alert / maintenance metrics are read through an argMax
     * subquery rather than the raw table. The subquery re-exports
     * `attributes`, so the same predicate has to resolve against it — the
     * facet counts for those metrics would otherwise ignore the selection.
     */
    const statement: Statement = facetStatement({
      metricNames: ["oneuptime.incident.count"],
      attributes: { "host.name": "web-1" },
    });

    expect(normalizedQuery(statement)).toContain("argMax(attributes, version)");
    expect(normalizedQuery(statement)).toContain(KEY_MATCH);
    expect(paramValues(statement)).toContain("web-1");
  });

  describe("safety", () => {
    test("an injection-shaped attribute key is rejected", () => {
      expect(() => {
        return facetFor({ "host.name') OR 1=1 --": "web-1" });
      }).toThrow(BadDataException);
    });

    test("keys are validated on the operator branch too", () => {
      /*
       * The operator branch must not become a way past validateFacetKey.
       */
      expect(() => {
        return facetFor({
          "host.name') OR 1=1 --": { _type: "Wildcard", value: ["a*"] },
        });
      }).toThrow(BadDataException);
    });

    test("an unknown operator is refused rather than silently mis-filtered", () => {
      expect(() => {
        return facetFor({
          "host.name": { _type: "SomethingElse", value: "web" },
        });
      }).toThrow(/Unsupported attribute filter/);
    });

    test("values are bound as parameters, never inlined", () => {
      const statement: Statement = facetFor({
        "host.name": "web'; DROP TABLE metric; --",
      });

      expect(statement.query).not.toContain("DROP TABLE");
      expect(paramValues(statement)).toContain("web'; DROP TABLE metric; --");
    });
  });
});
