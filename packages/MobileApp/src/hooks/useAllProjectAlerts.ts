import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import { useListFilter, type ListFilterQuery } from "./useListFilter";
import type { ListFilter } from "../api/recordFilters";
import type { RecordFilters } from "../filters/recordFilters";
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
export function useAllProjectAlerts(
  // The list's filters (filters/recordFilters.ts), asked of the server.
  filters?: RecordFilters,
): UseAllProjectAlertsResult {
  const { projectList, isLoadingProjects } = useActiveProject();
  const project: ProjectItem | undefined = projectList[0];
  const projectId: string | undefined = project?._id;
  const listFilter: ListFilterQuery = useListFilter("alerts", filters);
  const query: UseQueryResult<ListResponse<AlertItem>, Error> = useQuery({
    queryKey: ["alerts", projectId, ...listFilter.keyParts],
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
      return fetchAlerts(
        projectId,
        filter
          ? { skip: 0, limit: FETCH_LIMIT, filter: filter }
          : { skip: 0, limit: FETCH_LIMIT },
      );
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
