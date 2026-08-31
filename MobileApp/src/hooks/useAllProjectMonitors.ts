import { useMemo } from "react";
import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchMonitors } from "../api/monitors";
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
  const { projectList, isLoadingProjects } = useProject();

  const queries: UseQueryResult<ListResponse<MonitorItem>, Error>[] =
    useQueries({
      queries: projectList.map((project: ProjectItem) => {
        return {
          queryKey: ["monitors", project._id],
          queryFn: () => {
            return fetchMonitors(project._id, {
              skip: 0,
              limit: FETCH_LIMIT,
            });
          },
        };
      }),
    });

  /*
   * The project list is half of this hook's loading state, and the half that
   * is easy to lose. useQueries builds one query per project, so until the
   * list arrives there are NO queries here - and `some()` over an empty array
   * is false. Without isLoadingProjects the Monitors tab therefore reported
   * itself settled the instant it mounted and rendered its "no monitors"
   * empty state over a responder whose monitors had simply not been asked for
   * yet. Waiting on the list too is what makes that empty state mean
   * something: it can only be reached once we know there is nothing to fan
   * out to.
   */
  const isLoading: boolean =
    isLoadingProjects ||
    queries.some((q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return q.isLoading;
    });
  const isError: boolean = queries.some(
    (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return q.isError;
    },
  );
  const projectMap: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map();
    projectList.forEach((p: ProjectItem) => {
      map.set(p._id, p.name);
    });
    return map;
  }, [projectList]);

  const items: ProjectMonitorItem[] = useMemo(() => {
    const allItems: ProjectMonitorItem[] = [];
    for (let i: number = 0; i < queries.length; i++) {
      const query: UseQueryResult<ListResponse<MonitorItem>, Error> = queries[
        i
      ]!;
      const projectId: string = projectList[i]?._id ?? "";
      if (query.data) {
        for (const item of query.data.data) {
          allItems.push({
            item,
            projectId,
            projectName: projectMap.get(projectId) ?? "",
          });
        }
      }
    }
    return allItems;
  }, [queries, projectList, projectMap]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await Promise.all(
      queries.map((q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.refetch();
      }),
    );
  };

  return {
    items,
    isLoading,
    isError,
    refetch,
  };
}
