import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * How this server signs people in, for its sign-in pages
 * (FeatureSet/Identity/API/SignInMethods.ts):
 *
 *   GET /sign-in-methods                      whether the server requires SSO,
 *                                             and its providers
 *   GET /project-sign-in-methods/:projectId   the providers of one project
 *
 * Both are asked before anyone is signed in. They say what the pages draw -
 * a provider's kind, id, name and description - and nothing more, whatever
 * the reader hands them; a failure goes to Express's error handler, never a
 * made-up answer; and neither is kept by the browser or a proxy, so turning
 * the requirement or a provider on or off shows on the next visit.
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
  };
});

const getSignInMethods: jest.Mock = jest.fn();
const getProjectSignInMethods: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/SsoSignInMethods", () => {
  return {
    __esModule: true,
    default: {
      getSignInMethods: (...args: Array<unknown>): unknown => {
        return getSignInMethods(...args);
      },
      getProjectSignInMethods: (...args: Array<unknown>): unknown => {
        return getProjectSignInMethods(...args);
      },
    },
  };
});

const sendJsonObjectResponse: jest.Mock = jest.fn();
const setNoCacheHeaders: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
      setNoCacheHeaders: (...args: Array<unknown>): unknown => {
        return setNoCacheHeaders(...args);
      },
    },
  };
});

import "../../../FeatureSet/Identity/API/SignInMethods";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const PROVIDER_ID: string = "22222222-2222-4222-8222-222222222222";

// A provider as the reader might hand it over, with more than the page draws.
const READ_PROVIDER: Record<string, unknown> = {
  type: SsoProviderType.GlobalSSO,
  id: PROVIDER_ID,
  name: "Okta",
  description: "Sign in with Okta",
  signOnURL: "https://idp.example.com/sso",
  publicCertificate: "-----BEGIN CERTIFICATE-----",
};

const DRAWN_PROVIDER: JSONObject = {
  type: SsoProviderType.GlobalSSO,
  id: PROVIDER_ID,
  name: "Okta",
  description: "Sign in with Okta",
};

type CallResult = {
  nextError: Error | null;
  res: ExpressResponse;
};

const call: (
  uri: string,
  params?: Record<string, string>,
) => Promise<CallResult> = async (
  uri: string,
  params?: Record<string, string>,
): Promise<CallResult> => {
  const handler: RouteHandler = mockRouter.match("get", uri);
  const req: ExpressRequest = buildRequest(undefined);
  (req as unknown as { params: Record<string, string> }).params = params || {};
  const res: ExpressResponse = buildResponse();

  let nextError: Error | null = null;

  await handler(req, res, ((err?: Error): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction);

  return { nextError, res };
};

const sentBody: () => JSONObject = (): JSONObject => {
  return sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the routes", () => {
  it("are the two GETs the sign-in pages read, and nothing else", () => {
    expect(
      mockRouter.routes.map((route: { method: string; uri: string }) => {
        return `${route.method} ${route.uri}`;
      }),
    ).toEqual([
      "GET /sign-in-methods",
      "GET /project-sign-in-methods/:projectId",
    ]);
  });
});

describe("GET /sign-in-methods", () => {
  it("answers whether SSO is required, the providers, and whether a project has its own", async () => {
    getSignInMethods.mockResolvedValue({
      isSsoRequired: true,
      ssoProviders: [READ_PROVIDER],
      hasProjectSsoProviders: true,
    });

    const result: CallResult = await call("/sign-in-methods");

    expect(result.nextError).toBeNull();
    expect(sentBody()).toEqual({
      isSsoRequired: true,
      ssoProviders: [DRAWN_PROVIDER],
      hasProjectSsoProviders: true,
    });
  });

  it("is never kept by the browser or a proxy", async () => {
    getSignInMethods.mockResolvedValue({
      isSsoRequired: false,
      ssoProviders: [],
      hasProjectSsoProviders: false,
    });

    const result: CallResult = await call("/sign-in-methods");

    expect(setNoCacheHeaders).toHaveBeenCalledWith(result.res);
  });

  it("hands a failed read to the error handler, and answers nothing of its own", async () => {
    const failure: Error = new Error("connection terminated");
    getSignInMethods.mockRejectedValue(failure);

    const result: CallResult = await call("/sign-in-methods");

    expect(result.nextError).toBe(failure);
    expect(sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("GET /project-sign-in-methods/:projectId", () => {
  it("answers the project's providers, as the page draws them", async () => {
    getProjectSignInMethods.mockResolvedValue({
      ssoProviders: [READ_PROVIDER],
    });

    const result: CallResult = await call(
      "/project-sign-in-methods/:projectId",
      { projectId: PROJECT_ID },
    );

    expect(result.nextError).toBeNull();
    expect(
      (getProjectSignInMethods.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(PROJECT_ID);
    expect(sentBody()).toEqual({ ssoProviders: [DRAWN_PROVIDER] });
    expect(setNoCacheHeaders).toHaveBeenCalledWith(result.res);
  });

  it.each(["project-1", "", "../../admin", `${PROJECT_ID}x`])(
    "refuses %j as a project id before reading anything",
    async (projectId: string) => {
      const result: CallResult = await call(
        "/project-sign-in-methods/:projectId",
        { projectId },
      );

      expect(result.nextError).toBeInstanceOf(BadRequestException);
      expect(getProjectSignInMethods).not.toHaveBeenCalled();
      expect(sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  it("hands a project that does not exist, or a failed read, to the error handler", async () => {
    const failure: Error = new Error("Project not found");
    getProjectSignInMethods.mockRejectedValue(failure);

    const result: CallResult = await call(
      "/project-sign-in-methods/:projectId",
      { projectId: PROJECT_ID },
    );

    expect(result.nextError).toBe(failure);
    expect(sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
