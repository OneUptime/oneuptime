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
  handler: RouteHandler;
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
};

type RegisterForMethod = (
  method: string,
) => (uri: string, ...handlers: Array<RouteHandler>) => void;

export type CreateMockIdentityRouterFunction = () => MockIdentityRouter;

export const createMockIdentityRouter: CreateMockIdentityRouterFunction =
  (): MockIdentityRouter => {
    const routes: Array<CapturedRoute> = [];

    const registerForMethod: RegisterForMethod = (method: string) => {
      return (uri: string, ...handlers: Array<RouteHandler>): void => {
        const handler: RouteHandler | undefined = handlers[handlers.length - 1];

        if (!handler) {
          throw new Error(`No handler registered for ${method} ${uri}`);
        }

        routes.push({ method: method.toUpperCase(), uri, handler });
      };
    };

    return {
      get: jest.fn(registerForMethod("get")),
      post: jest.fn(registerForMethod("post")),
      put: jest.fn(registerForMethod("put")),
      delete: jest.fn(registerForMethod("delete")),
      routes,
      match: (method: string, uri: string): RouteHandler => {
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

        return route.handler;
      },
    };
  };

export type BuildRequestFunction = (body: unknown) => ExpressRequest;

export const buildRequest: BuildRequestFunction = (
  body: unknown,
): ExpressRequest => {
  return {
    body: body,
    params: {},
    query: {},
    headers: {},
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
