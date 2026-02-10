import { useQuery } from "@tanstack/react-query";
import { fetchAlertEpisodes } from "../api/alertEpisodes";

export function useAlertEpisodes(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
) {
  return useQuery({
    queryKey: ["alert-episodes", projectId, skip, limit],
    queryFn: () => fetchAlertEpisodes(projectId, { skip, limit }),
    enabled: !!projectId,
  });
}

export function useUnresolvedAlertEpisodeCount(projectId: string) {
  return useQuery({
    queryKey: ["alert-episodes", "unresolved-count", projectId],
    queryFn: async () => {
      const response = await fetchAlertEpisodes(projectId, {
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
      return response.count;
    },
    enabled: !!projectId,
  });
}
