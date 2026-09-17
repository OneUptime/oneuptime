import apiClient from "./client";
import type { AxiosResponse } from "axios";
import type { ListResponse, ProjectItem } from "./types";

/*
 * OneUptime API serializes ObjectID fields as { _type: "ObjectID", value: "uuid" }.
 * This helper extracts the plain string value.
 */
function resolveId(
  field: string | { _type?: string; value?: string } | undefined,
): string {
  if (!field) {
    return "";
  }

  if (typeof field === "string") {
    return field;
  }

  if (typeof field === "object" && field.value) {
    return field.value;
  }

  return String(field);
}

interface RawProjectItem {
  _id: string | { _type?: string; value?: string };
  name: string;
  slug: string | { _type?: string; value?: string };
  requireSsoForLogin?: boolean;
}

export async function fetchProjects(): Promise<ListResponse<ProjectItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/project/get-list?skip=0&limit=100",
    {
      query: {},
      select: { _id: true, name: true, slug: true, requireSsoForLogin: true },
      sort: { name: "ASC" },
    },
    {
      headers: {
        "is-multi-tenant-query": "true",
      },
    },
  );

  const raw: ListResponse<RawProjectItem> = response.data;

  return {
    ...raw,
    data: raw.data.map((item: RawProjectItem) => {
      return {
        _id: resolveId(item._id),
        name: item.name,
        slug: resolveId(item.slug),
        requireSsoForLogin: item.requireSsoForLogin,
      } as ProjectItem;
    }),
  };
}
