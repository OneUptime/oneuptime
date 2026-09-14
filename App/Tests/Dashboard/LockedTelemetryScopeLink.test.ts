import { beforeAll, describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import {
  buildSearchTokenValue,
  compileAttributeChipValues,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import type { LockedScopeExplorerLink } from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink";

/*
 * The "Open in <explorer>" half of the locked-filter explainer: how the
 * whole locked scope becomes the main explorer's URL. Every URL grammar
 * detail (tuple shapes per signal, escaping, what each target cannot carry,
 * preset vs Custom window) is pinned here; the wording of the chips is
 * pinned in LockedTelemetryScope.test.ts.
 *
 * This module is the one that needs a browser at load (RouteMap ->
 * ProjectUtil -> Common/UI/Config reads `window`), which is exactly why it is
 * split from the describers — see the stub below.
 */

type LinkModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink");

let Scope: LinkModule;

const PROJECT_ID: string = "2d1a3f6e-0f7b-4c1d-9a2e-8b3c4d5e6f70";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/abc123/logs`;

const WINDOW_START: Date = new Date("2026-08-10T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-10T11:00:00.000Z");

const PAST_ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const SIGNALS: Array<TelemetrySignal> = ["logs", "traces", "metrics"];

/*
 * The link builder reads the current URL through Navigation and resolves the
 * project through ProjectUtil, and Common/UI/Config reads `window` the
 * moment it loads — so the browser stub has to exist before the module is
 * imported. Same approach as LogsCrossSignalPivot.test.ts.
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: PAGE_PATH,
      search: "",
      hash: "",
      href: `https://app.example.com${PAGE_PATH}`,
    },
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

  Scope = await import(
    "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink"
  );
});

function queryOf(link: LockedScopeExplorerLink): URLSearchParams {
  return new globalThis.URL(link.url.toString()).searchParams;
}

function pathOf(link: LockedScopeExplorerLink): string {
  return new globalThis.URL(link.url.toString()).pathname;
}

function filtersOf(link: LockedScopeExplorerLink): unknown {
  const raw: string | null = queryOf(link).get("filters");

  return raw === null ? null : JSON.parse(raw);
}

function customRange(): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  };
}

describe("buildLockedScopeExplorerLink", () => {
  test("logs: lands on the logs explorer of the current project with grouped filter tuples and the preset window", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [
        {
          facetKey: "attributes.resource.k8s.cluster.name",
          value: "prod-eks-01",
        },
        { facetKey: "primaryEntityId", value: "651a000000000000000000aa" },
        { facetKey: "traceId", value: "t-1" },
        { facetKey: "spanId", value: "s-1" },
        { facetKey: "severityText", value: "Error" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(link.url.toString().startsWith("https://app.example.com/")).toBe(
      true,
    );
    expect(pathOf(link)).toBe(`/dashboard/${PROJECT_ID}/logs`);
    expect(filtersOf(link)).toEqual([
      ["attributes.resource.k8s.cluster.name", ["prod-eks-01"]],
      ["primaryEntityId", ["651a000000000000000000aa"]],
      ["traceId", ["t-1"]],
      ["spanId", ["s-1"]],
      ["severityText", ["Error"]],
    ]);
    expect(queryOf(link).get("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(queryOf(link).get("start")).toBeNull();
    expect(queryOf(link).get("end")).toBeNull();
    expect(link.notCarried).toEqual([]);
  });

  test("logs: same-key chips fold into one tuple, duplicates dropped, serviceId aliased", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [
        { facetKey: "attributes.k8s.namespace.name", value: "payments" },
        { facetKey: "serviceId", value: "651a000000000000000000aa" },
        { facetKey: "attributes.k8s.namespace.name", value: "checkout" },
        { facetKey: "attributes.k8s.namespace.name", value: "payments" },
        { facetKey: "primaryEntityId", value: "651a000000000000000000aa" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(filtersOf(link)).toEqual([
      ["attributes.k8s.namespace.name", ["payments", "checkout"]],
      ["primaryEntityId", ["651a000000000000000000aa"]],
    ]);
  });

  test("logs: a session rides as a top-level sessionId chip, which the explorer compiles and the aggregate requests carry", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [
        { facetKey: "attributes.k", value: "v" },
        { facetKey: "sessionId", value: "sess-1" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(filtersOf(link)).toEqual([
      ["attributes.k", ["v"]],
      ["sessionId", ["sess-1"]],
    ]);
    expect(link.notCarried).toEqual([]);
  });
  test("logs: resource facet chips (a Kubernetes cluster picked in the sidebar) are carried", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [
        { facetKey: "kubernetesClusterId", value: "651a0000000000000000cc" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(filtersOf(link)).toEqual([
      ["kubernetesClusterId", ["651a0000000000000000cc"]],
    ]);
    expect(link.notCarried).toEqual([]);
  });

  test("attribute values are escaped so the explorer reads the literal, not a wildcard", () => {
    for (const signal of SIGNALS) {
      const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
        signal,
        filters: [{ facetKey: "attributes.http.route", value: "/api/*" }],
        timeRange: PAST_ONE_HOUR,
      });

      const tuples: Array<[string, unknown]> = filtersOf(link) as Array<
        [string, unknown]
      >;
      const emitted: string =
        signal === "logs"
          ? (tuples[0]![1] as Array<string>)[0]!
          : (tuples[0]![1] as string);

      expect(emitted).toBe(buildSearchTokenValue("/api/*"));
      expect(emitted).not.toBe("/api/*");
      // What the explorer compiles the chip to: an equality on the literal.
      expect(compileAttributeChipValues([emitted])).toBe("/api/*");
      // And the unescaped value would have been a wildcard — the bug this guards.
      expect(typeof compileAttributeChipValues(["/api/*"])).toBe("object");
    }
  });

  test("an operator-valued attribute chip is not carried and is reported by key", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [
        {
          facetKey: "attributes.k8s.namespace.name",
          value: "is any of payments, checkout",
          rawValue: new Includes(["payments", "checkout"]),
        },
        {
          facetKey: "attributes.resource.host.name",
          value: "web-01",
          rawValue: "web-01",
        },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(filtersOf(link)).toEqual([
      ["attributes.resource.host.name", ["web-01"]],
    ]);
    expect(link.notCarried).toEqual(["attribute k8s.namespace.name"]);
  });

  test("traces: one pair per chip; sessions and span columns ride, severity does not", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "traces",
      filters: [
        {
          facetKey: "attributes.resource.k8s.cluster.name",
          value: "prod-eks-01",
        },
        {
          facetKey: "attributes.resource.k8s.cluster.name",
          value: "prod-eks-02",
        },
        { facetKey: "serviceId", value: "651a000000000000000000aa" },
        { facetKey: "sessionId", value: "sess-1" },
        { facetKey: "statusCode", value: "2" },
        { facetKey: "severityText", value: "Error" },
        { facetKey: "traceId", value: "t-1" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(pathOf(link)).toBe(`/dashboard/${PROJECT_ID}/traces`);
    expect(filtersOf(link)).toEqual([
      ["attributes.resource.k8s.cluster.name", "prod-eks-01"],
      ["attributes.resource.k8s.cluster.name", "prod-eks-02"],
      ["primaryEntityId", "651a000000000000000000aa"],
      ["sessionId", "sess-1"],
      ["statusCode", "2"],
      ["traceId", "t-1"],
    ]);
    expect(link.notCarried).toEqual(["severity"]);
  });

  test("metrics: only attribute and entity chips ride; everything else is reported", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "metrics",
      filters: [
        { facetKey: "attributes.resource.host.name", value: "web-01" },
        { facetKey: "serviceId", value: "651a000000000000000000aa" },
        { facetKey: "traceId", value: "t-1" },
        { facetKey: "spanId", value: "s-1" },
        { facetKey: "sessionId", value: "sess-1" },
        { facetKey: "severityText", value: "Error" },
        { facetKey: "kubernetesClusterId", value: "651a0000000000000000cc" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(pathOf(link)).toBe(`/dashboard/${PROJECT_ID}/metrics`);
    expect(filtersOf(link)).toEqual([
      ["attributes.resource.host.name", "web-01"],
      ["primaryEntityId", "651a000000000000000000aa"],
    ]);
    expect(link.notCarried).toEqual([
      "trace",
      "span",
      "session",
      "severity",
      "Kubernetes cluster",
    ]);
  });

  test("a Custom window travels as absolute start / end", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [],
      timeRange: customRange(),
    });

    expect(queryOf(link).get("range")).toBe(TimeRange.CUSTOM);
    expect(queryOf(link).get("start")).toBe(WINDOW_START.toISOString());
    expect(queryOf(link).get("end")).toBe(WINDOW_END.toISOString());
  });

  test("a Custom range with no dates carries no window at all", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [],
      timeRange: { range: TimeRange.CUSTOM },
    });

    expect(queryOf(link).get("range")).toBeNull();
    expect(queryOf(link).get("start")).toBeNull();
    expect(queryOf(link).get("end")).toBeNull();
  });

  test("nothing carried means no filters param — the window alone still opens the explorer", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [{ facetKey: "entityKeys", value: "3f9a1b2c4d5e6f70" }],
      timeRange: PAST_ONE_HOUR,
    });

    expect(filtersOf(link)).toBeNull();
    expect(queryOf(link).get("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(link.notCarried).toEqual(["resource"]);
  });
  test("blank keys and values are skipped rather than emitted as empty chips", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [
        { facetKey: "", value: "x" },
        { facetKey: "attributes.resource.host.name", value: "" },
        { facetKey: "traceId", value: "t-1" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(filtersOf(link)).toEqual([["traceId", ["t-1"]]]);
    expect(link.notCarried).toEqual([]);
  });

  test("the same unknown chip is reported once", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "metrics",
      filters: [
        { facetKey: "sessionId", value: "sess-1" },
        { facetKey: "sessionId", value: "sess-2" },
      ],
      timeRange: PAST_ONE_HOUR,
    });

    expect(link.notCarried).toEqual(["session"]);
  });

  test("every emitted URL names the current project — never the :projectId template", () => {
    for (const signal of SIGNALS) {
      const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
        signal,
        filters: [{ facetKey: "attributes.k", value: "v" }],
        timeRange: PAST_ONE_HOUR,
      });

      expect(pathOf(link)).toContain(`/dashboard/${PROJECT_ID}/`);
      expect(pathOf(link)).not.toContain(":projectId");
    }
  });

  test("throws when no project can be resolved, so a caller keeps the copy affordance rather than linking to the route template", () => {
    const previousWindow: unknown = (globalThis as Record<string, unknown>)[
      "window"
    ];
    // No project id in the path; the storages are stubbed to return null.
    (globalThis as Record<string, unknown>)["window"] = {
      ...(previousWindow as Record<string, unknown>),
      location: {
        pathname: "/",
        search: "",
        hash: "",
        href: "https://app.example.com/",
      },
    };

    try {
      expect(() => {
        return Scope.buildLockedScopeExplorerLink({
          signal: "logs",
          filters: [{ facetKey: "attributes.k", value: "v" }],
          timeRange: PAST_ONE_HOUR,
        });
      }).toThrow(Scope.ExplorerRouteUnavailableError);
    } finally {
      (globalThis as Record<string, unknown>)["window"] = previousWindow;
    }
  });
});
