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
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectCounts(): UseAllProjectCountsResult {
  const { projectList, isLoadingProjects } = useProject();
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

  const inoperationalMonitorCount: number = inoperationalMonitorQueries.reduce(
    (sum: number, q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return sum + (q.data?.count ?? 0);
    },
    0,
  );

  /*
   * What "loading" has to mean here, in three parts.
   *
   * `isPending` in react-query v5 means "there is no data yet", NOT "a request
   * is in flight", and a query with enabled:false is pending forever. The four
   * single queries above are disabled while the responder has no projects, so
   * reading isPending pinned Home under a skeleton that could never resolve -
   * for a brand new account, or for one whose project fetch failed, with
   * nothing to retry. `isLoading` is isPending && isFetching, which is the
   * question the screen is actually asking.
   *
   * The per-project queries are built FROM the project list, so before it
   * lands there are none of them and `some()` is false. isLoadingProjects
   * covers that window; without it Home reports settled cards while the list
   * they are summed from is still being fetched.
   *
   * The disabled- and inoperational-monitor arrays belong here because their
   * counts are returned. Leaving them out drew those two cards as a confident
   * 0 before their requests had landed, which a responder reads as "nothing is
   * down" - the single most expensive thing this screen can say wrongly.
   */
  const isLoading: boolean =
    isLoadingProjects ||
    incidentQuery.isLoading ||
    alertQuery.isLoading ||
    incidentEpisodeQuery.isLoading ||
    alertEpisodeQuery.isLoading ||
    monitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isLoading;
      },
    ) ||
    disabledMonitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isLoading;
      },
    ) ||
    inoperationalMonitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isLoading;
      },
    );

  /*
   * Every count above falls back to 0 when its query has no data, so a request
   * that FAILED arrives at Home as the same number as a project with genuinely
   * nothing outstanding. Reporting the failure alongside the counts is what
   * lets the screen say "we could not ask" instead of quietly claiming
   * all-clear.
   */
  const isError: boolean =
    incidentQuery.isError ||
    alertQuery.isError ||
    incidentEpisodeQuery.isError ||
    alertEpisodeQuery.isError ||
    monitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isError;
      },
    ) ||
    disabledMonitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isError;
      },
    ) ||
    inoperationalMonitorQueries.some(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.isError;
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
    isError,
    refetch,
  };
}
