import { useMemo } from "react";
import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchIncidents } from "../api/incidents";
import { fetchAlerts } from "../api/alerts";
import { fetchIncidentEpisodes } from "../api/incidentEpisodes";
import { fetchAlertEpisodes } from "../api/alertEpisodes";
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

  const incidentQueries: UseQueryResult<ListResponse<IncidentItem>, Error>[] =
    useQueries({
      queries: projectList.map((project) => {
        return {
          queryKey: ["incidents", "unresolved-count", project._id],
          queryFn: async () => {
            return fetchIncidents(project._id, {
              skip: 0,
              limit: 1,
              unresolvedOnly: true,
            });
          },
          enabled: Boolean(project._id),
        };
      }),
    });

  const alertQueries: UseQueryResult<ListResponse<AlertItem>, Error>[] =
    useQueries({
      queries: projectList.map((project) => {
        return {
          queryKey: ["alerts", "unresolved-count", project._id],
          queryFn: async () => {
            return fetchAlerts(project._id, {
              skip: 0,
              limit: 1,
              unresolvedOnly: true,
            });
          },
          enabled: Boolean(project._id),
        };
      }),
    });

  const incidentEpisodeQueries: UseQueryResult<
    ListResponse<IncidentEpisodeItem>,
    Error
  >[] = useQueries({
    queries: projectList.map((project) => {
      return {
        queryKey: ["incident-episodes", "unresolved-count", project._id],
        queryFn: async () => {
          return fetchIncidentEpisodes(project._id, {
            skip: 0,
            limit: 1,
            unresolvedOnly: true,
          });
        },
        enabled: Boolean(project._id),
      };
    }),
  });

  const alertEpisodeQueries: UseQueryResult<
    ListResponse<AlertEpisodeItem>,
    Error
  >[] = useQueries({
    queries: projectList.map((project) => {
      return {
        queryKey: ["alert-episodes", "unresolved-count", project._id],
        queryFn: async () => {
          return fetchAlertEpisodes(project._id, {
            skip: 0,
            limit: 1,
            unresolvedOnly: true,
          });
        },
        enabled: Boolean(project._id),
      };
    }),
  });

  const isLoading: boolean =
    incidentQueries.some((q) => {
      return q.isLoading;
    }) ||
    alertQueries.some((q) => {
      return q.isLoading;
    }) ||
    incidentEpisodeQueries.some((q) => {
      return q.isLoading;
    }) ||
    alertEpisodeQueries.some((q) => {
      return q.isLoading;
    });

  const incidentCount: number = useMemo(() => {
    return incidentQueries.reduce((sum, q) => {
      return sum + (q.data?.count ?? 0);
    }, 0);
  }, [incidentQueries]);

  const alertCount: number = useMemo(() => {
    return alertQueries.reduce((sum, q) => {
      return sum + (q.data?.count ?? 0);
    }, 0);
  }, [alertQueries]);

  const incidentEpisodeCount: number = useMemo(() => {
    return incidentEpisodeQueries.reduce((sum, q) => {
      return sum + (q.data?.count ?? 0);
    }, 0);
  }, [incidentEpisodeQueries]);

  const alertEpisodeCount: number = useMemo(() => {
    return alertEpisodeQueries.reduce((sum, q) => {
      return sum + (q.data?.count ?? 0);
    }, 0);
  }, [alertEpisodeQueries]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await Promise.all([
      ...incidentQueries.map((q) => {
        return q.refetch();
      }),
      ...alertQueries.map((q) => {
        return q.refetch();
      }),
      ...incidentEpisodeQueries.map((q) => {
        return q.refetch();
      }),
      ...alertEpisodeQueries.map((q) => {
        return q.refetch();
      }),
    ]);
  };

  return {
    incidentCount,
    alertCount,
    incidentEpisodeCount,
    alertEpisodeCount,
    isLoading,
    refetch,
  };
}
