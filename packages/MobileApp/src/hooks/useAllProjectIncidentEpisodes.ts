import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import { useListFilter, type ListFilterQuery } from "./useListFilter";
import type { ListFilter } from "../api/recordFilters";
import type { RecordFilters } from "../filters/recordFilters";
import { fetchIncidentEpisodes } from "../api/incidentEpisodes";
import type {
  ProjectItem,
  ListResponse,
  IncidentEpisodeItem,
  ProjectIncidentEpisodeItem,
} from "../api/types";

const FETCH_LIMIT: number = 100;

interface UseAllProjectIncidentEpisodesResult {
  items: ProjectIncidentEpisodeItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/** The public name is retained for callers; only the selected project is queried. */
export function useAllProjectIncidentEpisodes(
  // The list's filters (filters/recordFilters.ts), asked of the server.
  filters?: RecordFilters,
): UseAllProjectIncidentEpisodesResult {
  const { projectList, isLoadingProjects } = useActiveProject();
  const project: ProjectItem | undefined = projectList[0];
  const projectId: string | undefined = project?._id;
  const listFilter: ListFilterQuery = useListFilter(
    "incidentEpisodes",
    filters,
  );
  const query: UseQueryResult<
    ListResponse<IncidentEpisodeItem>,
    Error
  > = useQuery({
    queryKey: ["incident-episodes", projectId, ...listFilter.keyParts],
    queryFn: async () => {
      if (!projectId) {
        return Promise.resolve({
          data: [],
          count: 0,
          skip: 0,
          limit: FETCH_LIMIT,
        });
      }
      const filter: ListFilter | undefined =
        await listFilter.resolve(projectId);
      return fetchIncidentEpisodes(
        projectId,
        filter
          ? { skip: 0, limit: FETCH_LIMIT, filter: filter }
          : { skip: 0, limit: FETCH_LIMIT },
      );
    },
    enabled: Boolean(projectId) && !isLoadingProjects,
    placeholderData: undefined,
  });

  const items: ProjectIncidentEpisodeItem[] = useMemo(() => {
    const rows: IncidentEpisodeItem[] | undefined = query.data?.data;
    if (!project || !Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((item: IncidentEpisodeItem) => {
        return !item.projectId || item.projectId === project._id;
      })
      .map((item: IncidentEpisodeItem): ProjectIncidentEpisodeItem => {
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
