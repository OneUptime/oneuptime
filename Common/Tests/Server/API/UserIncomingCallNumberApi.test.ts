import UserIncomingCallNumberAPI from "../../../Server/API/UserIncomingCallNumberAPI";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import ChannelVerification from "../../../Server/Utils/ChannelVerification";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { beforeAll, describe, expect, it } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";

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

jest.mock("../../../Server/Services/UserIncomingCallNumberService");

const VERIFY_ROUTE: string = "/user-incoming-call-number/verify";
const RESEND_ROUTE: string =
  "/user-incoming-call-number/resend-verification-code";

const CALLER_USER_ID: string = "5f8d0d55b54764421b7156c1";
const ATTACKER_USER_ID: string = "5f8d0d55b54764421b7156c2";
const ITEM_ID: string = "5f8d0d55b54764421b7156d9";

describe("UserIncomingCallNumberAPI", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    // Registers the routes on the mock router exactly once.
    new UserIncomingCallNumberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {} as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();

    UserIncomingCallNumberService.findOneById = jest
      .fn()
      .mockResolvedValue(null);
    UserIncomingCallNumberService.updateOneById = jest
      .fn()
      .mockResolvedValue(undefined);
    UserIncomingCallNumberService.atomicIncrementColumnValueByOneAndGetValue =
      jest.fn().mockResolvedValue(1);
    UserIncomingCallNumberService.getModel = jest
      .fn()
      .mockReturnValue({ tableName: "UserIncomingCallNumber" });
    UserIncomingCallNumberService.resendVerificationCode = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  type CallRouteFunction = (uri: string) => Promise<void>;

  const callRoute: CallRouteFunction = async (uri: string): Promise<void> => {
    await mockRouter
      .match("post", uri)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  type ItemFunction = (userId?: string) => UserIncomingCallNumber;

  const itemOwnedBy: ItemFunction = (
    userId?: string,
  ): UserIncomingCallNumber => {
    return {
      _id: ITEM_ID,
      id: new ObjectID(ITEM_ID),
      userId: userId ? new ObjectID(userId) : undefined,
    } as UserIncomingCallNumber;
  };

  type AuthenticateFunction = (userId?: string) => void;

  const authenticateAs: AuthenticateFunction = (userId?: string): void => {
    mockRequest.userAuthorization = {
      userId: userId ? new ObjectID(userId) : undefined,
    } as JSONWebTokenData;
  };

  describe("POST /user-incoming-call-number/resend-verification-code", () => {
    /*
     * GHSA-wc96-jm46-37hh — this route used to call resendVerificationCode()
     * with any itemId the caller supplied, without checking that the item
     * belonged to the caller. That let an authenticated user trigger
     * verification-code SMS resends to another user's phone number (SMS spam
     * to the victim, SMS balance drain on the project). It is the same class
     * as CVE-2026-30959, which was fixed on the sibling channels only.
     */
    describe("ownership enforcement (GHSA-wc96-jm46-37hh regression)", () => {
      it("should reject an itemId that belongs to another user", async () => {
        mockRequest.body = { itemId: ITEM_ID };
        authenticateAs(ATTACKER_USER_ID);
        UserIncomingCallNumberService.findOneById = jest
          .fn()
          .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

        await callRoute(RESEND_ROUTE);

        expect(Response.sendErrorResponse).toHaveBeenCalledWith(
          mockRequest,
          mockResponse,
          new BadDataException("Invalid user ID"),
        );
      });

      it("should not send an SMS when the item belongs to another user", async () => {
        mockRequest.body = { itemId: ITEM_ID };
        authenticateAs(ATTACKER_USER_ID);
        UserIncomingCallNumberService.findOneById = jest
          .fn()
          .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

        await callRoute(RESEND_ROUTE);

        expect(
          UserIncomingCallNumberService.resendVerificationCode,
        ).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
      });

      it("should reject when the request carries no user authorization", async () => {
        mockRequest.body = { itemId: ITEM_ID };
        UserIncomingCallNumberService.findOneById = jest
          .fn()
          .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

        await callRoute(RESEND_ROUTE);

        expect(Response.sendErrorResponse).toHaveBeenCalledWith(
          mockRequest,
          mockResponse,
          new BadDataException("Invalid user ID"),
        );
        expect(
          UserIncomingCallNumberService.resendVerificationCode,
        ).not.toHaveBeenCalled();
      });

      it("should reject when the authorized user has no user ID", async () => {
        mockRequest.body = { itemId: ITEM_ID };
        authenticateAs(undefined);
        UserIncomingCallNumberService.findOneById = jest
          .fn()
          .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

        await callRoute(RESEND_ROUTE);

        expect(Response.sendErrorResponse).toHaveBeenCalledWith(
          mockRequest,
          mockResponse,
          new BadDataException("Invalid user ID"),
        );
        expect(
          UserIncomingCallNumberService.resendVerificationCode,
        ).not.toHaveBeenCalled();
      });

      it("should look the item up by ID before resending", async () => {
        mockRequest.body = { itemId: ITEM_ID };
        authenticateAs(CALLER_USER_ID);
        UserIncomingCallNumberService.findOneById = jest
          .fn()
          .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

        await callRoute(RESEND_ROUTE);

        expect(UserIncomingCallNumberService.findOneById).toHaveBeenCalledWith({
          id: ITEM_ID,
          props: { isRoot: true },
          select: { userId: true },
        });
      });

      it("should compare owner IDs by value, not by object identity", async () => {
        mockRequest.body = { itemId: ITEM_ID };
        authenticateAs(CALLER_USER_ID);

        // Distinct ObjectID instances that hold the same value.
        UserIncomingCallNumberService.findOneById = jest
          .fn()
          .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

        await callRoute(RESEND_ROUTE);

        expect(
          UserIncomingCallNumberService.resendVerificationCode,
        ).toHaveBeenCalledTimes(1);
        expect(Response.sendErrorResponse).not.toHaveBeenCalled();
      });
    });

    it("should handle required item ID", async () => {
      mockRequest.body = {};

      await callRoute(RESEND_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid item ID"),
      );
      expect(
        UserIncomingCallNumberService.resendVerificationCode,
      ).not.toHaveBeenCalled();
    });

    it("should not look up an item when the item ID is missing", async () => {
      mockRequest.body = {};
      authenticateAs(CALLER_USER_ID);

      await callRoute(RESEND_ROUTE);

      expect(UserIncomingCallNumberService.findOneById).not.toHaveBeenCalled();
    });

    it("should handle item not found", async () => {
      mockRequest.body = { itemId: ITEM_ID };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(null);

      await callRoute(RESEND_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Item not found"),
      );
      expect(
        UserIncomingCallNumberService.resendVerificationCode,
      ).not.toHaveBeenCalled();
    });

    it("should resend the verification code for the caller's own item", async () => {
      mockRequest.body = { itemId: ITEM_ID };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));

      await callRoute(RESEND_ROUTE);

      expect(
        UserIncomingCallNumberService.resendVerificationCode,
      ).toHaveBeenCalledWith(ITEM_ID);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });

    it("should forward service errors to the error handler", async () => {
      const error: Error = new Error("Phone Number already verified");
      mockRequest.body = { itemId: ITEM_ID };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(itemOwnedBy(CALLER_USER_ID));
      UserIncomingCallNumberService.resendVerificationCode = jest
        .fn()
        .mockRejectedValue(error);

      await callRoute(RESEND_ROUTE);

      expect(nextFunction).toHaveBeenCalledWith(error);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("should forward lookup errors to the error handler", async () => {
      const error: Error = new Error("db down");
      mockRequest.body = { itemId: ITEM_ID };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockRejectedValue(error);

      await callRoute(RESEND_ROUTE);

      expect(nextFunction).toHaveBeenCalledWith(error);
      expect(
        UserIncomingCallNumberService.resendVerificationCode,
      ).not.toHaveBeenCalled();
    });

    it("should be guarded by the user authorization middleware", () => {
      expect(mockRouter.match("post", RESEND_ROUTE).middleware).toBeDefined();
    });
  });

  describe("POST /user-incoming-call-number/verify", () => {
    it("should handle required item ID", async () => {
      mockRequest.body = {};

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid item ID"),
      );
    });

    it("should handle required code", async () => {
      mockRequest.body = { itemId: ITEM_ID };

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid code"),
      );
    });

    it("should handle item not found", async () => {
      mockRequest.body = { itemId: ITEM_ID, code: "123456" };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(null);

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Item not found"),
      );
    });

    /*
     * GHSA-5cr8-vph4-3hrf: the row no longer stores the code. It stores a
     * keyed digest that is only accepted while its expiry is in the future,
     * so a live row has to be built rather than hand-written.
     */
    const liveItemOwnedBy: (
      userId: string,
      overrides?: Partial<UserIncomingCallNumber>,
    ) => UserIncomingCallNumber = (
      userId: string,
      overrides: Partial<UserIncomingCallNumber> = {},
    ) => {
      return {
        ...itemOwnedBy(userId),
        projectId: new ObjectID("5f8d0d55b54764421b7156e0"),
        isVerified: false,
        verificationCode: VerificationCode.hashCode({
          code: "123456",
          channelId: new ObjectID(ITEM_ID),
        }),
        verificationCodeExpiresAt: ChannelVerification.getExpiresAt(),
        verificationFailedAttempts: 0,
        ...overrides,
      } as UserIncomingCallNumber;
    };

    it("should reject verifying an item that belongs to another user", async () => {
      mockRequest.body = { itemId: ITEM_ID, code: "123456" };
      authenticateAs(ATTACKER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(liveItemOwnedBy(CALLER_USER_ID));

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid user ID"),
      );
      expect(
        UserIncomingCallNumberService.updateOneById,
      ).not.toHaveBeenCalled();
    });

    it("should reject an incorrect verification code", async () => {
      mockRequest.body = { itemId: ITEM_ID, code: "654321" };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(liveItemOwnedBy(CALLER_USER_ID));

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid code"),
      );
      expect(
        UserIncomingCallNumberService.updateOneById,
      ).not.toHaveBeenCalled();
    });

    /* The case that fails if the plaintext comparison ever comes back. */
    it("should reject the stored verification column replayed as a code", async () => {
      const item: UserIncomingCallNumber = liveItemOwnedBy(CALLER_USER_ID);

      mockRequest.body = { itemId: ITEM_ID, code: item.verificationCode };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(item);

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid code"),
      );
    });

    it("should reject a code whose expiry has passed", async () => {
      mockRequest.body = { itemId: ITEM_ID, code: "123456" };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest.fn().mockResolvedValue(
        liveItemOwnedBy(CALLER_USER_ID, {
          verificationCodeExpiresAt: new Date(Date.now() - 1000),
        }),
      );

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalled();
      expect(
        UserIncomingCallNumberService.updateOneById,
      ).not.toHaveBeenCalled();
    });

    it("should reject once the attempt budget for the code is spent", async () => {
      mockRequest.body = { itemId: ITEM_ID, code: "123456" };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest.fn().mockResolvedValue(
        liveItemOwnedBy(CALLER_USER_ID, {
          verificationFailedAttempts: 5,
        }),
      );

      await callRoute(VERIFY_ROUTE);

      expect(Response.sendErrorResponse).toHaveBeenCalled();
      expect(
        UserIncomingCallNumberService.updateOneById,
      ).not.toHaveBeenCalled();
    });

    it("should mark the number verified on a correct code", async () => {
      mockRequest.body = { itemId: ITEM_ID, code: "123456" };
      authenticateAs(CALLER_USER_ID);
      UserIncomingCallNumberService.findOneById = jest
        .fn()
        .mockResolvedValue(liveItemOwnedBy(CALLER_USER_ID));

      await callRoute(VERIFY_ROUTE);

      /* Verified AND the used code cleared, in the same write. */
      expect(UserIncomingCallNumberService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: new ObjectID(ITEM_ID),
          props: { isRoot: true },
          data: expect.objectContaining({
            isVerified: true,
            verificationFailedAttempts: 0,
            verificationCodeExpiresAt: null,
          }),
        }),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });

    it("should be guarded by the user authorization middleware", () => {
      expect(mockRouter.match("post", VERIFY_ROUTE).middleware).toBeDefined();
    });
  });
});
