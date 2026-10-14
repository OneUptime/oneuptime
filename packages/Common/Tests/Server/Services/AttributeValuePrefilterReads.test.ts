import LogAggregationService, {
  FacetRequest as LogFacetRequest,
  HistogramRequest as LogHistogramRequest,
  TopErrorPatternsRequest,
} from "../../../Server/Services/LogAggregationService";
import TraceAggregationService, {
  FacetRequest as TraceFacetRequest,
  HistogramRequest as TraceHistogramRequest,
} from "../../../Server/Services/TraceAggregationService";
import MetricAggregationService, {
  FacetRequest as MetricFacetRequest,
} from "../../../Server/Services/MetricAggregationService";
import LogDatabaseService from "../../../Server/Services/LogService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * #4706: a log search filtered on an attribute value read every row of the
 * time range, because the histogram, facets, export and every other chart
 * match attributes through a case-insensitive arrayExists lambda that no
 * index can see through. Every one of those reads - on logs, traces and
 * metrics - now compiles its `attributes` through one function
 * (AttributeFilterStatement.appendAttributeFilters), which checks an exact
 * value with `has(mapValues(attributes), v)` before the lambda. This suite
 * pins that each read gets it, with the same SQL on every signal, and only
 * for the filters that need a value to be present.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const START_TIME: Date = new Date("2026-10-12T00:00:00.000Z");
const END_TIME: Date = new Date("2026-10-13T00:00:00.000Z");

const PREFILTERED_EQUALS: RegExp =
  /has\(mapValues\(attributes\), \{p\d+:String\}\) AND arrayExists\(\(k, v\) -> lowerUTF8\(k\) = lowerUTF8\(\{p\d+:String\}\) AND v = \{p\d+:String\}, mapKeys\(attributes\), mapValues\(attributes\)\)/g;
const PREFILTERED_IN: RegExp =
  /hasAny\(mapValues\(attributes\), \{p\d+:Array\(String\)\}\) AND arrayExists\(\(k, v\) -> lowerUTF8\(k\) = lowerUTF8\(\{p\d+:String\}\) AND v IN \(\{p\d+:Array\(String\)\}\), mapKeys\(attributes\), mapValues\(attributes\)\)/g;
const ANY_PREFILTER: RegExp = /has(Any)?\(mapValues\(attributes\)/;
const WHITESPACE: RegExp = /\s+/g;
const PARAMETER_NUMBER: RegExp = /\{p\d+:/g;

type Read = (attributes: Record<string, unknown>) => Promise<Statement>;

function normalized(statement: Statement): string {
  return statement.query.replace(WHITESPACE, " ");
}

// The attribute predicates of a statement, parameter numbers left out.
function attributePredicates(statement: Statement): Array<string> {
  const query: string = normalized(statement);

  return [
    ...(query.match(PREFILTERED_EQUALS) || []),
    ...(query.match(PREFILTERED_IN) || []),
  ].map((predicate: string): string => {
    return predicate.replace(PARAMETER_NUMBER, "{p:");
  });
}

const logHistogram: Read = async (
  attributes: Record<string, unknown>,
): Promise<Statement> => {
  const request: LogHistogramRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    bucketSizeInMinutes: 30,
    attributes: attributes as LogHistogramRequest["attributes"],
  };

  return (LogAggregationService as any).buildHistogramStatement(request);
};

function logFacet(facetKey: string): Read {
  return async (attributes: Record<string, unknown>): Promise<Statement> => {
    const request: LogFacetRequest = {
      projectId: PROJECT_ID,
      startTime: START_TIME,
      endTime: END_TIME,
      facetKey: facetKey,
      attributes: attributes as LogFacetRequest["attributes"],
    };

    return (LogAggregationService as any).buildFacetStatement(request);
  };
}

const logTopErrorPatterns: Read = async (
  attributes: Record<string, unknown>,
): Promise<Statement> => {
  const request: TopErrorPatternsRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    attributes: attributes as TopErrorPatternsRequest["attributes"],
  };

  return (LogAggregationService as any).buildTopErrorPatternsStatement(request);
};

/*
 * The export runs its statement itself; this catches it on its way to the
 * database.
 */
const logExport: Read = async (
  attributes: Record<string, unknown>,
): Promise<Statement> => {
  let captured: Statement | undefined;

  jest
    .spyOn(LogDatabaseService, "executeQuery")
    .mockImplementation(async (statement: unknown): Promise<any> => {
      captured = statement as Statement;
      return {
        json: async (): Promise<unknown> => {
          return { data: [] };
        },
      };
    });

  await LogAggregationService.getExportLogs({
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    limit: 100,
    attributes: attributes as Record<string, string>,
  });

  if (!captured) {
    throw new Error("the export ran no statement");
  }

  return captured;
};

const traceHistogram: Read = async (
  attributes: Record<string, unknown>,
): Promise<Statement> => {
  const request: TraceHistogramRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    bucketSizeInMinutes: 30,
    attributes: attributes as TraceHistogramRequest["attributes"],
  };

  return (TraceAggregationService as any).buildHistogramStatement(request);
};

const traceFacet: Read = async (
  attributes: Record<string, unknown>,
): Promise<Statement> => {
  const request: TraceFacetRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    facetKey: "statusCode",
    attributes: attributes as TraceFacetRequest["attributes"],
  };

  return (TraceAggregationService as any).buildFacetStatement(request);
};

const metricFacet: Read = async (
  attributes: Record<string, unknown>,
): Promise<Statement> => {
  const request: MetricFacetRequest = {
    projectId: PROJECT_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    facetKey: "name",
    attributes: attributes as MetricFacetRequest["attributes"],
  };

  return (MetricAggregationService as any).buildFacetStatement(request);
};

const READS: Array<[string, Read]> = [
  ["the log histogram", logHistogram],
  ["the log severity facet", logFacet("severityText")],
  ["a log attribute facet", logFacet("http.status_code")],
  ["the log export", logExport],
  ["the log top error patterns", logTopErrorPatterns],
  ["the trace histogram", traceHistogram],
  ["a trace facet", traceFacet],
  ["a metric facet", metricFacet],
];

describe("an exact attribute value is looked up in the value index on every chart", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(READS)(
    "%s checks an exact value with has(mapValues(attributes), ...) before the lambda",
    async (_label: string, read: Read) => {
      const statement: Statement = await read({
        "http.route": "/orders/export",
      });

      expect(attributePredicates(statement)).toEqual([
        "has(mapValues(attributes), {p:String}) AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8({p:String}) AND v = {p:String}, mapKeys(attributes), mapValues(attributes))",
      ]);
      expect(Object.values(statement.query_params)).toContain("/orders/export");
      // Bound, never inlined.
      expect(statement.query).not.toContain("/orders/export");
    },
  );

  test.each(READS)(
    "%s checks a list with hasAny(mapValues(attributes), ...) before the lambda",
    async (_label: string, read: Read) => {
      const statement: Statement = await read({
        "http.route": ["/orders/export", "/cart"],
      });

      expect(attributePredicates(statement)).toEqual([
        "hasAny(mapValues(attributes), {p:Array(String)}) AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8({p:String}) AND v IN ({p:Array(String)}), mapKeys(attributes), mapValues(attributes))",
      ]);
      expect(Object.values(statement.query_params)).toContainEqual([
        "/orders/export",
        "/cart",
      ]);
    },
  );

  test.each(READS)(
    "%s adds no pre-filter for a filter that needs no value present",
    async (_label: string, read: Read) => {
      for (const attributes of [
        { "http.route": "" },
        { "http.route": [] },
        { "http.route": { _type: "NotEqual", value: "/a" } },
        { "http.route": { _type: "Search", value: "orders" } },
        { "http.route": { _type: "Wildcard", value: ["/orders/*"] } },
        { "http.route": { _type: "IncludesNone", value: ["/a"] } },
        { "http.route": { _type: "NotNull" } },
        { "duration.ms": { _type: "GreaterThan", value: 5 } },
      ]) {
        const statement: Statement = await read(attributes);

        expect(normalized(statement)).not.toMatch(ANY_PREFILTER);
      }
    },
  );

  test("logs, traces and metrics compile the same attribute map to the same predicates", async () => {
    const attributes: Record<string, unknown> = {
      "http.route": "/orders/export",
      "http.method": ["GET", "POST"],
    };

    const compiled: Array<Array<string>> = [];

    for (const [, read] of READS) {
      compiled.push(attributePredicates(await read(attributes)));
    }

    for (const predicates of compiled) {
      expect(predicates).toEqual(compiled[0]);
    }

    expect(compiled[0]).toHaveLength(2);
  });

  test.each(READS)(
    "%s still refuses a key the service does not accept, before any SQL",
    async (_label: string, read: Read) => {
      await expect(read({ "http route; DROP": "x" })).rejects.toThrow(
        BadDataException,
      );
    },
  );
});
