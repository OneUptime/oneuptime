import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type {
  LogsPivotScopeInput,
  LogsPivotScopeResult,
} from "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot";

/*
 * The logs explorer's cross-signal glue: compiling the current view (base
 * scope props + applied facet chips + time window) into serializer input for
 * the Traces/Metrics pivot buttons, the sessionIds query compilation, and
 * the route builders trace/span/session ids link out through. Everything the
 * scope holds that a target cannot express must surface in `dropped` — the
 * pivot buttons render it as a tooltip hint, never dropping scope silently.
 */

type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");
type IncludesModule = typeof import("Common/Types/BaseDatabase/Includes");
type SearchModule = typeof import("Common/Types/BaseDatabase/Search");
type IsNullModule = typeof import("Common/Types/BaseDatabase/IsNull");
type InBetweenModule = typeof import("Common/Types/BaseDatabase/InBetween");
type ObjectIDModule = typeof import("Common/Types/ObjectID");
type SpanModule = typeof import("Common/Models/AnalyticsModels/Span");
type RumSessionModule =
  typeof import("Common/Models/AnalyticsModels/RumSession");

let Pivot: PivotModule;
let Includes: IncludesModule["default"];
let Search: SearchModule["default"];
let IsNull: IsNullModule["default"];
let InBetween: InBetweenModule["default"];
let ObjectID: ObjectIDModule["default"];
let Span: SpanModule["default"];
let RumSession: RumSessionModule["default"];

/*
 * The serializers this scope feeds. Loaded through a non-literal specifier:
 * a literal one would make ts-jest type-resolve the module through
 * node_modules/Common, and in a worktree that symlink can point at a
 * checkout that predates CrossSignalScope.ts. Jest's moduleNameMapper still
 * resolves the runtime require against this repo's Common, so the round-trip
 * below exercises the real serializers.
 */
interface CrossSignalParams {
  params: Record<string, string>;
  dropped: Array<string>;
}

type SerializeScopeFunction = (scope: unknown) => CrossSignalParams;

let toLogsExplorerQueryParams: SerializeScopeFunction;
let toTracesExplorerQueryParams: SerializeScopeFunction;
let toMetricsExplorerQueryParams: SerializeScopeFunction;

const WINDOW_START: Date = new Date("2026-08-10T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-10T11:00:00.000Z");

let CUSTOM_RANGE: RangeStartAndEndDateTime;

// Exactly the composition DashboardLogsViewer's pivot buttons perform.
function tracesPivot(scopeInput: LogsPivotScopeInput): CrossSignalParams {
  const { scope, dropped }: LogsPivotScopeResult =
    Pivot.buildLogsPivotScope(scopeInput);
  const serialized: CrossSignalParams = toTracesExplorerQueryParams(scope);

  return {
    params: serialized.params,
    dropped: Pivot.mergeDroppedScopeFields(dropped, serialized.dropped),
  };
}

function metricsPivot(scopeInput: LogsPivotScopeInput): CrossSignalParams {
  const { scope, dropped }: LogsPivotScopeResult =
    Pivot.buildLogsPivotScope(scopeInput);
  const serialized: CrossSignalParams = toMetricsExplorerQueryParams(scope);

  return {
    params: serialized.params,
    dropped: Pivot.mergeDroppedScopeFields(dropped, serialized.dropped),
  };
}

function facets(
  entries: Record<string, Array<string>>,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of Object.entries(entries)) {
    map.set(key, new Set(values));
  }

  return map;
}

function input(
  overrides: Partial<LogsPivotScopeInput> = {},
): LogsPivotScopeInput {
  return {
    appliedFacetFilters: new Map(),
    timeRange: CUSTOM_RANGE,
    ...overrides,
  };
}

/*
 * Common/UI/Config reads `window` the moment it loads, and the pivot util
 * pulls it in transitively via RouteMap -> ProjectUtil, so the browser stub
 * has to exist before the deferred imports run. Same approach as
 * MonitorRecommendationRoutes.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Pivot = await import(
    "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );

  const crossSignalScopeModulePath: string =
    "Common/Utils/Telemetry/CrossSignalScope";
  const crossSignalScopeModule: Record<string, unknown> = (await import(
    crossSignalScopeModulePath
  )) as Record<string, unknown>;
  toLogsExplorerQueryParams = crossSignalScopeModule[
    "toLogsExplorerQueryParams"
  ] as SerializeScopeFunction;
  toTracesExplorerQueryParams = crossSignalScopeModule[
    "toTracesExplorerQueryParams"
  ] as SerializeScopeFunction;
  toMetricsExplorerQueryParams = crossSignalScopeModule[
    "toMetricsExplorerQueryParams"
  ] as SerializeScopeFunction;

  Includes = (await import("Common/Types/BaseDatabase/Includes")).default;
  Search = (await import("Common/Types/BaseDatabase/Search")).default;
  IsNull = (await import("Common/Types/BaseDatabase/IsNull")).default;
  InBetween = (await import("Common/Types/BaseDatabase/InBetween")).default;
  ObjectID = (await import("Common/Types/ObjectID")).default;
  Span = (await import("Common/Models/AnalyticsModels/Span")).default;
  RumSession = (await import("Common/Models/AnalyticsModels/RumSession"))
    .default;

  CUSTOM_RANGE = {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  };
});

describe("buildLogsPivotScope", () => {
  test("an empty view yields only the resolved window and drops nothing", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(input());

    expect(result.scope.startTime).toEqual(WINDOW_START);
    expect(result.scope.endTime).toEqual(WINDOW_END);
    expect(result.scope.serviceIds).toBeUndefined();
    expect(result.scope.traceIds).toBeUndefined();
    expect(result.scope.spanIds).toBeUndefined();
    expect(result.scope.severityTexts).toBeUndefined();
    expect(result.scope.attributes).toBeUndefined();
    expect(result.dropped).toEqual([]);
  });

  test("base service scope unions with Service facet selections, deduped", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        serviceIds: ["svc-1", "svc-2"],
        appliedFacetFilters: facets({
          primaryEntityId: ["svc-2", "svc-3"],
        }),
      }),
    );

    expect(result.scope.serviceIds).toEqual(["svc-1", "svc-2", "svc-3"]);
    expect(result.dropped).toEqual([]);
  });

  test("resource facets travel under their own key, not folded into serviceIds", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        serviceIds: ["svc-1"],
        appliedFacetFilters: facets({
          primaryEntityId: ["svc-2"],
          hostId: ["host-1"],
          dockerHostId: ["docker-1"],
          podmanHostId: ["podman-1"],
          kubernetesClusterId: ["k8s-1"],
        }),
      }),
    );

    /*
     * A cluster id folded into serviceIds became a `primaryEntityId` chip in
     * the pivot target — the same filter-matches-nothing bug the logs
     * explorer had (issue #3216), just one page further along.
     */
    expect(result.scope.serviceIds).toEqual(["svc-1", "svc-2"]);
    expect(result.scope.resourceFacetSelections).toEqual({
      hostId: ["host-1"],
      dockerHostId: ["docker-1"],
      podmanHostId: ["podman-1"],
      kubernetesClusterId: ["k8s-1"],
    });
    expect(result.dropped).toEqual([]);
  });

  test("a view with no resource chips carries no resource selections", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({ appliedFacetFilters: facets({ primaryEntityId: ["svc-1"] }) }),
    );

    expect(result.scope.resourceFacetSelections).toBeUndefined();
  });

  test("base and applied trace/span ids union, and severity selections carry", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        traceIds: ["trace-base"],
        spanIds: ["span-base"],
        appliedFacetFilters: facets({
          traceId: ["trace-base", "trace-facet"],
          spanId: ["span-facet"],
          severityText: ["Error", "Fatal"],
        }),
      }),
    );

    expect(result.scope.traceIds).toEqual(["trace-base", "trace-facet"]);
    expect(result.scope.spanIds).toEqual(["span-base", "span-facet"]);
    expect(new Set(result.scope.severityTexts)).toEqual(
      new Set(["Error", "Fatal"]),
    );
    expect(result.dropped).toEqual([]);
  });

  test("base attributes pass through and a single-value attribute facet overrides the base value for the same key", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        attributes: { "http.method": "GET", requestId: "req-1" },
        appliedFacetFilters: facets({
          "attributes.http.method": ["POST"],
          "attributes.k8s.pod.name": ["pod-a"],
        }),
      }),
    );

    expect(result.scope.attributes).toEqual({
      "http.method": "POST",
      requestId: "req-1",
      "k8s.pod.name": "pod-a",
    });
    expect(result.dropped).toEqual([]);
  });

  test("a base attribute filter that carries an operator is reported dropped", () => {
    /*
     * The scope's attribute filters are exact single-value matches. Once the
     * attribute filter rows gained an operator dropdown, a base filter could
     * be an operator object instead of a string — and it used to be copied
     * straight through, arriving in the target explorer's query params as
     * "[object Object]", which matched nothing while looking like a carried
     * filter. Report it dropped so the pivot button says so.
     */
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        attributes: {
          "http.method": "GET",
          logtype: new Includes(["web", "api"]),
        },
      }),
    );

    expect(result.scope.attributes).toEqual({ "http.method": "GET" });
    expect(result.dropped).toEqual(["attributes.logtype"]);
  });

  test("every operator shape is dropped, not stringified", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        attributes: {
          a: new Includes(["web"]),
          b: new Search<string>("web"),
          c: new IsNull(),
        },
      }),
    );

    expect(result.scope.attributes).toBeUndefined();
    expect(result.dropped).toEqual([
      "attributes.a",
      "attributes.b",
      "attributes.c",
    ]);

    /*
     * Not `JSON.stringify(scope).not.toContain("[object Object]")` — every
     * operator defines toJSON(), so that assertion holds just as well against
     * the pass-through this test exists to forbid. What matters is that no
     * non-string value survives into the scope at all.
     */
    for (const carried of Object.values(result.scope.attributes || {})) {
      expect(typeof carried).toBe("string");
    }
  });

  test("scalar base attributes still carry over unchanged", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({ attributes: { "http.method": "GET", statusCode: 500 } }),
    );

    expect(result.scope.attributes).toEqual({
      "http.method": "GET",
      statusCode: "500",
    });
    expect(result.dropped).toEqual([]);
  });

  test("a multi-valued attribute selection has no representation and is reported dropped", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        appliedFacetFilters: facets({
          "attributes.http.method": ["GET", "POST"],
        }),
      }),
    );

    expect(result.scope.attributes).toBeUndefined();
    expect(result.dropped).toEqual(["attributes.http.method"]);
  });

  test("a session scope is reported dropped — no cross-signal field carries sessions", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({ sessionIds: ["sess-1"] }),
    );

    expect(result.dropped).toEqual(["sessionIds"]);
  });

  test("an unknown facet key is reported dropped verbatim, never silently ignored", () => {
    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        appliedFacetFilters: facets({ someFutureFacet: ["x"] }),
      }),
    );

    expect(result.dropped).toEqual(["someFutureFacet"]);
  });

  test("empty facet value sets and empty id strings carry no scope", () => {
    const filters: Map<string, Set<string>> = facets({ traceId: [] });

    const result: LogsPivotScopeResult = Pivot.buildLogsPivotScope(
      input({
        serviceIds: [""],
        appliedFacetFilters: filters,
      }),
    );

    expect(result.scope.serviceIds).toBeUndefined();
    expect(result.scope.traceIds).toBeUndefined();
    expect(result.dropped).toEqual([]);
  });
});

describe("traces pivot round-trip (buildLogsPivotScope -> toTracesExplorerQueryParams)", () => {
  test("carries services as filter chips, ids as search tokens, and the window as a Custom range", () => {
    const result: CrossSignalParams = tracesPivot(
      input({
        serviceIds: ["svc-1"],
        traceIds: ["trace-1"],
        spanIds: ["span-1"],
        attributes: { "http.method": "GET" },
      }),
    );

    expect(result.params["search"]).toBe(
      "@http.method:GET trace:trace-1 span:span-1",
    );

    const filterTuples: Array<[string, string]> = JSON.parse(
      result.params["filters"] as string,
    );
    expect(filterTuples).toEqual([["primaryEntityId", "svc-1"]]);

    expect(result.params["range"]).toBe(TimeRange.CUSTOM);
    expect(result.params["start"]).toBe(WINDOW_START.toISOString());
    expect(result.params["end"]).toBe(WINDOW_END.toISOString());
    expect(result.dropped).toEqual([]);
  });

  test("merges local drops (sessions) with serializer drops (severity), deduped", () => {
    const result: CrossSignalParams = tracesPivot(
      input({
        sessionIds: ["sess-1"],
        appliedFacetFilters: facets({ severityText: ["Error"] }),
      }),
    );

    expect(result.dropped).toEqual(["sessionIds", "severityTexts"]);
  });
});

describe("metrics pivot round-trip (buildLogsPivotScope -> toMetricsExplorerQueryParams)", () => {
  test("carries attributes and the absolute window; reports every inexpressible field", () => {
    const result: CrossSignalParams = metricsPivot(
      input({
        serviceIds: ["svc-1"],
        traceIds: ["trace-1"],
        spanIds: ["span-1"],
        sessionIds: ["sess-1"],
        attributes: { "http.method": "GET" },
        appliedFacetFilters: facets({ severityText: ["Error"] }),
      }),
    );

    const metricQueries: Array<{
      metricName: string;
      attributes: Record<string, string>;
    }> = JSON.parse(result.params["metricQueries"] as string);
    expect(metricQueries).toHaveLength(1);
    expect(metricQueries[0]!.attributes).toEqual({ "http.method": "GET" });

    expect(result.params["startTime"]).toBe(WINDOW_START.toISOString());
    expect(result.params["endTime"]).toBe(WINDOW_END.toISOString());

    expect(new Set(result.dropped)).toEqual(
      new Set([
        "sessionIds",
        "serviceIds",
        "traceIds",
        "spanIds",
        "severityTexts",
      ]),
    );
  });

  test("no attributes means no metricQueries param — the window alone still pivots", () => {
    const result: CrossSignalParams = metricsPivot(input());

    expect(result.params["metricQueries"]).toBeUndefined();
    expect(result.params["startTime"]).toBe(WINDOW_START.toISOString());
    expect(result.params["endTime"]).toBe(WINDOW_END.toISOString());
    expect(result.dropped).toEqual([]);
  });
});

describe("mergeDroppedScopeFields", () => {
  test("unions in order with first occurrence winning", () => {
    expect(
      Pivot.mergeDroppedScopeFields(
        ["sessionIds", "severityTexts"],
        ["severityTexts", "serviceIds"],
      ),
    ).toEqual(["sessionIds", "severityTexts", "serviceIds"]);
  });

  test("empty inputs yield an empty list", () => {
    expect(Pivot.mergeDroppedScopeFields([], [])).toEqual([]);
  });
});

describe("formatDroppedScopeHint", () => {
  test("nothing dropped means no hint", () => {
    expect(Pivot.formatDroppedScopeHint([])).toBe("");
  });

  test("maps field names to human labels", () => {
    expect(
      Pivot.formatDroppedScopeHint([
        "serviceIds",
        "traceIds",
        "spanIds",
        "severityTexts",
        "sessionIds",
      ]),
    ).toBe("Not carried over: services, traces, spans, severity, sessions");
  });

  test("labels attribute facet keys by their attribute name", () => {
    expect(Pivot.formatDroppedScopeHint(["attributes.http.method"])).toBe(
      "Not carried over: attribute http.method",
    );
  });

  test("unknown fields pass through verbatim and duplicates collapse", () => {
    expect(
      Pivot.formatDroppedScopeHint(["mystery", "mystery", "sessionIds"]),
    ).toBe("Not carried over: mystery, sessions");
  });
});

describe("applyLogsSessionScopeToQuery", () => {
  test("compiles session ids to an Includes on query.sessionId, exactly like traceIds", () => {
    const query: Record<string, unknown> = {};

    const returned: Record<string, unknown> =
      Pivot.applyLogsSessionScopeToQuery(
        query as Parameters<typeof Pivot.applyLogsSessionScopeToQuery>[0],
        ["sess-1", "sess-2"],
      ) as unknown as Record<string, unknown>;

    expect(returned).toBe(query);
    expect(query["sessionId"]).toBeInstanceOf(Includes);
    expect(
      (query["sessionId"] as InstanceType<typeof Includes>).values,
    ).toEqual(["sess-1", "sess-2"]);
  });

  test("an empty list is a no-op", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsSessionScopeToQuery(
      query as Parameters<typeof Pivot.applyLogsSessionScopeToQuery>[0],
      [],
    );

    expect("sessionId" in query).toBe(false);
  });

  test("undefined is a no-op", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsSessionScopeToQuery(
      query as Parameters<typeof Pivot.applyLogsSessionScopeToQuery>[0],
      undefined,
    );

    expect("sessionId" in query).toBe(false);
  });
});

describe("extractTraceIdFromSpans", () => {
  test("empty result yields null", () => {
    expect(Pivot.extractTraceIdFromSpans([])).toBeNull();
  });

  test("returns the first non-empty trace id, skipping spans without one", () => {
    const spanWithoutTrace: InstanceType<typeof Span> = new Span();
    const spanWithTrace: InstanceType<typeof Span> = new Span();
    spanWithTrace.traceId = "trace-xyz";

    expect(
      Pivot.extractTraceIdFromSpans([spanWithoutTrace, spanWithTrace]),
    ).toBe("trace-xyz");
  });
});

describe("extractRumApplicationIdFromRumSessions", () => {
  test("empty result yields null", () => {
    expect(Pivot.extractRumApplicationIdFromRumSessions([])).toBeNull();
  });

  test("returns the first non-empty rum application id", () => {
    const sessionWithoutApp: InstanceType<typeof RumSession> = new RumSession();
    const sessionWithApp: InstanceType<typeof RumSession> = new RumSession();
    sessionWithApp.rumApplicationId = new ObjectID(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(
      Pivot.extractRumApplicationIdFromRumSessions([
        sessionWithoutApp,
        sessionWithApp,
      ]),
    ).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("buildTraceViewRoute", () => {
  test("routes to the trace view for the given trace id", () => {
    const route: string = Pivot.buildTraceViewRoute("trace-abc").toString();

    expect(route).toContain("/traces/view/trace-abc");
    expect(route).not.toContain("?");
  });

  test("deep-links one span via the spanId query param", () => {
    const route: string = Pivot.buildTraceViewRoute(
      "trace-abc",
      "span-def",
    ).toString();

    expect(route).toContain("/traces/view/trace-abc");
    expect(route).toContain("spanId=span-def");
  });
});

describe("buildSpanChipOpenRoute", () => {
  test("links out when the surrounding view is scoped to exactly one trace", () => {
    const route: string | undefined = Pivot.buildSpanChipOpenRoute("span-1", [
      "trace-1",
    ])?.toString();

    expect(route).toBeDefined();
    expect(route).toContain("/traces/view/trace-1");
    expect(route).toContain("spanId=span-1");
  });

  test("duplicate mentions of the same trace still count as one", () => {
    expect(
      Pivot.buildSpanChipOpenRoute("span-1", ["trace-1", "trace-1"]),
    ).toBeDefined();
  });

  test("no candidate traces means no destination", () => {
    expect(Pivot.buildSpanChipOpenRoute("span-1", undefined)).toBeUndefined();
    expect(Pivot.buildSpanChipOpenRoute("span-1", [])).toBeUndefined();
  });

  test("an ambiguous trace scope means no destination", () => {
    expect(
      Pivot.buildSpanChipOpenRoute("span-1", ["trace-1", "trace-2"]),
    ).toBeUndefined();
  });

  test("an empty span id means no destination", () => {
    expect(Pivot.buildSpanChipOpenRoute("", ["trace-1"])).toBeUndefined();
  });
});

describe("buildSessionReplayRoute", () => {
  test("routes to the replay player for the application + session", () => {
    const route: string = Pivot.buildSessionReplayRoute(
      "app-1",
      "sess-1",
    ).toString();

    expect(route).toContain("/rum/app-1/session-replay/sess-1");
  });
});

/*
 * applyLogsFacetFiltersToQuery is the single compilation from facet chips to
 * list-query predicates. The viewer routes BOTH the user-interaction path
 * (rebuildFilterOptionsFromFacets) and URL hydration (the filterOptions
 * initializer + the props-sync effect) through it — that shared path is what
 * makes a filter-carrying deep link filter the list the same way it filters
 * the chips and histogram.
 */
describe("applyLogsFacetFiltersToQuery", () => {
  test("compiles a single value to equality and multiple values to Includes, returning the same query object", () => {
    const query: Record<string, unknown> = {};

    const returned: Record<string, unknown> =
      Pivot.applyLogsFacetFiltersToQuery(
        query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
        facets({
          traceId: ["trace-1"],
          severityText: ["Error", "Fatal"],
        }),
      ) as unknown as Record<string, unknown>;

    expect(returned).toBe(query);
    expect(query["traceId"]).toBe("trace-1");
    expect(query["severityText"]).toBeInstanceOf(Includes);
    expect(
      (query["severityText"] as InstanceType<typeof Includes>).values,
    ).toEqual(["Error", "Fatal"]);
  });

  test("routes Service ids to primaryEntityId and resources to resourceFilters", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({
        primaryEntityId: ["svc-1"],
        hostId: ["host-1"],
        dockerHostId: ["docker-1"],
      }),
    );

    // Never a bare column predicate — neither key is a column on Log.
    expect(query["hostId"]).toBeUndefined();
    expect(query["dockerHostId"]).toBeUndefined();

    expect(query["primaryEntityId"]).toBe("svc-1");
    expect(query["resourceFilters"]).toEqual({
      hostId: ["host-1"],
      dockerHostId: ["docker-1"],
    });
  });

  test("a cluster chip alone leaves primaryEntityId unconstrained", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({ kubernetesClusterId: ["k8s-1"] }),
    );

    /*
     * `primaryEntityId = '<clusterId>'` is exactly the predicate that
     * returned zero rows for collector-ingested logs. The cluster now rides
     * resourceFilters and the server resolves it to the cluster's entity
     * key.
     */
    expect(query["primaryEntityId"]).toBeUndefined();
    expect(query["resourceFilters"]).toEqual({
      kubernetesClusterId: ["k8s-1"],
    });
  });

  test("multi-valued resource selections stay inside their facet", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({ kubernetesClusterId: ["k8s-1", "k8s-2"] }),
    );

    expect(query["resourceFilters"]).toEqual({
      kubernetesClusterId: ["k8s-1", "k8s-2"],
    });
  });

  test("the Services facet still compiles to Includes for multiple values", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({ primaryEntityId: ["svc-1", "svc-2"] }),
    );

    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(
      (query["primaryEntityId"] as InstanceType<typeof Includes>).values,
    ).toEqual(["svc-1", "svc-2"]);
  });

  test("a single resource selection compiles to direct equality", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({ primaryEntityId: ["svc-1"] }),
    );

    expect(query["primaryEntityId"]).toBe("svc-1");
  });

  test("attributes.* facets land under query.attributes and merge with existing entries", () => {
    const query: Record<string, unknown> = {
      attributes: { existing: "kept" },
    };

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({
        "attributes.http.method": ["GET"],
        "attributes.k8s.pod.name": ["pod-a", "pod-b"],
      }),
    );

    const attributes: Record<string, unknown> = query["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["existing"]).toBe("kept");
    expect(attributes["http.method"]).toBe("GET");
    expect(attributes["k8s.pod.name"]).toBeInstanceOf(Includes);
    expect(
      (attributes["k8s.pod.name"] as InstanceType<typeof Includes>).values,
    ).toEqual(["pod-a", "pod-b"]);
  });

  test("empty value sets compile no predicates and never touch the query", () => {
    const query: Record<string, unknown> = {};

    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facets({
        traceId: [],
        primaryEntityId: [],
        kubernetesClusterId: [],
      }),
    );

    expect(Object.keys(query)).toEqual([]);
  });

  test("the serializer's `filters` param round-trips into the same list-query predicates the chip handlers produce", () => {
    /*
     * Emitter side: exactly what every filter-carrying deep link into /logs
     * (cross-signal pivots, AI-insight links, exception occurrence links)
     * puts in the URL.
     */
    const serialized: CrossSignalParams = toLogsExplorerQueryParams({
      serviceIds: ["svc-1"],
      severityTexts: ["error"],
      traceIds: ["trace-1"],
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    // Consumer side: the same tuple parse readInitialUrlState performs.
    const tuples: Array<[string, Array<string>]> = JSON.parse(
      serialized.params["filters"] as string,
    );
    const facetFilters: Map<string, Set<string>> = new Map(
      tuples.map(
        ([key, values]: [string, Array<string>]): [string, Set<string>] => {
          return [key, new Set(values)];
        },
      ),
    );

    const query: Record<string, unknown> = {};
    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facetFilters,
    );

    expect(query["severityText"]).toBe("Error");
    expect(query["primaryEntityId"]).toBe("svc-1");
    expect(query["traceId"]).toBe("trace-1");
  });

  test("a cluster survives the full pivot -> URL -> list-query round trip", () => {
    /*
     * End to end for the reported scenario: a Kubernetes cluster selected in
     * one explorer, carried through a deep link, and compiled back into a
     * list query. It must come out as a resourceFilters entry at every hop —
     * the moment it degrades to a `primaryEntityId` value it stops matching
     * collector-ingested telemetry.
     */
    const serialized: CrossSignalParams = toLogsExplorerQueryParams({
      serviceIds: ["svc-1"],
      resourceFacetSelections: { kubernetesClusterId: ["k8s-1"] },
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const tuples: Array<[string, Array<string>]> = JSON.parse(
      serialized.params["filters"] as string,
    );

    expect(tuples).toContainEqual(["kubernetesClusterId", ["k8s-1"]]);

    const facetFilters: Map<string, Set<string>> = new Map(
      tuples.map(
        ([key, values]: [string, Array<string>]): [string, Set<string>] => {
          return [key, new Set(values)];
        },
      ),
    );

    const query: Record<string, unknown> = {};
    Pivot.applyLogsFacetFiltersToQuery(
      query as Parameters<typeof Pivot.applyLogsFacetFiltersToQuery>[0],
      facetFilters,
    );

    expect(query["primaryEntityId"]).toBe("svc-1");
    expect(query["resourceFilters"]).toEqual({
      kubernetesClusterId: ["k8s-1"],
    });
  });
});

/*
 * The App suite has no renderer, so the container-side wiring is pinned by
 * reading the source — the same approach as SavedViewFilterTupleWiring
 * .test.ts. Each assertion here failed on a real defect:
 *
 *  - the Metrics pivot once targeted PageMap.METRICS (the metrics LIST
 *    page), which parses none of the metricQueries/startTime/endTime params
 *    the pivot emits — only METRIC_VIEW (the metric explorer) does;
 *  - URL-hydrated facet filters once seeded only the chips/histogram while
 *    the list query was built from props+time alone, so deep links showed a
 *    scoped-looking page over an unfiltered list;
 *  - the adopt-override effect once listed disableLiveMode in its deps, so
 *    every live-mode toggle re-ran adoption against an unchanged override
 *    and yanked a hand-picked saved view's window back to the host cursor.
 */
describe("LogsViewer wiring (source-pinned)", () => {
  const logsViewerCode: string = ((): string => {
    const absolutePath: string = path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Components",
      "Logs",
      "LogsViewer.tsx",
    );
    const raw: string = fs.readFileSync(absolutePath, "utf8");
    const withoutComments: string = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ");
    return withoutComments.replace(/\s+/g, " ");
  })();

  test("the Metrics pivot targets METRIC_VIEW — the only page that parses the metric-explorer param grammar", () => {
    expect(logsViewerCode).toContain(
      "navigateToExplorer(PageMap.METRIC_VIEW, buildMetricsPivot().params)",
    );
    expect(logsViewerCode).not.toContain("navigateToExplorer(PageMap.METRICS,");
  });

  test("the Traces pivot still targets the traces explorer", () => {
    expect(logsViewerCode).toContain(
      "navigateToExplorer(PageMap.TRACES, buildTracesPivot().params)",
    );
  });

  test("URL-hydrated facet filters are compiled into the initial list query", () => {
    expect(logsViewerCode).toMatch(
      /return applyLogsFacetFiltersToQuery\(\s*base,\s*initialUrlState\?\.facetFilters \|\| new Map\(\),?\s*\)/,
    );
  });

  test("the props-sync effect keeps the applied chips compiled into the rebuilt list query", () => {
    expect(logsViewerCode).toMatch(
      /setFilterOptions\(\s*applyLogsFacetFiltersToQuery\(\s*base,\s*appliedFacetFilters,?\s*\),?\s*\)/,
    );
  });

  test("the chip-interaction rebuild routes through the same shared compilation", () => {
    expect(logsViewerCode).toMatch(
      /return applyLogsFacetFiltersToQuery\(\s*updatedFilter,\s*facets,?\s*\)/,
    );
  });

  test("the adopt-override effect is keyed on the override value alone and tears live mode down inline", () => {
    const adoptEffectMatch: RegExpMatchArray | null = logsViewerCode.match(
      /useEffect\(\(\) => \{\s*if \(\s*!shouldAdoptTimeRangeOverride\([\s\S]*?\}, \[props\.timeRangeOverride\]\);/,
    );

    expect(adoptEffectMatch).not.toBeNull();

    const adoptEffectCode: string = adoptEffectMatch![0] as string;
    expect(adoptEffectCode).not.toContain("disableLiveMode");
    expect(adoptEffectCode).toContain("setIsLiveEnabled(false)");
    expect(adoptEffectCode).toContain("setIsLiveUpdating(false)");

    expect(logsViewerCode).not.toContain(
      "[props.timeRangeOverride, disableLiveMode]",
    );
  });
});
