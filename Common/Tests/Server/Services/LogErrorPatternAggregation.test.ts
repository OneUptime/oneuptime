import LogAggregationService, {
  DEFAULT_ERROR_LOG_SEVERITIES,
  ErrorPatternAttribute,
  ErrorPatternCoOccurrence,
  ErrorPatternResource,
  ErrorPatternSample,
  ErrorPatternTimelinePoint,
  ErrorPatternTrace,
  TopErrorPattern,
} from "../../../Server/Services/LogAggregationService";
import LogDatabaseService from "../../../Server/Services/LogService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { LOG_ERROR_PATTERN_MAX_LENGTH } from "../../../Utils/Telemetry/LogErrorPattern";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The error-pattern reads are what turn the Logs Insights page from a pile
 * of counters into an answer. Every one of them has to satisfy the same
 * three properties, which is what this suite pins:
 *
 *   1. the clustering happens in ClickHouse, over the whole window;
 *   2. every drill-down sees EXACTLY the slice the top-list saw (same
 *      window, same severities, same resource scope) — a panel that
 *      quietly widened its own scope would show correlations that are not
 *      real;
 *   3. nothing a caller supplies reaches the SQL text.
 */

const projectId: ObjectID = ObjectID.generate();
const startTime: Date = new Date("2026-08-19T00:00:00.000Z");
const endTime: Date = new Date("2026-08-21T00:00:00.000Z");
const pattern: string = "connection refused to <ip>:<num>";

/*
 * Stub the ClickHouse boundary and capture the Statements handed to it, so
 * the public (async) read methods can be exercised without a database —
 * the same pattern the sibling LogAggregationService suite uses.
 */
function stubAndCapture(rows: Array<JSONObject>): Array<Statement> {
  const captured: Array<Statement> = [];
  const fakeResult: Results = {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  jest
    .spyOn(LogDatabaseService, "executeQuery")
    .mockImplementation((statement: Statement | string): Promise<Results> => {
      captured.push(statement as Statement);
      return Promise.resolve(fakeResult);
    });

  return captured;
}

function baseFilters(): {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
} {
  return { projectId, startTime, endTime };
}

function detailRequest(overrides: Record<string, unknown> = {}): any {
  return {
    ...baseFilters(),
    pattern,
    bucketSizeInMinutes: 60,
    ...overrides,
  };
}

/** Every async error-pattern read, so shared invariants can be swept. */
const DETAIL_READS: Array<{
  name: string;
  run: (request: any) => Promise<unknown>;
}> = [
  {
    name: "timeline",
    run: (request: any) => {
      return LogAggregationService.getErrorPatternTimeline(request);
    },
  },
  {
    name: "co-occurrences",
    run: (request: any) => {
      return LogAggregationService.getErrorPatternCoOccurrences(request);
    },
  },
  {
    name: "attributes",
    run: (request: any) => {
      return LogAggregationService.getErrorPatternAttributes(request);
    },
  },
  {
    name: "resources",
    run: (request: any) => {
      return LogAggregationService.getErrorPatternResources(request);
    },
  },
  {
    name: "traces",
    run: (request: any) => {
      return LogAggregationService.getErrorPatternTraces(request);
    },
  },
  {
    name: "samples",
    run: (request: any) => {
      return LogAggregationService.getErrorPatternSamples(request);
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getTopErrorPatterns", () => {
  test("groups in the database and returns one row per pattern", async () => {
    const captured: Array<Statement> = stubAndCapture([
      {
        pattern,
        cnt: 30,
        sampleBody: "connection refused to 10.0.0.4:5432",
        firstSeen: "2026-08-19 03:00:00.000000000",
        lastSeen: "2026-08-20 22:14:02.000000000",
        resourceCount: 2,
        resourceIds: ["svc-a", "svc-b"],
        severities: ["Error"],
        traceCount: 4,
        sampleTraceIds: ["t1", "t2"],
      },
    ]);

    const patterns: Array<TopErrorPattern> =
      await LogAggregationService.getTopErrorPatterns(baseFilters());

    expect(captured.length).toBe(1);
    expect(captured[0]!.query).toContain("GROUP BY pattern");
    expect(captured[0]!.query).toContain("ORDER BY cnt DESC");
    expect(captured[0]!.query).toContain("replaceRegexpAll(");

    expect(patterns).toEqual([
      {
        pattern,
        sampleBody: "connection refused to 10.0.0.4:5432",
        count: 30,
        firstSeenAt: "2026-08-19 03:00:00.000000000",
        lastSeenAt: "2026-08-20 22:14:02.000000000",
        resourceCount: 2,
        resourceIds: ["svc-a", "svc-b"],
        severities: ["Error"],
        traceCount: 4,
        sampleTraceIds: ["t1", "t2"],
      },
    ]);
  });

  test("selects the first-seen, last-seen and reach columns the list needs", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns(baseFilters());

    const query: string = captured[0]!.query;

    expect(query).toContain("min(time) AS firstSeen");
    expect(query).toContain("max(time) AS lastSeen");
    expect(query).toContain("uniqExact(primaryEntityId) AS resourceCount");
    expect(query).toContain("argMax(ifNull(body, ''), time) AS sampleBody");
    /*
     * Trace reach must ignore the Nullable column's NULLs explicitly:
     * `traceId != ''` alone is NULL for a log with no trace, and a NULL
     * condition is not a counted one.
     */
    expect(query).toContain(
      "uniqExactIf(traceId, ifNull(traceId, '') != '') AS traceCount",
    );
  });

  test("defaults to Error and Fatal when the caller names no severities", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns(baseFilters());

    expect(captured[0]!.query).toContain("AND severityText IN (");
    expect(Object.values(captured[0]!.query_params)).toContainEqual(
      DEFAULT_ERROR_LOG_SEVERITIES,
    );
  });

  test("an explicit severity selection replaces the default", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      severityTexts: ["Warning"],
    });

    expect(Object.values(captured[0]!.query_params)).toContainEqual([
      "Warning",
    ]);
    expect(Object.values(captured[0]!.query_params)).not.toContainEqual(
      DEFAULT_ERROR_LOG_SEVERITIES,
    );
  });

  test("an empty severity array is treated as 'not specified', not as 'match nothing'", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      severityTexts: [],
    });

    expect(Object.values(captured[0]!.query_params)).toContainEqual(
      DEFAULT_ERROR_LOG_SEVERITIES,
    );
  });

  test("excludes empty and whitespace-only bodies from the aggregation", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns(baseFilters());

    expect(captured[0]!.query).toContain(
      "AND notEmpty(trimBoth(ifNull(body, '')))",
    );
  });

  test("applies the read-side retention filter", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns(baseFilters());

    expect(captured[0]!.query).toContain("AND retentionDate >= now()");
  });

  test("threads the service scope into the read", async () => {
    const serviceId: ObjectID = ObjectID.generate();
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      serviceIds: [serviceId],
    });

    expect(captured[0]!.query).toMatch(
      /AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(Object.values(captured[0]!.query_params)).toContainEqual([
      serviceId.toString(),
    ]);
  });

  test("threads entity keys, trace/span/session scope and attribute filters", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      entityKeys: ["host-key-1"],
      traceIds: ["trace-1"],
      spanIds: ["span-1"],
      sessionIds: ["sess-1"],
      attributes: { "k8s.pod.name": "checkout-7d9" },
    });

    const query: string = captured[0]!.query;
    const values: Array<unknown> = Object.values(captured[0]!.query_params);

    expect(query).toContain("hasAny(entityKeys,");
    expect(query).toMatch(/AND traceId IN \(\{p\d+:Array\(String\)\}\)/);
    expect(query).toMatch(/AND spanId IN \(\{p\d+:Array\(String\)\}\)/);
    expect(query).toMatch(/AND sessionId IN \(\{p\d+:Array\(String\)\}\)/);
    expect(query).toContain("arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(");
    expect(values).toContainEqual(["host-key-1"]);
    expect(values).toContain("checkout-7d9");
  });

  test("clamps the limit into range and defaults when it is absent or nonsense", async () => {
    const limitOf: (statement: Statement) => number = (
      statement: Statement,
    ): number => {
      const numbers: Array<number> = Object.values(
        statement.query_params,
      ).filter((value: unknown): value is number => {
        return typeof value === "number";
      });

      // The trailing LIMIT is the last bound number in the statement.
      return numbers[numbers.length - 1]!;
    };

    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns(baseFilters());
    expect(limitOf(captured[0]!)).toBe(10);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      limit: 5000,
    });
    expect(limitOf(captured[1]!)).toBe(50);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      limit: 0,
    });
    expect(limitOf(captured[2]!)).toBe(1);

    await LogAggregationService.getTopErrorPatterns({
      ...baseFilters(),
      limit: Number.NaN,
    });
    expect(limitOf(captured[3]!)).toBe(10);
  });

  test("drops rows whose pattern came back empty", async () => {
    stubAndCapture([
      { pattern: "", cnt: 9 },
      { pattern, cnt: 3 },
    ]);

    const patterns: Array<TopErrorPattern> =
      await LogAggregationService.getTopErrorPatterns(baseFilters());

    expect(
      patterns.map((p: TopErrorPattern) => {
        return p.pattern;
      }),
    ).toEqual([pattern]);
  });

  test("coerces malformed array aggregates instead of throwing", async () => {
    stubAndCapture([
      {
        pattern,
        cnt: "12",
        resourceIds: "not-an-array",
        severities: ["Error", null, ""],
        sampleTraceIds: null,
      },
    ]);

    const patterns: Array<TopErrorPattern> =
      await LogAggregationService.getTopErrorPatterns(baseFilters());

    expect(patterns[0]!.count).toBe(12);
    expect(patterns[0]!.resourceIds).toEqual([]);
    expect(patterns[0]!.severities).toEqual(["Error"]);
    expect(patterns[0]!.sampleTraceIds).toEqual([]);
  });

  test("caps the sampled id arrays so a hot pattern cannot return a huge row", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getTopErrorPatterns(baseFilters());

    /*
     * Inlined constants, not bound parameters: these are the parameters of
     * a parametric aggregate function, which ClickHouse requires to be
     * constants.
     */
    expect(captured[0]!.query).toContain(
      "groupUniqArray(5)(toString(primaryEntityId)) AS resourceIds",
    );
    expect(captured[0]!.query).toContain(
      "groupUniqArray(8)(toString(severityText)) AS severities",
    );
    expect(captured[0]!.query).toContain(
      "groupUniqArrayIf(5)(ifNull(traceId, ''), ifNull(traceId, '') != '') AS sampleTraceIds",
    );
  });
});

describe("error-pattern drill-downs share the top list's scope", () => {
  test.each(DETAIL_READS)(
    "$name scopes to the pattern, the window and the default severities",
    async ({ run }: { run: (request: any) => Promise<unknown> }) => {
      const captured: Array<Statement> = stubAndCapture([]);

      await run(detailRequest());

      const statement: Statement = captured[0]!;
      const values: Array<unknown> = Object.values(statement.query_params);

      expect(statement.query).toContain("replaceRegexpAll(");
      expect(values).toContain(pattern);
      expect(values).toContainEqual(DEFAULT_ERROR_LOG_SEVERITIES);
      expect(statement.query).toContain("AND retentionDate >= now()");
      expect(statement.query).toContain(
        "AND notEmpty(trimBoth(ifNull(body, '')))",
      );
    },
  );

  test.each(DETAIL_READS)(
    "$name carries the caller's service scope",
    async ({ run }: { run: (request: any) => Promise<unknown> }) => {
      const serviceId: ObjectID = ObjectID.generate();
      const captured: Array<Statement> = stubAndCapture([]);

      await run(detailRequest({ serviceIds: [serviceId] }));

      expect(Object.values(captured[0]!.query_params)).toContainEqual([
        serviceId.toString(),
      ]);
    },
  );

  test.each(DETAIL_READS)(
    "$name never puts the caller's pattern into the query text",
    async ({ run }: { run: (request: any) => Promise<unknown> }) => {
      const injection: string =
        "x' OR 1=1 UNION ALL SELECT version() FROM system.one -- ";
      const captured: Array<Statement> = stubAndCapture([]);

      await run(detailRequest({ pattern: injection }));

      expect(captured[0]!.query).not.toContain("UNION");
      expect(captured[0]!.query).not.toContain(injection);
      expect(Object.values(captured[0]!.query_params)).toContain(injection);
    },
  );

  test.each(DETAIL_READS)(
    "$name clamps an oversized pattern to the expression's own maximum",
    async ({ run }: { run: (request: any) => Promise<unknown> }) => {
      const oversized: string = "y".repeat(LOG_ERROR_PATTERN_MAX_LENGTH * 4);
      const captured: Array<Statement> = stubAndCapture([]);

      await run(detailRequest({ pattern: oversized }));

      const echoed: Array<string> = Object.values(
        captured[0]!.query_params,
      ).filter((value: unknown): value is string => {
        return typeof value === "string" && value.startsWith("yyy");
      });

      expect(echoed.length).toBeGreaterThan(0);
      for (const value of echoed) {
        expect(value.length).toBe(LOG_ERROR_PATTERN_MAX_LENGTH);
      }
    },
  );

  test.each(DETAIL_READS)(
    "$name bounds its runtime below the client request timeout",
    async ({ run }: { run: (request: any) => Promise<unknown> }) => {
      const captured: Array<Statement> = stubAndCapture([]);

      await run(detailRequest());

      expect(captured[0]!.query).toContain("max_execution_time = 45");
      expect(captured[0]!.query).toContain("timeout_overflow_mode = 'break'");
      expect(captured[0]!.query).toContain("max_memory_usage =");
    },
  );
});

describe("getErrorPatternTimeline", () => {
  test("buckets by the requested interval, in seconds", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getErrorPatternTimeline(
      detailRequest({ bucketSizeInMinutes: 15 }),
    );

    expect(captured[0]!.query).toMatch(
      /toStartOfInterval\(time, INTERVAL \{p\d+:Int32\} SECOND\) AS bucket/,
    );
    expect(Object.values(captured[0]!.query_params)).toContain(15 * 60);
    expect(captured[0]!.query).toContain("ORDER BY bucket ASC");
  });

  test.each([0, -5, Number.NaN, undefined])(
    "an unusable bucket size (%s) never compiles to INTERVAL 0",
    async (bucketSizeInMinutes: number | undefined) => {
      const captured: Array<Statement> = stubAndCapture([]);

      await LogAggregationService.getErrorPatternTimeline(
        detailRequest({ bucketSizeInMinutes }),
      );

      const seconds: Array<number> = Object.values(
        captured[0]!.query_params,
      ).filter((value: unknown): value is number => {
        return typeof value === "number";
      });

      for (const value of seconds) {
        expect(value).toBeGreaterThan(0);
      }
    },
  );

  test("maps rows to time/count points", async () => {
    stubAndCapture([
      { bucket: "2026-08-20 10:00:00.000000000", cnt: 4 },
      { bucket: "2026-08-20 11:00:00.000000000", cnt: 0 },
    ]);

    const points: Array<ErrorPatternTimelinePoint> =
      await LogAggregationService.getErrorPatternTimeline(detailRequest());

    expect(points).toEqual([
      { time: "2026-08-20 10:00:00.000000000", count: 4 },
      { time: "2026-08-20 11:00:00.000000000", count: 0 },
    ]);
  });
});

describe("getErrorPatternCoOccurrences", () => {
  test("restricts to the buckets the investigated pattern landed in, and excludes itself", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getErrorPatternCoOccurrences(detailRequest());

    const query: string = captured[0]!.query;

    // The self-exclusion...
    expect(query).toMatch(/!= \{p\d+:String\}/);
    // ...and the temporal join onto the investigated pattern's own buckets.
    expect(query).toContain("IN (SELECT DISTINCT toStartOfInterval(time,");
    expect(query).toContain("GROUP BY pattern");
  });

  test("the inner bucket subquery is scoped identically to the outer read", async () => {
    const serviceId: ObjectID = ObjectID.generate();
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getErrorPatternCoOccurrences(
      detailRequest({ serviceIds: [serviceId] }),
    );

    const query: string = captured[0]!.query;

    /*
     * Two WHERE clauses (outer + subquery), two retention filters, two
     * severity predicates, two service predicates. A subquery that skipped
     * any of them would collect buckets from logs the outer query cannot
     * see, and every "co-occurring" error would be correlated against the
     * wrong timeline.
     */
    expect((query.match(/ WHERE projectId = /g) || []).length).toBe(2);
    expect((query.match(/AND retentionDate >= now\(\)/g) || []).length).toBe(2);
    expect((query.match(/AND severityText IN \(/g) || []).length).toBe(2);
    expect((query.match(/AND primaryEntityId IN \(/g) || []).length).toBe(2);
  });

  test("maps rows and drops empty patterns", async () => {
    stubAndCapture([
      { pattern: "upstream timed out", cnt: 7, sampleBody: "upstream timed" },
      { pattern: "", cnt: 3 },
    ]);

    const rows: Array<ErrorPatternCoOccurrence> =
      await LogAggregationService.getErrorPatternCoOccurrences(detailRequest());

    expect(rows).toEqual([
      { pattern: "upstream timed out", count: 7, sampleBody: "upstream timed" },
    ]);
  });
});

describe("getErrorPatternAttributes", () => {
  test("array-joins over a pre-filtered subquery, not the raw table", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.getErrorPatternAttributes(detailRequest());

    const query: string = captured[0]!.query;

    /*
     * Written flat, the ARRAY JOIN explodes the whole window into one row
     * per attribute before the pattern predicate narrows it. The subquery
     * is what keeps a tooltip-sized answer from costing a twentyfold scan.
     */
    expect(query).toContain("FROM (SELECT attributes FROM");
    expect(query).toContain(
      ") ARRAY JOIN mapKeys(attributes) AS attrKey, mapValues(attributes) AS attrValue",
    );
    expect(query.indexOf("ARRAY JOIN")).toBeGreaterThan(
      query.indexOf("WHERE projectId"),
    );
    expect(query).toContain("GROUP BY attrKey, attrValue");
  });

  test("maps key/value/count rows and drops keyless ones", async () => {
    stubAndCapture([
      { attrKey: "host.name", attrValue: "web-3", cnt: 30 },
      { attrKey: "", attrValue: "orphan", cnt: 1 },
    ]);

    const rows: Array<ErrorPatternAttribute> =
      await LogAggregationService.getErrorPatternAttributes(detailRequest());

    expect(rows).toEqual([{ key: "host.name", value: "web-3", count: 30 }]);
  });
});

describe("getErrorPatternResources", () => {
  test("groups by the resource the log belongs to and keeps its type", async () => {
    const captured: Array<Statement> = stubAndCapture([
      {
        resourceId: "svc-1",
        resourceType: "Host",
        cnt: 21,
        lastSeen: "2026-08-20 22:00:00.000000000",
      },
    ]);

    const rows: Array<ErrorPatternResource> =
      await LogAggregationService.getErrorPatternResources(detailRequest());

    expect(captured[0]!.query).toContain("GROUP BY resourceId");
    /*
     * primaryEntityType is Nullable — a row written before the
     * discriminator existed would otherwise surface as a null resource
     * type and break the UI's dispatch to the right detail page.
     */
    expect(captured[0]!.query).toContain(
      "any(ifNull(primaryEntityType, '')) AS resourceType",
    );

    expect(rows).toEqual([
      {
        resourceId: "svc-1",
        resourceType: "Host",
        count: 21,
        lastSeenAt: "2026-08-20 22:00:00.000000000",
      },
    ]);
  });
});

describe("getErrorPatternTraces", () => {
  test("excludes logs with no trace instead of returning an empty trace id", async () => {
    const captured: Array<Statement> = stubAndCapture([
      {
        traceId: "abc",
        cnt: 3,
        lastSeen: "2026-08-20 22:00:00.000000000",
        resourceId: "svc-1",
      },
      { traceId: "", cnt: 99 },
    ]);

    const rows: Array<ErrorPatternTrace> =
      await LogAggregationService.getErrorPatternTraces(detailRequest());

    expect(captured[0]!.query).toContain("AND ifNull(traceId, '') != ''");
    expect(rows).toEqual([
      {
        traceId: "abc",
        count: 3,
        lastSeenAt: "2026-08-20 22:00:00.000000000",
        resourceId: "svc-1",
      },
    ]);
  });
});

describe("getErrorPatternSamples", () => {
  test("returns the newest raw lines with their correlation ids", async () => {
    const captured: Array<Statement> = stubAndCapture([
      {
        _id: "log-1",
        time: "2026-08-20 22:00:00.000000000",
        body: "connection refused to 10.0.0.4:5432",
        severityText: "Error",
        resourceId: "svc-1",
        traceId: "abc",
        spanId: "def",
      },
    ]);

    const rows: Array<ErrorPatternSample> =
      await LogAggregationService.getErrorPatternSamples(detailRequest());

    expect(captured[0]!.query).toContain("ORDER BY time DESC");
    expect(rows).toEqual([
      {
        logId: "log-1",
        time: "2026-08-20 22:00:00.000000000",
        body: "connection refused to 10.0.0.4:5432",
        severityText: "Error",
        resourceId: "svc-1",
        traceId: "abc",
        spanId: "def",
      },
    ]);
  });

  test("a row missing every optional field maps to empty strings, not undefined", async () => {
    stubAndCapture([{}]);

    const rows: Array<ErrorPatternSample> =
      await LogAggregationService.getErrorPatternSamples(detailRequest());

    expect(rows).toEqual([
      {
        logId: "",
        time: "",
        body: "",
        severityText: "",
        resourceId: "",
        traceId: "",
        spanId: "",
      },
    ]);
  });
});
