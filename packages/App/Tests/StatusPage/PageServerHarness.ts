import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import App from "Common/Server/Utils/StartServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

/*
 * The servers that render public pages - status pages and public dashboards -
 * driven as their containers drive them, for tests of what a page answers.
 *
 * Both containers set themselves up when their modules load: the combined
 * App container's Frontend/Index.ts takes the Express app and registers its
 * routes on it, and each standalone container's Serve.ts calls App.init with
 * its render callback. So loadPageServers() hands them a recording app and
 * reads App.init's calls - which needs the test file to mock StartServer:
 *
 *   jest.mock("Common/Server/Utils/StartServer", () => {
 *     return {
 *       __esModule: true,
 *       default: { init: jest.fn(), addDefaultRoutes: jest.fn() },
 *     };
 *   });
 *
 * The page servers ask the API's /seo what a page is (answerSeo stands in
 * for it), and render index.ejs with what they work out: the response here
 * records the status, the headers, a sent body, a redirect and the render.
 */

export type FakeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  rendered: { view: string; variables: JSONObject } | null;
  // Where a redirect sent the browser, and how.
  redirected: { status: number; location: string } | null;
  headersSent: boolean;
  status: (code: number) => FakeResponse;
  set: (name: string, value: string) => FakeResponse;
  setHeader: (name: string, value: string) => FakeResponse;
  type: (value: string) => FakeResponse;
  send: (body: unknown) => FakeResponse;
  redirect: (status: number, location: string) => void;
  render: (view: string, variables: JSONObject) => void;
};

export function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    rendered: null,
    redirected: null,
    headersSent: false,
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    set: (name: string, value: string): FakeResponse => {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    setHeader: (name: string, value: string): FakeResponse => {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    type: (value: string): FakeResponse => {
      res.headers["content-type"] = value;
      return res;
    },
    send: (body: unknown): FakeResponse => {
      res.body = body;
      res.headersSent = true;
      return res;
    },
    redirect: (status: number, location: string): void => {
      res.statusCode = status;
      res.redirected = { status, location };
      res.headersSent = true;
    },
    render: (view: string, variables: JSONObject): void => {
      res.rendered = { view, variables };
      res.headersSent = true;
    },
  };

  return res;
}

export function pageRequest(data: {
  host: string;
  path: string;
  // The address with its query, when it has one; the path otherwise.
  originalUrl?: string | undefined;
  /*
   * The name Express makes of the request (X-Forwarded-Host under trust
   * proxy) where it differs from the Host the browser connected to.
   */
  hostname?: string | undefined;
  headers?: Record<string, string> | undefined;
}): ExpressRequest {
  return {
    path: data.path,
    url: data.originalUrl || data.path,
    originalUrl: data.originalUrl || data.path,
    method: "GET",
    hostname: data.hostname || data.host,
    protocol: "https",
    headers: { host: data.host, ...(data.headers || {}) },
    get: (name: string): string | undefined => {
      return name.toLowerCase() === "host" ? data.host : undefined;
    },
  } as unknown as ExpressRequest;
}

// What /seo answers, by the page (or domain) asked for; 500 for anything else.
export type SeoAnswers = Record<
  string,
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;

export type SpiedApi = {
  mockImplementation: (implementation: unknown) => void;
  mock: { calls: Array<Array<{ url: unknown }>> };
};

export function spyOnApi(method: "get" | "post"): SpiedApi {
  return jest.spyOn(API, method) as unknown as SpiedApi;
}

export function answerSeo(apiGet: SpiedApi, answers: SeoAnswers): void {
  apiGet.mockImplementation(
    async (data: {
      url: unknown;
    }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String(data.url);

      for (const key of Object.keys(answers)) {
        if (url.endsWith(`/seo/${key}`)) {
          return answers[key]!;
        }
      }

      return new HTTPErrorResponse(500, {}, {});
    },
  );
}

// The pages /seo was asked about, in order.
export function seoLookups(apiGet: SpiedApi): Array<string> {
  return apiGet.mock.calls
    .map((call: Array<{ url: unknown }>): string => {
      return String(call[0]!.url);
    })
    .filter((url: string): boolean => {
      return url.indexOf("/seo/") !== -1;
    })
    .map((url: string): string => {
      return url.split("/seo/")[1] || "";
    });
}

export type PageRenderer = (req: ExpressRequest) => Promise<FakeResponse>;

/*
 * Any route the combined container registered, run with a fake response:
 * what it answered, or that it passed the request on (next()).
 */
export type RouteRunner = (
  req: ExpressRequest,
) => Promise<{ res: FakeResponse; passedOn: boolean }>;

export interface PageServers {
  // The combined App container (Frontend/Index.ts).
  combined: {
    statusPage: PageRenderer;
    publicDashboard: PageRenderer;
    // A host that is not OneUptime's own: a status page's or a dashboard's domain.
    customDomain: PageRenderer;
    // The first route registered for this method and path, whatever it does.
    route: (method: string, path: string) => RouteRunner;
  };
  // The standalone containers (StatusPage/Serve.ts, PublicDashboard/Serve.ts).
  standalone: {
    statusPage: PageRenderer;
    publicDashboard: PageRenderer;
  };
}

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => unknown;

type Registration = {
  method: string;
  paths: Array<string>;
  handler: RouteHandler;
};

type IndexVariablesFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<JSONObject>;

let loaded: PageServers | null = null;

export async function loadPageServers(): Promise<PageServers> {
  if (loaded) {
    return loaded;
  }

  const registrations: Array<Registration> = [];

  const record: (method: string) => (...args: Array<unknown>) => void = (
    method: string,
  ) => {
    return (...args: Array<unknown>): void => {
      const handlers: Array<unknown> = args.filter((arg: unknown) => {
        return typeof arg === "function";
      });

      const firstArg: unknown = args[0];

      registrations.push({
        method,
        paths: Array.isArray(firstArg)
          ? (firstArg as Array<string>)
          : typeof firstArg === "string"
            ? [firstArg]
            : [],
        handler: handlers[handlers.length - 1] as RouteHandler,
      });
    };
  };

  const recordingApp: unknown = {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
    all: record("all"),
    use: record("use"),
  };

  const getExpressApp: jest.SpyInstance = jest
    .spyOn(Express, "getExpressApp")
    .mockReturnValue(recordingApp as ReturnType<typeof Express.getExpressApp>);

  /*
   * Loaded now, not imported at the top: each takes the Express app the
   * moment its module loads, and that has to be the recording one.
   */
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const frontend: { init: () => Promise<void> } =
    require("../../FeatureSet/Frontend/Index").default;
  require("../../FeatureSet/StatusPage/Serve");
  require("../../FeatureSet/PublicDashboard/Serve");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  await frontend.init();

  getExpressApp.mockRestore();

  const handlerFor: (method: string, path: string) => RouteHandler = (
    method: string,
    path: string,
  ): RouteHandler => {
    const registration: Registration | undefined = registrations.find(
      (candidate: Registration): boolean => {
        return candidate.method === method && candidate.paths.includes(path);
      },
    );

    if (!registration) {
      throw new Error(`Nothing registered for ${method} ${path}`);
    }

    return registration.handler;
  };

  const runRoute: (handler: RouteHandler) => PageRenderer = (
    handler: RouteHandler,
  ): PageRenderer => {
    return async (req: ExpressRequest): Promise<FakeResponse> => {
      const res: FakeResponse = fakeResponse();
      const next: jest.Mock = jest.fn();

      await handler(
        req,
        res as unknown as ExpressResponse,
        next as unknown as NextFunction,
      );

      if (next.mock.calls.length > 0) {
        throw new Error(`The route passed ${req.path} on instead of rendering`);
      }

      return res;
    };
  };

  const indexVariablesOf: (appName: string) => IndexVariablesFunction = (
    appName: string,
  ): IndexVariablesFunction => {
    const call: Array<unknown> | undefined = (
      App.init as unknown as jest.Mock
    ).mock.calls.find((candidate: Array<unknown>): boolean => {
      return (candidate[0] as { appName?: string }).appName === appName;
    });

    if (!call) {
      throw new Error(`${appName} did not call App.init`);
    }

    return (
      call[0] as { getVariablesToRenderIndexPage: IndexVariablesFunction }
    ).getVariablesToRenderIndexPage;
  };

  // StartServer renders index.ejs with what the callback returns.
  const runStandalone: (appName: string) => PageRenderer = (
    appName: string,
  ): PageRenderer => {
    const getVariables: IndexVariablesFunction = indexVariablesOf(appName);

    return async (req: ExpressRequest): Promise<FakeResponse> => {
      const res: FakeResponse = fakeResponse();
      const variables: JSONObject = await getVariables(
        req,
        res as unknown as ExpressResponse,
      );
      res.render("views/index.ejs", variables);
      return res;
    };
  };

  const runAnyRoute: (method: string, path: string) => RouteRunner = (
    method: string,
    path: string,
  ): RouteRunner => {
    const handler: RouteHandler = handlerFor(method, path);

    return async (
      req: ExpressRequest,
    ): Promise<{ res: FakeResponse; passedOn: boolean }> => {
      const res: FakeResponse = fakeResponse();
      let passedOn: boolean = false;

      await handler(
        req,
        res as unknown as ExpressResponse,
        (() => {
          passedOn = true;
        }) as unknown as NextFunction,
      );

      return { res, passedOn };
    };
  };

  loaded = {
    combined: {
      statusPage: runRoute(handlerFor("get", "/status-page/*")),
      publicDashboard: runRoute(handlerFor("get", "/public-dashboard/*")),
      // The first catch-all Frontend/Index.ts registers: the custom-domain fallback.
      customDomain: runRoute(handlerFor("get", "*")),
      route: runAnyRoute,
    },
    standalone: {
      statusPage: runStandalone("status-page"),
      publicDashboard: runStandalone("public-dashboard"),
    },
  };

  return loaded;
}
