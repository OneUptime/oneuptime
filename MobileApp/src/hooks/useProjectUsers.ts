import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { fetchProjectUsers } from "../api/projectUsers";
import type { ProjectUserItem } from "../api/types";

export interface UseProjectUsersResult {
  users: ProjectUserItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

/**
 * The project's people, for the "route my pages to" picker.
 *
 * Scoped to a single project rather than fanned out, because an override only
 * makes sense inside the project whose schedules it changes - offering a
 * cross-project list would let someone pick a colleague the override cannot
 * name.
 */
export function useProjectUsers(
  projectId: string | null,
): UseProjectUsersResult {
  const query: UseQueryResult<ProjectUserItem[], Error> = useQuery({
    queryKey: ["project-users", projectId ?? "none"],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectUserItem[]> => {
      return await fetchProjectUsers(projectId as string);
    },
  });

  return {
    users: query.data ?? [],
    isLoading: query.isPending && Boolean(projectId),
    isError: query.isError,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
