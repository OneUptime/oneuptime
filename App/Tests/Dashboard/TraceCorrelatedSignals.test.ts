import { describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
/*
 * Imported by relative path (not the "Common/..." mapping) deliberately:
 * the round-trip tests below must exercise the exact serializer sources
 * this branch ships, and the relative path also type-checks that the
 * util's TraceCrossSignalScope mirror stays assignable to the real
 * TelemetryCrossSignalScope parameter type.
 */
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
  toMetricsExplorerQueryParams,
} from "../../../Common/Utils/Telemetry/CrossSignalScope";
import {
  ProfilePresenceGate,
  SpanPanelLogQueryPlan,
  TraceCorrelatedMetricItem,
  TraceMetricSeries,
  TracesPivotInput,
  TracesPivotScopeResult,
  buildExceptionsGroupRoute,
  buildSpanPanelLogQuery,
  buildTraceFlamegraphRequest,
  buildTracesPivotScope,
  describeDroppedScopeFields,
  getProfilePresenceGate,
  groupMetricsForTrace,
} from "../../FeatureSet/Dashboard/src/Utils/TraceCorrelatedSignals";

/*
 * These helpers are the logic behind the trace <-> other-signal surfaces:
 * the Trace Explorer's correlated-signals strip (Metrics / Profile tabs),
 * the span list panel's Logs / Exceptions tabs, SpanViewer's presence-gated
 * Profile tab, and the traces toolbar's Logs / Metrics pivots. Each one is
 * exercised on its happy path, its empty/absent inputs, and the malformed
 * data a network payload can always contain.
 */

function metricItem(
  overrides: Partial<TraceCorrelatedMetricItem>,
): TraceCorrelatedMetricItem {
  return {
    name: "http.server.duration",
    time: "2026-08-14T10:00:00.000Z",
    value: 1,
    spanId: "span-1",
    serviceId: "service-1",
    attributes: {},
    ...overrides,
  };
}

describe("groupMetricsForTrace", () => {
  test("returns an empty list for empty, null, and undefined input", () => {
    expect(groupMetricsForTrace([])).toEqual([]);
    expect(groupMetricsForTrace(null)).toEqual([]);
    expect(groupMetricsForTrace(undefined)).toEqual([]);
  });

  test("groups interleaved rows by metric name, keeping first-appearance order", () => {
    const items: Array<TraceCorrelatedMetricItem> = [
      metricItem({ name: "a", time: "2026-08-14T10:00:00Z", value: 1 }),
      metricItem({ name: "b", time: "2026-08-14T10:00:01Z", value: 10 }),
      metricItem({ name: "a", time: "2026-08-14T10:00:02Z", value: 3 }),
      metricItem({ name: "c", time: "2026-08-14T10:00:03Z", value: 100 }),
      metricItem({ name: "b", time: "2026-08-14T10:00:04Z", value: 20 }),
      metricItem({ name: "a", time: "2026-08-14T10:00:05Z", value: 2 }),
    ];

    const grouped: Array<TraceMetricSeries> = groupMetricsForTrace(items);

    expect(
      grouped.map((series: TraceMetricSeries): string => {
        return series.name;
      }),
    ).toEqual(["a", "b", "c"]);

    const a: TraceMetricSeries = grouped[0]!;
    expect(
      a.points.map((point: TraceCorrelatedMetricItem): number => {
        return point.value;
      }),
    ).toEqual([1, 3, 2]);
    expect(a.minValue).toBe(1);
    expect(a.maxValue).toBe(3);
    expect(a.latestValue).toBe(2);

    const b: TraceMetricSeries = grouped[1]!;
    expect(b.points.length).toBe(2);
    expect(b.minValue).toBe(10);
    expect(b.maxValue).toBe(20);
    expect(b.latestValue).toBe(20);

    expect(grouped[2]!.points.length).toBe(1);
    expect(grouped[2]!.latestValue).toBe(100);
  });

  test("re-sorts out-of-order points by time so latestValue is the newest sample", () => {
    const items: Array<TraceCorrelatedMetricItem> = [
      metricItem({ time: "2026-08-14T10:00:05Z", value: 5 }),
      metricItem({ time: "2026-08-14T10:00:01Z", value: 1 }),
      metricItem({ time: "2026-08-14T10:00:03Z", value: 3 }),
    ];

    const grouped: Array<TraceMetricSeries> = groupMetricsForTrace(items);

    expect(
      grouped[0]!.points.map((point: TraceCorrelatedMetricItem): number => {
        return point.value;
      }),
    ).toEqual([1, 3, 5]);
    expect(grouped[0]!.latestValue).toBe(5);
  });

  test("counts distinct spans per series", () => {
    const items: Array<TraceCorrelatedMetricItem> = [
      metricItem({ spanId: "s1", value: 1 }),
      metricItem({ spanId: "s2", value: 2 }),
      metricItem({ spanId: "s1", value: 3 }),
      metricItem({ spanId: "", value: 4 }),
    ];

    const grouped: Array<TraceMetricSeries> = groupMetricsForTrace(items);

    expect(grouped[0]!.points.length).toBe(4);
    expect(grouped[0]!.distinctSpanCount).toBe(2);
  });

  test("drops malformed rows instead of producing NaN stats", () => {
    const items: Array<TraceCorrelatedMetricItem> = [
      metricItem({ value: 7 }),
      null as unknown as TraceCorrelatedMetricItem,
      metricItem({ name: "" }),
      metricItem({ name: undefined as unknown as string }),
      metricItem({ value: NaN }),
      metricItem({ value: Infinity }),
      metricItem({ value: "not-a-number" as unknown as number }),
    ];

    const grouped: Array<TraceMetricSeries> = groupMetricsForTrace(items);

    expect(grouped.length).toBe(1);
    expect(grouped[0]!.points.length).toBe(1);
    expect(grouped[0]!.minValue).toBe(7);
    expect(grouped[0]!.maxValue).toBe(7);
    expect(grouped[0]!.latestValue).toBe(7);
  });

  test("coerces numeric-string values (JSON payloads are stringly typed)", () => {
    const grouped: Array<TraceMetricSeries> = groupMetricsForTrace([
      metricItem({ value: "42" as unknown as number }),
    ]);

    expect(grouped[0]!.latestValue).toBe(42);
  });

  test("keeps unparseable times in their input positions (stable sort)", () => {
    const items: Array<TraceCorrelatedMetricItem> = [
      metricItem({ time: "not-a-time", value: 1 }),
      metricItem({ time: "also-not-a-time", value: 2 }),
    ];

    const grouped: Array<TraceMetricSeries> = groupMetricsForTrace(items);

    expect(
      grouped[0]!.points.map((point: TraceCorrelatedMetricItem): number => {
        return point.value;
      }),
    ).toEqual([1, 2]);
  });
});

describe("getProfilePresenceGate", () => {
  test("a positive sampleCount opens the gate with the count", () => {
    expect(getProfilePresenceGate({ sampleCount: 3 })).toEqual({
      isVisible: true,
      sampleCount: 3,
    });
  });

  test("zero samples keeps the gate closed", () => {
    expect(getProfilePresenceGate({ sampleCount: 0 })).toEqual({
      isVisible: false,
      sampleCount: 0,
    });
  });

  test("a failed request (null / undefined response) keeps the gate closed without crashing", () => {
    expect(getProfilePresenceGate(null)).toEqual({
      isVisible: false,
      sampleCount: 0,
    });
    expect(getProfilePresenceGate(undefined)).toEqual({
      isVisible: false,
      sampleCount: 0,
    });
  });

  test("malformed payloads keep the gate closed", () => {
    const closed: ProfilePresenceGate = { isVisible: false, sampleCount: 0 };

    expect(getProfilePresenceGate({})).toEqual(closed);
    expect(getProfilePresenceGate({ sampleCount: "abc" })).toEqual(closed);
    expect(getProfilePresenceGate({ sampleCount: -5 })).toEqual(closed);
    expect(getProfilePresenceGate({ sampleCount: Infinity })).toEqual(closed);
    expect(getProfilePresenceGate({ sampleCount: NaN })).toEqual(closed);
  });

  test("numeric-string and fractional counts normalize to a whole sample count", () => {
    expect(getProfilePresenceGate({ sampleCount: "7" })).toEqual({
      isVisible: true,
      sampleCount: 7,
    });
    expect(getProfilePresenceGate({ sampleCount: 2.9 })).toEqual({
      isVisible: true,
      sampleCount: 2,
    });
  });
});

describe("buildSpanPanelLogQuery", () => {
  test("prefers the span-scoped query when a spanId exists", () => {
    const plan: SpanPanelLogQueryPlan | null = buildSpanPanelLogQuery({
      spanId: "span-1",
      traceId: "trace-1",
    });

    expect(plan).toEqual({ scope: "span", query: { spanId: "span-1" } });
  });

  test("falls back to the trace-scoped query when the row has no span id", () => {
    expect(buildSpanPanelLogQuery({ traceId: "trace-1" })).toEqual({
      scope: "trace",
      query: { traceId: "trace-1" },
    });
    expect(
      buildSpanPanelLogQuery({ spanId: "   ", traceId: "trace-1" }),
    ).toEqual({
      scope: "trace",
      query: { traceId: "trace-1" },
    });
  });

  test("returns null (no fetch) when neither id is usable", () => {
    expect(buildSpanPanelLogQuery({})).toBeNull();
    expect(buildSpanPanelLogQuery({ spanId: "", traceId: "" })).toBeNull();
    expect(buildSpanPanelLogQuery({ spanId: "  ", traceId: " " })).toBeNull();
    expect(
      buildSpanPanelLogQuery({ spanId: undefined, traceId: undefined }),
    ).toBeNull();
  });

  test("trims ids before querying", () => {
    expect(buildSpanPanelLogQuery({ spanId: " span-1 " })).toEqual({
      scope: "span",
      query: { spanId: "span-1" },
    });
  });
});

describe("buildExceptionsGroupRoute", () => {
  const baseRoute: Route = new Route(
    "/dashboard/project-1/exceptions/unresolved",
  );

  test("builds a fingerprint-search deep link with status=all and a wide range", () => {
    const route: Route | null = buildExceptionsGroupRoute({
      exceptionsListRoute: baseRoute,
      fingerprint: "abc123",
    });

    expect(route).not.toBeNull();

    const routeString: string = route!.toString();
    expect(
      routeString.startsWith("/dashboard/project-1/exceptions/unresolved?"),
    ).toBe(true);

    const params: URLSearchParams = new URLSearchParams(
      routeString.split("?")[1] || "",
    );

    /*
     * The exceptions viewer decodeURIComponent()s the search param AFTER
     * URLSearchParams already decoded it once — mirror both decodes here.
     */
    expect(decodeURIComponent(params.get("search")!)).toBe(
      "@fingerprint:abc123",
    );
    expect(params.get("status")).toBe("all");
    expect(decodeURIComponent(params.get("range")!)).toBe(
      TimeRange.PAST_THREE_MONTHS,
    );
  });

  test("does not mutate the base route", () => {
    const before: string = baseRoute.toString();
    buildExceptionsGroupRoute({
      exceptionsListRoute: baseRoute,
      fingerprint: "abc123",
    });
    expect(baseRoute.toString()).toBe(before);
  });

  test("returns null for an empty or whitespace fingerprint", () => {
    expect(
      buildExceptionsGroupRoute({
        exceptionsListRoute: baseRoute,
        fingerprint: "",
      }),
    ).toBeNull();
    expect(
      buildExceptionsGroupRoute({
        exceptionsListRoute: baseRoute,
        fingerprint: "   ",
      }),
    ).toBeNull();
  });

  test("escapes fingerprints Route could not otherwise carry, round-tripping intact", () => {
    // Spaces and double quotes are rejected by Route's character whitelist raw.
    const fingerprint: string = 'weird "fp" with spaces & symbols';

    const route: Route | null = buildExceptionsGroupRoute({
      exceptionsListRoute: baseRoute,
      fingerprint,
    });

    expect(route).not.toBeNull();

    const params: URLSearchParams = new URLSearchParams(
      route!.toString().split("?")[1] || "",
    );

    expect(decodeURIComponent(params.get("search")!)).toBe(
      `@fingerprint:${fingerprint}`,
    );
  });
});

describe("buildTraceFlamegraphRequest", () => {
  test("trace-wide request omits spanIds entirely", () => {
    expect(buildTraceFlamegraphRequest({ traceId: "trace-1" })).toEqual({
      traceId: "trace-1",
    });
    expect(
      buildTraceFlamegraphRequest({ traceId: "trace-1", spanIds: [] }),
    ).toEqual({ traceId: "trace-1" });
  });

  test("span-scoped request carries trimmed, deduped spanIds", () => {
    expect(
      buildTraceFlamegraphRequest({
        traceId: " trace-1 ",
        spanIds: [" s1 ", "s2", "s1", "", "   "],
      }),
    ).toEqual({ traceId: "trace-1", spanIds: ["s1", "s2"] });
  });

  test("all-blank spanIds degrade to a trace-wide request", () => {
    expect(
      buildTraceFlamegraphRequest({ traceId: "trace-1", spanIds: ["", "  "] }),
    ).toEqual({ traceId: "trace-1" });
  });

  test("no usable traceId means no request at all", () => {
    expect(buildTraceFlamegraphRequest({ traceId: "" })).toBeNull();
    expect(buildTraceFlamegraphRequest({ traceId: "   " })).toBeNull();
    expect(
      buildTraceFlamegraphRequest({
        traceId: "",
        spanIds: ["s1"],
      }),
    ).toBeNull();
  });
});

describe("buildTracesPivotScope", () => {
  const startTime: Date = new Date("2026-08-14T09:00:00.000Z");
  const endTime: Date = new Date("2026-08-14T10:00:00.000Z");

  function pivotInput(overrides: Partial<TracesPivotInput>): TracesPivotInput {
    return {
      primaryEntityId: undefined,
      scopeAttributeFilters: undefined,
      activeFilters: [],
      fieldFilters: {},
      searchAttributes: {},
      searchAttributeSearches: {},
      freeText: "",
      rootOnly: false,
      hasEntityScope: false,
      startTime,
      endTime,
      ...overrides,
    };
  }

  test("an unfiltered view carries only the window and reports nothing lost", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({}),
    );

    expect(result.scope).toEqual({ startTime, endTime });
    expect(result.notCarried).toEqual([]);
  });

  test("unions every resource facet (and the prop scope) into deduped serviceIds", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        primaryEntityId: "svc-1",
        activeFilters: [
          { facetKey: "primaryEntityId", value: "svc-2" },
          { facetKey: "hostId", value: "host-1" },
          { facetKey: "kubernetesClusterId", value: "cluster-1" },
          { facetKey: "dockerHostId", value: "svc-1" },
          { facetKey: "podmanHostId", value: "podman-1" },
        ],
        fieldFilters: { primaryEntityId: ["svc-3", "svc-2"] },
      }),
    );

    expect(result.scope.serviceIds).toEqual([
      "svc-1",
      "svc-2",
      "host-1",
      "cluster-1",
      "podman-1",
      "svc-3",
    ]);
    expect(result.notCarried).toEqual([]);
  });

  test("carries trace and span id filters from chips and search tokens", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        activeFilters: [{ facetKey: "traceId", value: "t-chip" }],
        fieldFilters: { traceId: ["t-token"], spanId: ["s-token"] },
      }),
    );

    expect(result.scope.traceIds).toEqual(["t-chip", "t-token"]);
    expect(result.scope.spanIds).toEqual(["s-token"]);
  });

  test("merges attribute filters with the read-only prop scope winning", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        activeFilters: [
          { facetKey: "attributes.http.method", value: "GET" },
          { facetKey: "attributes.region", value: "chip-region" },
        ],
        searchAttributes: { "user.id": "42" },
        scopeAttributeFilters: { region: "scope-region" },
      }),
    );

    expect(result.scope.attributes).toEqual({
      "http.method": "GET",
      region: "scope-region",
      "user.id": "42",
    });
  });

  test("reports contains-filters as not carried (chips and tokens, once)", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        activeFilters: [
          { facetKey: "attributeSearches.url.host", value: "starship" },
        ],
        searchAttributeSearches: { "db.statement": "SELECT" },
      }),
    );

    expect(result.scope.attributes).toBeUndefined();
    expect(result.notCarried).toEqual(["attribute contains-filters"]);
  });

  test("reports every scope-inexpressible filter kind exactly once", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        activeFilters: [
          { facetKey: "statusCode", value: "2" },
          { facetKey: "hasException", value: "true" },
          { facetKey: "name", value: "GET /api" },
        ],
        fieldFilters: {
          kind: ["server"],
          statusMessage: ["timeout"],
          durationUnixNano: [">500"],
          statusCode: ["error"],
        },
        freeText: "checkout",
        rootOnly: true,
        hasEntityScope: true,
      }),
    );

    expect(result.notCarried.sort()).toEqual(
      [
        "span status",
        "exception flag",
        "span name",
        "span kind",
        "status message",
        "duration",
        "root-spans-only",
        "entity scope",
      ].sort(),
    );
  });

  test("ignores blank filter values instead of emitting empty scope entries", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        activeFilters: [
          { facetKey: "primaryEntityId", value: "  " },
          { facetKey: "attributes.empty", value: "" },
          { facetKey: "attributes.", value: "orphan" },
        ],
        fieldFilters: { traceId: [""] },
      }),
    );

    expect(result.scope.serviceIds).toBeUndefined();
    expect(result.scope.traceIds).toBeUndefined();
    expect(result.scope.attributes).toBeUndefined();
  });

  test("the produced scope round-trips through the logs serializer losslessly", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        primaryEntityId: "svc-1",
        activeFilters: [{ facetKey: "attributes.http.method", value: "GET" }],
      }),
    );

    const serialized: CrossSignalQueryParams = toLogsExplorerQueryParams(
      result.scope,
    );

    expect(serialized.dropped).toEqual([]);

    const tuples: Array<[string, Array<string>]> = JSON.parse(
      serialized.params["filters"]!,
    ) as Array<[string, Array<string>]>;

    expect(tuples).toContainEqual(["primaryEntityId", ["svc-1"]]);
    expect(tuples).toContainEqual(["attributes.http.method", ["GET"]]);
    expect(serialized.params["range"]).toBe(TimeRange.CUSTOM);
    expect(serialized.params["start"]).toBeTruthy();
    expect(serialized.params["end"]).toBeTruthy();
  });

  test("the metrics serializer reports the scope fields it drops, and the labels read human", () => {
    const result: TracesPivotScopeResult = buildTracesPivotScope(
      pivotInput({
        primaryEntityId: "svc-1",
        fieldFilters: { traceId: ["t-1"], spanId: ["s-1"] },
      }),
    );

    const serialized: CrossSignalQueryParams = toMetricsExplorerQueryParams(
      result.scope,
    );

    expect(serialized.dropped.sort()).toEqual(
      ["serviceIds", "spanIds", "traceIds"].sort(),
    );
    expect(describeDroppedScopeFields(serialized.dropped).sort()).toEqual(
      ["service filters", "span ids", "trace ids"].sort(),
    );
  });
});

describe("describeDroppedScopeFields", () => {
  test("maps known scope field names to human labels", () => {
    expect(describeDroppedScopeFields(["serviceIds"])).toEqual([
      "service filters",
    ]);
    expect(describeDroppedScopeFields(["severityTexts"])).toEqual([
      "severities",
    ]);
  });

  test("collapses both window endpoints into a single label", () => {
    expect(describeDroppedScopeFields(["startTime", "endTime"])).toEqual([
      "time window",
    ]);
  });

  test("passes unknown field names through so nothing is silently hidden", () => {
    expect(describeDroppedScopeFields(["futureField"])).toEqual([
      "futureField",
    ]);
  });

  test("empty input yields no labels", () => {
    expect(describeDroppedScopeFields([])).toEqual([]);
  });
});
