import { describe, expect, test } from "@jest/globals";
import {
  NO_FILTERS,
  applyListFilters,
  areFiltersEqual,
  clearFacet,
  countActiveFacets,
  emptyFilters,
  filtersForList,
  getFacetTitle,
  getFilterFacets,
  getFiltersKey,
  hasActiveFilters,
  isFacetActive,
  normalizeFilters,
  summarizeNames,
  toggleValue,
  type FilterFacet,
  type FilterableList,
  type RecordFilters,
} from "./recordFilters";

/*
 * The filter model every list reads. These rules decide what a list hides,
 * so each is pinned: a facet the list does not ask can never hide rows
 * without a chip saying so, a set of filters has one key whatever order its
 * values were picked in, and the sheet's answer never wipes the facets of
 * the screen's other list.
 */

function filters(overrides: Partial<RecordFilters> = {}): RecordFilters {
  return { ...emptyFilters(), ...overrides };
}

const ALL_LISTS: Array<FilterableList> = [
  "incidents",
  "incidentEpisodes",
  "alerts",
  "alertEpisodes",
  "monitors",
];

describe("getFilterFacets", () => {
  test("incidents and alerts ask owner first, then severity, state, labels and monitors", () => {
    expect(getFilterFacets("incidents")).toEqual([
      "owner",
      "severity",
      "state",
      "label",
      "monitor",
    ]);
    expect(getFilterFacets("alerts")).toEqual([
      "owner",
      "severity",
      "state",
      "label",
      "monitor",
    ]);
  });

  test("episodes have no monitors of their own to filter on", () => {
    expect(getFilterFacets("incidentEpisodes")).not.toContain("monitor");
    expect(getFilterFacets("alertEpisodes")).not.toContain("monitor");
  });

  test("monitors filter by owner, status, type and labels, never by severity", () => {
    expect(getFilterFacets("monitors")).toEqual([
      "owner",
      "state",
      "monitorType",
      "label",
    ]);
  });

  test("every list asks Owner first: it is what most people filter by", () => {
    ALL_LISTS.forEach((list: FilterableList): void => {
      expect(getFilterFacets(list)[0]).toBe("owner");
    });
  });
});

describe("NO_FILTERS and emptyFilters", () => {
  test("no filters is active on no list", () => {
    ALL_LISTS.forEach((list: FilterableList): void => {
      expect(hasActiveFilters(NO_FILTERS, list)).toBe(false);
      expect(countActiveFacets(emptyFilters(), list)).toBe(0);
    });
  });

  test("emptyFilters hands out a fresh object each time", () => {
    const first: RecordFilters = emptyFilters();
    first.stateIds.push("state-1");
    expect(emptyFilters().stateIds).toEqual([]);
    expect(NO_FILTERS.stateIds).toEqual([]);
  });
});

describe("isFacetActive", () => {
  test("owner is on for You, a person or a team", () => {
    expect(isFacetActive(filters({ ownedByMe: true }), "owner")).toBe(true);
    expect(isFacetActive(filters({ ownerUserIds: ["u1"] }), "owner")).toBe(
      true,
    );
    expect(isFacetActive(filters({ ownerTeamIds: ["t1"] }), "owner")).toBe(
      true,
    );
    expect(isFacetActive(filters(), "owner")).toBe(false);
  });

  test.each([
    ["state", { stateIds: ["s"] }],
    ["severity", { severityIds: ["s"] }],
    ["label", { labelIds: ["l"] }],
    ["monitor", { monitorIds: ["m"] }],
    ["monitorType", { monitorTypes: ["Website"] }],
  ] as Array<[FilterFacet, Partial<RecordFilters>]>)(
    "%s is on once it holds a value",
    (facet: FilterFacet, overrides: Partial<RecordFilters>) => {
      expect(isFacetActive(filters(overrides), facet)).toBe(true);
      expect(isFacetActive(filters(), facet)).toBe(false);
    },
  );
});

describe("countActiveFacets", () => {
  test("a facet counts once however many values it holds", () => {
    expect(
      countActiveFacets(
        filters({ severityIds: ["a", "b", "c"], ownedByMe: true }),
        "incidents",
      ),
    ).toBe(2);
  });

  test("You and named owners together are one Owner filter", () => {
    expect(
      countActiveFacets(
        filters({ ownedByMe: true, ownerTeamIds: ["t"], ownerUserIds: ["u"] }),
        "alerts",
      ),
    ).toBe(1);
  });

  test("a facet the list does not ask is never counted", () => {
    const withMonitors: RecordFilters = filters({ monitorIds: ["m1"] });
    expect(countActiveFacets(withMonitors, "incidents")).toBe(1);
    expect(countActiveFacets(withMonitors, "incidentEpisodes")).toBe(0);
    expect(hasActiveFilters(withMonitors, "incidentEpisodes")).toBe(false);
    expect(countActiveFacets(filters({ severityIds: ["s"] }), "monitors")).toBe(
      0,
    );
  });
});

describe("filtersForList", () => {
  test("drops what the list does not ask, keeps the rest", () => {
    const all: RecordFilters = filters({
      ownedByMe: true,
      severityIds: ["sev"],
      monitorIds: ["mon"],
      monitorTypes: ["Website"],
      labelIds: ["lab"],
    });
    expect(filtersForList(all, "incidentEpisodes")).toEqual(
      filters({ ownedByMe: true, severityIds: ["sev"], labelIds: ["lab"] }),
    );
    expect(filtersForList(all, "monitors")).toEqual(
      filters({
        ownedByMe: true,
        monitorTypes: ["Website"],
        labelIds: ["lab"],
      }),
    );
  });

  test("hands back copies, never the arrays it was given", () => {
    const original: RecordFilters = filters({ stateIds: ["s1"] });
    const copy: RecordFilters = filtersForList(original, "incidents");
    copy.stateIds.push("s2");
    expect(original.stateIds).toEqual(["s1"]);
  });
});

describe("applyListFilters", () => {
  test("the list's own facets take the sheet's values", () => {
    const current: RecordFilters = filters({ severityIds: ["old"] });
    const next: RecordFilters = filters({
      severityIds: ["new"],
      ownedByMe: true,
    });
    expect(applyListFilters(current, next, "incidents")).toEqual(
      filters({ severityIds: ["new"], ownedByMe: true }),
    );
  });

  test("an incident's Monitors survive a change made with the episodes on screen", () => {
    const current: RecordFilters = filters({ monitorIds: ["m1"] });
    // The episodes' sheet never shows Monitors, so it hands back none.
    const next: RecordFilters = filters({ labelIds: ["l1"] });
    expect(applyListFilters(current, next, "incidentEpisodes")).toEqual(
      filters({ monitorIds: ["m1"], labelIds: ["l1"] }),
    );
  });

  test("clearing a facet in the sheet clears it", () => {
    const current: RecordFilters = filters({
      ownedByMe: true,
      stateIds: ["s"],
    });
    expect(applyListFilters(current, emptyFilters(), "alerts")).toEqual(
      emptyFilters(),
    );
  });
});

describe("clearFacet", () => {
  test("clears only the facet named", () => {
    const all: RecordFilters = filters({
      ownedByMe: true,
      ownerUserIds: ["u"],
      ownerTeamIds: ["t"],
      stateIds: ["s"],
    });
    expect(clearFacet(all, "owner")).toEqual(filters({ stateIds: ["s"] }));
    expect(clearFacet(all, "state")).toEqual(
      filters({ ownedByMe: true, ownerUserIds: ["u"], ownerTeamIds: ["t"] }),
    );
  });

  test.each([
    ["severity", "severityIds"],
    ["label", "labelIds"],
    ["monitor", "monitorIds"],
    ["monitorType", "monitorTypes"],
  ] as Array<[FilterFacet, keyof RecordFilters]>)(
    "clears %s",
    (facet: FilterFacet, key: keyof RecordFilters) => {
      const set: RecordFilters = filters({ [key]: ["x"] });
      expect(clearFacet(set, facet)).toEqual(emptyFilters());
    },
  );
});

describe("toggleValue", () => {
  test("adds a value that is not there and removes one that is", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  test("never changes the list it was given", () => {
    const values: Array<string> = ["a"];
    toggleValue(values, "b");
    expect(values).toEqual(["a"]);
  });
});

describe("getFiltersKey", () => {
  test("the same filters in any order have the same key", () => {
    const a: RecordFilters = filters({
      severityIds: ["x", "y"],
      labelIds: ["1", "2"],
    });
    const b: RecordFilters = filters({
      severityIds: ["y", "x"],
      labelIds: ["2", "1"],
    });
    expect(getFiltersKey(a)).toBe(getFiltersKey(b));
    expect(areFiltersEqual(a, b)).toBe(true);
  });

  test("different filters have different keys, a facet's values never read as another's", () => {
    expect(getFiltersKey(filters({ stateIds: ["x"] }))).not.toBe(
      getFiltersKey(filters({ severityIds: ["x"] })),
    );
    expect(getFiltersKey(filters({ ownedByMe: true }))).not.toBe(
      getFiltersKey(filters()),
    );
  });
});

describe("normalizeFilters", () => {
  test("anything that is not filters is no filters", () => {
    expect(normalizeFilters(undefined)).toEqual(emptyFilters());
    expect(normalizeFilters("owner")).toEqual(emptyFilters());
    expect(normalizeFilters(null)).toEqual(emptyFilters());
  });

  test("keeps well-formed values, drops the rest, and each value once", () => {
    expect(
      normalizeFilters({
        ownedByMe: "yes",
        stateIds: ["s1", "s1", 4, "", null, "s2"],
        labelIds: "l1",
        monitorTypes: ["Website"],
      }),
    ).toEqual(filters({ stateIds: ["s1", "s2"], monitorTypes: ["Website"] }));
    expect(normalizeFilters({ ownedByMe: true }).ownedByMe).toBe(true);
  });
});

describe("getFacetTitle", () => {
  test("a monitor has a Status where a record has a State", () => {
    expect(getFacetTitle("state", "monitors")).toBe("Status");
    expect(getFacetTitle("state", "incidents")).toBe("State");
    expect(getFacetTitle("state", "alertEpisodes")).toBe("State");
  });

  test("every facet has a title on every list", () => {
    ALL_LISTS.forEach((list: FilterableList): void => {
      getFilterFacets(list).forEach((facet: FilterFacet): void => {
        expect(getFacetTitle(facet, list).length).toBeGreaterThan(0);
      });
    });
  });
});

describe("summarizeNames", () => {
  test("one name, two joined, then how many more", () => {
    expect(summarizeNames(["Critical"], 1)).toBe("Critical");
    expect(summarizeNames(["Critical", "Major"], 2)).toBe("Critical or Major");
    expect(summarizeNames(["Critical", "Major", "Minor"], 3)).toBe(
      "Critical, Major +1",
    );
  });

  test("names that have not arrived are counted, never shown as ids", () => {
    expect(summarizeNames([], 1)).toBe("1 selected");
    expect(summarizeNames([], 3)).toBe("3 selected");
    expect(summarizeNames(["Critical"], 2)).toBe("Critical +1");
  });

  test("nothing selected says nothing", () => {
    expect(summarizeNames([], 0)).toBe("");
  });
});
