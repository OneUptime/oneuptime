import { appClient } from "@/api/client";
import { PaginationResult } from "@/types/models";
import JSONFunctions from "Common/Types/JSONFunctions";
import { JSONObject } from "Common/Types/JSON";

export interface ListRequest {
  path: string;
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  groupBy?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  headers?: Record<string, string>;
}

export interface CountRequest {
  path: string;
  query: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface CreateRequest {
  path: string;
  data: Record<string, unknown>;
  headers?: Record<string, string>;
}

export const getList = async <T>({
  path,
  query,
  select = {},
  sort = {},
  groupBy = {},
  limit = 20,
  skip = 0,
  headers,
}: ListRequest): Promise<PaginationResult<T>> => {
  const response = await appClient.post(`${path}/get-list`, {
    query: JSONFunctions.serialize(query as JSONObject),
    select: JSONFunctions.serialize(select as JSONObject),
    sort: JSONFunctions.serialize(sort as JSONObject),
    groupBy: JSONFunctions.serialize(groupBy as JSONObject),
  }, {
    headers,
    params: {
      limit: `${limit}`,
      skip: `${skip}`,
    },
  });

  return response.data as PaginationResult<T>;
};

export const count = async ({ path, query, headers }: CountRequest): Promise<number> => {
  const response = await appClient.post(`${path}/count`, {
    query: JSONFunctions.serialize(query as JSONObject),
  }, {
    headers,
  });

  return (response.data?.count as number) || 0;
};

export const create = async <T>({ path, data, headers }: CreateRequest): Promise<T> => {
  const response = await appClient.post(path, {
    data: JSONFunctions.serialize(data as JSONObject),
  }, {
    headers,
  });

  return response.data as T;
};

export const updateById = async <T>(path: string, id: string, data: Record<string, unknown>, headers?: Record<string, string>): Promise<T> => {
  const response = await appClient.put(`${path}/${id}`, {
    data: JSONFunctions.serialize(data as JSONObject),
  }, {
    headers,
  });

  return response.data as T;
};
