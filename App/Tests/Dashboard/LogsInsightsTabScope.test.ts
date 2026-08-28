import { beforeAll, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import TimeRange from "Common/Types/Time/TimeRange";
import type { LogsInsightsUrlScope } from "../../FeatureSet/Dashboard/src/Utils/LogsInsights";

/*
 * The Logs half of the Viewer <-> Insights hand-off — the exact complaint
 * this work answers.
 *
 * From the issue: selecting the "DV-IMS" saved view in the Viewer narrows
 * the log list to five services, and switching to Insights throws that away
 * and shows "All services and hosts".
 *
 * The Insights tab reads and writes the Viewer's OWN url grammar rather than
 * a private one, which is what makes the hand-off symmetric — an Insights
 * URL is a Viewer URL, so the link back needs no translation and a pasted
 * link works either way round. These tests pin that symmetry, and pin the
 * behaviour of the chips Insights carries but cannot apply.
 */

type InsightsModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LogsInsights");

let Insights: InsightsModule;

const SERVICE_A: string = "0195d6c1-0000-7000-8000-00000000000a";
const SERVICE_B: string = "0195d6c1-0000-7000-8000-00000000000b";
const CLUSTER_ID: string = "0195d6c1-0000-7000-8000-0000000000c1";

/*
 * Common/UI/Config reads `window` the moment it loads, and this module pulls
 * it in transitively via RouteMap -> ProjectUtil, so the browser stub has to
 * exist before the deferred import runs.
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

  Insights = await import("../../FeatureSet/Dashboard/src/Utils/LogsInsights");
});

/** The URL the Logs Viewer writes for the "DV-IMS" saved view. */
function viewerSearch(
  overrides: Partial<{
    filters: unknown;
    range: string;
    savedView: string;
    extra: string;
  }> = {},
): string {
  const params: URLSearchParams = new URLSearchParams();

  params.set(
    "filters",
    JSON.stringify(
      overrides.filters ?? [
        ["primaryEntityId", [SERVICE_A, SERVICE_B]],
        ["severityText", ["Error"]],
      ],
    ),
  );
  params.set("range", overrides.range ?? TimeRange.PAST_ONE_DAY);
  params.set("savedView", overrides.savedView ?? "view-dv-ims");
  params.set("page", "3");
  params.set("pageSize", "250");

  return `?${params.toString()}${overrides.extra || ""}`;
}

describe("readLogsInsightsUrlScope", () => {
  test("adopts the services the Viewer's saved view had selected", () => {
    const scope: LogsInsightsUrlScope =
      Insights.readLogsInsightsUrlScope(viewerSearch());

    expect(scope.scopeValues).toEqual([
      `primaryEntityId:${SERVICE_A}`,
      `primaryEntityId:${SERVICE_B}`,
    ]);
    expect(scope.timeRange).toEqual({ range: TimeRange.PAST_ONE_DAY });
    expect(scope.savedViewId).toBe("view-dv-ims");
  });

  test("adopts host and cluster selections too, which Logs can genuinely apply", () => {
    /*
     * LogService rewrites `resourceFilters` into entity-key predicates, so a
     * cluster selection narrows the aggregates for real here — unlike on the
     * Metrics tab, where it would be a filter the numbers do not honour.
     */
    const scope: LogsInsightsUrlScope = Insights.readLogsInsightsUrlScope(
      viewerSearch({
        filters: [
          ["primaryEntityId", [SERVICE_A]],
          ["kubernetesClusterId", [CLUSTER_ID]],
        ],
      }),
    );

    expect(scope.scopeValues).toEqual([
      `primaryEntityId:${SERVICE_A}`,
      `kubernetesClusterId:${CLUSTER_ID}`,
    ]);
    expect(scope.unappliedFilters).toEqual([]);
  });

  test("carries a severity or body chip without applying it", () => {
    /*
     * Insights has no severity dimension to filter on — the severity split
     * IS one of its panels — and no message-body dimension at all. Applying
     * them is impossible; discarding them would make a round trip eat the
     * search the user typed. So they ride along and the page says so.
     */
    const scope: LogsInsightsUrlScope = Insights.readLogsInsightsUrlScope(
      viewerSearch({
        filters: [
          ["primaryEntityId", [SERVICE_A]],
          ["severityText", ["Error"]],
          ["body", ["connection refused"]],
        ],
      }),
    );

    expect(scope.scopeValues).toEqual([`primaryEntityId:${SERVICE_A}`]);
    expect(scope.unappliedFilters).toEqual([
      ["severityText", ["Error"]],
      ["body", ["connection refused"]],
    ]);
  });

  test("leaves the window to the page when the link named none", () => {
    /*
     * Null rather than a fabricated default, so the page can tell "the link
     * asked for the past hour" apart from "the link asked for nothing".
     */
    expect(
      Insights.readLogsInsightsUrlScope("?filters=%5B%5D").timeRange,
    ).toBeNull();
    expect(Insights.readLogsInsightsUrlScope("").timeRange).toBeNull();
  });

  test("restores a custom window with both endpoints", () => {
    const search: string = `?range=${encodeURIComponent(
      TimeRange.CUSTOM,
    )}&start=2026-08-20T00%3A00%3A00.000Z&end=2026-08-21T00%3A00%3A00.000Z`;

    const scope: LogsInsightsUrlScope =
      Insights.readLogsInsightsUrlScope(search);

    expect(scope.timeRange?.range).toBe(TimeRange.CUSTOM);
    expect(scope.timeRange?.startAndEndDate?.startValue.toISOString()).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });

  test("degrades to an unscoped page on a corrupt link rather than throwing", () => {
    for (const search of [
      "?filters=not-json",
      "?filters=%7B%7D",
      "?filters=%5B%5B%5D%5D",
      "?range=Past%20One%20Fortnight",
      "",
    ]) {
      const scope: LogsInsightsUrlScope =
        Insights.readLogsInsightsUrlScope(search);

      expect(scope.scopeValues).toEqual([]);
      expect(scope.unappliedFilters).toEqual([]);
      expect(scope.timeRange).toBeNull();
    }
  });
});

describe("buildLogsInsightsUrlParams", () => {
  test("writes the Viewer's grammar, so an Insights URL is a Viewer URL", () => {
    const params: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        scopeValues: [
          `primaryEntityId:${SERVICE_A}`,
          `kubernetesClusterId:${CLUSTER_ID}`,
        ],
        unappliedFilters: [["severityText", ["Error"]]],
        savedViewId: "view-dv-ims",
      });

    expect(JSON.parse(params["filters"] as string)).toEqual([
      ["primaryEntityId", [SERVICE_A]],
      ["kubernetesClusterId", [CLUSTER_ID]],
      ["severityText", ["Error"]],
    ]);
    expect(params["range"]).toBe(TimeRange.PAST_ONE_DAY);
    expect(params["savedView"]).toBe("view-dv-ims");
  });

  test("nulls the params it is not using, so a cleared filter is removed", () => {
    /*
     * The writer deletes on null. Emitting an empty string instead would
     * leave `?filters=` on the URL, which reads as "filtered" to both the
     * user and the next parser.
     */
    const params: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        scopeValues: [],
        unappliedFilters: [],
        savedViewId: null,
      });

    expect(params["filters"]).toBeNull();
    expect(params["savedView"]).toBeNull();
    expect(params["start"]).toBeNull();
    expect(params["end"]).toBeNull();
  });

  test("writes a custom window's endpoints", () => {
    const params: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-08-20T00:00:00.000Z"),
            new Date("2026-08-21T00:00:00.000Z"),
          ),
        },
        scopeValues: [],
        unappliedFilters: [],
        savedViewId: null,
      });

    expect(params["range"]).toBe(TimeRange.CUSTOM);
    expect(params["start"]).toBe("2026-08-20T00:00:00.000Z");
    expect(params["end"]).toBe("2026-08-21T00:00:00.000Z");
  });

  test("ignores a scope value that names an unknown facet", () => {
    /*
     * Anything else would compile to a predicate no explorer can read.
     */
    const params: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_HOUR },
        scopeValues: ["somethingNew:abc", `primaryEntityId:${SERVICE_A}`],
        unappliedFilters: [],
        savedViewId: null,
      });

    expect(JSON.parse(params["filters"] as string)).toEqual([
      ["primaryEntityId", [SERVICE_A]],
    ]);
  });
});

describe("Viewer -> Insights -> Viewer", () => {
  test("returns the user to the same slice, saved view and all", () => {
    /*
     * The end-to-end property from the issue. Nothing the Viewer had is
     * missing on the way back: the services, the window, the saved view's
     * identity, and the severity chip Insights never applied.
     */
    const scope: LogsInsightsUrlScope =
      Insights.readLogsInsightsUrlScope(viewerSearch());

    const backToViewer: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: scope.timeRange!,
        scopeValues: scope.scopeValues,
        unappliedFilters: scope.unappliedFilters,
        savedViewId: scope.savedViewId,
      });

    expect(JSON.parse(backToViewer["filters"] as string)).toEqual([
      ["primaryEntityId", [SERVICE_A, SERVICE_B]],
      ["severityText", ["Error"]],
    ]);
    expect(backToViewer["range"]).toBe(TimeRange.PAST_ONE_DAY);
    expect(backToViewer["savedView"]).toBe("view-dv-ims");
  });

  test("a scope narrowed on the Insights tab travels back narrowed", () => {
    const scope: LogsInsightsUrlScope =
      Insights.readLogsInsightsUrlScope(viewerSearch());

    // The user deselects one of the two services on the Insights tab.
    const backToViewer: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: scope.timeRange!,
        scopeValues: [`primaryEntityId:${SERVICE_A}`],
        unappliedFilters: scope.unappliedFilters,
        /*
         * And the saved view reference goes with it — the scope is no longer
         * the view's, so carrying its id would send the user back into a
         * view whose filters no longer match what they were looking at.
         */
        savedViewId: null,
      });

    expect(JSON.parse(backToViewer["filters"] as string)).toEqual([
      ["primaryEntityId", [SERVICE_A]],
      ["severityText", ["Error"]],
    ]);
    expect(backToViewer["savedView"]).toBeNull();
  });

  test("does not carry the Viewer's page or page size", () => {
    /*
     * Page 3 of the log list says nothing about what Insights should
     * aggregate, and carrying it back would drop the user on page 3 of a
     * list they did not ask for.
     */
    const params: Dictionary<string | null> =
      Insights.buildLogsInsightsUrlParams({
        timeRange: { range: TimeRange.PAST_ONE_DAY },
        scopeValues:
          Insights.readLogsInsightsUrlScope(viewerSearch()).scopeValues,
        unappliedFilters: [],
        savedViewId: null,
      });

    expect(params).not.toHaveProperty("page");
    expect(params).not.toHaveProperty("pageSize");
  });
});

describe("LOGS_TAB_DEFAULT_TIME_RANGE", () => {
  test("is the window both Logs tabs start from", () => {
    /*
     * Shared on purpose. The tabs now pass their scope to each other through
     * the URL, and two different "no range means this" defaults would move
     * the window on every tab switch made at rest — which would look exactly
     * like the bug this work fixes.
     */
    expect(Insights.LOGS_TAB_DEFAULT_TIME_RANGE).toBe(TimeRange.PAST_ONE_HOUR);
  });
});
