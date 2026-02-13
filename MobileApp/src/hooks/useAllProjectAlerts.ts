import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllAlerts } from "../api/alerts";
import type {
  ListResponse,
  AlertItem,
  ProjectAlertItem,
  ProjectItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectAlertsResult {
  items: ProjectAlertItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectAlerts(): UseAllProjectAlertsResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ListResponse<AlertItem>, Error> = useQuery({
    queryKey: ["alerts", "all-projects"],
    queryFn: () => {
      return fetchAllAlerts({ skip: 0, limit: FETCH_LIMIT });
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

  const items: ProjectAlertItem[] = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return query.data.data.map((item: AlertItem): ProjectAlertItem => {
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
    isLoading: query.isLoading,
    isError: query.isError,
    refetch,
  };
}
