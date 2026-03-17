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
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useAllProjectMonitors(): UseAllProjectMonitorsResult {
  const { projectList } = useProject();

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

  const isLoading: boolean = queries.some(
    (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return q.isLoading;
    },
  );
  const isError: boolean = queries.some(
    (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
      return q.isError;
    },
  );
  const firstError: Error | null =
    queries.find(
      (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
        return q.error;
      },
    )?.error ?? null;

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
      const query: UseQueryResult<ListResponse<MonitorItem>, Error> =
        queries[i]!;
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
      queries.map(
        (q: UseQueryResult<ListResponse<MonitorItem>, Error>) => {
          return q.refetch();
        },
      ),
    );
  };

  return {
    items,
    isLoading,
    isError,
    error: firstError,
    refetch,
  };
}
