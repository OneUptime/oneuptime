import { FacetData } from "./types";

/*
 * Which facet sections a telemetry sidebar (Logs, Traces, Metrics,
 * Exceptions) renders, and which it folds into the "N empty filters hidden"
 * footer instead.
 *
 * Only resource facets (Host, Docker Host, Kubernetes Cluster, ...) may be
 * folded away. The server answers every resource facet with the project's
 * full Postgres list — count 0 for a resource with no telemetry in range — so
 * an empty list means the project has no resource of that type at all (or a
 * facet search matched nothing). Service, severity, status and friends are
 * never hidden: an empty list there is a real answer about the time range.
 *
 * Kept free of React so every rule below is unit-testable as a truth table.
 */

export interface FacetVisibilityOptions {
  // Facet keys in the order the sidebar lists them.
  keys: ReadonlyArray<string>;
  facetData: FacetData;
  // Whether the facet may be folded away while it has nothing to show.
  isHideable: (facetKey: string) => boolean;
  activeValuesByKey: Readonly<Record<string, Set<string> | undefined>>;
  /*
   * Facets with a search in progress, or whose on-screen values answer a
   * search. Never folded away: the section is what the user is typing in.
   */
  searchExemptKeys: ReadonlySet<string>;
  // The footer's "Show" toggle: render hidden facets in their usual place.
  showHidden: boolean;
  // Section title per key, for the footer's tooltip. Defaults to the key.
  getTitle?: ((facetKey: string) => string) | undefined;
}

export interface FacetVisibility {
  // Keys to render, in the order they were given.
  visibleKeys: Array<string>;
  /*
   * Hideable keys with nothing to show, in order. Still listed while
   * showHidden reveals them, so the footer keeps its count.
   */
  hiddenKeys: Array<string>;
  // Titles of hiddenKeys, same order.
  hiddenTitles: Array<string>;
  hiddenCount: number;
}

export const DEFAULT_FACET_EMPTY_STATE_TEXT: string =
  "No values in this time range";

const hasActiveValues: (activeValues: Set<string> | undefined) => boolean = (
  activeValues: Set<string> | undefined,
): boolean => {
  return Boolean(activeValues && activeValues.size > 0);
};

export const computeFacetVisibility: (
  options: FacetVisibilityOptions,
) => FacetVisibility = (options: FacetVisibilityOptions): FacetVisibility => {
  const visibleKeys: Array<string> = [];
  const hiddenKeys: Array<string> = [];

  for (const key of options.keys) {
    if (!options.isHideable(key)) {
      visibleKeys.push(key);
      continue;
    }

    const isInUse: boolean =
      hasActiveValues(options.activeValuesByKey[key]) ||
      options.searchExemptKeys.has(key);

    const values: FacetData[string] | undefined = options.facetData[key];

    if (values === undefined) {
      /*
       * Not loaded yet (or not returned). Rendering it would flash a dozen
       * empty resource sections — and a bogus "12 hidden" count — on every
       * first load, so it is neither shown nor counted. The exception is a
       * facet the user is working with: a selection or a search box must not
       * vanish because a refetch failed.
       */
      if (isInUse) {
        visibleKeys.push(key);
      }
      continue;
    }

    if (values.length > 0 || isInUse) {
      visibleKeys.push(key);
      continue;
    }

    hiddenKeys.push(key);

    if (options.showHidden) {
      visibleKeys.push(key);
    }
  }

  const getTitle: (facetKey: string) => string =
    options.getTitle ||
    ((facetKey: string): string => {
      return facetKey;
    });

  return {
    visibleKeys: visibleKeys,
    hiddenKeys: hiddenKeys,
    hiddenTitles: hiddenKeys.map((key: string): string => {
      return getTitle(key);
    }),
    hiddenCount: hiddenKeys.length,
  };
};

// Keeps only entries with non-blank text, trimmed.
export const getNonEmptySearchTextByKey: (
  searchTextByKey: Readonly<Record<string, string | undefined>>,
) => Record<string, string> = (
  searchTextByKey: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, text] of Object.entries(searchTextByKey)) {
    const trimmed: string = (text || "").trim();
    if (trimmed) {
      result[key] = trimmed;
    }
  }

  return result;
};

/*
 * Facets a sidebar must keep on screen because of search:
 *   - the box currently holds text (typing, or waiting on the debounce), or
 *   - the values on screen answer a search — the text last sent to the
 *     server was non-empty when this facetData arrived. Clearing the box
 *     leaves that stale, empty answer in place until the refetch lands, and
 *     the section must not blink out and back in meanwhile.
 */
export const getFacetSearchExemptKeys: (
  searchTextByKey: Readonly<Record<string, string | undefined>>,
  searchedAtArrivalByKey: Readonly<Record<string, string | undefined>>,
) => Set<string> = (
  searchTextByKey: Readonly<Record<string, string | undefined>>,
  searchedAtArrivalByKey: Readonly<Record<string, string | undefined>>,
): Set<string> => {
  return new Set<string>([
    ...Object.keys(getNonEmptySearchTextByKey(searchTextByKey)),
    ...Object.keys(getNonEmptySearchTextByKey(searchedAtArrivalByKey)),
  ]);
};

// "1 empty filter", "3 empty filters".
export const formatEmptyFacetCount: (count: number) => string = (
  count: number,
): string => {
  return `${count} empty ${count === 1 ? "filter" : "filters"}`;
};

// "1 empty filter hidden", "3 empty filters hidden".
export const formatHiddenFacetCount: (hiddenCount: number) => string = (
  hiddenCount: number,
): string => {
  return `${formatEmptyFacetCount(hiddenCount)} hidden`;
};

export const getFacetNoMatchesText: (searchText: string) => string = (
  searchText: string,
): string => {
  return `No matches for “${searchText.trim()}”`;
};

// Empty state of a resource facet: the project has none of that resource.
export const getHiddenFacetEmptyStateText: (
  pluralNoun: string | undefined,
) => string = (pluralNoun: string | undefined): string => {
  const noun: string = (pluralNoun || "").trim();
  return noun ? `No ${noun} in this project` : "No values in this project";
};

export interface FacetEmptyStateTextOptions {
  // The section's search text right now.
  searchText: string;
  // The sidebar's text for this facet; defaults to the time-range wording.
  emptyStateText?: string | undefined;
}

export const getFacetEmptyStateText: (
  options: FacetEmptyStateTextOptions,
) => string = (options: FacetEmptyStateTextOptions): string => {
  if (options.searchText.trim()) {
    return getFacetNoMatchesText(options.searchText);
  }
  return options.emptyStateText || DEFAULT_FACET_EMPTY_STATE_TEXT;
};

export interface SidebarFacetEmptyStateOptions {
  isHideable: boolean;
  // Plural noun for a hideable facet ("Docker Hosts").
  emptyStateNoun?: string | undefined;
  /*
   * Search text the on-screen values answer, if any (see
   * getFacetSearchExemptKeys). While it is set the list is a search result,
   * even though the box has since been cleared.
   */
  searchedAtArrivalText?: string | undefined;
}

/*
 * The empty-state line a sidebar hands a section for when its box is empty.
 * Undefined means "use the section's default".
 */
export const getSidebarFacetEmptyStateText: (
  options: SidebarFacetEmptyStateOptions,
) => string | undefined = (
  options: SidebarFacetEmptyStateOptions,
): string | undefined => {
  if (options.searchedAtArrivalText && options.searchedAtArrivalText.trim()) {
    return getFacetNoMatchesText(options.searchedAtArrivalText);
  }
  if (options.isHideable) {
    return getHiddenFacetEmptyStateText(options.emptyStateNoun);
  }
  return undefined;
};
