import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
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
 */

const MASTER_API_KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_API_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

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
        expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);

        const error: NotAuthorizedException = (
          Response.sendErrorResponse as unknown as jest.Mock
        ).mock.calls[0]![2] as NotAuthorizedException;

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error.message).toBe("Unauthorized: Access token is required.");
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
      expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    });

    test("refuses a request with no apikey header and no session", async () => {
      request = requestWithHeaders({});

      await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
        request,
        response,
        next,
      );

      expect(ProjectMiddleware.isMasterApiKey).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
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
      expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
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

      const error: NotAuthorizedException = (
        Response.sendErrorResponse as unknown as jest.Mock
      ).mock.calls[0]![2] as NotAuthorizedException;

      expect(error.message).toBe(
        "Unauthorized: Only master admins can perform this action.",
      );
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
