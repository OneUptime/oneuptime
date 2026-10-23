import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import TimeRange from "Common/Types/Time/TimeRange";
import { KubernetesEventsTypeFilter } from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import {
  KUBERNETES_EVENTS_DEFAULT_RANGE,
  KUBERNETES_EVENTS_URL_PARAMS,
  KubernetesEventsViewState,
  getDefaultKubernetesEventsView,
  hasKubernetesEventsFilters,
  readKubernetesEventsView,
  toKubernetesEventsUrlParams,
} from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsUrlState";

/*
 * A cluster's Events page keeps its view in the URL, so the Overview's
 * "View all warnings", a teammate's link and a reload land on exactly it.
 * The query string is untrusted: anything unreadable is the default.
 */

function reader(params: Dictionary<string>): (name: string) => string | null {
  return (name: string): string | null => {
    return params[name] ?? null;
  };
}

describe("reading the view", () => {
  test("nothing in the URL is the past day, warnings first when there are any, no filter", () => {
    const view: KubernetesEventsViewState = readKubernetesEventsView(
      reader({}),
    );

    expect(view).toEqual(getDefaultKubernetesEventsView());
    expect(view.range.range).toBe(KUBERNETES_EVENTS_DEFAULT_RANGE);
    expect(view.type).toBeUndefined();
    expect(hasKubernetesEventsFilters(view)).toBe(false);
  });

  test("reads the type, the filters and a preset range", () => {
    const view: KubernetesEventsViewState = readKubernetesEventsView(
      reader({
        range: TimeRange.PAST_ONE_WEEK,
        type: "all",
        namespace: "aks-istio-system",
        kind: "HorizontalPodAutoscaler",
        reason: "FailedGetResourceMetric",
      }),
    );

    expect(view).toEqual({
      range: { range: TimeRange.PAST_ONE_WEEK },
      type: KubernetesEventsTypeFilter.All,
      namespace: "aks-istio-system",
      objectKind: "HorizontalPodAutoscaler",
      reason: "FailedGetResourceMetric",
    });
    expect(hasKubernetesEventsFilters(view)).toBe(true);
  });

  test("reads a custom range from its two moments", () => {
    const view: KubernetesEventsViewState = readKubernetesEventsView(
      reader({
        range: TimeRange.CUSTOM,
        start: "2026-10-20T00:00:00.000Z",
        end: "2026-10-21T00:00:00.000Z",
      }),
    );

    expect(view.range.range).toBe(TimeRange.CUSTOM);
    expect(view.range.startAndEndDate?.startValue).toEqual(
      new Date("2026-10-20T00:00:00.000Z"),
    );
  });

  test.each([
    [{ range: "Past 9 Years" }],
    [{ range: TimeRange.CUSTOM, start: "yesterday", end: "today" }],
    [
      {
        range: TimeRange.CUSTOM,
        start: "2026-10-21T00:00:00.000Z",
        end: "2026-10-20T00:00:00.000Z",
      },
    ],
  ])("an unreadable range is the default: %j", (params: Dictionary<string>) => {
    expect(readKubernetesEventsView(reader(params)).range).toEqual({
      range: KUBERNETES_EVENTS_DEFAULT_RANGE,
    });
  });

  test("an unknown type, and a filter too long to be a Kubernetes name, are left out", () => {
    const view: KubernetesEventsViewState = readKubernetesEventsView(
      reader({
        type: "errors",
        namespace: "n".repeat(200),
        reason: "   ",
      }),
    );

    expect(view.type).toBeUndefined();
    expect(view.namespace).toBeUndefined();
    expect(view.reason).toBeUndefined();
  });
});

describe("writing the view", () => {
  test("every parameter the page owns is written, an empty one removing it", () => {
    const params: Dictionary<string> = toKubernetesEventsUrlParams(
      getDefaultKubernetesEventsView(),
    );

    expect(Object.keys(params).sort()).toEqual(
      [...KUBERNETES_EVENTS_URL_PARAMS].sort(),
    );
    expect(
      Object.values(params).every((value: string) => {
        return value === "";
      }),
    ).toBe(true);
  });

  test("what is read back is what was written", () => {
    const views: Array<KubernetesEventsViewState> = [
      {
        range: { range: TimeRange.PAST_ONE_HOUR },
        type: KubernetesEventsTypeFilter.Warning,
        namespace: "app-routing-system",
      },
      {
        range: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date("2026-10-20T00:00:00.000Z"),
            new Date("2026-10-21T00:00:00.000Z"),
          ),
        },
        type: KubernetesEventsTypeFilter.Normal,
        objectKind: "Node",
        reason: "OOMKilling",
      },
    ];

    for (const view of views) {
      const params: Dictionary<string> = toKubernetesEventsUrlParams(view);
      const present: Dictionary<string> = {};
      for (const key of Object.keys(params)) {
        if (params[key]) {
          present[key] = params[key]!;
        }
      }

      expect(readKubernetesEventsView(reader(present))).toEqual(view);
    }
  });
});
