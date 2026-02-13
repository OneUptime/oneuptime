import { useMemo } from "react";
import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAlertStates } from "../api/alerts";
import type { AlertState } from "../api/types";

interface UseAllProjectAlertStatesResult {
  statesMap: Map<string, AlertState[]>;
  isLoading: boolean;
}

export function useAllProjectAlertStates(): UseAllProjectAlertStatesResult {
  const { projectList } = useProject();

  const queries: UseQueryResult<AlertState[], Error>[] = useQueries({
    queries: projectList.map((project) => {
      return {
        queryKey: ["alert-states", project._id],
        queryFn: () => {
          return fetchAlertStates(project._id);
        },
        enabled: Boolean(project._id),
      };
    }),
  });

  const isLoading: boolean = queries.some((q) => {
    return q.isLoading;
  });

  const statesMap: Map<string, AlertState[]> = useMemo(() => {
    const map: Map<string, AlertState[]> = new Map();
    queries.forEach((q, index: number) => {
      const project = projectList[index];
      if (project && q.data) {
        map.set(project._id, q.data);
      }
    });
    return map;
  }, [queries, projectList]);

  return { statesMap, isLoading };
}
