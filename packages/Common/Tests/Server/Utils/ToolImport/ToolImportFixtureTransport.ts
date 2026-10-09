import Dictionary from "../../../../Types/Dictionary";
import {
  ToolImportHttpRequest,
  ToolImportHttpResponse,
  ToolImportTransport,
} from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";

/*
 * A stand-in for another tool's API, for the import tests. Every request an
 * adapter makes lands here instead of the network: a route answers by path
 * (and, when it cares, by query), every request is recorded, and a route
 * can answer a sequence (429, 429, 200) to drive the rate-limit handling.
 * A request no route answers fails the test loudly, so an adapter that
 * calls something its tool's documentation does not list is caught.
 *
 * No test of the import ever calls a real tool: this is the only transport
 * they pass.
 */

export type FixtureAnswer =
  | ToolImportHttpResponse
  | ((request: ToolImportHttpRequest, url: URL) => ToolImportHttpResponse)
  | Error;

export interface FixtureRoute {
  // The request path, exactly ("/v2/users").
  path: string;
  // Query parameters the request must carry to match (others are ignored).
  query?: Dictionary<string> | undefined;
  /*
   * What the route answers. A list is answered in order, its last entry
   * repeating once the list runs out.
   */
  answers: Array<FixtureAnswer>;
}

export function json(
  body: unknown,
  status: number = 200,
  headers: Dictionary<string> = {},
): ToolImportHttpResponse {
  return {
    statusCode: status,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: headers,
  };
}

export class FixtureApi {
  public requests: Array<ToolImportHttpRequest> = [];
  public urls: Array<URL> = [];
  private routes: Array<FixtureRoute & { calls: number }> = [];

  public constructor(routes: Array<FixtureRoute> = []) {
    for (const route of routes) {
      this.add(route);
    }
  }

  public add(route: FixtureRoute): FixtureApi {
    // Later routes win over earlier ones for the same request.
    this.routes.unshift({ ...route, calls: 0 });
    return this;
  }

  public get transport(): ToolImportTransport {
    return async (
      request: ToolImportHttpRequest,
    ): Promise<ToolImportHttpResponse> => {
      this.requests.push(request);
      const url: URL = new URL(request.url);
      this.urls.push(url);

      const route: (FixtureRoute & { calls: number }) | undefined =
        this.routes.find((candidate: FixtureRoute): boolean => {
          if (candidate.path !== url.pathname) {
            return false;
          }

          return Object.entries(candidate.query || {}).every(
            ([key, value]: [string, string]): boolean => {
              return url.searchParams.get(key) === value;
            },
          );
        });

      if (!route) {
        throw new Error(
          `The fixture API has no route for ${url.pathname}${url.search}`,
        );
      }

      const answer: FixtureAnswer =
        route.answers[Math.min(route.calls, route.answers.length - 1)]!;
      route.calls++;

      if (answer instanceof Error) {
        throw answer;
      }

      if (typeof answer === "function") {
        return answer(request, url);
      }

      return answer;
    };
  }

  // The requests to `path`, in order.
  public callsTo(path: string): Array<URL> {
    return this.urls.filter((url: URL): boolean => {
      return url.pathname === path;
    });
  }
}

// A sleep that records how long it was asked to wait, and returns at once.
export class RecordingSleep {
  public waits: Array<number> = [];
  public clock: { now: number };

  public constructor(clock: { now: number } = { now: 0 }) {
    this.clock = clock;
  }

  public get sleep(): (ms: number) => Promise<void> {
    return async (ms: number): Promise<void> => {
      this.waits.push(ms);
      this.clock.now += ms;
    };
  }
}
