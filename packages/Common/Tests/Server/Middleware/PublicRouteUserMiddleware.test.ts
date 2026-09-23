import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import jwt from "jsonwebtoken";

/*
 * getPublicRouteUserMiddleware: getUserMiddleware for the public dashboard and
 * public status page routes.
 *
 * THE BUG
 *
 * The host-wide dashboard access-token cookie reaches the public routes
 * whenever the page is served from the dashboard's host. When that cookie is
 * still in the browser but no longer decodes - the encryption secret was
 * rotated, say - getUserMiddleware answered 401 "AccessToken is invalid or
 * expired" before the route ever asked whether the dashboard was public. The
 * public clients cannot refresh a dashboard session, so the 401 went straight
 * to the login redirect: a reload loop on the preview route, and a password
 * prompt for a master password the viewer had already entered.
 *
 * WHAT THIS FILE PINS
 *
 *   1. On the public variant, a token that does not decode is anonymity, not
 *      a refusal: UserType.Public, no identity, next().
 *   2. Everything else is getUserMiddleware's behaviour: a good token is
 *      resolved the same way, an API key is still validated, no token is
 *      still anonymous.
 *   3. getUserMiddleware itself, which every authenticated route mounts,
 *      still answers the same tokens with a 401.
 *
 * Tokens are signed and decoded with the real JSONWebToken, so "does not
 * decode" means exactly what it means in production.
 */

const INVALID_ACCESS_TOKEN_MESSAGE: string =
  "AccessToken is invalid or expired. Please refresh your token.";

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type TokenPayloadFunction = () => Dictionary<string | boolean>;

const tokenPayload: TokenPayloadFunction = (): Dictionary<string | boolean> => {
  return {
    userId: USER_ID.toString(),
    email: "viewer@example.com",
    name: "Viewer",
    isMasterAdmin: false,
    isGlobalLogin: true,
    sessionId: ObjectID.generate().toString(),
  };
};

/*
 * Each one well-formed enough to be sent as a session, none of them one this
 * instance will accept.
 */
const UNDECODABLE_TOKENS: Array<[string, () => string]> = [
  [
    "a token signed with a rotated-out encryption secret",
    (): string => {
      return jwt.sign(
        tokenPayload(),
        `${EncryptionSecret.toString()}-before-rotation`,
        { expiresIn: 15 * 60 },
      );
    },
  ],
  [
    "an expired token",
    (): string => {
      return jwt.sign(tokenPayload(), EncryptionSecret.toString(), {
        expiresIn: -60,
      });
    },
  ],
  [
    "a value that is not a JWT at all",
    (): string => {
      return "not-a-jwt";
    },
  ],
];

type SignValidTokenFunction = (data?: { isMasterAdmin?: boolean }) => string;

const signValidToken: SignValidTokenFunction = (data?: {
  isMasterAdmin?: boolean;
}): string => {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("viewer@example.com"),
      name: new Name("Viewer"),
      timezone: null,
      isMasterAdmin: Boolean(data?.isMasterAdmin),
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
};

type BuildRequestFunction = (data: {
  cookies?: Dictionary<string>;
  headers?: Dictionary<string>;
}) => OneUptimeRequest;

/*
 * Shaped like a public client's request: the public dashboard and status page
 * clients send an empty tenantid header, so no tenant is resolved.
 */
const buildRequest: BuildRequestFunction = (data: {
  cookies?: Dictionary<string>;
  headers?: Dictionary<string>;
}): OneUptimeRequest => {
  return {
    params: {},
    query: {},
    body: {},
    cookies: data.cookies || {},
    headers: { tenantid: "", ...(data.headers || {}) },
  } as unknown as OneUptimeRequest;
};

type MiddlewareFunction = (
  req: OneUptimeRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type MiddlewareCallResult = {
  nextCalls: Array<Array<unknown>>;
  sentError: Exception | undefined;
  sendErrorCallCount: number;
  headersSet: Array<Array<unknown>>;
};

type CallMiddlewareFunction = (
  middleware: MiddlewareFunction,
  req: OneUptimeRequest,
) => Promise<MiddlewareCallResult>;

const callMiddleware: CallMiddlewareFunction = async (
  middleware: MiddlewareFunction,
  req: OneUptimeRequest,
): Promise<MiddlewareCallResult> => {
  const set: jest.Mock = jest.fn();
  const res: ExpressResponse = { set } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await middleware(req, res, next as unknown as NextFunction);

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    nextCalls: next.mock.calls as Array<Array<unknown>>,
    sentError: errorCalls[0]?.[2] as Exception | undefined,
    sendErrorCallCount: errorCalls.length,
    headersSet: set.mock.calls as Array<Array<unknown>>,
  };
};

type ExpectServedAnonymouslyFunction = (
  result: MiddlewareCallResult,
  req: OneUptimeRequest,
) => void;

const expectServedAnonymously: ExpectServedAnonymouslyFunction = (
  result: MiddlewareCallResult,
  req: OneUptimeRequest,
): void => {
  expect(result.sendErrorCallCount).toBe(0);
  expect(result.nextCalls).toHaveLength(1);
  // next() with an argument is Express's error path, not a pass.
  expect(result.nextCalls[0]).toEqual([]);
  expect(req.userType).toBe(UserType.Public);
  expect(req.userAuthorization).toBeUndefined();
  expect(UserMiddleware.isAnonymousRequest(req)).toBe(true);
};

type ExpectInvalidTokenRefusalFunction = (result: MiddlewareCallResult) => void;

const expectInvalidTokenRefusal: ExpectInvalidTokenRefusalFunction = (
  result: MiddlewareCallResult,
): void => {
  expect(result.nextCalls).toHaveLength(0);
  expect(result.sendErrorCallCount).toBe(1);
  expect(result.sentError).toBeInstanceOf(NotAuthenticatedException);
  expect(result.sentError?.code).toBe(401);
  expect(result.sentError?.message).toBe(INVALID_ACCESS_TOKEN_MESSAGE);
};

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [],
  globalPermissions: [],
};

let getUserGlobalAccessPermission: jest.SpyInstance;
let userUpdateLastActive: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });
  // JSONWebToken.decode logs every token it refuses.
  getJestSpyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });

  getUserGlobalAccessPermission = getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockResolvedValue(GLOBAL_PERMISSION);
  userUpdateLastActive = getJestSpyOn(
    UserService,
    "updateLastActive",
  ).mockResolvedValue(undefined);
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
  // A blocked user's token is BlockedUserMiddleware.test.ts; here nobody is blocked.
  getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserMiddleware.getPublicRouteUserMiddleware", () => {
  describe("with an access token that does not decode", () => {
    test.each(UNDECODABLE_TOKENS)(
      "serves %s in the access-token cookie anonymously",
      async (_label: string, token: () => string) => {
        const req: OneUptimeRequest = buildRequest({
          cookies: { "user-token": token() },
        });

        const result: MiddlewareCallResult = await callMiddleware(
          UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
          req,
        );

        expectServedAnonymously(result, req);
      },
    );

    test.each(UNDECODABLE_TOKENS)(
      "serves %s in an Authorization: Bearer header anonymously",
      async (_label: string, token: () => string) => {
        const req: OneUptimeRequest = buildRequest({
          headers: { authorization: `Bearer ${token()}` },
        });

        const result: MiddlewareCallResult = await callMiddleware(
          UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
          req,
        );

        expectServedAnonymously(result, req);
      },
    );

    /*
     * Anonymous means anonymous: nothing about the undecodable token's
     * claimed user is looked up, recorded, or sent back.
     */
    test("resolves no user, records no activity and sets no permission headers", async () => {
      const req: OneUptimeRequest = buildRequest({
        cookies: { "user-token": "not-a-jwt" },
      });

      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
        req,
      );

      expect(getUserGlobalAccessPermission).not.toHaveBeenCalled();
      expect(userUpdateLastActive).not.toHaveBeenCalled();
      expect(result.headersSet).toEqual([]);
      expect(req.userGlobalAccessPermission).toBeUndefined();
      expect(req.userTenantAccessPermission).toBeUndefined();
    });

    /*
     * The request comes out exactly as anonymous as one with no token, so a
     * guard behind it still refuses it. Mounting this middleware by mistake
     * in front of an authenticated handler cannot promote a dead session.
     */
    test("leaves a request that requireUserAuthentication still refuses", async () => {
      const req: OneUptimeRequest = buildRequest({
        cookies: { "user-token": "not-a-jwt" },
      });

      await callMiddleware(
        UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
        req,
      );

      const guarded: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.requireUserAuthentication as MiddlewareFunction,
        req,
      );

      expect(guarded.nextCalls).toHaveLength(0);
      expect(guarded.sentError).toBeInstanceOf(NotAuthenticatedException);
      expect(guarded.sentError?.message).toBe(
        UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    });
  });

  describe("otherwise behaves exactly like getUserMiddleware", () => {
    test.each([
      ["a signed-in user", false, UserType.User],
      ["a master admin", true, UserType.MasterAdmin],
    ])(
      "resolves %s from a token that decodes",
      async (_label: string, isMasterAdmin: boolean, userType: UserType) => {
        const token: string = signValidToken({ isMasterAdmin });

        const publicReq: OneUptimeRequest = buildRequest({
          cookies: { "user-token": token },
        });
        const strictReq: OneUptimeRequest = buildRequest({
          cookies: { "user-token": token },
        });

        const publicResult: MiddlewareCallResult = await callMiddleware(
          UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
          publicReq,
        );
        const strictResult: MiddlewareCallResult = await callMiddleware(
          UserMiddleware.getUserMiddleware as MiddlewareFunction,
          strictReq,
        );

        expect(publicResult.sendErrorCallCount).toBe(0);
        expect(publicResult.nextCalls).toEqual([[]]);
        expect(publicReq.userType).toBe(userType);
        expect(publicReq.userAuthorization?.userId.toString()).toBe(
          USER_ID.toString(),
        );
        expect(publicReq.userGlobalAccessPermission).toEqual(GLOBAL_PERMISSION);

        expect(publicReq.userType).toBe(strictReq.userType);
        expect(publicReq.userAuthorization).toEqual(
          strictReq.userAuthorization,
        );
        expect(publicReq.userGlobalAccessPermission).toEqual(
          strictReq.userGlobalAccessPermission,
        );
        expect(publicResult.headersSet).toEqual(strictResult.headersSet);
      },
    );

    test("serves a request with no token anonymously", async () => {
      const req: OneUptimeRequest = buildRequest({});

      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
        req,
      );

      expectServedAnonymously(result, req);
    });

    /*
     * An API key is a credential the caller chose to present, not a stale
     * cookie the browser happened to attach. It is still handed to the API
     * key middleware, which decides - before any token is read.
     */
    test("still hands an API key to the API key middleware", async () => {
      const isValidProjectIdAndApiKeyMiddleware: jest.SpyInstance =
        getJestSpyOn(
          ProjectMiddleware,
          "isValidProjectIdAndApiKeyMiddleware",
        ).mockResolvedValue(undefined);

      const req: OneUptimeRequest = buildRequest({
        cookies: { "user-token": "not-a-jwt" },
        headers: { apikey: "not-a-valid-key" },
      });

      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
        req,
      );

      expect(isValidProjectIdAndApiKeyMiddleware).toHaveBeenCalledTimes(1);
      expect(isValidProjectIdAndApiKeyMiddleware.mock.calls[0]?.[0]).toBe(req);
      expect(result.nextCalls).toHaveLength(0);
      expect(req.userType).toBeUndefined();
    });
  });
});

/*
 * Every authenticated /api route mounts getUserMiddleware. The fix must not
 * reach it: there a dead session is still a 401, which is what makes the
 * dashboard client refresh.
 */
describe("UserMiddleware.getUserMiddleware (authenticated routes)", () => {
  test.each(UNDECODABLE_TOKENS)(
    "still answers %s in the access-token cookie with a 401",
    async (_label: string, token: () => string) => {
      const req: OneUptimeRequest = buildRequest({
        cookies: { "user-token": token() },
      });

      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.getUserMiddleware as MiddlewareFunction,
        req,
      );

      expectInvalidTokenRefusal(result);
      expect(req.userType).toBeUndefined();
    },
  );

  test.each(UNDECODABLE_TOKENS)(
    "still answers %s in an Authorization: Bearer header with a 401",
    async (_label: string, token: () => string) => {
      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.getUserMiddleware as MiddlewareFunction,
        buildRequest({ headers: { authorization: `Bearer ${token()}` } }),
      );

      expectInvalidTokenRefusal(result);
    },
  );
});
