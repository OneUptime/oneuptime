import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

export type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

export type CapturedRoute = {
  method: string;
  uri: string;

  /* The route handler proper -- the last function passed to router.post. */
  handler: RouteHandler;

  /*
   * Everything passed to router.post, middleware first, handler last. `match`
   * returns only the handler so that a test written against the handler keeps
   * working when middleware is added in front of it; `matchAll` is for the
   * tests that are about the middleware BEING there.
   */
  handlers: Array<RouteHandler>;
};

/*
 * The identity routers register handlers as `router.post(uri, handler)` -- two arguments, no
 * middleware -- so the shared mockRouter in Common/Tests/Server/API/Helpers.ts (which assumes
 * three) cannot capture them. This one takes the LAST function argument as the handler, so it
 * works for both arities.
 */
export type MockIdentityRouter = {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
  routes: Array<CapturedRoute>;
  match: (method: string, uri: string) => RouteHandler;
  matchAll: (method: string, uri: string) => Array<RouteHandler>;
};

type RegisterForMethod = (
  method: string,
) => (uri: string, ...handlers: Array<RouteHandler>) => void;

export type CreateMockIdentityRouterFunction = () => MockIdentityRouter;

type FindRouteFunction = (
  routes: Array<CapturedRoute>,
  method: string,
  uri: string,
) => CapturedRoute;

const findRoute: FindRouteFunction = (
  routes: Array<CapturedRoute>,
  method: string,
  uri: string,
): CapturedRoute => {
  const route: CapturedRoute | undefined = routes.find(
    (route: CapturedRoute) => {
      return route.method === method.toUpperCase() && route.uri === uri;
    },
  );

  if (!route) {
    throw new Error(
      `Route ${method} ${uri} not registered. Registered: ${routes
        .map((r: CapturedRoute) => {
          return `${r.method} ${r.uri}`;
        })
        .join(", ")}`,
    );
  }

  return route;
};

export const createMockIdentityRouter: CreateMockIdentityRouterFunction =
  (): MockIdentityRouter => {
    const routes: Array<CapturedRoute> = [];

    const registerForMethod: RegisterForMethod = (method: string) => {
      return (uri: string, ...handlers: Array<RouteHandler>): void => {
        const handler: RouteHandler | undefined = handlers[handlers.length - 1];

        if (!handler) {
          throw new Error(`No handler registered for ${method} ${uri}`);
        }

        routes.push({
          method: method.toUpperCase(),
          uri,
          handler,
          handlers: handlers,
        });
      };
    };

    return {
      get: jest.fn(registerForMethod("get")),
      post: jest.fn(registerForMethod("post")),
      put: jest.fn(registerForMethod("put")),
      delete: jest.fn(registerForMethod("delete")),
      routes,
      match: (method: string, uri: string): RouteHandler => {
        return findRoute(routes, method, uri).handler;
      },
      matchAll: (method: string, uri: string): Array<RouteHandler> => {
        return findRoute(routes, method, uri).handlers;
      },
    };
  };

/*
 * Anything a test needs to vary about the request beyond its body. `headers`
 * and `socketAddress` are what the rate limiter reads to decide which client
 * an attempt is billed to.
 */
export type BuildRequestOverrides = {
  headers?: Record<string, string | Array<string>> | undefined;
  socketAddress?: string | undefined;
};

export type BuildRequestFunction = (
  body: unknown,
  overrides?: BuildRequestOverrides,
) => ExpressRequest;

export const buildRequest: BuildRequestFunction = (
  body: unknown,
  overrides?: BuildRequestOverrides,
): ExpressRequest => {
  return {
    body: body,
    params: {},
    query: {},
    headers: overrides?.headers || {},
    socket: { remoteAddress: overrides?.socketAddress },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;
};

export type BuildResponseFunction = () => ExpressResponse;

export const buildResponse: BuildResponseFunction = (): ExpressResponse => {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
};
