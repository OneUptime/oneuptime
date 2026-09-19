import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import {
  ensureMasterAdminPageAccess,
  NOT_A_MASTER_ADMIN_MESSAGE,
} from "../../../Server/Utils/MasterAdminPageAccess";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// The decode-failure branch logs at debug; keep the run quiet and observable.
jest.mock("../../../Server/Utils/Logger");

/*
 * ensureMasterAdminPageAccess gates the Admin Dashboard's HTML shell (not its
 * APIs), and replaced two copies of the same inline gate in
 * App/FeatureSet/Frontend/Index.ts and App/FeatureSet/AdminDashboard/Serve.ts.
 *
 * The case it exists for: the access-token cookie expires together with the
 * JWT inside it. An admin who reloads a tab left open past the token lifetime
 * arrives with NO token at all. The old gates answered that with a 422 JSON
 * error page, so the SPA never loaded and never got the chance to refresh the
 * session - the admin was stuck until they found the login page by hand. Now
 * a missing or undecodable token is served the shell (it holds nothing the
 * public static bundle does not), and the SPA's refresh-aware API client
 * recovers the session or sends a signed-out visitor to the login page.
 *
 * The one refusal that did NOT move: a session that decodes and is positively
 * not a master admin still gets the error. Refreshing would hand back the
 * same non-admin session.
 */

const SERVICE: string = "admin-dashboard-test";

describe("ensureMasterAdminPageAccess", () => {
  let request: ExpressRequest;
  let response: ExpressResponse;
  let getAccessTokenSpy: jest.SpyInstance<any, any>;
  let decodeSpy: jest.SpyInstance<any, any>;
  let sendErrorSpy: jest.SpyInstance<any, any>;

  type RunFunction = () => Promise<JSONObject>;

  const run: RunFunction = async (): Promise<JSONObject> => {
    return await ensureMasterAdminPageAccess({
      req: request,
      res: response,
      service: SERVICE,
    });
  };

  type DecodedTokenFunction = (isMasterAdmin: unknown) => JSONWebTokenData;

  const decodedToken: DecodedTokenFunction = (
    isMasterAdmin: unknown,
  ): JSONWebTokenData => {
    return {
      userId: ObjectID.generate(),
      isMasterAdmin: isMasterAdmin,
      isGlobalLogin: true,
    } as unknown as JSONWebTokenData;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    request = { headers: {}, cookies: {} } as unknown as ExpressRequest;

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    getAccessTokenSpy = getJestSpyOn(
      UserMiddleware,
      "getAccessTokenFromExpressRequest",
    ).mockReturnValue(undefined);

    /*
     * Each test that needs a decodable token says what it decodes to. The
     * default is the real failure: JSONWebToken.decode wraps every jwt.verify
     * error (expired, bad signature, malformed) in this BadDataException.
     */
    decodeSpy = getJestSpyOn(JSONWebToken, "decode").mockImplementation(() => {
      throw new BadDataException("AccessToken is invalid or expired");
    });

    sendErrorSpy = getJestSpyOn(
      Response,
      "sendErrorResponse",
    ).mockImplementation(() => {
      return undefined as never;
    });
  });

  describe("with no access token (the expired-cookie reload)", () => {
    test("resolves to an empty object and sends no error, so the SPA loads", async () => {
      await expect(run()).resolves.toEqual({});

      expect(sendErrorSpy).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
      expect(response.send).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
    });

    test("reads the token from the request it was given", async () => {
      await run();

      expect(getAccessTokenSpy).toHaveBeenCalledTimes(1);
      expect(getAccessTokenSpy).toHaveBeenCalledWith(request);
    });

    test("never tries to decode a token it does not have", async () => {
      await run();

      expect(decodeSpy).not.toHaveBeenCalled();
    });

    test("treats an empty-string token as no token", async () => {
      getAccessTokenSpy.mockReturnValue("");

      await expect(run()).resolves.toEqual({});

      expect(decodeSpy).not.toHaveBeenCalled();
      expect(sendErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("with a token that does not decode", () => {
    beforeEach(() => {
      getAccessTokenSpy.mockReturnValue("expired.jwt.token");
    });

    test("resolves to an empty object and sends no error", async () => {
      await expect(run()).resolves.toEqual({});

      expect(decodeSpy).toHaveBeenCalledTimes(1);
      expect(decodeSpy).toHaveBeenCalledWith("expired.jwt.token");
      expect(sendErrorSpy).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
    });

    // Whatever decode throws, the shell is served and nothing escapes.
    test.each([
      [
        "the BadDataException JSONWebToken.decode raises",
        (): Error => {
          return new BadDataException("AccessToken is invalid or expired");
        },
      ],
      [
        "a plain Error",
        (): Error => {
          return new Error("jwt expired");
        },
      ],
      [
        "a NotAuthorizedException",
        (): Error => {
          return new NotAuthorizedException("should not surface");
        },
      ],
    ])(
      "does not reject or send an error when decode throws %s",
      async (_label: string, makeError: () => Error) => {
        decodeSpy.mockImplementation(() => {
          throw makeError();
        });

        await expect(run()).resolves.toEqual({});

        expect(sendErrorSpy).not.toHaveBeenCalled();
      },
    );

    test("logs the decode failure at debug, tagged with the service", async () => {
      const thrown: Error = new Error("jwt expired");

      decodeSpy.mockImplementation(() => {
        throw thrown;
      });

      await run();

      expect(logger.debug).toHaveBeenCalledWith(thrown, { service: SERVICE });
    });
  });

  describe("with a token that decodes", () => {
    beforeEach(() => {
      getAccessTokenSpy.mockReturnValue("valid.jwt.token");
    });

    test("refuses a session that is not a master admin with a 422", async () => {
      decodeSpy.mockReturnValue(decodedToken(false) as never);

      await expect(run()).resolves.toEqual({});

      expect(sendErrorSpy).toHaveBeenCalledTimes(1);

      const [sentRequest, sentResponse, sentError] = sendErrorSpy.mock
        .calls[0] as [ExpressRequest, ExpressResponse, Exception];

      expect(sentRequest).toBe(request);
      expect(sentResponse).toBe(response);
      expect(sentError).toBeInstanceOf(NotAuthorizedException);
      expect(sentError).not.toBeInstanceOf(NotAuthenticatedException);
      expect(sentError.code).toBe(422);
      expect(sentError.message).toBe(NOT_A_MASTER_ADMIN_MESSAGE);
    });

    test("refuses a token with no isMasterAdmin claim at all", async () => {
      decodeSpy.mockReturnValue(decodedToken(undefined) as never);

      await run();

      expect(sendErrorSpy).toHaveBeenCalledTimes(1);
      expect(
        (sendErrorSpy.mock.calls[0] as Array<unknown>)[2] as Exception,
      ).toBeInstanceOf(NotAuthorizedException);
    });

    test("lets a master admin through without sending anything", async () => {
      decodeSpy.mockReturnValue(decodedToken(true) as never);

      await expect(run()).resolves.toEqual({});

      expect(decodeSpy).toHaveBeenCalledWith("valid.jwt.token");
      expect(sendErrorSpy).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
      expect(response.send).not.toHaveBeenCalled();
    });
  });

  test("the refusal message names the admin dashboard", () => {
    expect(NOT_A_MASTER_ADMIN_MESSAGE).toBe(
      "Unauthorized: Only master admins can access the admin dashboard.",
    );
  });
});
