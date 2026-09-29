import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import { fetchAlerts } from "../api/alerts";
import type {
  ProjectItem,
  ListResponse,
  AlertItem,
  ProjectAlertItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectAlertsResult {
  items: ProjectAlertItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/** The public name is retained for callers; only the selected project is queried. */
export function useAllProjectAlerts(): UseAllProjectAlertsResult {
  const { projectList, isLoadingProjects } = useActiveProject();
  const project: ProjectItem | undefined = projectList[0];
  const projectId: string | undefined = project?._id;
  const query: UseQueryResult<ListResponse<AlertItem>, Error> = useQuery({
    queryKey: ["alerts", projectId],
    queryFn: () => {
      if (!projectId) {
        return Promise.resolve({
          data: [],
          count: 0,
          skip: 0,
          limit: FETCH_LIMIT,
        });
      }
      return fetchAlerts(projectId, { skip: 0, limit: FETCH_LIMIT });
    },
    enabled: Boolean(projectId) && !isLoadingProjects,
    placeholderData: undefined,
  });

  const items: ProjectAlertItem[] = useMemo(() => {
    const rows: AlertItem[] | undefined = query.data?.data;
    if (!project || !Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((item: AlertItem) => {
        return !item.projectId || item.projectId === project._id;
      })
      .map((item: AlertItem): ProjectAlertItem => {
        return {
          item,
          projectId: project._id,
          projectName: project.name,
        };
      });
  }, [query.data, project]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    if (projectId) {
      await query.refetch();
    }
  };

  return {
    items,
    isLoading: isLoadingProjects || query.isLoading,
    isError: query.isError,
    refetch,
  };
}
