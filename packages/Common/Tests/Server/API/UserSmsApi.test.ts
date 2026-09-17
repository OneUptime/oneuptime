import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserSmsService from "../../../Server/Services/UserSmsService";
import ChannelVerification from "../../../Server/Utils/ChannelVerification";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { describe, expect, it } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

jest.mock("../../../Server/Services/UserSmsService");

const ITEM_ID: string = "7b1c2d3e-1111-4111-8111-111111111111";

describe("UserSmsAPI", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  beforeEach(() => {
    new UserSmsAPI();
    mockRequest = {} as OneUptimeRequest;
    UserSmsService.updateOneById = jest.fn().mockResolvedValue(1);
    UserSmsService.atomicIncrementColumnValueByOneAndGetValue = jest
      .fn()
      .mockResolvedValue(1);
    UserSmsService.getModel = jest
      .fn()
      .mockReturnValue({ tableName: "UserSMS" });
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /user-sms/verify", () => {
    it("should handle required item ID", async () => {
      const error: BadDataException = new BadDataException("Invalid item ID");
      mockRequest.body = {};
      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
    });

    it("should handle required code", async () => {
      const error: BadDataException = new BadDataException("Invalid code");
      mockRequest.body = {
        itemId: "item1",
      };
      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
    });

    it("should handle Item not found", async () => {
      const error: BadDataException = new BadDataException("Item not found");
      mockRequest.body = {
        itemId: "item1",
        code: 123456,
      };
      /*
       * The route sits behind UserMiddleware, so a session is always present
       * by the time the handler runs — and the handler now refuses outright
       * without one rather than reaching the row lookup.
       */
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;
      UserSmsService.findOneById = jest.fn().mockResolvedValue(null);

      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
    });

    it("should handle Invalid user ID", async () => {
      const error: BadDataException = new BadDataException("Invalid user ID");
      mockRequest.body = {
        itemId: "item1",
        code: "123456",
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      const item: UserSMS = {
        _id: "123",
        userId: new ObjectID("user321"),
      } as UserSMS;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(item);

      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
    });

    /*
     * GHSA-5cr8-vph4-3hrf: the stored column is a keyed digest now, not the
     * code, and it only counts while it is inside its expiry. buildLiveItem
     * produces the state a freshly sent code leaves behind.
     */
    const buildLiveItem: (overrides?: Partial<UserSMS>) => UserSMS = (
      overrides: Partial<UserSMS> = {},
    ) => {
      return {
        _id: ITEM_ID,
        userId: new ObjectID("user123"),
        projectId: new ObjectID("project1"),
        isVerified: false,
        verificationCode: VerificationCode.hashCode({
          code: "123456",
          channelId: new ObjectID(ITEM_ID),
        }),
        verificationCodeExpiresAt: ChannelVerification.getExpiresAt(),
        verificationFailedAttempts: 0,
        ...overrides,
      } as UserSMS;
    };

    it("should handle Invalid code", async () => {
      const error: BadDataException = new BadDataException("Invalid code");
      mockRequest.body = {
        itemId: ITEM_ID,
        code: "123457",
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(buildLiveItem());

      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
    });

    /*
     * The stored value must not be replayable as the code. This is the case
     * that fails if `item.verificationCode === req.body.code` ever comes back.
     */
    it("should reject the stored verification column replayed as a code", async () => {
      const item: UserSMS = buildLiveItem();

      mockRequest.body = {
        itemId: ITEM_ID,
        code: item.verificationCode,
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(item);

      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid code"),
      );
    });

    it("should reject a code that has expired", async () => {
      mockRequest.body = {
        itemId: ITEM_ID,
        code: "123456",
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(
        buildLiveItem({
          verificationCodeExpiresAt: new Date(Date.now() - 1000),
        }),
      );

      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalled();
      expect(UserSmsService.updateOneById).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isVerified: true }),
        }),
      );
    });

    it("should handle valid response on verify", async () => {
      mockRequest.body = {
        itemId: ITEM_ID,
        code: "123456",
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(buildLiveItem());

      await mockRouter
        .match("post", "/user-sms/verify")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendEmptySuccessResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse);
    });
  });

  describe("POST /user-sms/resend-verification-code", () => {
    it("should handle required item ID", async () => {
      const error: BadDataException = new BadDataException("Invalid item ID");
      mockRequest.body = {};
      await mockRouter
        .match("post", "/user-sms/resend-verification-code")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
    });

    it("should handle Item not found", async () => {
      const error: BadDataException = new BadDataException("Item not found");
      mockRequest.body = {
        itemId: "item1",
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(null);
      UserSmsService.resendVerificationCode = jest.fn().mockResolvedValue(null);

      await mockRouter
        .match("post", "/user-sms/resend-verification-code")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
      expect(UserSmsService.resendVerificationCode).not.toHaveBeenCalled();
    });

    /*
     * CVE-2026-30959 regression: the resend route must not send a verification
     * code for an item that belongs to a different user.
     */
    it("should reject an itemId that belongs to another user", async () => {
      const error: BadDataException = new BadDataException("Invalid user ID");
      mockRequest.body = {
        itemId: "item1",
      };
      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      const item: UserSMS = {
        _id: "123",
        userId: new ObjectID("user321"),
      } as UserSMS;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(item);
      UserSmsService.resendVerificationCode = jest.fn().mockResolvedValue(null);

      await mockRouter
        .match("post", "/user-sms/resend-verification-code")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendErrorResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse, error);
      expect(UserSmsService.resendVerificationCode).not.toHaveBeenCalled();
    });

    it("should handle valid response resend", async () => {
      mockRequest.body = {
        itemId: "item1",
      };

      mockRequest.userAuthorization = {
        userId: new ObjectID("user123"),
      } as JSONWebTokenData;

      const item: UserSMS = {
        _id: "123",
        userId: new ObjectID("user123"),
      } as UserSMS;

      UserSmsService.findOneById = jest.fn().mockResolvedValue(item);
      UserSmsService.resendVerificationCode = jest
        .fn()
        .mockImplementation(() => {
          return Promise.resolve();
        });

      await mockRouter
        .match("post", "/user-sms/resend-verification-code")
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(UserSmsService.resendVerificationCode).toHaveBeenCalledWith(
        "item1",
      );

      const response: jest.SpyInstance = jest.spyOn(
        Response,
        "sendEmptySuccessResponse",
      );
      expect(response).toHaveBeenCalledWith(mockRequest, mockResponse);
    });
  });
});
