import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
import { fetchOnCallSchedules } from "../api/onCallSchedules";
import { getAuthorizedProjects, projectListKey } from "./authorizedProjects";
import type {
  OnCallScheduleItem,
  ProjectItem,
  ProjectOnCallScheduleItem,
} from "../api/types";

export interface UseOnCallSchedulesResult {
  schedules: ProjectOnCallScheduleItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/**
 * Schedules for the selected project, with its identity in the cache key.
 * A failed or SSO-locked read is unknown coverage, never an empty roster.
 */
export function useOnCallSchedules(): UseOnCallSchedulesResult {
  const { projectList } = useActiveProject();

  const query: UseQueryResult<ProjectOnCallScheduleItem[], Error> = useQuery({
    queryKey: ["oncall", "schedules", projectListKey(projectList)],
    enabled: projectList.length > 0,
    queryFn: async (): Promise<ProjectOnCallScheduleItem[]> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);

      if (projectList.length > 0 && authorizedProjects.length === 0) {
        throw new Error(
          "Sign in with SSO for the selected project to view its roster.",
        );
      }

      const results: PromiseSettledResult<ProjectOnCallScheduleItem[]>[] =
        await Promise.allSettled(
          authorizedProjects.map(
            async (
              project: ProjectItem,
            ): Promise<ProjectOnCallScheduleItem[]> => {
              const schedules: OnCallScheduleItem[] =
                await fetchOnCallSchedules(project._id);

              return schedules.map((schedule: OnCallScheduleItem) => {
                return {
                  item: schedule,
                  projectId: project._id,
                  projectName: project.name,
                };
              });
            },
          ),
        );

      const all: ProjectOnCallScheduleItem[] = [];

      if (
        results.length > 0 &&
        results.every(
          (result: PromiseSettledResult<ProjectOnCallScheduleItem[]>) => {
            return result.status === "rejected";
          },
        )
      ) {
        throw new Error("Could not load the selected project's roster.");
      }

      results.forEach(
        (result: PromiseSettledResult<ProjectOnCallScheduleItem[]>) => {
          if (result.status === "fulfilled") {
            all.push(...result.value);
          }
        },
      );

      return all;
    },
  });

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    schedules: query.data ?? [],
    isLoading: query.isPending && projectList.length > 0,
    isError: query.isError,
    refetch,
  };
}
