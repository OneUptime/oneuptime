import { describe, expect, test } from "@jest/globals";

import Dictionary from "Common/Types/Dictionary";
import { TraceSpanType } from "Common/Types/Telemetry/TraceSpanType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  ServiceScopedInsightsUrlScope,
  TELEMETRY_TAB_SCOPE_PARAM_NAMES,
  buildServiceScopedInsightsUrlParams,
  describeUnappliedScopeFilters,
  readServiceScopedInsightsUrlScope,
  readTelemetryTabScopeParams,
  toPresentParams,
} from "../../FeatureSet/Dashboard/src/Utils/TelemetryTabScope";

/*
 * The Traces Viewer's Span Type (`spanType=entry|root|all`) narrows the rows
 * it lists, so it travels to the Insights tab and back like `search` and the
 * root-spans toggle before it - carried verbatim, never applied there (the
 * Insights page counts every span), and named in its hint only when it is a
 * narrowing the reader chose. What is pinned:
 *
 *   - the param is carried, and comes back as it went;
 *   - a link that names none (the Viewer leaves its default, Entry spans,
 *     out of the URL) carries none, and writes none back;
 *   - an old link's `rootOnly=true` still travels as it did, beside it;
 *   - the hint names Root spans only: All spans narrows nothing, and Entry
 *     spans is what the Viewer lists when nobody chose.
 */

const SERVICE: string = "33333333-3333-4333-8333-333333333333";

const viewerQueryString: (values: Dictionary<string>) => string = (
  values: Dictionary<string>,
): string => {
  return `?${new URLSearchParams(values).toString()}`;
};

const backToViewer: (
  scope: ServiceScopedInsightsUrlScope,
) => Dictionary<string> = (
  scope: ServiceScopedInsightsUrlScope,
): Dictionary<string> => {
  return toPresentParams(
    buildServiceScopedInsightsUrlParams({
      timeRange: scope.timeRange as RangeStartAndEndDateTime,
      serviceIds: scope.serviceIds,
      unappliedFilters: scope.unappliedFilters,
      savedViewId: scope.savedViewId,
      grammar: "pairs",
      search: scope.search,
      rootOnly: scope.rootOnly,
      spanType: scope.spanType,
    }),
  );
};

describe("the Span Type travels between the Traces Viewer and Insights", () => {
  test("it is a carried param: it narrows the rows", () => {
    expect(TELEMETRY_TAB_SCOPE_PARAM_NAMES).toContain("spanType");
    expect(
      readTelemetryTabScopeParams(
        viewerQueryString({ spanType: "all", page: "2" }),
      ),
    ).toEqual({ spanType: "all" });
  });

  test.each([TraceSpanType.Root, TraceSpanType.All, TraceSpanType.Entry])(
    "spanType=%s survives Viewer -> Insights -> Viewer",
    (spanType: TraceSpanType) => {
      const scope: ServiceScopedInsightsUrlScope =
        readServiceScopedInsightsUrlScope(
          viewerQueryString({
            filters: JSON.stringify([["primaryEntityId", SERVICE]]),
            range: TimeRange.PAST_ONE_DAY,
            spanType: spanType,
          }),
        );

      expect(scope.spanType).toBe(spanType);
      expect(scope.serviceIds).toEqual([SERVICE]);

      const back: Dictionary<string> = backToViewer(scope);
      expect(back["spanType"]).toBe(spanType);
      expect(back["rootOnly"]).toBeUndefined();

      // A second lap changes nothing.
      expect(
        readServiceScopedInsightsUrlScope(viewerQueryString(back)),
      ).toEqual(scope);
    },
  );

  test("a link that names no span type carries none and writes none back", () => {
    const scope: ServiceScopedInsightsUrlScope =
      readServiceScopedInsightsUrlScope(
        viewerQueryString({ range: TimeRange.PAST_ONE_HOUR }),
      );

    expect(scope.spanType).toBeNull();
    expect(Object.keys(backToViewer(scope))).not.toContain("spanType");
  });

  test("an unknown span type is not carried", () => {
    expect(
      readServiceScopedInsightsUrlScope(viewerQueryString({ spanType: "some" }))
        .spanType,
    ).toBeNull();
  });

  test("an old rootOnly=true link still travels as it did, and names no spanType of its own", () => {
    const scope: ServiceScopedInsightsUrlScope =
      readServiceScopedInsightsUrlScope(
        viewerQueryString({
          range: TimeRange.PAST_ONE_DAY,
          rootOnly: "true",
        }),
      );

    expect(scope.rootOnly).toBe(true);
    expect(scope.spanType).toBeNull();

    const back: Dictionary<string> = backToViewer(scope);
    expect(back["rootOnly"]).toBe("true");
    expect(back["spanType"]).toBeUndefined();
  });
});

describe("the Insights hint names the span type only when it narrows", () => {
  test("Root spans is named, as root spans only", () => {
    expect(
      describeUnappliedScopeFilters([], { spanType: TraceSpanType.Root }),
    ).toBe("Also filtered in the Viewer, not applied here: root spans only");
  });

  test("an old rootOnly=true and spanType=root beside it are named once", () => {
    expect(
      describeUnappliedScopeFilters([], {
        rootOnly: true,
        spanType: TraceSpanType.Root,
      }),
    ).toBe("Also filtered in the Viewer, not applied here: root spans only");
  });

  test("All spans narrows nothing, and Entry spans is the Viewer's default: neither is named", () => {
    for (const spanType of [TraceSpanType.All, TraceSpanType.Entry, null]) {
      expect(describeUnappliedScopeFilters([], { spanType })).toBe("");
    }

    expect(
      describeUnappliedScopeFilters([["body", ["timeout"]]], {
        spanType: TraceSpanType.All,
      }),
    ).toBe("Also filtered in the Viewer, not applied here: message text");
  });
});
