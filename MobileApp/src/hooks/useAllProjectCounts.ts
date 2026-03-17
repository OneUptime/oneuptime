import { useQuery, useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllIncidents } from "../api/incidents";
import { fetchAllAlerts } from "../api/alerts";
import { fetchAllIncidentEpisodes } from "../api/incidentEpisodes";
import { fetchAllAlertEpisodes } from "../api/alertEpisodes";
import {
  fetchMonitorCount,
  fetchDisabledMonitorCount,
  fetchInoperationalMonitorCount,
} from "../api/monitors";
import type {
  ListResponse,
  IncidentItem,
  AlertItem,
  IncidentEpisodeItem,
  AlertEpisodeItem,
  MonitorItem,
  ProjectItem,
} from "../api/types";

interface UseAllProjectCountsResult {
  incidentCount: number;
  alertCount: number;
  incidentEpisodeCount: number;
  alertEpisodeCount: number;
  monitorCount: number;
  disabledMonitorCount: number;
  inoperationalMonitorCount: number;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectCounts(): UseAllProjectCountsResult {
  const { projectList } = useProject();
  const enabled: boolean = projectList.length > 0;

  const incidentQuery: UseQueryResult<
    ListResponse<IncidentItem>,
    Error
  > = useQuery({
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

  const monitorQueries: UseQueryResult<ListResponse<MonitorItem>, Error>[] =
    useQueries({
      queries: projectList.map((project: ProjectItem) => {
        return {
          queryKey: ["monitors", "count", project._id],
          queryFn: () => {
            return fetchMonitorCount(project._id);
          },
        };
      }),
    });

  const disabledMonitorQueries: UseQueryResult<
    ListResponse<MonitorItem>,
    Error
  >[] = useQueries({
    queries: projectList.map((project: ProjectItem) => {
      return {
        queryKey: ["monitors", "disabled-count", project._id],
        queryFn: () => {
          return fetchDisabledMonitorCount(project._id);
        },
      };
    }),
  });

  const inoperationalMonitorQueries: UseQueryResult<
    ListResponse<MonitorItem>,
    Error
  >[] = useQueries({
    queries: projectList.map((project: ProjectItem) => {
      return {
        queryKey: ["monitors", "inoperational-count", project._id],
        queryFn: () => {
          return fetchInoperationalMonitorCount(project._id);
        },
      };
    }),
  });

  const monitorCount: number = monitorQueries.reduce(
    (sum: number, q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return sum + (q.data?.count ?? 0);
    },
    0,
  );

  const disabledMonitorCount: number = disabledMonitorQueries.reduce(
    (sum: number, q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return sum + (q.data?.count ?? 0);
    },
    0,
  );

  const inoperationalMonitorCount: number =
    inoperationalMonitorQueries.reduce(
      (sum: number, q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return sum + (q.data?.count ?? 0);
      },
      0,
    );

  const isLoading: boolean =
    incidentQuery.isPending ||
    alertQuery.isPending ||
    incidentEpisodeQuery.isPending ||
    alertEpisodeQuery.isPending ||
    monitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isLoading;
      },
    );

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await Promise.all([
      incidentQuery.refetch(),
      alertQuery.refetch(),
      incidentEpisodeQuery.refetch(),
      alertEpisodeQuery.refetch(),
      ...monitorQueries.map(
        (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
          return q.refetch();
        },
      ),
      ...disabledMonitorQueries.map(
        (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
          return q.refetch();
        },
      ),
      ...inoperationalMonitorQueries.map(
        (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
          return q.refetch();
        },
      ),
    ]);
  };

  return {
    incidentCount: incidentQuery.data?.count ?? 0,
    alertCount: alertQuery.data?.count ?? 0,
    incidentEpisodeCount: incidentEpisodeQuery.data?.count ?? 0,
    alertEpisodeCount: alertEpisodeQuery.data?.count ?? 0,
    monitorCount,
    disabledMonitorCount,
    inoperationalMonitorCount,
    isLoading,
    refetch,
  };
}
