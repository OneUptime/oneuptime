import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * isAuthorizedMasterAdminOrMasterApiKeyMiddleware is the SECOND production
 * consumer of ProjectMiddleware.getApiKey (UserAuthorization is the first), and
 * until now it had no test anywhere in the repo.
 *
 * That mattered when issue #3004 was fixed. getApiKey gained a `.trim()` and a
 * UUID-shape guard, and this middleware inherited both without anyone looking
 * at it:
 *
 *   before: a padded header "  <master-key>  " became ObjectID("  <master-key>  "),
 *           which isMasterApiKey's own UUID guard rejected, so the request fell
 *           through to the JWT check and was refused.
 *   after:  getApiKey trims first, so the same header now authenticates.
 *
 * That is a widening of a master-admin path. It is a safe one — it admits only
 * a caller who already holds the correct master key, and HTTP strips optional
 * whitespace around field values anyway — but it is exactly the kind of change
 * that should be pinned rather than left implicit. These tests pin both the
 * widening and the boundary that did NOT move: a wrong key, a malformed key, or
 * no key at all still gets nothing without a master-admin session.
 *
 * WHICH REFUSAL, NOT JUST WHETHER
 *
 * The access-token cookie expires with the JWT inside it, so an Admin
 * Dashboard tab left open past the token lifetime sends its next request
 * with no token at all. The browser client refreshes the session and replays
 * the request only on a 401. These middlewares used to answer "no token" and
 * "token will not decode" with NotAuthorizedException, which is a 422, so the
 * admin saw "Unauthorized" until they reloaded the page. Both are now
 * NotAuthenticatedException (401). A session that decodes but is not a master
 * admin is a different answer and stays a 422: refreshing it would only hand
 * back the same non-admin session.
 *
 * So every refusal below is asserted by class AND by code. A regression to the
 * old class would still "refuse" and would pass any test that only checked
 * that next() was not called.
 */

const MASTER_API_KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_API_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

const ACCESS_TOKEN_REQUIRED_MESSAGE: string =
  "Unauthorized: Access token is required.";
const INVALID_ACCESS_TOKEN_MESSAGE: string =
  "Unauthorized: Invalid or expired access token.";
const NOT_A_MASTER_ADMIN_MESSAGE: string =
  "Unauthorized: Only master admins can perform this action.";

// The exception handed to Response.sendErrorResponse on its only call.
type SentErrorFunction = () => Exception;

const sentError: SentErrorFunction = (): Exception => {
  const calls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as Exception;
};

type ExpectRefusalFunction = (error: Exception, message: string) => void;

/*
 * 401: the client should refresh the session and replay the request. Also
 * asserted NOT to be the old class, since the two are siblings rather than
 * one extending the other.
 */
const expectNotAuthenticated: ExpectRefusalFunction = (
  error: Exception,
  message: string,
): void => {
  expect(error).toBeInstanceOf(NotAuthenticatedException);
  expect(error).not.toBeInstanceOf(NotAuthorizedException);
  expect(error.code).toBe(ExceptionCode.NotAuthenticatedException);
  expect(error.code).toBe(401);
  expect(error.message).toBe(message);
};

// 422: the caller is known and is simply not allowed. No refresh can fix it.
const expectNotAuthorized: ExpectRefusalFunction = (
  error: Exception,
  message: string,
): void => {
  expect(error).toBeInstanceOf(NotAuthorizedException);
  expect(error).not.toBeInstanceOf(NotAuthenticatedException);
  expect(error.code).toBe(ExceptionCode.NotAuthorizedException);
  expect(error.code).toBe(422);
  expect(error.message).toBe(message);
};

describe("MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware", () => {
  let response: ExpressResponse;
  let next: NextFunction;
  let decodeSpy: jest.SpyInstance<any, any>;

  type RequestWithHeadersFunction = (
    headers: Record<string, string | undefined>,
  ) => ExpressRequest;

  const requestWithHeaders: RequestWithHeadersFunction = (
    headers: Record<string, string | undefined>,
  ): ExpressRequest => {
    return { headers: headers, cookies: {} } as unknown as ExpressRequest;
  };

  type RunFunction = (request: ExpressRequest) => Promise<void>;

  const run: RunFunction = async (request: ExpressRequest): Promise<void> => {
    await MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware(
      request,
      response,
      next,
    );
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    next = jest.fn() as unknown as NextFunction;

    getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
      return undefined as never;
    });

    /*
     * Each test that needs a decodable token says what it decodes to. The
     * default is the real failure: JSONWebToken.decode wraps every jwt.verify
     * error (expired, bad signature, malformed) in this BadDataException.
     */
    decodeSpy = getJestSpyOn(JSONWebToken, "decode").mockImplementation(() => {
      throw new BadDataException("AccessToken is invalid or expired");
    });
  });

  describe("when there is no access token (the expired-cookie case)", () => {
    test("answers 401, not 422, so the client refreshes the session", async () => {
      await run(requestWithHeaders({}));

      expect(next).not.toHaveBeenCalled();
      expectNotAuthenticated(sentError(), ACCESS_TOKEN_REQUIRED_MESSAGE);
    });

    test("never tries to decode a token it does not have", async () => {
      await run(requestWithHeaders({}));

      expect(decodeSpy).not.toHaveBeenCalled();
    });

    /*
     * An Authorization header that is not a Bearer token is no token at all
     * as far as getAccessTokenFromExpressRequest is concerned. It must get
     * the same answer as a missing header, not something the client would
     * treat as final.
     */
    test.each([
      ["a Basic authorization header", "Basic dXNlcjpwYXNz"],
      ["a bare token without the Bearer scheme", "a.b.c"],
      ["an empty authorization header", ""],
    ])(
      "treats %s as no token",
      async (_label: string, authorization: string) => {
        await run(requestWithHeaders({ authorization: authorization }));

        expect(next).not.toHaveBeenCalled();
        expect(decodeSpy).not.toHaveBeenCalled();
        expectNotAuthenticated(sentError(), ACCESS_TOKEN_REQUIRED_MESSAGE);
      },
    );
  });

  describe("when the access token cannot be decoded", () => {
    test("answers 401 with the invalid-or-expired message", async () => {
      await run(requestWithHeaders({ authorization: "Bearer expired.jwt" }));

      expect(next).not.toHaveBeenCalled();
      expect(decodeSpy).toHaveBeenCalledTimes(1);
      expect(decodeSpy).toHaveBeenCalledWith("expired.jwt");
      expectNotAuthenticated(sentError(), INVALID_ACCESS_TOKEN_MESSAGE);
    });

    /*
     * Whatever decode throws, the answer is the same 401. The catch must not
     * leak the underlying error (its class or its message) to the client.
     */
    test.each([
      [
        "the BadDataException JSONWebToken.decode raises",
        new BadDataException("AccessToken is invalid or expired"),
      ],
      ["a plain Error", new Error("jwt expired")],
      [
        "a NotAuthorizedException",
        new NotAuthorizedException("should not surface"),
      ],
    ])(
      "answers 401 whatever decode throws: %s",
      async (_label: string, thrown: Error) => {
        decodeSpy.mockImplementation(() => {
          throw thrown;
        });

        await run(requestWithHeaders({ authorization: "Bearer bad.jwt" }));

        expect(next).not.toHaveBeenCalled();
        expectNotAuthenticated(sentError(), INVALID_ACCESS_TOKEN_MESSAGE);
      },
    );
  });

  describe("when the access token decodes", () => {
    /*
     * The one refusal that did NOT move. This caller is known, refreshing
     * their session would return the same non-admin session, and a 401 here
     * would send the Admin Dashboard round a refresh-and-replay loop.
     */
    test("refuses a session that is not a master admin with a 422", async () => {
      decodeSpy.mockReturnValue({
        isMasterAdmin: false,
      } as unknown as JSONWebTokenData as never);

      await run(requestWithHeaders({ authorization: "Bearer user.jwt" }));

      expect(next).not.toHaveBeenCalled();
      expectNotAuthorized(sentError(), NOT_A_MASTER_ADMIN_MESSAGE);
    });

    test("refuses a token with no isMasterAdmin claim at all with a 422", async () => {
      decodeSpy.mockReturnValue({} as unknown as JSONWebTokenData as never);

      await run(requestWithHeaders({ authorization: "Bearer user.jwt" }));

      expect(next).not.toHaveBeenCalled();
      expectNotAuthorized(sentError(), NOT_A_MASTER_ADMIN_MESSAGE);
    });

    test("lets a master admin session through", async () => {
      decodeSpy.mockReturnValue({
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData as never);

      await run(requestWithHeaders({ authorization: "Bearer admin.jwt" }));

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    /*
     * The Admin Dashboard authenticates with the session cookie, not a
     * header. That cookie is the one whose expiry started all this, so the
     * cookie path gets its own test.
     */
    test("reads the token from the session cookie as well as the header", async () => {
      decodeSpy.mockReturnValue({
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData as never);

      await run({
        headers: {},
        cookies: { [CookieUtil.getUserTokenKey()]: "cookie.admin.jwt" },
      } as unknown as ExpressRequest);

      expect(decodeSpy).toHaveBeenCalledWith("cookie.admin.jwt");
      expect(next).toHaveBeenCalledTimes(1);
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });
  });
});

describe("MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware", () => {
  let request: ExpressRequest;
  let response: ExpressResponse;
  let next: NextFunction;

  type RequestWithHeadersFunction = (
    headers: Record<string, string | Array<string> | undefined>,
  ) => ExpressRequest;

  const requestWithHeaders: RequestWithHeadersFunction = (
    headers: Record<string, string | Array<string> | undefined>,
  ): ExpressRequest => {
    return { headers: headers } as unknown as ExpressRequest;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    next = jest.fn() as unknown as NextFunction;

    getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
      return undefined as never;
    });

    /*
     * Stand in for the GlobalConfig lookup: only the one master key value is
     * live. Spying here rather than on isMasterApiKey keeps the real UUID guard
     * and the real "is it actually the master key" comparison in the test.
     */
    getJestSpyOn(ProjectMiddleware, "isMasterApiKey").mockImplementation(((
      apiKey: ObjectID,
    ): Promise<boolean> => {
      return Promise.resolve(apiKey.toString() === MASTER_API_KEY);
    }) as never);
  });

  describe("when the master API key is presented", () => {
    test("authorizes the request and never looks at the session", async () => {
      const accessTokenSpy: jest.SpyInstance<any, any> = getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      );

      request = requestWithHeaders({ apikey: MASTER_API_KEY });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
      // The key short-circuits before the JWT branch is ever entered.
      expect(accessTokenSpy).not.toHaveBeenCalled();
    });

    /*
     * The behaviour change introduced by the #3004 fix. Before getApiKey
     * trimmed, this request fell through to the JWT check and was refused.
     */
    test("accepts a whitespace-padded master key now that getApiKey trims", async () => {
      request = requestWithHeaders({ apikey: `  ${MASTER_API_KEY}\t` });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    /*
     * getApiKey normalizes whitespace but deliberately does NOT normalize case,
     * so the value reaches the lookup exactly as the caller wrote it. Postgres
     * compares `uuid` values by value rather than by the text they were written
     * in, so a real instance still matches an upper-cased key — this asserts
     * only the part that is ours: what we hand to the lookup.
     */
    test("passes the key to the lookup verbatim, without case normalization", async () => {
      request = requestWithHeaders({
        apikey: `  ${MASTER_API_KEY.toUpperCase()}  `,
      });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(ProjectMiddleware.isMasterApiKey).toHaveBeenCalledTimes(1);

      const lookedUpKey: ObjectID = (
        ProjectMiddleware.isMasterApiKey as unknown as jest.Mock
      ).mock.calls[0]![0] as ObjectID;

      expect(lookedUpKey.toString()).toBe(MASTER_API_KEY.toUpperCase());
    });
  });

  describe("when the key cannot authorize the request", () => {
    /*
     * The boundary that did NOT move with the #3004 fix. Each of these must
     * still be refused, because none of them is the master key.
     */
    const unusableKeys: Array<[string, string]> = [
      ["a well-formed key that is not the master key", OTHER_API_KEY],
      ["an empty header", ""],
      ["a whitespace-only header", "   "],
      ["a non-UUID string", "not-a-uuid"],
      ["a UUID with a segment missing", "8e1a3a52-6d64-4f1f-9a2e"],
      [
        "a UUID with a non-hex character",
        "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2bZZ",
      ],
      ["a SQL injection attempt", "' OR 1=1 --"],
    ];

    /*
     * With no session behind the unusable key, the fall-through lands on the
     * no-token branch. That branch answers 401 now (it was a 422): a caller
     * holding an unusable key and an expired session cookie is, from here,
     * exactly the idle-tab case, and the refusal must let the client refresh.
     * The key being unusable does not make it any MORE authorized.
     */
    test.each(unusableKeys)(
      "refuses %s and falls through to the session check",
      async (_label: string, apiKeyHeader: string) => {
        request = requestWithHeaders({ apikey: apiKeyHeader });

        await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
          request,
          response,
          next,
        );

        expect(next).not.toHaveBeenCalled();
        expectNotAuthenticated(sentError(), ACCESS_TOKEN_REQUIRED_MESSAGE);
      },
    );

    /*
     * The UUID-shape guard added in the #3004 fix has to run BEFORE the key
     * reaches the lookup: ApiKey.apiKey and GlobalConfig.masterApiKey are both
     * Postgres uuid columns, and a non-UUID raises 22P02 as a raw
     * QueryFailedError, which is not a OneUptime Exception and so escapes the
     * error translator as a 500.
     */
    test("never reaches the master key lookup with a malformed value", async () => {
      request = requestWithHeaders({ apikey: "garbage" });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(ProjectMiddleware.isMasterApiKey).not.toHaveBeenCalled();
    });

    /*
     * Duplicate headers arrive from Node joined with a comma. Two keys is never
     * one key, and it must not authenticate as whichever happened to be first.
     */
    test("refuses duplicate apikey headers rather than using the first", async () => {
      request = requestWithHeaders({
        apikey: [MASTER_API_KEY, OTHER_API_KEY],
      });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(ProjectMiddleware.isMasterApiKey).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expectNotAuthenticated(sentError(), ACCESS_TOKEN_REQUIRED_MESSAGE);
    });

    /*
     * The Admin Dashboard's own requests to these read-only routes carry no
     * key, only the session cookie. Once that cookie has expired this is the
     * request the dashboard sends, and it has to be a 401.
     */
    test("refuses a request with no apikey header and no session with a 401", async () => {
      request = requestWithHeaders({});

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(ProjectMiddleware.isMasterApiKey).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expectNotAuthenticated(sentError(), ACCESS_TOKEN_REQUIRED_MESSAGE);
    });

    test("refuses an unusable key with an undecodable session with a 401", async () => {
      getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      ).mockReturnValue("an.expired.token" as never);

      getJestSpyOn(JSONWebToken, "decode").mockImplementation(() => {
        throw new BadDataException("AccessToken is invalid or expired");
      });

      request = requestWithHeaders({ apikey: OTHER_API_KEY });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expectNotAuthenticated(sentError(), INVALID_ACCESS_TOKEN_MESSAGE);
    });

    /*
     * A lookup that blows up must not become an authorization. The catch in the
     * middleware swallows it and falls through to the session check.
     */
    test("falls through to the session check when the key lookup throws", async () => {
      getJestSpyOn(ProjectMiddleware, "isMasterApiKey").mockImplementation(
        (() => {
          return Promise.reject(new Error("database is down"));
        }) as never,
      );

      request = requestWithHeaders({ apikey: MASTER_API_KEY });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      // No session to fall back on, so the no-token 401.
      expectNotAuthenticated(sentError(), ACCESS_TOKEN_REQUIRED_MESSAGE);
    });
  });

  describe("session fallback", () => {
    test("authorizes a master admin session when no key is presented", async () => {
      getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      ).mockReturnValue("a.master.admin.token" as never);

      getJestSpyOn(JSONWebToken, "decode").mockReturnValue({
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData as never);

      request = requestWithHeaders({});

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    test("refuses a session that is not a master admin", async () => {
      getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      ).mockReturnValue("an.ordinary.user.token" as never);

      getJestSpyOn(JSONWebToken, "decode").mockReturnValue({
        isMasterAdmin: false,
      } as unknown as JSONWebTokenData as never);

      request = requestWithHeaders({});

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).not.toHaveBeenCalled();

      // Still a 422: the caller is known, and a refresh would not change that.
      expectNotAuthorized(sentError(), NOT_A_MASTER_ADMIN_MESSAGE);
    });

    /*
     * An unusable apikey header must not cost a caller their valid session on
     * these routes. This middleware is the one place where the presence-based
     * routing in UserAuthorization does NOT apply: it falls through rather than
     * failing fast.
     */
    test("still honours a master admin session when an unusable key is also sent", async () => {
      getJestSpyOn(
        UserMiddleware,
        "getAccessTokenFromExpressRequest",
      ).mockReturnValue("a.master.admin.token" as never);

      getJestSpyOn(JSONWebToken, "decode").mockReturnValue({
        isMasterAdmin: true,
      } as unknown as JSONWebTokenData as never);

      request = requestWithHeaders({ apikey: "" });

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });
  });
});
