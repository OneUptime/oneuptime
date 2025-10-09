import { appClient } from "@/api/client";
import { PaginationResult, Project } from "@/types/models";
import { ensureListIds } from "@/utils/normalizers";

export const fetchUserProjects = async (): Promise<Project[]> => {
  const response = await appClient.post<PaginationResult<Project>>(
    "/project/list-user-projects",
    {
      query: {},
    },
    {
      headers: {
        "is-multi-tenant-query": "true",
      },
      params: {
        limit: "50",
        skip: "0",
      },
    },
  );

  return ensureListIds(response.data.data) as Project[];
};
