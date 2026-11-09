import { beforeAll, describe, expect, jest, test } from "@jest/globals";

/*
 * The trace chip display reaches the entity name lookup, whose API module
 * reads the browser's config at load; nothing here looks a name up.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
  toMetricsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import {
  ParsedTraceSearch,
  TraceAttributeFilters,
  TraceExclusions,
  applyTraceExclusionsToPayload,
  applyTraceExclusionsToQuery,
  compileTraceAttributeFilters,
  getTypedTraceAttributeExclusionChips,
  getTypedTraceExclusionChips,
  parseTraceSearch,
  readTraceExclusions,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import {
  TracesPivotScopeResult,
  buildTracesPivotScope,
  describeDroppedScopeFields,
} from "../../FeatureSet/Dashboard/src/Utils/TraceCorrelatedSignals";
import { JSONObject } from "Common/Types/JSON";

/*
 * A pivot carries what the view LEAVES OUT ("Service is not checkout").
 *
 * The explorers' facet rows leave a value out as a chip keyed `!`
 * (FacetExcludeKey). A pivot from Logs to Traces, or back, used to drop
 * every one of them - CrossSignalScope had no field for "is not" - and say
 * so in its tooltip, so the target opened on more rows than the view
 * showed. These follow an exclusion the whole way: the source explorer's
 * chips, the scope the pivot builds, the address it writes, and the reading
 * the target explorer compiles its list and chart from - so the target
 * leaves out exactly what the source left out, and says plainly what it
 * cannot.
 */

type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");

let Pivot: PivotModule;

beforeAll(async () => {
  /*
   * The logs pivot module reaches the Dashboard's route map, whose config
   * reads `window` at load: loaded once a stand-in window is in place.
   */
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  Pivot = await import(
    "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );
});

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";

const START: Date = new Date("2026-08-05T11:00:00.000Z");
const END: Date = new Date("2026-08-05T12:00:00.000Z");

const NO_ATTRIBUTE_FACETS: ReadonlySet<string> = new Set<string>();

function facets(
  entries: Record<string, Array<string>>,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of Object.entries(entries)) {
    map.set(key, new Set(values));
  }

  return map;
}

// The Logs pivot of a view, as the toolbar builds it, over a fixed window.
function logsPivotScope(entries: Record<string, Array<string>>): {
  scope: TelemetryCrossSignalScope;
  dropped: Array<string>;
} {
  return Pivot.buildLogsPivotScope({
    appliedFacetFilters: facets(entries),
    timeRange: {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(START, END),
    },
  }) as unknown as { scope: TelemetryCrossSignalScope; dropped: Array<string> };
}

// The Traces explorer's chips, read back from the address a pivot wrote.
function tracesChipsOf(
  result: CrossSignalQueryParams,
): Array<{ facetKey: string; value: string }> {
  const pairs: Array<[string, string]> = JSON.parse(
    result.params["filters"] || "[]",
  ) as Array<[string, string]>;

  return pairs.map(
    ([facetKey, value]: [string, string]): {
      facetKey: string;
      value: string;
    } => {
      return { facetKey, value };
    },
  );
}

// The Logs explorer's chips, read back from the address a pivot wrote.
function logsChipsOf(result: CrossSignalQueryParams): Map<string, Set<string>> {
  const tuples: Array<[string, Array<string>]> = JSON.parse(
    result.params["filters"] || "[]",
  ) as Array<[string, Array<string>]>;
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of tuples) {
    map.set(key, new Set(values));
  }

  return map;
}

function tracesPivot(
  activeFilters: Array<{ facetKey: string; value: string }>,
  search: string = "",
): TracesPivotScopeResult {
  const parsed: ParsedTraceSearch = parseTraceSearch(search);

  // As TracesViewer's buildPivot hands its chips and typed search over.
  return buildTracesPivotScope({
    primaryEntityId: undefined,
    scopeAttributeFilters: undefined,
    activeFilters: [
      ...activeFilters,
      ...getTypedTraceAttributeExclusionChips(parsed),
      ...getTypedTraceExclusionChips(parsed),
    ],
    fieldFilters: parsed.fieldFilters,
    searchAttributes: {},
    searchAttributeSearches: {},
    freeText: parsed.freeText,
    rootOnly: false,
    hasEntityScope: false,
    startTime: START,
    endTime: END,
  });
}

describe("Logs to Traces keeps what the logs view leaves out", () => {
  const VIEW: Record<string, Array<string>> = {
    "!primaryEntityId": [CHECKOUT_ID],
    "!hostId": [HOST_ID],
    "!attributes.http.method": [buildSearchTokenValue("OPTIONS")],
  };

  test("the address holds the same `!` chips the traces explorer's minus writes", () => {
    const { scope, dropped } = logsPivotScope(VIEW);
    const result: CrossSignalQueryParams = toTracesExplorerQueryParams(scope);

    expect(dropped).toEqual([]);
    expect(tracesChipsOf(result)).toEqual([
      { facetKey: "!primaryEntityId", value: CHECKOUT_ID },
      { facetKey: "!hostId", value: HOST_ID },
      {
        facetKey: "!attributes.http.method",
        value: buildSearchTokenValue("OPTIONS"),
      },
    ]);
    // Nothing of it is left behind: the tooltip has nothing to name.
    expect(Pivot.formatDroppedScopeHint(result.dropped)).toBe("");
  });

  test("the traces list and chart leave out the service, the host and the attribute value", () => {
    const { scope } = logsPivotScope(VIEW);
    const chips: Array<{ facetKey: string; value: string }> = tracesChipsOf(
      toTracesExplorerQueryParams(scope),
    );
    const exclusions: TraceExclusions = readTraceExclusions({
      chips,
      attributeFacetKeys: NO_ATTRIBUTE_FACETS,
    });

    const query: Record<string, unknown> = {};
    applyTraceExclusionsToQuery(query, exclusions);

    expect(query["primaryEntityId"]).toBeInstanceOf(NotEqual);
    expect((query["primaryEntityId"] as NotEqual<string>).value).toBe(
      CHECKOUT_ID,
    );
    expect(query["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });

    const payload: JSONObject = {};
    applyTraceExclusionsToPayload(payload, exclusions);

    expect(payload["excludedServiceIds"]).toEqual([CHECKOUT_ID]);
    expect(payload["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });

    const attributes: TraceAttributeFilters = compileTraceAttributeFilters({
      chipValues: {},
      excludedChipValues: exclusions.attributeChipValues,
      parsed: [],
      legacyContainsChips: {},
      scope: {},
    });

    expect(attributes.queryAttributes["http.method"]).toBeInstanceOf(NotEqual);
    expect(
      (attributes.queryAttributes["http.method"] as NotEqual<string>).value,
    ).toBe("OPTIONS");
  });

  test("a severity left out has no span field: it is named, never carried as kept", () => {
    const { scope } = logsPivotScope({ "!severityText": ["Debug"] });
    const result: CrossSignalQueryParams = toTracesExplorerQueryParams(scope);

    expect(result.params["filters"]).toBeUndefined();
    expect(result.dropped).toEqual(["!severityTexts"]);
    expect(Pivot.formatDroppedScopeHint(result.dropped)).toBe(
      "Not carried over: excluded severity",
    );
  });

  test("a value kept beside one left out keeps both", () => {
    const { scope } = logsPivotScope({
      primaryEntityId: [CHECKOUT_ID],
      "!primaryEntityId": [BILLING_ID],
    });

    expect(tracesChipsOf(toTracesExplorerQueryParams(scope))).toEqual([
      { facetKey: "primaryEntityId", value: CHECKOUT_ID },
      { facetKey: "!primaryEntityId", value: BILLING_ID },
    ]);
  });
});

describe("Traces to Logs keeps what the traces view leaves out", () => {
  test("a service, a host and an attribute value left out open the logs explorer left out", () => {
    const pivot: TracesPivotScopeResult = tracesPivot([
      { facetKey: "!primaryEntityId", value: CHECKOUT_ID },
      { facetKey: "!hostId", value: HOST_ID },
      { facetKey: "!attributes.resource.host.name", value: "web-01" },
    ]);
    const result: CrossSignalQueryParams = toLogsExplorerQueryParams(
      pivot.scope,
    );

    expect(pivot.notCarried).toEqual([]);
    expect(result.dropped).toEqual([]);

    // What the logs explorer's list is read with, from that address.
    const query: Record<string, unknown> = Pivot.applyLogsFacetFiltersToQuery(
      {} as Query<Log>,
      logsChipsOf(result),
    ) as unknown as Record<string, unknown>;

    expect((query["primaryEntityId"] as NotEqual<string>).value).toBe(
      CHECKOUT_ID,
    );
    expect(query["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });
    expect(
      (
        (query["attributes"] as Record<string, unknown>)[
          "resource.host.name"
        ] as NotEqual<string>
      ).value,
    ).toBe("web-01");
  });

  test("typed `-@key:value` left out travels too; typed `-status:error` is named", () => {
    const pivot: TracesPivotScopeResult = tracesPivot(
      [],
      "-@http.route:(/health OR /ready) -status:error",
    );

    expect(pivot.scope.excludedAttributes).toEqual({
      "http.route": ["/health", "/ready"],
    });
    expect(pivot.notCarried).toEqual(["excluded values"]);

    const query: Record<string, unknown> = Pivot.applyLogsFacetFiltersToQuery(
      {} as Query<Log>,
      logsChipsOf(toLogsExplorerQueryParams(pivot.scope)),
    ) as unknown as Record<string, unknown>;
    const route: unknown = (query["attributes"] as Record<string, unknown>)[
      "http.route"
    ];

    expect(route).toBeInstanceOf(IncludesNone);
    expect((route as IncludesNone).values).toEqual(["/health", "/ready"]);
  });

  test("a status or kind left out has no field in the logs: named, and nothing narrows or widens in its place", () => {
    const pivot: TracesPivotScopeResult = tracesPivot([
      { facetKey: "!statusCode", value: String(SpanStatus.Error) },
      { facetKey: "!kind", value: "SPAN_KIND_CLIENT" },
    ]);

    expect(pivot.notCarried).toEqual(["excluded values"]);
    expect(toLogsExplorerQueryParams(pivot.scope).params["filters"]).toBe(
      undefined,
    );
  });
});

describe("the metric explorer has no 'is not', and says so", () => {
  test("from Logs: each value left out is named as not carried over", () => {
    const { scope } = logsPivotScope({
      "!primaryEntityId": [CHECKOUT_ID],
      "!hostId": [HOST_ID],
      "!attributes.http.method": [buildSearchTokenValue("OPTIONS")],
      "!severityText": ["Debug"],
    });
    const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(scope);

    expect(result.params["services"]).toBeUndefined();
    expect(Pivot.formatDroppedScopeHint(result.dropped)).toBe(
      "Not carried over: excluded services, excluded hosts, excluded attribute http.method, excluded severity",
    );
  });

  test("from Traces: they read as the excluded values a status left out reads as", () => {
    const pivot: TracesPivotScopeResult = tracesPivot([
      { facetKey: "!primaryEntityId", value: CHECKOUT_ID },
      { facetKey: "!hostId", value: HOST_ID },
    ]);
    const result: CrossSignalQueryParams = toMetricsExplorerQueryParams(
      pivot.scope,
    );

    expect(result.dropped).toEqual(["!serviceIds", "!hostId"]);
    expect(describeDroppedScopeFields(result.dropped)).toEqual([
      "excluded values",
    ]);
    // The kept fields keep their own words.
    expect(describeDroppedScopeFields(["traceIds", "!serviceIds"])).toEqual([
      "trace ids",
      "excluded values",
    ]);
  });
});
