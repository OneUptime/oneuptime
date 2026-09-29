import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import { fetchMonitors } from "../api/monitors";
import type {
  ProjectItem,
  ListResponse,
  MonitorItem,
  ProjectMonitorItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectMonitorsResult {
  items: ProjectMonitorItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/** The public name is retained for callers; only the selected project is queried. */
export function useAllProjectMonitors(): UseAllProjectMonitorsResult {
  const { projectList, isLoadingProjects } = useActiveProject();
  const project: ProjectItem | undefined = projectList[0];
  const projectId: string | undefined = project?._id;
  const query: UseQueryResult<ListResponse<MonitorItem>, Error> = useQuery({
    queryKey: ["monitors", projectId],
    queryFn: () => {
      if (!projectId) {
        return Promise.resolve({
          data: [],
          count: 0,
          skip: 0,
          limit: FETCH_LIMIT,
        });
      }
      return fetchMonitors(projectId, { skip: 0, limit: FETCH_LIMIT });
    },
    enabled: Boolean(projectId) && !isLoadingProjects,
    placeholderData: undefined,
  });

  const items: ProjectMonitorItem[] = useMemo(() => {
    const rows: MonitorItem[] | undefined = query.data?.data;
    if (!project || !Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((item: MonitorItem) => {
        return !item.projectId || item.projectId === project._id;
      })
      .map((item: MonitorItem): ProjectMonitorItem => {
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
