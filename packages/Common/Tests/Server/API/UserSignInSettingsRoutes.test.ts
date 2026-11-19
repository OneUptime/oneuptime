import UserAPI from "../../../Server/API/UserAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UserService from "../../../Server/Services/UserService";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SIGN_IN_MANAGEMENT_API_ROUTE } from "../../../Types/SSO/SsoManagedSignIn";
import { TWO_FACTOR_AUTH_STATUS_API_ROUTE } from "../../../Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GET /user/sign-in-management and GET /user/two-factor-auth-status: what
 * User Profile > Security reads about the signed-in person (#9688, #9666).
 *
 *   - whether their organization manages how they sign in, and the server's
 *     SSO providers to name (SsoManagedSignIn.getSignInManagement);
 *   - whether two-factor authentication is on, and how many second steps
 *     are set up behind it (UserService.getTwoFactorAuthSetup).
 *
 * Each answers about the caller on the access token and nobody else - there
 * is no id in the path, and an id anywhere in the request is ignored - only
 * once a session is proved, with nothing a cache may keep, and with only
 * the fields the page reads.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    sendFileByPath: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const CALLER_ID: ObjectID = new ObjectID(
  "9f000000-0000-4000-8000-000000000001",
);
const SOMEBODY_ELSE: string = "9f000000-0000-4000-8000-000000000002";

const SIGN_IN_ROUTE: string = "/user/sign-in-management";
const TWO_FACTOR_ROUTE: string = "/user/two-factor-auth-status";

type Call = { thrown: unknown; nextCallCount: number };

const call: (data: {
  route: string;
  signedIn?: boolean | undefined;
}) => Promise<Call> = async (data: {
  route: string;
  signedIn?: boolean | undefined;
}): Promise<Call> => {
  const req: OneUptimeRequest = {
    params: { userId: SOMEBODY_ELSE, id: SOMEBODY_ELSE },
    query: { userId: SOMEBODY_ELSE },
    body: { userId: SOMEBODY_ELSE, data: { userId: SOMEBODY_ELSE } },
    headers: {},
    ...(data.signedIn === false
      ? {}
      : { userAuthorization: { userId: CALLER_ID } }),
  } as unknown as OneUptimeRequest;

  const res: OneUptimeResponse = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as OneUptimeResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", data.route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
};

const sentJson: () => JSONObject = (): JSONObject => {
  const sent: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0];

  return (sent?.[2] as JSONObject) || {};
};

let getSignInManagement: jest.SpyInstance;
let getTwoFactorAuthSetup: jest.SpyInstance;

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  getSignInManagement = getJestSpyOn(
    SsoManagedSignIn,
    "getSignInManagement",
  ).mockResolvedValue({
    isManagedBySso: true,
    ssoProviderNames: ["Okta"],
  });

  getTwoFactorAuthSetup = getJestSpyOn(
    UserService,
    "getTwoFactorAuthSetup",
  ).mockResolvedValue({
    status: TwoFactorAuthStatus.EnabledConfigured,
    verifiedMethodCount: 2,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test("are the ones the profile asks", () => {
    expect(SIGN_IN_MANAGEMENT_API_ROUTE).toBe(SIGN_IN_ROUTE);
    expect(TWO_FACTOR_AUTH_STATUS_API_ROUTE).toBe(TWO_FACTOR_ROUTE);
  });

  test.each([SIGN_IN_ROUTE, TWO_FACTOR_ROUTE])(
    "%s is a GET behind the session and the guard that turns no session into a 401",
    (route: string) => {
      expect(mockRouter.match("GET", route).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  test.each([SIGN_IN_ROUTE, TWO_FACTOR_ROUTE])(
    "%s takes no id: there is nobody but the caller to ask about",
    (route: string) => {
      expect(route).not.toMatch(/:/);
    },
  );
});

describe("GET /user/sign-in-management", () => {
  test("answers the caller's own question, whatever ids the request carries", async () => {
    const result: Call = await call({ route: SIGN_IN_ROUTE });

    expect(result.nextCallCount).toBe(0);
    expect(getSignInManagement).toHaveBeenCalledTimes(1);
    expect((getSignInManagement.mock.calls[0]![0] as ObjectID).toString()).toBe(
      CALLER_ID.toString(),
    );
    expect(sentJson()).toEqual({
      isManagedBySso: true,
      ssoProviderNames: ["Okta"],
    });
  });

  test("sends only what the page reads", async () => {
    getSignInManagement.mockResolvedValue({
      isManagedBySso: false,
      ssoProviderNames: [],
      somethingElse: "secret",
    });

    await call({ route: SIGN_IN_ROUTE });

    expect(Object.keys(sentJson()).sort()).toEqual([
      "isManagedBySso",
      "ssoProviderNames",
    ]);
  });

  test("is never kept by a cache: it changes when a master admin flips the requirement", async () => {
    await call({ route: SIGN_IN_ROUTE });

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
  });

  test("a request with no session is not authenticated, and nothing is read", async () => {
    const result: Call = await call({ route: SIGN_IN_ROUTE, signedIn: false });

    expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(getSignInManagement).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a rule that cannot be read is an error, never an answer", async () => {
    getSignInManagement.mockRejectedValue(new Error("connection refused"));

    const result: Call = await call({ route: SIGN_IN_ROUTE });

    expect((result.thrown as Error).message).toBe("connection refused");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("GET /user/two-factor-auth-status", () => {
  test("answers the caller's own status, whatever ids the request carries", async () => {
    const result: Call = await call({ route: TWO_FACTOR_ROUTE });

    expect(result.nextCallCount).toBe(0);
    expect(
      (getTwoFactorAuthSetup.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(CALLER_ID.toString());
    expect(sentJson()).toEqual({
      status: TwoFactorAuthStatus.EnabledConfigured,
      verifiedMethodCount: 2,
    });
  });

  test("says Setup needed's state as it is, not as Enabled", async () => {
    getTwoFactorAuthSetup.mockResolvedValue({
      status: TwoFactorAuthStatus.EnabledPendingSetup,
      verifiedMethodCount: 0,
    });

    await call({ route: TWO_FACTOR_ROUTE });

    expect(sentJson()).toEqual({
      status: TwoFactorAuthStatus.EnabledPendingSetup,
      verifiedMethodCount: 0,
    });
  });

  test("is never kept by a cache", async () => {
    await call({ route: TWO_FACTOR_ROUTE });

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
  });

  test("a request with no session is not authenticated, and nothing is read", async () => {
    const result: Call = await call({
      route: TWO_FACTOR_ROUTE,
      signedIn: false,
    });

    expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(getTwoFactorAuthSetup).not.toHaveBeenCalled();
  });

  test("a failed read is passed on, never answered as Not enabled", async () => {
    getTwoFactorAuthSetup.mockRejectedValue(new Error("pool exhausted"));

    const result: Call = await call({ route: TWO_FACTOR_ROUTE });

    expect((result.thrown as Error).message).toBe("pool exhausted");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
