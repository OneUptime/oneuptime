import { beforeAll, describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import {
  buildSearchTokenValue,
  compileAttributeChipValues,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import TimeRange from "Common/Types/Time/TimeRange";
import type RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import type { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import type { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import type { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
import type {
  LockedScopeExplorerLink,
  LockedScopeLinkFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScopeLink";
/*
 * Pure (nothing reads `window` at load), so these load statically, ahead of
 * the browser stub: the entity-key chips below are exactly the ones the
 * viewers build for an Inventory item's scope.
 */
import { buildLockedEntityKeyChips } from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  DEFAULT_ENTITY_KEY_DISPLAY_KEY,
  buildLockedScopeCopyText,
  describeLockedAttributeFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

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

  test("nothing carried means no filters param and a carried count of zero — a window-only URL no viewer offers", () => {
    const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
      signal: "logs",
      filters: [{ facetKey: "entityKeys", value: "3f9a1b2c4d5e6f70" }],
      timeRange: PAST_ONE_HOUR,
    });

    /*
     * The builder still returns the window-only URL (its shape is pinned
     * here); `carriedFilterCount` is what tells a viewer that this URL would
     * open the explorer unfiltered, so the viewer withholds the link.
     */
    expect(filtersOf(link)).toBeNull();
    expect(queryOf(link).get("range")).toBe(TimeRange.PAST_ONE_HOUR);
    expect(link.notCarried).toEqual(["resource"]);
    expect(link.carriedFilterCount).toBe(0);
  });

  describe("an entity-key locked scope — the pill on an Inventory item's pages", () => {
    const POD_KEY: string = "3f9a1b2c4d5e6f70";
    const NODE_KEY: string = "aaaaaaaaaaaaaaaa";
    const POD_NAME: string = "checkout-7d9f";

    const ATTRIBUTE_FILTER: LockedScopeLinkFilter = {
      facetKey: "attributes.resource.k8s.cluster.name",
      value: "prod-eks-01",
    };

    // How each explorer's URL grammar spells ATTRIBUTE_FILTER.
    const ATTRIBUTE_TUPLES: Record<TelemetrySignal, unknown> = {
      logs: [["attributes.resource.k8s.cluster.name", ["prod-eks-01"]]],
      traces: [["attributes.resource.k8s.cluster.name", "prod-eks-01"]],
      metrics: [["attributes.resource.k8s.cluster.name", "prod-eks-01"]],
    };

    type InventoryChipsFunction = (
      signal: TelemetrySignal,
    ) => Array<ActiveFilter>;

    // Two keys, one of them named — both chip shapes a viewer can show.
    const inventoryChips: InventoryChipsFunction = (
      signal: TelemetrySignal,
    ): Array<ActiveFilter> => {
      return buildLockedEntityKeyChips({
        rows: signal,
        entityKeys: [POD_KEY, NODE_KEY],
        displays: {
          [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: POD_NAME },
        },
      });
    };

    type LinkFiltersFunction = (
      chips: Array<ActiveFilter>,
    ) => Array<LockedScopeLinkFilter>;

    // What every viewer hands the link builder: facet key and value, never display text.
    const linkFiltersOf: LinkFiltersFunction = (
      chips: Array<ActiveFilter>,
    ): Array<LockedScopeLinkFilter> => {
      return chips.map((chip: ActiveFilter): LockedScopeLinkFilter => {
        return { facetKey: chip.facetKey, value: chip.value };
      });
    };

    test.each(SIGNALS)(
      "%s: an entity-key-only scope carries nothing — a window-only URL with a zero count, which no viewer offers — and reports the resource once",
      (signal: TelemetrySignal) => {
        const chips: Array<ActiveFilter> = inventoryChips(signal);

        expect(chips).toHaveLength(2);

        const link: LockedScopeExplorerLink =
          Scope.buildLockedScopeExplorerLink({
            signal,
            filters: linkFiltersOf(chips),
            timeRange: PAST_ONE_HOUR,
          });

        expect(pathOf(link)).toBe(`/dashboard/${PROJECT_ID}/${signal}`);
        expect(queryOf(link).get("filters")).toBeNull();
        expect(queryOf(link).get("range")).toBe(TimeRange.PAST_ONE_HOUR);
        expect(link.notCarried).toEqual(["resource"]);
        // Two keys, zero carried: the count the viewers withhold the link on.
        expect(link.carriedFilterCount).toBe(0);
      },
    );

    test.each(SIGNALS)(
      "%s: carried attribute chips beside the pill ride exactly as they do alone, before or after it",
      (signal: TelemetrySignal) => {
        const alone: LockedScopeExplorerLink =
          Scope.buildLockedScopeExplorerLink({
            signal,
            filters: [ATTRIBUTE_FILTER],
            timeRange: PAST_ONE_HOUR,
          });
        const pillFirst: LockedScopeExplorerLink =
          Scope.buildLockedScopeExplorerLink({
            signal,
            filters: [
              ...linkFiltersOf(inventoryChips(signal)),
              ATTRIBUTE_FILTER,
            ],
            timeRange: PAST_ONE_HOUR,
          });
        const pillLast: LockedScopeExplorerLink =
          Scope.buildLockedScopeExplorerLink({
            signal,
            filters: [
              ATTRIBUTE_FILTER,
              ...linkFiltersOf(inventoryChips(signal)),
            ],
            timeRange: PAST_ONE_HOUR,
          });

        expect(filtersOf(alone)).toEqual(ATTRIBUTE_TUPLES[signal]);
        expect(filtersOf(pillFirst)).toEqual(ATTRIBUTE_TUPLES[signal]);
        expect(filtersOf(pillLast)).toEqual(ATTRIBUTE_TUPLES[signal]);

        expect(alone.notCarried).toEqual([]);
        expect(pillFirst.notCarried).toEqual(["resource"]);
        expect(pillLast.notCarried).toEqual(["resource"]);

        // The pill adds nothing to the count; the attribute is the one carried filter.
        expect(alone.carriedFilterCount).toBe(1);
        expect(pillFirst.carriedFilterCount).toBe(1);
        expect(pillLast.carriedFilterCount).toBe(1);
      },
    );

    test.each(SIGNALS)(
      "%s: neither the entity's name nor its keys leak into the URL",
      (signal: TelemetrySignal) => {
        const url: string = Scope.buildLockedScopeExplorerLink({
          signal,
          filters: linkFiltersOf(inventoryChips(signal)),
          timeRange: PAST_ONE_HOUR,
        }).url.toString();

        for (const leaked of [
          POD_NAME,
          "Kubernetes",
          POD_KEY,
          NODE_KEY,
          "entityKeys",
        ]) {
          expect(url).not.toContain(leaked);
        }
      },
    );

    test("the caveat names the scope in the pill's own fallback word", () => {
      /*
       * Where the link is offered at all (a mixed scope; the pill alone
       * carries nothing and gets no link), "Open in Logs — not carried over:
       * resource" sits beside a pill that reads "Resource: 3f9a…" — the same
       * word, so the reader can match them.
       */
      const link: LockedScopeExplorerLink = Scope.buildLockedScopeExplorerLink({
        signal: "logs",
        filters: linkFiltersOf(inventoryChips("logs")),
        timeRange: PAST_ONE_HOUR,
      });

      expect(link.notCarried).toEqual([
        DEFAULT_ENTITY_KEY_DISPLAY_KEY.toLowerCase(),
      ]);
    });
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

/*
 * `carriedFilterCount` decides whether a viewer offers "Open in <explorer>"
 * at all: at least one locked filter with none carried means the URL is the
 * window alone, and the link would open that explorer unfiltered under a
 * label promising the page's scope. So every case checks the count against
 * the URL it came with, not only against a number — a count that drifted
 * from the `filters` param would hide a useful link or show a useless one.
 */
describe("buildLockedScopeExplorerLink — carriedFilterCount", () => {
  const SERVICE_ID: string = "651a000000000000000000aa";
  const OTHER_SERVICE_ID: string = "651a000000000000000000bb";
  const POD_KEY: string = "3f9a1b2c4d5e6f70";
  const NODE_KEY: string = "aaaaaaaaaaaaaaaa";

  const HOST_ATTRIBUTE: LockedScopeLinkFilter = {
    facetKey: "attributes.resource.host.name",
    value: "web-01",
  };

  const NAMESPACE_OPERATOR: LockedScopeLinkFilter = {
    facetKey: "attributes.k8s.namespace.name",
    value: "is any of payments, checkout",
    rawValue: new Includes(["payments", "checkout"]),
  };

  type LinkForFunction = (
    signal: TelemetrySignal,
    filters: Array<LockedScopeLinkFilter>,
  ) => LockedScopeExplorerLink;

  const linkFor: LinkForFunction = (
    signal: TelemetrySignal,
    filters: Array<LockedScopeLinkFilter>,
  ): LockedScopeExplorerLink => {
    return Scope.buildLockedScopeExplorerLink({
      signal,
      filters,
      timeRange: PAST_ONE_HOUR,
    });
  };

  type UrlValueCountFunction = (link: LockedScopeExplorerLink) => number;

  /*
   * How many filter values the URL's `filters` param holds, in either tuple
   * shape: logs groups a key's values into one `[key, values[]]`, traces and
   * metrics write one `[key, value]` pair per value.
   */
  const urlValueCount: UrlValueCountFunction = (
    link: LockedScopeExplorerLink,
  ): number => {
    const tuples: Array<[string, unknown]> | null = filtersOf(link) as Array<
      [string, unknown]
    > | null;

    if (tuples === null) {
      return 0;
    }

    let count: number = 0;

    for (const [, value] of tuples) {
      count += Array.isArray(value) ? value.length : 1;
    }

    return count;
  };

  type ExpectCarriedFunction = (
    link: LockedScopeExplorerLink,
    expected: number,
  ) => void;

  // The number, and the URL agreeing with it.
  const expectCarried: ExpectCarriedFunction = (
    link: LockedScopeExplorerLink,
    expected: number,
  ): void => {
    expect(link.carriedFilterCount).toBe(expected);
    expect(urlValueCount(link)).toBe(expected);

    if (expected === 0) {
      expect(queryOf(link).get("filters")).toBeNull();
    }
  };

  test.each(SIGNALS)(
    "%s: no locked filters, nothing carried and nothing reported",
    (signal: TelemetrySignal) => {
      const link: LockedScopeExplorerLink = linkFor(signal, []);

      expectCarried(link, 0);
      expect(link.notCarried).toEqual([]);
    },
  );

  test.each(SIGNALS)(
    "%s: every carried chip counts — an attribute and an entity",
    (signal: TelemetrySignal) => {
      const link: LockedScopeExplorerLink = linkFor(signal, [
        HOST_ATTRIBUTE,
        { facetKey: "primaryEntityId", value: SERVICE_ID },
      ]);

      expectCarried(link, 2);
      expect(link.notCarried).toEqual([]);
    },
  );

  test("a column counts only where that signal's explorer carries it", () => {
    interface ColumnCase {
      signal: TelemetrySignal;
      filters: Array<LockedScopeLinkFilter>;
      carried: number;
      notCarried: Array<string>;
    }

    const cases: Array<ColumnCase> = [
      {
        signal: "logs",
        filters: [
          { facetKey: "severityText", value: "Error" },
          { facetKey: "kubernetesClusterId", value: "651a0000000000000000cc" },
          { facetKey: "sessionId", value: "sess-1" },
        ],
        carried: 3,
        notCarried: [],
      },
      {
        signal: "traces",
        filters: [
          { facetKey: "statusCode", value: "2" },
          { facetKey: "sessionId", value: "sess-1" },
          { facetKey: "traceId", value: "t-1" },
        ],
        carried: 3,
        notCarried: [],
      },
      {
        signal: "traces",
        filters: [{ facetKey: "severityText", value: "Error" }],
        carried: 0,
        notCarried: ["severity"],
      },
      {
        signal: "metrics",
        filters: [
          { facetKey: "traceId", value: "t-1" },
          { facetKey: "sessionId", value: "sess-1" },
          { facetKey: "severityText", value: "Error" },
          { facetKey: "kubernetesClusterId", value: "651a0000000000000000cc" },
        ],
        carried: 0,
        notCarried: ["trace", "session", "severity", "Kubernetes cluster"],
      },
    ];

    for (const columnCase of cases) {
      const link: LockedScopeExplorerLink = linkFor(
        columnCase.signal,
        columnCase.filters,
      );
      const columns: Array<string> = columnCase.filters.map(
        (filter: LockedScopeLinkFilter): string => {
          return filter.facetKey;
        },
      );

      // The signal and columns ride along so a failure names its case.
      expect({
        signal: columnCase.signal,
        columns,
        carriedFilterCount: link.carriedFilterCount,
        urlValues: urlValueCount(link),
        notCarried: link.notCarried,
      }).toEqual({
        signal: columnCase.signal,
        columns,
        carriedFilterCount: columnCase.carried,
        urlValues: columnCase.carried,
        notCarried: columnCase.notCarried,
      });
    }
  });

  test.each(SIGNALS)(
    "%s: an entity-key-only scope carries nothing, however many keys it pins",
    (signal: TelemetrySignal) => {
      const link: LockedScopeExplorerLink = linkFor(signal, [
        { facetKey: "entityKeys", value: POD_KEY },
        { facetKey: "entityKeys", value: NODE_KEY },
      ]);

      expectCarried(link, 0);
      expect(link.notCarried).toEqual(["resource"]);
    },
  );

  test.each(SIGNALS)(
    "%s: a mixed scope counts the attribute, not the entity key, and keeps the caveat",
    (signal: TelemetrySignal) => {
      const link: LockedScopeExplorerLink = linkFor(signal, [
        { facetKey: "entityKeys", value: POD_KEY },
        HOST_ATTRIBUTE,
      ]);

      expectCarried(link, 1);
      expect(link.notCarried).toEqual(["resource"]);
    },
  );

  test.each(SIGNALS)(
    "%s: a repeated chip counts once, exactly as it appears once in the URL",
    (signal: TelemetrySignal) => {
      expectCarried(linkFor(signal, [HOST_ATTRIBUTE, HOST_ATTRIBUTE]), 1);

      // `serviceId` folds into `primaryEntityId`: the same entity twice is one chip.
      expectCarried(
        linkFor(signal, [
          { facetKey: "serviceId", value: SERVICE_ID },
          { facetKey: "primaryEntityId", value: SERVICE_ID },
        ]),
        1,
      );

      // Different values of one column are different chips.
      expectCarried(
        linkFor(signal, [
          HOST_ATTRIBUTE,
          { facetKey: HOST_ATTRIBUTE.facetKey, value: "web-02" },
        ]),
        2,
      );
      expectCarried(
        linkFor(signal, [
          { facetKey: "serviceId", value: SERVICE_ID },
          { facetKey: "primaryEntityId", value: OTHER_SERVICE_ID },
        ]),
        2,
      );

      // A repeated entity key is still nothing carried beside the one attribute.
      const mixed: LockedScopeExplorerLink = linkFor(signal, [
        { facetKey: "entityKeys", value: POD_KEY },
        { facetKey: "entityKeys", value: POD_KEY },
        HOST_ATTRIBUTE,
      ]);

      expectCarried(mixed, 1);
      expect(mixed.notCarried).toEqual(["resource"]);
    },
  );

  test.each(SIGNALS)(
    "%s: blank keys and values are neither counted nor reported",
    (signal: TelemetrySignal) => {
      const blanks: Array<LockedScopeLinkFilter> = [
        { facetKey: "", value: "x" },
        { facetKey: HOST_ATTRIBUTE.facetKey, value: "" },
        { facetKey: "entityKeys", value: "" },
        { facetKey: "primaryEntityId", value: "" },
      ];

      const onlyBlanks: LockedScopeExplorerLink = linkFor(signal, blanks);

      expectCarried(onlyBlanks, 0);
      expect(onlyBlanks.notCarried).toEqual([]);

      const withOneCarried: LockedScopeExplorerLink = linkFor(signal, [
        ...blanks,
        HOST_ATTRIBUTE,
      ]);

      expectCarried(withOneCarried, 1);
      expect(withOneCarried.notCarried).toEqual([]);
    },
  );

  test.each(SIGNALS)(
    "%s: an operator-valued attribute is not counted; a scalar (or absent) raw value is",
    (signal: TelemetrySignal) => {
      const operatorOnly: LockedScopeExplorerLink = linkFor(signal, [
        NAMESPACE_OPERATOR,
      ]);

      expectCarried(operatorOnly, 0);
      expect(operatorOnly.notCarried).toEqual(["attribute k8s.namespace.name"]);

      for (const rawValue of ["payments", 42, true, null, undefined]) {
        const scalar: LockedScopeExplorerLink = linkFor(signal, [
          {
            facetKey: NAMESPACE_OPERATOR.facetKey,
            value: "payments",
            rawValue,
          },
        ]);

        expect({
          rawValue,
          carriedFilterCount: scalar.carriedFilterCount,
          urlValues: urlValueCount(scalar),
          notCarried: scalar.notCarried,
        }).toEqual({
          rawValue,
          carriedFilterCount: 1,
          urlValues: 1,
          notCarried: [],
        });
      }

      const operatorBesideScalar: LockedScopeExplorerLink = linkFor(signal, [
        NAMESPACE_OPERATOR,
        HOST_ATTRIBUTE,
      ]);

      expectCarried(operatorBesideScalar, 1);
      expect(operatorBesideScalar.notCarried).toEqual([
        "attribute k8s.namespace.name",
      ]);
    },
  );

  test("the count matches the values the URL carries for every mix, on every signal", () => {
    const mixes: Array<Array<LockedScopeLinkFilter>> = [
      [],
      [HOST_ATTRIBUTE],
      [HOST_ATTRIBUTE, HOST_ATTRIBUTE],
      [{ facetKey: "entityKeys", value: POD_KEY }],
      [{ facetKey: "entityKeys", value: POD_KEY }, HOST_ATTRIBUTE],
      [NAMESPACE_OPERATOR],
      [NAMESPACE_OPERATOR, HOST_ATTRIBUTE],
      [
        { facetKey: "serviceId", value: SERVICE_ID },
        { facetKey: "primaryEntityId", value: SERVICE_ID },
        { facetKey: "primaryEntityId", value: OTHER_SERVICE_ID },
      ],
      [
        { facetKey: "traceId", value: "t-1" },
        { facetKey: "spanId", value: "s-1" },
        { facetKey: "sessionId", value: "sess-1" },
        { facetKey: "severityText", value: "Error" },
        { facetKey: "statusCode", value: "2" },
        { facetKey: "hostId", value: "651a0000000000000000dd" },
      ],
      [
        { facetKey: "", value: "x" },
        { facetKey: HOST_ATTRIBUTE.facetKey, value: "" },
        { facetKey: "attributes.http.route", value: "/api/*" },
      ],
    ];

    for (const signal of SIGNALS) {
      mixes.forEach(
        (filters: Array<LockedScopeLinkFilter>, mix: number): void => {
          const link: LockedScopeExplorerLink = linkFor(signal, filters);

          expect({ signal, mix, count: link.carriedFilterCount }).toEqual({
            signal,
            mix,
            count: urlValueCount(link),
          });
        },
      );
    }
  });
});

describe("buildLockedScopeFilterActions", () => {
  /*
   * The "Copy filter" / "Open in Traces | Metrics" actions those two viewers
   * hand their chips to. Their entity-key cases run on the viewers' real
   * chips in TracesEntityKeyLockedScope.test.ts and
   * MetricsEntityKeyLockedActions.test.ts; these are the builder's own rules.
   */
  const LOCKED_HOST: ActiveFilter = {
    facetKey: "attributes.resource.host.name",
    value: "web-01",
    displayKey: "Host",
    displayValue: "web-01",
    readOnly: true,
    lockedDetail: describeLockedAttributeFilter({
      signal: "traces",
      attributeKey: "resource.host.name",
      rawValue: "web-01",
      displayKey: "Host",
      displayValue: "web-01",
    }),
  };

  const USER_CONTAINER: ActiveFilter = {
    facetKey: "attributes.container.name",
    value: "postgres",
    displayKey: "container.name",
    displayValue: "postgres",
    readOnly: false,
  };

  test("nothing locked means no actions, however many of the user's own chips the bar holds", () => {
    for (const signal of ["traces", "metrics"] as Array<TelemetrySignal>) {
      expect(
        Scope.buildLockedScopeFilterActions({
          signal,
          chips: [],
          timeRange: PAST_ONE_HOUR,
        }),
      ).toBeUndefined();
      expect(
        Scope.buildLockedScopeFilterActions({
          signal,
          chips: [USER_CONTAINER],
          timeRange: PAST_ONE_HOUR,
        }),
      ).toBeUndefined();
    }
  });

  test("only the locked chips are copied and carried: the user's own chip reaches neither the text nor the link", () => {
    const actions: LockedFilterActionOptions | undefined =
      Scope.buildLockedScopeFilterActions({
        signal: "traces",
        chips: [LOCKED_HOST, USER_CONTAINER],
        timeRange: PAST_ONE_HOUR,
      });

    expect(actions!.copyText).toBe(
      buildLockedScopeCopyText("traces", [LOCKED_HOST]),
    );
    expect(actions!.copyText).not.toContain("postgres");

    const url: globalThis.URL = new globalThis.URL(
      actions!.openExplorerRoute!.toString(),
    );

    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/traces`);
    expect(JSON.parse(url.searchParams.get("filters")!)).toEqual([
      ["attributes.resource.host.name", "web-01"],
    ]);
    expect(actions!.notCarried).toEqual([]);
  });

  test("without a resolvable explorer route the copy text survives alone", () => {
    const previousWindow: unknown = (globalThis as Record<string, unknown>)[
      "window"
    ];
    // No project id in the path: the route cannot be populated.
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
      const copyText: string = buildLockedScopeCopyText("traces", [
        LOCKED_HOST,
      ]);

      expect(copyText.length).toBeGreaterThan(0);
      expect(
        Scope.buildLockedScopeFilterActions({
          signal: "traces",
          chips: [LOCKED_HOST],
          timeRange: PAST_ONE_HOUR,
        }),
      ).toEqual({ copyText });
    } finally {
      (globalThis as Record<string, unknown>)["window"] = previousWindow;
    }
  });
});
