import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchMyOnCallPages } from "../api/onCallPages";
import { getAuthorizedProjects, projectListKey } from "./authorizedProjects";
import type { OnCallPageItem, ProjectItem } from "../api/types";

export interface UseMyOnCallPagesResult {
  pages: OnCallPageItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/**
 * The pages sent to this responder, newest first, across every project.
 *
 * Merged into one list rather than grouped by project: a responder chasing
 * "did I miss something last night?" is asking about a moment in time, not
 * about a project, and splitting the answer into per-project sections makes
 * them reassemble the timeline themselves.
 */
export function useMyOnCallPages(): UseMyOnCallPagesResult {
  const { projectList } = useProject();

  const query: UseQueryResult<OnCallPageItem[], Error> = useQuery({
    queryKey: ["oncall", "my-pages", projectListKey(projectList)],
    enabled: projectList.length > 0,
    queryFn: async (): Promise<OnCallPageItem[]> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);

      const results: PromiseSettledResult<OnCallPageItem[]>[] =
        await Promise.allSettled(
          authorizedProjects.map((project: ProjectItem) => {
            return fetchMyOnCallPages({
              projectId: project._id,
              projectName: project.name,
            });
          }),
        );

      const all: OnCallPageItem[] = [];

      results.forEach((result: PromiseSettledResult<OnCallPageItem[]>) => {
        if (result.status === "fulfilled") {
          all.push(...result.value);
        }
      });

      return all.sort((a: OnCallPageItem, b: OnCallPageItem) => {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
    },
  });

  return {
    pages: query.data ?? [],
    isLoading: query.isPending && projectList.length > 0,
    isError: query.isError,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
