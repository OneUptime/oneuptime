import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import crypto from "crypto";

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

export type MockRouter = {
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

export type CreateMockRouterFunction = () => MockRouter;

/*
 * CalWebhook registers `router.post(uri, handler)` at import time, so the
 * route can only be reached by standing in for Express.getRouter() and keeping
 * what it registers.
 */
export const createMockRouter: CreateMockRouterFunction = (): MockRouter => {
  const routes: Array<CapturedRoute> = [];

  const registerForMethod: RegisterForMethod = (method: string) => {
    return (uri: string, ...handlers: Array<RouteHandler>): void => {
      const handler: RouteHandler | undefined = handlers[handlers.length - 1];

      if (!handler) {
        throw new Error(`No handler registered for ${method} ${uri}`);
      }

      routes.push({ method: method.toUpperCase(), uri: uri, handler: handler });
    };
  };

  return {
    get: jest.fn(registerForMethod("get")),
    post: jest.fn(registerForMethod("post")),
    put: jest.fn(registerForMethod("put")),
    delete: jest.fn(registerForMethod("delete")),
    routes: routes,
    match: (method: string, uri: string): RouteHandler => {
      const route: CapturedRoute | undefined = routes.find(
        (candidate: CapturedRoute) => {
          return (
            candidate.method === method.toUpperCase() && candidate.uri === uri
          );
        },
      );

      if (!route) {
        throw new Error(
          `Route ${method} ${uri} not registered. Registered: ${routes
            .map((candidate: CapturedRoute) => {
              return `${candidate.method} ${candidate.uri}`;
            })
            .join(", ")}`,
        );
      }

      return route.handler;
    },
  };
};

export type CapturedResponse = ExpressResponse & {
  statusCode: number | null;
  jsonBody: unknown;
};

export type BuildResponseFunction = () => CapturedResponse;

export const buildResponse: BuildResponseFunction = (): CapturedResponse => {
  const response: Record<string, unknown> = {
    statusCode: null,
    jsonBody: undefined,
  };

  response["status"] = jest.fn((code: number): unknown => {
    response["statusCode"] = code;
    return response;
  });

  response["json"] = jest.fn((body: unknown): unknown => {
    response["jsonBody"] = body;
    return response;
  });

  response["send"] = jest.fn((): unknown => {
    return response;
  });

  response["setHeader"] = jest.fn((): unknown => {
    return response;
  });

  return response as unknown as CapturedResponse;
};

export type SignFunction = (rawBody: string, secret: string) => string;

export const sign: SignFunction = (rawBody: string, secret: string): string => {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
};

export type BuildSignedRequestFunction = (data: {
  body: unknown;
  secret: string;
  /* Overrides the signature that would otherwise be computed over the body. */
  signature?: string | undefined;
  /*
   * Overrides the raw body the request carries WITHOUT re-signing it, so a
   * proxy that reformatted the bytes in flight can be simulated.
   */
  rawBody?: string | undefined;
  omitSignatureHeader?: boolean | undefined;
}) => ExpressRequest;

export const buildSignedRequest: BuildSignedRequestFunction = (data: {
  body: unknown;
  secret: string;
  signature?: string | undefined;
  rawBody?: string | undefined;
  omitSignatureHeader?: boolean | undefined;
}): ExpressRequest => {
  const signedBody: string = JSON.stringify(data.body);
  const rawBody: string =
    data.rawBody === undefined ? signedBody : data.rawBody;

  const headers: Record<string, string> = {};

  if (!data.omitSignatureHeader) {
    headers["x-cal-signature-256"] =
      data.signature === undefined
        ? sign(signedBody, data.secret)
        : data.signature;
  }

  return {
    body: data.body,
    rawBody: rawBody,
    params: {},
    query: {},
    headers: headers,
  } as unknown as ExpressRequest;
};
