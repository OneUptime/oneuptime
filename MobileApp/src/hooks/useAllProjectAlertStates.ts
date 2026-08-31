import { useMemo } from "react";
import { useQueries, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchAlertStates } from "../api/alerts";
import type { AlertState, ProjectItem } from "../api/types";

interface UseAllProjectAlertStatesResult {
  statesMap: Map<string, AlertState[]>;
  isLoading: boolean;
  isError: boolean;
}

export function useAllProjectAlertStates(): UseAllProjectAlertStatesResult {
  const { projectList, isLoadingProjects } = useProject();

  const queries: UseQueryResult<AlertState[], Error>[] = useQueries({
    queries: projectList.map((project: ProjectItem) => {
      return {
        queryKey: ["alert-states", project._id],
        queryFn: () => {
          return fetchAlertStates(project._id);
        },
        enabled: Boolean(project._id),
      };
    }),
  });

  /*
   * One query per project means no queries at all until the project list has
   * arrived, and `some()` over an empty array is false. Reporting "loaded"
   * there hands the Alerts screen an empty statesMap as if it were the
   * answer, which is what decides whether the Acknowledge and Resolve buttons
   * are drawn. isLoadingProjects keeps the screen honest for that window.
   */
  const isLoading: boolean =
    isLoadingProjects ||
    queries.some((q: UseQueryResult<AlertState[], Error>) => {
      return q.isLoading;
    });

  /*
   * A project whose state list failed to load is, inside statesMap, exactly a
   * project with no states: both are simply absent. That gap is not cosmetic -
   * it is what the acknowledge/resolve buttons and the Active/Resolved
   * sectioning are built from, so a failure silently reads as "this project
   * has nothing to act on". The rows that did succeed are left shaped exactly
   * as they were; only the failure is now something the screen can see.
   */
  const isError: boolean = queries.some(
    (q: UseQueryResult<AlertState[], Error>) => {
      return q.isError;
    },
  );

  const statesMap: Map<string, AlertState[]> = useMemo(() => {
    const map: Map<string, AlertState[]> = new Map();
    queries.forEach((q: UseQueryResult<AlertState[], Error>, index: number) => {
      const project: ProjectItem | undefined = projectList[index];
      if (project && q.data) {
        map.set(project._id, q.data);
      }
    });
    return map;
  }, [queries, projectList]);

  return { statesMap, isLoading, isError };
}
