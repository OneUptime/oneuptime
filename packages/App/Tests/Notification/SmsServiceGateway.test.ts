import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import SignedWebhookPost from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import { CustomChannelActionLinks } from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import {
  MAX_SMS_LENGTH,
  TRUNCATED_TEXT_NOTE_PLAIN,
} from "Common/Utils/MessageFit";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import Twilio from "twilio";

/*
 * AN SMS ON A SERVER THAT SENDS THROUGH ITS OWN GATEWAY, END TO END.
 *
 * SmsService, CallAndSmsGatewayService and SignedWebhookPost run as they
 * are; only the network, the database and Twilio's client are stood in for.
 * Whenever no Twilio config of the project's own applies, and the server is
 * set to its own gateway, the SMS is posted to the gateway - one signed
 * request carrying the number, the message as written, its id (the SMS
 * log's), the project, whether it is sensitive and, for an on-call page,
 * the links that act on it - and Twilio is never touched: no client, no
 * account read, no number to send from, no delivery callback. The SMS log
 * and the on-call log say it was sent to the gateway, or why it was not;
 * the project's switches and balance are checked first, as for Twilio.
 */

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
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
    // An SMS costs 10 cents a part on the server's own account.
    SMSDefaultCostInCents: 10,
    SMSHighRiskCostInCents: 10,
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
  "6a7e0000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "6a7e0000-0000-4000-8000-000000000002",
);

const GATEWAY: CallAndSmsGateway = {
  url: "https://sms-gateway.internal.example.com/oneuptime",
  secret: "5".repeat(64),
};

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const ACTIONS: CustomChannelActionLinks = {
  acknowledge:
    "https://oneuptime.example.com/api/custom-notification-channel/page/n/acknowledge?token=t",
  escalate:
    "https://oneuptime.example.com/api/custom-notification-channel/page/n/escalate?token=t",
  resolve:
    "https://oneuptime.example.com/api/custom-notification-channel/page/n/resolve?token=t",
};

const TO: Phone = new Phone("+15555550123");
const MESSAGE: string = "Incident Checkout down (Critical) on Site 03.";
const SENT: string = "Sent to the SMS and call gateway (HTTP 200).";

let post: jest.SpyInstance;
let ssrf: jest.SpyInstance;
let createMessage: jest.Mock;
let project: Project | null;
let smsLogs: Array<SmsLog>;
let smsLogUpdates: Array<Record<string, unknown>>;
let timelineUpdates: Array<Record<string, unknown>>;
let actionLinks: jest.SpyInstance;
let pay: jest.SpyInstance;

function ok(status: number = 200): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(status, {}, {});
}

function refused(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "nope" }, {});
}

// What the gateway was posted, request by request.
function posted(): Array<{
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}> {
  return post.mock.calls.map((call: Array<unknown>) => {
    const request: Record<string, unknown> = call[0] as Record<string, unknown>;

    return {
      url: String(request["url"]),
      data: request["data"] as JSONObject,
      headers: request["headers"] as Record<string, string>,
    };
  });
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
  setTestBillingEnabled(false);

  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(TWILIO_CONFIG);

  createMessage = jest.fn().mockResolvedValue({
    status: "queued",
    sid: "SM-1",
  });
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { messages: { create: createMessage } };
  });

  post = jest.spyOn(API, "post").mockResolvedValue(ok());
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();

  project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableSmsNotifications = true;
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
    .mockResolvedValue(false);
  pay = jest.spyOn(MessagingBalance, "payForSentMessage").mockResolvedValue(0);

  smsLogs = [];
  smsLogUpdates = [];
  timelineUpdates = [];

  jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
    data: SmsLog;
  }) => {
    const row: SmsLog = data.data;
    row._id = ObjectID.generate().toString();
    // A copy, as the row was when it was written.
    smsLogs.push(Object.assign(new SmsLog(), row));
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(((data: Record<string, unknown>) => {
      smsLogUpdates.push(data);
      return Promise.resolve();
    }) as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockImplementation(((data: Record<string, unknown>) => {
      timelineUpdates.push(data);
      return Promise.resolve();
    }) as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);

  actionLinks = jest
    .spyOn(CustomChannelActionToken, "getActionLinks")
    .mockResolvedValue(ACTIONS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectTwilioUntouched(): void {
  expect(Twilio).not.toHaveBeenCalled();
  expect(createMessage).not.toHaveBeenCalled();
  expect(getTwilioConfig).not.toHaveBeenCalled();
}

describe("an SMS through the server's own gateway", () => {
  test("is posted to the gateway, once, and Twilio is never touched", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(getCallAndSmsGateway).toHaveBeenCalledTimes(1);
    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.url).toBe(GATEWAY.url);
    expectTwilioUntouched();
  });

  test("carries the number, the message, the SMS log's id and the project, signed with the gateway's secret", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    const request: {
      url: string;
      data: JSONObject;
      headers: Record<string, string>;
    } = posted()[0]!;

    expect(smsLogs).toHaveLength(1);
    expect(request.data).toEqual({
      version: 1,
      event: "sms",
      id: smsLogs[0]!.id!.toString(),
      sentAt: expect.any(String),
      to: "+15555550123",
      message: MESSAGE,
      isSensitive: false,
      project: { id: PROJECT_ID.toString(), name: "Acme" },
      actions: null,
    });
    expect(
      Math.abs(Date.parse(request.data["sentAt"] as string) - Date.now()),
    ).toBeLessThan(60_000);
    expect(request.headers["X-OneUptime-Event"]).toBe("sms");
    expect(request.headers["User-Agent"]).toBe(
      "OneUptime-CallAndSmsGateway/1.0",
    );
    expect(request.headers["X-OneUptime-Signature"]).toBe(
      `sha256=${crypto
        .createHmac("sha256", GATEWAY.secret)
        .update(JSON.stringify(request.data))
        .digest("hex")}`,
    );
  });

  test("the gateway's URL is checked before it is posted to, the private network allowed", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(ssrf).toHaveBeenCalledWith(GATEWAY.url, {
      allowPrivateNetworkTargets: true,
    });
  });

  test("the SMS log says it was sent to the gateway, with no number it went out from and no delivery callback", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    const row: SmsLog = smsLogs[0]!;

    expect(row.status).toBe(SmsStatus.Sending);
    expect(row.statusCallbackToken).toBeUndefined();
    expect(row.fromNumber).toBeUndefined();
    expect(row.toNumber?.toString()).toBe("+15555550123");
    expect(row.smsText).toBe(MESSAGE);

    expect(smsLogUpdates).toHaveLength(1);
    expect(smsLogUpdates[0]).toEqual({
      id: row.id,
      data: {
        status: SmsStatus.Sent,
        statusMessage: SENT,
        smsCostInUSDCents: 0,
      },
    });
  });

  test("without a project, nothing is logged and the request gets an id of its own", async () => {
    await SmsService.sendSms(TO, MESSAGE, {});

    const data: JSONObject = posted()[0]!.data;

    expect(smsLogs).toHaveLength(0);
    expect(ObjectID.isValidUUID(data["id"] as string)).toBe(true);
    expect(data["project"]).toBeNull();
    expectTwilioUntouched();
  });

  test("a verification code is marked sensitive, goes to the gateway as written, and stays out of the log", async () => {
    await SmsService.sendSms(TO, "Your OneUptime verification code is 482913", {
      projectId: PROJECT_ID,
      isSensitive: true,
    });

    const data: JSONObject = posted()[0]!.data;

    expect(data["isSensitive"]).toBe(true);
    expect(data["message"]).toBe("Your OneUptime verification code is 482913");
    expect(smsLogs[0]!.smsText).toBe(
      "This message is sensitive and is not logged",
    );
  });

  test("an SMS longer than an SMS can be is cut before the gateway gets it, as for Twilio", async () => {
    await SmsService.sendSms(TO, "word ".repeat(1000), {
      projectId: PROJECT_ID,
    });

    const message: string = posted()[0]!.data["message"] as string;

    expect(message.length).toBeLessThanOrEqual(MAX_SMS_LENGTH);
    expect(message.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
  });
});

describe("an on-call page through the gateway", () => {
  test("carries the links that acknowledge, escalate and resolve it, for this one notification", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(actionLinks).toHaveBeenCalledTimes(1);
    expect(actionLinks).toHaveBeenCalledWith(TIMELINE_ID);
    expect(posted()[0]!.data["actions"]).toEqual({
      acknowledge: ACTIONS.acknowledge,
      escalate: ACTIONS.escalate,
      resolve: ACTIONS.resolve,
    });
  });

  test("the person's on-call log says it was sent to the gateway", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(timelineUpdates).toEqual([
      {
        data: { status: UserNotificationStatus.Sent, statusMessage: SENT },
        id: TIMELINE_ID,
        props: { isRoot: true },
      },
    ]);
    expect(smsLogs[0]!.userOnCallLogTimelineId?.toString()).toBe(
      TIMELINE_ID.toString(),
    );
  });

  test("a message that pages nobody carries no links, and none are made", async () => {
    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(actionLinks).not.toHaveBeenCalled();
    expect(posted()[0]!.data["actions"]).toBeNull();
  });
});

describe("an SMS the gateway does not take", () => {
  test("a gateway that keeps failing: the send fails with why, as the tenant's setup, and nothing is paid", async () => {
    setTestBillingEnabled(true);
    post.mockResolvedValue(refused(503));

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    );

    const reason: string =
      "Not delivered: the SMS and call gateway answered HTTP 503 (tried 3 times).";

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(reason);
    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: true,
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(smsLogUpdates[0]).toMatchObject({
      data: {
        status: SmsStatus.Error,
        statusMessage: reason,
        smsCostInUSDCents: 0,
      },
    });
    expect(timelineUpdates[0]).toMatchObject({
      data: { status: UserNotificationStatus.Error, statusMessage: reason },
    });
    expect(pay).not.toHaveBeenCalled();
    expectTwilioUntouched();
  });

  test("a gateway that refuses it is not asked again, and the log says what it answered", async () => {
    post.mockResolvedValue(refused(401));

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toBe(
      "Not delivered: the SMS and call gateway answered HTTP 401.",
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(smsLogUpdates[0]).toMatchObject({
      data: { status: SmsStatus.Error },
    });
  });

  test("a gateway that cannot be reached", async () => {
    post.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:443"));

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toBe(
      "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
    );
    expectTwilioUntouched();
  });

  test("a gateway whose URL is refused is not posted to", async () => {
    ssrf.mockRejectedValue(new BadDataException("blocked address"));

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toBe(
      "Not delivered: the URL of the SMS and call gateway is not allowed. Your administrator can see why in the server's log.",
    );
    expect(post).not.toHaveBeenCalled();
    expectTwilioUntouched();
  });

  test("nothing the project's members read names the gateway's URL", async () => {
    post.mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND sms-gateway.internal.example.com"),
    );

    await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    );

    for (const written of [...smsLogUpdates, ...timelineUpdates, ...smsLogs]) {
      expect(JSON.stringify(written)).not.toContain(
        "sms-gateway.internal.example.com",
      );
    }
  });

  test("a read of the gateway that fails fails the SMS, rather than sending it through Twilio after all", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockRejectedValue(
      new Error("connection terminated"),
    );

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toBe("connection terminated");
    expect(post).not.toHaveBeenCalled();
    expectTwilioUntouched();
  });
});

describe("the project's switches and balance, checked first as for Twilio", () => {
  test("SMS off in the project: not sent to the gateway either", async () => {
    project!.enableSmsNotifications = false;

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(post).not.toHaveBeenCalled();
    expect(smsLogs[0]!.status).toBe(SmsStatus.Error);
    expectTwilioUntouched();
  });

  test("too little balance where billing is on: not sent to the gateway either", async () => {
    setTestBillingEnabled(true);
    project!.smsOrCallCurrentBalanceInUSDCents = 0;

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(post).not.toHaveBeenCalled();
    expect(smsLogs[0]!.status).toBe(SmsStatus.LowBalance);
  });

  test("where billing is on, an SMS the gateway took is paid for, as one through the server's account", async () => {
    setTestBillingEnabled(true);

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      costInUSDCents: 10,
    });
    expect(smsLogUpdates[0]).toMatchObject({
      data: { status: SmsStatus.Sent, smsCostInUSDCents: 10 },
    });
  });

  test("a project that no longer exists fails when the caller asks, before the gateway is posted to", async () => {
    project = null;

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, MESSAGE, {
        projectId: PROJECT_ID,
        failIfNotSent: true,
      }),
    );

    expect((error as Error).message).toBe(
      `SMS not sent: Project ${PROJECT_ID.toString()} not found.`,
    );
    expect(post).not.toHaveBeenCalled();
  });
});

describe("what goes through Twilio still does", () => {
  test("the project's own Twilio config is used as before, and the gateway is not even asked", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    expect(getCallAndSmsGateway).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(
      String((createMessage.mock.calls[0]![0] as JSONObject)["from"]),
    ).toBe("+14155550100");
  });

  test("a project config used for calls only sends no SMS: this one goes through the server's gateway", async () => {
    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      customTwilioConfig: {
        ...TWILIO_CONFIG,
        use: TwilioConfigUse.CallsOnly,
      },
    });

    expect(getCallAndSmsGateway).toHaveBeenCalledTimes(1);
    expect(posted()).toHaveLength(1);
    expectTwilioUntouched();
  });

  test("a server without a gateway sends through its Twilio account, with a delivery callback, as before", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);

    await SmsService.sendSms(TO, MESSAGE, { projectId: PROJECT_ID });

    expect(post).not.toHaveBeenCalled();
    expect(getTwilioConfig).toHaveBeenCalledTimes(1);
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(smsLogs[0]!.statusCallbackToken).toBeTruthy();
    expect(smsLogs[0]!.fromNumber?.toString()).toBe("+14155550100");
    expect(
      String((createMessage.mock.calls[0]![0] as JSONObject)["statusCallback"]),
    ).toContain("/notification/sms/status-callback/");
  });
});
