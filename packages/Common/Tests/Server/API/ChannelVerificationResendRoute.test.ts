import ChannelVerificationResendRoute from "../../../Server/API/ChannelVerificationResendRoute";
import UserCallAPI from "../../../Server/API/UserCallAPI";
import UserEmailAPI from "../../../Server/API/UserEmailAPI";
import UserIncomingCallNumberAPI from "../../../Server/API/UserIncomingCallNumberAPI";
import UserSmsAPI from "../../../Server/API/UserSmsAPI";
import UserWhatsAppAPI from "../../../Server/API/UserWhatsAppAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../../../Server/Middleware/VerificationCodeRateLimit";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ChannelVerification, {
  VerifiableChannelModel,
} from "../../../Server/Utils/ChannelVerification";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import BadDataException from "../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

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
 * POST <channel>/resend-verification-code, registered for every channel with
 * a code through one function (ChannelVerificationResendRoute), and the add
 * of such a channel's method counted before anything is sent
 * (VerificationCodeRateLimit.checkAddAllowed). The registrar is run here on
 * a fake service so its order is pinned on its own; the five channels run
 * the same cases through their own APIs in
 * NotificationChannelVerificationAPI.test.ts.
 */

const ITEM_ID: string = "9e000000-0000-4000-8000-000000000001";
const OWNER_ID: string = "9e000000-0000-4000-8000-000000000002";
const OTHER_USER_ID: string = "9e000000-0000-4000-8000-000000000003";
const PATH: string = "/user-fake-channel";

type AnyService = Record<string, jest.Mock>;

describe("ChannelVerificationResendRoute.register", () => {
  let service: AnyService;
  let request: OneUptimeRequest;
  let response: ExpressResponse;
  let next: NextFunction;
  let limiter: unknown;

  const call: (body: Record<string, unknown>) => Promise<void> = async (
    body: Record<string, unknown>,
  ): Promise<void> => {
    request.body = body;

    await mockRouter
      .match("post", `${PATH}/resend-verification-code`)
      .handlerFunction(request, response, next);
  };

  const lastError: () => BadDataException | undefined = ():
    | BadDataException
    | undefined => {
    const calls: Array<Array<unknown>> = (
      Response.sendErrorResponse as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    return calls[calls.length - 1]?.[2] as BadDataException | undefined;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes.length = 0;

    service = {
      findOneById: jest.fn().mockResolvedValue({
        _id: ITEM_ID,
        userId: new ObjectID(OWNER_ID),
      }),
      resendVerificationCode: jest.fn().mockResolvedValue(undefined),
      getVerificationStatus: jest.fn().mockImplementation((item: unknown) => {
        return Promise.resolve(
          ChannelVerification.getStatus({
            item: item as VerifiableChannelModel,
          }),
        );
      }),
    };

    const realGetMiddleware: typeof VerificationCodeRateLimit.getMiddleware =
      VerificationCodeRateLimit.getMiddleware.bind(VerificationCodeRateLimit);

    const capture: jest.SpyInstance = jest
      .spyOn(VerificationCodeRateLimit, "getMiddleware")
      .mockImplementation(((bucket: VerificationCodeRateLimitBucket) => {
        limiter = realGetMiddleware(bucket);
        return limiter;
      }) as never);

    ChannelVerificationResendRoute.register({
      router: mockRouter as unknown as ExpressRouter,
      path: PATH,
      service: service as unknown as DatabaseService<VerifiableChannelModel> & {
        getVerificationStatus: jest.Mock;
        resendVerificationCode: jest.Mock;
      },
    });

    expect(capture).toHaveBeenCalledWith(
      VerificationCodeRateLimitBucket.Resend,
    );
    capture.mockRestore();

    request = {} as OneUptimeRequest;
    request.userAuthorization = {
      userId: new ObjectID(OWNER_ID),
    } as JSONWebTokenData;
    response = {} as ExpressResponse;
    next = jest.fn() as unknown as NextFunction;
  });

  it("is registered behind the session, the sign-in guard and the resend budget, in that order", () => {
    expect(
      mockRouter.match("post", `${PATH}/resend-verification-code`).middlewares,
    ).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      limiter,
    ]);
  });

  it("requires an item ID, before reading anything", async () => {
    await call({});

    expect(lastError()?.message).toBe("Invalid item ID");
    expect(service["findOneById"]).not.toHaveBeenCalled();
  });

  /*
   * A session that names nobody is refused before the row is read: an
   * owner and a caller that are both missing never compare as equal.
   */
  it("refuses a session that names no person, before reading the row", async () => {
    request.userAuthorization = {} as JSONWebTokenData;
    service["findOneById"]!.mockResolvedValue({ _id: ITEM_ID });

    await call({ itemId: ITEM_ID });

    expect(lastError()?.message).toBe("Invalid user ID");
    expect(service["findOneById"]).not.toHaveBeenCalled();
    expect(service["resendVerificationCode"]).not.toHaveBeenCalled();
  });

  it("refuses a request with no authorization at all, before reading the row", async () => {
    delete (request as { userAuthorization?: unknown }).userAuthorization;

    await call({ itemId: ITEM_ID });

    expect(lastError()?.message).toBe("Invalid user ID");
    expect(service["findOneById"]).not.toHaveBeenCalled();
  });

  it("refuses a row that does not exist", async () => {
    service["findOneById"]!.mockResolvedValue(null);

    await call({ itemId: ITEM_ID });

    expect(lastError()?.message).toBe("Item not found");
    expect(service["resendVerificationCode"]).not.toHaveBeenCalled();
  });

  it("refuses somebody else's row", async () => {
    request.userAuthorization = {
      userId: new ObjectID(OTHER_USER_ID),
    } as JSONWebTokenData;

    await call({ itemId: ITEM_ID });

    expect(lastError()?.message).toBe("Invalid user ID");
    expect(service["resendVerificationCode"]).not.toHaveBeenCalled();
  });

  it("refuses a row that has no owner", async () => {
    service["findOneById"]!.mockResolvedValue({ _id: ITEM_ID });

    await call({ itemId: ITEM_ID });

    expect(lastError()?.message).toBe("Invalid user ID");
    expect(service["resendVerificationCode"]).not.toHaveBeenCalled();
  });

  it("reads the row as OneUptime, with only its owner", async () => {
    await call({ itemId: ITEM_ID });

    expect(service["findOneById"]).toHaveBeenCalledWith({
      id: ITEM_ID,
      props: { isRoot: true },
      select: { userId: true },
    });
  });

  it("hands the owner's row to the channel's own resend, and answers with where the new code stands", async () => {
    await call({ itemId: ITEM_ID });

    expect(service["resendVerificationCode"]).toHaveBeenCalledWith(ITEM_ID);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      request,
      response,
      expect.objectContaining({ isVerified: false }),
    );
  });

  it("hands a refusal of the channel's resend - not a member any more, say - to the error handler", async () => {
    const refusal: BadDataException = new BadDataException("Item not found");
    service["resendVerificationCode"]!.mockRejectedValue(refusal);

    await call({ itemId: ITEM_ID });

    expect(next).toHaveBeenCalledWith(refusal);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

/*
 * Each channel that sends a code counts an add before anything is sent: an
 * add is a first code, and adding a number, removing it and adding it again
 * would otherwise send one each time with no limit.
 */
describe("the add of a method that sends a code is counted", () => {
  type ApiWithCreateHook = {
    onBeforeCreate: (
      req: ExpressRequest,
      res: ExpressResponse,
    ) => Promise<void>;
  };

  const APIS: Array<[string, () => unknown, string]> = [
    [
      "UserEmailAPI",
      () => {
        return new UserEmailAPI();
      },
      "/user-email",
    ],
    [
      "UserSmsAPI",
      () => {
        return new UserSmsAPI();
      },
      "/user-sms",
    ],
    [
      "UserCallAPI",
      () => {
        return new UserCallAPI();
      },
      "/user-call",
    ],
    [
      "UserWhatsAppAPI",
      () => {
        return new UserWhatsAppAPI();
      },
      "/user-whatsapp",
    ],
    [
      "UserIncomingCallNumberAPI",
      () => {
        return new UserIncomingCallNumberAPI();
      },
      "/user-incoming-call-number",
    ],
  ];

  let checkAddAllowed: jest.SpyInstance;

  beforeEach(() => {
    mockRouter.routes.length = 0;
    checkAddAllowed = jest
      .spyOn(VerificationCodeRateLimit, "checkAddAllowed")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    checkAddAllowed.mockRestore();
  });

  it.each(APIS)(
    "%s counts its adds under its own path",
    async (_name: string, build: () => unknown, channel: string) => {
      const api: ApiWithCreateHook = build() as ApiWithCreateHook;
      const req: ExpressRequest = {} as ExpressRequest;
      const res: ExpressResponse = {} as ExpressResponse;

      await api.onBeforeCreate(req, res);

      expect(checkAddAllowed).toHaveBeenCalledWith({
        req: req,
        res: res,
        channel: channel,
      });
    },
  );

  it.each(APIS)(
    "%s refuses the add when the budget is spent",
    async (_name: string, build: () => unknown) => {
      const api: ApiWithCreateHook = build() as ApiWithCreateHook;
      const spent: Error = new Error("Too many notification methods added.");
      checkAddAllowed.mockRejectedValue(spent);

      await expect(
        api.onBeforeCreate({} as ExpressRequest, {} as ExpressResponse),
      ).rejects.toBe(spent);
    },
  );
});

/*
 * Every resend route goes through the one registrar: a channel with a code
 * that registered its own would not get the next control added to it.
 * Telegram rotates a link rather than sending a code, and the administrator's
 * route resends for a member through UserNotificationMethodAdminService;
 * both ask the membership of the row's project themselves.
 */
describe("every channel's resend is the shared one", () => {
  const API_DIR: string = path.resolve(__dirname, "../../../Server/API");

  const OWN_RESEND_ROUTES: Array<string> = [
    "ChannelVerificationResendRoute.ts",
    "UserNotificationMethodAdminAPI.ts",
    "UserTelegramAPI.ts",
  ];

  const sources: Array<[string, string]> = fs
    .readdirSync(API_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .map((name: string): [string, string] => {
      return [name, fs.readFileSync(path.join(API_DIR, name), "utf8")];
    });

  it("only the registrar and the two routes that ask for themselves name the resend path", () => {
    expect(
      sources
        .filter(([, source]: [string, string]): boolean => {
          return source.includes("/resend-verification-code");
        })
        .map(([name]: [string, string]): string => {
          return name;
        })
        .sort(),
    ).toEqual([...OWN_RESEND_ROUTES].sort());
  });

  it("every channel with a verify dialog registers the shared resend and counts its adds", () => {
    const withStatus: Array<[string, string]> = sources.filter(
      ([, source]: [string, string]): boolean => {
        return source.includes("ChannelVerificationStatusRoute.register(");
      },
    );

    expect(withStatus).toHaveLength(5);

    for (const [name, source] of withStatus) {
      expect({
        name,
        resend: source.includes("ChannelVerificationResendRoute.register("),
        countsAdds: source.includes(
          "VerificationCodeRateLimit.checkAddAllowed(",
        ),
      }).toEqual({ name, resend: true, countsAdds: true });
    }
  });
});
