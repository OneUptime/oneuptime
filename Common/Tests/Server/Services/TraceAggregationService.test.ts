import TraceAggregationService, {
  FacetRequest,
  HistogramRequest,
  TraceAnalyticsRequest,
} from "../../../Server/Services/TraceAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

describe("TraceAggregationService", () => {
  const defaultRequest: HistogramRequest = {
    projectId: ObjectID.generate(),
    startTime: new Date("2026-06-01T00:00:00.000Z"),
    endTime: new Date("2026-06-02T00:00:00.000Z"),
    bucketSizeInMinutes: 5,
  };

  const buildHistogramStatement: (
    overrides?: Partial<HistogramRequest>,
  ) => Statement = (overrides: Partial<HistogramRequest> = {}): Statement => {
    return (TraceAggregationService as any).buildHistogramStatement({
      ...defaultRequest,
      ...overrides,
    });
  };

  const paramValues: (statement: Statement) => Array<unknown> = (
    statement: Statement,
  ): Array<unknown> => {
    return Object.values(statement.query_params);
  };

  /*
   * The query getter dedents the rendered SQL, so appended predicates can
   * land at line start with no leading space — normalize all whitespace
   * before asserting on SQL fragments.
   */
  const normalizedQuery: (statement: Statement) => string = (
    statement: Statement,
  ): string => {
    return statement.query.replace(/\s+/g, " ");
  };

  /*
   * The span list compiles a single `name` filter to `name ILIKE '%v%'`
   * (Search). The histogram/facets must use the same semantics for the same
   * filter or the chart disagrees with the list — a partial name like
   * "ShipShipment" against spans named "POST /Shipment/ShipShipment/" would
   * fill the list but empty the chart.
   */
  test("spanNameSearches compiles to substring ILIKE, matching list semantics", () => {
    const statement: Statement = buildHistogramStatement({
      spanNameSearches: ["ShipShipment"],
    });

    expect(normalizedQuery(statement)).toContain(" AND name ILIKE ");
    expect(normalizedQuery(statement)).not.toContain(" AND name IN ");
    expect(paramValues(statement)).toContain("%ShipShipment%");
  });

  test("whitespace-only spanNameSearches entries are skipped", () => {
    const statement: Statement = buildHistogramStatement({
      spanNameSearches: ["  ", "checkout"],
    });

    const ilikeMatches: Array<string> =
      normalizedQuery(statement).match(/ AND name ILIKE /g) || [];
    expect(ilikeMatches).toHaveLength(1);
    expect(paramValues(statement)).toContain("%checkout%");
  });

  test("multiple spanNameSearches entries AND together", () => {
    const statement: Statement = buildHistogramStatement({
      spanNameSearches: ["Shipment", "POST"],
    });

    const ilikeMatches: Array<string> =
      normalizedQuery(statement).match(/ AND name ILIKE /g) || [];
    expect(ilikeMatches).toHaveLength(2);
    expect(paramValues(statement)).toContain("%Shipment%");
    expect(paramValues(statement)).toContain("%POST%");
  });

  test("search values are kept verbatim — list-side Search does not trim", () => {
    const statement: Statement = buildHistogramStatement({
      spanNameSearches: [" GET /api "],
      statusMessageSearchText: " connection reset ",
    });

    expect(paramValues(statement)).toContain("% GET /api %");
    expect(paramValues(statement)).toContain("% connection reset %");
  });

  test("statusMessages compiles to exact statusMessage IN", () => {
    const statement: Statement = buildHistogramStatement({
      statusMessages: ["timeout", "connection reset"],
    });

    expect(normalizedQuery(statement)).toContain(" AND statusMessage IN (");
    expect(paramValues(statement)).toContainEqual([
      "timeout",
      "connection reset",
    ]);
  });

  test("spanNames stays exact-match (multi-value list filters use Includes)", () => {
    const statement: Statement = buildHistogramStatement({
      spanNames: ["POST /Shipment/ShipShipment/"],
    });

    expect(normalizedQuery(statement)).toContain(" AND name IN (");
    expect(normalizedQuery(statement)).not.toContain(" AND name ILIKE ");
    expect(paramValues(statement)).toContainEqual([
      "POST /Shipment/ShipShipment/",
    ]);
  });

  test("spanIds compiles to spanId IN", () => {
    const statement: Statement = buildHistogramStatement({
      spanIds: ["abc123", "def456"],
    });

    expect(normalizedQuery(statement)).toContain(" AND spanId IN (");
    expect(paramValues(statement)).toContainEqual(["abc123", "def456"]);
  });

  test("hasException compiles to a boolean predicate only when set", () => {
    expect(
      normalizedQuery(buildHistogramStatement({ hasException: true })),
    ).toContain(" AND hasException = 1");
    expect(
      normalizedQuery(buildHistogramStatement({ hasException: false })),
    ).toContain(" AND hasException = 0");
    expect(normalizedQuery(buildHistogramStatement())).not.toContain(
      "hasException",
    );
  });

  test("statusMessageSearchText compiles to substring ILIKE", () => {
    const statement: Statement = buildHistogramStatement({
      statusMessageSearchText: "timeout",
    });

    expect(normalizedQuery(statement)).toContain(" AND statusMessage ILIKE ");
    expect(paramValues(statement)).toContain("%timeout%");
  });

  test("duration bounds compile to strict Int128 comparisons", () => {
    /*
     * Strict `>` / `<` mirror the list's GreaterThan/LessThan compilation.
     * Int128 (LongNumber) is required: an Int32 param overflows for spans
     * longer than ~2.1 seconds (durations are in nanoseconds).
     */
    const statement: Statement = buildHistogramStatement({
      minDurationNano: 5_000_000_000,
      maxDurationNano: 90_000_000_000,
    });

    expect(normalizedQuery(statement)).toMatch(
      / AND durationUnixNano > \{p\d+:Int128\}/,
    );
    expect(normalizedQuery(statement)).toMatch(
      / AND durationUnixNano < \{p\d+:Int128\}/,
    );
    expect(paramValues(statement)).toContain(5_000_000_000);
    expect(paramValues(statement)).toContain(90_000_000_000);
  });

  test("a zero duration bound still compiles (duration:>0)", () => {
    const statement: Statement = buildHistogramStatement({
      minDurationNano: 0,
    });

    expect(normalizedQuery(statement)).toMatch(
      / AND durationUnixNano > \{p\d+:Int128\}/,
    );
    expect(paramValues(statement)).toContain(0);
  });

  test("exactDurationNano compiles to equality (duration:N without operator)", () => {
    const statement: Statement = buildHistogramStatement({
      exactDurationNano: 500_000_000,
    });

    expect(normalizedQuery(statement)).toMatch(
      / AND durationUnixNano = \{p\d+:Int128\}/,
    );
    expect(paramValues(statement)).toContain(500_000_000);
  });

  test("facet queries share the same filter compilation", () => {
    const facetRequest: FacetRequest = {
      projectId: defaultRequest.projectId,
      startTime: defaultRequest.startTime,
      endTime: defaultRequest.endTime,
      facetKey: "kind",
      spanNameSearches: ["ShipShipment"],
      hasException: true,
    };

    const statement: Statement = (
      TraceAggregationService as any
    ).buildFacetStatement(facetRequest);

    expect(statement.query).toContain(" AND name ILIKE ");
    expect(statement.query).toContain(" AND hasException = 1");
    expect(paramValues(statement)).toContain("%ShipShipment%");
  });

  test("attributeSearches compiles to case-insensitive-key contains match", () => {
    const statement: Statement = buildHistogramStatement({
      attributeSearches: { "url.host": "starship.online" },
    });

    expect(statement.query).toContain(
      "arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(",
    );
    expect(statement.query).toContain(") AND v ILIKE ");
    expect(paramValues(statement)).toContain("url.host");
    expect(paramValues(statement)).toContain("%starship.online%");
  });

  test("attributeSearches rejects malicious keys and skips blank values", () => {
    expect(() => {
      buildHistogramStatement({
        attributeSearches: { "x') OR 1=1 --": "v" },
      });
    }).toThrow("Invalid facetKey");

    const statement: Statement = buildHistogramStatement({
      attributeSearches: { "url.host": "   " },
    });
    expect(statement.query).not.toContain("ILIKE");
  });

  describe("analytics builders", () => {
    const analyticsRequest: TraceAnalyticsRequest = {
      projectId: defaultRequest.projectId,
      startTime: defaultRequest.startTime,
      endTime: defaultRequest.endTime,
      bucketSizeInMinutes: 5,
      chartType: "timeseries",
      metric: "p50Duration",
    };

    test("timeseries groups by an attribute dimension with sanitized alias", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTimeseriesStatement({
        ...analyticsRequest,
        groupBy: ["url.host"],
      });

      const query: string = normalizedQuery(statement);
      expect(query).toContain(
        "quantile(0.5)(durationUnixNano) / 1000000 AS val",
      );
      // The alias binds as an Identifier param (same as the logs builder).
      expect(query).toMatch(
        /attributes\[\{p\d+:String\}\] AS \{p\d+:Identifier\}/,
      );
      expect(query).toContain("mapContains(attributes, ");
      expect(query).toContain(" GROUP BY bucket, attr_0_url_host");
      expect(paramValues(statement)).toContain("url.host");
      expect(paramValues(statement)).toContain("attr_0_url_host");
    });

    test("timeseries caps series to pre-resolved top dimension values", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTimeseriesStatement(
        {
          ...analyticsRequest,
          groupBy: ["url.host"],
        },
        ["torginol.starship.online", "daymotorsports.starship.online"],
      );

      const query: string = normalizedQuery(statement);
      expect(query).toMatch(/attributes\[\{p\d+:String\}\] IN \(/);
      expect(paramValues(statement)).toContainEqual([
        "torginol.starship.online",
        "daymotorsports.starship.online",
      ]);
    });

    test("timeseries groups by a top-level column without parameterization", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTimeseriesStatement({
        ...analyticsRequest,
        metric: "count",
        groupBy: ["name"],
      });

      const query: string = normalizedQuery(statement);
      expect(query).toContain("count() AS val");
      expect(query).toContain(", toString(name) AS name");
      expect(query).toContain(" GROUP BY bucket, name");
    });

    test("top list ranks by the selected metric and returns counts", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTopListStatement({
        ...analyticsRequest,
        metric: "errorCount",
        groupBy: ["url.host"],
        limit: 25,
      });

      const query: string = normalizedQuery(statement);
      expect(query).toContain("countIf(statusCode = 2) AS val");
      expect(query).toContain("count() AS cnt");
      expect(query).toContain(" GROUP BY dim ORDER BY val DESC LIMIT ");
      expect(paramValues(statement)).toContain(25);
    });

    test("table returns the full duration stat set per dimension", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTableStatement({
        ...analyticsRequest,
        chartType: "table",
        groupBy: ["url.host"],
        spanNames: ["/Shipment/ShipShipment"],
      });

      const query: string = normalizedQuery(statement);
      expect(query).toContain("count() AS cnt");
      expect(query).toContain("countIf(statusCode = 2) AS err_cnt");
      expect(query).toContain("avg(durationUnixNano) / 1000000 AS avg_ms");
      expect(query).toContain(
        "quantile(0.5)(durationUnixNano) / 1000000 AS p50_ms",
      );
      expect(query).toContain(
        "quantile(0.9)(durationUnixNano) / 1000000 AS p90_ms",
      );
      expect(query).toContain(
        "quantile(0.95)(durationUnixNano) / 1000000 AS p95_ms",
      );
      expect(query).toContain(
        "quantile(0.99)(durationUnixNano) / 1000000 AS p99_ms",
      );
      expect(query).toContain("min(durationUnixNano) / 1000000 AS min_ms");
      expect(query).toContain("max(durationUnixNano) / 1000000 AS max_ms");
      expect(query).toContain(" AND name IN (");
      expect(query).toContain(" GROUP BY attr_0_url_host ORDER BY cnt DESC");
    });

    test("group-by rejects malicious dimension keys and >2 dimensions", () => {
      expect(() => {
        (TraceAggregationService as any).buildAnalyticsTimeseriesStatement({
          ...analyticsRequest,
          groupBy: ["x') AS v FROM system.tables --"],
        });
      }).toThrow("Invalid facetKey");

      expect(() => {
        (TraceAggregationService as any).buildAnalyticsTimeseriesStatement({
          ...analyticsRequest,
          groupBy: ["name", "kind", "statusCode"],
        });
      }).toThrow("groupBy supports at most 2 dimensions");
    });

    test("colliding attribute keys get distinct index-based aliases", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTimeseriesStatement({
        ...analyticsRequest,
        groupBy: ["url.host", "url:host"],
      });

      const query: string = normalizedQuery(statement);
      expect(query).toContain(
        " GROUP BY bucket, attr_0_url_host, attr_1_url_host",
      );
      expect(paramValues(statement)).toContain("attr_0_url_host");
      expect(paramValues(statement)).toContain("attr_1_url_host");
    });

    test("Service dimension is restricted to telemetry-service spans", () => {
      const statement: Statement = (
        TraceAggregationService as any
      ).buildAnalyticsTableStatement({
        ...analyticsRequest,
        chartType: "table",
        groupBy: ["primaryEntityId"],
      });

      const query: string = normalizedQuery(statement);
      expect(query).toContain(
        " AND (primaryEntityType = '' OR primaryEntityType = ",
      );
    });

    test("metric validation", () => {
      expect(TraceAggregationService.isValidAnalyticsMetric("count")).toBe(
        true,
      );
      expect(
        TraceAggregationService.isValidAnalyticsMetric("p95Duration"),
      ).toBe(true);
      expect(TraceAggregationService.isValidAnalyticsMetric("drop table")).toBe(
        false,
      );
      expect(TraceAggregationService.isValidAnalyticsMetric("__proto__")).toBe(
        false,
      );
    });
  });
});
