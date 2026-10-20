import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { LlmConnectorTransport } from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";

/*
 * A provider API in a test: requests are answered by the first route whose
 * matcher accepts them, and every request is recorded so a test can read
 * what was sent (the URL, the headers, the body). A non-2xx answer is
 * thrown exactly as the production transport (DataSourceHttpFetch) throws
 * it - "Data source responded with HTTP <status>: <first 500 characters>" -
 * so the clients' error handling is tested against the real shape.
 */

export interface FakeResponse {
  status?: number | undefined;
  body?: JSONValue | string | undefined;
}

export type FakeResponder = (
  request: DataSourceHttpRequest,
  url: URL,
) => FakeResponse | Promise<FakeResponse>;

export interface FakeRoute {
  // Matches the URL's path (and method, when given).
  path: string | RegExp;
  method?: "GET" | "POST" | "DELETE" | undefined;
  host?: string | undefined;
  respond: FakeResponder;
}

export interface FakeProviderApi {
  transport: LlmConnectorTransport;
  requests: Array<DataSourceHttpRequest>;
  // The recorded requests whose path matches.
  requestsTo: (path: string) => Array<DataSourceHttpRequest>;
}

export function json(body: JSONValue, status: number = 200): FakeResponse {
  return { status, body };
}

// A route answered in turn by the given responses, the last one repeating.
export function sequence(responses: Array<FakeResponse>): FakeResponder {
  let index: number = 0;

  return (): FakeResponse => {
    const response: FakeResponse =
      responses[Math.min(index, responses.length - 1)]!;
    index++;
    return response;
  };
}

function pathMatches(route: FakeRoute, url: URL): boolean {
  if (route.host && url.host !== route.host) {
    return false;
  }

  if (typeof route.path === "string") {
    return url.pathname === route.path;
  }

  return route.path.test(url.pathname);
}

export function createFakeProviderApi(
  routes: Array<FakeRoute>,
): FakeProviderApi {
  const requests: Array<DataSourceHttpRequest> = [];

  const transport: LlmConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    requests.push(request);
    const url: URL = new URL(request.url);

    const route: FakeRoute | undefined = routes.find(
      (candidate: FakeRoute): boolean => {
        return (
          pathMatches(candidate, url) &&
          (!candidate.method || candidate.method === request.method)
        );
      },
    );

    if (!route) {
      throw new BadDataException(
        `Data source responded with HTTP 404: {"error":"no fake route for ${url.pathname}"}`,
      );
    }

    const response: FakeResponse = await route.respond(request, url);
    const status: number = response.status ?? 200;
    const bodyText: string =
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body ?? {});

    if (status >= 300) {
      throw new BadDataException(
        `Data source responded with HTTP ${status}: ${bodyText.substring(0, 500)}`,
      );
    }

    let bodyJson: unknown = undefined;

    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = undefined;
    }

    return { statusCode: status, bodyText, bodyJson, headers: {} };
  };

  return {
    transport,
    requests,
    requestsTo: (path: string): Array<DataSourceHttpRequest> => {
      return requests.filter((request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).pathname === path;
      });
    },
  };
}

// A query parameter's every value, in order.
export function queryValues(
  request: DataSourceHttpRequest,
  name: string,
): Array<string> {
  return new URL(request.url).searchParams.getAll(name);
}

// Everything a request carried, as one string, to check a secret is in none of it.
export function everythingSent(request: DataSourceHttpRequest): string {
  return JSON.stringify({
    url: request.url,
    headers: request.headers,
    body: request.body,
  });
}

export function bodyOf(request: DataSourceHttpRequest): JSONObject {
  if (typeof request.body === "string") {
    return JSON.parse(request.body) as JSONObject;
  }

  return (request.body || {}) as unknown as JSONObject;
}
