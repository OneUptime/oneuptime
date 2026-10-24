import {
  CodeHostHttpRequest,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";

/*
 * A Git server's API, faked at the transport: each route answers what the
 * host's API documents for it (status, JSON, headers), and every request is
 * kept, so a test reads what the client sent - its address, its headers,
 * its body - as the server would have.
 */

export interface FakeAnswer {
  status?: number | undefined;
  json?: unknown;
  text?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface FakeRoute {
  method: string;
  // The path after the API's base, without the query: "/user".
  path: string | RegExp;
  answer: (request: CodeHostHttpRequest, url: URL) => FakeAnswer;
}

export interface FakeCodeHost {
  transport: CodeHostTransport;
  requests: Array<CodeHostHttpRequest>;
  // The requests to a path, by their URL.
  urlsTo: (path: string) => Array<URL>;
}

export function fakeCodeHost(data: {
  apiBaseUrl: string;
  routes: Array<FakeRoute>;
}): FakeCodeHost {
  const requests: Array<CodeHostHttpRequest> = [];
  const base: URL = new URL(data.apiBaseUrl);

  const transport: CodeHostTransport = async (
    request: CodeHostHttpRequest,
  ): Promise<CodeHostHttpResponse> => {
    requests.push(request);

    const url: URL = new URL(request.url);
    const path: string = url.pathname.startsWith(base.pathname)
      ? url.pathname.substring(base.pathname.length)
      : url.pathname;

    const route: FakeRoute | undefined = data.routes.find(
      (candidate: FakeRoute): boolean => {
        return (
          candidate.method === request.method &&
          (typeof candidate.path === "string"
            ? candidate.path === path
            : candidate.path.test(path))
        );
      },
    );

    if (!route) {
      return {
        statusCode: 404,
        bodyText: '{"message":"404 Not Found"}',
        bodyJson: { message: "404 Not Found" },
        headers: {},
      };
    }

    const answer: FakeAnswer = route.answer(request, url);
    const text: string =
      answer.text !== undefined
        ? answer.text
        : answer.json !== undefined
          ? JSON.stringify(answer.json)
          : "";

    return {
      statusCode: answer.status ?? 200,
      bodyText: text,
      bodyJson: answer.json,
      headers: answer.headers || {},
    };
  };

  return {
    transport,
    requests,
    urlsTo: (path: string): Array<URL> => {
      return requests
        .map((request: CodeHostHttpRequest): URL => {
          return new URL(request.url);
        })
        .filter((url: URL): boolean => {
          return url.pathname.endsWith(path);
        });
    },
  };
}

export const noWait: () => Promise<void> = async (): Promise<void> => {
  // No waiting in tests.
};
