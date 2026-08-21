import {
  SAVED_VIEWS_DEFAULT_VISIBLE_COUNT,
  SAVED_VIEWS_SEARCH_THRESHOLD,
  SavedViewListItem,
  VisibleSavedViews,
  filterSavedViewsByName,
  getVisibleSavedViews,
  shouldShowSavedViewsSearch,
} from "../../../UI/Components/SavedViews/SavedViewsList";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue 3319: three separate saved-views surfaces each rendered the whole list
 * with no way to narrow it. The rules that fix that — when a search box is
 * worth its space, what a search matches, and how much of the tail a collapsed
 * list holds back — live in one module so all three agree, and are pinned here
 * rather than three times over through three renderers.
 */

function makeViews(count: number): Array<SavedViewListItem> {
  const views: Array<SavedViewListItem> = [];

  for (let index: number = 1; index <= count; index++) {
    views.push({ id: `view-${index}`, name: `View ${index}` });
  }

  return views;
}

function namesOf(views: Array<SavedViewListItem>): Array<string> {
  return views.map((view: SavedViewListItem): string => {
    return view.name;
  });
}

const NAMED_VIEWS: Array<SavedViewListItem> = [
  { id: "ims", name: "IMS Logs" },
  { id: "qa", name: "QA-JDE", isDefault: true },
  { id: "checkout", name: "Checkout errors" },
  { id: "staging", name: "Staging checkout" },
];

describe("shouldShowSavedViewsSearch", () => {
  test("a list short enough to read at a glance gets no search box", () => {
    expect(shouldShowSavedViewsSearch(0)).toBe(false);
    expect(shouldShowSavedViewsSearch(1)).toBe(false);
    expect(shouldShowSavedViewsSearch(SAVED_VIEWS_SEARCH_THRESHOLD - 1)).toBe(
      false,
    );
  });

  test("the search box appears at the threshold and stays", () => {
    expect(shouldShowSavedViewsSearch(SAVED_VIEWS_SEARCH_THRESHOLD)).toBe(true);
    expect(shouldShowSavedViewsSearch(SAVED_VIEWS_SEARCH_THRESHOLD + 50)).toBe(
      true,
    );
  });

  test("the threshold is above the collapsed row count", () => {
    /*
     * Otherwise a list could be collapsed behind "+N more" with no search box
     * to find what was collapsed — the exact bind issue 3319 describes.
     */
    expect(SAVED_VIEWS_SEARCH_THRESHOLD).toBeGreaterThan(
      SAVED_VIEWS_DEFAULT_VISIBLE_COUNT,
    );
  });
});

describe("filterSavedViewsByName", () => {
  test("matches a substring anywhere in the name", () => {
    expect(namesOf(filterSavedViewsByName(NAMED_VIEWS, "checkout"))).toEqual([
      "Checkout errors",
      "Staging checkout",
    ]);
  });

  test("ignores case on both sides of the match", () => {
    expect(namesOf(filterSavedViewsByName(NAMED_VIEWS, "ims"))).toEqual([
      "IMS Logs",
    ]);
    expect(namesOf(filterSavedViewsByName(NAMED_VIEWS, "QA-jde"))).toEqual([
      "QA-JDE",
    ]);
  });

  test("surrounding whitespace is not part of the query", () => {
    expect(namesOf(filterSavedViewsByName(NAMED_VIEWS, "  ims  "))).toEqual([
      "IMS Logs",
    ]);
  });

  test("an empty or whitespace-only query filters nothing", () => {
    expect(filterSavedViewsByName(NAMED_VIEWS, "")).toHaveLength(
      NAMED_VIEWS.length,
    );
    expect(filterSavedViewsByName(NAMED_VIEWS, "   ")).toHaveLength(
      NAMED_VIEWS.length,
    );
  });

  test("a query nothing matches returns nothing", () => {
    expect(filterSavedViewsByName(NAMED_VIEWS, "nothing here")).toEqual([]);
  });

  test("a view saved without a name is skipped rather than thrown over", () => {
    const views: Array<SavedViewListItem> = [
      ...NAMED_VIEWS,
      { id: "blank", name: "" },
    ];

    expect(namesOf(filterSavedViewsByName(views, "ims"))).toEqual(["IMS Logs"]);
    expect(filterSavedViewsByName(views, "")).toHaveLength(views.length);
  });

  test("the input list is never reordered or mutated", () => {
    const views: Array<SavedViewListItem> = makeViews(4);
    const before: Array<string> = namesOf(views);

    filterSavedViewsByName(views, "view");

    expect(namesOf(views)).toEqual(before);
  });
});

describe("getVisibleSavedViews — the collapsed list", () => {
  test("holds back everything past the visible count", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(namesOf(visible.views)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(visible.hiddenCount).toBe(7);
    expect(visible.hasMore).toBe(true);
    expect(visible.isSearching).toBe(false);
    expect(visible.matchedViews).toHaveLength(12);
  });

  test("a list that already fits has nothing to expand", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT),
      searchText: "",
      showAll: false,
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(visible.hiddenCount).toBe(0);
    expect(visible.hasMore).toBe(false);
  });

  test("an empty list is empty rather than an error", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: [],
      searchText: "",
      showAll: false,
    });

    expect(visible.views).toEqual([]);
    expect(visible.matchedViews).toEqual([]);
    expect(visible.hasMore).toBe(false);
  });

  test("expanding shows the whole list and leaves nothing to expand", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: true,
    });

    expect(visible.views).toHaveLength(12);
    expect(visible.hiddenCount).toBe(0);
    expect(visible.hasMore).toBe(false);
  });

  test("the caller can pick its own visible count", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
      visibleCount: 2,
    });

    expect(namesOf(visible.views)).toEqual(["View 1", "View 2"]);
    expect(visible.hiddenCount).toBe(10);
  });

  test("a nonsensical visible count collapses to nothing rather than inverting the slice", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(3),
      searchText: "",
      showAll: false,
      visibleCount: -5,
    });

    expect(visible.views).toEqual([]);
    expect(visible.hiddenCount).toBe(3);
    expect(visible.hasMore).toBe(true);
  });

  test("the source list is not mutated by slicing or pinning", () => {
    const views: Array<SavedViewListItem> = makeViews(12);

    getVisibleSavedViews({
      savedViews: views,
      searchText: "",
      showAll: false,
      selectedSavedViewId: "view-11",
    });

    expect(views).toHaveLength(12);
    expect(namesOf(views)[0]).toBe("View 1");
  });
});

describe("getVisibleSavedViews — searching", () => {
  test("a search shows every match, not the first few", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "view 1",
      showAll: false,
    });

    // View 1, and View 10 through View 12.
    expect(namesOf(visible.views)).toEqual([
      "View 1",
      "View 10",
      "View 11",
      "View 12",
    ]);
    expect(visible.isSearching).toBe(true);
    expect(visible.hasMore).toBe(false);
    expect(visible.hiddenCount).toBe(0);
  });

  test("a search that matches nothing reports itself as a search", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "nothing",
      showAll: false,
    });

    expect(visible.views).toEqual([]);
    expect(visible.matchedViews).toEqual([]);
    expect(visible.isSearching).toBe(true);
    expect(visible.hasMore).toBe(false);
  });

  test("whitespace alone is not a search", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "   ",
      showAll: false,
    });

    expect(visible.isSearching).toBe(false);
    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(visible.hasMore).toBe(true);
  });
});

describe("getVisibleSavedViews — keeping the applied view in sight", () => {
  test("the applied view is pinned into a collapsed list it sorts past", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
      selectedSavedViewId: "view-11",
    });

    expect(namesOf(visible.views)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
      "View 11",
    ]);
    // The pinned row is no longer hidden, so it is not counted as hidden.
    expect(visible.hiddenCount).toBe(6);
    expect(visible.hasMore).toBe(true);
  });

  test("an applied view already in the slice is not listed twice", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
      selectedSavedViewId: "view-3",
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(namesOf(visible.views)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
  });

  test("an id that matches no view pins nothing", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
      selectedSavedViewId: "deleted-view",
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(visible.hiddenCount).toBe(7);
  });

  test("no applied view pins nothing", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
      selectedSavedViewId: null,
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
  });

  test("a search the applied view does not match still hides it", () => {
    /*
     * The user asked to see matches. Smuggling a non-matching row back in
     * because it happens to be applied would make the result a lie.
     */
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: NAMED_VIEWS,
      searchText: "checkout",
      showAll: false,
      selectedSavedViewId: "ims",
    });

    expect(namesOf(visible.views)).toEqual([
      "Checkout errors",
      "Staging checkout",
    ]);
  });
});
