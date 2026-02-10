import { useQuery } from "@tanstack/react-query";
import { fetchAlerts } from "../api/alerts";

export function useAlerts(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
) {
  return useQuery({
    queryKey: ["alerts", projectId, skip, limit],
    queryFn: () => fetchAlerts(projectId, { skip, limit }),
    enabled: !!projectId,
  });
}

export function useUnresolvedAlertCount(projectId: string) {
  return useQuery({
    queryKey: ["alerts", "unresolved-count", projectId],
    queryFn: async () => {
      const response = await fetchAlerts(projectId, {
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
      return response.count;
    },
    enabled: !!projectId,
  });
}
