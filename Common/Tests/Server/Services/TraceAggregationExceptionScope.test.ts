import TraceAggregationService, {
  FacetRequest,
  HistogramRequest,
} from "../../../Server/Services/TraceAggregationService";
import {
  SQL,
  Statement,
} from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The exception page's span list scopes the histogram and the facets with the
 * same exceptionScope the list query carries. If the aggregations ignored it,
 * the chart above an exception's spans would count every span in the project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";
const FINGERPRINT: string = "fp-9f86d081884c7d65";

const normalized: (statement: Statement) => string = (
  statement: Statement,
): string => {
  return statement.query.replace(/\s+/g, " ");
};

const params: (statement: Statement) => Array<string> = (
  statement: Statement,
): Array<string> => {
  return Object.values(statement.query_params).map((value: unknown) => {
    return String(value);
  });
};

describe("TraceAggregationService exceptionScope", () => {
  const histogramRequest: HistogramRequest = {
    projectId: PROJECT_ID,
    startTime: new Date("2026-09-13T12:00:00.000Z"),
    endTime: new Date("2026-09-14T12:00:00.000Z"),
    bucketSizeInMinutes: 30,
  };

  const buildHistogram: (overrides?: Partial<HistogramRequest>) => Statement = (
    overrides: Partial<HistogramRequest> = {},
  ): Statement => {
    return (TraceAggregationService as any).buildHistogramStatement({
      ...histogramRequest,
      ...overrides,
    });
  };

  test("the histogram narrows to the exception's spans, pinned to the project", () => {
    const statement: Statement = buildHistogram({
      exceptionScope: { fingerprint: FINGERPRINT },
    });

    expect(normalized(statement)).toContain(
      "AND (traceId, spanId) IN (SELECT traceId, spanId FROM",
    );
    expect(params(statement)).toEqual(
      expect.arrayContaining([
        AnalyticsTableName.ExceptionInstance,
        PROJECT_ID.toString(),
        FINGERPRINT,
      ]),
    );
    expect(normalized(statement)).not.toContain("primaryEntityId = ");
  });

  test("adds the service when the scope names one", () => {
    const statement: Statement = buildHistogram({
      exceptionScope: { fingerprint: FINGERPRINT, primaryEntityId: SERVICE_ID },
    });

    expect(normalized(statement)).toMatch(
      /AND fingerprint = \{p\d+:String\} AND primaryEntityId = \{p\d+:String\}\)/,
    );
    expect(params(statement)).toContain(SERVICE_ID);
  });

  test("emits nothing when no exception scope is requested", () => {
    expect(normalized(buildHistogram())).not.toContain("IN (SELECT traceId");
  });

  test("the facets carry the same scope", () => {
    const facetRequest: FacetRequest = {
      ...histogramRequest,
      facetKey: "statusCode",
      exceptionScope: { fingerprint: FINGERPRINT },
    } as FacetRequest;

    const statement: Statement = (
      TraceAggregationService as any
    ).buildFacetStatement(facetRequest);

    expect(normalized(statement)).toContain(
      "AND (traceId, spanId) IN (SELECT traceId, spanId FROM",
    );
    expect(params(statement)).toContain(FINGERPRINT);
  });

  describe("appendExceptionScopeFilter", () => {
    test("matches nothing without a project", () => {
      const statement: Statement = SQL`SELECT 1 WHERE TRUE`;

      TraceAggregationService.appendExceptionScopeFilter(statement, {
        exceptionScope: { fingerprint: FINGERPRINT },
      });

      expect(normalized(statement)).toBe("SELECT 1 WHERE TRUE AND 0");
    });

    test("is a no-op without a scope", () => {
      const statement: Statement = SQL`SELECT 1 WHERE TRUE`;

      TraceAggregationService.appendExceptionScopeFilter(statement, {
        projectId: PROJECT_ID,
      });

      expect(normalized(statement)).toBe("SELECT 1 WHERE TRUE");
    });

    test("binds every value as a parameter", () => {
      const statement: Statement = SQL`SELECT 1 WHERE TRUE`;

      TraceAggregationService.appendExceptionScopeFilter(statement, {
        projectId: PROJECT_ID,
        exceptionScope: {
          fingerprint: "'); DROP TABLE Span; --",
          primaryEntityId: SERVICE_ID,
        },
      });

      expect(normalized(statement)).not.toContain("DROP TABLE");
      expect(params(statement)).toContain("'); DROP TABLE Span; --");
    });
  });
});
