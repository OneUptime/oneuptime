import { useQuery } from "@tanstack/react-query";
import { fetchIncidentEpisodes } from "../api/incidentEpisodes";

export function useIncidentEpisodes(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
) {
  return useQuery({
    queryKey: ["incident-episodes", projectId, skip, limit],
    queryFn: () => fetchIncidentEpisodes(projectId, { skip, limit }),
    enabled: !!projectId,
  });
}

export function useUnresolvedIncidentEpisodeCount(projectId: string) {
  return useQuery({
    queryKey: ["incident-episodes", "unresolved-count", projectId],
    queryFn: async () => {
      const response = await fetchIncidentEpisodes(projectId, {
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
      return response.count;
    },
    enabled: !!projectId,
  });
}
