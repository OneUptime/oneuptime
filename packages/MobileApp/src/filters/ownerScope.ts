import type { QueryClient } from "@tanstack/react-query";
import { fetchMyTeamIds, type OwnerScope } from "../api/recordFilters";
import type { RecordFilters } from "./recordFilters";

// How long the reader's teams are trusted before they are read again.
export const MY_TEAMS_STALE_TIME_MS: number = 5 * 60 * 1000;

export function getMyTeamIdsQueryKey(
  projectId: string,
  userId: string,
): Array<string> {
  return ["my-team-ids", projectId, userId];
}

/*
 * The people and teams an owner filter names, with "You" made concrete: the
 * reader, and every team they are on in the project - the server's owners
 * filter is direct, so a team's records are asked for by the team. Null when
 * the filter says nothing about owners. "You" for a reader whose id is not
 * known names nobody, so it matches nothing rather than everything.
 */
export async function resolveOwnerScope(data: {
  queryClient: QueryClient;
  projectId: string;
  userId: string | null;
  filters: RecordFilters;
}): Promise<OwnerScope | null> {
  const { filters } = data;
  const filtersOwners: boolean =
    filters.ownedByMe ||
    filters.ownerUserIds.length > 0 ||
    filters.ownerTeamIds.length > 0;
  if (!filtersOwners) {
    return null;
  }

  const userIds: Set<string> = new Set(filters.ownerUserIds);
  const teamIds: Set<string> = new Set(filters.ownerTeamIds);
  if (filters.ownedByMe && data.userId) {
    const userId: string = data.userId;
    userIds.add(userId);
    const myTeamIds: Array<string> = await data.queryClient.fetchQuery({
      queryKey: getMyTeamIdsQueryKey(data.projectId, userId),
      queryFn: (): Promise<Array<string>> => {
        return fetchMyTeamIds(data.projectId, userId);
      },
      staleTime: MY_TEAMS_STALE_TIME_MS,
    });
    myTeamIds.forEach((teamId: string): void => {
      teamIds.add(teamId);
    });
  }

  return { userIds: Array.from(userIds), teamIds: Array.from(teamIds) };
}
