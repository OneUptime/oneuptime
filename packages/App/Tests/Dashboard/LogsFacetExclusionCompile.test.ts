import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotWildcard from "Common/Types/BaseDatabase/NotWildcard";
import Search from "Common/Types/BaseDatabase/Search";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import Log from "Common/Models/AnalyticsModels/Log";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  applyTypedLogFilterToRequest,
  buildLogsHistogramRequest,
  getLogsChosenFacetKeys,
  pickTypedLogFilter,
  withoutLogsFacetSelection,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsHistogramRequest";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";

/*
 * These modules reach the Dashboard's route map, whose config reads
 * `window` at load: they are loaded once a stand-in window is in place, as
 * the other logs suites that run in node load them
 * (LogsSavedViewOverrideMerge).
 */
type FacetFiltersModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters");
type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");
type MergeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge");
type EntityChipModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Logs/LogsEntityChipDisplay");

let FacetFilters: FacetFiltersModule;
let Pivot: PivotModule;
let Merge: MergeModule;
let EntityChips: EntityChipModule;

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

  FacetFilters = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters"
  );
  Pivot = await import(
    "../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );
  Merge = await import(
    "../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge"
  );
  EntityChips = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/LogsEntityChipDisplay"
  );
});

/*
 * "Is not" in the logs explorer: a facet row's minus leaves its value out,
 * as a chip keyed `!` ("Severity is not debug").
 *
 * The logs explorer had no exclude at all: the list could leave a value
 * out, but the chart and the facet counts beside it are read through
 * endpoints that took only values to keep, so an exclusion would have drawn
 * bars and counts for rows the list no longer showed. These pin the one
 * compilation every read is built from - the list query, the chart and
 * facet requests (read off that query), the saved view and the address -
 * so all of them leave out exactly the same rows.
 */

const CHECKOUT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BILLING_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";
const CLUSTER_ID: string = "8c0f2f1e-2e4f-4a8c-9a1a-2f5b6c7d8e9f";

const NOW: Date = new Date("2026-08-05T12:00:00.000Z");

const PAST_ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

function facets(
  entries: Record<string, Array<string>>,
): Map<string, Set<string>> {
  const map: Map<string, Set<string>> = new Map();

  for (const [key, values] of Object.entries(entries)) {
    map.set(key, new Set(values));
  }

  return map;
}

function compile(
  entries: Record<string, Array<string>>,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  return Pivot.applyLogsFacetFiltersToQuery(
    { ...base } as unknown as Query<Log>,
    facets(entries),
  ) as unknown as Record<string, unknown>;
}

function values(value: unknown): Array<string> {
  if (value instanceof IncludesNone || value instanceof Includes) {
    return value.values.map((item: unknown): string => {
      return String(item);
    });
  }

  if (value instanceof NotEqual) {
    return [String(value.value)];
  }

  return [];
}

describe("the list query leaves the values out", () => {
  test("one severity is a plain !=, several one NOT IN", () => {
    const one: Record<string, unknown> = compile({
      "!severityText": ["Debug"],
    });

    expect(one["severityText"]).toBeInstanceOf(NotEqual);
    expect(values(one["severityText"])).toEqual(["Debug"]);

    const several: Record<string, unknown> = compile({
      "!severityText": ["Debug", "Trace"],
    });

    expect(several["severityText"]).toBeInstanceOf(IncludesNone);
    expect(values(several["severityText"])).toEqual(["Debug", "Trace"]);
  });

  test("a service left out under either of its names leaves out its rows", () => {
    const query: Record<string, unknown> = compile({
      "!primaryEntityId": [CHECKOUT_ID],
      "!serviceId": [BILLING_ID],
    });

    expect(query["primaryEntityId"]).toBeInstanceOf(IncludesNone);
    expect(values(query["primaryEntityId"])).toEqual([CHECKOUT_ID, BILLING_ID]);
    expect(query["!primaryEntityId"]).toBeUndefined();
    expect(query["!serviceId"]).toBeUndefined();
  });

  test("a resource left out rides excludedResourceFilters, beside one kept", () => {
    const query: Record<string, unknown> = compile({
      kubernetesClusterId: [CLUSTER_ID],
      "!hostId": [HOST_ID],
    });

    expect(query["resourceFilters"]).toEqual({
      kubernetesClusterId: [CLUSTER_ID],
    });
    expect(query["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });
    expect(query["!hostId"]).toBeUndefined();
  });

  test("a value left out beside kept values of the same column is dropped: a log has one severity", () => {
    const query: Record<string, unknown> = compile({
      severityText: ["Error"],
      "!severityText": ["Debug"],
    });

    expect(query["severityText"]).toBe("Error");
  });

  test("the page's own service scope counts as kept, as a chip's does", () => {
    const query: Record<string, unknown> = compile(
      { "!primaryEntityId": [BILLING_ID] },
      { primaryEntityId: new Includes([CHECKOUT_ID]) },
    );

    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(values(query["primaryEntityId"])).toEqual([CHECKOUT_ID]);
  });

  test("a message left out is a does-not-contain", () => {
    const query: Record<string, unknown> = compile({
      "!body": ["health check"],
    });

    expect(query["body"]).toBeInstanceOf(NotContains);
    expect(String(query["body"])).toBe("health check");
  });

  test("an attribute left out is a != on the attribute, literals a NOT IN, patterns negated", () => {
    const literal: Record<string, unknown> = compile({
      "!attributes.http.method": [buildSearchTokenValue("GET")],
    });

    expect(
      (literal["attributes"] as Record<string, unknown>)["http.method"],
    ).toBeInstanceOf(NotEqual);

    const pattern: Record<string, unknown> = compile({
      "!attributes.http.route": ["/api/*"],
    });

    expect(
      (pattern["attributes"] as Record<string, unknown>)["http.route"],
    ).toBeInstanceOf(NotWildcard);
  });

  test("never writes into the page's own attributes object", () => {
    const pageAttributes: Record<string, unknown> = { team: "payments" };
    const query: Record<string, unknown> = compile(
      { "!attributes.http.method": ["GET"] },
      { attributes: pageAttributes },
    );

    expect(pageAttributes).toEqual({ team: "payments" });
    expect(query["attributes"]).not.toBe(pageAttributes);
  });

  test("re-compiling without the chip leaves no stale exclusion behind", () => {
    const query: Record<string, unknown> = Pivot.applyLogsFacetFiltersToQuery(
      {
        excludedResourceFilters: { hostId: [HOST_ID] },
      } as unknown as Query<Log>,
      facets({ severityText: ["Error"] }),
    ) as unknown as Record<string, unknown>;

    expect(query["excludedResourceFilters"]).toBeUndefined();
  });
});

describe("the chart and the facet requests follow the list", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        "performance",
        "hrtime",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("the chart request carries what the chips leave out", () => {
    const request: JSONObject = buildLogsHistogramRequest({
      timeRange: PAST_ONE_HOUR,
      appliedFacetFilters: facets({
        "!severityText": ["Debug"],
        "!primaryEntityId": [CHECKOUT_ID],
        "!hostId": [HOST_ID],
      }),
    });

    expect(request["excludedSeverityTexts"]).toEqual(["Debug"]);
    expect(request["excludedServiceIds"]).toEqual([CHECKOUT_ID]);
    expect(request["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });
    expect(request["severityTexts"]).toBeUndefined();
  });

  test("the page's services stay kept, and a service left out beside them is dropped", () => {
    const request: JSONObject = buildLogsHistogramRequest({
      timeRange: PAST_ONE_HOUR,
      serviceIds: [CHECKOUT_ID],
      appliedFacetFilters: facets({ "!primaryEntityId": [BILLING_ID] }),
    });

    expect(request["serviceIds"]).toEqual([CHECKOUT_ID]);
    expect(request["excludedServiceIds"]).toBeUndefined();
  });

  test("the facet requests read the exclusions off the list query", () => {
    const listQuery: Record<string, unknown> = compile({
      "!severityText": ["Debug", "Trace"],
      "!primaryEntityId": [CHECKOUT_ID],
      "!hostId": [HOST_ID],
    });
    const request: JSONObject = applyTypedLogFilterToRequest(
      {},
      pickTypedLogFilter(listQuery),
    );

    expect(request["excludedSeverityTexts"]).toEqual(["Debug", "Trace"]);
    expect(request["excludedServiceIds"]).toEqual([CHECKOUT_ID]);
    expect(request["excludedResourceFilters"]).toEqual({ hostId: [HOST_ID] });
  });

  test("a typed `severity:error` over a chip that leaves debug out replaces it, as in the list", () => {
    const request: JSONObject = applyTypedLogFilterToRequest(
      { excludedSeverityTexts: ["Debug"] },
      { severityText: "Error" },
    );

    expect(request["severityTexts"]).toEqual(["Error"]);
    expect(request["excludedSeverityTexts"]).toBeUndefined();
  });

  test("a typed `-severity:debug` reaches the chart now: the endpoint can leave it out", () => {
    const request: JSONObject = applyTypedLogFilterToRequest(
      { severityTexts: ["Error"] },
      { severityText: new NotEqual("Debug") },
    );

    expect(request["excludedSeverityTexts"]).toEqual(["Debug"]);
    expect(request["severityTexts"]).toBeUndefined();
  });

  test("a trace left out stays with the list: the endpoints have no field for it", () => {
    const request: JSONObject = applyTypedLogFilterToRequest(
      {},
      { traceId: new NotEqual("abc") },
    );

    expect(request).toEqual({});
  });

  test("a facet with a value left out is a choice: it is counted without it", () => {
    expect(
      getLogsChosenFacetKeys(
        facets({
          "!severityText": ["Debug"],
          "!serviceId": [CHECKOUT_ID],
          "!hostId": [HOST_ID],
        }),
      ).sort(),
    ).toEqual(["hostId", "primaryEntityId", "severityText"]);
  });

  test("counted without its own selection, a facet sheds what it leaves out too", () => {
    const listQuery: Record<string, unknown> = pickTypedLogFilter(
      compile({
        "!severityText": ["Debug"],
        "!hostId": [HOST_ID],
        "!kubernetesClusterId": [CLUSTER_ID],
        "!primaryEntityId": [CHECKOUT_ID],
      }),
    )!;

    expect(
      withoutLogsFacetSelection(listQuery, "severityText")!["severityText"],
    ).toBeUndefined();

    const withoutHosts: Record<string, unknown> = withoutLogsFacetSelection(
      listQuery,
      "hostId",
    )!;
    expect(withoutHosts["excludedResourceFilters"]).toEqual({
      kubernetesClusterId: [CLUSTER_ID],
    });

    const withoutServices: Record<string, unknown> = withoutLogsFacetSelection(
      listQuery,
      "primaryEntityId",
    )!;
    expect(withoutServices["primaryEntityId"]).toBeUndefined();
    expect(withoutServices["severityText"]).toBeInstanceOf(NotEqual);
  });
});

describe("a saved view and the address keep what is left out", () => {
  test("chips -> list query -> chips is a round trip", () => {
    const chips: Map<string, Set<string>> = facets({
      severityText: ["Error"],
      "!primaryEntityId": [CHECKOUT_ID, BILLING_ID],
      "!hostId": [HOST_ID],
      kubernetesClusterId: [CLUSTER_ID],
    });

    const query: Query<Log> = Pivot.applyLogsFacetFiltersToQuery(
      {} as Query<Log>,
      chips,
    );
    const readBack: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(query, {} as Query<Log>);

    expect(
      Object.fromEntries(
        Array.from(readBack.entries()).map(
          ([key, set]: [string, Set<string>]): [string, Array<string>] => {
            return [key, Array.from(set).sort()];
          },
        ),
      ),
    ).toEqual({
      severityText: ["Error"],
      "!primaryEntityId": [BILLING_ID, CHECKOUT_ID].sort(),
      "!hostId": [HOST_ID],
      kubernetesClusterId: [CLUSTER_ID],
    });
  });

  test("a stored NotEqual or IncludesNone reads back as the values left out", () => {
    expect(
      FacetFilters.getLogsQueryExcludedValues(new NotEqual("Debug")),
    ).toEqual(["Debug"]);
    expect(
      FacetFilters.getLogsQueryExcludedValues(
        new IncludesNone(["Debug", "Trace"]),
      ),
    ).toEqual(["Debug", "Trace"]);
    expect(
      FacetFilters.getLogsQueryExcludedValues(new Includes(["Error"])),
    ).toEqual([]);
    expect(FacetFilters.getLogsQueryExcludedValues("Error")).toEqual([]);
  });

  test("the page's own pins never come back as removable chips", () => {
    const readBack: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      {
        primaryEntityId: new NotEqual(CHECKOUT_ID),
        excludedResourceFilters: { hostId: [HOST_ID] },
      } as unknown as Query<Log>,
      {
        primaryEntityId: CHECKOUT_ID,
        hostId: HOST_ID,
      } as unknown as Query<Log>,
    );

    expect(readBack.size).toBe(0);
  });

  test("stripping a view for a new chip set takes its exclusions off too", () => {
    const stripped: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery: {
        severityText: new IncludesNone(["Debug"]),
        excludedResourceFilters: { hostId: [HOST_ID] },
      } as unknown as JSONObject,
      baseQuery: {},
    });

    expect(Merge.listRemovableChipKeys(stripped)).toEqual([]);
  });

  test("the removable keys of a query name the `!` chips that made them", () => {
    expect(
      Merge.listRemovableChipKeys({
        severityText: new NotEqual("Debug"),
        primaryEntityId: new Includes([CHECKOUT_ID]),
        body: new NotContains("health"),
        excludedResourceFilters: { hostId: [HOST_ID] },
      } as unknown as JSONObject).sort(),
    ).toEqual(["!body", "!hostId", "!severityText", "primaryEntityId"].sort());
  });
});

describe("a chip that leaves its value out is named like the one that keeps it", () => {
  test("its key reads as its facet's label", () => {
    expect(FacetFilters.getLogsFacetChipDisplayKey("!severityText")).toBe(
      "Severity",
    );
    expect(FacetFilters.getLogsFacetChipDisplayKey("!primaryEntityId")).toBe(
      "Service",
    );
    expect(
      FacetFilters.getLogsFacetChipDisplayKey("!attributes.http.method"),
    ).toBe("http.method");
    expect(FacetFilters.getLogsFacetChipDisplayKey("!body")).toBe(
      "Message contains",
    );
  });

  test("a service left out is looked up and named, its key kept", () => {
    const appliedFacetFilters: Map<string, Set<string>> = facets({
      "!primaryEntityId": [CHECKOUT_ID],
    });

    expect(EntityChips.collectLogsEntityIds({ appliedFacetFilters })).toEqual([
      CHECKOUT_ID,
    ]);

    const chips: Array<ActiveFilter> = EntityChips.applyLogsEntityChipDisplay(
      [
        {
          facetKey: "!primaryEntityId",
          value: CHECKOUT_ID,
          displayKey: "Service",
          displayValue: CHECKOUT_ID,
        },
      ],
      {
        nameMap: undefined,
        knownNames: { [CHECKOUT_ID]: "checkout" },
      },
    );

    expect(chips[0]!.facetKey).toBe("!primaryEntityId");
    expect(chips[0]!.displayValue).toBe("checkout");
  });
});

describe("a pivot never carries a value left out as one kept", () => {
  test("each exclusion is named as not carried over", () => {
    const result: { dropped: Array<string>; scope: Record<string, unknown> } =
      Pivot.buildLogsPivotScope({
        appliedFacetFilters: facets({
          "!severityText": ["Debug"],
          "!primaryEntityId": [CHECKOUT_ID],
          "!hostId": [HOST_ID],
          "!attributes.http.method": ["GET"],
        }),
        timeRange: PAST_ONE_HOUR,
      }) as unknown as {
        dropped: Array<string>;
        scope: Record<string, unknown>;
      };

    expect(result.scope["serviceIds"]).toBeUndefined();
    expect(result.scope["severityTexts"]).toBeUndefined();
    expect(result.scope["resourceFacetSelections"]).toBeUndefined();
    expect(result.scope["attributes"]).toBeUndefined();
    expect(result.dropped.sort()).toEqual(
      [
        "!severityText",
        "!primaryEntityId",
        "!hostId",
        "!attributes.http.method",
      ].sort(),
    );
  });

  test("and the hint reads what each leaves out", () => {
    expect(
      Pivot.formatDroppedScopeHint([
        "!severityText",
        "!primaryEntityId",
        "!hostId",
        "!attributes.http.method",
      ]),
    ).toBe(
      "Not carried over: excluded severity, excluded services, excluded hosts, excluded attribute http.method",
    );
  });

  test("a body search still reads as before", () => {
    expect(Pivot.formatDroppedScopeHint(["body"])).toBe(
      "Not carried over: message text",
    );
    expect(new Search("x")).toBeInstanceOf(Search);
  });
});
