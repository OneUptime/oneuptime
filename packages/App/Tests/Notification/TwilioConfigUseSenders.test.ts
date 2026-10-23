import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import CallLogService from "Common/Server/Services/CallLogService";
import CommonCallService from "Common/Server/Services/CallService";
import CommonSmsService from "Common/Server/Services/SmsService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import BlockedProjectNotifications from "Common/Server/Utils/Notification/BlockedProjectNotifications";
import NotificationService from "Common/Server/Services/NotificationService";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import { TEST_SEND_FROM_PHONE_NUMBER_FIELD } from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import CallStatus from "Common/Types/Call/CallStatus";
import {
  getNoTwilioAccountMessage,
  TwilioMessageKind,
} from "Common/Utils/Project/TwilioAccount";
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

/*
 * A TWILIO CONFIG USED FOR SMS ONLY, OR FOR CALLS ONLY, IN THE NOTIFICATION
 * SERVICE: its SmsService and CallService, its cluster routes (/sms/send,
 * /call/make-call) and its test routes, with the Twilio client faked at its
 * boundary.
 *
 * A config is used for calls and SMS, SMS only or calls only
 * (Common/Types/CallAndSMS/TwilioConfigUse):
 *
 *   - an SMS through a config used for SMS only goes out from its SMS
 *     numbers; a call it is handed goes as it would without the config -
 *     through the server's own account, paid from the project's balance -
 *     and never from a number of the config's;
 *   - a config used for calls only does the same the other way round;
 *   - when the server has no account for that message either, the message
 *     is not sent, and its log says the project's config is not used for
 *     it, and who can change that;
 *   - what the server's senders post carries the use, and comes out the
 *     same;
 *   - Send Test SMS on a config used for calls only - and Send Test Call on
 *     one used for SMS only - is refused, saying why, instead of going out
 *     through the server's account;
 *   - every config used for calls and SMS sends exactly as before.
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

const CALLER_PROJECT_ID: string = "4e000000-0000-4000-8000-000000000001";

jest.mock("Common/Server/API/TestSendAccess", () => {
  return {
    __esModule: true,
    default: {
      assertMaySendTest: jest.fn(async () => {
        const ObjectIDClass: any = (
          jest.requireActual("Common/Types/ObjectID") as any
        ).default;
        return {
          projectId: new ObjectIDClass("4e000000-0000-4000-8000-000000000001"),
        };
      }),
    },
  };
});

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

/*
 * Billing is off unless a test turns it on: then a message that goes
 * through the server's own account is paid from the project's balance. Kept
 * on globalThis: the services read it while this file's imports load,
 * before any variable of its own is set.
 */
type BillingSwitch = { twilioConfigUseBillingEnabled?: boolean };

const setBillingEnabled: (enabled: boolean) => void = (
  enabled: boolean,
): void => {
  (globalThis as BillingSwitch).twilioConfigUseBillingEnabled = enabled;
};

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { __esModule: true, ...actual };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return (
        (globalThis as { twilioConfigUseBillingEnabled?: boolean })
          .twilioConfigUseBillingEnabled === true
      );
    },
  });

  return mocked;
});

import "../../FeatureSet/Notification/API/SMS";
import "../../FeatureSet/Notification/API/Call";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import { getTwilioConfig } from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(CALLER_PROJECT_ID);
const CONFIG_ID: ObjectID = new ObjectID(
  "4e000000-0000-4000-8000-000000000002",
);

const SG_MOBILE: string = "+6581234567";
const SG_RECIPIENT: string = "+6590665484";
const UK_MOBILE: string = "+447700900123";
const UK_RECIPIENT: string = "+447911123456";
const US_NUMBER: string = "+14155550100";
const SERVER_NUMBER: string = "+14155550199";
const SERVER_SMS_NUMBER: string = "+14155550188";

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
  const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

  await handler(req, res, next as unknown as NextFunction);

  return next.mock.calls[0] ? next.mock.calls[0][0] : undefined;
}

function smsOnlyConfig(): TwilioConfig {
  return {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    use: TwilioConfigUse.SmsOnly,
    secondaryPhoneNumbers: [],
    smsPhoneNumbers: [new Phone(SG_MOBILE), new Phone(UK_MOBILE)],
  };
}

function callsOnlyConfig(): TwilioConfig {
  return {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    use: TwilioConfigUse.CallsOnly,
    primaryPhoneNumber: new Phone(US_NUMBER),
    secondaryPhoneNumbers: [],
    // Kept, but never sent from: the config is used for calls only.
    smsPhoneNumbers: [new Phone(SG_MOBILE)],
  };
}

function callTo(recipient: string): CallRequest {
  return {
    to: new Phone(recipient),
    data: [{ sayMessage: "Incident created" }],
  } as unknown as CallRequest;
}

let createMessage: Mock<(...args: Array<unknown>) => Promise<unknown>>;
let createCall: Mock<(...args: Array<unknown>) => Promise<unknown>>;
// Which account each message went through: the Twilio client's SID.
let clientAccounts: Array<string>;
let smsLogs: Array<SmsLog>;
let callLogs: Array<CallLog>;
let serverAccount: GlobalConfig | null;
let projectBalanceInCents: number;

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

function serverAccountUsedFor(use: TwilioConfigUse): GlobalConfig {
  return Object.assign(new GlobalConfig(), {
    twilioUsedFor: use,
    twilioAccountSID: "AC00000000000000000000000000000002",
    twilioAuthToken: "server-token",
    twilioPrimaryPhoneNumber: new Phone(SERVER_NUMBER),
    twilioSmsPhoneNumbers: SERVER_SMS_NUMBER,
  });
}

beforeEach(() => {
  setBillingEnabled(false);
  projectBalanceInCents = 10000;
  serverAccount = serverAccountUsedFor(TwilioConfigUse.CallsAndSms);
  clientAccounts = [];

  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);
  createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

  (
    Twilio as unknown as Mock<(...args: Array<unknown>) => unknown>
  ).mockImplementation((accountSid: unknown) => {
    clientAccounts.push(String(accountSid));
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Ops";
    project.enableSmsNotifications = true;
    project.enableCallNotifications = true;
    project.smsOrCallCurrentBalanceInUSDCents = projectBalanceInCents;
    return Promise.resolve(project);
  }) as never);

  jest.spyOn(GlobalConfigService, "findOneBy").mockImplementation((() => {
    return Promise.resolve(serverAccount);
  }) as never);

  // What billing reads of the project's balance, without a database.
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockImplementation((() => {
      return Promise.resolve(projectBalanceInCents);
    }) as never);
  jest
    .spyOn(ProjectService, "claimSmsOrCallLowBalanceNotice")
    .mockResolvedValue(false as never);

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

describe("a config used for SMS only", () => {
  test("sends every SMS from its SMS numbers, through its own account", async () => {
    for (const recipient of [SG_RECIPIENT, UK_RECIPIENT, "+33612345678"]) {
      await SmsService.sendSms(new Phone(recipient), "Incident created", {
        projectId: PROJECT_ID,
        customTwilioConfig: smsOnlyConfig(),
      });
    }

    expect(sentFrom()).toEqual([SG_MOBILE, UK_MOBILE, SG_MOBILE]);
    expect(clientAccounts).toEqual([
      "AC00000000000000000000000000000001",
      "AC00000000000000000000000000000001",
      "AC00000000000000000000000000000001",
    ]);
  });

  test("makes no call: a call it is handed goes through the server's own account, from the server's number", async () => {
    await CallService.makeCall(callTo(SG_RECIPIENT), {
      projectId: PROJECT_ID,
      customTwilioConfig: smsOnlyConfig(),
    });

    expect(calledFrom()).toEqual([SERVER_NUMBER]);
    expect(clientAccounts).toEqual(["AC00000000000000000000000000000002"]);
    expect(callLogs[0]!.fromNumber?.toString()).toBe(SERVER_NUMBER);
  });

  test("with no server account that makes calls, the call is not placed, and its log says why", async () => {
    // A server whose settings hold no Twilio account, and one used for SMS only.
    for (const server of [
      new GlobalConfig(),
      serverAccountUsedFor(TwilioConfigUse.SmsOnly),
    ]) {
      serverAccount = server;
      callLogs = [];

      await expect(
        CallService.makeCall(callTo(SG_RECIPIENT), {
          projectId: PROJECT_ID,
          customTwilioConfig: smsOnlyConfig(),
        }),
      ).rejects.toThrow(
        getNoTwilioAccountMessage(TwilioMessageKind.Call, {
          projectConfigUse: TwilioConfigUse.SmsOnly,
        }),
      );

      expect(createCall).not.toHaveBeenCalled();
      expect(callLogs[0]!.status).toBe(CallStatus.Error);
      expect(callLogs[0]!.statusMessage).toBe(
        getNoTwilioAccountMessage(TwilioMessageKind.Call, {
          projectConfigUse: TwilioConfigUse.SmsOnly,
        }),
      );
    }
  });

  test("the call that goes through the server's account is paid from the project's balance", async () => {
    setBillingEnabled(true);
    projectBalanceInCents = 0;

    await CallService.makeCall(callTo(SG_RECIPIENT), {
      projectId: PROJECT_ID,
      customTwilioConfig: smsOnlyConfig(),
    });

    // Nothing in the balance, so the server's account places nothing.
    expect(createCall).not.toHaveBeenCalled();
    expect(callLogs[0]!.status).toBe(CallStatus.LowBalance);

    // Its SMS go through its own account: not paid from the balance.
    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: smsOnlyConfig(),
    });

    expect(sentFrom()).toEqual([SG_MOBILE]);
  });
});

describe("a config used for calls only", () => {
  test("makes calls from its primary number, through its own account", async () => {
    await CallService.makeCall(callTo(SG_RECIPIENT), {
      projectId: PROJECT_ID,
      customTwilioConfig: callsOnlyConfig(),
    });

    expect(calledFrom()).toEqual([US_NUMBER]);
    expect(clientAccounts).toEqual(["AC00000000000000000000000000000001"]);
  });

  test("sends no SMS - not from the SMS numbers it keeps: an SMS goes through the server's own account", async () => {
    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: callsOnlyConfig(),
    });

    expect(sentFrom()).toEqual([SERVER_SMS_NUMBER]);
    expect(clientAccounts).toEqual(["AC00000000000000000000000000000002"]);
    expect(smsLogs[0]!.fromNumber?.toString()).toBe(SERVER_SMS_NUMBER);
  });

  test("with no server account that sends SMS, the SMS is not sent, and its log says why", async () => {
    serverAccount = serverAccountUsedFor(TwilioConfigUse.CallsOnly);

    await expect(
      SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
        projectId: PROJECT_ID,
        customTwilioConfig: callsOnlyConfig(),
      }),
    ).rejects.toThrow(BadDataException);

    expect(createMessage).not.toHaveBeenCalled();
    expect(smsLogs[0]!.status).toBe(SmsStatus.Error);
    expect(smsLogs[0]!.statusMessage).toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    );
  });

  test("the SMS that goes through the server's account is paid from the project's balance", async () => {
    setBillingEnabled(true);
    projectBalanceInCents = 0;

    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: callsOnlyConfig(),
    });

    expect(createMessage).not.toHaveBeenCalled();
    expect(smsLogs[0]!.status).toBe(SmsStatus.LowBalance);
  });
});

describe("a config used for calls and SMS - every existing one", () => {
  test("sends both through its own account, from its number, as before, whatever the server's account is used for", async () => {
    const both: TwilioConfig = {
      accountSid: "AC00000000000000000000000000000001",
      authToken: "auth-token",
      use: TwilioConfigUse.CallsAndSms,
      primaryPhoneNumber: new Phone(US_NUMBER),
      secondaryPhoneNumbers: [],
    };

    serverAccount = serverAccountUsedFor(TwilioConfigUse.SmsOnly);

    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
      customTwilioConfig: both,
    });
    await CallService.makeCall(callTo(SG_RECIPIENT), {
      projectId: PROJECT_ID,
      customTwilioConfig: both,
    });

    expect(sentFrom()).toEqual([US_NUMBER]);
    expect(calledFrom()).toEqual([US_NUMBER]);
    expect(clientAccounts).toEqual([
      "AC00000000000000000000000000000001",
      "AC00000000000000000000000000000001",
    ]);
  });
});

describe("the server's own account, used for one of the two", () => {
  test("is no account for the other", async () => {
    serverAccount = serverAccountUsedFor(TwilioConfigUse.SmsOnly);

    expect(await getTwilioConfig(TwilioMessageKind.SMS)).not.toBeNull();
    expect(await getTwilioConfig(TwilioMessageKind.Call)).toBeNull();
    // Asked without a kind - the incoming-call provider's question - it is there.
    expect((await getTwilioConfig())?.use).toBe(TwilioConfigUse.SmsOnly);

    serverAccount = serverAccountUsedFor(TwilioConfigUse.CallsOnly);

    expect(await getTwilioConfig(TwilioMessageKind.SMS)).toBeNull();
    expect(await getTwilioConfig(TwilioMessageKind.Call)).not.toBeNull();
  });

  test("used for SMS only, makes no call a project without a config asks of it", async () => {
    serverAccount = serverAccountUsedFor(TwilioConfigUse.SmsOnly);

    await expect(
      CallService.makeCall(callTo(SG_RECIPIENT), { projectId: PROJECT_ID }),
    ).rejects.toThrow(getNoTwilioAccountMessage(TwilioMessageKind.Call));

    await SmsService.sendSms(new Phone(SG_RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
    });

    expect(sentFrom()).toEqual([SERVER_SMS_NUMBER]);
    expect(createCall).not.toHaveBeenCalled();
  });
});

describe("what the server's senders post", () => {
  let posted: Array<APIRequestOptions | unknown>;

  beforeEach(() => {
    posted = [];
    jest
      .spyOn(BlockedProjectNotifications, "getRefusal")
      .mockResolvedValue(null as never);
    jest.spyOn(API, "post").mockImplementation(((options: unknown) => {
      posted.push(options);
      return Promise.resolve(new HTTPResponse(200, {}, {}));
    }) as never);
  });

  function arrived(): JSONObject {
    return JSON.parse(
      JSON.stringify((posted[posted.length - 1] as { data: JSONObject }).data),
    ) as JSONObject;
  }

  test("a config used for SMS only arrives used for SMS only, and sends its SMS from its numbers", async () => {
    await CommonSmsService.sendSms(
      { to: new Phone(UK_RECIPIENT), message: "Incident created" },
      { projectId: PROJECT_ID, customTwilioConfig: smsOnlyConfig() },
    );

    const body: JSONObject = arrived();

    expect((body["customTwilioConfig"] as JSONObject)["use"]).toBe(
      TwilioConfigUse.SmsOnly,
    );
    expect(
      "primaryPhoneNumber" in (body["customTwilioConfig"] as JSONObject),
    ).toBe(false);

    expect(await callRoute(handlerOf("/send"), body)).toBeUndefined();
    expect(sentFrom()).toEqual([UK_MOBILE]);
  });

  test("a call posted with a config used for SMS only is placed through the server's account", async () => {
    await CommonCallService.makeCall(callTo(SG_RECIPIENT), {
      projectId: PROJECT_ID,
      customTwilioConfig: smsOnlyConfig(),
    });

    expect(await callRoute(handlerOf("/make-call"), arrived())).toBeUndefined();
    expect(calledFrom()).toEqual([SERVER_NUMBER]);
  });
});

describe("Send Test SMS and Send Test Call", () => {
  function storedConfig(use: TwilioConfigUse): ProjectCallSMSConfig {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    config.id = CONFIG_ID;
    config.projectId = PROJECT_ID;
    config.usedFor = use;
    config.twilioAccountSID = "AC00000000000000000000000000000001";
    config.twilioAuthToken = "auth-token";

    if (use === TwilioConfigUse.SmsOnly) {
      config.twilioSmsPhoneNumbers = SG_MOBILE;
    } else {
      config.twilioPrimaryPhoneNumber = new Phone(US_NUMBER);
    }

    return config;
  }

  function storedAs(use: TwilioConfigUse): void {
    jest
      .spyOn(ProjectCallSMSConfigService, "findOneById")
      .mockResolvedValue(storedConfig(use) as never);
  }

  function refusedWith(): Array<string> {
    return (
      Response.sendErrorResponse as unknown as Mock<
        (...args: Array<unknown>) => unknown
      >
    ).mock.calls.map((call: Array<unknown>): string => {
      return (call[2] as Error).message;
    });
  }

  function answered(): Array<unknown> {
    return (
      Response.sendJsonObjectResponse as unknown as Mock<
        (...args: Array<unknown>) => unknown
      >
    ).mock.calls.map((call: Array<unknown>): unknown => {
      return call[2];
    });
  }

  beforeEach(() => {
    (
      Response.sendErrorResponse as unknown as Mock<
        (...args: Array<unknown>) => unknown
      >
    ).mockClear();
    (
      Response.sendJsonObjectResponse as unknown as Mock<
        (...args: Array<unknown>) => unknown
      >
    ).mockClear();
  });

  test("the test SMS of a config used for SMS only goes out from its SMS number, needing no number to make calls from", async () => {
    storedAs(TwilioConfigUse.SmsOnly);

    expect(
      await callRoute(handlerOf("/test", 0), {
        callSMSConfigId: CONFIG_ID.toString(),
        toPhone: SG_RECIPIENT,
      }),
    ).toBeUndefined();

    expect(sentFrom()).toEqual([SG_MOBILE]);
    expect(refusedWith()).toEqual([]);
    expect(answered()).toEqual([
      { [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: SG_MOBILE },
    ]);
  });

  test("the test call of a config used for SMS only is refused, saying why, and nothing is called", async () => {
    storedAs(TwilioConfigUse.SmsOnly);

    await callRoute(handlerOf("/test", 1), {
      callSMSConfigId: CONFIG_ID.toString(),
      toPhone: SG_RECIPIENT,
    });

    expect(refusedWith()).toEqual([
      "This Twilio config is used for SMS only, so it makes no calls.",
    ]);
    expect(createCall).not.toHaveBeenCalled();
    expect(clientAccounts).toEqual([]);
  });

  test("the test SMS of a config used for calls only is refused, saying why, and nothing is sent", async () => {
    storedAs(TwilioConfigUse.CallsOnly);

    await callRoute(handlerOf("/test", 0), {
      callSMSConfigId: CONFIG_ID.toString(),
      toPhone: SG_RECIPIENT,
    });

    expect(refusedWith()).toEqual([
      "This Twilio config is used for calls only, so it sends no SMS.",
    ]);
    expect(createMessage).not.toHaveBeenCalled();
  });

  test("the test call of a config used for calls only goes out from its number", async () => {
    storedAs(TwilioConfigUse.CallsOnly);

    expect(
      await callRoute(handlerOf("/test", 1), {
        callSMSConfigId: CONFIG_ID.toString(),
        toPhone: SG_RECIPIENT,
      }),
    ).toBeUndefined();

    expect(calledFrom()).toEqual([US_NUMBER]);
    expect(answered()).toEqual([
      { [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: US_NUMBER },
    ]);
  });

  test("a config used for calls and SMS without a number is still refused for a missing number", async () => {
    const noNumber: ProjectCallSMSConfig = storedConfig(
      TwilioConfigUse.CallsAndSms,
    );
    delete (noNumber as unknown as Record<string, unknown>)[
      "twilioPrimaryPhoneNumber"
    ];
    jest
      .spyOn(ProjectCallSMSConfigService, "findOneById")
      .mockResolvedValue(noNumber as never);

    for (const index of [0, 1]) {
      await callRoute(handlerOf("/test", index), {
        callSMSConfigId: CONFIG_ID.toString(),
        toPhone: SG_RECIPIENT,
      });
    }

    expect(refusedWith()).toEqual([
      "twilioPrimaryPhoneNumber is required",
      "twilioPrimaryPhoneNumber is required",
    ]);
  });
});
