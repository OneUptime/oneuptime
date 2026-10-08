import UserCallAPI from "../../../Server/API/UserCallAPI";
import UserEmailAPI from "../../../Server/API/UserEmailAPI";
import UserIncomingCallNumberAPI from "../../../Server/API/UserIncomingCallNumberAPI";
import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserWhatsAppAPI from "../../../Server/API/UserWhatsAppAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import ChannelVerification, {
  ChannelVerificationStatus,
  VerifiableChannelFields,
} from "../../../Server/Utils/ChannelVerification";
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
 * POST <channel>/verification-status - what the verify dialog asks when it
 * opens, instead of announcing that a code was sent. Every channel with a
 * code registers it through ChannelVerificationStatusRoute, so this runs the
 * same cases against all five and a channel that loses the route, or answers
 * somebody else, fails here.
 */

const ITEM_ID: string = "a1b2c3d4-1111-4111-8111-111111111111";
const OWNER_ID: string = "a1b2c3d4-2222-4222-8222-222222222222";
const OTHER_USER_ID: string = "a1b2c3d4-3333-4333-8333-333333333333";
const PROJECT_ID: string = "a1b2c3d4-4444-4444-8444-444444444444";

interface FakeRow extends VerifiableChannelFields {
  _id?: string | undefined;
}

interface Channel {
  name: string;
  statusPath: string;
  service: unknown;
  build: () => void;
}

const CHANNELS: Array<Channel> = [
  {
    name: "UserEmailAPI",
    statusPath: "/user-email/verification-status",
    service: UserEmailService,
    build: () => {
      new UserEmailAPI();
    },
  },
  {
    name: "UserSmsAPI",
    statusPath: "/user-sms/verification-status",
    service: UserSmsService,
    build: () => {
      new UserSmsAPI();
    },
  },
  {
    name: "UserCallAPI",
    statusPath: "/user-call/verification-status",
    service: UserCallService,
    build: () => {
      new UserCallAPI();
    },
  },
  {
    name: "UserWhatsAppAPI",
    statusPath: "/user-whatsapp/verification-status",
    service: UserWhatsAppService,
    build: () => {
      new UserWhatsAppAPI();
    },
  },
  {
    name: "UserIncomingCallNumberAPI",
    statusPath: "/user-incoming-call-number/verification-status",
    service: UserIncomingCallNumberService,
    build: () => {
      new UserIncomingCallNumberAPI();
    },
  },
];

const NO_TWILIO: string =
  "No Twilio account is set up to send SMS. The OneUptime server's administrator can add one in Admin Dashboard > Settings > Call and SMS.";

describe.each(CHANNELS)("$name verification status", (channel: Channel) => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;
  let row: FakeRow | null;
  let cannotSendReason: string | null;
  let service: Record<string, jest.Mock>;

  const callStatus: (body: Record<string, unknown>) => Promise<void> = async (
    body: Record<string, unknown>,
  ) => {
    mockRequest.body = body;

    await mockRouter
      .match("post", channel.statusPath)
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

    service = channel.service as unknown as Record<string, jest.Mock>;

    row = {
      _id: ITEM_ID,
      userId: new ObjectID(OWNER_ID),
      projectId: new ObjectID(PROJECT_ID),
      isVerified: false,
      verificationCodeSentAt: new Date(Date.now() - 10 * 1000),
      verificationCodeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      verificationFailedAttempts: 0,
    };

    cannotSendReason = null;

    service["findOneById"] = jest.fn().mockImplementation(() => {
      return Promise.resolve(row ? { ...row } : null);
    });

    // The service's answer, worked out by the real state machine.
    service["getVerificationStatus"] = jest
      .fn()
      .mockImplementation((item: FakeRow) => {
        return Promise.resolve(
          ChannelVerification.getStatus({
            item: item,
            cannotSendReason: cannotSendReason,
          }),
        );
      });

    channel.build();

    mockRequest = {} as OneUptimeRequest;
    mockRequest.userAuthorization = {
      userId: new ObjectID(OWNER_ID),
    } as JSONWebTokenData;

    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;

    nextFunction = jest.fn();
  });

  it("is registered behind the signed-in user's session", () => {
    const route: { middlewares: Array<unknown> } | undefined =
      mockRouter.routes.find(
        (candidate: { method: string; uri: string }): boolean => {
          return (
            candidate.method === "POST" && candidate.uri === channel.statusPath
          );
        },
      ) as { middlewares: Array<unknown> } | undefined;

    expect(route).toBeDefined();
    expect(route!.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  it("requires an item ID", async () => {
    await callStatus({});

    expect(lastError().message).toBe("Invalid item ID");
    expect(service["findOneById"]).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mockRequest.userAuthorization = undefined;

    await callStatus({ itemId: ITEM_ID });

    expect(lastError().message).toBe("Invalid user ID");
    expect(service["findOneById"]).not.toHaveBeenCalled();
  });

  it("refuses an unknown item", async () => {
    row = null;

    await callStatus({ itemId: ITEM_ID });

    expect(lastError().message).toBe("Item not found");
  });

  /*
   * A row can hold somebody else's number - that is how "add my phone"
   * works - so ownership is what keeps one person from reading another's.
   */
  it("answers nobody but the row's owner", async () => {
    mockRequest.userAuthorization = {
      userId: new ObjectID(OTHER_USER_ID),
    } as JSONWebTokenData;

    await callStatus({ itemId: ITEM_ID });

    expect(lastError().message).toBe("Invalid user ID");
    expect(service["getVerificationStatus"]).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("tells the owner where their code stands", async () => {
    await callStatus({ itemId: ITEM_ID });

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      mockRequest,
      mockResponse,
      {
        isVerified: false,
        codeState: "active",
        codeSentAt: row!.verificationCodeSentAt!.toISOString(),
        codeExpiresAt: row!.verificationCodeExpiresAt!.toISOString(),
        resendAvailableInSeconds: expect.any(Number),
        cannotSendReason: null,
      },
    );
  });

  it("reads the row as OneUptime, with only what the status needs", async () => {
    await callStatus({ itemId: ITEM_ID });

    const query: {
      id: ObjectID;
      props: { isRoot: boolean };
      select: Record<string, boolean>;
    } = service["findOneById"]!.mock.calls[0]![0];

    expect(query.id.toString()).toBe(ITEM_ID);
    expect(query.props.isRoot).toBe(true);
    expect(Object.keys(query.select).sort()).toEqual(
      [
        "isVerified",
        "projectId",
        "userId",
        "verificationCodeExpiresAt",
        "verificationCodeSentAt",
        "verificationFailedAttempts",
      ].sort(),
    );
    // Never the code's digest.
    expect(query.select["verificationCode"]).toBeUndefined();
  });

  it("says why no code can be sent, when the service says so", async () => {
    cannotSendReason = NO_TWILIO;

    await callStatus({ itemId: ITEM_ID });

    const answered: Record<string, unknown> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls[0]![2] as Record<string, unknown>;

    expect(answered["cannotSendReason"]).toBe(NO_TWILIO);
  });

  it("an expired code reads as expired", async () => {
    row!.verificationCodeExpiresAt = new Date(Date.now() - 1000);

    await callStatus({ itemId: ITEM_ID });

    const answered: Record<string, unknown> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls[0]![2] as Record<string, unknown>;

    expect(answered["codeState"]).toBe("expired");
  });

  it("hands a failure to the error handler", async () => {
    const failure: Error = new Error("database unavailable");
    service["findOneById"] = jest.fn().mockRejectedValue(failure);

    await callStatus({ itemId: ITEM_ID });

    expect(nextFunction).toHaveBeenCalledWith(failure);
  });

  it("answers the status the service worked out", async () => {
    const status: ChannelVerificationStatus = {
      isVerified: true,
      codeState: ChannelVerification.getStatus({ item: { isVerified: true } })
        .codeState,
      codeSentAt: null,
      codeExpiresAt: null,
      resendAvailableInSeconds: 0,
      cannotSendReason: null,
    };
    service["getVerificationStatus"] = jest.fn().mockResolvedValue(status);

    await callStatus({ itemId: ITEM_ID });

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      mockRequest,
      mockResponse,
      ChannelVerification.statusToJSON(status),
    );
  });
});
