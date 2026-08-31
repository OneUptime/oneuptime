import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
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
 * Every on-call schedule in every project the user can read, each carrying the
 * project it came from.
 *
 * One project failing does not empty the screen - `allSettled` keeps the rest.
 * A responder with four projects, one of which is mid-outage, still needs to
 * see the three schedules that answered.
 */
export function useOnCallSchedules(): UseOnCallSchedulesResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ProjectOnCallScheduleItem[], Error> = useQuery({
    queryKey: ["oncall", "schedules", projectListKey(projectList)],
    enabled: projectList.length > 0,
    queryFn: async (): Promise<ProjectOnCallScheduleItem[]> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);

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
