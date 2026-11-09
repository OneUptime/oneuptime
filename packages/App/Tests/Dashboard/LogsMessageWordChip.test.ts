import { beforeAll, describe, expect, test } from "@jest/globals";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import { JSONObject } from "Common/Types/JSON";
import Log from "Common/Models/AnalyticsModels/Log";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import {
  applyTypedLogFilterToRequest,
  buildLogsHistogramRequest,
  pickTypedLogFilter,
} from "../../FeatureSet/Dashboard/src/Components/Logs/LogsHistogramRequest";

/*
 * "Word in message" in the logs explorer: a chip whose words the message
 * holds WHOLE (Common/Utils/Telemetry/LogMessageWord), the reading
 * Connected Signals counts a value In the message by. Its link used to open
 * a "Message contains" search, which listed lines the count never counted
 * (10.0.0.12 beside 10.0.0.1). These pin the chip the whole way through the
 * explorer: the list query, the requests read off it, the address, a saved
 * view, the pivots and the Insights tabs.
 */

type PivotModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");
type FacetFiltersModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters");
type MergeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge");
type TabScopeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope");

let Pivot: PivotModule;
let FacetFilters: FacetFiltersModule;
let Merge: MergeModule;
let TabScope: TabScopeModule;

beforeAll(async () => {
  /*
   * These modules reach the Dashboard's route map, whose config reads
   * `window` at load: loaded once a stand-in window is in place.
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
  FacetFilters = await import(
    "../../FeatureSet/Dashboard/src/Components/Logs/LogsFacetFilters"
  );
  Merge = await import(
    "../../FeatureSet/Dashboard/src/Utils/SavedViewQueryMerge"
  );
  TabScope = await import(
    "../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope"
  );
});

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

describe("the list query holds the chip's words under keys of their own", () => {
  test("a word kept and a word left out", () => {
    const query: Record<string, unknown> = compile({
      bodyWord: ["10.0.0.1", " Cart "],
      "!bodyWord": ["healthcheck"],
    });

    expect(query["bodyWords"]).toEqual(["10.0.0.1", "Cart"]);
    expect(query["excludedBodyWords"]).toEqual(["healthcheck"]);
    // Never a column the server would refuse.
    expect(query["bodyWord"]).toBeUndefined();
    expect(query["!bodyWord"]).toBeUndefined();
  });

  test("beside a Message contains search, both hold", () => {
    const query: Record<string, unknown> = compile({
      body: ["refused"],
      bodyWord: ["10.0.0.1"],
    });

    expect(query["body"]).toBeInstanceOf(Search);
    expect(query["bodyWords"]).toEqual(["10.0.0.1"]);
  });

  test("a chip set that drops the words leaves none behind", () => {
    const stale: Record<string, unknown> = compile(
      { severityText: ["Error"] },
      { bodyWords: ["10.0.0.1"], excludedBodyWords: ["x"] },
    );

    expect(stale["bodyWords"]).toBeUndefined();
    expect(stale["excludedBodyWords"]).toBeUndefined();
    expect(stale["severityText"]).toBe("Error");
  });

  test("a chip of blanks filters nothing", () => {
    const query: Record<string, unknown> = compile({ bodyWord: ["", "  "] });

    expect(query["bodyWords"]).toBeUndefined();
  });
});

describe("the chart and the facet counts read the words off the list query", () => {
  test("the typed filter carries them into a request, and takes stale ones away", () => {
    const request: JSONObject = { bodyWords: ["stale"] };

    applyTypedLogFilterToRequest(request, {
      bodyWords: ["10.0.0.1"],
      excludedBodyWords: ["healthcheck"],
    });

    expect(request["bodyWords"]).toEqual(["10.0.0.1"]);
    expect(request["excludedBodyWords"]).toEqual(["healthcheck"]);

    applyTypedLogFilterToRequest(request, {});

    expect(request["bodyWords"]).toBeUndefined();
    expect(request["excludedBodyWords"]).toBeUndefined();
  });

  test("the histogram request built from the view holds them", () => {
    const listQuery: Record<string, unknown> = compile({
      bodyWord: ["10.0.0.1"],
    });
    const request: JSONObject = buildLogsHistogramRequest({
      timeRange: PAST_ONE_HOUR,
      appliedFacetFilters: facets({ bodyWord: ["10.0.0.1"] }),
      typedFilter: pickTypedLogFilter(listQuery),
    });

    expect(request["bodyWords"]).toEqual(["10.0.0.1"]);
    // A word is no substring search: the chart does not widen to one.
    expect(request["bodySearchText"]).toBeUndefined();
  });
});

describe("the chip reads, and comes back, as Word in message", () => {
  test("its key reads Word in message, kept or left out", () => {
    expect(FacetFilters.getLogsFacetChipDisplayKey("bodyWord")).toBe(
      "Word in message",
    );
    expect(FacetFilters.getLogsFacetChipDisplayKey("!bodyWord")).toBe(
      "Word in message",
    );
    // Beside the substring search it is not.
    expect(FacetFilters.getLogsFacetChipDisplayKey("body")).toBe(
      "Message contains",
    );
  });

  test("a saved view's words come back as their chips", () => {
    const chips: Map<
      string,
      Set<string>
    > = FacetFilters.buildLogsFacetFiltersFromQuery(
      {
        bodyWords: ["10.0.0.1"],
        excludedBodyWords: ["healthcheck"],
      } as unknown as Query<Log>,
      {} as Query<Log>,
    );

    expect(Array.from(chips.get("bodyWord") || [])).toEqual(["10.0.0.1"]);
    expect(Array.from(chips.get("!bodyWord") || [])).toEqual(["healthcheck"]);
  });

  test("a saved view's words are its chips: stripped before a fresh chip set is compiled", () => {
    const merged: JSONObject = Merge.buildSavedViewQueryForOverrides({
      savedQuery: {
        severityText: "Error",
        bodyWords: ["10.0.0.1"],
        excludedBodyWords: ["healthcheck"],
      },
      baseQuery: {},
    });

    expect(merged["bodyWords"]).toBeUndefined();
    expect(merged["excludedBodyWords"]).toBeUndefined();
  });

  test("a link opens on the chip: the address holds it as written", () => {
    const result: CrossSignalQueryParams = toLogsExplorerQueryParams({
      bodyWords: ["2001:0DB8:0:0:0:0:0:7"],
    });

    expect(JSON.parse(result.params["filters"]!)).toEqual([
      ["bodyWord", ["2001:0DB8:0:0:0:0:0:7"]],
    ]);
  });
});

describe("where the words cannot go, they are named", () => {
  test("a pivot to traces names them as message text, as a body search", () => {
    const result: { dropped: Array<string> } = Pivot.buildLogsPivotScope({
      appliedFacetFilters: facets({ bodyWord: ["10.0.0.1"] }),
      timeRange: PAST_ONE_HOUR,
    }) as unknown as { dropped: Array<string> };

    expect(result.dropped).toEqual(["bodyWord"]);
    expect(Pivot.formatDroppedScopeHint(result.dropped)).toBe(
      "Not carried over: message text",
    );
    expect(toTracesExplorerQueryParams({ bodyWords: ["x"] }).dropped).toEqual([
      "bodyWords",
    ]);
  });

  test("an Insights tab names them as the message text it does not apply", () => {
    expect(
      TabScope.describeUnappliedScopeFilters([["bodyWord", ["10.0.0.1"]]]),
    ).toBe("Also filtered in the Viewer, not applied here: message text");
  });
});
