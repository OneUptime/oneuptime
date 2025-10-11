import { useQuery } from "@tanstack/react-query";
import { fetchUserProjects } from "@/api/projects";

export const PROJECTS_QUERY_KEY = ["projects"] as const;

export const useProjectsQuery = (enabled = true) => {
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: fetchUserProjects,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
};
