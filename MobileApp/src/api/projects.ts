import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type { ListResponse, ProjectItem } from "./types";

export async function fetchProjects(): Promise<ListResponse<ProjectItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/project/get-list?skip=0&limit=100",
    {
      query: {},
      select: { _id: true, name: true, slug: true },
      sort: { name: "ASC" },
    },
    {
      headers: {
        // Multi-tenant request — no tenantid needed, user token determines access
      },
    },
  );
  return response.data;
}
