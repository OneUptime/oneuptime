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

  test("expanding shows the whole list and holds nothing back", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: true,
    });

    expect(visible.views).toHaveLength(12);
    expect(visible.hiddenCount).toBe(0);
  });

  test("an expanded list still reports that it has a tail to collapse", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: true,
    });

    /*
     * hiddenCount and hasMore answer different questions, and conflating them
     * is what left a dead "Show less" under a list that already fitted:
     * nothing is hidden right now, but collapsing would hide seven, so the
     * control has something to do.
     */
    expect(visible.hasMore).toBe(true);
  });

  test("an expanded list measures its tail against the caller's own cut", () => {
    const narrow: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(4),
      searchText: "",
      showAll: true,
      visibleCount: 2,
    });

    expect(narrow.views).toHaveLength(4);
    expect(narrow.hiddenCount).toBe(0);
    expect(narrow.hasMore).toBe(true);

    const wide: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(4),
      searchText: "",
      showAll: true,
      visibleCount: 10,
    });

    // Four views under a cut of ten: expanded or not, there is no tail.
    expect(wide.hasMore).toBe(false);
  });

  test("an expanded list that shrinks to fit stops offering a collapse", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(4),
      searchText: "",
      showAll: true,
    });

    /*
     * The shape of the bug this pins: a user expands twelve views, then
     * deletes down to four. showAll is still true — nothing resets it — so the
     * only thing that can retire the toggle is the list saying it has no tail.
     */
    expect(visible.views).toHaveLength(4);
    expect(visible.hasMore).toBe(false);
  });

  test("a collapsed list only claims a tail when it is really holding rows back", () => {
    /*
     * The pinned applied view is already on screen, so it is not part of the
     * tail: six views with the sixth applied are all visible while collapsed,
     * and offering "+0 more" there would be a control that does nothing.
     */
    const pinned: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(6),
      searchText: "",
      showAll: false,
      selectedSavedViewId: "view-6",
    });

    expect(pinned.views).toHaveLength(6);
    expect(pinned.hiddenCount).toBe(0);
    expect(pinned.hasMore).toBe(false);
  });

  test("hasMore and hiddenCount never disagree about a collapsed list", () => {
    for (let count: number = 0; count <= 14; count++) {
      const visible: VisibleSavedViews<SavedViewListItem> =
        getVisibleSavedViews({
          savedViews: makeViews(count),
          searchText: "",
          showAll: false,
        });

      expect(visible.hasMore).toBe(visible.hiddenCount > 0);
      expect(visible.hiddenCount).toBeGreaterThanOrEqual(0);
      expect(visible.views.length + visible.hiddenCount).toBe(count);
    }
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

describe("getVisibleSavedViews — an expanded list", () => {
  test("a search still reads as a search inside an expanded list", () => {
    /*
     * Expanding and then typing leaves both flags on at once. All three
     * surfaces derive "is this list expanded" from isSearching, so this is the
     * state that decides whether a "Show less" control sits beside filtered
     * results.
     */
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "view 1",
      showAll: true,
    });

    expect(visible.isSearching).toBe(true);
    expect(namesOf(visible.views)).toEqual([
      "View 1",
      "View 10",
      "View 11",
      "View 12",
    ]);
    expect(visible.matchedViews).toHaveLength(4);
    expect(visible.hiddenCount).toBe(0);
    expect(visible.hasMore).toBe(false);
  });

  test("an expanded list that never had a tail reports none", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT),
      searchText: "",
      showAll: true,
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(visible.hiddenCount).toBe(0);
    expect(visible.hasMore).toBe(false);
  });

  test("a search suppresses the tail report even while the list is expanded", () => {
    /*
     * Search results are the whole answer, so neither half of the collapse
     * toggle belongs beside them, expanded or not.
     */
    const matched: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "view 1",
      showAll: true,
    });

    expect(matched.hasMore).toBe(false);
    expect(matched.hiddenCount).toBe(0);

    const unmatched: VisibleSavedViews<SavedViewListItem> =
      getVisibleSavedViews({
        savedViews: makeViews(12),
        searchText: "nothing",
        showAll: true,
      });

    expect(unmatched.views).toEqual([]);
    expect(unmatched.hasMore).toBe(false);
  });
});

describe("getVisibleSavedViews — pinning against the cut", () => {
  test("pinning the applied view can complete the list", () => {
    /*
     * One view past the cut: the pin brings the last row in, so there is
     * nothing left to reveal and no "+N more" to offer.
     */
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(6),
      searchText: "",
      showAll: false,
      selectedSavedViewId: "view-6",
    });

    expect(namesOf(visible.views)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
      "View 6",
    ]);
    expect(visible.hiddenCount).toBe(0);
    expect(visible.hasMore).toBe(false);
  });

  test("a pinned row counts as shown under a caller-supplied cut too", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(6),
      searchText: "",
      showAll: false,
      visibleCount: 2,
      selectedSavedViewId: "view-5",
    });

    expect(namesOf(visible.views)).toEqual(["View 1", "View 2", "View 5"]);
    // Views 3, 4 and 6 — the pinned row is on screen, so it is not counted.
    expect(visible.hiddenCount).toBe(3);
    expect(visible.hasMore).toBe(true);
  });

  test("the applied view survives a cut of zero", () => {
    /*
     * A zero-width slice would otherwise leave the user with an empty list and
     * no sign of which view is currently applied.
     */
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(3),
      searchText: "",
      showAll: false,
      visibleCount: 0,
      selectedSavedViewId: "view-2",
    });

    expect(namesOf(visible.views)).toEqual(["View 2"]);
    expect(visible.hiddenCount).toBe(2);
    expect(visible.hasMore).toBe(true);
  });

  test("an empty applied id pins nothing rather than pinning the first view", () => {
    /*
     * Hosts that model "no view applied" as "" rather than null must land in
     * the same place as null — not on a view whose id happens to compare equal.
     */
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(12),
      searchText: "",
      showAll: false,
      selectedSavedViewId: "",
    });

    expect(visible.views).toHaveLength(SAVED_VIEWS_DEFAULT_VISIBLE_COUNT);
    expect(visible.hiddenCount).toBe(7);
    expect(visible.hasMore).toBe(true);
  });

  test("a cut wider than the list hides nothing", () => {
    /*
     * Slicing past the end is silent, so this is the only place a wrong sign in
     * the hiddenCount subtraction shows up — as "+-7 more".
     */
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(3),
      searchText: "",
      showAll: false,
      visibleCount: 10,
    });

    expect(visible.views).toHaveLength(3);
    expect(visible.hiddenCount).toBe(0);
    expect(visible.hasMore).toBe(false);
  });

  test("the applied view is listed once when it also matches the search", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: NAMED_VIEWS,
      searchText: "checkout",
      showAll: false,
      selectedSavedViewId: "checkout",
    });

    expect(namesOf(visible.views)).toEqual([
      "Checkout errors",
      "Staging checkout",
    ]);
  });
});

describe("filterSavedViewsByName — names with punctuation", () => {
  test("the query is matched literally, not as a pattern", () => {
    /*
     * Saved views get named after environments and services, so brackets and
     * dots land in the search box routinely. Treating the query as a pattern
     * would quietly widen these matches — and throw on an unbalanced bracket
     * mid-keystroke.
     */
    const views: Array<SavedViewListItem> = [
      { id: "bracketed", name: "View (1)" },
      { id: "dotted", name: "Prod.web" },
      { id: "hyphenated", name: "Prod-web" },
    ];

    expect(namesOf(filterSavedViewsByName(views, "(1)"))).toEqual(["View (1)"]);
    expect(namesOf(filterSavedViewsByName(views, "prod.web"))).toEqual([
      "Prod.web",
    ]);
  });
});

/*
 * showAll and a pinned applied view are each covered above, but never together
 * — and together is the branch the hasMore rewrite created. Replacing its
 * `hasMore` with the obvious-looking `matchedViews.length > visibleCount`
 * leaves every other case in this file green while reintroducing the dead
 * "Show less" on any expanded list whose applied view sat past the cut.
 */
describe("getVisibleSavedViews — an expanded list that is pinning a view", () => {
  test("no tail to collapse to, once the pin completes the list", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(6),
      searchText: "",
      showAll: true,
      selectedSavedViewId: "view-6",
    });

    /*
     * Collapsed, this list shows all six anyway — five under the cut plus the
     * pinned sixth. So expanded, there is nothing the toggle could collapse
     * to, and offering one would be offering a control that does nothing.
     */
    expect(visible.views).toHaveLength(6);
    expect(visible.hasMore).toBe(false);
  });

  test("a tail survives the pin when there is more than one row past the cut", () => {
    const visible: VisibleSavedViews<SavedViewListItem> = getVisibleSavedViews({
      savedViews: makeViews(7),
      searchText: "",
      showAll: true,
      selectedSavedViewId: "view-7",
    });

    /*
     * Collapsed this would show six of seven, so one row is genuinely hidden
     * and the way back has to stay on offer — otherwise a user who expanded
     * has no way to collapse again.
     */
    expect(visible.views).toHaveLength(7);
    expect(visible.hasMore).toBe(true);
  });

  test("an expanded list reports no tail exactly when a collapsed one holds nothing back", () => {
    for (let count: number = 0; count <= 14; count++) {
      const collapsed: VisibleSavedViews<SavedViewListItem> =
        getVisibleSavedViews({
          savedViews: makeViews(count),
          searchText: "",
          showAll: false,
        });

      const expanded: VisibleSavedViews<SavedViewListItem> =
        getVisibleSavedViews({
          savedViews: makeViews(count),
          searchText: "",
          showAll: true,
        });

      /*
       * The one place hiddenCount and hasMore are meant to disagree: expanded,
       * nothing is being held back right now, yet the toggle still has work to
       * do. Tying the two together is what produced the dead control.
       */
      expect(expanded.hiddenCount).toBe(0);
      expect(expanded.hasMore).toBe(collapsed.hasMore);
      expect(expanded.views).toHaveLength(count);
    }
  });
});
