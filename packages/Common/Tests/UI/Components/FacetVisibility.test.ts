import {
  DEFAULT_FACET_EMPTY_STATE_TEXT,
  FacetVisibility,
  FacetVisibilityOptions,
  computeFacetVisibility,
  formatEmptyFacetCount,
  formatHiddenFacetCount,
  getFacetEmptyStateText,
  getFacetNoMatchesText,
  getFacetSearchExemptKeys,
  getHiddenFacetEmptyStateText,
  getNonEmptySearchTextByKey,
  getSidebarFacetEmptyStateText,
} from "../../../UI/Components/TelemetryViewer/FacetVisibility";
import { FacetData } from "../../../UI/Components/TelemetryViewer/types";
import { describe, expect, test } from "@jest/globals";

/*
 * The rule behind "hide empty resource facets": which sections a sidebar
 * renders, which it folds into the "N empty filters hidden" footer, and
 * which it must keep no matter what because the user is working with them.
 * Pure, so every combination is pinned here as a truth table.
 */

const HIDEABLE: ReadonlySet<string> = new Set<string>([
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
]);

const TITLES: Record<string, string> = {
  severityText: "Severity",
  primaryEntityId: "Service",
  hostId: "Host",
  dockerHostId: "Docker Host",
  podmanHostId: "Podman Host",
  kubernetesClusterId: "Kubernetes Cluster",
};

function isHideable(key: string): boolean {
  return HIDEABLE.has(key);
}

function run(overrides: Partial<FacetVisibilityOptions>): FacetVisibility {
  return computeFacetVisibility({
    keys: ["hostId"],
    facetData: {},
    isHideable: isHideable,
    activeValuesByKey: {},
    searchExemptKeys: new Set<string>(),
    showHidden: false,
    getTitle: (key: string): string => {
      return TITLES[key] || key;
    },
    ...overrides,
  });
}

const ONE_VALUE: FacetData[string] = [{ value: "h1", count: 3 }];
const ZERO_COUNT_VALUE: FacetData[string] = [{ value: "h1", count: 0 }];

describe("computeFacetVisibility — a single hideable facet", () => {
  type Row = {
    name: string;
    values: FacetData[string] | undefined;
    active: boolean;
    exempt: boolean;
    showHidden: boolean;
    visible: boolean;
    hidden: boolean;
  };

  const rows: Array<Row> = [];

  /*
   * Every combination of data shape x selection x search exemption x the
   * footer toggle. The expected outcome is spelled out per row rather than
   * derived, so the table reads as the spec.
   */
  for (const shape of ["values", "zeroCounts", "empty", "undefined"] as const) {
    for (const active of [false, true]) {
      for (const exempt of [false, true]) {
        for (const showHidden of [false, true]) {
          const values: FacetData[string] | undefined =
            shape === "values"
              ? ONE_VALUE
              : shape === "zeroCounts"
                ? ZERO_COUNT_VALUE
                : shape === "empty"
                  ? []
                  : undefined;

          let visible: boolean;
          let hidden: boolean;

          if (shape === "values" || shape === "zeroCounts") {
            // Anything to show is shown, whatever the counts say.
            visible = true;
            hidden = false;
          } else if (shape === "empty") {
            // In use keeps it; otherwise hidden, and revealed on request.
            hidden = !active && !exempt;
            visible = !hidden || showHidden;
          } else {
            // Not loaded: never counted, shown only while in use.
            hidden = false;
            visible = active || exempt;
          }

          rows.push({
            name: `${shape} active=${active} exempt=${exempt} showHidden=${showHidden}`,
            values: values,
            active: active,
            exempt: exempt,
            showHidden: showHidden,
            visible: visible,
            hidden: hidden,
          });
        }
      }
    }
  }

  test("the table covers all 32 combinations", () => {
    expect(rows).toHaveLength(32);
  });

  test.each(rows)("$name", (row: Row) => {
    const facetData: FacetData = {};
    if (row.values !== undefined) {
      facetData["hostId"] = row.values;
    }

    const result: FacetVisibility = run({
      facetData: facetData,
      activeValuesByKey: row.active ? { hostId: new Set<string>(["h1"]) } : {},
      searchExemptKeys: row.exempt
        ? new Set<string>(["hostId"])
        : new Set<string>(),
      showHidden: row.showHidden,
    });

    expect(result.visibleKeys).toEqual(row.visible ? ["hostId"] : []);
    expect(result.hiddenKeys).toEqual(row.hidden ? ["hostId"] : []);
    expect(result.hiddenCount).toBe(row.hidden ? 1 : 0);
    expect(result.hiddenTitles).toEqual(row.hidden ? ["Host"] : []);
  });
});

describe("computeFacetVisibility — non-hideable facets", () => {
  const cases: Array<[string, FacetData[string] | undefined]> = [
    ["with values", ONE_VALUE],
    ["empty", []],
    ["not loaded", undefined],
  ];

  test.each(cases)(
    "a non-hideable facet %s always renders and is never counted",
    (_label: string, values: FacetData[string] | undefined) => {
      const facetData: FacetData = {};
      if (values !== undefined) {
        facetData["severityText"] = values;
      }

      for (const showHidden of [false, true]) {
        const result: FacetVisibility = run({
          keys: ["severityText"],
          facetData: facetData,
          showHidden: showHidden,
        });

        expect(result.visibleKeys).toEqual(["severityText"]);
        expect(result.hiddenCount).toBe(0);
        expect(result.hiddenKeys).toEqual([]);
      }
    },
  );

  test("the Service facet is never hidden even when empty", () => {
    const result: FacetVisibility = run({
      keys: ["primaryEntityId"],
      facetData: { primaryEntityId: [] },
    });

    expect(result.visibleKeys).toEqual(["primaryEntityId"]);
    expect(result.hiddenCount).toBe(0);
  });

  test("an active selection on an empty set does not count as a value", () => {
    const result: FacetVisibility = run({
      facetData: { hostId: [] },
      activeValuesByKey: { hostId: new Set<string>() },
    });

    expect(result.visibleKeys).toEqual([]);
    expect(result.hiddenKeys).toEqual(["hostId"]);
  });

  test("a selection or exemption on another key does not keep this one", () => {
    const result: FacetVisibility = run({
      keys: ["hostId", "dockerHostId"],
      facetData: { hostId: [], dockerHostId: [] },
      activeValuesByKey: { dockerHostId: new Set<string>(["d1"]) },
      searchExemptKeys: new Set<string>(["podmanHostId"]),
    });

    expect(result.visibleKeys).toEqual(["dockerHostId"]);
    expect(result.hiddenKeys).toEqual(["hostId"]);
  });
});

describe("computeFacetVisibility — a whole sidebar", () => {
  const KEYS: Array<string> = [
    "severityText",
    "primaryEntityId",
    "hostId",
    "dockerHostId",
    "podmanHostId",
    "kubernetesClusterId",
  ];

  const DATA: FacetData = {
    severityText: [],
    primaryEntityId: ONE_VALUE,
    hostId: ONE_VALUE,
    dockerHostId: [],
    podmanHostId: [],
    kubernetesClusterId: ZERO_COUNT_VALUE,
  };

  test("hidden facets are left out, in order, and counted with their titles", () => {
    const result: FacetVisibility = run({ keys: KEYS, facetData: DATA });

    expect(result.visibleKeys).toEqual([
      "severityText",
      "primaryEntityId",
      "hostId",
      "kubernetesClusterId",
    ]);
    expect(result.hiddenKeys).toEqual(["dockerHostId", "podmanHostId"]);
    expect(result.hiddenTitles).toEqual(["Docker Host", "Podman Host"]);
    expect(result.hiddenCount).toBe(2);
  });

  test("showHidden puts hidden facets back in their usual place, still counted", () => {
    const result: FacetVisibility = run({
      keys: KEYS,
      facetData: DATA,
      showHidden: true,
    });

    expect(result.visibleKeys).toEqual(KEYS);
    expect(result.hiddenKeys).toEqual(["dockerHostId", "podmanHostId"]);
    expect(result.hiddenCount).toBe(2);
  });

  test("the order of the given keys is the order of the result", () => {
    const reversed: Array<string> = [...KEYS].reverse();
    const result: FacetVisibility = run({
      keys: reversed,
      facetData: DATA,
      showHidden: true,
    });

    expect(result.visibleKeys).toEqual(reversed);
    expect(result.hiddenKeys).toEqual(["podmanHostId", "dockerHostId"]);
  });

  test("the first load ({}) renders only the non-hideable facets and counts nothing", () => {
    const result: FacetVisibility = run({ keys: KEYS, facetData: {} });

    expect(result.visibleKeys).toEqual(["severityText", "primaryEntityId"]);
    expect(result.hiddenCount).toBe(0);
    expect(result.hiddenTitles).toEqual([]);
  });

  test("titles default to the key when no getTitle is given", () => {
    const result: FacetVisibility = computeFacetVisibility({
      keys: ["hostId"],
      facetData: { hostId: [] },
      isHideable: isHideable,
      activeValuesByKey: {},
      searchExemptKeys: new Set<string>(),
      showHidden: false,
    });

    expect(result.hiddenTitles).toEqual(["hostId"]);
  });

  test("an empty key list is an empty result", () => {
    const result: FacetVisibility = run({ keys: [], facetData: DATA });

    expect(result).toEqual({
      visibleKeys: [],
      hiddenKeys: [],
      hiddenTitles: [],
      hiddenCount: 0,
    });
  });

  test("the inputs are not mutated", () => {
    const keys: Array<string> = [...KEYS];
    const data: FacetData = { ...DATA };

    run({ keys: keys, facetData: data, showHidden: true });

    expect(keys).toEqual(KEYS);
    expect(data).toEqual(DATA);
  });
});

describe("search exemptions", () => {
  test("getNonEmptySearchTextByKey trims and drops blank text", () => {
    expect(
      getNonEmptySearchTextByKey({
        hostId: "  web  ",
        dockerHostId: "",
        podmanHostId: "   ",
        kubernetesClusterId: undefined,
      }),
    ).toEqual({ hostId: "web" });
  });

  test("a box with text exempts its facet", () => {
    expect([...getFacetSearchExemptKeys({ hostId: "web" }, {})]).toEqual([
      "hostId",
    ]);
  });

  test("a search the on-screen data answers exempts its facet after the box is cleared", () => {
    expect([
      ...getFacetSearchExemptKeys({ hostId: "" }, { hostId: "web" }),
    ]).toEqual(["hostId"]);
  });

  test("whitespace alone exempts nothing", () => {
    expect(
      getFacetSearchExemptKeys({ hostId: "   " }, { dockerHostId: " " }).size,
    ).toBe(0);
  });

  test("both sources are unioned without duplicates", () => {
    const keys: Set<string> = getFacetSearchExemptKeys(
      { hostId: "a", dockerHostId: "b" },
      { hostId: "a", podmanHostId: "c" },
    );

    expect([...keys].sort()).toEqual([
      "dockerHostId",
      "hostId",
      "podmanHostId",
    ]);
  });
});

describe("footer and empty-state wording", () => {
  test("the hidden count reads singular and plural correctly", () => {
    expect(formatHiddenFacetCount(1)).toBe("1 empty filter hidden");
    expect(formatHiddenFacetCount(2)).toBe("2 empty filters hidden");
    expect(formatHiddenFacetCount(12)).toBe("12 empty filters hidden");
    expect(formatEmptyFacetCount(1)).toBe("1 empty filter");
    expect(formatEmptyFacetCount(0)).toBe("0 empty filters");
  });

  test("no-match text quotes the trimmed search", () => {
    expect(getFacetNoMatchesText("  web ")).toBe("No matches for “web”");
  });

  test("a resource facet's empty state names the resource", () => {
    expect(getHiddenFacetEmptyStateText("Docker Hosts")).toBe(
      "No Docker Hosts in this project",
    );
    expect(getHiddenFacetEmptyStateText(undefined)).toBe(
      "No values in this project",
    );
    expect(getHiddenFacetEmptyStateText("  ")).toBe(
      "No values in this project",
    );
  });

  test("a section's empty state prefers the search, then the sidebar's text, then the time range", () => {
    expect(
      getFacetEmptyStateText({
        searchText: "web",
        emptyStateText: "No Hosts in this project",
      }),
    ).toBe("No matches for “web”");
    expect(
      getFacetEmptyStateText({
        searchText: "  ",
        emptyStateText: "No Hosts in this project",
      }),
    ).toBe("No Hosts in this project");
    expect(getFacetEmptyStateText({ searchText: "" })).toBe(
      DEFAULT_FACET_EMPTY_STATE_TEXT,
    );
    expect(DEFAULT_FACET_EMPTY_STATE_TEXT).toBe("No values in this time range");
  });

  test("the sidebar's text: stale search result, then resource noun, then default", () => {
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: true,
        emptyStateNoun: "Hosts",
        searchedAtArrivalText: "web",
      }),
    ).toBe("No matches for “web”");
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: false,
        searchedAtArrivalText: "checkout",
      }),
    ).toBe("No matches for “checkout”");
    expect(
      getSidebarFacetEmptyStateText({
        isHideable: true,
        emptyStateNoun: "Hosts",
        searchedAtArrivalText: " ",
      }),
    ).toBe("No Hosts in this project");
    expect(getSidebarFacetEmptyStateText({ isHideable: true })).toBe(
      "No values in this project",
    );
    expect(
      getSidebarFacetEmptyStateText({ isHideable: false }),
    ).toBeUndefined();
  });
});
