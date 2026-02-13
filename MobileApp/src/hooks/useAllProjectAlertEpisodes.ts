import { useMemo } from "react";
import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAlertEpisodes } from "../api/alertEpisodes";
import type {
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

export function useAllProjectAlertEpisodes(): UseAllProjectAlertEpisodesResult {
  const { projectList } = useProject();

  const queries: UseQueryResult<ListResponse<AlertEpisodeItem>, Error>[] =
    useQueries({
      queries: projectList.map((project) => {
        return {
          queryKey: ["alert-episodes", project._id, 0, FETCH_LIMIT],
          queryFn: () => {
            return fetchAlertEpisodes(project._id, {
              skip: 0,
              limit: FETCH_LIMIT,
            });
          },
          enabled: Boolean(project._id),
        };
      }),
    });

  const isLoading: boolean = queries.some((q) => {
    return q.isLoading;
  });
  const isError: boolean = queries.every((q) => {
    return q.isError;
  });

  const items: ProjectAlertEpisodeItem[] = useMemo(() => {
    const result: ProjectAlertEpisodeItem[] = [];
    queries.forEach((q, index: number) => {
      const project = projectList[index];
      if (!project || !q.data) {
        return;
      }
      for (const item of q.data.data) {
        result.push({
          item,
          projectId: project._id,
          projectName: project.name,
        });
      }
    });
    result.sort((a, b) => {
      return (
        new Date(b.item.createdAt).getTime() -
        new Date(a.item.createdAt).getTime()
      );
    });
    return result;
  }, [queries, projectList]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await Promise.all(
      queries.map((q) => {
        return q.refetch();
      }),
    );
  };

  return { items, isLoading, isError, refetch };
}
