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

/*
 * ---------------------------------------------------------------------------
 * The `search` / `rootOnly` hand-off, and the structural guard that stops the
 * next predicate param from going the same way.
 *
 * What actually shipped: both params narrow the rows a Traces or Metrics
 * Viewer shows — `search` is compiled into the query through each explorer's
 * own grammar, `rootOnly` drives `isRootSpan` — and neither was in the
 * carried set. So the Insights tab aggregated a WIDER slice than the Viewer
 * the user came from while the header claimed the same scope, and the trip
 * back destroyed the search the user had typed. Nothing threw, nothing was
 * blank; the numbers were just about a different set of rows than the label.
 * ---------------------------------------------------------------------------
 */

type ViewerUrlStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/TelemetryViewerUrlState");

let ViewerUrlState: ViewerUrlStateModule;

/*
 * A second hook rather than an edit to the first: hooks run in declaration
 * order, so the `window` stub the first one installs is already in place by
 * the time this deferred import pulls in Navigation -> Common/UI/Config.
 */
beforeAll(async () => {
  ViewerUrlState = await import(
    "../../FeatureSet/Dashboard/src/Utils/TelemetryViewerUrlState"
  );
});

describe("param-set closure", () => {
  /*
   * This is the test that would have caught the bug at the moment it was
   * written, without anyone having to think about Insights at all.
   *
   * `search` and `rootOnly` were not forgotten because someone decided they
   * should not travel. They were forgotten because the carried set and the
   * explorers' param set were two independent lists, and adding a param to
   * one of them never forced a look at the other. So this asserts the two
   * lists are CLOSED over each other: every name an explorer writes is
   * accounted for exactly once, and neither carried list names a param that
   * no explorer writes.
   *
   * A future engineer adding a param to TelemetryViewerUrlParamNames fails
   * here until they say which side it belongs on. That is the whole point —
   * the failure is the design review.
   */

  /*
   * The third bucket, and its only member.
   *
   * `status` is written by the Exceptions viewer and is deliberately carried
   * NOWHERE: Unresolved / Resolved / Archived are one component with three
   * different status defaults, so handing `status` to a sibling tab would
   * make every tab show whichever status the user came from. It is not a
   * presentation param either — it genuinely narrows the rows. Naming it
   * here, with its reason, is what keeps the closure honest: a param is
   * excused only by an explicit entry, never by the test quietly not
   * noticing it.
   */
  const DESTINATION_SELECTED_PARAM_NAMES: ReadonlyArray<string> = ["status"];

  const WHERE_TO_PUT_IT: string =
    "pick a side: TELEMETRY_TAB_SCOPE_PARAM_NAMES if removing the param would return MORE rows, TELEMETRY_TAB_PRESENTATION_PARAM_NAMES if it only changes how the same rows are shown, or DESTINATION_SELECTED_PARAM_NAMES in this test if every destination must choose its own value";

  function classifiedNames(): Array<string> {
    return [
      ...Scope.TELEMETRY_TAB_SCOPE_PARAM_NAMES,
      ...Scope.TELEMETRY_TAB_PRESENTATION_PARAM_NAMES,
      ...DESTINATION_SELECTED_PARAM_NAMES,
    ];
  }

  test("every param an explorer writes is classified", () => {
    const classified: Array<string> = classifiedNames();

    const unclassified: Array<string> =
      ViewerUrlState.TelemetryViewerUrlParamNames.filter(
        (name: string): boolean => {
          return !classified.includes(name);
        },
      ).map((name: string): string => {
        return `"${name}" is written by an explorer but no list claims it — ${WHERE_TO_PUT_IT}`;
      });

    expect(unclassified).toEqual([]);
  });

  test("nothing is classified that no explorer writes", () => {
    /*
     * The other direction. A carried name the explorers never write is dead
     * weight that reads as a live contract — and it hides a rename: if
     * `search` were ever renamed in the viewers, the carried set would keep
     * carrying a param nobody sets and the slice would silently widen again.
     */
    const written: Array<string> = ViewerUrlState.TelemetryViewerUrlParamNames;

    const orphans: Array<string> = [
      ...Scope.TELEMETRY_TAB_SCOPE_PARAM_NAMES,
      ...Scope.TELEMETRY_TAB_PRESENTATION_PARAM_NAMES,
    ]
      .filter((name: string): boolean => {
        return !written.includes(name);
      })
      .map((name: string): string => {
        return `"${name}" is listed as a telemetry tab param but no explorer writes it — remove it, or fix the name it was renamed from`;
      });

    expect(orphans).toEqual([]);
  });

  test("no param is both carried and dropped", () => {
    /*
     * An overlap would mean the two lists disagree about one param, and
     * which behaviour you get would depend on which list a reader happened
     * to consult.
     */
    const overlap: Array<string> = Scope.TELEMETRY_TAB_SCOPE_PARAM_NAMES.filter(
      (name: string): boolean => {
        return Scope.TELEMETRY_TAB_PRESENTATION_PARAM_NAMES.includes(name);
      },
    );

    expect(overlap).toEqual([]);

    const classified: Array<string> = classifiedNames();
    const deduped: Array<string> = Array.from(new Set(classified));

    expect(deduped.sort()).toEqual(classified.sort());
  });

  test("the two lists together account for the whole set, exactly once each", () => {
    expect(classifiedNames().sort()).toEqual(
      [...ViewerUrlState.TelemetryViewerUrlParamNames].sort(),
    );
  });

  test("search and rootOnly sit on the carried side, where they belong", () => {
    /*
     * The direct anchor for the regression. Both narrow the rows, so both
     * are scope; moving either into the presentation list would reinstate an
     * Insights tab whose numbers cover more rows than its header admits.
     */
    expect(Scope.TELEMETRY_TAB_SCOPE_PARAM_NAMES).toContain("search");
    expect(Scope.TELEMETRY_TAB_SCOPE_PARAM_NAMES).toContain("rootOnly");
    expect(Scope.TELEMETRY_TAB_PRESENTATION_PARAM_NAMES).not.toContain(
      "search",
    );
    expect(Scope.TELEMETRY_TAB_PRESENTATION_PARAM_NAMES).not.toContain(
      "rootOnly",
    );
  });

  test("the presentation list is page, pageSize and view — and only those", () => {
    /*
     * Pinned as a whole set rather than by membership: the argument for
     * dropping a param is "it says nothing about which rows to aggregate",
     * and that argument holds for exactly these three. A fourth arriving
     * here is a predicate being dropped.
     */
    expect([...Scope.TELEMETRY_TAB_PRESENTATION_PARAM_NAMES].sort()).toEqual([
      "page",
      "pageSize",
      "view",
    ]);
  });
});

/*
 * A search string a real user would type, and the one that breaks a naive
 * hand-off: the spaces make it a multi-token query, the quotes make it a
 * phrase, and the '%' is a live URL escape character that a double-encode or
 * a missed decode mangles into something that matches nothing.
 */
const AWKWARD_SEARCH: string = 'error rate > 50% "checkout service"';

function viewerQueryString(values: Dictionary<string>): string {
  return `?${new URLSearchParams(values).toString()}`;
}

describe("search and rootOnly round-trip", () => {
  interface RoundTripCase {
    name: string;
    search: string | null;
    rootOnly: boolean | null;
    grammar: "lists" | "pairs";
  }

  const CASES: Array<RoundTripCase> = [];

  for (const grammar of ["lists", "pairs"] as Array<"lists" | "pairs">) {
    for (const search of [null, "timeout", AWKWARD_SEARCH]) {
      for (const rootOnly of [null, true]) {
        CASES.push({
          name: `${grammar} grammar, search=${
            search === null ? "absent" : JSON.stringify(search)
          }, rootOnly=${rootOnly === null ? "absent" : "true"}`,
          search,
          rootOnly,
          grammar,
        });
      }
    }
  }

  test.each(CASES)(
    "$name survives Viewer -> Insights -> Viewer",
    (testCase: RoundTripCase) => {
      /*
       * The property, stated once for the whole matrix: whatever the Viewer
       * wrote is what the trip back writes. Any cell that loses a value is a
       * user's typed search deleted by a tab click, or an Insights page
       * counting non-root spans a Traces Viewer was hiding.
       */
      const urlValues: Dictionary<string> = {
        filters: JSON.stringify(
          testCase.grammar === "pairs"
            ? [["primaryEntityId", SERVICE_A]]
            : [["primaryEntityId", [SERVICE_A]]],
        ),
        range: TimeRange.PAST_ONE_DAY,
      };

      if (testCase.search !== null) {
        urlValues["search"] = testCase.search;
      }

      if (testCase.rootOnly !== null) {
        urlValues["rootOnly"] = String(testCase.rootOnly);
      }

      const scope: ServiceScopedInsightsUrlScope =
        Scope.readServiceScopedInsightsUrlScope(viewerQueryString(urlValues));

      expect(scope.search).toBe(testCase.search);
      expect(scope.rootOnly).toBe(testCase.rootOnly);
      expect(scope.serviceIds).toEqual([SERVICE_A]);

      const backToViewer: Dictionary<string | null> =
        Scope.buildServiceScopedInsightsUrlParams({
          timeRange: scope.timeRange as RangeStartAndEndDateTime,
          serviceIds: scope.serviceIds,
          unappliedFilters: scope.unappliedFilters,
          savedViewId: scope.savedViewId,
          grammar: testCase.grammar,
          search: scope.search,
          rootOnly: scope.rootOnly,
        });

      expect(backToViewer["search"]).toBe(testCase.search);
      expect(backToViewer["rootOnly"]).toBe(
        testCase.rootOnly === true ? "true" : null,
      );

      /*
       * And once more from the rebuilt URL: reading what we just wrote has
       * to land on the same scope, or the second tab switch drifts.
       */
      expect(
        Scope.readServiceScopedInsightsUrlScope(
          viewerQueryString(Scope.toPresentParams(backToViewer)),
        ),
      ).toEqual(scope);
    },
  );

  test("a search full of URL metacharacters comes back byte for byte", () => {
    /*
     * Spelled out separately from the matrix because the failure mode is
     * silent: a double-encoded '%' turns "50%" into "50%25" and the query
     * quietly matches nothing, which reads to the user as "there are no such
     * spans" rather than as a broken link.
     */
    expect(
      Scope.readServiceScopedInsightsUrlScope(
        viewerQueryString({ search: AWKWARD_SEARCH }),
      ).search,
    ).toBe(AWKWARD_SEARCH);
  });

  test("rootOnly=false is not re-emitted, because it is not a filter", () => {
    /*
     * "Show every span" is the absence of a narrowing, and a param that
     * spells it out claims one. Left in the URL it makes a link look
     * filtered, it survives into a shared link as a toggle the recipient did
     * not choose, and it gives the hint chip something to name.
     */
    const params: Dictionary<string | null> =
      Scope.buildServiceScopedInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        serviceIds: [],
        unappliedFilters: [],
        savedViewId: null,
        grammar: "pairs",
        rootOnly: false,
      });

    expect(params["rootOnly"]).toBeNull();
    expect(Object.keys(Scope.toPresentParams(params))).not.toContain(
      "rootOnly",
    );
  });

  test("rootOnly=false in the URL still reads as false, not as absent", () => {
    /*
     * Reading and writing are asymmetric on purpose. `false` has to be
     * distinguishable from "the link said nothing" on the way IN, because a
     * link that explicitly cleared the toggle must beat a named saved view
     * that stores it as on; only the OUTPUT drops it.
     */
    expect(
      Scope.readServiceScopedInsightsUrlScope(
        viewerQueryString({ rootOnly: "false" }),
      ).rootOnly,
    ).toBe(false);

    expect(
      Scope.readServiceScopedInsightsUrlScope(
        viewerQueryString({ range: TimeRange.PAST_ONE_DAY }),
      ).rootOnly,
    ).toBeNull();
  });

  test("an empty search writes no param rather than an empty one", () => {
    /*
     * `?search=` reads back as a search for the empty string and looks
     * filtered to anyone reading the URL. Absent is the honest encoding of
     * "no search".
     */
    for (const search of ["", null, undefined]) {
      expect(
        Scope.buildServiceScopedInsightsUrlParams({
          timeRange: { range: TimeRange.PAST_ONE_HOUR },
          serviceIds: [],
          unappliedFilters: [],
          savedViewId: null,
          grammar: "lists",
          search,
        })["search"],
      ).toBeNull();
    }
  });
});

describe("the hint names what is not applied", () => {
  test("a search the page is not applying is named", () => {
    /*
     * Without this the page carries the search invisibly: the header says
     * "2 services", the numbers cover every row in those services, and the
     * Viewer the user just left was showing a fraction of them.
     */
    expect(Scope.describeUnappliedScopeFilters([], { search: "timeout" })).toBe(
      "Also filtered in the Viewer, not applied here: search text",
    );
  });

  test("a root-spans-only toggle the page is not applying is named", () => {
    expect(Scope.describeUnappliedScopeFilters([], { rootOnly: true })).toBe(
      "Also filtered in the Viewer, not applied here: root spans only",
    );
  });

  test("facets, search and toggle read as one sentence, facets first", () => {
    expect(
      Scope.describeUnappliedScopeFilters(
        [
          ["severityText", ["Error"]],
          ["attributes.http.route", ["/checkout"]],
        ],
        { search: AWKWARD_SEARCH, rootOnly: true },
      ),
    ).toBe(
      "Also filtered in the Viewer, not applied here: severity, attribute http.route, search text, root spans only",
    );
  });

  test("nothing carried, nothing said", () => {
    /*
     * The empty string is what tells the caller to render no chip at all. A
     * hint chip with an empty list is worse than no chip: it asserts that
     * something is being ignored.
     */
    for (const extras of [
      undefined,
      {},
      { search: null, rootOnly: null },
      { search: undefined, rootOnly: undefined },
      { search: "", rootOnly: false },
    ]) {
      expect(Scope.describeUnappliedScopeFilters([], extras)).toBe("");
    }
  });

  test("a search of only whitespace is not a filter", () => {
    /*
     * The explorers trim before submitting, so "   " narrows nothing.
     * Naming it would send the user hunting for a filter that is not there.
     */
    for (const search of [" ", "   ", "\t", "\n  \t"]) {
      expect(Scope.describeUnappliedScopeFilters([], { search })).toBe("");
    }
  });

  test("rootOnly=false is not mentioned, only true is", () => {
    /*
     * false is the explorer showing everything. Announcing it as a carried
     * filter would describe a narrowing that does not exist.
     */
    expect(Scope.describeUnappliedScopeFilters([], { rootOnly: false })).toBe(
      "",
    );
    expect(
      Scope.describeUnappliedScopeFilters([["body", ["timeout"]]], {
        rootOnly: false,
      }),
    ).toBe("Also filtered in the Viewer, not applied here: message text");
  });

  test("the extras argument stays optional, so existing callers are unaffected", () => {
    expect(
      Scope.describeUnappliedScopeFilters([["severityText", ["Error"]]]),
    ).toBe("Also filtered in the Viewer, not applied here: severity");
  });
});

describe("a whole Traces Viewer URL survives the trip to Insights and back", () => {
  /*
   * The end-to-end statement of the fix, on the URL a real Traces Viewer
   * writes: chips, a window, a search, the root-spans toggle, the selected
   * saved view, and the pagination. Every predicate has to come back; the
   * presentation params have to be gone, because landing the user on page 3
   * of a list they did not ask for is its own bug.
   */
  const VIEWER_FILTERS: string = JSON.stringify([
    ["primaryEntityId", SERVICE_A],
    ["primaryEntityId", SERVICE_B],
    ["attributes.http.route", "/checkout"],
    ["kubernetesClusterId", CLUSTER_ID],
  ]);

  const VIEWER_URL: string = viewerQueryString({
    filters: VIEWER_FILTERS,
    range: TimeRange.PAST_ONE_DAY,
    search: AWKWARD_SEARCH,
    rootOnly: "true",
    savedView: "dv-traces",
    page: "3",
    pageSize: "50",
    view: "list",
  });

  test("Insights reads every predicate and no presentation param", () => {
    const scope: ServiceScopedInsightsUrlScope =
      Scope.readServiceScopedInsightsUrlScope(VIEWER_URL);

    expect(scope.serviceIds).toEqual([SERVICE_A, SERVICE_B]);
    expect(scope.timeRange).toEqual({ range: TimeRange.PAST_ONE_DAY });
    expect(scope.savedViewId).toBe("dv-traces");
    expect(scope.search).toBe(AWKWARD_SEARCH);
    expect(scope.rootOnly).toBe(true);
    /*
     * Metrics and Traces Insights aggregate by service only, so the route
     * and the cluster ride along unapplied rather than being claimed.
     */
    expect(scope.unappliedFilters).toEqual([
      ["attributes.http.route", ["/checkout"]],
      ["kubernetesClusterId", [CLUSTER_ID]],
    ]);

    const carried: Dictionary<string> =
      Scope.readTelemetryTabScopeParams(VIEWER_URL);

    expect(Object.keys(carried).sort()).toEqual(
      ["filters", "range", "rootOnly", "savedView", "search"].sort(),
    );
  });

  test("the trip back writes the Viewer's own URL again", () => {
    const scope: ServiceScopedInsightsUrlScope =
      Scope.readServiceScopedInsightsUrlScope(VIEWER_URL);

    const backToViewer: Dictionary<string> = Scope.toPresentParams(
      Scope.buildServiceScopedInsightsUrlParams({
        timeRange: scope.timeRange as RangeStartAndEndDateTime,
        serviceIds: scope.serviceIds,
        unappliedFilters: scope.unappliedFilters,
        savedViewId: scope.savedViewId,
        grammar: "pairs",
        search: scope.search,
        rootOnly: scope.rootOnly,
      }),
    );

    // Every predicate, byte for byte — including the chip order.
    expect(JSON.parse(backToViewer["filters"] as string)).toEqual(
      JSON.parse(VIEWER_FILTERS),
    );
    expect(backToViewer["range"]).toBe(TimeRange.PAST_ONE_DAY);
    expect(backToViewer["savedView"]).toBe("dv-traces");
    expect(backToViewer["search"]).toBe(AWKWARD_SEARCH);
    expect(backToViewer["rootOnly"]).toBe("true");

    /*
     * ...and nothing else. `page`, `pageSize` and `view` are the Viewer's
     * own business; carrying them would drop the user back on page 3.
     */
    expect(Object.keys(backToViewer).sort()).toEqual(
      ["filters", "range", "rootOnly", "savedView", "search"].sort(),
    );
  });

  test("a second lap changes nothing", () => {
    /*
     * Idempotence is what makes the hand-off safe to repeat. A user toggling
     * between the two tabs must not watch their slice drift a little on each
     * click.
     */
    const first: ServiceScopedInsightsUrlScope =
      Scope.readServiceScopedInsightsUrlScope(VIEWER_URL);

    const rebuilt: string = viewerQueryString(
      Scope.toPresentParams(
        Scope.buildServiceScopedInsightsUrlParams({
          timeRange: first.timeRange as RangeStartAndEndDateTime,
          serviceIds: first.serviceIds,
          unappliedFilters: first.unappliedFilters,
          savedViewId: first.savedViewId,
          grammar: "pairs",
          search: first.search,
          rootOnly: first.rootOnly,
        }),
      ),
    );

    expect(Scope.readServiceScopedInsightsUrlScope(rebuilt)).toEqual(first);
  });

  test("the hint sentence covers everything the trip did not apply", () => {
    const scope: ServiceScopedInsightsUrlScope =
      Scope.readServiceScopedInsightsUrlScope(VIEWER_URL);

    expect(
      Scope.describeUnappliedScopeFilters(scope.unappliedFilters, {
        search: scope.search,
        rootOnly: scope.rootOnly,
      }),
    ).toBe(
      "Also filtered in the Viewer, not applied here: attribute http.route, kubernetes cluster, search text, root spans only",
    );
  });
});
