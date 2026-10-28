import {
  INVALID_TRACE_ID,
  NO_TRACE_HEALTH_SPANS,
  TRACE_HEALTH_DEFAULT_WINDOW_MS,
  TRACE_HEALTH_MAX_WINDOW_MS,
  TRACE_HEALTH_PARENT_PADDING_MS,
  TRACE_HEALTH_TARGET_SAMPLED_SPANS,
  TRACE_HEALTH_THRESHOLDS,
  TraceHealthLogCounts,
  TraceHealthQuery,
  TraceHealthSpanCounts,
  TraceHealthSpanQuery,
  TraceHealthWindow,
  buildLogLinkStatement,
  buildServiceSpanCountStatement,
  buildSpanHealthStatement,
  getTraceHealthHints,
  interpretTraceHealth,
  pickTraceHealthSamplePercent,
  readLogLinkCounts,
  readServiceSpanCount,
  readSpanHealthCounts,
  readTraceHealthServiceId,
  resolveTraceHealthWindow,
} from "../../../../Server/Utils/Telemetry/TraceHealth";
import TelemetryReadScopeUtil from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  TraceHealthHint,
  TraceHealthReport,
  parseTraceHealthReport,
} from "../../../../Types/Telemetry/TraceHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * The trace health card's numbers (POST /telemetry/traces/health): the
 * statements that count them and how their rows become the report.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const BLOCKED_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const START: Date = new Date("2026-10-27T10:00:00.000Z");
const END: Date = new Date("2026-10-27T11:00:00.000Z");

const QUERY: TraceHealthQuery = {
  projectId: PROJECT_ID,
  serviceFilter: { serviceIds: [SERVICE_ID] },
  startTime: START,
  endTime: END,
};

function spanQuery(samplePercent: number): TraceHealthSpanQuery {
  return { ...QUERY, samplePercent };
}

// How many times `needle` is written in `text`.
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// The values the statement binds, as strings.
function boundValues(statement: Statement): Array<string> {
  return Object.values(statement.query_params).map((value: unknown) => {
    return Array.isArray(value) ? value.join(",") : String(value);
  });
}

// The values bound to the placeholders `pattern` captures the names of.
function boundTo(
  statement: { query: string; query_params: Record<string, unknown> },
  pattern: RegExp,
): Array<unknown> {
  return Array.from(statement.query.matchAll(pattern)).map(
    (match: RegExpMatchArray) => {
      return statement.query_params[match[1]!];
    },
  );
}

function expectBalanced(query: string): void {
  let depth: number = 0;

  for (const character of query) {
    if (character === "(") {
      depth++;
    }

    if (character === ")") {
      depth--;
    }

    expect(depth).toBeGreaterThanOrEqual(0);
  }

  expect(depth).toBe(0);
}

// Every placeholder has a value, and every value a placeholder.
function expectEveryPlaceholderBound(statement: Statement): void {
  const placeholders: Set<string> = new Set(
    Array.from(statement.query.matchAll(/\{(p\d+):[^}]+\}/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  );

  expect(Array.from(placeholders).sort()).toEqual(
    Object.keys(statement.query_params).sort(),
  );
}

describe("the span count that picks the sample", () => {
  const statement: Statement = buildServiceSpanCountStatement(QUERY);

  test("binds the project, the service and the window as parameters", () => {
    expect(statement.query).not.toContain(PROJECT_ID.toString());
    expect(statement.query).not.toContain(SERVICE_ID.toString());
    expect(boundValues(statement)).toEqual(
      expect.arrayContaining([
        "SpanItemV3",
        PROJECT_ID.toString(),
        SERVICE_ID.toString(),
        "2026-10-27 10:00:00",
        "2026-10-27 11:00:00",
      ]),
    );
    expectEveryPlaceholderBound(statement);
  });

  test("rides the minute projection: the window on its key, projections on", () => {
    expect(statement.query).toContain(
      "toStartOfMinute(startTime) >= toStartOfMinute(",
    );
    expect(statement.query).toContain(
      "toStartOfMinute(startTime) <= toStartOfMinute(",
    );
    expect(statement.query).not.toMatch(/\bstartTime >= \{/);
    expect(statement.query).toContain("optimize_use_projections = 1");
    // Columns the aggregate projection does not store would force a scan.
    expect(statement.query).not.toContain("traceId");
    expect(statement.query).not.toContain("retentionDate");
  });

  test("names the service the way the trace histogram does", () => {
    expect(statement.query).toMatch(
      / AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expectBalanced(statement.query);
  });
});

describe("the trace numbers", () => {
  const sampled: Statement = buildSpanHealthStatement(spanQuery(7));
  const everyTrace: Statement = buildSpanHealthStatement(spanQuery(100));

  test("binds every value as a parameter", () => {
    for (const statement of [sampled, everyTrace]) {
      expect(statement.query).not.toContain(PROJECT_ID.toString());
      expect(statement.query).not.toContain(SERVICE_ID.toString());
      expect(statement.query).not.toContain("2026-10-27");
      expect(boundValues(statement)).toEqual(
        expect.arrayContaining([
          "SpanItemV3",
          PROJECT_ID.toString(),
          SERVICE_ID.toString(),
        ]),
      );
      expectEveryPlaceholderBound(statement);
      expectBalanced(statement.query);
    }
  });

  test("samples traces by a hash of the trace id, on every read of the table", () => {
    // The trace set, the spans of those traces, and the parent set.
    expect(occurrences(sampled.query, "cityHash64(traceId) % 100 < {")).toBe(3);
    expect(
      boundTo(sampled, /cityHash64\(traceId\) % 100 < \{(p\d+):Int32\}/g),
    ).toEqual([7, 7, 7]);
    expect(occurrences(sampled.query, `FROM {`)).toBe(3);
  });

  test("leaves the sample out when every trace is read", () => {
    expect(everyTrace.query).not.toContain("cityHash64");
    expect(occurrences(everyTrace.query, "FROM {")).toBe(3);
  });

  test("reads one deterministic trace set, twice, and never an unordered LIMIT", () => {
    for (const statement of [sampled, everyTrace]) {
      expect(statement.query.startsWith("WITH service_traces AS (")).toBe(true);
      expect(occurrences(statement.query, "service_traces AS (")).toBe(1);
      expect(
        occurrences(statement.query, "traceId GLOBAL IN service_traces"),
      ).toBe(2);
      expect(statement.query).not.toMatch(/\bLIMIT\b/);
      expect(statement.query).not.toMatch(/\brand/i);
    }

    // The trace set is the service's spans in the window, not the padding.
    const traceSet: string = sampled.query.slice(
      0,
      sampled.query.indexOf(") SELECT "),
    );
    expect(traceSet).toContain("SELECT DISTINCT traceId FROM {");
    expect(traceSet).toMatch(/ AND primaryEntityId IN \(/);
    expect(
      boundTo(
        { query: traceSet, query_params: sampled.query_params },
        /startTime >= \{(p\d+):DateTime64\(9\)\}/g,
      ),
    ).toEqual(["2026-10-27 10:00:00.000000000"]);
  });

  test("looks a parent up by (traceId, spanId), the parent id made non-nullable", () => {
    expect(sampled.query).toContain(
      "ifNull(parentSpanId, '') != '' AND (traceId, assumeNotNull(parentSpanId)) GLOBAL NOT IN (SELECT traceId, spanId FROM {",
    );
    // A root span names no parent, so it is never one that misses its parent.
    expect(
      sampled.query.indexOf("ifNull(parentSpanId, '') != ''"),
    ).toBeLessThan(sampled.query.indexOf("GLOBAL NOT IN"));
  });

  test("looks for parents, and counts traces, in the window padded on both sides", () => {
    const starts: Array<unknown> = boundTo(
      sampled,
      /startTime >= \{(p\d+):DateTime64\(9\)\}/g,
    );
    const ends: Array<unknown> = boundTo(
      sampled,
      /startTime <= \{(p\d+):DateTime64\(9\)\}/g,
    );

    expect(TRACE_HEALTH_PARENT_PADDING_MS).toBe(5 * 60 * 1000);
    // The trace set and both service-span counts read the window itself.
    expect(starts.sort()).toEqual([
      "2026-10-27 09:55:00.000000000",
      "2026-10-27 09:55:00.000000000",
      "2026-10-27 10:00:00.000000000",
      "2026-10-27 10:00:00.000000000",
      "2026-10-27 10:00:00.000000000",
    ]);
    expect(ends.sort()).toEqual([
      "2026-10-27 11:00:00.000000000",
      "2026-10-27 11:00:00.000000000",
      "2026-10-27 11:00:00.000000000",
      "2026-10-27 11:05:00.000000000",
      "2026-10-27 11:05:00.000000000",
    ]);
  });

  test("counts the service's own spans, in the window, inside each trace", () => {
    expect(occurrences(sampled.query, "countIf(1 AND startTime >= {")).toBe(2);
    expect(occurrences(sampled.query, " AND primaryEntityId IN (")).toBe(3);
    expect(sampled.query).toContain("count() AS spansInTrace");
    expect(sampled.query).toContain(
      "countIf(spansInTrace = 1) AS singleSpanTraceCount",
    );
    expect(sampled.query).toContain(" GROUP BY traceId)");
  });

  test("uses GLOBAL for every set over the Distributed span table", () => {
    // Code 288 on a multi-shard cluster otherwise.
    expect(occurrences(sampled.query, "IN (SELECT")).toBe(
      occurrences(sampled.query, "GLOBAL NOT IN (SELECT") +
        occurrences(sampled.query, "GLOBAL IN (SELECT"),
    );
    expect(occurrences(sampled.query, "IN service_traces")).toBe(
      occurrences(sampled.query, "GLOBAL IN service_traces"),
    );
  });

  test("leaves out rows past their retention and stops at the time limit", () => {
    expect(occurrences(sampled.query, "retentionDate >= now()")).toBe(3);
    expect(sampled.query).toContain("max_execution_time = 45");
    expect(sampled.query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("keeps the services a block takes away out", () => {
    const blocked: Statement = buildSpanHealthStatement({
      ...spanQuery(50),
      serviceFilter: {
        serviceIds: [SERVICE_ID],
        excludedServiceIds: [BLOCKED_ID],
      },
    });

    expect(occurrences(blocked.query, " AND primaryEntityId NOT IN (")).toBe(3);
    expect(boundValues(blocked)).toContain(BLOCKED_ID.toString());
  });

  test("refuses a read that names no service, or a sample out of range", () => {
    expect(() => {
      return buildSpanHealthStatement({ ...spanQuery(10), serviceFilter: {} });
    }).toThrow(BadDataException);
    expect(() => {
      return buildServiceSpanCountStatement({
        ...QUERY,
        serviceFilter: { serviceIds: [] },
      });
    }).toThrow(BadDataException);

    for (const samplePercent of [0, 101, 2.5, Number.NaN]) {
      expect(() => {
        return buildSpanHealthStatement(spanQuery(samplePercent));
      }).toThrow(BadDataException);
    }
  });

  test("a caller who may not read the service reads no service at all", () => {
    const statement: Statement = buildSpanHealthStatement({
      ...spanQuery(100),
      serviceFilter: TelemetryReadScopeUtil.toServiceFilter(
        { readableIds: [], blockedIds: [] },
        [SERVICE_ID],
      ),
    });

    expect(boundValues(statement)).toContain(
      TelemetryReadScopeUtil.NO_RESOURCE_ID,
    );
    expect(boundValues(statement)).not.toContain(SERVICE_ID.toString());
  });
});

describe("the log count", () => {
  const statement: Statement = buildLogLinkStatement(QUERY);

  test("binds the project, the service and the window as parameters", () => {
    expect(statement.query).not.toContain(PROJECT_ID.toString());
    expect(statement.query).not.toContain(SERVICE_ID.toString());
    expect(boundValues(statement)).toEqual(
      expect.arrayContaining([
        "LogItemV3",
        PROJECT_ID.toString(),
        SERVICE_ID.toString(),
        "2026-10-27 10:00:00.000000000",
        "2026-10-27 11:00:00.000000000",
      ]),
    );
    expect(statement.query).toContain("time >= {");
    expect(statement.query).toContain("time <= {");
    expect(statement.query).toMatch(
      / AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expectEveryPlaceholderBound(statement);
    expectBalanced(statement.query);
  });

  test("counts a log as linked when it carries a trace id that is not all zeros", () => {
    expect(statement.query).toMatch(
      /countIf\(ifNull\(traceId, ''\) NOT IN \('', \{p\d+:String\}\)\) AS linkedLogCount/,
    );
    expect(boundValues(statement)).toContain(INVALID_TRACE_ID);
    expect(INVALID_TRACE_ID).toBe("0".repeat(32));
  });

  test("counts every log: no sample and no LIMIT", () => {
    expect(statement.query).not.toContain("cityHash64");
    expect(statement.query).not.toMatch(/\bLIMIT\b/);
    expect(statement.query).toContain("retentionDate >= now()");
  });
});

describe("the window", () => {
  const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

  function resolve(startTime: unknown, endTime: unknown): TraceHealthWindow {
    return resolveTraceHealthWindow({ startTime, endTime, now: NOW });
  }

  test("is the last hour when the request names none", () => {
    const window: TraceHealthWindow = resolve(undefined, undefined);

    expect(window.endTime).toEqual(NOW);
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      TRACE_HEALTH_DEFAULT_WINDOW_MS,
    );
    expect(resolve(null, "")).toEqual(window);
  });

  test("is the window asked for", () => {
    expect(
      resolve("2026-10-27T08:00:00.000Z", "2026-10-27T09:30:00.000Z"),
    ).toEqual({
      startTime: new Date("2026-10-27T08:00:00.000Z"),
      endTime: new Date("2026-10-27T09:30:00.000Z"),
    });
  });

  test("is the hour before its end, or runs to now, when one edge is named", () => {
    expect(resolve(undefined, "2026-10-26T09:00:00.000Z")).toEqual({
      startTime: new Date("2026-10-26T08:00:00.000Z"),
      endTime: new Date("2026-10-26T09:00:00.000Z"),
    });
    expect(resolve("2026-10-27T09:00:00.000Z", undefined)).toEqual({
      startTime: new Date("2026-10-27T09:00:00.000Z"),
      endTime: NOW,
    });
  });

  test("keeps the last 24 hours of a wider window", () => {
    const window: TraceHealthWindow = resolve(
      "2026-10-20T12:00:00.000Z",
      "2026-10-27T12:00:00.000Z",
    );

    expect(window.endTime).toEqual(new Date("2026-10-27T12:00:00.000Z"));
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      TRACE_HEALTH_MAX_WINDOW_MS,
    );
    expect(TRACE_HEALTH_MAX_WINDOW_MS).toBe(24 * 60 * 60 * 1000);

    // Exactly 24 hours is kept as it is.
    expect(
      resolve("2026-10-26T12:00:00.000Z", "2026-10-27T12:00:00.000Z"),
    ).toEqual({
      startTime: new Date("2026-10-26T12:00:00.000Z"),
      endTime: new Date("2026-10-27T12:00:00.000Z"),
    });
  });

  test("refuses an edge that is not a date, and an inverted window", () => {
    for (const [startTime, endTime] of [
      ["yesterday", undefined],
      [undefined, "not a date"],
      [1761559200000, undefined],
      [undefined, { value: "2026-10-27" }],
    ] as Array<[unknown, unknown]>) {
      expect(() => {
        return resolve(startTime, endTime);
      }).toThrow(BadDataException);
    }

    expect(() => {
      return resolve("2026-10-27T11:00:00.000Z", "2026-10-27T10:00:00.000Z");
    }).toThrow("startTime must not be after endTime");
  });
});

describe("the service a request asks about", () => {
  test("is a service id", () => {
    expect(readTraceHealthServiceId(SERVICE_ID.toString()).toString()).toBe(
      SERVICE_ID.toString(),
    );
    expect(
      readTraceHealthServiceId(` ${SERVICE_ID.toString()} `).toString(),
    ).toBe(SERVICE_ID.toString());
  });

  test("or a 400", () => {
    for (const value of [undefined, null, "", "checkout", 42, [SERVICE_ID]]) {
      expect(() => {
        return readTraceHealthServiceId(value);
      }).toThrow("serviceId must be a service id");
    }
  });
});

describe("the sample percent", () => {
  test("reads every trace of a service that sends few spans", () => {
    expect(pickTraceHealthSamplePercent(0)).toBe(100);
    expect(pickTraceHealthSamplePercent(1)).toBe(100);
    expect(
      pickTraceHealthSamplePercent(TRACE_HEALTH_TARGET_SAMPLED_SPANS),
    ).toBe(100);
    expect(pickTraceHealthSamplePercent(Number.NaN)).toBe(100);
  });

  test("reads about the target number of spans of a busy one", () => {
    expect(
      pickTraceHealthSamplePercent(TRACE_HEALTH_TARGET_SAMPLED_SPANS * 2),
    ).toBe(50);
    expect(
      pickTraceHealthSamplePercent(TRACE_HEALTH_TARGET_SAMPLED_SPANS * 10),
    ).toBe(10);
    // Rounded up, so a sample never reads less than the target.
    expect(
      pickTraceHealthSamplePercent(TRACE_HEALTH_TARGET_SAMPLED_SPANS * 3),
    ).toBe(34);
  });

  test("never drops below one percent, even at 80M spans an hour", () => {
    expect(pickTraceHealthSamplePercent(80_000_000)).toBe(1);
    expect(pickTraceHealthSamplePercent(Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  test("is always a whole percent the trace statement accepts", () => {
    for (const count of [0, 5, 20_001, 33_333, 123_456, 9_999_999]) {
      const percent: number = pickTraceHealthSamplePercent(count);

      expect(Number.isInteger(percent)).toBe(true);
      expect(() => {
        return buildSpanHealthStatement(spanQuery(percent));
      }).not.toThrow();
    }
  });
});

describe("reading the rows", () => {
  test("reads ClickHouse's 64-bit counts, written as strings", () => {
    expect(readServiceSpanCount([{ spanCount: "81234567" }])).toBe(81234567);
    expect(
      readSpanHealthCounts([
        {
          spanCount: "900",
          orphanSpanCount: "45",
          traceCount: "300",
          singleSpanTraceCount: "120",
        },
      ]),
    ).toEqual({
      spanCount: 900,
      orphanSpanCount: 45,
      traceCount: 300,
      singleSpanTraceCount: 120,
    });
    expect(readLogLinkCounts([{ logCount: 50, linkedLogCount: "20" }])).toEqual(
      { logCount: 50, linkedLogCount: 20 },
    );
  });

  test("reads no row, or a broken one, as nothing counted", () => {
    expect(readServiceSpanCount([])).toBe(0);
    expect(readSpanHealthCounts([])).toEqual(NO_TRACE_HEALTH_SPANS);
    expect(
      readSpanHealthCounts([
        { spanCount: "x", orphanSpanCount: null, traceCount: -3 },
      ]),
    ).toEqual(NO_TRACE_HEALTH_SPANS);
    expect(readLogLinkCounts([{}])).toEqual({ logCount: 0, linkedLogCount: 0 });
  });

  test("never counts more of a whole than the whole", () => {
    expect(
      readSpanHealthCounts([
        {
          spanCount: "10",
          orphanSpanCount: "12",
          traceCount: "4",
          singleSpanTraceCount: "9",
        },
      ]),
    ).toEqual({
      spanCount: 10,
      orphanSpanCount: 10,
      traceCount: 4,
      singleSpanTraceCount: 4,
    });
    expect(readLogLinkCounts([{ logCount: "3", linkedLogCount: "8" }])).toEqual(
      { logCount: 3, linkedLogCount: 3 },
    );
  });
});

describe("the report", () => {
  const WINDOW: TraceHealthWindow = { startTime: START, endTime: END };

  const HEALTHY_SPANS: TraceHealthSpanCounts = {
    spanCount: 1000,
    orphanSpanCount: 4,
    traceCount: 400,
    singleSpanTraceCount: 40,
  };

  const LINKED_LOGS: TraceHealthLogCounts = {
    logCount: 200,
    linkedLogCount: 180,
  };

  function report(data: {
    spans?: TraceHealthSpanCounts;
    logs?: TraceHealthLogCounts | null;
    samplePercent?: number;
  }): TraceHealthReport {
    return interpretTraceHealth({
      window: WINDOW,
      samplePercent: data.samplePercent ?? 100,
      spans: data.spans ?? HEALTHY_SPANS,
      logs: data.logs === undefined ? LINKED_LOGS : data.logs,
    });
  }

  test("divides each count by its whole", () => {
    expect(report({ samplePercent: 12 })).toEqual({
      startTime: "2026-10-27T10:00:00.000Z",
      endTime: "2026-10-27T11:00:00.000Z",
      samplePercent: 12,
      spanCount: 1000,
      traceCount: 400,
      orphanSpanShare: 0.004,
      singleSpanTraceShare: 0.1,
      logCount: 200,
      logsLinkedShare: 0.9,
      hints: [],
    });
  });

  test("names each share that looks poor, in the order the card shows them", () => {
    const poor: TraceHealthReport = report({
      spans: {
        spanCount: 1000,
        orphanSpanCount: 260,
        traceCount: 400,
        singleSpanTraceCount: 140,
      },
      logs: { logCount: 500, linkedLogCount: 0 },
    });

    expect(poor.orphanSpanShare).toBe(0.26);
    expect(poor.singleSpanTraceShare).toBe(0.35);
    expect(poor.logsLinkedShare).toBe(0);
    expect(poor.hints).toEqual([
      TraceHealthHint.MissingParentSpans,
      TraceHealthHint.OneSpanTraces,
      TraceHealthHint.UnlinkedLogs,
    ]);
  });

  test("takes its thresholds from one place, a share at the threshold not yet poor", () => {
    expect(TRACE_HEALTH_THRESHOLDS).toEqual({
      maxOrphanSpanShare: 0.05,
      maxSingleSpanTraceShare: 0.3,
      minLogsLinkedShare: 0.5,
    });

    expect(
      getTraceHealthHints({
        orphanSpanShare: TRACE_HEALTH_THRESHOLDS.maxOrphanSpanShare,
        singleSpanTraceShare: TRACE_HEALTH_THRESHOLDS.maxSingleSpanTraceShare,
        logsLinkedShare: TRACE_HEALTH_THRESHOLDS.minLogsLinkedShare,
      }),
    ).toEqual([]);

    expect(
      getTraceHealthHints({
        orphanSpanShare: 0.051,
        singleSpanTraceShare: null,
        logsLinkedShare: null,
      }),
    ).toEqual([TraceHealthHint.MissingParentSpans]);
    expect(
      getTraceHealthHints({
        orphanSpanShare: null,
        singleSpanTraceShare: 0.301,
        logsLinkedShare: null,
      }),
    ).toEqual([TraceHealthHint.OneSpanTraces]);
    expect(
      getTraceHealthHints({
        orphanSpanShare: null,
        singleSpanTraceShare: null,
        logsLinkedShare: 0.499,
      }),
    ).toEqual([TraceHealthHint.UnlinkedLogs]);
  });

  test("a service with no logs has no log share and no log hint", () => {
    const noLogs: TraceHealthReport = report({
      logs: { logCount: 0, linkedLogCount: 0 },
    });

    expect(noLogs.logCount).toBe(0);
    expect(noLogs.logsLinkedShare).toBeNull();
    expect(noLogs.hints).not.toContain(TraceHealthHint.UnlinkedLogs);
  });

  test("logs that were not read (none the caller may read) say nothing either", () => {
    const unread: TraceHealthReport = report({ logs: null });

    expect(unread.logCount).toBe(0);
    expect(unread.logsLinkedShare).toBeNull();
    expect(unread.hints).toEqual([]);
  });

  test("a service with no spans in the window has nothing to show", () => {
    const empty: TraceHealthReport = report({
      spans: NO_TRACE_HEALTH_SPANS,
      logs: null,
    });

    expect(empty.spanCount).toBe(0);
    expect(empty.orphanSpanShare).toBeNull();
    expect(empty.singleSpanTraceShare).toBeNull();
    expect(empty.hints).toEqual([]);
  });

  test("reads back the same through the Dashboard's parser", () => {
    for (const sent of [
      report({}),
      report({ logs: null }),
      report({ spans: NO_TRACE_HEALTH_SPANS, logs: null }),
      report({
        samplePercent: 3,
        spans: {
          spanCount: 20,
          orphanSpanCount: 20,
          traceCount: 20,
          singleSpanTraceCount: 20,
        },
        logs: { logCount: 9, linkedLogCount: 1 },
      }),
    ]) {
      expect(parseTraceHealthReport(JSON.parse(JSON.stringify(sent)))).toEqual(
        sent,
      );
    }
  });
});
