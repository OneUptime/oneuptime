import CallService from "../../FeatureSet/Notification/Services/CallService";
import {
  VOICEMAIL_MACHINE_DETECTION,
  VOICEMAIL_MESSAGE_CALL_DATA_KEY,
  VOICEMAIL_MESSAGE_CLOSING,
} from "../../FeatureSet/Notification/Utils/AnsweredBy";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import { NotificationProviderConfig } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import { ON_CALL_KEYPAD_TOKEN_PURPOSE } from "Common/Server/Utils/OnCall/OnCallKeypadToken";
import OnCallPageLinkToken from "Common/Server/Utils/OnCall/OnCallPageLinkToken";
import CallRequest, { GatherInput, Say } from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import URL from "Common/Types/API/URL";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * AN ON-CALL CALL ASKS TWILIO WHO ANSWERED IT: A PERSON, OR VOICEMAIL (#6594).
 *
 * To Twilio, a call voicemail picks up is answered. So each on-call call a
 * project places through Twilio asks for answering machine detection:
 *
 *   - in the background (AsyncAmd), so a person who picks up hears the page
 *     at once, and DetectMessageEnd, so a voicemail is reported at the end of
 *     its greeting, where a message left is the one it records;
 *   - posted to the call's answering machine callback, next to its status
 *     callback: the same log, the same token, the same note of whose account
 *     it is on, the same ask to send it again on a 5xx;
 *   - with the message to leave on voicemail kept in the call's log: what
 *     the call says, never its keypad prompt, then what to do.
 *
 * Only for an on-call page - a call made for a person's on-call
 * notification - of a project that detects voicemail, as every project does
 * until it switches it off (Project.detectVoicemailOnCalls; empty reads as
 * on), and only when Twilio can report it (a project's call, a public HOST).
 * A test call, a verification call, a call of a project that switched it
 * off, and a server Twilio cannot reach are placed as they always were.
 */

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
  "6c0e0000-0000-4000-8000-000000000c01",
);

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-000000000c02",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const RETRY_FRAGMENT: string = "#rc=3&rp=ct,5xx";

const STATUS_CALLBACK: RegExp = new RegExp(
  "^https://oneuptime\\.example\\.com/notification/call/status-callback/([0-9a-f-]{36})/([0-9a-f-]{36})(\\?providerConfig=project)?#rc=3&rp=ct,5xx$",
);

const VOICEMAIL_CALLBACK: RegExp = new RegExp(
  "^https://oneuptime\\.example\\.com/notification/call/amd-callback/([0-9a-f-]{36})/([0-9a-f-]{36})(\\?providerConfig=project)?#rc=3&rp=ct,5xx$",
);

const AMD_PARAMETERS: ReadonlyArray<string> = [
  "machineDetection",
  "asyncAmd",
  "asyncAmdStatusCallback",
  "asyncAmdStatusCallbackMethod",
];

let createCall: jest.Mock;
let callLogs: Array<CallLog>;
let project: Project;
let timeline: OnCallTimelineRows;

// What an on-call call says: its sentences, then the keypad prompt.
function pageCall(): CallRequest {
  return {
    to: new Phone("+15555550142"),
    data: [
      { sayMessage: "This is a call from One Uptime" },
      { sayMessage: "A new incident has been created" },
      { sayMessage: "Incident number 42, API is down" },
      {
        introMessage: "To acknowledge this incident, press 1.",
        numDigits: 1,
        timeoutInSeconds: 10,
        noInputMessage: "You have not entered any input. Good bye",
        onInputCallRequest: {
          "1": { sayMessage: "You have acknowledged this incident. Good bye" },
          default: { sayMessage: "Invalid input. Good bye" },
        },
        responseUrl: URL.fromString(
          "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/x",
        ),
      },
    ],
  };
}

function twilioRequest(index: number = 0): JSONObject {
  return createCall.mock.calls[index]![0] as JSONObject;
}

function expectNoDetection(request: JSONObject): void {
  for (const parameter of AMD_PARAMETERS) {
    expect({ parameter, asked: parameter in request }).toEqual({
      parameter,
      asked: false,
    });
  }
}

function callDataOf(log: CallLog): JSONObject {
  return (log.callData || {}) as unknown as JSONObject;
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

  project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(project);
  }) as never);
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

  timeline = new OnCallTimelineRows();
  timeline.add(NOTIFICATION_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);

  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an on-call call of a project that detects voicemail", () => {
  test.each([
    ["a project that never set the switch", undefined],
    ["a project that switched it on", true],
    // A row from before the column, read as empty.
    ["a project whose switch reads empty", null],
  ])(
    "%s: asks Twilio, in the background, who answered it",
    async (_name: string, value: boolean | null | undefined) => {
      // As the row is read: the column's value, or none at all.
      (project as unknown as Record<string, unknown>)[
        "detectVoicemailOnCalls"
      ] = value;

      await CallService.makeCall(pageCall(), {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: NOTIFICATION_ID,
      });

      const request: JSONObject = twilioRequest();

      expect(VOICEMAIL_MACHINE_DETECTION).toBe("DetectMessageEnd");
      expect(request["machineDetection"]).toBe("DetectMessageEnd");
      // In the background: the page plays the moment a person picks up.
      expect(request["asyncAmd"]).toBe("true");
      expect(request["asyncAmdStatusCallbackMethod"]).toBe("POST");
      expect(String(request["asyncAmdStatusCallback"])).toMatch(
        VOICEMAIL_CALLBACK,
      );
      // How the call ended is still asked for, as before.
      expect(String(request["statusCallback"])).toMatch(STATUS_CALLBACK);
      expect(request["statusCallbackEvent"]).toEqual(["completed"]);
    },
  );

  test("the answering machine callback names the call's own log and its token - the status callback's", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    const request: JSONObject = twilioRequest();
    const [, logId, token] = VOICEMAIL_CALLBACK.exec(
      String(request["asyncAmdStatusCallback"]),
    )!;
    const [, statusLogId, statusToken] = STATUS_CALLBACK.exec(
      String(request["statusCallback"]),
    )!;

    expect(callLogs).toHaveLength(1);
    expect(logId).toBe(callLogs[0]!.id?.toString());
    expect(token).toBe(callLogs[0]!.statusCallbackToken);
    expect([logId, token]).toEqual([statusLogId, statusToken]);
    // Never in the log's message.
    expect(callLogs[0]!.statusMessage).not.toContain(token!);
  });

  test("on the project's own Twilio account, says so, as the status callback does", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    const url: string = String(twilioRequest()["asyncAmdStatusCallback"]);

    expect(url).toContain("?providerConfig=project");
    expect(url.endsWith(RETRY_FRAGMENT)).toBe(true);
  });

  test("on the server's own account, adds nothing to the query", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    const url: string = String(twilioRequest()["asyncAmdStatusCallback"]);

    expect(url).not.toContain("?");
    expect(url.endsWith(RETRY_FRAGMENT)).toBe(true);
  });

  test("keeps the message to leave on voicemail: what the call says, never its keypad prompt, then what to do", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    const callData: JSONObject = callDataOf(callLogs[0]!);

    expect(callData[VOICEMAIL_MESSAGE_CALL_DATA_KEY]).toBe(
      `This is a call from One Uptime. A new incident has been created. Incident number 42, API is down. ${VOICEMAIL_MESSAGE_CLOSING}`,
    );
    expect(String(callData[VOICEMAIL_MESSAGE_CALL_DATA_KEY])).not.toContain(
      "press 1",
    );
    // What the call says is kept as before, for its log.
    expect(String(callData["message"])).toContain(
      "To acknowledge this incident, press 1.",
    );
  });

  test("a call whose words are not logged keeps no message: its words stay out of the log", async () => {
    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSensitive: true,
    });

    const callData: JSONObject = callDataOf(callLogs[0]!);

    expect(callData).not.toHaveProperty(VOICEMAIL_MESSAGE_CALL_DATA_KEY);
    expect(callData["message"]).toBe(
      "This call is sensitive and is not logged",
    );
    // Still asks who answered: the callback leaves a message without the words.
    expect(twilioRequest()["asyncAmd"]).toBe("true");
  });

  test("the page plays as it always did: the same TwiML", async () => {
    // One second for both: the keypad token is signed with the time.
    jest.spyOn(Date, "now").mockReturnValue(Date.now());

    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expect(twilioRequest()["twiml"]).toBe(
      CallService.generateTwimlForCall(pageCall(), {
        userOnCallLogTimelineId: NOTIFICATION_ID,
      }),
    );
  });
});

describe("a call that asks nobody who answered it", () => {
  test("an on-call call of a project that switched it off", async () => {
    project.detectVoicemailOnCalls = false;

    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expectNoDetection(twilioRequest());
    expect(callDataOf(callLogs[0]!)).not.toHaveProperty(
      VOICEMAIL_MESSAGE_CALL_DATA_KEY,
    );
    // How it ended is still asked for.
    expect(String(twilioRequest()["statusCallback"])).toMatch(STATUS_CALLBACK);
  });

  test("a call made for no on-call notification: a test call, a verification code", async () => {
    await CallService.makeCall(pageCall(), { projectId: PROJECT_ID });

    expectNoDetection(twilioRequest());
    expect(callDataOf(callLogs[0]!)).not.toHaveProperty(
      VOICEMAIL_MESSAGE_CALL_DATA_KEY,
    );
  });

  test("on a server with no public host: Twilio could not report it", async () => {
    setHost("");

    await CallService.makeCall(pageCall(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expectNoDetection(twilioRequest());
    expect(twilioRequest()).not.toHaveProperty("statusCallback");
  });

  test("a call of no project, which keeps no log to write who answered on", async () => {
    await CallService.makeCall(pageCall(), {
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expect(createCall).toHaveBeenCalledTimes(1);
    expectNoDetection(twilioRequest());
  });
});

describe("shouldDetectVoicemail", () => {
  test.each([
    [true, true, true],
    [true, undefined, true],
    [true, null, true],
    [true, false, false],
    [false, true, false],
    [false, undefined, false],
  ])(
    "on-call: %p, the project's switch: %p - asks: %p",
    (
      isOnCall: boolean,
      detectVoicemailOnCalls: boolean | null | undefined,
      asks: boolean,
    ) => {
      expect(
        CallService.shouldDetectVoicemail({
          userOnCallLogTimelineId: isOnCall ? NOTIFICATION_ID : undefined,
          project: {
            detectVoicemailOnCalls: detectVoicemailOnCalls,
          },
        }),
      ).toBe(asks);
    },
  );

  test("without the project read, asks nothing", () => {
    expect(
      CallService.shouldDetectVoicemail({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        project: null,
      }),
    ).toBe(false);
  });
});

describe("getVoicemailCallbackUrl", () => {
  test("the log's own id and token, beside the status callback's path", () => {
    const log: CallLog = new CallLog();
    log.id = ObjectID.generate();
    CallService.prepareStatusCallback(log);

    expect(CallService.getVoicemailCallbackUrl(log)).toBe(
      `https://oneuptime.example.com/notification/call/amd-callback/${log.id.toString()}/${log.statusCallbackToken}${RETRY_FRAGMENT}`,
    );
    expect(
      CallService.getVoicemailCallbackUrl(
        log,
        NotificationProviderConfig.Project,
      ),
    ).toBe(
      `https://oneuptime.example.com/notification/call/amd-callback/${log.id.toString()}/${log.statusCallbackToken}?providerConfig=project${RETRY_FRAGMENT}`,
    );
  });

  test("null without a token, an id or a public host", () => {
    const log: CallLog = new CallLog();
    log.id = ObjectID.generate();

    expect(CallService.getVoicemailCallbackUrl(log)).toBeNull();

    CallService.prepareStatusCallback(log);
    setHost("");

    expect(CallService.getVoicemailCallbackUrl(log)).toBeNull();
  });
});

/*
 * THE KEYPAD'S ADDRESS IN THE CALL (#10025). The <Gather> action lands in
 * Twilio's request logs and in the call's TwiML in the Twilio console, so
 * it carries nothing that works anywhere else: the call's own token, which
 * says what each key answers and names the notification the call is placed
 * for (OnCallKeypadToken) - and not the page's link token, which escalates
 * the page from a browser too. A worker hands the Notification service the
 * keypad address with the page's token in it for one release (for a
 * Notification service of the release before, placing calls while an
 * upgrade rolls out): the call leaves it out.
 */
describe("the keypad's address in an on-call call", () => {
  const PAGE_TOKEN: string = OnCallPageLinkToken.sign({
    userOnCallLogTimelineId: NOTIFICATION_ID,
  });

  // The keypad address as the worker hands it over: with the page's token.
  function pageCallFromAWorker(): CallRequest {
    const request: CallRequest = pageCall();
    const gather: GatherInput = request.data[3] as GatherInput;

    gather.responseUrl = URL.fromString(
      `https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/${NOTIFICATION_ID.toString()}`,
    ).addQueryParam("pageToken", PAGE_TOKEN);

    return request;
  }

  // The <Gather> action of a call's TwiML.
  const GATHER_ACTION: RegExp = new RegExp('<Gather [^>]*action="([^"]+)"');

  function actionOf(twiml: string): globalThis.URL {
    const match: RegExpExecArray | null = GATHER_ACTION.exec(twiml);

    expect(match).not.toBeNull();

    return new globalThis.URL(match![1]!.replace(/&amp;/g, "&"));
  }

  test("carries the call's own token, which names the notification the call is placed for, and what each key answers", async () => {
    await CallService.makeCall(pageCallFromAWorker(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    const action: globalThis.URL = actionOf(String(twilioRequest()["twiml"]));
    const claims: JSONObject = JSONWebToken.decodeJsonPayload(
      action.searchParams.get("token")!,
    );

    expect(claims["purpose"]).toBe(ON_CALL_KEYPAD_TOKEN_PURPOSE);
    expect(claims["notification"]).toBe(NOTIFICATION_ID.toString());
    expect(claims["1"]).toEqual({
      sayMessage: "You have acknowledged this incident. Good bye",
    });
    expect(claims["default"]).toEqual({
      sayMessage: "Invalid input. Good bye",
    });
    // It lasts a day, as a call's token always has.
    expect(Number(claims["exp"]) - Number(claims["iat"])).toBe(24 * 60 * 60);
  });

  test("leaves out the page's link token the worker's address carries: it escalates the page from a browser", async () => {
    await CallService.makeCall(pageCallFromAWorker(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    const twiml: string = String(twilioRequest()["twiml"]);
    const action: globalThis.URL = actionOf(twiml);

    expect(action.pathname).toBe(
      `/api/user-notification-log-timeline/call/gather-input/${NOTIFICATION_ID.toString()}`,
    );
    expect([...action.searchParams.keys()]).toEqual(["token"]);
    expect(twiml).not.toContain("pageToken");
    expect(twiml).not.toContain(PAGE_TOKEN);
  });

  test("the call request's own address is left as it was", async () => {
    const request: CallRequest = pageCallFromAWorker();

    await CallService.makeCall(request, {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });

    expect(
      (request.data[3] as GatherInput).responseUrl.getQueryParam("pageToken"),
    ).toBe(PAGE_TOKEN);
    expect(
      (request.data[3] as GatherInput).responseUrl.getQueryParam("token"),
    ).toBeNull();
  });

  test("the notification's id as the Notification service reads it from JSON, as text, names it too", () => {
    const action: globalThis.URL = actionOf(
      CallService.generateTwimlForCall(pageCallFromAWorker(), {
        userOnCallLogTimelineId: NOTIFICATION_ID.toString(),
      }),
    );

    expect(
      JSONWebToken.decodeJsonPayload(action.searchParams.get("token")!)[
        "notification"
      ],
    ).toBe(NOTIFICATION_ID.toString());
  });

  test("a call cut to fit Twilio's limit keeps the token it was measured with", () => {
    const request: CallRequest = pageCallFromAWorker();
    (request.data[2] as Say).sayMessage =
      "This incident's description is very long. ".repeat(400);

    const twiml: string = CallService.generateTwimlForCall(request, {
      userOnCallLogTimelineId: NOTIFICATION_ID,
    });
    const claims: JSONObject = JSONWebToken.decodeJsonPayload(
      actionOf(twiml).searchParams.get("token")!,
    );

    expect(twiml.length).toBeLessThanOrEqual(4000);
    expect(claims["notification"]).toBe(NOTIFICATION_ID.toString());
    expect(twiml).not.toContain("pageToken");
  });

  test("getKeypadAction: the address without the page's token, with the call's - anything else in it kept", () => {
    const responseUrl: URL = URL.fromString(
      "https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/x",
    )
      .addQueryParam("pageToken", PAGE_TOKEN)
      .addQueryParam("lang", "en");

    const action: globalThis.URL = new globalThis.URL(
      CallService.getKeypadAction(responseUrl, "the-call-token"),
    );

    expect(action.searchParams.get("pageToken")).toBeNull();
    expect(action.searchParams.get("lang")).toBe("en");
    expect(action.searchParams.get("token")).toBe("the-call-token");
    // The address it was handed is left as it was.
    expect(responseUrl.getQueryParam("pageToken")).toBe(PAGE_TOKEN);
    expect(responseUrl.getQueryParam("token")).toBeNull();
  });
});

describe("generateVoicemailTwiml", () => {
  test("says the message, then hangs up: nothing to press", () => {
    const twiml: string = CallService.generateVoicemailTwiml(
      "Incident 42 & co. Open One Uptime to respond. Good bye.",
    );

    expect(twiml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Incident 42 &amp; co. Open One Uptime to respond. Good bye.</Say><Hangup/></Response>',
    );
    expect(twiml).not.toContain("<Gather");
  });

  test("a message too long for Twilio is cut to fit, as any call's is", () => {
    const twiml: string = CallService.generateVoicemailTwiml(
      "This incident's description is very long. ".repeat(400),
    );

    expect(twiml.length).toBeLessThanOrEqual(4000);
    expect(twiml).toContain("<Hangup/>");
  });
});
