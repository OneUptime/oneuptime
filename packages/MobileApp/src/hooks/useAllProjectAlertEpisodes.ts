import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import { fetchAlertEpisodes } from "../api/alertEpisodes";
import type {
  ProjectItem,
  ListResponse,
  AlertEpisodeItem,
  ProjectAlertEpisodeItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectAlertEpisodesResult {
  items: ProjectAlertEpisodeItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/** The public name is retained for callers; only the selected project is queried. */
export function useAllProjectAlertEpisodes(): UseAllProjectAlertEpisodesResult {
  const { projectList, isLoadingProjects } = useActiveProject();
  const project: ProjectItem | undefined = projectList[0];
  const projectId: string | undefined = project?._id;
  const query: UseQueryResult<ListResponse<AlertEpisodeItem>, Error> = useQuery(
    {
      queryKey: ["alert-episodes", projectId],
      queryFn: () => {
        if (!projectId) {
          return Promise.resolve({
            data: [],
            count: 0,
            skip: 0,
            limit: FETCH_LIMIT,
          });
        }
        return fetchAlertEpisodes(projectId, { skip: 0, limit: FETCH_LIMIT });
      },
      enabled: Boolean(projectId) && !isLoadingProjects,
      placeholderData: undefined,
    },
  );

  const items: ProjectAlertEpisodeItem[] = useMemo(() => {
    const rows: AlertEpisodeItem[] | undefined = query.data?.data;
    if (!project || !Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((item: AlertEpisodeItem) => {
        return !item.projectId || item.projectId === project._id;
      })
      .map((item: AlertEpisodeItem): ProjectAlertEpisodeItem => {
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
