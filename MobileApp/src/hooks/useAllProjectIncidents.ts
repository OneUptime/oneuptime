import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllIncidents } from "../api/incidents";
import type {
  ListResponse,
  IncidentItem,
  ProjectIncidentItem,
  ProjectItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectIncidentsResult {
  items: ProjectIncidentItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectIncidents(): UseAllProjectIncidentsResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ListResponse<IncidentItem>, Error> = useQuery({
    queryKey: ["incidents", "all-projects"],
    queryFn: () => {
      return fetchAllIncidents({ skip: 0, limit: FETCH_LIMIT });
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

  const items: ProjectIncidentItem[] = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return query.data.data.map((item: IncidentItem): ProjectIncidentItem => {
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
