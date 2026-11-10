import CallService from "../../FeatureSet/Notification/Services/CallService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import CallRequest from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { NotificationProviderConfig } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * EVERY CALL ASKS TWILIO TO SAY HOW IT ENDED (#6586).
 *
 * A call is logged Success the moment Twilio accepts it - nobody has picked
 * up yet. So each call a project places through Twilio names a status
 * callback: POST, once the call is over, to this server's public host, at
 * /notification/call/status-callback/<the call log's id>/<a token only that
 * log holds>. The log is given its id before the call is placed, as it is
 * written only after, and keeps the on-call notification the call was made
 * for, so the callback can tell it. A server with no public host, or a call
 * of no project - which keeps no log - asks for no callback.
 *
 * A call placed on the project's own Twilio account says so in its
 * callback's query (?providerConfig=project), so how it ended is counted as
 * the project's account, as its send was (issue #6648). The server's own
 * account adds nothing: its URL is as it always was.
 */

// The server's public host, set per test (setHost): read as each call is made.
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

function setHost(host: string): void {
  (
    jest.requireMock("Common/Server/EnvironmentConfig") as { Host: string }
  ).Host = host;
}

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

import {
  getCallAndSmsGateway,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-000000000b01",
);
const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-000000000b02",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CALLBACK: RegExp = new RegExp(
  "^https://oneuptime\\.example\\.com/notification/call/status-callback/([0-9a-f-]{36})/([0-9a-f-]{36})$",
);

// A call on the project's own Twilio account: the same URL, saying so.
const PROJECT_ACCOUNT_CALLBACK: RegExp = new RegExp(
  "^https://oneuptime\\.example\\.com/notification/call/status-callback/([0-9a-f-]{36})/([0-9a-f-]{36})\\?providerConfig=project$",
);

let createCall: jest.Mock;
let callLogs: Array<CallLog>;

function pageCall(): CallRequest {
  return {
    to: new Phone("+15555550142"),
    data: [{ sayMessage: "A new incident has been created" }],
  };
}

function twilioRequest(index: number = 0): JSONObject {
  return createCall.mock.calls[index]![0] as JSONObject;
}

beforeEach(() => {
  setHost("oneuptime.example.com");

  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(TWILIO_CONFIG);

  createCall = jest.fn().mockResolvedValue({
    sid: "CA0123456789abcdef0123456789abcdef",
    duration: "0",
  });
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { calls: { create: createCall } };
  });

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
  jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
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
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project's call through Twilio", () => {
  test("names its status callback: POST, once the call is over, on the server's public host", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expect(createCall).toHaveBeenCalledTimes(1);

    const request: JSONObject = twilioRequest();

    expect(String(request["statusCallback"])).toMatch(CALLBACK);
    expect(request["statusCallbackEvent"]).toEqual(["completed"]);
    expect(request["statusCallbackMethod"]).toBe("POST");
  });

  test("the URL names the call's own log, which is written with that id and the token the URL carries", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    const [, logId, token] = CALLBACK.exec(
      String(twilioRequest()["statusCallback"]),
    )!;

    expect(callLogs).toHaveLength(1);
    expect(callLogs[0]!.id?.toString()).toBe(logId);
    expect(callLogs[0]!.statusCallbackToken).toBe(token);
    expect(callLogs[0]!.status).toBe(CallStatus.Success);
  });

  test("the token is unguessable, each call's its own, and never in the log's message", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    const first: CallLog = callLogs[0]!;
    const second: CallLog = callLogs[1]!;

    expect(first.statusCallbackToken).toMatch(UUID);
    expect(second.statusCallbackToken).toMatch(UUID);
    expect(first.statusCallbackToken).not.toBe(second.statusCallbackToken);
    expect(first.id?.toString()).not.toBe(second.id?.toString());
    expect(first.statusCallbackToken).not.toBe(first.id?.toString());
    expect(first.statusMessage).toBe(
      "Call ID: CA0123456789abcdef0123456789abcdef",
    );
    expect(first.statusMessage).not.toContain(first.statusCallbackToken!);
  });

  test("the log keeps the on-call notification the call was made for", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expect(callLogs[0]!.userOnCallLogTimelineId?.toString()).toBe(
      NOTIFICATION_ID.toString(),
    );
  });

  test("a call made for no notification - a test call - keeps none", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expect(callLogs[0]!.userOnCallLogTimelineId).toBeUndefined();
  });

  test("the project's own Twilio account names the callback too, saying whose account the call is on", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    const url: string = String(twilioRequest()["statusCallback"]);

    expect(url).toMatch(PROJECT_ACCOUNT_CALLBACK);

    const [, logId, token] = PROJECT_ACCOUNT_CALLBACK.exec(url)!;

    expect(callLogs[0]!.id?.toString()).toBe(logId);
    expect(callLogs[0]!.statusCallbackToken).toBe(token);
  });

  test("the server's own account adds nothing to the URL", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    const url: string = String(twilioRequest()["statusCallback"]);

    expect(url).toMatch(CALLBACK);
    expect(url).not.toContain("?");
    expect(url).not.toContain("providerConfig");
  });
});

describe("no callback is asked for", () => {
  test("by a server with no public host: Twilio could not reach it", async () => {
    setHost("");

    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    const request: JSONObject = twilioRequest();

    expect(request).not.toHaveProperty("statusCallback");
    expect(request).not.toHaveProperty("statusCallbackEvent");
    expect(request).not.toHaveProperty("statusCallbackMethod");
    expect(callLogs[0]!.statusCallbackToken).toBeUndefined();
  });

  test("for a call of no project, which keeps no log to tell", async () => {
    await CallService.makeCall(pageCall(), {});

    expect(createCall).toHaveBeenCalledTimes(1);
    expect(twilioRequest()).not.toHaveProperty("statusCallback");
    expect(callLogs).toEqual([]);
  });
});

describe("prepareStatusCallback", () => {
  test("keeps an id the log has, and gives it a token", () => {
    const log: CallLog = new CallLog();
    const id: ObjectID = ObjectID.generate();
    log.id = id;

    const url: string | null = CallService.prepareStatusCallback(log);

    expect(log.id!.toString()).toBe(id.toString());
    expect(url).toBe(
      `https://oneuptime.example.com/notification/call/status-callback/${id.toString()}/${log.statusCallbackToken}`,
    );
  });

  test("the server's own account, said or not, is the URL as it always was", () => {
    const log: CallLog = new CallLog();
    log.id = ObjectID.generate();

    const url: string | null = CallService.prepareStatusCallback(
      log,
      NotificationProviderConfig.Global,
    );

    expect(url).toBe(
      `https://oneuptime.example.com/notification/call/status-callback/${log.id.toString()}/${log.statusCallbackToken}`,
    );
  });

  test("the project's own account says so in the query", () => {
    const log: CallLog = new CallLog();
    log.id = ObjectID.generate();

    const url: string | null = CallService.prepareStatusCallback(
      log,
      NotificationProviderConfig.Project,
    );

    expect(url).toBe(
      `https://oneuptime.example.com/notification/call/status-callback/${log.id.toString()}/${log.statusCallbackToken}?providerConfig=project`,
    );
  });

  test("without a public host: null, and the log is left as it was", () => {
    setHost("");

    const log: CallLog = new CallLog();

    expect(CallService.prepareStatusCallback(log)).toBeNull();
    expect(log.id).toBeNull();
    expect(log.statusCallbackToken).toBeUndefined();
  });
});
