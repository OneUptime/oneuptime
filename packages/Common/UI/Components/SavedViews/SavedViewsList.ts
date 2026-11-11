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

/*
 * A saved view's row in a dropdown, with its Update, Edit and Delete - both
 * dropdowns draw it with these, so they cannot drift apart.
 *
 * Where the pointer can hover, the actions are out of the layout until the
 * row is hovered or holds the focus (Tab from a name reaches them), so the
 * name has the row's width the rest of the time. Kept beside it,
 * see-through but in the layout all the same, they cut "Sign-up to first
 * project" to "Sign-up to fi..." in a German panel, and a keyboard's focus
 * on one showed nothing. A touch screen has no hover to show them on:
 * there they take a line of their own under the name, in view, and a size
 * a finger can hit.
 */
export function getSavedViewRowClassName(isSelected: boolean): string {
  return `group flex items-center gap-2 px-3 py-1.5 [@media(hover:none)]:flex-wrap [@media(hover:none)]:gap-y-1 ${
    isSelected ? "bg-indigo-50" : "hover:bg-gray-50 focus-within:bg-gray-50"
  }`;
}

// The row's name, the button that applies it: a line of its own on a touch screen.
export const SAVED_VIEW_ROW_NAME_CLASS_NAME: string =
  "flex min-w-0 flex-1 items-center gap-2 text-left [@media(hover:none)]:basis-full";

/*
 * The actions' box. In the row's line, not over the name: a box laid over
 * it needed the row's colour, and a dark page's translucent colours, laid
 * twice, drew it as a lighter block. Under the name on a touch screen, it
 * starts where the name does, past the checkmark's column (w-4 and the
 * row's gap-2).
 */
export const SAVED_VIEW_ROW_ACTIONS_CLASS_NAME: string =
  "flex shrink-0 items-center gap-0.5 [@media(hover:hover)]:group-[:not(:hover):not(:focus-within)]:hidden [@media(hover:none)]:basis-full [@media(hover:none)]:pl-6";

/*
 * Each action's box; its colours are its own. leading-4 keeps it as tall as
 * the name's line (2 + 16 + 2 = 20px): the 11px text's own line of 16.5px
 * grew a row by half a pixel when a hover showed its actions, and moved
 * every row under it.
 */
export const SAVED_VIEW_ROW_ACTION_CLASS_NAME: string =
  "rounded px-1.5 py-0.5 text-[11px] leading-4 transition-colors [@media(hover:none)]:px-2 [@media(hover:none)]:py-1 [@media(hover:none)]:text-xs";
