import { PaletteSearchProvider, PaletteSearchResult } from "./Types";
import { useEffect, useMemo, useState } from "react";

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
  /** True while the current query is debouncing or this provider is in flight. */
  isPending: boolean;
}

interface ProviderSearchSnapshot {
  query: string;
  providers: Array<PaletteSearchProvider>;
  resultsByProviderId: Record<string, Array<PaletteSearchResult>>;
  pendingByProviderId: Record<string, boolean>;
}

/**
 * Runs every provider in parallel against the query, 200ms after the user
 * stops typing and only once the query is at least 2 characters.
 *
 * - Query/provider changes immediately remove old rows and invalidate responses,
 *   including during the next query's debounce window.
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
  const [snapshot, setSnapshot] = useState<ProviderSearchSnapshot | null>(null);

  const trimmedQuery: string = query.trim();

  useEffect(() => {
    if (
      providers.length === 0 ||
      trimmedQuery.length < PROVIDER_SEARCH_MIN_QUERY_LENGTH
    ) {
      setSnapshot(null);
      return undefined;
    }

    let isCurrentSearch: boolean = true;
    const allPending: Record<string, boolean> = {};
    providers.forEach((provider: PaletteSearchProvider) => {
      allPending[provider.id] = true;
    });
    setSnapshot({
      query: trimmedQuery,
      providers,
      resultsByProviderId: {},
      pendingByProviderId: allPending,
    });

    const settleProvider: (
      providerId: string,
      results: Array<PaletteSearchResult>,
    ) => void = (
      providerId: string,
      results: Array<PaletteSearchResult>,
    ): void => {
      if (!isCurrentSearch) {
        return;
      }
      setSnapshot(
        (
          previous: ProviderSearchSnapshot | null,
        ): ProviderSearchSnapshot | null => {
          if (!isCurrentSearch || !previous) {
            return previous;
          }
          return {
            ...previous,
            resultsByProviderId: {
              ...previous.resultsByProviderId,
              [providerId]: results,
            },
            pendingByProviderId: {
              ...previous.pendingByProviderId,
              [providerId]: false,
            },
          };
        },
      );
    };

    const debounceTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      providers.forEach((provider: PaletteSearchProvider) => {
        provider
          .search(trimmedQuery)
          .then((results: Array<PaletteSearchResult>) => {
            settleProvider(provider.id, results);
          })
          .catch(() => {
            // A failed provider simply shows nothing — never an error state.
            settleProvider(provider.id, []);
          });
      });
    }, PROVIDER_SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrentSearch = false;
      clearTimeout(debounceTimer);
    };
  }, [trimmedQuery, providers]);

  return useMemo(() => {
    /*
     * Effects run after rendering. Match the snapshot to the current inputs
     * here too, so an old row can never be selected in that intervening render.
     */
    const currentSnapshot: ProviderSearchSnapshot | null =
      snapshot?.query === trimmedQuery && snapshot.providers === providers
        ? snapshot
        : null;
    const canSearch: boolean =
      trimmedQuery.length >= PROVIDER_SEARCH_MIN_QUERY_LENGTH;

    return providers.map((provider: PaletteSearchProvider) => {
      return {
        provider,
        results: currentSnapshot?.resultsByProviderId[provider.id] || [],
        isPending:
          canSearch &&
          (currentSnapshot
            ? Boolean(currentSnapshot.pendingByProviderId[provider.id])
            : true),
      };
    });
  }, [providers, trimmedQuery, snapshot]);
};

export default useProviderSearch;
