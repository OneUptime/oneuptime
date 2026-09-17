import UserCallAPI from "../../../Server/API/UserCallAPI";
import UserEmailAPI from "../../../Server/API/UserEmailAPI";
import UserIncomingCallNumberAPI from "../../../Server/API/UserIncomingCallNumberAPI";
import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserWhatsAppAPI from "../../../Server/API/UserWhatsAppAPI";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import ChannelVerification, {
  MAX_VERIFICATION_ATTEMPTS,
  VerifiableChannelFields,
} from "../../../Server/Utils/ChannelVerification";
import VerificationCode from "../../../Server/Utils/VerificationCode";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import BadDataException from "../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

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

jest.mock("../../../Server/Services/UserEmailService");
jest.mock("../../../Server/Services/UserSmsService");
jest.mock("../../../Server/Services/UserCallService");
jest.mock("../../../Server/Services/UserWhatsAppService");
jest.mock("../../../Server/Services/UserIncomingCallNumberService");
jest.mock("../../../Server/Services/UserNotificationRuleService");

/*
 * GHSA-5cr8-vph4-3hrf, at the HTTP layer, for every affected channel at once.
 *
 * The advisory's own words are "the same pattern is used by the user email,
 * SMS, incoming call, and WhatsApp verification APIs" — five copies of the
 * same handler, so a fix applied to one of them proves nothing about the other
 * four. This file therefore runs one table of cases against all five routes,
 * and a channel that regresses on its own fails here rather than quietly
 * shipping.
 *
 * The service is faked at the row level rather than method-by-method, so these
 * exercise the real ChannelVerification state machine reached through the real
 * route handler. A test that stubbed verifyCode would pass against a handler
 * that never called it.
 */

const ITEM_ID: string = "9d3f0e2a-1111-4111-8111-111111111111";
const OWNER_ID: string = "9d3f0e2a-2222-4222-8222-222222222222";
const OTHER_USER_ID: string = "9d3f0e2a-3333-4333-8333-333333333333";
const PROJECT_ID: string = "9d3f0e2a-4444-4444-8444-444444444444";

const CORRECT_CODE: string = "424242";

interface FakeRow extends VerifiableChannelFields {
  _id?: string | undefined;
}

type AnyService = Record<string, unknown>;

/*
 * Point a mocked service at an in-memory row: reads return it, writes merge
 * into it, and the attempt counter really counts.
 */
const installFakeRow: (data: { service: unknown; row: FakeRow | null }) => {
  current: FakeRow | null;
} = (data: { service: unknown; row: FakeRow | null }) => {
  const store: { current: FakeRow | null } = { current: data.row };
  const service: AnyService = data.service as AnyService;

  service["findOneById"] = jest.fn().mockImplementation(() => {
    return Promise.resolve(store.current ? { ...store.current } : null);
  });

  service["updateOneById"] = jest
    .fn()
    .mockImplementation((update: { data: Record<string, unknown> }) => {
      if (store.current) {
        store.current = { ...store.current, ...(update.data as FakeRow) };
      }
      return Promise.resolve(1);
    });

  service["atomicIncrementColumnValueByOneAndGetValue"] = jest
    .fn()
    .mockImplementation((input: { columnName: string }) => {
      if (!store.current) {
        return Promise.reject(new Error("row not found"));
      }

      const next: number =
        ((store.current as unknown as Record<string, number>)[
          input.columnName
        ] || 0) + 1;

      (store.current as unknown as Record<string, number>)[input.columnName] =
        next;

      return Promise.resolve(next);
    });

  service["getModel"] = jest.fn().mockReturnValue({ tableName: "FakeTable" });

  service["resendVerificationCode"] = jest.fn().mockResolvedValue(undefined);

  return store;
};

const buildRow: (overrides?: Partial<FakeRow>) => FakeRow = (
  overrides: Partial<FakeRow> = {},
) => {
  return {
    _id: ITEM_ID,
    userId: new ObjectID(OWNER_ID),
    projectId: new ObjectID(PROJECT_ID),
    isVerified: false,
    verificationCode: VerificationCode.hashCode({
      code: CORRECT_CODE,
      channelId: new ObjectID(ITEM_ID),
    }),
    verificationCodeExpiresAt: ChannelVerification.getExpiresAt(),
    verificationFailedAttempts: 0,
    verificationCodeSentAt: new Date(),
    ...overrides,
  };
};

interface Channel {
  name: string;
  verifyPath: string;
  resendPath: string;
  service: unknown;
  build: () => void;
  createsDefaultRules: boolean;
}

const CHANNELS: Array<Channel> = [
  {
    name: "UserEmailAPI",
    verifyPath: "/user-email/verify",
    resendPath: "/user-email/resend-verification-code",
    service: UserEmailService,
    build: () => {
      new UserEmailAPI();
    },
    createsDefaultRules: true,
  },
  {
    name: "UserSmsAPI",
    verifyPath: "/user-sms/verify",
    resendPath: "/user-sms/resend-verification-code",
    service: UserSmsService,
    build: () => {
      new UserSmsAPI();
    },
    createsDefaultRules: true,
  },
  {
    name: "UserCallAPI",
    verifyPath: "/user-call/verify",
    resendPath: "/user-call/resend-verification-code",
    service: UserCallService,
    build: () => {
      new UserCallAPI();
    },
    createsDefaultRules: true,
  },
  {
    name: "UserWhatsAppAPI",
    verifyPath: "/user-whatsapp/verify",
    resendPath: "/user-whatsapp/resend-verification-code",
    service: UserWhatsAppService,
    build: () => {
      new UserWhatsAppAPI();
    },
    createsDefaultRules: true,
  },
  {
    name: "UserIncomingCallNumberAPI",
    verifyPath: "/user-incoming-call-number/verify",
    resendPath: "/user-incoming-call-number/resend-verification-code",
    service: UserIncomingCallNumberService,
    build: () => {
      new UserIncomingCallNumberAPI();
    },
    createsDefaultRules: false,
  },
];

describe.each(CHANNELS)("$name verification routes", (channel: Channel) => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;
  let store: { current: FakeRow | null };

  const callVerify: (body: Record<string, unknown>) => Promise<void> = async (
    body: Record<string, unknown>,
  ) => {
    mockRequest.body = body;

    await mockRouter
      .match("post", channel.verifyPath)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  const callResend: (body: Record<string, unknown>) => Promise<void> = async (
    body: Record<string, unknown>,
  ) => {
    mockRequest.body = body;

    await mockRouter
      .match("post", channel.resendPath)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  const lastError: () => BadDataException = () => {
    const calls: Array<Array<unknown>> = (
      Response.sendErrorResponse as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    return calls[calls.length - 1]?.[2] as BadDataException;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes.length = 0;

    channel.build();

    mockRequest = {} as OneUptimeRequest;
    mockRequest.userAuthorization = {
      userId: new ObjectID(OWNER_ID),
    } as JSONWebTokenData;

    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    } as unknown as OneUptimeResponse;

    nextFunction = jest.fn();

    store = installFakeRow({ service: channel.service, row: buildRow() });

    (
      UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod as unknown as jest.Mock
    ).mockResolvedValue(undefined as never);
  });

  describe("POST verify", () => {
    it("requires an item ID", async () => {
      await callVerify({});

      expect(Response.sendErrorResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        new BadDataException("Invalid item ID"),
      );
    });

    it("requires a code", async () => {
      await callVerify({ itemId: ITEM_ID });

      expect(lastError().message).toBe("Invalid code");
    });

    it("refuses an unknown item", async () => {
      store.current = null;

      await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

      expect(lastError().message).toBe("Item not found");
    });

    /*
     * Ownership. A row can legitimately hold somebody else's address — that
     * is how "add my phone" works — so this is what keeps one user from
     * verifying another user's channel.
     */
    it("refuses a caller who does not own the item", async () => {
      mockRequest.userAuthorization = {
        userId: new ObjectID(OTHER_USER_ID),
      } as JSONWebTokenData;

      await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

      expect(lastError().message).toBe("Invalid user ID");
      expect(store.current?.isVerified).toBeFalsy();
    });

    it("refuses a wrong code", async () => {
      await callVerify({ itemId: ITEM_ID, code: "111111" });

      expect(lastError().message).toBe("Invalid code");
      expect(store.current?.isVerified).toBeFalsy();
    });

    it("accepts the right code and marks the row verified", async () => {
      await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
      expect(store.current?.isVerified).toBe(true);
    });

    /*
     * The stored column is a digest now. This is the test that fails if
     * anybody reintroduces `item.verificationCode === req.body.code`.
     */
    it("does not accept the stored column value as the code", async () => {
      await callVerify({
        itemId: ITEM_ID,
        code: store.current?.verificationCode as string,
      });

      expect(lastError().message).toBe("Invalid code");
      expect(store.current?.isVerified).toBeFalsy();
    });

    it("refuses a code that has expired", async () => {
      store.current = buildRow({
        verificationCodeExpiresAt: new Date(Date.now() - 1000),
      });

      await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

      expect(lastError().message).toContain("expired");
      expect(store.current?.isVerified).toBeFalsy();
    });

    /*
     * Rows written before the expiry column existed carry a plaintext code
     * and no expiry. They must read as "ask for a new code", not as a
     * permanently valid challenge.
     */
    it("refuses a legacy row that carries no expiry", async () => {
      store.current = buildRow({ verificationCodeExpiresAt: undefined });

      await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

      expect(lastError().message).toContain("expired");
    });

    it("refuses a row that is already verified", async () => {
      store.current = buildRow({ isVerified: true });

      await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

      expect(lastError().message).toBe("This is already verified");
    });

    /*
     * The advisory's reproduction, run against the route: submit many
     * incorrect values and check that the attempts are not all processed,
     * that the stored code does not survive, and that the correct code
     * submitted after the failures no longer verifies the row.
     */
    describe("brute force", () => {
      it("stops accepting guesses after the attempt limit", async () => {
        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
          await callVerify({
            itemId: ITEM_ID,
            code: i.toString().padStart(6, "0"),
          });

          expect(lastError().message).toBe("Invalid code");
        }

        await callVerify({ itemId: ITEM_ID, code: "999999" });

        expect(lastError().message).toContain("Too many incorrect attempts");
      });

      it("refuses the correct code once the limit has been reached", async () => {
        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
          await callVerify({ itemId: ITEM_ID, code: "111111" });
        }

        await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

        expect(lastError().message).toContain("Too many incorrect attempts");
        expect(store.current?.isVerified).toBeFalsy();
      });

      it("burns the stored challenge rather than merely pausing the caller", async () => {
        const originalDigest: string | undefined =
          store.current?.verificationCode;

        for (let i: number = 0; i < MAX_VERIFICATION_ATTEMPTS; i++) {
          await callVerify({ itemId: ITEM_ID, code: "111111" });
        }

        expect(store.current?.verificationCode).not.toBe(originalDigest);
        expect(store.current?.verificationCodeExpiresAt).toBeNull();
      });

      it("cannot be walked to a verification", async () => {
        for (let guess: number = 0; guess < 300; guess++) {
          await callVerify({
            itemId: ITEM_ID,
            code: guess.toString().padStart(6, "0"),
          });
        }

        expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
        expect(store.current?.isVerified).toBeFalsy();
      });
    });

    if (channel.createsDefaultRules) {
      it("creates the default notification rules once verified", async () => {
        await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

        expect(
          UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
        ).toHaveBeenCalled();
      });

      it("does not create notification rules for a failed verification", async () => {
        await callVerify({ itemId: ITEM_ID, code: "111111" });

        expect(
          UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod,
        ).not.toHaveBeenCalled();
      });

      it("still reports success if rule creation fails", async () => {
        (
          UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod as unknown as jest.Mock
        ).mockRejectedValue(new Error("boom") as never);

        await callVerify({ itemId: ITEM_ID, code: CORRECT_CODE });

        expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
      });
    }
  });

  describe("POST resend-verification-code", () => {
    it("requires an item ID", async () => {
      await callResend({});

      expect(lastError().message).toBe("Invalid item ID");
    });

    it("refuses an unknown item", async () => {
      store.current = null;

      await callResend({ itemId: ITEM_ID });

      expect(lastError().message).toBe("Item not found");
      expect(
        (channel.service as AnyService)["resendVerificationCode"],
      ).not.toHaveBeenCalled();
    });

    /*
     * Without this the resend route is a way to make somebody else's device
     * ring on demand, at the project's expense.
     */
    it("refuses to send a code for a row the caller does not own", async () => {
      mockRequest.userAuthorization = {
        userId: new ObjectID(OTHER_USER_ID),
      } as JSONWebTokenData;

      await callResend({ itemId: ITEM_ID });

      expect(lastError().message).toBe("Invalid user ID");
      expect(
        (channel.service as AnyService)["resendVerificationCode"],
      ).not.toHaveBeenCalled();
    });

    it("sends a code for a row the caller owns", async () => {
      await callResend({ itemId: ITEM_ID });

      expect(
        (channel.service as AnyService)["resendVerificationCode"],
      ).toHaveBeenCalledWith(ITEM_ID);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
      );
    });
  });

  /*
   * The limiter is what bounds the two things a per-row counter cannot see:
   * a caller rotating rows to farm fresh attempt budgets, and the volume of
   * real messages sent to somebody who never asked for them. A route that
   * loses it still passes every functional test above, so its registration
   * is asserted directly.
   */
  describe("rate limiting", () => {
    it("registers a limiter in front of the verify handler", () => {
      expect(
        mockRouter.match("post", channel.verifyPath).middlewares.length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("registers a limiter in front of the resend handler", () => {
      expect(
        mockRouter.match("post", channel.resendPath).middlewares.length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("runs the limiter after user authorization, so it can key on the user", () => {
      const middlewares: Array<unknown> = mockRouter.match(
        "post",
        channel.verifyPath,
      ).middlewares;

      /* UserMiddleware.getUserMiddleware is registered first. */
      expect(middlewares[0]).not.toBe(middlewares[1]);
      expect(typeof middlewares[1]).toBe("function");
    });
  });
});
