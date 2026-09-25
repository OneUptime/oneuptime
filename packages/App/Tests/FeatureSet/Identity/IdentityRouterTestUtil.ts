import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import { expect } from "@jest/globals";

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

/*
 * The User columns that must never appear in a response body from an identity
 * route: the credential pair, and every other secret or proof-of-possession
 * value the table holds.
 */
export const USER_SECRET_COLUMNS: ReadonlyArray<keyof User> = [
  "password",
  "passwordSalt",
  "resetPasswordToken",
  "resetPasswordExpires",
  "webauthnRegistrationChallenge",
  "webauthnRegistrationChallengeExpiresAt",
  "webauthnAuthenticationChallenge",
  "webauthnAuthenticationChallengeExpiresAt",
  "alertPhoneVerificationCode",
  "paymentProviderCustomerId",
];

export type WithSecretColumnsFunction = (user: User) => User;

/*
 * Loads `user` with a value in every column of USER_SECRET_COLUMNS, the way the
 * write path leaves a freshly created row: the password replaced by its hash
 * and the salt minted onto the same model (DatabaseService.hashColumnValue).
 * Mutates and returns `user`, so a mock can hand back the very model the
 * handler passed in, exactly as `UserService.create` does.
 */
export const withSecretColumns: WithSecretColumnsFunction = (
  user: User,
): User => {
  user.password = new HashedString("scrypt$stored-password-hash", true);
  user.passwordSalt = "stored-password-salt";
  user.resetPasswordToken = "stored-reset-password-token";
  user.resetPasswordExpires = new Date();
  user.webauthnRegistrationChallenge = "stored-registration-challenge";
  user.webauthnRegistrationChallengeExpiresAt = new Date();
  user.webauthnAuthenticationChallenge = "stored-authentication-challenge";
  user.webauthnAuthenticationChallengeExpiresAt = new Date();
  user.alertPhoneVerificationCode = "123456";
  user.paymentProviderCustomerId = "cus_stored";

  return user;
};

export type SentEntityBodyFunction = (
  sendEntityResponseArgs: Array<unknown>,
) => JSONObject;

/*
 * The JSON body the REAL `Response.sendEntityResponse` would have put on the
 * wire, for one call captured by a suite's Response mock.
 *
 * The identity suites mock Response to see what a handler answered with, so
 * nothing in them ever serializes the entity -- and serialization is where a
 * credential leak happens: the real serializer writes out every column that is
 * set on the model, whatever its read permissions say. Inspecting the captured
 * model's fields instead would test how the mock built it, and a plain object
 * standing in for a User serializes to `{}`, which would pass any "no password
 * in the response" check without the route doing anything. Replaying the call
 * through the real implementation checks what the caller actually receives.
 */
export const sentEntityBody: SentEntityBodyFunction = (
  sendEntityResponseArgs: Array<unknown>,
): JSONObject => {
  const actualResponse: typeof import("Common/Server/Utils/Response") =
    jest.requireActual("Common/Server/Utils/Response");

  const res: ExpressResponse = buildResponse();

  actualResponse.default.sendEntityResponse(
    buildRequest(undefined),
    res,
    sendEntityResponseArgs[2] as User | null,
    sendEntityResponseArgs[3] as typeof User,
    sendEntityResponseArgs[4] as { miscData?: JSONObject } | undefined,
  );

  const send: jest.Mock = res.send as unknown as jest.Mock;

  expect(send).toHaveBeenCalledTimes(1);

  // Through JSON text and back, as Express does before it reaches the client.
  return JSON.parse(JSON.stringify(send.mock.calls[0]![0])) as JSONObject;
};

export type ExpectNoUserSecretsFunction = (body: JSONObject) => void;

export const expectNoUserSecrets: ExpectNoUserSecretsFunction = (
  body: JSONObject,
): void => {
  for (const column of USER_SECRET_COLUMNS) {
    expect(body).not.toHaveProperty(column);
  }

  /*
   * Belt and braces against a secret riding in under another key: none of
   * the stored values may appear anywhere in the body.
   */
  const text: string = JSON.stringify(body);

  expect(text).not.toContain("stored-password-hash");
  expect(text).not.toContain("stored-password-salt");
  expect(text).not.toContain("stored-reset-password-token");
  expect(text).not.toContain("stored-registration-challenge");
  expect(text).not.toContain("stored-authentication-challenge");
  expect(text).not.toContain("cus_stored");
};
