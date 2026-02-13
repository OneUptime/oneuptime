import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllIncidentEpisodes } from "../api/incidentEpisodes";
import type {
  ListResponse,
  IncidentEpisodeItem,
  ProjectIncidentEpisodeItem,
  ProjectItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectIncidentEpisodesResult {
  items: ProjectIncidentEpisodeItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectIncidentEpisodes(): UseAllProjectIncidentEpisodesResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ListResponse<IncidentEpisodeItem>, Error> =
    useQuery({
      queryKey: ["incident-episodes", "all-projects"],
      queryFn: () => {
        return fetchAllIncidentEpisodes({ skip: 0, limit: FETCH_LIMIT });
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

  const items: ProjectIncidentEpisodeItem[] = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return query.data.data.map(
      (item: IncidentEpisodeItem): ProjectIncidentEpisodeItem => {
        const pid: string = item.projectId ?? "";
        return {
          item,
          projectId: pid,
          projectName: projectMap.get(pid) ?? "",
        };
      },
    );
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
