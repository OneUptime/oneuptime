import { describe, expect, test } from "@jest/globals";
import { SpanEvent, SpanKind } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import Color from "Common/Types/Color";
import { SpanSelfTime } from "Common/Utils/Traces/CriticalPath";
import {
  AttributeEntry,
  HighlightSegment,
  OperationSummary,
  ServiceSummary,
  SpanEventRow,
  SpanLoadState,
  SpanTiming,
  TraceServiceInfo,
  TraceSummary,
  UNKNOWN_SERVICE_COLOR,
  UNKNOWN_SERVICE_NAME,
  abbreviateId,
  buildAttributeSearchQuery,
  buildServiceInfoMap,
  buildSpanEventRows,
  buildSpanShareUrl,
  filterAttributeEntries,
  flattenSpanAttributes,
  formatDurationNano,
  formatOffsetNano,
  formatPercent,
  getRootSpan,
  getServiceColor,
  getServiceInfo,
  getSpanLoadState,
  getSpanTiming,
  pluralize,
  sortOperations,
  splitHighlightSegments,
  summarizeOperations,
  summarizeServices,
  summarizeTrace,
} from "../../FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import {
  WaterfallSpan,
  buildSpanTree,
} from "../../FeatureSet/Dashboard/src/Utils/TraceWaterfall";

/*
 * What the trace detail page says about a trace: its headline numbers,
 * where the time went by service and by operation, and the labels, links
 * and attribute lists of the span panel.
 */

const MS: number = 1_000_000;

function span(
  spanId: string,
  parentSpanId: string,
  startNano: number,
  durationNano: number,
  overrides: Partial<WaterfallSpan> = {},
): WaterfallSpan {
  return {
    spanId,
    parentSpanId,
    name: spanId,
    serviceId: "svc-a",
    startTimeUnixNano: startNano,
    endTimeUnixNano: startNano + durationNano,
    durationUnixNano: durationNano,
    isError: false,
    kind: SpanKind.Internal,
    ...overrides,
  };
}

function selfTimes(values: Record<string, number>): Map<string, SpanSelfTime> {
  const map: Map<string, SpanSelfTime> = new Map();
  for (const [spanId, selfTimeUnixNano] of Object.entries(values)) {
    map.set(spanId, {
      spanId,
      selfTimeUnixNano,
      childTimeUnixNano: 0,
      totalTimeUnixNano: selfTimeUnixNano,
      selfTimePercent: 100,
    });
  }
  return map;
}

function service(id: string, name: string, color?: string): Service {
  return Object.assign(new Service(), {
    _id: id,
    name,
    ...(color ? { serviceColor: new Color(color) } : {}),
  });
}

describe("services", () => {
  test("buildServiceInfoMap keys by id with name and colour", () => {
    const map: Map<string, TraceServiceInfo> = buildServiceInfoMap([
      service("svc-a", "api-gateway", "#6366f1"),
      service("svc-b", "", undefined),
    ]);

    expect(map.get("svc-a")).toEqual({
      id: "svc-a",
      name: "api-gateway",
      color: "#6366f1",
    });
    expect(map.get("svc-b")).toEqual({
      id: "svc-b",
      name: UNKNOWN_SERVICE_NAME,
      color: UNKNOWN_SERVICE_COLOR,
    });
  });

  test("a service without an id is skipped", () => {
    expect(buildServiceInfoMap([new Service()]).size).toBe(0);
  });

  test("getServiceColor falls back to grey", () => {
    expect(getServiceColor(undefined)).toBe(UNKNOWN_SERVICE_COLOR);
    expect(getServiceColor(service("x", "x", "#10b981"))).toBe("#10b981");
  });

  test("getServiceInfo describes a span whose service is not loaded", () => {
    expect(getServiceInfo(new Map(), "missing")).toEqual({
      id: "missing",
      name: UNKNOWN_SERVICE_NAME,
      color: UNKNOWN_SERVICE_COLOR,
    });
  });
});

describe("formatting", () => {
  test("durations use the humanised nanosecond format", () => {
    expect(formatDurationNano(1284 * MS)).toBe("1.28 s");
    expect(formatDurationNano(716 * MS)).toBe("716 ms");
    expect(formatDurationNano(2.4 * MS)).toBe("2.4 ms");
    expect(formatDurationNano(350_000)).toBe("350 μs");
    expect(formatDurationNano(0)).toBe("0 ms");
    expect(formatDurationNano(-5)).toBe("0 ms");
  });

  test("offsets are signed from the trace start", () => {
    expect(formatOffsetNano(183 * MS)).toBe("+183 ms");
    expect(formatOffsetNano(0)).toBe("+0 ms");
  });

  test("percentages", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(-3)).toBe("0%");
    expect(formatPercent(Number.NaN)).toBe("0%");
    expect(formatPercent(0.4)).toBe("<1%");
    expect(formatPercent(7.46)).toBe("7.5%");
    expect(formatPercent(7)).toBe("7%");
    expect(formatPercent(42.4)).toBe("42%");
    expect(formatPercent(150)).toBe("100%");
  });

  test("pluralize", () => {
    expect(pluralize(1, "span")).toBe("1 span");
    expect(pluralize(3, "span")).toBe("3 spans");
    expect(pluralize(0, "match", "matches")).toBe("0 matches");
    expect(pluralize(1, "match", "matches")).toBe("1 match");
  });

  test("abbreviateId keeps the ends of a long id", () => {
    expect(abbreviateId("4bf92f3577b34da6a3ce929d0e0e4736")).toBe(
      "4bf92f35…0e4736",
    );
    expect(abbreviateId("abc")).toBe("abc");
    expect(abbreviateId("12345678901234567")).toBe("12345678901234567");
  });
});

describe("summarizeTrace", () => {
  test("counts errors, orphans, services and depth", () => {
    const summary: TraceSummary = summarizeTrace(
      buildSpanTree([
        span("root", "", 100 * MS, 50 * MS, { kind: SpanKind.Server }),
        span("child", "root", 110 * MS, 10 * MS, {
          serviceId: "svc-b",
          isError: true,
        }),
        span("grandchild", "child", 112 * MS, 2 * MS, { serviceId: "svc-b" }),
        span("orphan", "gone", 130 * MS, 5 * MS, {
          serviceId: "",
          isError: true,
        }),
      ]),
      10,
    );

    expect(summary.rootSpan?.spanId).toBe("root");
    expect(summary.isError).toBe(true);
    expect(summary.errorCount).toBe(2);
    expect(summary.errorRatePercent).toBe(50);
    expect(summary.orphanCount).toBe(1);
    expect(summary.serviceCount).toBe(2);
    expect(summary.maxDepth).toBe(3);
    expect(summary.loadedSpanCount).toBe(4);
    expect(summary.totalSpanCount).toBe(10);
    expect(summary.durationUnixNano).toBe(50 * MS);
    expect(summary.startTime?.getTime()).toBe(100);
  });

  test("a total below the loaded count never reports fewer spans than shown", () => {
    const summary: TraceSummary = summarizeTrace(
      buildSpanTree([span("a", "", 0, 1)]),
      0,
    );

    expect(summary.totalSpanCount).toBe(1);
    expect(summary.isError).toBe(false);
  });

  test("an empty trace", () => {
    const summary: TraceSummary = summarizeTrace(buildSpanTree([]), 0);

    expect(summary.rootSpan).toBeNull();
    expect(summary.startTime).toBeNull();
    expect(summary.maxDepth).toBe(0);
    expect(summary.errorRatePercent).toBe(0);
  });

  test("the root is the earliest true root, even if an orphan started first", () => {
    expect(
      getRootSpan(
        buildSpanTree([span("orphan", "gone", 0, 5), span("root", "", 10, 50)]),
      )?.spanId,
    ).toBe("root");
  });

  test("a trace missing its root span falls back to the earliest orphan", () => {
    expect(
      getRootSpan(
        buildSpanTree([
          span("late", "gone", 20, 5),
          span("early", "gone", 10, 5),
        ]),
      )?.spanId,
    ).toBe("early");
  });
});

describe("summarizeServices", () => {
  const serviceInfoById: Map<string, TraceServiceInfo> = buildServiceInfoMap([
    service("svc-a", "api-gateway", "#6366f1"),
    service("svc-b", "payment-service", "#ec4899"),
  ]);

  test("shares self time between services so the shares add up to 100", () => {
    const summaries: Array<ServiceSummary> = summarizeServices({
      spans: [
        span("root", "", 0, 100),
        span("child", "root", 10, 40, { serviceId: "svc-b", isError: true }),
        span("other", "root", 60, 10, { serviceId: "svc-b" }),
      ],
      selfTimes: selfTimes({ root: 60, child: 40 }),
      serviceInfoById,
    });

    expect(
      summaries.map((summary: ServiceSummary) => {
        return summary.name;
      }),
    ).toEqual(["api-gateway", "payment-service"]);
    expect(summaries[0]!.selfTimeUnixNano).toBe(60);
    expect(summaries[1]!.selfTimeUnixNano).toBe(50);
    expect(summaries[1]!.spanCount).toBe(2);
    expect(summaries[1]!.errorCount).toBe(1);
    expect(summaries[0]!.color).toBe("#6366f1");
    expect(
      summaries.reduce((total: number, summary: ServiceSummary) => {
        return total + summary.percent;
      }, 0),
    ).toBeCloseTo(100, 10);
    expect(summaries[0]!.percent).toBeCloseTo((60 / 110) * 100, 10);
  });

  test("with no self time at all every service gets an equal share", () => {
    const summaries: Array<ServiceSummary> = summarizeServices({
      spans: [span("a", "", 0, 0), span("b", "", 0, 0, { serviceId: "svc-b" })],
      selfTimes: selfTimes({ a: 0, b: 0 }),
      serviceInfoById,
    });

    expect(
      summaries.map((summary: ServiceSummary) => {
        return summary.percent;
      }),
    ).toEqual([50, 50]);
  });

  test("an unloaded service still gets a row, named as unknown", () => {
    const summaries: Array<ServiceSummary> = summarizeServices({
      spans: [span("a", "", 0, 5, { serviceId: "svc-x" })],
      selfTimes: new Map(),
      serviceInfoById,
    });

    expect(summaries[0]!.name).toBe(UNKNOWN_SERVICE_NAME);
    expect(summaries[0]!.selfTimeUnixNano).toBe(5);
    expect(summaries[0]!.percent).toBe(100);
  });

  test("negative self time is treated as zero", () => {
    const summaries: Array<ServiceSummary> = summarizeServices({
      spans: [span("a", "", 0, 5), span("b", "", 0, 5, { serviceId: "svc-b" })],
      selfTimes: selfTimes({ a: -10, b: 5 }),
      serviceInfoById,
    });

    expect(
      summaries.find((summary: ServiceSummary) => {
        return summary.id === "svc-a";
      })!.percent,
    ).toBe(0);
  });
});

describe("operations", () => {
  /*
   * GET /orders (svc-a) calls SELECT products (svc-b) twelve times — an N+1 —
   * and one more SELECT runs under another parent. A same-named SELECT in
   * svc-a is a different operation.
   */
  function operationSpans(): Array<WaterfallSpan> {
    const spans: Array<WaterfallSpan> = [
      span("p", "", 0, 100, { name: "GET /orders" }),
    ];
    for (let index: number = 0; index < 12; index++) {
      spans.push(
        span(`q${index}`, "p", 10 + index, 3 + index, {
          name: "SELECT products",
          serviceId: "svc-b",
        }),
      );
    }
    spans.push(
      span("r", "other", 40, 50, {
        name: "SELECT products",
        serviceId: "svc-b",
      }),
    );
    spans.push(
      span("e", "p", 90, 5, { name: "SELECT products", isError: true }),
    );
    return spans;
  }

  function operationSelfTimes(): Map<string, SpanSelfTime> {
    const values: Record<string, number> = { p: 40, r: 50, e: 5 };
    for (let index: number = 0; index < 12; index++) {
      values[`q${index}`] = 3 + index;
    }
    return selfTimes(values);
  }

  function byName(rows: Array<OperationSummary>): Array<string> {
    return rows.map((row: OperationSummary) => {
      return `${row.serviceId}:${row.name}`;
    });
  }

  test("groups by service and name, most self time first", () => {
    const rows: Array<OperationSummary> = summarizeOperations({
      spans: operationSpans(),
      selfTimes: operationSelfTimes(),
    });

    expect(byName(rows)).toEqual([
      "svc-b:SELECT products",
      "svc-a:GET /orders",
      "svc-a:SELECT products",
    ]);

    const select: OperationSummary = rows[0]!;
    expect(select.count).toBe(13);
    expect(select.totalDurationUnixNano).toBe(152);
    expect(select.selfTimeUnixNano).toBe(152);
    expect(select.averageDurationUnixNano).toBeCloseTo(152 / 13, 10);
    expect(select.maxDurationUnixNano).toBe(50);
    expect(select.slowestSpanId).toBe("r");
    expect(select.errorCount).toBe(0);
    expect(select.percentOfSelfTime).toBeCloseTo((152 / 197) * 100, 10);
  });

  test("counts the most calls from a single parent, which flags an N+1", () => {
    const rows: Array<OperationSummary> = summarizeOperations({
      spans: operationSpans(),
      selfTimes: operationSelfTimes(),
    });

    expect(rows[0]!.maxCallsFromOneParent).toBe(12);
    expect(rows[1]!.maxCallsFromOneParent).toBe(1);
    expect(rows[2]!.maxCallsFromOneParent).toBe(1);
    expect(rows[2]!.errorCount).toBe(1);
  });

  test("falls back to the span duration when self time is unknown", () => {
    const rows: Array<OperationSummary> = summarizeOperations({
      spans: [span("a", "", 0, 30), span("b", "", 0, 10)],
      selfTimes: new Map(),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.selfTimeUnixNano).toBe(30);
    expect(rows[0]!.percentOfSelfTime).toBe(75);
  });

  test("no spans, no operations", () => {
    expect(summarizeOperations({ spans: [], selfTimes: new Map() })).toEqual(
      [],
    );
  });

  test("sortOperations sorts by every column in both directions", () => {
    const rows: Array<OperationSummary> = summarizeOperations({
      spans: operationSpans(),
      selfTimes: operationSelfTimes(),
    });

    expect(byName(sortOperations(rows, "count", "asc"))).toEqual([
      "svc-a:GET /orders",
      "svc-a:SELECT products",
      "svc-b:SELECT products",
    ]);
    expect(byName(sortOperations(rows, "errors", "desc"))).toEqual([
      "svc-a:SELECT products",
      "svc-a:GET /orders",
      "svc-b:SELECT products",
    ]);
    expect(byName(sortOperations(rows, "name", "asc"))).toEqual([
      "svc-a:GET /orders",
      "svc-a:SELECT products",
      "svc-b:SELECT products",
    ]);
    expect(byName(sortOperations(rows, "name", "desc"))).toEqual([
      "svc-a:SELECT products",
      "svc-b:SELECT products",
      "svc-a:GET /orders",
    ]);
    expect(byName(sortOperations(rows, "max", "desc"))).toEqual([
      "svc-a:GET /orders",
      "svc-b:SELECT products",
      "svc-a:SELECT products",
    ]);
    expect(byName(sortOperations(rows, "average", "asc"))).toEqual([
      "svc-a:SELECT products",
      "svc-b:SELECT products",
      "svc-a:GET /orders",
    ]);
    expect(byName(sortOperations(rows, "total", "desc"))).toEqual([
      "svc-b:SELECT products",
      "svc-a:GET /orders",
      "svc-a:SELECT products",
    ]);
    expect(byName(sortOperations(rows, "selfTime", "asc"))).toEqual([
      "svc-a:SELECT products",
      "svc-a:GET /orders",
      "svc-b:SELECT products",
    ]);
  });

  test("sortOperations does not reorder its input", () => {
    const rows: Array<OperationSummary> = summarizeOperations({
      spans: operationSpans(),
      selfTimes: operationSelfTimes(),
    });
    const before: Array<string> = byName(rows);

    sortOperations(rows, "name", "asc");

    expect(byName(rows)).toEqual(before);
  });
});

describe("getSpanLoadState", () => {
  test("one span beyond the first page", () => {
    expect(
      getSpanLoadState({
        loadedSpanCount: 500,
        totalSpanCount: 501,
        pageSize: 500,
      }),
    ).toEqual({
      loadedSpanCount: 500,
      totalSpanCount: 501,
      hasMore: true,
      remainingSpanCount: 1,
      nextBatchSize: 1,
    });
  });

  test("a large trace loads a page at a time", () => {
    const state: SpanLoadState = getSpanLoadState({
      loadedSpanCount: 500,
      totalSpanCount: 1250,
      pageSize: 500,
    });

    expect(state.remainingSpanCount).toBe(750);
    expect(state.nextBatchSize).toBe(500);
  });

  test("everything loaded, or no total reported, means nothing more", () => {
    expect(
      getSpanLoadState({
        loadedSpanCount: 36,
        totalSpanCount: 36,
        pageSize: 500,
      }).hasMore,
    ).toBe(false);
    expect(
      getSpanLoadState({
        loadedSpanCount: 500,
        totalSpanCount: 0,
        pageSize: 500,
      }),
    ).toMatchObject({
      hasMore: false,
      totalSpanCount: 500,
      nextBatchSize: 0,
    });
    expect(
      getSpanLoadState({ loadedSpanCount: 0, totalSpanCount: 0, pageSize: 500 })
        .hasMore,
    ).toBe(false);
  });

  test("a nonsensical page size still loads at least one span", () => {
    expect(
      getSpanLoadState({ loadedSpanCount: 0, totalSpanCount: 10, pageSize: 0 })
        .nextBatchSize,
    ).toBe(1);
  });
});

describe("attributes", () => {
  test("flattenSpanAttributes flattens nested objects into sorted dotted keys", () => {
    expect(
      flattenSpanAttributes({
        http: { method: "GET", status_code: 200 },
        "db.system": "postgresql",
        tags: ["a", "b"],
        empty: null,
        flag: false,
      }),
    ).toEqual([
      { key: "db.system", value: "postgresql" },
      { key: "flag", value: "false" },
      { key: "http.method", value: "GET" },
      { key: "http.status_code", value: "200" },
      { key: "tags", value: '["a","b"]' },
    ]);
  });

  test("flattenSpanAttributes handles missing attributes", () => {
    expect(flattenSpanAttributes(undefined)).toEqual([]);
    expect(flattenSpanAttributes(null)).toEqual([]);
    expect(flattenSpanAttributes({})).toEqual([]);
  });

  test("filterAttributeEntries matches keys and values, case-insensitively", () => {
    const entries: Array<AttributeEntry> = [
      { key: "db.system", value: "postgresql" },
      { key: "http.method", value: "GET" },
    ];

    expect(filterAttributeEntries(entries, "HTTP")).toEqual([entries[1]]);
    expect(filterAttributeEntries(entries, "postgres")).toEqual([entries[0]]);
    expect(filterAttributeEntries(entries, "zzz")).toEqual([]);
    expect(filterAttributeEntries(entries, "  ")).toBe(entries);
  });

  test("buildAttributeSearchQuery writes a search the traces list understands", () => {
    expect(buildAttributeSearchQuery("http.method", "GET")).toBe(
      "@http.method:GET",
    );
    expect(buildAttributeSearchQuery("user.agent", "Mozilla 5")).toBe(
      '@user.agent:"Mozilla 5"',
    );
    expect(buildAttributeSearchQuery("http.route", "/api/*")).not.toBe(
      "@http.route:/api/*",
    );
    expect(
      buildAttributeSearchQuery("http.route", "/api/*").startsWith(
        "@http.route:",
      ),
    ).toBe(true);
  });
});

describe("buildSpanEventRows", () => {
  function event(
    name: string,
    timeUnixNano: number | undefined,
    attributes: Record<string, unknown> = {},
  ): SpanEvent {
    return {
      name,
      time: new Date(0),
      timeUnixNano: timeUnixNano as number,
      attributes,
    } as SpanEvent;
  }

  test("orders events in time with offsets from the span and the trace", () => {
    const rows: Array<SpanEventRow> = buildSpanEventRows({
      events: [
        event("cache.miss", 150, { key: "user:1" }),
        event("request.accepted", 120),
      ],
      spanStartUnixNano: 110,
      traceStartUnixNano: 100,
    });

    expect(
      rows.map((row: SpanEventRow) => {
        return row.name;
      }),
    ).toEqual(["request.accepted", "cache.miss"]);
    expect(rows[0]!.offsetFromSpanStartUnixNano).toBe(10);
    expect(rows[0]!.offsetFromTraceStartUnixNano).toBe(20);
    expect(rows[1]!.attributes).toEqual([{ key: "key", value: "user:1" }]);
    expect(rows[1]!.isException).toBe(false);
    expect(rows[1]!.title).toBe("cache.miss");
  });

  test("an exception event is titled by its message, then its type", () => {
    const rows: Array<SpanEventRow> = buildSpanEventRows({
      events: [
        event("exception", 1, {
          "exception.message": "stock version changed",
          "exception.type": "InventoryError",
        }),
        event("exception", 2, { "exception.type": "TimeoutError" }),
        event("Exception", 3),
      ],
      spanStartUnixNano: 0,
      traceStartUnixNano: 0,
    });

    expect(
      rows.map((row: SpanEventRow) => {
        return row.title;
      }),
    ).toEqual(["stock version changed", "TimeoutError", "Exception"]);
    expect(
      rows.every((row: SpanEventRow) => {
        return row.isException;
      }),
    ).toBe(true);
  });

  test("an event before the span, or without a time, sits at the span start", () => {
    const rows: Array<SpanEventRow> = buildSpanEventRows({
      events: [event("early", 50), event("untimed", undefined)],
      spanStartUnixNano: 100,
      traceStartUnixNano: 100,
    });

    expect(
      rows.map((row: SpanEventRow) => {
        return row.offsetFromSpanStartUnixNano;
      }),
    ).toEqual([0, 0]);
  });

  test("keeps each event's attributes as recorded, beside the display rows, for Copy JSON", () => {
    const [row] = buildSpanEventRows({
      events: [
        event("lock.acquired", 5, {
          "lock.wait_ms": 18,
          "lock.contended": true,
          "lock.holders": ["tx-1", "tx-2"],
        }),
      ],
      spanStartUnixNano: 0,
      traceStartUnixNano: 0,
    });

    // The list shows text...
    expect(row!.attributes).toEqual([
      { key: "lock.contended", value: "true" },
      { key: "lock.holders", value: '["tx-1","tx-2"]' },
      { key: "lock.wait_ms", value: "18" },
    ]);
    // ...the copy keeps the types.
    expect(row!.rawAttributes).toEqual({
      "lock.wait_ms": 18,
      "lock.contended": true,
      "lock.holders": ["tx-1", "tx-2"],
    });
  });

  test("an event without attributes has an empty raw attribute map", () => {
    const [row] = buildSpanEventRows({
      events: [
        { name: "cache.miss", time: new Date(0), timeUnixNano: 1 } as SpanEvent,
      ],
      spanStartUnixNano: 0,
      traceStartUnixNano: 0,
    });

    expect(row!.rawAttributes).toEqual({});
    expect(row!.attributes).toEqual([]);
  });

  test("no events", () => {
    expect(
      buildSpanEventRows({
        events: undefined,
        spanStartUnixNano: 0,
        traceStartUnixNano: 0,
      }),
    ).toEqual([]);
  });
});

describe("buildSpanShareUrl", () => {
  test("adds the span id and keeps the other parameters", () => {
    expect(
      buildSpanShareUrl(
        "https://oneuptime.example/dashboard/p/traces/view/t?trace=checkout",
        "abc",
      ),
    ).toBe(
      "https://oneuptime.example/dashboard/p/traces/view/t?trace=checkout&spanId=abc",
    );
  });

  test("replaces an existing span id and drops the hash", () => {
    expect(
      buildSpanShareUrl(
        "https://oneuptime.example/t?spanId=old&x=1#section",
        "new",
      ),
    ).toBe("https://oneuptime.example/t?spanId=new&x=1");
  });

  test("returns anything that is not a URL unchanged", () => {
    expect(buildSpanShareUrl("not a url", "abc")).toBe("not a url");
  });
});

describe("getSpanTiming", () => {
  test("places a span inside the trace and splits out its self time", () => {
    const timing: SpanTiming = getSpanTiming({
      span: span("a", "", 110, 40),
      selfTime: selfTimes({ a: 10 }).get("a"),
      traceStartUnixNano: 100,
      traceDurationUnixNano: 200,
    });

    expect(timing).toEqual({
      offsetUnixNano: 10,
      durationUnixNano: 40,
      selfTimeUnixNano: 10,
      selfTimePercent: 25,
      leftPercent: 5,
      widthPercent: 20,
    });
  });

  test("without a self time the whole span is self time", () => {
    const timing: SpanTiming = getSpanTiming({
      span: span("a", "", 100, 50),
      selfTime: undefined,
      traceStartUnixNano: 100,
      traceDurationUnixNano: 100,
    });

    expect(timing.selfTimeUnixNano).toBe(50);
    expect(timing.selfTimePercent).toBe(100);
  });

  test("zero-length spans and traces do not divide by zero", () => {
    const timing: SpanTiming = getSpanTiming({
      span: span("a", "", 100, 0),
      selfTime: undefined,
      traceStartUnixNano: 100,
      traceDurationUnixNano: 0,
    });

    expect(timing.selfTimePercent).toBe(100);
    expect(timing.leftPercent).toBe(0);
    expect(timing.widthPercent).toBe(100);
  });
});

describe("splitHighlightSegments", () => {
  test("marks every search word", () => {
    expect(
      splitHighlightSegments("SELECT stock FOR UPDATE", "stock update"),
    ).toEqual([
      { text: "SELECT ", isMatch: false },
      { text: "stock", isMatch: true },
      { text: " FOR ", isMatch: false },
      { text: "UPDATE", isMatch: true },
    ]);
  });

  test("merges overlapping and adjacent matches", () => {
    expect(splitHighlightSegments("aaaa", "aa")).toEqual([
      { text: "aaaa", isMatch: true },
    ]);
    expect(splitHighlightSegments("abcd", "ab cd")).toEqual([
      { text: "abcd", isMatch: true },
    ]);
  });

  test("text without a match, or without a search, is one plain run", () => {
    const plain: Array<HighlightSegment> = [{ text: "GET /", isMatch: false }];

    expect(splitHighlightSegments("GET /", "post")).toEqual(plain);
    expect(splitHighlightSegments("GET /", "   ")).toEqual(plain);
    expect(splitHighlightSegments("", "get")).toEqual([]);
  });

  test("the segments always rebuild the original text", () => {
    const text: string = "POST inventory-service /reserve (retry 1)";

    expect(
      splitHighlightSegments(text, "RE e")
        .map((segment: HighlightSegment) => {
          return segment.text;
        })
        .join(""),
    ).toBe(text);
  });
});
