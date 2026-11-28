import { mockRouter } from "Common/Tests/Server/API/Helpers";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * TWILIO'S SIGNATURES STAY CHECKED FOR CALLS PLACED IN ANOTHER LANGUAGE
 * (#11461).
 *
 * The verification call and Send Test Call are now placed in the person's
 * language, by a voice of it. Twilio still tells how such a call ended at
 * its status callback, a public webhook held to two locks (#9979): the
 * per-call token in its URL, and Twilio's signature by the account the
 * call went out on. Here the call is placed by the real UserCallService and
 * Notification CallService - in German, through the server's account, and
 * in Japanese, through a project's own config - and Twilio's callback is
 * posted to the real route at the URL the call named, as Twilio signs it:
 * signed by the right account it is taken; unsigned, signed by another
 * auth token or with another call's token it is refused, and nothing is
 * written. The database is stood in for.
 */

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationDeliveryCounter: () => {
        return { add: (): void => {} };
      },
      getNotificationDeliveryDuration: () => {
        return { record: (): void => {} };
      },
      getNotificationSendCounter: () => {
        return { add: (): void => {} };
      },
      getNotificationSendDuration: () => {
        return { record: (): void => {} };
      },
    },
  };
});

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
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
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

// Twilio's client is stood in for; its TwiML builder and its signatures are its own.
jest.mock("twilio", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "twilio",
  ) as Record<string, unknown>;
  const client: ((...args: Array<unknown>) => unknown) & {
    twiml?: unknown;
  } = jest.fn();
  client.twiml = actual["twiml"];

  return {
    __esModule: true,
    default: client,
    validateRequest: actual["validateRequest"],
    getExpectedTwilioSignature: actual["getExpectedTwilioSignature"],
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
    IsBillingEnabled: false,
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    getTwilioConfig: jest.fn(),
    getCallAndSmsGateway: jest.fn(),
  };
});

import CallService from "../../FeatureSet/Notification/Services/CallService";
import {
  getCallAndSmsGateway,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";
import "../../FeatureSet/Notification/API/Call";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import CommonCallService from "Common/Server/Services/CallService";
import CallLogService from "Common/Server/Services/CallLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserCallService from "Common/Server/Services/UserCallService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import getCallInLanguage from "Common/Server/Utils/Call/CallInLanguage";
import UserLanguage from "Common/Server/Utils/Notification/UserLanguage";
import Response from "Common/Server/Utils/Response";
import {
  serverTwilioRow,
  signedTwilioRequest,
} from "Common/Tests/Server/TestingUtils/TwilioSignedRequests";
import CallRequest from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { Translator } from "Common/Types/Translator";
import { getProjectTestCallData } from "Common/Utils/Call/TestCall";
import Twilio from "twilio";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  handlerFunction: RouterFunction;
}

const STATUS_CALLBACK: RegisteredRoute | undefined = (
  mockRouter.routes as unknown as Array<RegisteredRoute>
).find((route: RegisteredRoute): boolean => {
  return (
    route.method === "POST" &&
    route.uri === "/status-callback/:callLogId/:token"
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "0fa11461-0000-4000-8000-0000000000a1",
);
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";
const TO: Phone = new Phone("+15555550142");

// The OneUptime server's own account, with the voice its admin chose.
const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
  callVoice: "Polly.Joanna-Neural",
};

// A Twilio config of the project's own, with a voice of its own.
const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: "AC22222222222222222222222222222222",
  authToken: "project-auth-token-000000000000002",
  primaryPhoneNumber: new Phone("+14155550199"),
  secondaryPhoneNumbers: [],
  callVoice: "Polly.Matthew-Neural",
};

let createCall: jest.Mock;
let callLogs: Array<CallLog>;
let writeCallLog: jest.SpyInstance;

beforeEach(() => {
  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(SERVER_ACCOUNT);

  createCall = jest.fn().mockResolvedValue({ sid: CALL_SID, duration: "0" });
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { calls: { create: createCall } };
  });

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme Production";
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(project);
  }) as never);
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(10000 as never);
  jest
    .spyOn(MessagingBalance, "shouldTellOwnersBalanceIsLow")
    .mockResolvedValue(false);
  jest.spyOn(MessagingBalance, "payForSentMessage").mockResolvedValue(0);

  callLogs = [];
  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    callLogs.push(data.data);
    return Promise.resolve(data.data);
  }) as never);

  // The call's log, as the route reads it back.
  jest.spyOn(CallLogService, "findOneById").mockImplementation((() => {
    return Promise.resolve(callLogs[0] || null);
  }) as never);
  writeCallLog = jest
    .spyOn(CallLogService, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never);

  // The accounts a signature is checked against: the server's, and the project's own.
  jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockResolvedValue(serverTwilioRow(SERVER_ACCOUNT) as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "findBy")
    .mockResolvedValue([] as never);

  (Response.sendEmptySuccessResponse as unknown as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The German verification call, written by UserCallService and placed through the server's account.
async function placeGermanVerificationCall(): Promise<JSONObject> {
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("de");
  const makeCall: jest.SpyInstance = jest
    .spyOn(CommonCallService, "makeCall")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);

  const userCall: UserCall = new UserCall();
  userCall.phone = TO;
  userCall.projectId = PROJECT_ID;
  userCall.userId = ObjectID.generate();

  await UserCallService.sendVerificationCode(userCall, "048291");

  const [callRequest, options] = makeCall.mock.calls[0] as [
    CallRequest,
    JSONObject,
  ];

  expect(callRequest.inLanguage?.language).toBe("de");

  await CallService.makeCall(callRequest, {
    projectId: PROJECT_ID,
    isSensitive: options["isSensitive"] as boolean,
  });

  return createCall.mock.calls[0]![0] as JSONObject;
}

interface Answer {
  status: jest.Mock;
  next: jest.Mock;
}

// Twilio posting how the call ended to the URL the call named, signed (or not).
async function callback(data: {
  url: string;
  account: TwilioConfig;
  signedWith: string | null;
}): Promise<Answer> {
  const path: string = new globalThis.URL(data.url).pathname;
  const [callLogId, token] = path.split("/").slice(-2) as [string, string];

  const request: ReturnType<typeof signedTwilioRequest> = signedTwilioRequest({
    publicUrl: data.url,
    body: {
      AccountSid: data.account.accountSid,
      CallSid: CALL_SID,
      CallStatus: "completed",
      CallDuration: "12",
    },
    signedWith: data.signedWith,
    params: { callLogId: callLogId, token: token },
  });

  const status: jest.Mock = jest.fn();
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: status,
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);
  const next: jest.Mock = jest.fn();

  await STATUS_CALLBACK!.handlerFunction(
    request as unknown as ExpressRequest,
    res,
    next as unknown as NextFunction,
  );

  return { status: status, next: next };
}

function expectRefused(answer: Answer): void {
  expect(answer.status).toHaveBeenCalledWith(403);
  expect(writeCallLog).not.toHaveBeenCalled();
  expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
}

describe("the status callback route", () => {
  test("is registered", () => {
    expect(STATUS_CALLBACK).toBeDefined();
  });
});

describe("the verification call, placed in German through the server's account", () => {
  test("names its own status callback, with its log's token, as every call does", async () => {
    const created: JSONObject = await placeGermanVerificationCall();
    const log: CallLog = callLogs[0]!;

    expect(String(created["twiml"])).toContain(
      'voice="Polly.Vicki-Neural" language="de-DE"',
    );
    expect(String(created["statusCallback"])).toContain(
      `/notification/call/status-callback/${log.id!.toString()}/${log.statusCallbackToken}`,
    );
    expect(log.status).toBe(CallStatus.Calling);
  });

  test("Twilio's callback, signed by the server's account: taken, and how the call ended written", async () => {
    const created: JSONObject = await placeGermanVerificationCall();

    const answer: Answer = await callback({
      url: String(created["statusCallback"]),
      account: SERVER_ACCOUNT,
      signedWith: SERVER_ACCOUNT.authToken,
    });

    expect(answer.status).not.toHaveBeenCalledWith(403);
    expect(answer.next).not.toHaveBeenCalled();
    expect(writeCallLog).toHaveBeenCalledTimes(1);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("unsigned: refused, and nothing written", async () => {
    const created: JSONObject = await placeGermanVerificationCall();

    expectRefused(
      await callback({
        url: String(created["statusCallback"]),
        account: SERVER_ACCOUNT,
        signedWith: null,
      }),
    );
  });

  test("signed with another auth token: refused, and nothing written", async () => {
    const created: JSONObject = await placeGermanVerificationCall();

    expectRefused(
      await callback({
        url: String(created["statusCallback"]),
        account: SERVER_ACCOUNT,
        signedWith: "an-auth-token-of-nobody-0000000000",
      }),
    );
  });

  test("signed, but with another call's token in the URL: refused before the signature is looked at", async () => {
    const created: JSONObject = await placeGermanVerificationCall();
    const url: string = String(created["statusCallback"]).replace(
      callLogs[0]!.statusCallbackToken!,
      "00000000-0000-4000-8000-000000000000",
    );

    expectRefused(
      await callback({
        url: url,
        account: SERVER_ACCOUNT,
        signedWith: SERVER_ACCOUNT.authToken,
      }),
    );
  });
});

describe("a project's Send Test Call, placed in Japanese through its own config", () => {
  async function placeJapaneseTestCall(): Promise<JSONObject> {
    const callRequest: CallRequest = {
      to: TO,
      data: getProjectTestCallData(),
    };
    callRequest.inLanguage = getCallInLanguage(
      "ja",
      (translator: Translator): CallRequest["data"] => {
        return getProjectTestCallData(translator);
      },
    );

    await CallService.makeCall(callRequest, {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_ACCOUNT,
      failIfNotSent: true,
    });

    return createCall.mock.calls[0]![0] as JSONObject;
  }

  beforeEach(() => {
    const row: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    row.projectId = PROJECT_ID;
    row.twilioAccountSID = PROJECT_ACCOUNT.accountSid;
    row.twilioAuthToken = PROJECT_ACCOUNT.authToken;

    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockResolvedValue([row] as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "toTwilioConfig")
      .mockReturnValue(PROJECT_ACCOUNT);
  });

  test("is said in Japanese by the config's voice's kind, and signed by the project's account it is taken", async () => {
    const created: JSONObject = await placeJapaneseTestCall();

    expect(String(created["twiml"])).toContain(
      'voice="Polly.Takumi-Neural" language="ja-JP"',
    );

    const answer: Answer = await callback({
      url: String(created["statusCallback"]),
      account: PROJECT_ACCOUNT,
      signedWith: PROJECT_ACCOUNT.authToken,
    });

    expect(answer.status).not.toHaveBeenCalledWith(403);
    expect(writeCallLog).toHaveBeenCalledTimes(1);
  });

  test("unsigned, or signed with another token: refused, and nothing written", async () => {
    const created: JSONObject = await placeJapaneseTestCall();

    expectRefused(
      await callback({
        url: String(created["statusCallback"]),
        account: PROJECT_ACCOUNT,
        signedWith: null,
      }),
    );
    expectRefused(
      await callback({
        url: String(created["statusCallback"]),
        account: PROJECT_ACCOUNT,
        signedWith: "an-auth-token-of-nobody-0000000000",
      }),
    );
  });
});
