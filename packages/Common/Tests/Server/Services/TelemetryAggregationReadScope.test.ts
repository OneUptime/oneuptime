import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import MetricAggregationService from "../../../Server/Services/MetricAggregationService";
import ProfileAggregationService from "../../../Server/Services/ProfileAggregationService";
import LogDatabaseService from "../../../Server/Services/LogService";
import SpanService from "../../../Server/Services/SpanService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import MetricService from "../../../Server/Services/MetricService";
import ProfileService from "../../../Server/Services/ProfileService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Every aggregation the /telemetry routes and the AI tools run builds its own
 * ClickHouse SQL, so the caller's scope reaches it only as serviceIds and
 * excludedServiceIds (TelemetryReadScope.toServiceFilter). These tests call
 * each read with both set and look at every statement it sends: each one
 * keeps the readable services and leaves the blocked ones out. A new builder
 * that forgets either fails here.
 */

const projectId: ObjectID = ObjectID.generate();
const readable: ObjectID = ObjectID.generate();
const blocked: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-10-01T00:00:00.000Z");
const endTime: Date = new Date("2026-10-01T06:00:00.000Z");

const scoped: {
  serviceIds: Array<ObjectID>;
  excludedServiceIds: Array<ObjectID>;
} = {
  serviceIds: [readable],
  excludedServiceIds: [blocked],
};

type ExecuteQuery = (statement: Statement) => Promise<unknown>;

let captured: Array<Statement> = [];

function emptyResult(): unknown {
  return {
    json: async (): Promise<unknown> => {
      return { data: [] };
    },
  };
}

function capture(service: { executeQuery: ExecuteQuery }): void {
  jest
    .spyOn(service, "executeQuery")
    .mockImplementation(async (statement: Statement): Promise<never> => {
      captured.push(statement);
      return emptyResult() as never;
    });
}

beforeEach(() => {
  captured = [];
  for (const service of [
    LogDatabaseService,
    SpanService,
    ExceptionInstanceService,
    MetricService,
    ProfileService,
    ProfileSampleService,
  ]) {
    capture(service as unknown as { executeQuery: ExecuteQuery });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectEveryStatementScoped(): void {
  expect(captured.length).toBeGreaterThan(0);

  for (const statement of captured) {
    expect(statement.query).toMatch(/primaryEntityId IN \(/);
    expect(statement.query).toMatch(/primaryEntityId NOT IN \(/);

    const values: Array<unknown> = Object.values(statement.query_params);
    expect(values).toContainEqual([readable.toString()]);
    expect(values).toContainEqual([blocked.toString()]);
  }
}

type ScopedRead = [string, () => Promise<unknown>];

const logReads: Array<ScopedRead> = [
  [
    "histogram",
    () => {
      return LogAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        ...scoped,
      });
    },
  ],
  [
    "facet values",
    () => {
      return LogAggregationService.getFacetValues({
        projectId,
        startTime,
        endTime,
        facetKey: "severityText",
        ...scoped,
      });
    },
  ],
  [
    "analytics timeseries",
    () => {
      return LogAggregationService.getAnalyticsTimeseries({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        chartType: "timeseries",
        aggregation: "count",
        ...scoped,
      });
    },
  ],
  [
    "analytics top list",
    () => {
      return LogAggregationService.getAnalyticsTopList({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        chartType: "toplist",
        aggregation: "count",
        groupBy: ["severityText"],
        ...scoped,
      });
    },
  ],
  [
    "analytics table",
    () => {
      return LogAggregationService.getAnalyticsTable({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        chartType: "table",
        aggregation: "count",
        groupBy: ["severityText"],
        ...scoped,
      });
    },
  ],
  [
    "export",
    () => {
      return LogAggregationService.getExportLogs({
        projectId,
        startTime,
        endTime,
        limit: 100,
        ...scoped,
      });
    },
  ],
  [
    "drop filter estimate",
    () => {
      return LogAggregationService.getDropFilterEstimate({
        projectId,
        startTime,
        endTime,
        filterQuery: "timeout",
        ...scoped,
      });
    },
  ],
  [
    "top error patterns",
    () => {
      return LogAggregationService.getTopErrorPatterns({
        projectId,
        startTime,
        endTime,
        ...scoped,
      });
    },
  ],
  [
    "error pattern timeline",
    () => {
      return LogAggregationService.getErrorPatternTimeline({
        projectId,
        startTime,
        endTime,
        pattern: "timeout <*>",
        bucketSizeInMinutes: 5,
        ...scoped,
      });
    },
  ],
  [
    "error pattern co-occurrences",
    () => {
      return LogAggregationService.getErrorPatternCoOccurrences({
        projectId,
        startTime,
        endTime,
        pattern: "timeout <*>",
        bucketSizeInMinutes: 5,
        ...scoped,
      });
    },
  ],
  [
    "error pattern attributes",
    () => {
      return LogAggregationService.getErrorPatternAttributes({
        projectId,
        startTime,
        endTime,
        pattern: "timeout <*>",
        ...scoped,
      });
    },
  ],
  [
    "error pattern resources",
    () => {
      return LogAggregationService.getErrorPatternResources({
        projectId,
        startTime,
        endTime,
        pattern: "timeout <*>",
        ...scoped,
      });
    },
  ],
  [
    "error pattern traces",
    () => {
      return LogAggregationService.getErrorPatternTraces({
        projectId,
        startTime,
        endTime,
        pattern: "timeout <*>",
        ...scoped,
      });
    },
  ],
  [
    "error pattern samples",
    () => {
      return LogAggregationService.getErrorPatternSamples({
        projectId,
        startTime,
        endTime,
        pattern: "timeout <*>",
        ...scoped,
      });
    },
  ],
];

const traceReads: Array<ScopedRead> = [
  [
    "histogram",
    () => {
      return TraceAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        ...scoped,
      });
    },
  ],
  [
    "facet values",
    () => {
      return TraceAggregationService.getFacetValues({
        projectId,
        startTime,
        endTime,
        facetKey: "kind",
        ...scoped,
      });
    },
  ],
  [
    "sampled facet values",
    () => {
      return TraceAggregationService.getFacetValuesFromSample({
        projectId,
        startTime,
        endTime,
        facetKeys: ["kind"],
        ...scoped,
      });
    },
  ],
  [
    "resource facet counts",
    () => {
      return TraceAggregationService.getResourceFacetCounts({
        projectId,
        startTime,
        endTime,
        facetKeys: ["primaryEntityId", "statusCode"],
        ...scoped,
      });
    },
  ],
  [
    "root span counts",
    () => {
      return TraceAggregationService.getRootSpanCounts({
        projectId,
        startTime,
        endTime,
        facetKeys: ["isRootSpan"],
        ...scoped,
      });
    },
  ],
  [
    "has-exception counts",
    () => {
      return TraceAggregationService.getHasExceptionCounts({
        projectId,
        startTime,
        endTime,
        facetKeys: ["hasException"],
        ...scoped,
      });
    },
  ],
  [
    "analytics timeseries",
    () => {
      return TraceAggregationService.getAnalyticsTimeseries({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        chartType: "timeseries",
        metric: "count",
        ...scoped,
      });
    },
  ],
  [
    "analytics top list",
    () => {
      return TraceAggregationService.getAnalyticsTopList({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        chartType: "toplist",
        metric: "count",
        groupBy: ["name"],
        ...scoped,
      });
    },
  ],
  [
    "analytics table",
    () => {
      return TraceAggregationService.getAnalyticsTable({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        chartType: "table",
        metric: "count",
        groupBy: ["name"],
        ...scoped,
      });
    },
  ],
];

const exceptionReads: Array<ScopedRead> = [
  [
    "histogram",
    () => {
      return ExceptionAggregationService.getHistogram({
        projectId,
        startTime,
        endTime,
        bucketSizeInMinutes: 5,
        ...scoped,
      });
    },
  ],
  [
    "facet values",
    () => {
      return ExceptionAggregationService.getFacetValues({
        projectId,
        startTime,
        endTime,
        facetKey: "exceptionType",
        ...scoped,
      });
    },
  ],
];

const metricReads: Array<ScopedRead> = [
  [
    "facet values",
    () => {
      return MetricAggregationService.getFacetValues({
        projectId,
        startTime,
        endTime,
        facetKey: "name",
        ...scoped,
      });
    },
  ],
  [
    "metrics for a trace",
    () => {
      return MetricAggregationService.getMetricsForTrace({
        projectId,
        traceId: "0123456789abcdef0123456789abcdef",
        ...scoped,
      });
    },
  ],
];

const profileReads: Array<ScopedRead> = [
  [
    "flame graph",
    () => {
      return ProfileAggregationService.getFlamegraph({
        projectId,
        startTime,
        endTime,
        ...scoped,
      });
    },
  ],
  [
    "function list",
    () => {
      return ProfileAggregationService.getFunctionList({
        projectId,
        startTime,
        endTime,
        ...scoped,
      });
    },
  ],
  [
    "function focus",
    () => {
      return ProfileAggregationService.getFunctionFocus({
        projectId,
        functionName: "main",
        fileName: "",
        startTime,
        endTime,
        ...scoped,
      });
    },
  ],
  [
    "diff flame graph",
    () => {
      return ProfileAggregationService.getDiffFlamegraph({
        projectId,
        baselineStartTime: startTime,
        baselineEndTime: endTime,
        comparisonStartTime: startTime,
        comparisonEndTime: endTime,
        ...scoped,
      });
    },
  ],
  [
    "service activity",
    () => {
      return ProfileAggregationService.getServiceActivity({
        projectId,
        startTime,
        endTime,
        ...scoped,
      });
    },
  ],
  [
    "breakdown",
    () => {
      return ProfileAggregationService.getBreakdown({
        projectId,
        startTime,
        endTime,
        breakdownBy: "service",
        ...scoped,
      });
    },
  ],
  [
    "trace presence",
    () => {
      return ProfileAggregationService.getTracePresence({
        projectId,
        traceId: "0123456789abcdef0123456789abcdef",
        ...scoped,
      });
    },
  ],
];

describe("every aggregation keeps the readable services and leaves the blocked ones out", () => {
  describe.each([
    ["logs", logReads],
    ["traces", traceReads],
    ["exceptions", exceptionReads],
    ["metrics", metricReads],
    ["profiles", profileReads],
  ])("%s", (_signal: string, reads: Array<ScopedRead>) => {
    test.each(reads)(
      "%s",
      async (_name: string, read: () => Promise<unknown>) => {
        await read();
        expectEveryStatementScoped();
      },
    );
  });

  test("a read with no scope adds no filter of its own", async () => {
    await LogAggregationService.getHistogram({
      projectId,
      startTime,
      endTime,
      bucketSizeInMinutes: 5,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.query).not.toMatch(/primaryEntityId (NOT )?IN/);
  });
});

/*
 * The SQL that names serviceIds is in one place per service: each one hands
 * the request to TelemetryReadScope.appendServiceFilter, so the IN and the
 * NOT IN cannot be split by a builder that only knows one of them.
 */
describe("the aggregation services read the service filter in one place", () => {
  const SERVICE_FILES: Array<string> = [
    "LogAggregationService.ts",
    "TraceAggregationService.ts",
    "ExceptionAggregationService.ts",
    "MetricAggregationService.ts",
    "ProfileAggregationService.ts",
    "TelemetryAttributeService.ts",
  ];

  test.each(SERVICE_FILES)("%s", (file: string) => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services", file),
      "utf8",
    );

    expect(source).toContain("TelemetryReadScopeUtil.appendServiceFilter(");
    // Nobody builds `primaryEntityId IN (` out of serviceIds by hand.
    expect(source).not.toMatch(/request\.serviceIds\.map\(/);
    expect(source).not.toMatch(/data\.serviceIds\.map\(/);
  });
});
