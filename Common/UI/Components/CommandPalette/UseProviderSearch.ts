import { PaletteSearchProvider, PaletteSearchResult } from "./Types";
import React, { useEffect, useMemo, useRef, useState } from "react";

/*
 * Async search-provider plumbing for the command palette, isolated from the
 * rendering so the timing contract (debounce, stale discard, per-provider
 * error isolation) is directly unit-testable with fake timers.
 */

export const PROVIDER_SEARCH_DEBOUNCE_MS: number = 200;
export const PROVIDER_SEARCH_MIN_QUERY_LENGTH: number = 2;

export interface ProviderSearchSection {
  provider: PaletteSearchProvider;
  results: Array<PaletteSearchResult>;
  /** True from the moment the debounced search fires until this provider settles. */
  isPending: boolean;
}

/**
 * Runs every provider in parallel against the query, 200ms after the user
 * stops typing and only once the query is at least 2 characters.
 *
 * - Stale responses are discarded: each debounced dispatch bumps a sequence
 *   token, and a response only lands if its token is still current.
 * - Providers are isolated: one rejecting shows an empty section for that
 *   provider and never disturbs the others (and never throws).
 *
 * NOTE for callers: memoize the `providers` array (useMemo) — a fresh array
 * identity on every render restarts the debounce timer each keystroke's
 * re-render, effectively working but wastefully re-arming.
 */
const useProviderSearch: (
  providers: Array<PaletteSearchProvider>,
  query: string,
) => Array<ProviderSearchSection> = (
  providers: Array<PaletteSearchProvider>,
  query: string,
): Array<ProviderSearchSection> => {
  const [resultsByProviderId, setResultsByProviderId] = useState<
    Record<string, Array<PaletteSearchResult>>
  >({});
  const [pendingByProviderId, setPendingByProviderId] = useState<
    Record<string, boolean>
  >({});
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const trimmedQuery: string = query.trim();

  useEffect(() => {
    if (providers.length === 0) {
      return undefined;
    }

    if (trimmedQuery.length < PROVIDER_SEARCH_MIN_QUERY_LENGTH) {
      // Invalidate anything still in flight and clear old results.
      sequenceRef.current++;
      setResultsByProviderId({});
      setPendingByProviderId({});
      return undefined;
    }

    const debounceTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      const sequence: number = ++sequenceRef.current;

      const allPending: Record<string, boolean> = {};
      providers.forEach((provider: PaletteSearchProvider) => {
        allPending[provider.id] = true;
      });
      setPendingByProviderId(allPending);

      providers.forEach((provider: PaletteSearchProvider) => {
        provider
          .search(trimmedQuery)
          .then((results: Array<PaletteSearchResult>) => {
            if (sequence !== sequenceRef.current) {
              return; // A newer query has been dispatched since.
            }
            setResultsByProviderId(
              (
                previous: Record<string, Array<PaletteSearchResult>>,
              ): Record<string, Array<PaletteSearchResult>> => {
                return { ...previous, [provider.id]: results };
              },
            );
            setPendingByProviderId(
              (previous: Record<string, boolean>): Record<string, boolean> => {
                return { ...previous, [provider.id]: false };
              },
            );
          })
          .catch(() => {
            // A failed provider simply shows nothing — never an error state.
            if (sequence !== sequenceRef.current) {
              return;
            }
            setResultsByProviderId(
              (
                previous: Record<string, Array<PaletteSearchResult>>,
              ): Record<string, Array<PaletteSearchResult>> => {
                return { ...previous, [provider.id]: [] };
              },
            );
            setPendingByProviderId(
              (previous: Record<string, boolean>): Record<string, boolean> => {
                return { ...previous, [provider.id]: false };
              },
            );
          });
      });
    }, PROVIDER_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceTimer);
    };
  }, [trimmedQuery, providers]);

  return useMemo(() => {
    return providers.map((provider: PaletteSearchProvider) => {
      return {
        provider,
        results: resultsByProviderId[provider.id] || [],
        isPending: Boolean(pendingByProviderId[provider.id]),
      };
    });
  }, [providers, resultsByProviderId, pendingByProviderId]);
};

export default useProviderSearch;
