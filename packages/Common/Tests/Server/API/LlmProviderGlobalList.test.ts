import { mockRouter } from "./Helpers";
import LlmProviderAPI from "../../../Server/API/LlmProviderAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * THE SHARED GLOBAL PROVIDERS ARE LISTED TO SIGNED-IN MEMBERS, BY NAME,
 * DESCRIPTION AND PRICE ONLY.
 *
 * Settings → AI shows the global providers a project falls back to. The
 * LLM provider table is read by a project's own members only, so this route
 * reads the global ones as OneUptime - and therefore answers only someone
 * signed in, with only the three things the page shows: never a provider's
 * address, model, parameters or key.
 */

const GLOBAL_LLMS_ROUTE: string = "/llm-provider/global-llms";

describe("POST /llm-provider/global-llms", () => {
  let findBy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new LlmProviderAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    const provider: LlmProvider = new LlmProvider();
    provider.name = "Shared";
    provider.description = "The provider every project falls back to.";
    provider.costPerMillionTokensInUSDCents = 120;

    findBy = jest
      .spyOn(LlmProviderService, "findBy")
      .mockResolvedValue([provider] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks who the caller is, and that they are signed in, before it answers", () => {
    const middlewares: Array<unknown> = mockRouter.match(
      "post",
      GLOBAL_LLMS_ROUTE,
    ).middlewares;

    expect(middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("a caller who is not signed in is asked to sign in, and nothing is read", async () => {
    const request: OneUptimeRequest = {
      userType: UserType.Public,
      headers: {},
    } as unknown as OneUptimeRequest;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await UserMiddleware.requireUserAuthentication(
      request as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(
      (Response.sendErrorResponse as unknown as jest.Mock).mock.calls[0]![2],
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a signed-in caller is let through to the list", async () => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await UserMiddleware.requireUserAuthentication(
      { userType: UserType.User, headers: {} } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  test("reads only the global providers, and only their name, description and price", async () => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("post", GLOBAL_LLMS_ROUTE)
      .handlerFunction(
        { body: {}, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        next,
      );

    expect(next).not.toHaveBeenCalled();
    expect(findBy).toHaveBeenCalledTimes(1);

    const read: { query: JSONObject; select: JSONObject } = findBy.mock
      .calls[0]![0] as { query: JSONObject; select: JSONObject };

    expect(read.query).toEqual({ isGlobalLlm: true });
    expect(read.select).toEqual({
      name: true,
      description: true,
      costPerMillionTokensInUSDCents: true,
    });
    expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);
  });
});
