import React, { useEffect, useRef, useState } from "react";

export const FACET_SEARCH_DEBOUNCE_MS: number = 300;

export interface FacetSectionSearchOptions {
  /*
   * Controlled search text. When set, the section shows this and reports
   * edits through onSearchTextChange; when undefined it keeps its own.
   */
  searchText?: string | undefined;
  onSearchTextChange?: ((searchText: string) => void) | undefined;
  /*
   * Debounced server search: called with the trimmed text 300ms after the
   * last edit, and once on mount, so the host can refetch facet values.
   */
  onSearchChange?: ((searchText: string) => void) | undefined;
  /*
   * Whether the section is showing its search box. A query the user can no
   * longer see is a filter they cannot cancel, so it stops applying — and is
   * cleared — while the box is gone.
   */
  isSearchVisible: boolean;
}

export interface FacetSectionSearch {
  // What the box shows.
  searchText: string;
  // What the section filters by: the box's text, or "" while it is hidden.
  activeSearchText: string;
  setSearchText: (searchText: string) => void;
}

export type UseFacetSectionSearchFunction = (
  options: FacetSectionSearchOptions,
) => FacetSectionSearch;

/*
 * The search state every facet section shares (Logs and Telemetry alike):
 * controlled or uncontrolled text, and the debounced upward emit. The local
 * filter applies immediately; only the server round-trip waits.
 */
const useFacetSectionSearch: UseFacetSectionSearchFunction = (
  options: FacetSectionSearchOptions,
): FacetSectionSearch => {
  const [localSearchText, setLocalSearchText] = useState<string>("");

  const isControlled: boolean = options.searchText !== undefined;
  const searchText: string = isControlled
    ? options.searchText || ""
    : localSearchText;

  const onSearchTextChange: FacetSectionSearchOptions["onSearchTextChange"] =
    options.onSearchTextChange;

  const setSearchText: (nextSearchText: string) => void = (
    nextSearchText: string,
  ): void => {
    if (!isControlled) {
      setLocalSearchText(nextSearchText);
    }
    onSearchTextChange?.(nextSearchText);
  };

  const onSearchChange: FacetSectionSearchOptions["onSearchChange"] =
    options.onSearchChange;
  const lastEmittedRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  useEffect(() => {
    if (!onSearchChange) {
      return;
    }
    const trimmed: string = searchText.trim();
    if (lastEmittedRef.current === trimmed) {
      return;
    }
    const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
      lastEmittedRef.current = trimmed;
      onSearchChange(trimmed);
    }, FACET_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [searchText, onSearchChange]);

  const hasSearchText: boolean = searchText !== "";

  useEffect(() => {
    if (!options.isSearchVisible && hasSearchText) {
      setSearchText("");
    }
  }, [options.isSearchVisible, hasSearchText]);

  return {
    searchText: searchText,
    activeSearchText: options.isSearchVisible ? searchText : "",
    setSearchText: setSearchText,
  };
};

export default useFacetSectionSearch;
