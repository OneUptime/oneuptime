import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import CallLogService from "Common/Server/Services/CallLogService";
import CommonSmsService from "Common/Server/Services/SmsService";
import CommonCallService from "Common/Server/Services/CallService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import BlockedProjectNotifications from "Common/Server/Utils/Notification/BlockedProjectNotifications";
import { GLOBAL_TWILIO_CONFIG_SELECT } from "Common/Server/Utils/TwilioConfigSelect";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import API, { APIRequestOptions } from "Common/Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import Twilio from "twilio";
import RestException from "twilio/lib/base/RestException";

/*
 * SMS AND CALLS GO OUT FROM THE NUMBERS OF THEIR KIND, through the
 * Notification service: its SmsService and CallService, its cluster routes
 * (/sms/send, /call/make-call) and its test routes (Send Test SMS, Send Test
 * Call), with the Twilio client faked at its boundary.
 *
 * A Twilio number can make calls and send SMS, or only one of the two, and
 * in Singapore calls need a national number and SMS a mobile one. A config,
 * a project's or the OneUptime server's own, can name numbers for SMS:
 *
 *   - an SMS goes out from the config's SMS number, a call from its primary
 *     number - through a project's config and through the server's own;
 *   - a config without SMS numbers sends both from its primary number, as
 *     every config did;
 *   - what the server's senders post reaches Twilio as the right number,
 *     and a config posted the older way - its lists as one comma-separated
 *     string, which made every SMS and call through a config with secondary
 *     numbers fail - is read as lists;
 *   - Send Test SMS goes out from the SMS number and Send Test Call from the
 *     primary one, and Twilio's refusal of a test is answered in Twilio's
 *     words - for an SMS from a number that can only make calls (error
 *     21606), with what to do about it.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    EXTERNAL_FAULT: {},
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
      getClusterKeyHeaders: jest.fn().mockReturnValue({}),
    },
  };
});

const CALLER_PROJECT_ID: string = "3d000000-0000-4000-8000-000000000001";

jest.mock("Common/Server/API/TestSendAccess", () => {
  return {
    __esModule: true,
    default: {
      assertMaySendTest: jest.fn(async () => {
        const ObjectIDClass: any = (
          jest.requireActual("Common/Types/ObjectID") as any
        ).default;
        return {
          projectId: new ObjectIDClass("3d000000-0000-4000-8000-000000000001"),
        };
      }),
    },
  };
});

/*
 * The client is faked; the TwiML builder is the real one, so a call's
 * script is written as it would be.
 */
jest.mock("twilio", () => {
  const actual: { twiml: unknown } = jest.requireActual("twilio") as {
    twiml: unknown;
  };
  const client: ((...args: Array<unknown>) => unknown) & {
    twiml?: unknown;
  } = jest.fn();
  client.twiml = actual.twiml;

  return {
    __esModule: true,
    default: client,
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: false,
  };
});

import "../../FeatureSet/Notification/API/SMS";
import "../../FeatureSet/Notification/API/Call";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import { getTwilioConfig } from "../../FeatureSet/Notification/Config";
import TwilioSendError, {
  SMS_NUMBER_HINT,
  TwilioSendKind,
} from "../../FeatureSet/Notification/Utils/TwilioSendError";

const PROJECT_ID: ObjectID = new ObjectID(CALLER_PROJECT_ID);
const CONFIG_ID: ObjectID = new ObjectID(
  "3d000000-0000-4000-8000-000000000002",
);

const SG_NATIONAL: string = "+6561234567";
const SG_MOBILE: string = "+6581234567";
const SG_RECIPIENT: string = "+6590665484";
const UK_NUMBER: string = "+447700900123";
const UK_RECIPIENT: string = "+447911123456";
const US_NUMBER: string = "+14155550100";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

function handlerOf(uri: string, index: number = 0): RouterFunction {
  const handlers: Array<RouterFunction> = mockRouter.routes
    .filter((route: { method: string; uri: string }): boolean => {
      return route.method === "POST" && route.uri === uri;
    })
    .map((route: { handlerFunction: RouterFunction }): RouterFunction => {
      return route.handlerFunction;
    });

  expect(handlers.length).toBeGreaterThan(index);

  return handlers[index]!;
}

// SMS.ts registers first, Call.ts second: each has a POST /test.
const sendSmsRoute: () => RouterFunction = (): RouterFunction => {
  return handlerOf("/send");
};
const makeCallRoute: () => RouterFunction = (): RouterFunction => {
  return handlerOf("/make-call");
};
const testSmsRoute: () => RouterFunction = (): RouterFunction => {
  return handlerOf("/test", 0);
};
const testCallRoute: () => RouterFunction = (): RouterFunction => {
  return handlerOf("/test", 1);
};

async function callRoute(
  handler: RouterFunction,
  body: JSONObject,
): Promise<unknown> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await handler(req, res, next as unknown as NextFunction);

  return next.mock.calls[0] ? next.mock.calls[0][0] : undefined;
}

function singaporeConfig(): TwilioConfig {
  return {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    primaryPhoneNumber: new Phone(SG_NATIONAL),
    secondaryPhoneNumbers: [],
    smsPhoneNumber: new Phone(SG_MOBILE),
  };
}

function twilioRefusal(code: number, message: string): RestException {
  return new RestException({
    statusCode: 400,
    body: {
      code: code,
      message: message,
      more_info: `https://www.twilio.com/docs/errors/${code}`,
    },
  });
}

let createMessage: AsyncMock;
let createCall: AsyncMock;
let smsLogs: Array<SmsLog>;
let callLogs: Array<CallLog>;

function sentFrom(): Array<string> {
  return createMessage.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as JSONObject)["from"]);
  });
}

function calledFrom(): Array<string> {
  return createCall.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as JSONObject)["from"]);
  });
}

beforeEach(() => {
  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);
  createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Singapore Ops";
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(project);
  }) as never);

  smsLogs = [];
  callLogs = [];

  jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
    data: SmsLog;
  }) => {
    const row: SmsLog = data.data;
    row._id = ObjectID.generate().toString();
    smsLogs.push(row);
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    callLogs.push(data.data);
    return Promise.resolve(data.data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Notification service sending through a project's own Twilio config", () => {
  test("an SMS goes out from the config's SMS number, and its log says so", async () => {
    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: singaporeConfig(),
    });

    expect(sentFrom()).toEqual([SG_MOBILE]);
    expect(smsLogs[0]!.fromNumber?.toString()).toBe(SG_MOBILE);
  });

  test("a call goes out from the config's primary number, never its SMS one", async () => {
    await CallService.makeCall(
      {
        to: new Phone(SG_RECIPIENT),
        data: [{ sayMessage: "Incident created" }],
      } as unknown as CallRequest,
      { projectId: PROJECT_ID, customTwilioConfig: singaporeConfig() },
    );

    expect(calledFrom()).toEqual([SG_NATIONAL]);
    expect(callLogs[0]!.fromNumber?.toString()).toBe(SG_NATIONAL);
  });

  test("a config without SMS numbers sends both from its primary number, as every config did", async () => {
    const plain: TwilioConfig = {
      accountSid: "AC1",
      authToken: "token",
      primaryPhoneNumber: new Phone(US_NUMBER),
      secondaryPhoneNumbers: [new Phone(UK_NUMBER)],
    };

    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: plain,
    });
    await SmsService.sendSms(new Phone(UK_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: plain,
    });
    await CallService.makeCall(
      {
        to: new Phone(SG_RECIPIENT),
        data: [{ sayMessage: "Incident created" }],
      } as unknown as CallRequest,
      { projectId: PROJECT_ID, customTwilioConfig: plain },
    );

    expect(sentFrom()).toEqual([US_NUMBER, UK_NUMBER]);
    expect(calledFrom()).toEqual([US_NUMBER]);
  });
});

describe("the Notification service sending through the OneUptime server's own account", () => {
  test("its SMS go out from its SMS number, its calls from its primary number", async () => {
    jest.spyOn(GlobalConfigService, "findOneBy").mockImplementation((() => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig.twilioAccountSID = "AC00000000000000000000000000000002";
      globalConfig.twilioAuthToken = "server-token";
      globalConfig.twilioPrimaryPhoneNumber = new Phone(SG_NATIONAL);
      globalConfig.twilioSecondaryPhoneNumbers = `${UK_NUMBER},`;
      globalConfig.twilioSmsPhoneNumber = new Phone(SG_MOBILE);
      return Promise.resolve(globalConfig);
    }) as never);

    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Your code is 482915", {
      projectId: PROJECT_ID,
      isSensitive: true,
    });
    await CallService.makeCall(
      {
        to: new Phone(SG_RECIPIENT),
        data: [{ sayMessage: "Your code is 4 8 2 9 1 5" }],
      } as unknown as CallRequest,
      { projectId: PROJECT_ID, isSensitive: true },
    );

    expect(sentFrom()).toEqual([SG_MOBILE]);
    expect(calledFrom()).toEqual([SG_NATIONAL]);
  });

  test("its settings are read with every number it sends from, and a stray comma no longer fails them", async () => {
    const findOneBy: jest.SpiedFunction<typeof GlobalConfigService.findOneBy> =
      jest.spyOn(GlobalConfigService, "findOneBy").mockImplementation((() => {
        const globalConfig: GlobalConfig = new GlobalConfig();
        globalConfig.twilioAccountSID = "AC2";
        globalConfig.twilioAuthToken = "server-token";
        globalConfig.twilioPrimaryPhoneNumber = new Phone(US_NUMBER);
        globalConfig.twilioSecondaryPhoneNumbers = `${UK_NUMBER}, `;
        globalConfig.twilioSmsPhoneNumber = new Phone(SG_MOBILE);
        globalConfig.twilioSmsSecondaryPhoneNumbers = `${UK_NUMBER},${SG_MOBILE}`;
        return Promise.resolve(globalConfig);
      }) as never);

    const twilioConfig: TwilioConfig | null = await getTwilioConfig();

    expect(
      (findOneBy.mock.calls[0]![0] as { select: unknown }).select,
    ).toEqual(GLOBAL_TWILIO_CONFIG_SELECT);
    expect(twilioConfig!.primaryPhoneNumber.toString()).toBe(US_NUMBER);
    expect(twilioConfig!.secondaryPhoneNumbers.map(String)).toEqual([
      UK_NUMBER,
    ]);
    expect(twilioConfig!.smsPhoneNumber!.toString()).toBe(SG_MOBILE);
    expect(twilioConfig!.smsSecondaryPhoneNumbers!.map(String)).toEqual([
      UK_NUMBER,
      SG_MOBILE,
    ]);
  });

  test("without SMS numbers, it is read as before: none", async () => {
    jest.spyOn(GlobalConfigService, "findOneBy").mockImplementation((() => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig.twilioAccountSID = "AC2";
      globalConfig.twilioAuthToken = "server-token";
      globalConfig.twilioPrimaryPhoneNumber = new Phone(US_NUMBER);
      return Promise.resolve(globalConfig);
    }) as never);

    const twilioConfig: TwilioConfig | null = await getTwilioConfig();

    expect(twilioConfig!.smsPhoneNumber).toBeUndefined();
    expect(twilioConfig!.smsSecondaryPhoneNumbers).toBeUndefined();
    expect(twilioConfig!.secondaryPhoneNumbers).toEqual([]);
  });
});

describe("what the server's senders post, as the Notification service's routes read it", () => {
  let posted: Array<APIRequestOptions>;

  beforeEach(() => {
    posted = [];

    jest
      .spyOn(BlockedProjectNotifications, "getRefusal")
      .mockResolvedValue(null as never);
    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ): Promise<HTTPResponse<JSONObject>> => {
      posted.push(options);
      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);
  });

  // The body as it arrives: JSON over the wire.
  function arrived(): JSONObject {
    return JSON.parse(JSON.stringify(posted[0]!.data)) as JSONObject;
  }

  test("an SMS posted through a project's config goes out from its SMS number", async () => {
    await CommonSmsService.sendSms(
      { to: new Phone(SG_RECIPIENT), message: "Incident created" },
      { projectId: PROJECT_ID, customTwilioConfig: singaporeConfig() },
    );

    expect(await callRoute(sendSmsRoute(), arrived())).toBeUndefined();
    expect(sentFrom()).toEqual([SG_MOBILE]);
  });

  test("a call posted through a project's config goes out from its primary number", async () => {
    await CommonCallService.makeCall(
      {
        to: new Phone(SG_RECIPIENT),
        data: [{ sayMessage: "Incident created" }],
      } as unknown as CallRequest,
      { projectId: PROJECT_ID, customTwilioConfig: singaporeConfig() },
    );

    expect(await callRoute(makeCallRoute(), arrived())).toBeUndefined();
    expect(calledFrom()).toEqual([SG_NATIONAL]);
  });

  /*
   * The bug the SMS numbers' wire format fixes: a config with secondary
   * numbers, posted the way the senders posted it until now - the list as
   * one comma-separated string - failed every send. Read as a list, the
   * SMS to the UK goes out from the UK number.
   */
  test("a config posted the older way, its secondary numbers as one string, is read as a list", async () => {
    const body: JSONObject = {
      to: UK_RECIPIENT,
      message: "Incident created",
      projectId: PROJECT_ID.toString(),
      customTwilioConfig: {
        accountSid: "AC1",
        authToken: "token",
        primaryPhoneNumber: US_NUMBER,
        secondaryPhoneNumbers: [
          new Phone(UK_NUMBER),
          new Phone(SG_MOBILE),
        ].toString(),
      },
    };

    expect(await callRoute(sendSmsRoute(), body)).toBeUndefined();
    expect(sentFrom()).toEqual([UK_NUMBER]);
    expect(smsLogs[0]!.statusMessage).not.toContain("is not a function");
  });

  test("a config posted with secondary numbers, through the server's own sender, sends", async () => {
    await CommonSmsService.sendSms(
      { to: new Phone(UK_RECIPIENT), message: "Incident created" },
      {
        projectId: PROJECT_ID,
        customTwilioConfig: {
          accountSid: "AC1",
          authToken: "token",
          primaryPhoneNumber: new Phone(US_NUMBER),
          secondaryPhoneNumbers: [new Phone(UK_NUMBER), new Phone(SG_MOBILE)],
        },
      },
    );

    expect(await callRoute(sendSmsRoute(), arrived())).toBeUndefined();
    expect(sentFrom()).toEqual([UK_NUMBER]);
  });

  test("a config it cannot read is refused, not sent through the server's account", async () => {
    const getServerConfig: jest.SpiedFunction<
      typeof GlobalConfigService.findOneBy
    > = jest.spyOn(GlobalConfigService, "findOneBy");

    const error: unknown = await callRoute(sendSmsRoute(), {
      to: SG_RECIPIENT,
      message: "Incident created",
      projectId: PROJECT_ID.toString(),
      customTwilioConfig: { accountSid: "AC1" },
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(createMessage).not.toHaveBeenCalled();
    expect(getServerConfig).not.toHaveBeenCalled();
  });
});

describe("Send Test SMS and Send Test Call", () => {
  function storedConfig(): ProjectCallSMSConfig {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    config.id = CONFIG_ID;
    config.projectId = PROJECT_ID;
    config.twilioAccountSID = "AC00000000000000000000000000000001";
    config.twilioAuthToken = "auth-token";
    config.twilioPrimaryPhoneNumber = new Phone(SG_NATIONAL);
    config.twilioSmsPhoneNumber = new Phone(SG_MOBILE);
    return config;
  }

  let findOneById: jest.SpiedFunction<
    typeof ProjectCallSMSConfigService.findOneById
  >;

  beforeEach(() => {
    findOneById = jest
      .spyOn(ProjectCallSMSConfigService, "findOneById")
      .mockResolvedValue(storedConfig() as never);
  });

  test("the test SMS goes out from the SMS number, read with the rest of the config", async () => {
    expect(
      await callRoute(testSmsRoute(), {
        callSMSConfigId: CONFIG_ID.toString(),
        toPhone: SG_RECIPIENT,
      }),
    ).toBeUndefined();

    expect(sentFrom()).toEqual([SG_MOBILE]);

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["twilioSmsPhoneNumber"]).toBe(true);
    expect(select["twilioSmsSecondaryPhoneNumbers"]).toBe(true);
    expect(select["projectId"]).toBe(true);
  });

  test("the test call goes out from the primary number", async () => {
    expect(
      await callRoute(testCallRoute(), {
        callSMSConfigId: CONFIG_ID.toString(),
        toPhone: SG_RECIPIENT,
      }),
    ).toBeUndefined();

    expect(calledFrom()).toEqual([SG_NATIONAL]);
  });

  /*
   * Testing SMS through a primary number that can only make calls - the
   * Singapore case before an SMS number is set: Twilio refuses it, and the
   * person testing is told Twilio's words and what to do, not "please check
   * the twilio logs".
   */
  test("Twilio refusing the test SMS is answered in Twilio's words, with what to do about it", async () => {
    findOneById.mockResolvedValue(
      Object.assign(storedConfig(), { twilioSmsPhoneNumber: undefined }) as never,
    );
    createMessage.mockRejectedValue(
      twilioRefusal(
        21606,
        `The From phone number ${SG_NATIONAL} is not a valid, SMS-capable inbound phone number or short code for your account.`,
      ) as never,
    );

    const error: unknown = await callRoute(testSmsRoute(), {
      callSMSConfigId: CONFIG_ID.toString(),
      toPhone: SG_RECIPIENT,
    });

    expect(sentFrom()).toEqual([SG_NATIONAL]);
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      `Twilio could not send this SMS: The From phone number ${SG_NATIONAL} is not a valid, SMS-capable inbound phone number or short code for your account (Twilio error 21606). ${SMS_NUMBER_HINT}`,
    );
  });

  test("Twilio refusing the test call is answered in Twilio's words too", async () => {
    createCall.mockRejectedValue(
      twilioRefusal(21215, "Account not authorized to call +6590665484.") as never,
    );

    const error: unknown = await callRoute(testCallRoute(), {
      callSMSConfigId: CONFIG_ID.toString(),
      toPhone: SG_RECIPIENT,
    });

    expect((error as Error).message).toBe(
      "Twilio could not place this call: Account not authorized to call +6590665484 (Twilio error 21215).",
    );
  });

  test("a failure that is not Twilio's refusal keeps the general answer", async () => {
    createMessage.mockRejectedValue(new Error("socket hang up") as never);

    const error: unknown = await callRoute(testSmsRoute(), {
      callSMSConfigId: CONFIG_ID.toString(),
      toPhone: SG_RECIPIENT,
    });

    expect((error as Error).message).toBe(
      "Failed to send test SMS. Please check the twilio logs for more details.",
    );
    expect((error as Error).message).not.toContain("socket hang up");
  });
});

describe("Twilio's refusal of an SMS from a number that cannot send SMS", () => {
  const MESSAGE: string =
    "The From phone number +6561234567 is not a valid, SMS-capable inbound phone number or short code for your account.";
  // Twilio's sentence loses its full stop, so its code can follow it.
  const FULL_STOP: RegExp = /\.$/;

  test("says to set an SMS number, after Twilio's words and its code", () => {
    const error: unknown = TwilioSendError.toSendError(
      twilioRefusal(21606, MESSAGE),
      TwilioSendKind.SMS,
    );

    expect((error as Error).message).toBe(
      `Twilio could not send this SMS: ${MESSAGE.replace(FULL_STOP, "")} (Twilio error 21606). ${SMS_NUMBER_HINT}`,
    );
    expect(SMS_NUMBER_HINT).toContain("Twilio SMS Phone Number");
    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: true,
    });
  });

  test("says nothing more for another refusal, or for a call", () => {
    expect(
      (
        TwilioSendError.toSendError(
          twilioRefusal(21408, "Permission to send an SMS has not been enabled."),
          TwilioSendKind.SMS,
        ) as Error
      ).message,
    ).not.toContain(SMS_NUMBER_HINT);
    expect(
      (
        TwilioSendError.toSendError(
          twilioRefusal(21606, MESSAGE),
          TwilioSendKind.Call,
        ) as Error
      ).message,
    ).not.toContain(SMS_NUMBER_HINT);
  });

  test("is a refusal the person who asked can act on, unlike our own failures", () => {
    expect(
      TwilioSendError.isActionableRefusal(
        TwilioSendError.toSendError(
          twilioRefusal(21606, MESSAGE),
          TwilioSendKind.SMS,
        ),
      ),
    ).toBe(true);
    expect(
      TwilioSendError.isActionableRefusal(new BadDataException("Bad input")),
    ).toBe(false);
    expect(TwilioSendError.isActionableRefusal(new Error("boom"))).toBe(false);
    expect(TwilioSendError.isActionableRefusal("text")).toBe(false);
  });
});
