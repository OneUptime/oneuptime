import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import SignedWebhookPost from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CallRequest from "Common/Types/Call/CallRequest";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import API from "Common/Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import type { SpyInstance } from "jest-mock";
import Twilio from "twilio";

/*
 * HOW EVERY SMS AND CALL WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * SmsService and CallService run as they are; Twilio, the network and the
 * database are stood in for, and so is the metrics SDK, which keeps what it
 * is given. Each send is recorded once (notification.send.count and
 * .duration) with what it went out through - the server's own Twilio
 * account, a project's own, or the server's SMS and call gateway - and how
 * it went: accepted, refused, or deliberately not sent because of the
 * project's switches or balance, which a delivery success rate leaves out.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

// Twilio's client stood in for; its TwiML builder, which a call uses, as it is.
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    EXTERNAL_FAULT: {},
  };
});

// Billing per test, and a host Twilio could call back on.
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  mocked["Host"] = "oneuptime.example.com";

  return mocked;
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SMSDefaultCostInCents: 10,
    SMSHighRiskCostInCents: 10,
    CallDefaultCostInCentsPerMinute: 20,
    CallHighRiskCostInCentsPerMinute: 20,
    getTwilioConfig: jest.fn(),
    getCallAndSmsGateway: jest.fn(),
  };
});

import {
  getCallAndSmsGateway,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

const PROJECT_ID: ObjectID = new ObjectID(
  "66000000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66000000-0000-4000-8000-000000000002",
);

const GATEWAY: CallAndSmsGateway = {
  url: "https://sms-gateway.internal.example.com/oneuptime",
  secret: "5".repeat(64),
};

const SERVER_TWILIO: TwilioConfig = {
  accountSid: "AC-server",
  authToken: "server-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const PROJECT_TWILIO: TwilioConfig = {
  accountSid: "AC-project",
  authToken: "project-token",
  primaryPhoneNumber: new Phone("+14155550199"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550123");
const MESSAGE: string = "Incident Checkout down (Critical) on Site 03.";

function callRequest(): CallRequest {
  return {
    to: TO,
    data: [{ sayMessage: "A new incident has been created" }],
  };
}

let createMessage: jest.Mock;
let createCall: jest.Mock;
let post: SpyInstance<typeof API.post>;
let project: Project | null;

function onlySend(): Record<string, string> {
  expect(sendCounterCalls).toHaveLength(1);
  expect(sendDurationCalls).toHaveLength(1);
  expect(sendCounterCalls[0]!.value).toBe(1);
  expect(sendDurationCalls[0]!.value).toBeGreaterThanOrEqual(0);
  expect(sendDurationCalls[0]!.attributes).toEqual(
    sendCounterCalls[0]!.attributes,
  );

  return sendCounterCalls[0]!.attributes;
}

async function rejectionOf(promise: Promise<void>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  throw new Error("Expected the send to be rejected, but it resolved.");
}

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;
  setTestBillingEnabled(false);

  // A server that sends through Twilio unless a test gives it its gateway.
  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(
    null as never,
  );
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    SERVER_TWILIO as never,
  );

  createMessage = jest.fn().mockResolvedValue({
    status: "queued",
    sid: "SM-1",
  } as never) as unknown as jest.Mock;
  createCall = jest.fn().mockResolvedValue({
    sid: "CA-1",
    duration: "0",
  } as never) as unknown as jest.Mock;

  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });

  // API.post is generic, so its spy is typed by a cast.
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}) as never,
    ) as unknown as SpyInstance<typeof API.post>;
  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined as never);
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue(undefined as never);

  project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  project.lowCallAndSMSBalanceNotificationSentToOwners = true;
  project.notEnabledSmsOrCallNotificationSentToOwners = true;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(project);
  }) as never);
  jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockImplementation((() => {
      return Promise.resolve(project?.smsOrCallCurrentBalanceInUSDCents);
    }) as never);
  jest
    .spyOn(MessagingBalance, "shouldTellOwnersBalanceIsLow")
    .mockResolvedValue(false as never);
  jest
    .spyOn(MessagingBalance, "payForSentMessage")
    .mockResolvedValue(0 as never);

  jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
    data: SmsLog;
  }) => {
    data.data._id = ObjectID.generate().toString();
    return Promise.resolve(data.data);
  }) as never);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  // The send's result is written only while the log still says Sending.
  jest
    .spyOn(SmsLogService, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never);
  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    data.data._id = ObjectID.generate().toString();
    return Promise.resolve(data.data);
  }) as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  // An SMS page's notification, written Sending as its page went out.
  const timeline: OnCallTimelineRows = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomChannelActionToken, "getActionLinks")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an SMS", () => {
  test("Twilio accepted on the server's own account: a success through twilio, on the global account", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(onlySend()).toEqual({
      "notification.channel": "sms",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "false",
      outcome: "success",
    });
  });

  test("on the project's own Twilio account: counted as the project's", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_TWILIO,
    });

    expect(onlySend()).toMatchObject({
      "notification.provider": "twilio",
      "notification.provider.config": "project",
      outcome: "success",
    });
  });

  test("an on-call page says so", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(onlySend()["notification.on_call_page"]).toBe("true");
  });

  /*
   * How the SMS ended is counted on the same account as its send (issue
   * #6648): its status callback's address says whose account it went out on.
   */
  test("on the project's own Twilio account, its status callback says so", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_TWILIO,
    });

    // Read as an address, never by a piece of its text.
    const callback: globalThis.URL = new globalThis.URL(
      String((createMessage.mock.calls[0]![0] as JSONObject)["statusCallback"]),
    );

    expect(callback.host).toBe("oneuptime.example.com");
    expect(callback.pathname.split("/").slice(0, 4)).toEqual([
      "",
      "notification",
      "sms",
      "status-callback",
    ]);
    expect([...callback.searchParams.entries()]).toEqual([
      ["providerConfig", "project"],
    ]);
  });

  test("on the server's own account, its status callback's address is as it always was", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    const callback: globalThis.URL = new globalThis.URL(
      String((createMessage.mock.calls[0]![0] as JSONObject)["statusCallback"]),
    );

    expect(callback.host).toBe("oneuptime.example.com");
    expect(callback.pathname.split("/").slice(0, 4)).toEqual([
      "",
      "notification",
      "sms",
      "status-callback",
    ]);
    expect(callback.search).toBe("");
  });

  test("through the server's own gateway: counted under the gateway, not Twilio", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(
      GATEWAY as never,
    );

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(createMessage).not.toHaveBeenCalled();
    expect(onlySend()).toMatchObject({
      "notification.provider": "sms_and_call_gateway",
      "notification.provider.config": "global",
      outcome: "success",
    });
  });

  test("Twilio refused it: a failure through twilio, and the send still throws", async () => {
    createMessage.mockRejectedValue(
      Object.assign(new Error("The 'To' number is not a valid phone number."), {
        code: 21211,
      }) as never,
    );

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(onlySend()).toMatchObject({
      "notification.provider": "twilio",
      outcome: "failure",
    });
  });

  test("Twilio answered with a status that already failed: a failure", async () => {
    createMessage.mockResolvedValue({ status: "failed", sid: "SM-2" } as never);

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(onlySend()["outcome"]).toBe("failure");
  });

  test("the gateway refused it: a failure through the gateway", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(
      GATEWAY as never,
    );
    post.mockResolvedValue(
      new HTTPErrorResponse(503, { message: "busy" }, {}) as never,
    );

    await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect(onlySend()).toMatchObject({
      "notification.provider": "sms_and_call_gateway",
      outcome: "failure",
    });
  });

  test("no account to send it through: a failure, handed to no provider", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(null as never);

    await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect(onlySend()).toMatchObject({
      "notification.provider": "none",
      outcome: "failure",
    });
  });

  test("the project turned SMS off: not sent - the setting working, not the platform failing", async () => {
    project!.enableSmsNotifications = false;

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(createMessage).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("the project's balance cannot pay for it: not sent", async () => {
    setTestBillingEnabled(true);
    project!.smsOrCallCurrentBalanceInUSDCents = 0;

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(createMessage).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("not sent for a caller that asked to be told: it throws, and is still counted as not sent", async () => {
    project!.enableSmsNotifications = false;

    await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, {
        projectId: PROJECT_ID,
        failIfNotSent: true,
      }),
    );

    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("the project cannot be found: not sent", async () => {
    project = null;

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(onlySend()["outcome"]).toBe("not_sent");
  });
});

describe("a call", () => {
  test("Twilio placed it on the server's own account: a success through twilio", async () => {
    await CallService.makeCall(callRequest(), { projectId: PROJECT_ID });

    expect(onlySend()).toEqual({
      "notification.channel": "call",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "false",
      outcome: "success",
    });
  });

  test("on the project's own Twilio account: counted as the project's", async () => {
    await CallService.makeCall(callRequest(), {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_TWILIO,
    });

    expect(onlySend()).toMatchObject({
      "notification.provider": "twilio",
      "notification.provider.config": "project",
    });
  });

  test("through the server's own gateway: counted under the gateway", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(
      GATEWAY as never,
    );

    await CallService.makeCall(callRequest(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(createCall).not.toHaveBeenCalled();
    expect(onlySend()).toMatchObject({
      "notification.channel": "call",
      "notification.provider": "sms_and_call_gateway",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("Twilio refused it: a failure, and the call still throws", async () => {
    createCall.mockRejectedValue(new Error("Account suspended.") as never);

    await rejectionOf(
      CallService.makeCall(callRequest(), { projectId: PROJECT_ID }),
    );

    expect(onlySend()).toMatchObject({
      "notification.provider": "twilio",
      outcome: "failure",
    });
  });

  test("the project turned calls off: not sent", async () => {
    project!.enableCallNotifications = false;

    await CallService.makeCall(callRequest(), { projectId: PROJECT_ID });

    expect(createCall).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("the project's balance cannot pay for it: not sent, even for a caller that asked to be told", async () => {
    setTestBillingEnabled(true);
    project!.smsOrCallCurrentBalanceInUSDCents = 0;

    await rejectionOf(
      CallService.makeCall(callRequest(), {
        projectId: PROJECT_ID,
        failIfNotSent: true,
      }),
    );

    expect(onlySend()["outcome"]).toBe("not_sent");
  });
});
