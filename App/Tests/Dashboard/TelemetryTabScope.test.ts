import { beforeAll, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import type {
  ServiceScopedInsightsUrlScope,
  TelemetryFilterTuple,
  TelemetryScopeSelection,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope";

/*
 * The Viewer <-> Insights scope hand-off.
 *
 * The bug behind this module: picking a saved view in the Logs Viewer
 * narrowed the log list, and switching to the Insights tab threw that away
 * and showed "All services and hosts". The tabs looked like two lenses on
 * one dataset while each kept private scope state.
 *
 * Three themes run through the suite. Every param arrives from a URL a user
 * can hand-edit, so each parser is exercised on malformed input as well as
 * on its happy path — a corrupt link must degrade to "no filter", never to a
 * blank page. Every round trip is checked for FIDELITY, because a hand-off
 * that quietly widens or narrows the slice shows the user a number that
 * describes something other than what the label claims. And the filters an
 * Insights tab cannot apply are checked for SURVIVAL: they are neither
 * applied nor discarded, so a trip through Insights and back does not eat
 * the search the user typed.
 */

type ScopeModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope");

let Scope: ScopeModule;

const SERVICE_A: string = "0195d6c1-0000-7000-8000-00000000000a";
const SERVICE_B: string = "0195d6c1-0000-7000-8000-00000000000b";
const CLUSTER_ID: string = "0195d6c1-0000-7000-8000-0000000000c1";

/*
 * Route -> Common/UI/Config reads `window` on load, so the browser stub has
 * to exist before the deferred import runs.
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

  Scope = await import(
    "../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope"
  );
});

describe("parseTelemetryFilterTuples", () => {
  test("reads the Logs grammar, where one facet carries a list of values", () => {
    expect(
      Scope.parseTelemetryFilterTuples(
        JSON.stringify([["primaryEntityId", [SERVICE_A, SERVICE_B]]]),
      ),
    ).toEqual([["primaryEntityId", [SERVICE_A, SERVICE_B]]]);
  });

  test("reads the Traces/Metrics grammar, where each value is its own pair", () => {
    /*
     * Both explorers fan a multi-valued selection out into one pair per
     * value, and group them back together on read. Merging them here is what
     * lets one Insights implementation serve all three signals — and what
     * stops a two-service selection coming back as two separate chips.
     */
    expect(
      Scope.parseTelemetryFilterTuples(
        JSON.stringify([
          ["primaryEntityId", SERVICE_A],
          ["primaryEntityId", SERVICE_B],
        ]),
      ),
    ).toEqual([["primaryEntityId", [SERVICE_A, SERVICE_B]]]);
  });

  test("keeps facet order and de-duplicates values within a facet", () => {
    expect(
      Scope.parseTelemetryFilterTuples(
        JSON.stringify([
          ["severityText", ["Error"]],
          ["primaryEntityId", [SERVICE_A, SERVICE_A]],
          ["severityText", ["Error", "Fatal"]],
        ]),
      ),
    ).toEqual([
      ["severityText", ["Error", "Fatal"]],
      ["primaryEntityId", [SERVICE_A]],
    ]);
  });

  test("degrades to no filter on anything malformed", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "not json",
      "{}",
      '"a string"',
      "[1, 2, 3]",
      JSON.stringify([["primaryEntityId"]]),
      JSON.stringify([[123, ["x"]]]),
      JSON.stringify([["", ["x"]]]),
      JSON.stringify([["primaryEntityId", []]]),
      JSON.stringify([["primaryEntityId", [""]]]),
      JSON.stringify([["primaryEntityId", [null]]]),
    ]) {
      expect(Scope.parseTelemetryFilterTuples(raw as string)).toEqual([]);
    }
  });
});

describe("filter serialization", () => {
  const tuples: Array<TelemetryFilterTuple> = [
    ["primaryEntityId", [SERVICE_A, SERVICE_B]],
    ["severityText", ["Error"]],
  ];

  test("the Logs grammar keeps values grouped under their facet", () => {
    expect(
      JSON.parse(Scope.serializeTelemetryFilterTuplesAsLists(tuples) as string),
    ).toEqual([
      ["primaryEntityId", [SERVICE_A, SERVICE_B]],
      ["severityText", ["Error"]],
    ]);
  });

  test("the pair grammar fans each value out into its own tuple", () => {
    expect(
      JSON.parse(Scope.serializeTelemetryFilterTuplesAsPairs(tuples) as string),
    ).toEqual([
      ["primaryEntityId", SERVICE_A],
      ["primaryEntityId", SERVICE_B],
      ["severityText", "Error"],
    ]);
  });

  test("nothing to say serializes to null, so the param is deleted rather than set empty", () => {
    expect(Scope.serializeTelemetryFilterTuplesAsLists([])).toBeNull();
    expect(Scope.serializeTelemetryFilterTuplesAsPairs([])).toBeNull();
    expect(
      Scope.serializeTelemetryFilterTuplesAsLists([["primaryEntityId", []]]),
    ).toBeNull();
  });

  test("either grammar round-trips back through the parser unchanged", () => {
    for (const serialized of [
      Scope.serializeTelemetryFilterTuplesAsLists(tuples),
      Scope.serializeTelemetryFilterTuplesAsPairs(tuples),
    ]) {
      expect(Scope.parseTelemetryFilterTuples(serialized)).toEqual(tuples);
    }
  });
});

describe("splitTelemetryScopeFilters", () => {
  test("routes service, resource and unapplicable facets to their own homes", () => {
    const split: TelemetryScopeSelection = Scope.splitTelemetryScopeFilters(
      [
        ["primaryEntityId", [SERVICE_A]],
        ["kubernetesClusterId", [CLUSTER_ID]],
        ["severityText", ["Error"]],
        ["body", ["connection refused"]],
      ],
      { supportsResourceEntityFacets: true },
    );

    expect(split.serviceIds).toEqual([SERVICE_A]);
    expect(split.resourceFilters).toEqual({
      kubernetesClusterId: [CLUSTER_ID],
    });
    expect(split.unsupported).toEqual([
      ["severityText", ["Error"]],
      ["body", ["connection refused"]],
    ]);
  });

  test("treats the legacy serviceId alias as a service facet", () => {
    /*
     * `serviceId` is the pre-rename alias the resource facet resolver still
     * accepts. A link built by an older client has to land on the same scope
     * as a current one, not in the unapplied pile.
     */
    const split: TelemetryScopeSelection = Scope.splitTelemetryScopeFilters(
      [["serviceId", [SERVICE_A]]],
      { supportsResourceEntityFacets: true },
    );

    expect(split.serviceIds).toEqual([SERVICE_A]);
    expect(split.unsupported).toEqual([]);
  });

  test("carries resource facets as unapplied where the destination cannot compile them", () => {
    /*
     * Metrics has no entity-key rewrite, so claiming a cluster selection was
     * applied would show a scope the numbers do not honour. Carrying it lets
     * the trip back restore it intact.
     */
    const split: TelemetryScopeSelection = Scope.splitTelemetryScopeFilters(
      [
        ["primaryEntityId", [SERVICE_A]],
        ["kubernetesClusterId", [CLUSTER_ID]],
      ],
      { supportsResourceEntityFacets: false },
    );

    expect(split.serviceIds).toEqual([SERVICE_A]);
    expect(split.resourceFilters).toEqual({});
    expect(split.unsupported).toEqual([["kubernetesClusterId", [CLUSTER_ID]]]);
  });

  test("merges the same facet arriving twice rather than keeping both", () => {
    const split: TelemetryScopeSelection = Scope.splitTelemetryScopeFilters(
      [
        ["primaryEntityId", [SERVICE_A]],
        ["primaryEntityId", [SERVICE_A, SERVICE_B]],
      ],
      { supportsResourceEntityFacets: true },
    );

    expect(split.serviceIds).toEqual([SERVICE_A, SERVICE_B]);
  });
});

describe("buildTelemetryScopeFilterTuples", () => {
  test("recombines applied scope and carried filters into one tuple list", () => {
    expect(
      Scope.buildTelemetryScopeFilterTuples({
        serviceIds: [SERVICE_A],
        resourceFilters: { kubernetesClusterId: [CLUSTER_ID] },
        unsupported: [["body", ["timeout"]]],
      }),
    ).toEqual([
      ["primaryEntityId", [SERVICE_A]],
      ["kubernetesClusterId", [CLUSTER_ID]],
      ["body", ["timeout"]],
    ]);
  });

  test("emits nothing for an empty scope, so an unfiltered page writes no filter param", () => {
    expect(
      Scope.buildTelemetryScopeFilterTuples({
        serviceIds: [],
        resourceFilters: {},
        unsupported: [],
      }),
    ).toEqual([]);
  });

  test("drops a facet whose values were all removed", () => {
    expect(
      Scope.buildTelemetryScopeFilterTuples({
        serviceIds: [],
        resourceFilters: { hostId: [] },
        unsupported: [["body", []]],
      }),
    ).toEqual([]);
  });

  test("split then rebuild is lossless for everything the destination carries", () => {
    const original: Array<TelemetryFilterTuple> = [
      ["primaryEntityId", [SERVICE_A, SERVICE_B]],
      ["kubernetesClusterId", [CLUSTER_ID]],
      ["severityText", ["Error"]],
      ["attributes.http.route", ["/checkout"]],
    ];

    expect(
      Scope.buildTelemetryScopeFilterTuples(
        Scope.splitTelemetryScopeFilters(original, {
          supportsResourceEntityFacets: true,
        }),
      ),
    ).toEqual(original);
  });
});

describe("describeUnappliedScopeFilters", () => {
  test("names the carried filters in words a user recognizes", () => {
    expect(
      Scope.describeUnappliedScopeFilters([
        ["severityText", ["Error"]],
        ["body", ["timeout"]],
      ]),
    ).toBe(
      "Also filtered in the Viewer, not applied here: severity, message text",
    );
  });

  test("unwraps an attribute key rather than printing the facet prefix", () => {
    expect(
      Scope.describeUnappliedScopeFilters([
        ["attributes.http.route", ["/checkout"]],
      ]),
    ).toBe(
      "Also filtered in the Viewer, not applied here: attribute http.route",
    );
  });

  test("falls back to the raw key for a facet with no label", () => {
    expect(Scope.describeUnappliedScopeFilters([["somethingNew", ["x"]]])).toBe(
      "Also filtered in the Viewer, not applied here: somethingNew",
    );
  });

  test("says nothing when nothing was carried, so no chip renders", () => {
    expect(Scope.describeUnappliedScopeFilters([])).toBe("");
  });
});

describe("time range params", () => {
  test("a rolling preset travels as its enum and stays rolling", () => {
    /*
     * The enum, not the window it resolved to. A preset carried as absolute
     * timestamps would freeze "past one hour" into the hour the link was
     * built, which is the whole reason saved views store the selection
     * rather than the resolved window.
     */
    const params: Dictionary<string | null> =
      Scope.buildTelemetryTimeRangeParams({
        range: TimeRange.PAST_ONE_DAY,
      });

    expect(params["range"]).toBe(TimeRange.PAST_ONE_DAY);
    expect(params["start"]).toBeNull();
    expect(params["end"]).toBeNull();
  });

  test("a custom window carries both of its endpoints", () => {
    const startValue: Date = new Date("2026-08-20T00:00:00.000Z");
    const endValue: Date = new Date("2026-08-21T00:00:00.000Z");

    const params: Dictionary<string | null> =
      Scope.buildTelemetryTimeRangeParams({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(startValue, endValue),
      });

    expect(params["range"]).toBe(TimeRange.CUSTOM);
    expect(params["start"]).toBe(startValue.toISOString());
    expect(params["end"]).toBe(endValue.toISOString());
  });

  test("the range is written even when it is a page default", () => {
    /*
     * The explorers used to omit their own default to keep URLs short. That
     * was harmless while each tab was an island, but "absent means my
     * default" silently moves the window across a tab switch whenever the
     * two tabs' defaults differ — which is exactly the case for Logs
     * (Viewer: past hour, Insights: past day).
     */
    expect(
      Scope.buildTelemetryTimeRangeParams({ range: TimeRange.PAST_ONE_HOUR })[
        "range"
      ],
    ).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("reads a preset back", () => {
    expect(
      Scope.readTelemetryTimeRangeParams({ range: TimeRange.PAST_TWO_DAYS }),
    ).toEqual({ range: TimeRange.PAST_TWO_DAYS });
  });

  test("reads a custom window back, endpoints and all", () => {
    const restored: RangeStartAndEndDateTime | null =
      Scope.readTelemetryTimeRangeParams({
        range: TimeRange.CUSTOM,
        start: "2026-08-20T00:00:00.000Z",
        end: "2026-08-21T00:00:00.000Z",
      });

    expect(restored?.range).toBe(TimeRange.CUSTOM);
    expect(restored?.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-08-20T00:00:00.000Z",
    );
    expect(restored?.startAndEndDate?.endValue.toISOString()).toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });

  test("returns null rather than a default when the link said nothing", () => {
    /*
     * The distinction matters: null lets each page keep its own default,
     * where a fabricated default would silently overwrite it.
     */
    expect(Scope.readTelemetryTimeRangeParams({})).toBeNull();
  });

  test("returns null for a range it cannot honour", () => {
    for (const params of [
      { range: "Past One Fortnight" },
      { range: TimeRange.CUSTOM },
      { range: TimeRange.CUSTOM, start: "2026-08-20T00:00:00.000Z" },
      { range: TimeRange.CUSTOM, start: "nonsense", end: "nonsense" },
    ]) {
      expect(Scope.readTelemetryTimeRangeParams(params)).toBeNull();
    }
  });

  test("a custom window round-trips through both directions unchanged", () => {
    const original: RangeStartAndEndDateTime = {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2026-08-20T09:30:00.000Z"),
        new Date("2026-08-20T10:30:00.000Z"),
      ),
    };

    const written: Dictionary<string | null> =
      Scope.buildTelemetryTimeRangeParams(original);

    const present: Dictionary<string> = Scope.toPresentParams(written);

    expect(Scope.readTelemetryTimeRangeParams(present)).toEqual(original);
  });
});

describe("readTelemetryTabScopeParams", () => {
  test("takes the scope params and leaves everything else on the route", () => {
    const params: Dictionary<string> = Scope.readTelemetryTabScopeParams(
      "?filters=%5B%5D&range=Past%20One%20Day&page=4&pageSize=50&view=analytics&serviceId=abc",
    );

    expect(params).toEqual({
      filters: "[]",
      range: "Past One Day",
    });
  });

  test("leaves out page and pageSize on purpose", () => {
    /*
     * Page 4 of the Viewer's list says nothing about what Insights should
     * aggregate, and carrying it would drop the user on page 4 of a list
     * they did not ask for on the way back.
     */
    const params: Dictionary<string> = Scope.readTelemetryTabScopeParams(
      "?page=4&pageSize=50",
    );

    expect(params).toEqual({});
  });

  test("carries the saved view id", () => {
    expect(
      Scope.readTelemetryTabScopeParams("?savedView=view-1")["savedView"],
    ).toBe("view-1");
  });

  test("ignores empty values and an empty query string", () => {
    expect(Scope.readTelemetryTabScopeParams("?filters=&range=")).toEqual({});
    expect(Scope.readTelemetryTabScopeParams("")).toEqual({});
    expect(Scope.readTelemetryTabScopeParams(null)).toEqual({});
    expect(Scope.readTelemetryTabScopeParams(undefined)).toEqual({});
  });
});

describe("withTelemetryTabScopeParams", () => {
  function queryOf(route: { toString(): string }): URLSearchParams {
    const routeString: string = route.toString();
    const queryIndex: number = routeString.indexOf("?");

    return new URLSearchParams(
      queryIndex >= 0 ? routeString.substring(queryIndex + 1) : "",
    );
  }

  test("appends the scope so the tab link describes where it is going", async () => {
    const Route: typeof import("Common/Types/API/Route").default = (
      await import("Common/Types/API/Route")
    ).default;

    const link: { toString(): string } = Scope.withTelemetryTabScopeParams(
      new Route("/dashboard/project/logs/insights"),
      {
        filters: JSON.stringify([["primaryEntityId", [SERVICE_A]]]),
        range: TimeRange.PAST_ONE_DAY,
      },
    );

    expect(link.toString()).toContain("/logs/insights?");
    expect(queryOf(link).get("filters")).toBe(
      JSON.stringify([["primaryEntityId", [SERVICE_A]]]),
    );
    expect(queryOf(link).get("range")).toBe(TimeRange.PAST_ONE_DAY);
  });

  test("encodes values Route's own character rules would reject", async () => {
    const Route: typeof import("Common/Types/API/Route").default = (
      await import("Common/Types/API/Route")
    ).default;

    /*
     * A body chip carrying a tilde is the case that made this explicit:
     * encodeURIComponent leaves "~" bare and Route's setter throws on it.
     */
    const link: { toString(): string } = Scope.withTelemetryTabScopeParams(
      new Route("/logs/insights"),
      { filters: JSON.stringify([["body", ["~approx {value}"]]]) },
    );

    expect(link.toString()).not.toContain("~");
    expect(queryOf(link).get("filters")).toBe(
      JSON.stringify([["body", ["~approx {value}"]]]),
    );
  });

  test("returns the bare route when there is no scope to carry", async () => {
    const Route: typeof import("Common/Types/API/Route").default = (
      await import("Common/Types/API/Route")
    ).default;

    expect(
      Scope.withTelemetryTabScopeParams(
        new Route("/logs/insights"),
        {},
      ).toString(),
    ).toBe("/logs/insights");
  });
});

describe("service-scoped Insights round trip", () => {
  test("carries the services a Traces saved view selected, and nothing it cannot apply", () => {
    const viewerUrl: string = `?filters=${encodeURIComponent(
      JSON.stringify([
        ["primaryEntityId", SERVICE_A],
        ["primaryEntityId", SERVICE_B],
        ["attributes.http.route", "/checkout"],
      ]),
    )}&range=${encodeURIComponent(
      TimeRange.PAST_ONE_DAY,
    )}&savedView=dv-ims&page=3`;

    const scope: ServiceScopedInsightsUrlScope =
      Scope.readServiceScopedInsightsUrlScope(viewerUrl);

    expect(scope.serviceIds).toEqual([SERVICE_A, SERVICE_B]);
    expect(scope.timeRange).toEqual({ range: TimeRange.PAST_ONE_DAY });
    expect(scope.savedViewId).toBe("dv-ims");
    expect(scope.unappliedFilters).toEqual([
      ["attributes.http.route", ["/checkout"]],
    ]);
  });

  test("writes back the Viewer's own grammar, so the trip back needs no translation", () => {
    const params: Dictionary<string | null> =
      Scope.buildServiceScopedInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        serviceIds: [SERVICE_A, SERVICE_B],
        unappliedFilters: [["attributes.http.route", ["/checkout"]]],
        savedViewId: "dv-ims",
        grammar: "pairs",
      });

    expect(JSON.parse(params["filters"] as string)).toEqual([
      ["primaryEntityId", SERVICE_A],
      ["primaryEntityId", SERVICE_B],
      ["attributes.http.route", "/checkout"],
    ]);
    expect(params["range"]).toBe(TimeRange.PAST_ONE_DAY);
    expect(params["savedView"]).toBe("dv-ims");
  });

  test("Viewer -> Insights -> Viewer preserves the whole slice", () => {
    /*
     * The end-to-end property the issue asked for, and the one a lossy
     * hand-off would break: nothing the Viewer had is missing when the user
     * comes back, including the filters Insights never applied.
     */
    const viewerFilters: string = JSON.stringify([
      ["primaryEntityId", SERVICE_A],
      ["attributes.env", "prod"],
    ]);

    const scope: ServiceScopedInsightsUrlScope =
      Scope.readServiceScopedInsightsUrlScope(
        `?filters=${encodeURIComponent(viewerFilters)}&range=${encodeURIComponent(TimeRange.PAST_ONE_DAY)}&savedView=dv-ims`,
      );

    const backToViewer: Dictionary<string | null> =
      Scope.buildServiceScopedInsightsUrlParams({
        timeRange: scope.timeRange as RangeStartAndEndDateTime,
        serviceIds: scope.serviceIds,
        unappliedFilters: scope.unappliedFilters,
        savedViewId: scope.savedViewId,
        grammar: "pairs",
      });

    expect(JSON.parse(backToViewer["filters"] as string)).toEqual(
      JSON.parse(viewerFilters),
    );
    expect(backToViewer["range"]).toBe(TimeRange.PAST_ONE_DAY);
    expect(backToViewer["savedView"]).toBe("dv-ims");
  });

  test("a scope the user cleared writes null, so the params are deleted not blanked", () => {
    const params: Dictionary<string | null> =
      Scope.buildServiceScopedInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        serviceIds: [],
        unappliedFilters: [],
        savedViewId: null,
        grammar: "pairs",
      });

    expect(params["filters"]).toBeNull();
    expect(params["savedView"]).toBeNull();
    expect(Scope.toPresentParams(params)).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
  });
});
