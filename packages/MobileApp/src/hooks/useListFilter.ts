import { QueryClient, useQueryClient } from "@tanstack/react-query";
import type { ListFilter } from "../api/recordFilters";
import { getCurrentUserIdSync, loadCurrentUserId } from "../auth/currentUser";
import {
  filtersForList,
  getFiltersKey,
  hasActiveFilters,
  type FilterableList,
  type RecordFilters,
} from "../filters/recordFilters";
import { resolveOwnerScope } from "../filters/ownerScope";

export interface ListFilterQuery {
  // The filters the list asks of the server, or null for none.
  active: RecordFilters | null;
  /*
   * What the list's query key adds for them: nothing without filters, so an
   * unfiltered list keeps the key it always had (and every invalidation of
   * it still reaches it); the filters and, for "You", whose they are.
   */
  keyParts: Array<string>;
  // The filter as a fetch takes it, "You" made concrete (filters/ownerScope).
  resolve: (projectId: string) => Promise<ListFilter | undefined>;
}

/*
 * A list's filters, ready for its query: its key and its fetch. "You" is
 * whoever is signed in, read from the session's token (auth/currentUser),
 * so the list hooks need nothing more than the query client.
 */
export function useListFilter(
  list: FilterableList,
  filters: RecordFilters | undefined,
): ListFilterQuery {
  const queryClient: QueryClient = useQueryClient();
  const active: RecordFilters | null =
    filters && hasActiveFilters(filters, list)
      ? filtersForList(filters, list)
      : null;

  return {
    active: active,
    keyParts: active
      ? [
          "filtered",
          getFiltersKey(active),
          active.ownedByMe ? getCurrentUserIdSync() ?? "" : "",
        ]
      : [],
    resolve: async (projectId: string): Promise<ListFilter | undefined> => {
      if (!active) {
        return undefined;
      }
      const userId: string | null = active.ownedByMe
        ? await loadCurrentUserId()
        : null;
      return {
        filters: active,
        owners: await resolveOwnerScope({
          queryClient: queryClient,
          projectId: projectId,
          userId: userId,
          filters: active,
        }),
      };
    },
  };
}
