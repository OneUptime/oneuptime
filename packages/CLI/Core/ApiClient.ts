import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import Headers from "Common/Types/API/Headers";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Protocol from "Common/Types/API/Protocol";
import Hostname from "Common/Types/API/Hostname";
import { JSONObject, JSONValue } from "Common/Types/JSON";

export type ApiOperation =
  | "create"
  | "read"
  | "list"
  | "update"
  | "delete"
  | "count";

export interface ApiRequestOptions {
  apiUrl: string;
  apiKey: string;
  apiPath: string;
  operation: ApiOperation;
  id?: string | undefined;
  data?: JSONObject | undefined;
  query?: JSONObject | undefined;
  select?: JSONObject | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
  sort?: JSONObject | undefined;
}

function buildApiRoute(
  apiPath: string,
  operation: ApiOperation,
  id?: string,
): Route {
  let fullPath: string = `/api${apiPath}`;

  switch (operation) {
    case "read":
      if (id) {
        fullPath = `/api${apiPath}/${id}/get-item`;
      }
      break;
    case "update":
    case "delete":
      if (id) {
        fullPath = `/api${apiPath}/${id}/`;
      }
      break;
    case "count":
      fullPath = `/api${apiPath}/count`;
      break;
    case "list":
      fullPath = `/api${apiPath}/get-list`;
      break;
    case "create":
    default:
      fullPath = `/api${apiPath}`;
      break;
  }

  return new Route(fullPath);
}

function buildHeaders(apiKey: string): Headers {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    APIKey: apiKey,
  };
}

function buildRequestData(options: ApiRequestOptions): JSONObject | undefined {
  switch (options.operation) {
    case "create":
      return { data: options.data || {} } as JSONObject;
    case "update":
      return { data: options.data || {} } as JSONObject;
    case "list":
    case "count":
      return {
        query: options.query || {},
        select: options.select || {},
        skip: options.skip || 0,
        limit: options.limit || 10,
        sort: options.sort || {},
      } as JSONObject;
    case "read":
      return {
        select: options.select || {},
      } as JSONObject;
    case "delete":
    default:
      return undefined;
  }
}

export async function executeApiRequest(
  options: ApiRequestOptions,
): Promise<JSONValue> {
  const url: URL = URL.fromString(options.apiUrl);
  const protocol: Protocol = url.protocol;
  const hostname: Hostname = url.hostname;

  const api: API = new API(protocol, hostname, new Route("/"));
  const route: Route = buildApiRoute(
    options.apiPath,
    options.operation,
    options.id,
  );
  const headers: Headers = buildHeaders(options.apiKey);
  const data: JSONObject | undefined = buildRequestData(options);

  const requestUrl: URL = new URL(api.protocol, api.hostname, route);
  const baseOptions: { url: URL; headers: Headers } = {
    url: requestUrl,
    headers,
  };

  let response: HTTPResponse<JSONObject> | HTTPErrorResponse;

  switch (options.operation) {
    case "create":
    case "count":
    case "list":
    case "read":
      response = await API.post(data ? { ...baseOptions, data } : baseOptions);
      break;
    case "update":
      response = await API.put(data ? { ...baseOptions, data } : baseOptions);
      break;
    case "delete":
      response = await API.delete(
        data ? { ...baseOptions, data } : baseOptions,
      );
      break;
    default:
      throw new Error(`Unsupported operation: ${options.operation}`);
  }

  if (response instanceof HTTPErrorResponse) {
    throw new Error(
      `API error (${response.statusCode}): ${response.message || "Unknown error"}`,
    );
  }

  return response.data;
}
