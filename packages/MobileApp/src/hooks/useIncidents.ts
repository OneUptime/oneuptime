import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchIncidents } from "../api/incidents";
import type { ListResponse, IncidentItem } from "../api/types";

export function useIncidents(
  projectId: string,
  skip: number = 0,
  limit: number = 20,
): UseQueryResult<ListResponse<IncidentItem>, Error> {
  return useQuery({
    queryKey: ["incidents", projectId, skip, limit],
    queryFn: () => {
      return fetchIncidents(projectId, { skip, limit });
    },
    enabled: Boolean(projectId),
  });
}

export function useUnresolvedIncidentCount(
  projectId: string,
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: ["incidents", "unresolved-count", projectId],
    queryFn: async () => {
      const response: ListResponse<IncidentItem> = await fetchIncidents(
        projectId,
        {
          skip: 0,
          limit: 1,
          unresolvedOnly: true,
        },
      );
      return response.count;
    },
    enabled: Boolean(projectId),
  });
}
