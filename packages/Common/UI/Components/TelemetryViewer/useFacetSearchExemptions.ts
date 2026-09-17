import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FacetData } from "./types";
import {
  getFacetSearchExemptKeys,
  getNonEmptySearchTextByKey,
} from "./FacetVisibility";

export type FacetSearchChangeHandler = (
  facetKey: string,
  searchText: string,
) => void;

export interface FacetSearchExemptionsOptions {
  facetData: FacetData;
  // The sidebar's server-search callback, if the host supports one.
  onFacetSearchChange?: FacetSearchChangeHandler | undefined;
}

export interface FacetSearchExemptions {
  // Each section's search box text, lifted so it survives a remount.
  searchTextByKey: Readonly<Record<string, string>>;
  setSearchText: (facetKey: string, searchText: string) => void;
  /*
   * Search text (trimmed, non-empty) that was last sent to the server for a
   * facet when the current facetData arrived — i.e. the search the values on
   * screen answer.
   */
  searchedAtArrivalByKey: Readonly<Record<string, string>>;
  // Facets that must stay on screen because of search.
  searchExemptKeys: ReadonlySet<string>;
  /*
   * The debounced server-search callback for one facet: records what was
   * sent, then forwards it to onFacetSearchChange. The same function comes
   * back for a key on every render, so a section's debounce timer is not
   * re-armed each time the host re-renders. Undefined when the host gave no
   * onFacetSearchChange.
   */
  getSearchChangeHandler: (
    facetKey: string,
  ) => ((searchText: string) => void) | undefined;
}

export type UseFacetSearchExemptionsFunction = (
  options: FacetSearchExemptionsOptions,
) => FacetSearchExemptions;

/*
 * Resource facets are server-searchable, and a search that matches nothing
 * comes back as an empty list — exactly what "hide empty resource facets"
 * folds away. Left alone, the section would disappear under the user's
 * cursor, and clearing the box would make it vanish and reappear, because
 * the stale empty answer stays in facetData until the debounced refetch
 * lands.
 *
 * This hook owns the sections' search text and the record of what was last
 * sent to the server, and answers which facets are exempt from hiding.
 */
const useFacetSearchExemptions: UseFacetSearchExemptionsFunction = (
  options: FacetSearchExemptionsOptions,
): FacetSearchExemptions => {
  const [searchTextByKey, setSearchTextByKey] = useState<
    Record<string, string>
  >({});

  const lastEmittedRef: React.MutableRefObject<Record<string, string>> = useRef<
    Record<string, string>
  >({});

  const onFacetSearchChangeRef: React.MutableRefObject<
    FacetSearchChangeHandler | undefined
  > = useRef<FacetSearchChangeHandler | undefined>(options.onFacetSearchChange);

  useEffect(() => {
    onFacetSearchChangeRef.current = options.onFacetSearchChange;
  });

  const handlersRef: React.MutableRefObject<
    Map<string, (searchText: string) => void>
  > = useRef<Map<string, (searchText: string) => void>>(
    new Map<string, (searchText: string) => void>(),
  );

  const setSearchText: (facetKey: string, searchText: string) => void =
    useCallback((facetKey: string, searchText: string): void => {
      setSearchTextByKey(
        (previous: Record<string, string>): Record<string, string> => {
          if ((previous[facetKey] ?? "") === searchText) {
            return previous;
          }
          return { ...previous, [facetKey]: searchText };
        },
      );
    }, []);

  /*
   * Snapshotted once per facetData object, deliberately: what matters is
   * which searches were in flight when this response arrived, not what has
   * been sent since. Sending "" after clearing the box must not un-exempt
   * the stale empty answer still on screen — only the next response may.
   */
  const searchedAtArrivalByKey: Record<string, string> = useMemo(() => {
    return getNonEmptySearchTextByKey(lastEmittedRef.current);
  }, [options.facetData]);

  const searchExemptKeys: Set<string> = useMemo(() => {
    return getFacetSearchExemptKeys(searchTextByKey, searchedAtArrivalByKey);
  }, [searchTextByKey, searchedAtArrivalByKey]);

  const hasSearchCallback: boolean = options.onFacetSearchChange !== undefined;

  const getSearchChangeHandler: (
    facetKey: string,
  ) => ((searchText: string) => void) | undefined = (
    facetKey: string,
  ): ((searchText: string) => void) | undefined => {
    if (!hasSearchCallback) {
      return undefined;
    }

    const existing: ((searchText: string) => void) | undefined =
      handlersRef.current.get(facetKey);

    if (existing) {
      return existing;
    }

    const handler: (searchText: string) => void = (
      searchText: string,
    ): void => {
      // Recorded first, so a host that answers synchronously is covered.
      lastEmittedRef.current = {
        ...lastEmittedRef.current,
        [facetKey]: searchText,
      };
      onFacetSearchChangeRef.current?.(facetKey, searchText);
    };

    handlersRef.current.set(facetKey, handler);

    return handler;
  };

  return {
    searchTextByKey: searchTextByKey,
    setSearchText: setSearchText,
    searchedAtArrivalByKey: searchedAtArrivalByKey,
    searchExemptKeys: searchExemptKeys,
    getSearchChangeHandler: getSearchChangeHandler,
  };
};

export default useFacetSearchExemptions;
