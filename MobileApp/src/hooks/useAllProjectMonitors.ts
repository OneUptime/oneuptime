import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllMonitors } from "../api/monitors";
import type {
  ListResponse,
  MonitorItem,
  ProjectMonitorItem,
  ProjectItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectMonitorsResult {
  items: ProjectMonitorItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectMonitors(): UseAllProjectMonitorsResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ListResponse<MonitorItem>, Error> = useQuery({
    queryKey: ["monitors", "all-projects"],
    queryFn: () => {
      return fetchAllMonitors({ skip: 0, limit: FETCH_LIMIT });
    },
    enabled: projectList.length > 0,
  });

  const projectMap: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map();
    projectList.forEach((p: ProjectItem) => {
      map.set(p._id, p.name);
    });
    return map;
  }, [projectList]);

  const items: ProjectMonitorItem[] = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return query.data.data.map((item: MonitorItem): ProjectMonitorItem => {
      const pid: string = item.projectId ?? "";
      return {
        item,
        projectId: pid,
        projectName: projectMap.get(pid) ?? "",
      };
    });
  }, [query.data, projectMap]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    items,
    isLoading: query.isPending,
    isError: query.isError,
    refetch,
  };
}
