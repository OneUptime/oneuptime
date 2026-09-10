import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useActiveProject } from "./useProject";
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
 * Pages sent to this responder in the selected project, newest first.
 */
export function useMyOnCallPages(): UseMyOnCallPagesResult {
  const { projectList } = useActiveProject();

  const query: UseQueryResult<OnCallPageItem[], Error> = useQuery({
    queryKey: ["oncall", "my-pages", projectListKey(projectList)],
    enabled: projectList.length > 0,
    queryFn: async (): Promise<OnCallPageItem[]> => {
      const authorizedProjects: ProjectItem[] =
        await getAuthorizedProjects(projectList);

      if (projectList.length > 0 && authorizedProjects.length === 0) {
        throw new Error(
          "Sign in with SSO for the selected project to view your pages.",
        );
      }

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

      if (
        results.length > 0 &&
        results.every((result: PromiseSettledResult<OnCallPageItem[]>) => {
          return result.status === "rejected";
        })
      ) {
        throw new Error("Could not load pages for the selected project.");
      }

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
