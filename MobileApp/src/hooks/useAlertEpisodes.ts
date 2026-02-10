import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchAlertEpisodes } from "../api/alertEpisodes";
import type { ListResponse, AlertEpisodeItem } from "../api/types";

export function useAlertEpisodes(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
): UseQueryResult<ListResponse<AlertEpisodeItem>, Error> {
  return useQuery({
    queryKey: ["alert-episodes", projectId, skip, limit],
    queryFn: () => {
      return fetchAlertEpisodes(projectId, { skip, limit });
    },
    enabled: Boolean(projectId),
  });
}

export function useUnresolvedAlertEpisodeCount(
  projectId: string,
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: ["alert-episodes", "unresolved-count", projectId],
    queryFn: async () => {
      const response: ListResponse<AlertEpisodeItem> =
        await fetchAlertEpisodes(projectId, {
          skip: 0,
          limit: 1,
          unresolvedOnly: true,
        });
      return response.count;
    },
    enabled: Boolean(projectId),
  });
}
