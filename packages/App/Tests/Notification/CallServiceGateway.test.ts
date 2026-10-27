import CallService, {
  getCallGatewayMessage,
} from "../../FeatureSet/Notification/Services/CallService";
import SignedWebhookPost from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import CallRequest, { GatherInput, Say } from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import { CustomChannelActionLinks } from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * A CALL ON A SERVER THAT SENDS THROUGH ITS OWN GATEWAY, END TO END.
 *
 * CallService, CallAndSmsGatewayService and SignedWebhookPost run as
 * they are; only the network, the database and Twilio's client are stood
 * in for. Whenever no Twilio config of the project's own applies, and the
 * server is set to its own gateway, the call is posted to the gateway,
 * described rather than scripted: what it says - its spoken sentences in
 * order, each ended as one, without Twilio's "press 1" - and, for an
 * on-call page, the links that act on it, which the gateway offers its own
 * way. Twilio is never touched. The call log and the on-call log say it
 * was sent to the gateway, or why it was not, and a call the gateway took
 * is paid for as one minute where billing is on - a gateway does not say
 * how long a call took.
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

// Billing per test: CI's config.env turns it on, a local run has it off.
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    // A minute of a call costs 20 cents on the server's own account.
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
  "6c0e0000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-000000000002",
);

const GATEWAY: CallAndSmsGateway = {
  url: "https://voice-gateway.internal.example.com/oneuptime",
  secret: "7".repeat(64),
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

const TO: Phone = new Phone("+15555550142");
const SENT: string = "Sent to the SMS and call gateway (HTTP 200).";

// A sentence a call already ends, as getCallGatewayMessage reads it.
const ENDS_A_SENTENCE: RegExp = /[.!?]$/;

const PRESS_ONE: string =
  "To acknowledge this incident, press 1. If you cannot take it, press 2.";

function gather(): GatherInput {
  return {
    introMessage: PRESS_ONE,
    numDigits: 1,
    timeoutInSeconds: 10,
    noInputMessage: "You have not entered any input. Good bye",
    onInputCallRequest: {
      "1": { sayMessage: "You have acknowledged this incident. Good bye" },
      default: { sayMessage: "Invalid input. Good bye" },
    },
    responseUrl: URL.fromString(
      "https://oneuptime.example.com/notification/call/acknowledge",
    ),
  };
}

// An on-call page, as UserNotificationRuleService builds one.
function pageCall(): CallRequest {
  return {
    to: TO,
    data: [
      { sayMessage: "This is a call from OneUptime" },
      { sayMessage: "A new incident has been created" },
      { sayMessage: "Checkout down on Site 03" },
      gather(),
    ],
  };
}

let post: jest.SpyInstance;
let ssrf: jest.SpyInstance;
let createCall: jest.Mock;
let project: Project | null;
let callLogs: Array<CallLog>;
let timelineUpdates: Array<Record<string, unknown>>;
let actionLinks: jest.SpyInstance;
let pay: jest.SpyInstance;

function ok(status: number = 200): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(status, {}, {});
}

function refused(status: number): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: "nope" }, {});
}

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

  throw new Error("Expected the call to be rejected, but it resolved.");
}

function expectTwilioUntouched(): void {
  expect(Twilio).not.toHaveBeenCalled();
  expect(createCall).not.toHaveBeenCalled();
  expect(getTwilioConfig).not.toHaveBeenCalled();
}

beforeEach(() => {
  setTestBillingEnabled(false);

  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(TWILIO_CONFIG);

  createCall = jest.fn().mockResolvedValue({ sid: "CA-1", duration: "0" });
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { calls: { create: createCall } };
  });

  post = jest.spyOn(API, "post").mockResolvedValue(ok());
  ssrf = jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();

  project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
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
    .mockResolvedValue(false);
  pay = jest.spyOn(MessagingBalance, "payForSentMessage").mockResolvedValue(0);

  callLogs = [];
  timelineUpdates = [];

  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    callLogs.push(data.data);
    return Promise.resolve(data.data);
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

describe("getCallGatewayMessage: what a call says, for a gateway that makes it", () => {
  test("its spoken sentences in order, each ended as one, joined by spaces", () => {
    expect(getCallGatewayMessage(pageCall())).toBe(
      "This is a call from OneUptime. A new incident has been created. Checkout down on Site 03.",
    );
  });

  test("Twilio's keypad prompt and the answers to a key press are left out", () => {
    const message: string = getCallGatewayMessage(pageCall());

    expect(message).not.toContain("press 1");
    expect(message).not.toContain("press 2");
    expect(message).not.toContain("Good bye");
    expect(message).not.toContain("acknowledged");
    expect(message).not.toContain("Invalid input");
  });

  test("a sentence already ended with a full stop, a question mark or an exclamation mark is kept as it is", () => {
    expect(
      getCallGatewayMessage({
        to: TO,
        data: [
          { sayMessage: "Incident #42 is critical." },
          { sayMessage: "Can you take it?" },
          { sayMessage: "Act now!" },
          { sayMessage: "Thank you" },
        ],
      }),
    ).toBe("Incident #42 is critical. Can you take it? Act now! Thank you.");
  });

  test("the spaces around a sentence are dropped, and a blank sentence is skipped", () => {
    expect(
      getCallGatewayMessage({
        to: TO,
        data: [
          { sayMessage: "   Incident created   " },
          { sayMessage: "" },
          { sayMessage: " \n\t " },
          { sayMessage: "\nCheckout down\n" },
        ],
      }),
    ).toBe("Incident created. Checkout down.");
  });

  test("an item whose message is not text is skipped", () => {
    expect(
      getCallGatewayMessage({
        to: TO,
        data: [
          { sayMessage: 42 } as unknown as Say,
          { sayMessage: null } as unknown as Say,
          { sayMessage: { text: "x" } } as unknown as Say,
          { sayMessage: "Checkout down" },
        ],
      }),
    ).toBe("Checkout down.");
  });

  test("a call with nothing to say says nothing", () => {
    expect(getCallGatewayMessage({ to: TO, data: [] })).toBe("");
    expect(getCallGatewayMessage({ to: TO, data: [gather()] })).toBe("");
    expect(
      getCallGatewayMessage({
        to: TO,
        data: undefined as unknown as CallRequest["data"],
      }),
    ).toBe("");
  });

  test("for calls of every shape: the spoken sentences alone, in order, each ended as one", () => {
    const random: SeededRandom = seededRandom(1234);
    const words: Array<string> = [
      "Incident",
      "#42",
      "Checkout",
      "down",
      "Site 03",
      "critical",
      "é",
      "📟",
    ];
    const endings: Array<string> = ["", ".", "?", "!", " ", ",", ":"];

    for (let index: number = 0; index < 500; index++) {
      const data: Array<Say | GatherInput> = [];
      const expected: Array<string> = [];
      const items: number = random(8);

      for (let item: number = 0; item < items; item++) {
        if (random(4) === 0) {
          data.push(gather());
          continue;
        }

        let sentence: string = random(6) === 0 ? "  " : "";
        const length: number = random(5);

        for (let word: number = 0; word < length; word++) {
          sentence += `${words[random(words.length)]} `;
        }

        sentence += endings[random(endings.length)];
        data.push({ sayMessage: sentence });

        const trimmed: string = sentence.trim();

        if (trimmed) {
          expected.push(
            ENDS_A_SENTENCE.test(trimmed) ? trimmed : `${trimmed}.`,
          );
        }
      }

      const message: string = getCallGatewayMessage({ to: TO, data: data });

      expect({ data, message }).toEqual({ data, message: expected.join(" ") });
      expect(message).not.toContain("press 1");
    }
  });
});

describe("a call through the server's own gateway", () => {
  test("is posted to the gateway, once, and Twilio is never touched", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(getCallAndSmsGateway).toHaveBeenCalledTimes(1);
    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.url).toBe(GATEWAY.url);
    expect(ssrf).toHaveBeenCalledWith(GATEWAY.url, {
      allowPrivateNetworkTargets: true,
    });
    expectTwilioUntouched();
  });

  test("describes the call: the number, what it says without the keypad prompt, and the project", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    const request: {
      url: string;
      data: JSONObject;
      headers: Record<string, string>;
    } = posted()[0]!;

    expect(request.data).toEqual({
      version: 1,
      event: "call",
      id: expect.any(String),
      sentAt: expect.any(String),
      to: "+15555550142",
      message:
        "This is a call from OneUptime. A new incident has been created. Checkout down on Site 03.",
      isSensitive: false,
      project: { id: PROJECT_ID.toString(), name: "Acme" },
      actions: null,
    });
    expect(ObjectID.isValidUUID(request.data["id"] as string)).toBe(true);
    expect(request.headers["X-OneUptime-Event"]).toBe("call");
    expect(request.headers["User-Agent"]).toBe(
      "OneUptime-CallAndSmsGateway/1.0",
    );
  });

  test("each call has an id of its own", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(posted()[0]!.data["id"]).not.toBe(posted()[1]!.data["id"]);
  });

  test("an on-call page carries the links that act on it, which stand in for the keypad", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(actionLinks).toHaveBeenCalledWith(TIMELINE_ID);
    expect(posted()[0]!.data["actions"]).toEqual({
      acknowledge: ACTIONS.acknowledge,
      escalate: ACTIONS.escalate,
      resolve: ACTIONS.resolve,
    });
  });

  test("a call that pages nobody carries no links, and none are made", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(actionLinks).not.toHaveBeenCalled();
    expect(posted()[0]!.data["actions"]).toBeNull();
  });

  test("a verification call is marked sensitive, and stays out of the call log", async () => {
    await CallService.makeCall(
      {
        to: TO,
        data: [{ sayMessage: "Your verification code is 4 8 2 9 1 3" }],
      },
      { projectId: PROJECT_ID, isSensitive: true },
    );

    expect(posted()[0]!.data["isSensitive"]).toBe(true);
    expect(posted()[0]!.data["message"]).toBe(
      "Your verification code is 4 8 2 9 1 3.",
    );
    expect(callLogs[0]!.callData).toEqual({
      message: "This call is sensitive and is not logged",
    });
  });

  test("without a project, nothing is logged and no project is named", async () => {
    await CallService.makeCall(pageCall(), {});

    expect(callLogs).toHaveLength(0);
    expect(posted()[0]!.data["project"]).toBeNull();
  });

  test("the call log says it was sent to the gateway, with no number it was made from", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(callLogs).toHaveLength(1);

    const row: CallLog = callLogs[0]!;

    expect(row.status).toBe(CallStatus.Success);
    expect(row.statusMessage).toBe(SENT);
    expect(row.fromNumber).toBeUndefined();
    expect(row.toNumber?.toString()).toBe("+15555550142");
    expect(row.callCostInUSDCents).toBe(0);
    // The log keeps the call's summary, keypad prompt and all, as before.
    expect(JSON.stringify(row.callData)).toContain(
      "A new incident has been created",
    );
  });

  test("the person's on-call log says it was sent to the gateway", async () => {
    await CallService.makeCall(pageCall(), {
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
  });

  test("where billing is on, a call the gateway took is paid for as one minute", async () => {
    setTestBillingEnabled(true);

    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(pay).toHaveBeenCalledTimes(1);
    expect(pay.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      costInUSDCents: 20,
    });
    expect(callLogs[0]!.callCostInUSDCents).toBe(20);
  });
});

describe("a call the gateway does not take", () => {
  test("a gateway that keeps failing: the call fails with why, as the tenant's setup, and nothing is paid", async () => {
    setTestBillingEnabled(true);
    post.mockResolvedValue(refused(502));

    const error: unknown = await rejectionOf(
      CallService.makeCall(pageCall(), {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    );

    const reason: string =
      "Not delivered: the SMS and call gateway answered HTTP 502 (tried 3 times).";

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(reason);
    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: true,
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(callLogs[0]!.status).toBe(CallStatus.Error);
    expect(callLogs[0]!.statusMessage).toBe(reason);
    expect(callLogs[0]!.callCostInUSDCents).toBe(0);
    expect(timelineUpdates[0]).toMatchObject({
      data: { status: UserNotificationStatus.Error, statusMessage: reason },
    });
    expect(pay).not.toHaveBeenCalled();
    expectTwilioUntouched();
  });

  test("a gateway that cannot be reached", async () => {
    post.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.9:443"));

    const error: unknown = await rejectionOf(
      CallService.makeCall(pageCall(), { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toBe(
      "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
    );
    expect(JSON.stringify(callLogs)).not.toContain("voice-gateway");
    expectTwilioUntouched();
  });

  test("a gateway whose URL is refused is not posted to", async () => {
    ssrf.mockRejectedValue(new BadDataException("blocked address"));

    const error: unknown = await rejectionOf(
      CallService.makeCall(pageCall(), { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toContain(
      "the URL of the SMS and call gateway is not allowed",
    );
    expect(post).not.toHaveBeenCalled();
  });

  test("a read of the gateway that fails fails the call, rather than making it through Twilio after all", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockRejectedValue(
      new Error("connection terminated"),
    );

    const error: unknown = await rejectionOf(
      CallService.makeCall(pageCall(), { projectId: PROJECT_ID }),
    );

    expect((error as Error).message).toBe("connection terminated");
    expect(post).not.toHaveBeenCalled();
    expectTwilioUntouched();
  });
});

describe("the project's switches and balance, checked first as for Twilio", () => {
  test("calls off in the project: not sent to the gateway either", async () => {
    project!.enableCallNotifications = false;

    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(post).not.toHaveBeenCalled();
    expect(callLogs[0]!.status).toBe(CallStatus.Error);
    expectTwilioUntouched();
  });

  test("too little balance where billing is on: not sent to the gateway either", async () => {
    setTestBillingEnabled(true);
    project!.smsOrCallCurrentBalanceInUSDCents = 0;

    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(post).not.toHaveBeenCalled();
    expect(callLogs[0]!.status).toBe(CallStatus.LowBalance);
  });
});

describe("what goes through Twilio still does", () => {
  test("the project's own Twilio config is used as before, and the gateway is not even asked", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    expect(getCallAndSmsGateway).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(createCall).toHaveBeenCalledTimes(1);

    const twiml: string = String(
      (createCall.mock.calls[0]![0] as JSONObject)["twiml"],
    );

    // Twilio's call still asks for the key press.
    expect(twiml).toContain("press 1");
    expect(callLogs[0]!.statusMessage).toBe("Call ID: CA-1");
  });

  test("a project config used for SMS only makes no calls: this one goes through the server's gateway", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      customTwilioConfig: {
        ...TWILIO_CONFIG,
        use: TwilioConfigUse.SmsOnly,
        smsPhoneNumbers: [new Phone("+6581234567")],
      },
    });

    expect(getCallAndSmsGateway).toHaveBeenCalledTimes(1);
    expect(posted()).toHaveLength(1);
    expectTwilioUntouched();
  });

  test("a server without a gateway makes the call through its Twilio account, as before", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);

    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(post).not.toHaveBeenCalled();
    expect(getTwilioConfig).toHaveBeenCalledTimes(1);
    expect(createCall).toHaveBeenCalledTimes(1);
    expect(callLogs[0]!.fromNumber?.toString()).toBe("+14155550100");
  });
});
