/*
 * Saved views are listed on more than one surface — the logs facet sidebar,
 * the logs toolbar dropdown, and the shared telemetry dropdown that traces and
 * metrics mount. Issue 3319: every one of them rendered the whole list with no
 * way to narrow it, which is fine at two views and unusable at twenty.
 *
 * The facet sections next to them already solved this: search once the list is
 * long enough to need it, and collapse the tail behind "+N more". Those rules
 * live here so all three surfaces behave identically and the behaviour can be
 * tested once, on its own, instead of three times through three renderers.
 */

// The minimum shape every saved-view surface hands to this module.
export interface SavedViewListItem {
  id: string;
  name: string;
  isDefault?: boolean;
}

/*
 * Below this many views the search box is noise — it costs a row of chrome to
 * filter a list you can already read at a glance. Matches the facet sections'
 * threshold so the two never disagree about when a list is "long".
 */
export const SAVED_VIEWS_SEARCH_THRESHOLD: number = 6;

// How many rows a collapsed list shows before the "+N more" toggle.
export const SAVED_VIEWS_DEFAULT_VISIBLE_COUNT: number = 5;

export function shouldShowSavedViewsSearch(totalViews: number): boolean {
  return totalViews >= SAVED_VIEWS_SEARCH_THRESHOLD;
}

/*
 * Case-insensitive substring match on the view's name, same as the facet
 * search. Whitespace-only input is not a search: it filters nothing rather
 * than matching nothing.
 */
export function filterSavedViewsByName<T extends SavedViewListItem>(
  savedViews: Array<T>,
  searchText: string,
): Array<T> {
  const query: string = searchText.trim().toLowerCase();

  if (!query) {
    return savedViews;
  }

  return savedViews.filter((view: T): boolean => {
    return (view.name || "").toLowerCase().includes(query);
  });
}

export interface GetVisibleSavedViewsInput<T extends SavedViewListItem> {
  savedViews: Array<T>;
  searchText: string;
  showAll: boolean;
  visibleCount?: number | undefined;
  /*
   * The currently applied view, if any. It is pinned into the collapsed slice
   * even when it sorts past the cut, so a user who applied their twentieth
   * view still sees which one is on without expanding the list first.
   */
  selectedSavedViewId?: string | null | undefined;
}

export interface VisibleSavedViews<T extends SavedViewListItem> {
  // The rows to render, in list order.
  views: Array<T>;
  // Everything matching the search, whether or not it is currently shown.
  matchedViews: Array<T>;
  // True while a non-empty search is applied.
  isSearching: boolean;
  // Matching views the list is holding back right now — zero while expanded.
  hiddenCount: number;
  /*
   * Whether the toggle has anything to do at all, in either direction: true
   * when collapsing would hide rows, which is the same question as whether
   * expanding revealed any. Unlike hiddenCount it does not go quiet once the
   * list is expanded, so a consumer can render "Show less" from it and have
   * that control disappear the moment the list is short enough to fit.
   */
  hasMore: boolean;
}

export function getVisibleSavedViews<T extends SavedViewListItem>(
  input: GetVisibleSavedViewsInput<T>,
): VisibleSavedViews<T> {
  const isSearching: boolean = input.searchText.trim().length > 0;
  const matchedViews: Array<T> = filterSavedViewsByName(
    input.savedViews,
    input.searchText,
  );

  /*
   * A search is its own filter — collapsing its results behind "+N more"
   * would hide the very rows the user just asked for. Same call the facet
   * sections make, and with nothing held back there is no toggle to offer.
   */
  if (isSearching) {
    return {
      views: matchedViews,
      matchedViews: matchedViews,
      isSearching: true,
      hiddenCount: 0,
      hasMore: false,
    };
  }

  const visibleCount: number = Math.max(
    0,
    input.visibleCount ?? SAVED_VIEWS_DEFAULT_VISIBLE_COUNT,
  );

  const collapsedViews: Array<T> = matchedViews.slice(0, visibleCount);

  if (input.selectedSavedViewId) {
    const isSelectedVisible: boolean = collapsedViews.some(
      (view: T): boolean => {
        return view.id === input.selectedSavedViewId;
      },
    );

    if (!isSelectedVisible) {
      const selectedView: T | undefined = matchedViews.find(
        (view: T): boolean => {
          return view.id === input.selectedSavedViewId;
        },
      );

      if (selectedView) {
        collapsedViews.push(selectedView);
      }
    }
  }

  /*
   * How much the collapsed list holds back — computed whether or not the list
   * is currently expanded, because that is the only honest answer to "would
   * the toggle change anything". Reading it off the expanded state instead is
   * what leaves a "Show less" sitting under a list that already fits: expand a
   * twelve-view list, delete down to four, and the control has nothing left to
   * collapse. Note it counts what a collapse would hide, so a pinned applied
   * view — already on screen — is not counted, and a six-view list whose sixth
   * is applied correctly offers no toggle at all.
   */
  const hiddenWhenCollapsed: number =
    matchedViews.length - collapsedViews.length;
  const hasMore: boolean = hiddenWhenCollapsed > 0;

  if (input.showAll) {
    return {
      views: matchedViews,
      matchedViews: matchedViews,
      isSearching: false,
      hiddenCount: 0,
      hasMore: hasMore,
    };
  }

  return {
    views: collapsedViews,
    matchedViews: matchedViews,
    isSearching: false,
    hiddenCount: hiddenWhenCollapsed,
    hasMore: hasMore,
  };
}
