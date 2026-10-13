import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type Route = {
  method: string;
  uri: string;
  middleware: RouterFunction;

  /*
   * Every function registered ahead of the handler, in order. Routes that
   * stack more than one middleware — a rate limiter in front of
   * UserMiddleware, say — are only fully described by this list; `middleware`
   * is just its first entry, kept for the many tests that assert on a single
   * middleware.
   */
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
};

type ParamFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  value: unknown,
  name: string,
) => void | Promise<void>;

/*
 * A router.param registration: Express runs `handler` ahead of every route
 * whose path has a parameter of this name. The routes recorded above are
 * called directly, so a test that wants a route as Express runs it calls the
 * route's params' handlers first, or replays the routes onto a real app.
 */
type Param = {
  name: string;
  handler: ParamFunction;
};

type MockRouterForMethodFunction = (
  method: string,
) => (uri: string, ...routerFunctions: Array<RouterFunction>) => void;

const mockRouterForMethod: MockRouterForMethodFunction = (method: string) => {
  return (uri: string, ...routerFunctions: Array<RouterFunction>): void => {
    /*
     * Express takes any number of functions after the path. The last one is
     * the handler that actually serves the request; everything before it is
     * middleware. Routes registered without middleware — router.get(uri,
     * handler) — leave the middleware list empty, and `middleware` falls back
     * to the handler so existing callers keep working.
     */
    const handlerFunction: RouterFunction | undefined =
      routerFunctions[routerFunctions.length - 1];

    const middlewares: Array<RouterFunction> = routerFunctions.slice(0, -1);

    mockRouter.routes.push({
      method: method.toUpperCase(),
      uri,
      middleware: middlewares[0] || (handlerFunction as RouterFunction),
      middlewares,
      handlerFunction: handlerFunction as RouterFunction,
    });
  };
};

type MockRouter = {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;

  /*
   * Express's catch-every-method registration. Recorded with the method
   * "ALL"; a test that replays the routes onto a real app should map it to
   * `app.all`.
   */
  all: jest.Mock;
  param: jest.Mock;
  routes: Route[];
  params: Param[];
  match: (method: string, uri: string) => Route;
};

export const mockRouter: MockRouter = {
  get: jest.fn().mockImplementation(mockRouterForMethod("get")),
  post: jest.fn().mockImplementation(mockRouterForMethod("post")),
  put: jest.fn().mockImplementation(mockRouterForMethod("put")),
  delete: jest.fn().mockImplementation(mockRouterForMethod("delete")),
  all: jest.fn().mockImplementation(mockRouterForMethod("all")),
  param: jest
    .fn()
    .mockImplementation((name: string, handler: ParamFunction): void => {
      mockRouter.params.push({ name, handler });
    }),
  routes: [] as any as Route[],
  params: [] as Param[],
  match: (method: string, uri: string) => {
    const route: Route | undefined = mockRouter.routes.find((route: Route) => {
      return method.toUpperCase() === route.method && uri === route.uri;
    });
    if (!route) {
      throw "not found";
    }
    return route;
  },
};
