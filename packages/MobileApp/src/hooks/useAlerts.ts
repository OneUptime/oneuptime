import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchAlerts } from "../api/alerts";
import type { ListResponse, AlertItem } from "../api/types";

export function useAlerts(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
): UseQueryResult<ListResponse<AlertItem>, Error> {
  return useQuery({
    queryKey: ["alerts", projectId, skip, limit],
    queryFn: () => {
      return fetchAlerts(projectId, { skip, limit });
    },
    enabled: Boolean(projectId),
  });
}

export function useUnresolvedAlertCount(
  projectId: string,
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: ["alerts", "unresolved-count", projectId],
    queryFn: async () => {
      const response: ListResponse<AlertItem> = await fetchAlerts(projectId, {
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
      return response.count;
    },
    enabled: Boolean(projectId),
  });
}
