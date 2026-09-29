import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchIncidentEpisodes } from "../api/incidentEpisodes";
import type { ListResponse, IncidentEpisodeItem } from "../api/types";

export function useIncidentEpisodes(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
): UseQueryResult<ListResponse<IncidentEpisodeItem>, Error> {
  return useQuery({
    queryKey: ["incident-episodes", projectId, skip, limit],
    queryFn: () => {
      return fetchIncidentEpisodes(projectId, { skip, limit });
    },
    enabled: Boolean(projectId),
  });
}

export function useUnresolvedIncidentEpisodeCount(
  projectId: string,
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: ["incident-episodes", "unresolved-count", projectId],
    queryFn: async () => {
      const response: ListResponse<IncidentEpisodeItem> =
        await fetchIncidentEpisodes(projectId, {
          skip: 0,
          limit: 1,
          unresolvedOnly: true,
        });
      return response.count;
    },
    enabled: Boolean(projectId),
  });
}
