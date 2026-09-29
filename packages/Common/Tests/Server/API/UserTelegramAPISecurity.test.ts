import UserTelegramAPI from "../../../Server/API/UserTelegramAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import VerificationCodeRateLimit from "../../../Server/Middleware/VerificationCodeRateLimit";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
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
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const VERIFICATION_INFO_ROUTE: string = "/user-telegram/verification-info";
const RESEND_ROUTE: string = "/user-telegram/resend-verification-code";
const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ITEM_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

function item(data: Partial<UserTelegram> = {}): UserTelegram {
  const result: UserTelegram = new UserTelegram();
  result.id = ITEM_ID;
  result.userId = USER_ID;
  result.projectId = PROJECT_ID;
  result.isVerified = false;
  Object.assign(result, data);
  return result;
}

describe("UserTelegramAPI security", () => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserTelegramAPI();
  });

  beforeEach(() => {
    request = {
      body: { itemId: ITEM_ID.toString() },
      userAuthorization: { userId: USER_ID } as JSONWebTokenData,
    } as OneUptimeRequest;
    response = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    next = jest.fn() as unknown as NextFunction;

    jest
      .spyOn(UserTelegramService, "findOneById")
      .mockResolvedValue(item() as never);
    jest
      .spyOn(UserTelegramService, "hasActiveProjectMembership")
      .mockResolvedValue(true);
    jest
      .spyOn(UserTelegramService, "getVerificationCode")
      .mockResolvedValue("strong-token");
    jest
      .spyOn(UserTelegramService, "regenerateVerificationCode")
      .mockResolvedValue("rotated-token");
    jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue({
      telegramBotUsername: "oneuptime_bot",
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  async function call(route: string): Promise<void> {
    await mockRouter
      .match("post", route)
      .handlerFunction(request, response, next);
  }

  test("both owner routes require an authenticated user", () => {
    expect(
      mockRouter.match("post", VERIFICATION_INFO_ROUTE).middlewares,
    ).toContain(UserMiddleware.requireUserAuthentication);
    expect(mockRouter.match("post", RESEND_ROUTE).middlewares).toContain(
      UserMiddleware.requireUserAuthentication,
    );
  });

  test("resend remains behind the shared verification rate limiter", () => {
    expect(mockRouter.match("post", RESEND_ROUTE).middlewares).toHaveLength(3);
    expect(mockRouter.match("post", RESEND_ROUTE).middlewares[2]).toBeDefined();
    expect(typeof VerificationCodeRateLimit.getMiddleware).toBe("function");
  });

  test("verification info refuses an owned row after project membership is removed", async () => {
    jest
      .spyOn(UserTelegramService, "hasActiveProjectMembership")
      .mockResolvedValue(false);

    await call(VERIFICATION_INFO_ROUTE);

    expect(UserTelegramService.hasActiveProjectMembership).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
      },
    );
    expect(UserTelegramService.getVerificationCode).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledWith(
      request,
      response,
      expect.objectContaining({ message: "Item not found" }),
    );
  });

  test("resend refuses an owned row after project membership is removed", async () => {
    jest
      .spyOn(UserTelegramService, "hasActiveProjectMembership")
      .mockResolvedValue(false);

    await call(RESEND_ROUTE);

    expect(
      UserTelegramService.regenerateVerificationCode,
    ).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledWith(
      request,
      response,
      expect.objectContaining({ message: "Item not found" }),
    );
  });

  test("uses the row project when the same user belongs to multiple projects", async () => {
    jest
      .spyOn(UserTelegramService, "findOneById")
      .mockResolvedValue(item({ projectId: OTHER_PROJECT_ID }) as never);

    await call(VERIFICATION_INFO_ROUTE);

    expect(UserTelegramService.hasActiveProjectMembership).toHaveBeenCalledWith(
      {
        projectId: OTHER_PROJECT_ID,
        userId: USER_ID,
      },
    );
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      expect.objectContaining({
        verificationCode: "strong-token",
        telegramBotUsername: "oneuptime_bot",
      }),
    );
  });

  test("does not let another authenticated user probe membership or rotate the token", async () => {
    request.userAuthorization = {
      userId: OTHER_USER_ID,
    } as JSONWebTokenData;

    await call(RESEND_ROUTE);

    expect(
      UserTelegramService.hasActiveProjectMembership,
    ).not.toHaveBeenCalled();
    expect(
      UserTelegramService.regenerateVerificationCode,
    ).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledWith(
      request,
      response,
      expect.objectContaining({ message: "Invalid user ID" }),
    );
  });

  test("rotates only after ownership and exact project membership both pass", async () => {
    await call(RESEND_ROUTE);

    expect(UserTelegramService.hasActiveProjectMembership).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
      },
    );
    expect(UserTelegramService.regenerateVerificationCode).toHaveBeenCalledWith(
      ITEM_ID.toString(),
    );
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      request,
      response,
    );
  });
});
