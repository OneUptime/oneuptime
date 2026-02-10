import { useQuery } from "@tanstack/react-query";
import { fetchIncidents } from "../api/incidents";

export function useIncidents(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
) {
  return useQuery({
    queryKey: ["incidents", projectId, skip, limit],
    queryFn: () => {
      return fetchIncidents(projectId, { skip, limit });
    },
    enabled: Boolean(projectId),
  });
}

export function useUnresolvedIncidentCount(projectId: string) {
  return useQuery({
    queryKey: ["incidents", "unresolved-count", projectId],
    queryFn: async () => {
      const response = await fetchIncidents(projectId, {
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
      return response.count;
    },
    enabled: Boolean(projectId),
  });
}
