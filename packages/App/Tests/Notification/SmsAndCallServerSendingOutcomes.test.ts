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
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import ServerSendingOutcomes, {
  ServerSendingOutcome,
} from "Common/Server/Utils/ServerSending/ServerSendingOutcomes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CallRequest from "Common/Types/Call/CallRequest";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * HOW THE SERVER'S OWN SMS AND CALLS WENT, AS THEIR SENDERS TELL IT (#6825).
 *
 * An SMS or a call that goes out through the server's own gateway or Twilio
 * account tells ServerSendingOutcomes how it went: it went out, or the
 * gateway or Twilio refused it and why. One through a project's own Twilio
 * account tells nothing - its failures are the project's - and neither does
 * one the project held back (its balance, its switch): the server's channel
 * works, the project chose not to send.
 */

// Twilio's client stood in for; its TwiML builder, which a call needs, as it is.
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
  "68250000-0000-4000-8000-0000000000a1",
);

const GATEWAY: CallAndSmsGateway = {
  url: "https://gateway.internal.example.com/oneuptime",
  secret: "6".repeat(64),
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

function call(): CallRequest {
  return {
    to: TO,
    data: [{ sayMessage: "This is a call from OneUptime" }],
  };
}

let post: jest.SpyInstance;
let createMessage: jest.Mock;
let createCall: jest.Mock;
let project: Project | null;
const outcomes: Array<ServerSendingOutcome> = [];

function ok(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

beforeEach(() => {
  setTestBillingEnabled(false);
  outcomes.length = 0;

  ServerSendingOutcomes.register(
    async (outcome: ServerSendingOutcome): Promise<void> => {
      outcomes.push(outcome);
    },
  );

  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(SERVER_TWILIO);

  createMessage = jest.fn().mockResolvedValue({ status: "queued", sid: "SM-1" });
  createCall = jest.fn().mockResolvedValue({ sid: "CA-1", duration: "0" });
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });

  post = jest.spyOn(API, "post").mockResolvedValue(ok());
  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();

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
    .mockResolvedValue(false);
  jest.spyOn(MessagingBalance, "payForSentMessage").mockResolvedValue(0);

  jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
    data: SmsLog;
  }) => {
    const row: SmsLog = data.data;
    row._id = ObjectID.generate().toString();
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    const row: CallLog = data.data;
    row._id = ObjectID.generate().toString();
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomChannelActionToken, "getActionLinks")
    .mockResolvedValue(null as never);
});

afterEach(() => {
  ServerSendingOutcomes.register(null);
  jest.restoreAllMocks();
});

describe("an SMS", () => {
  test("through the server's own Twilio account: it went out", async () => {
    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
    });

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      { channel: ServerSendingChannel.SMS, succeeded: true },
    ]);
  });

  test("refused by the server's own Twilio account: why", async () => {
    createMessage.mockRejectedValue(
      Object.assign(new Error("Authenticate"), { code: 20003, status: 401 }),
    );

    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
    }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      channel: ServerSendingChannel.SMS,
      succeeded: false,
    });
    expect(outcomes[0]!.reason).toContain("Authenticate");
  });

  test("through the server's own gateway: it went out, or why it did not", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);

    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
    });

    post.mockResolvedValue(
      new HTTPErrorResponse(503, { message: "down" }, {}) as never,
    );

    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
    }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(outcomes.map((outcome: ServerSendingOutcome) => {
      return outcome.succeeded;
    })).toEqual([true, false]);
    expect(outcomes.every((outcome: ServerSendingOutcome) => {
      return outcome.channel === ServerSendingChannel.SMS;
    })).toBe(true);
  });

  test("one OneUptime could not put together never reached the gateway, and says nothing", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);
    jest
      .spyOn(CustomChannelActionToken, "getActionLinks")
      .mockRejectedValue(new Error("database went away") as never);

    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: ObjectID.generate(),
    }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(post).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });

  test("through a project's own Twilio account: nothing, whether it goes out or not", async () => {
    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_TWILIO,
    });

    createMessage.mockRejectedValue(new Error("Authenticate"));

    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_TWILIO,
    }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(outcomes).toEqual([]);
  });

  test("held back by the project - SMS switched off - says nothing of the server", async () => {
    project!.enableSmsNotifications = false;

    await SmsService.sendSms(TO, "Checkout is down.", {
      projectId: PROJECT_ID,
    }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(createMessage).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});

describe("a call", () => {
  test("through the server's own Twilio account: it went out", async () => {
    await CallService.makeCall(call(), { projectId: PROJECT_ID });

    expect(createCall).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      { channel: ServerSendingChannel.Call, succeeded: true },
    ]);
  });

  test("refused by the server's own Twilio account: why", async () => {
    createCall.mockRejectedValue(new Error("Unverified 'To' number"));

    await CallService.makeCall(call(), { projectId: PROJECT_ID }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      channel: ServerSendingChannel.Call,
      succeeded: false,
    });
    expect(outcomes[0]!.reason).toContain("Unverified");
  });

  test("through the server's own gateway: it went out", async () => {
    (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);

    await CallService.makeCall(call(), { projectId: PROJECT_ID });

    expect(outcomes).toEqual([
      { channel: ServerSendingChannel.Call, succeeded: true },
    ]);
  });

  test("through a project's own Twilio account: nothing", async () => {
    await CallService.makeCall(call(), {
      projectId: PROJECT_ID,
      customTwilioConfig: PROJECT_TWILIO,
    });

    expect(createCall).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([]);
  });

  test("held back by the project - calls switched off - says nothing of the server", async () => {
    project!.enableCallNotifications = false;

    await CallService.makeCall(call(), { projectId: PROJECT_ID }).catch(() => {
      // Thrown or not, the outcome is what is read here.
    });

    expect(createCall).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});
