import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAllAlertEpisodes } from "../api/alertEpisodes";
import type {
  ListResponse,
  AlertEpisodeItem,
  ProjectAlertEpisodeItem,
  ProjectItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectAlertEpisodesResult {
  items: ProjectAlertEpisodeItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useAllProjectAlertEpisodes(): UseAllProjectAlertEpisodesResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ListResponse<AlertEpisodeItem>, Error> =
    useQuery({
      queryKey: ["alert-episodes", "all-projects"],
      queryFn: () => {
        return fetchAllAlertEpisodes({ skip: 0, limit: FETCH_LIMIT });
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

  const items: ProjectAlertEpisodeItem[] = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return query.data.data.map(
      (item: AlertEpisodeItem): ProjectAlertEpisodeItem => {
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
    isLoading: query.isLoading,
    isError: query.isError,
    refetch,
  };
}
