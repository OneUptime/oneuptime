import { useMemo } from "react";
import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchIncidentStates } from "../api/incidents";
import type { IncidentState, ProjectItem } from "../api/types";

interface UseAllProjectIncidentStatesResult {
  statesMap: Map<string, IncidentState[]>;
  isLoading: boolean;
}

export function useAllProjectIncidentStates(): UseAllProjectIncidentStatesResult {
  const { projectList } = useProject();

  const queries: UseQueryResult<IncidentState[], Error>[] = useQueries({
    queries: projectList.map((project: ProjectItem) => {
      return {
        queryKey: ["incident-states", project._id],
        queryFn: () => {
          return fetchIncidentStates(project._id);
        },
        enabled: Boolean(project._id),
      };
    }),
  });

  const isLoading: boolean = queries.some(
    (q: UseQueryResult<IncidentState[], Error>) => {
      return q.isLoading;
    },
  );

  const statesMap: Map<string, IncidentState[]> = useMemo(() => {
    const map: Map<string, IncidentState[]> = new Map();
    queries.forEach(
      (q: UseQueryResult<IncidentState[], Error>, index: number) => {
        const project: ProjectItem | undefined = projectList[index];
        if (project && q.data) {
          map.set(project._id, q.data);
        }
      },
    );
    return map;
  }, [queries, projectList]);

  return { statesMap, isLoading };
}
