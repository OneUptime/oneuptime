import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllIncidents } from "../api/incidents";
import { fetchAllAlerts } from "../api/alerts";
import { fetchAllIncidentEpisodes } from "../api/incidentEpisodes";
import { fetchAllAlertEpisodes } from "../api/alertEpisodes";
import type {
  ListResponse,
  IncidentItem,
  AlertItem,
  IncidentEpisodeItem,
  AlertEpisodeItem,
} from "../api/types";

interface UseAllProjectCountsResult {
  incidentCount: number;
  alertCount: number;
  incidentEpisodeCount: number;
  alertEpisodeCount: number;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectCounts(): UseAllProjectCountsResult {
  const { projectList } = useProject();
  const enabled: boolean = projectList.length > 0;

  const incidentQuery: UseQueryResult<ListResponse<IncidentItem>, Error> =
    useQuery({
      queryKey: ["incidents", "unresolved-count", "all-projects"],
      queryFn: () => {
        return fetchAllIncidents({
          skip: 0,
          limit: 1,
          unresolvedOnly: true,
        });
      },
      enabled,
    });

  const alertQuery: UseQueryResult<ListResponse<AlertItem>, Error> = useQuery({
    queryKey: ["alerts", "unresolved-count", "all-projects"],
    queryFn: () => {
      return fetchAllAlerts({ skip: 0, limit: 1, unresolvedOnly: true });
    },
    enabled,
  });

  const incidentEpisodeQuery: UseQueryResult<
    ListResponse<IncidentEpisodeItem>,
    Error
  > = useQuery({
    queryKey: ["incident-episodes", "unresolved-count", "all-projects"],
    queryFn: () => {
      return fetchAllIncidentEpisodes({
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
    },
    enabled,
  });

  const alertEpisodeQuery: UseQueryResult<
    ListResponse<AlertEpisodeItem>,
    Error
  > = useQuery({
    queryKey: ["alert-episodes", "unresolved-count", "all-projects"],
    queryFn: () => {
      return fetchAllAlertEpisodes({
        skip: 0,
        limit: 1,
        unresolvedOnly: true,
      });
    },
    enabled,
  });

  const isLoading: boolean =
    incidentQuery.isPending ||
    alertQuery.isPending ||
    incidentEpisodeQuery.isPending ||
    alertEpisodeQuery.isPending;

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await Promise.all([
      incidentQuery.refetch(),
      alertQuery.refetch(),
      incidentEpisodeQuery.refetch(),
      alertEpisodeQuery.refetch(),
    ]);
  };

  return {
    incidentCount: incidentQuery.data?.count ?? 0,
    alertCount: alertQuery.data?.count ?? 0,
    incidentEpisodeCount: incidentEpisodeQuery.data?.count ?? 0,
    alertEpisodeCount: alertEpisodeQuery.data?.count ?? 0,
    isLoading,
    refetch,
  };
}
