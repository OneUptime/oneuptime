import LogAggregationService, {
  FacetRequest as LogFacetRequest,
  HistogramRequest as LogHistogramRequest,
} from "../../../Server/Services/LogAggregationService";
import TraceAggregationService, {
  HistogramRequest as TraceHistogramRequest,
} from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService, {
  FacetRequest as ExceptionFacetRequest,
  HistogramRequest as ExceptionHistogramRequest,
} from "../../../Server/Services/ExceptionAggregationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ResourceEntityScope,
  appendResourceScopeFilters,
} from "../../../Server/Utils/Telemetry/ResourceEntityFilter";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * "Is not" in the hand-written aggregate reads behind the telemetry
 * explorers' charts and facet counts.
 *
 * A facet row's minus leaves a value out of the list. The list is read
 * through StatementGenerator, which always knew NOT IN; the chart above it
 * and the counts beside it are read here, and these took only values to
 * keep - so no explorer but Security Events offered an exclusion, or the
 * chart would have counted rows the list left out. Each read now takes what
 * is left out beside what is kept, as one NOT IN per column.
 */

const WHITESPACE: RegExp = /\s+/g;

/*
 * The query getter dedents the rendered SQL, so a fragment can lose its
 * leading space: whitespace is normalized, and the fragments a test pins
 * whole are compared trimmed.
 */
const normalized: (statement: Statement) => string = (
  statement: Statement,
): string => {
  return statement.query.replace(WHITESPACE, " ");
};

const paramValues: (statement: Statement) => Array<unknown> = (
  statement: Statement,
): Array<unknown> => {
  return Object.values(statement.query_params);
};

const countOf: (text: string, fragment: string) => number = (
  text: string,
  fragment: string,
): number => {
  return text.split(fragment).length - 1;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
);
const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("logs: severities left out", () => {
  const histogram: (overrides: Partial<LogHistogramRequest>) => Statement = (
    overrides: Partial<LogHistogramRequest>,
  ): Statement => {
    return (LogAggregationService as any).buildHistogramStatement({
      projectId: PROJECT_ID,
      startTime: new Date("2026-06-01T00:00:00.000Z"),
      endTime: new Date("2026-06-01T01:00:00.000Z"),
      bucketSizeInMinutes: 1,
      ...overrides,
    });
  };

  const facet: (overrides: Partial<LogFacetRequest>) => Statement = (
    overrides: Partial<LogFacetRequest>,
  ): Statement => {
    return (LogAggregationService as any).buildFacetStatement({
      projectId: PROJECT_ID,
      startTime: new Date("2026-06-01T00:00:00.000Z"),
      endTime: new Date("2026-06-01T01:00:00.000Z"),
      facetKey: "primaryEntityId",
      limit: 50,
      ...overrides,
    });
  };

  test("the chart leaves the severities out as one NOT IN", () => {
    const statement: Statement = histogram({
      excludedSeverityTexts: ["Debug", "Trace"],
    });

    expect(normalized(statement)).toContain(" AND severityText NOT IN (");
    expect(paramValues(statement)).toContainEqual(["Debug", "Trace"]);
  });

  test("the facet counts leave them out the same way", () => {
    const statement: Statement = facet({
      excludedSeverityTexts: ["Debug"],
    });

    expect(normalized(statement)).toContain(" AND severityText NOT IN (");
    expect(paramValues(statement)).toContainEqual(["Debug"]);
  });

  test("a severity left out keeps the chart on the severity projection", () => {
    /*
     * proj_severity_histogram stores the severity, so leaving one out is
     * answered from it: no retention filter (which would force a scan of
     * the base table) is added for it.
     */
    const leftOutOnly: Statement = histogram({
      excludedSeverityTexts: ["Debug"],
    });

    expect(normalized(leftOutOnly)).not.toContain("retentionDate");

    const withAService: Statement = histogram({
      excludedSeverityTexts: ["Debug"],
      serviceIds: [new ObjectID(CHECKOUT_ID)],
    });

    expect(normalized(withAService)).toContain("retentionDate");
  });

  test("kept and left-out severities both render: the read applies what it is given", () => {
    const statement: Statement = histogram({
      severityTexts: ["Error"],
      excludedSeverityTexts: ["Debug"],
    });

    expect(normalized(statement)).toContain(" AND severityText IN (");
    expect(normalized(statement)).toContain(" AND severityText NOT IN (");
  });

  test("an empty list leaves nothing out, rather than an empty NOT IN", () => {
    expect(normalized(histogram({ excludedSeverityTexts: [] }))).not.toContain(
      "NOT IN",
    );
    expect(normalized(histogram({}))).not.toContain("NOT IN");
  });

  test("a service left out is a NOT IN on the resource column", () => {
    const statement: Statement = facet({
      excludedServiceIds: [new ObjectID(CHECKOUT_ID), new ObjectID(BILLING_ID)],
    });

    expect(normalized(statement)).toContain(" AND primaryEntityId NOT IN (");
    expect(paramValues(statement)).toContainEqual([CHECKOUT_ID, BILLING_ID]);
  });
});

describe("traces: statuses, kinds and names left out", () => {
  const histogram: (overrides: Partial<TraceHistogramRequest>) => Statement = (
    overrides: Partial<TraceHistogramRequest>,
  ): Statement => {
    return (TraceAggregationService as any).buildHistogramStatement({
      projectId: PROJECT_ID,
      startTime: new Date("2026-06-01T00:00:00.000Z"),
      endTime: new Date("2026-06-02T00:00:00.000Z"),
      bucketSizeInMinutes: 5,
      ...overrides,
    });
  };

  test("a status left out is a NOT IN on statusCode, bound as the stored code", () => {
    const statement: Statement = histogram({ excludedStatusCodes: [2] });

    expect(normalized(statement)).toContain(" AND statusCode NOT IN (");
    expect(paramValues(statement)).toContainEqual(["2"]);
  });

  test("a span kind left out is a NOT IN on the kind as text", () => {
    const statement: Statement = histogram({
      excludedSpanKinds: ["SPAN_KIND_CLIENT", "SPAN_KIND_INTERNAL"],
    });

    expect(normalized(statement)).toContain(" AND toString(kind) NOT IN (");
    expect(paramValues(statement)).toContainEqual([
      "SPAN_KIND_CLIENT",
      "SPAN_KIND_INTERNAL",
    ]);
  });

  test("a span name left out is left out exactly, never as a substring", () => {
    const statement: Statement = histogram({
      excludedSpanNames: ["GET /health"],
    });

    expect(normalized(statement)).toContain(" AND name NOT IN (");
    expect(normalized(statement)).not.toContain("NOT name ILIKE");
    expect(paramValues(statement)).toContainEqual(["GET /health"]);
  });

  test("a name searched as a substring and one left out both apply: GET, but not GET /health", () => {
    const statement: Statement = histogram({
      spanNameSearches: ["GET"],
      excludedSpanNames: ["GET /health"],
    });

    expect(normalized(statement)).toContain(" AND name ILIKE ");
    expect(normalized(statement)).toContain(" AND name NOT IN (");
    expect(paramValues(statement)).toContain("%GET%");
  });

  test("a service left out is a NOT IN beside whatever services are kept", () => {
    const statement: Statement = histogram({
      excludedServiceIds: [new ObjectID(CHECKOUT_ID)],
    });

    expect(normalized(statement)).toContain(" AND primaryEntityId NOT IN (");
    expect(normalized(statement)).not.toContain(" AND primaryEntityId IN (");
  });

  test("empty lists leave nothing out", () => {
    const statement: Statement = histogram({
      excludedStatusCodes: [],
      excludedSpanKinds: [],
      excludedSpanNames: [],
    });

    expect(normalized(statement)).not.toContain("NOT IN");
  });
});

describe("exceptions: types and environments left out", () => {
  const histogram: (
    overrides: Partial<ExceptionHistogramRequest>,
  ) => Statement = (
    overrides: Partial<ExceptionHistogramRequest>,
  ): Statement => {
    return (ExceptionAggregationService as any).buildHistogramStatement({
      projectId: PROJECT_ID,
      startTime: new Date("2026-06-01T00:00:00.000Z"),
      endTime: new Date("2026-06-02T00:00:00.000Z"),
      bucketSizeInMinutes: 60,
      ...overrides,
    });
  };

  const facet: (overrides: Partial<ExceptionFacetRequest>) => Statement = (
    overrides: Partial<ExceptionFacetRequest>,
  ): Statement => {
    return (ExceptionAggregationService as any).buildFacetStatement({
      projectId: PROJECT_ID,
      startTime: new Date("2026-06-01T00:00:00.000Z"),
      endTime: new Date("2026-06-02T00:00:00.000Z"),
      facetKey: "environment",
      ...overrides,
    });
  };

  test("an exception type left out is a NOT IN, in the chart and the counts", () => {
    for (const statement of [
      histogram({ excludedExceptionTypes: ["TypeError"] }),
      facet({ excludedExceptionTypes: ["TypeError"] }),
    ]) {
      expect(normalized(statement)).toContain(" AND exceptionType NOT IN (");
      expect(paramValues(statement)).toContainEqual(["TypeError"]);
    }
  });

  test("an environment left out is a NOT IN, in the chart and the counts", () => {
    for (const statement of [
      histogram({ excludedEnvironments: ["staging", "dev"] }),
      facet({ excludedEnvironments: ["staging", "dev"] }),
    ]) {
      expect(normalized(statement)).toContain(" AND environment NOT IN (");
      expect(paramValues(statement)).toContainEqual(["staging", "dev"]);
    }
  });

  test("kept and left-out values on different columns both apply", () => {
    const statement: Statement = histogram({
      exceptionTypes: ["TypeError"],
      excludedEnvironments: ["staging"],
    });

    expect(normalized(statement)).toContain(" AND exceptionType IN (");
    expect(normalized(statement)).toContain(" AND environment NOT IN (");
  });

  test("empty lists leave nothing out", () => {
    const statement: Statement = histogram({
      excludedExceptionTypes: [],
      excludedEnvironments: [],
    });

    expect(normalized(statement)).not.toContain("NOT IN");
  });
});

describe("a resource left out", () => {
  const scopeOf: (isExcluded?: boolean) => ResourceEntityScope = (
    isExcluded?: boolean,
  ): ResourceEntityScope => {
    return {
      entityIds: [CHECKOUT_ID],
      entityKeys: ["key-web-01"],
      attributeKey: "resource.host.name",
      attributeValues: ["web-01"],
      ...(isExcluded === undefined ? {} : { isExcluded }),
    };
  };

  test("negates the resource's whole group, so a row belonging to it in ANY way is left out", () => {
    const statement: Statement = new Statement();
    appendResourceScopeFilters(statement, [scopeOf(true)]);

    expect(normalized(statement).trim()).toBe(
      "AND NOT (primaryEntityId IN ({p0:Array(String)}) OR hasAny(entityKeys, {p1:Array(String)}) OR attributes[{p2:String}] IN ({p3:Array(String)}))",
    );
  });

  test("a kept resource keeps its positive group, and only `true` negates", () => {
    for (const isExcluded of [undefined, false]) {
      const statement: Statement = new Statement();
      appendResourceScopeFilters(statement, [scopeOf(isExcluded)]);

      expect(
        normalized(statement).trim().startsWith("AND (primaryEntityId IN"),
      ).toBe(true);
      expect(normalized(statement)).not.toContain("NOT");
    }
  });

  test("a kept and a left-out resource AND together: in the cluster, but not on that host", () => {
    const statement: Statement = new Statement();
    appendResourceScopeFilters(statement, [
      { entityIds: [BILLING_ID], entityKeys: [] },
      scopeOf(true),
    ]);

    expect(countOf(normalized(statement), "AND (")).toBe(1);
    expect(countOf(normalized(statement), "AND NOT (")).toBe(1);
    expect(
      normalized(statement).indexOf("AND (") <
        normalized(statement).indexOf("AND NOT ("),
    ).toBe(true);
  });

  test("a left-out resource with nothing to match leaves nothing out, rather than everything", () => {
    const statement: Statement = new Statement();
    appendResourceScopeFilters(statement, [
      { entityIds: [], entityKeys: [], isExcluded: true },
    ]);

    expect(statement.query).toBe("");
  });

  test("a left-out resource with only its id still leaves out the rows keyed on it", () => {
    const statement: Statement = new Statement();
    appendResourceScopeFilters(statement, [
      { entityIds: [CHECKOUT_ID], entityKeys: [], isExcluded: true },
    ]);

    expect(normalized(statement).trim()).toBe(
      "AND NOT (primaryEntityId IN ({p0:Array(String)}))",
    );
  });
});

describe("the services a reader leaves out, beside the ones a block takes away", () => {
  test("join the blocked ones, once each, in lower case", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(
        { readableIds: null, blockedIds: [BILLING_ID.toUpperCase()] },
        undefined,
        [CHECKOUT_ID.toUpperCase(), BILLING_ID, "  "],
      );

    expect(filter.serviceIds).toBeUndefined();
    expect(
      (filter.excludedServiceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([BILLING_ID, CHECKOUT_ID]);
  });

  test("never widen what a limited reader may read", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(
        { readableIds: [CHECKOUT_ID], blockedIds: [] },
        undefined,
        [BILLING_ID],
      );

    expect(
      (filter.serviceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([CHECKOUT_ID]);
    expect(
      (filter.excludedServiceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([BILLING_ID]);
  });

  test("leave the kept services as asked", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(
        { readableIds: null, blockedIds: [] },
        [CHECKOUT_ID],
        [BILLING_ID],
      );

    expect(
      (filter.serviceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([CHECKOUT_ID]);
    expect(
      (filter.excludedServiceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([BILLING_ID]);
  });

  test("nothing left out and nothing blocked is no list at all", () => {
    const filter: TelemetryServiceFilter =
      TelemetryReadScopeUtil.toServiceFilter(
        { readableIds: null, blockedIds: [] },
        undefined,
        [],
      );

    expect(filter.excludedServiceIds).toBeUndefined();
  });
});
