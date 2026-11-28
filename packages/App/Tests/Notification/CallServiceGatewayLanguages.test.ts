import CallService, {
  getCallGatewayMessage,
  getCallGatewayMessageInLanguage,
  getCallVoicemailWords,
} from "../../FeatureSet/Notification/Services/CallService";
import ServerTestSendService from "../../FeatureSet/Notification/Services/ServerTestSendService";
import SignedWebhookPost, {
  signWebhookBody,
} from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import CommonCallService from "Common/Server/Services/CallService";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserCallService from "Common/Server/Services/UserCallService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import UserLanguage from "Common/Server/Utils/Notification/UserLanguage";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import OnCallPageLinks from "Common/Server/Utils/OnCall/OnCallPageLinks";
import ServerChannelSetup from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import {
  SERVER_LOCALES,
  getServerTranslator,
} from "Common/Server/Utils/ServerTranslation";
import { approveEveryWebhookAddress } from "Common/Tests/Server/TestingUtils/WebhookAddressCheck";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import CallRequest, { CallRequestMessage, Say } from "Common/Types/Call/CallRequest";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import { CustomChannelActionLinks } from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { SERVER_TEST_CALL_SENTENCE } from "Common/Utils/Call/TestCall";
import { VERIFICATION_CALL_CODE_SENTENCE } from "Common/Utils/Call/VerificationCodeCall";
import API from "Common/Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * A CALL THROUGH THE SERVER'S OWN GATEWAY, IN THE PERSON'S LANGUAGE (#11459).
 *
 * A server that sends its calls through its own call and SMS gateway
 * handed it the English words alone: getCallGatewayMessage read the call's
 * English data, never its words in the person's language. Now the request
 * carries both: `message`, the English the gateway always read - so a
 * gateway that reads nothing else speaks English as before, never another
 * language's words in its English voice - and `inLanguage`, the same call
 * in the person's language with the language's code, for a gateway with a
 * voice of it. The gateway picks its own voice, so Persian goes too, which
 * no Twilio voice speaks.
 *
 * End to end: the page's call is written by the worker's real template,
 * the verification call by the real UserCallService and Make test call by
 * the real ServerTestSendService, each for a reader of the language; the
 * Notification service's real CallService, CallAndSmsGatewayService and
 * SignedWebhookPost post it. Only the network, the database and Twilio's
 * client are stood in for - and Twilio is never touched.
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
  "0fa11459-0000-4000-8000-000000000f01",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "0fa11459-0000-4000-8000-000000000f02",
);
const USER_ID: ObjectID = new ObjectID("0fa11459-0000-4000-8000-000000000f03");

const GATEWAY: CallAndSmsGateway = {
  url: "https://voice-gateway.internal.example.com/oneuptime",
  secret: "9".repeat(64),
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

let post: jest.SpyInstance;
let createCall: jest.Mock;
let callLogs: Array<CallLog>;
let timeline: OnCallTimelineRows;

function incident(): Incident {
  const model: Incident = new Incident();
  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  const owner: Project = new Project();
  owner.name = "Acme Production";
  model.project = owner;
  model.title = "Checkout API is down";
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
}

// The page's call, written by the worker's own template for a reader of `language`.
async function pageCall(language: string): Promise<CallRequest> {
  return await UserNotificationRuleService.generateCallTemplateForIncidentCreated(
    TO,
    incident(),
    TIMELINE_ID,
    undefined,
    undefined,
    false,
    getServerTranslator(language),
  );
}

// As the Notification service's /make-call route reads a call request: through JSON.
function overTheWire(callRequest: CallRequest): CallRequest {
  return JSONFunctions.deserialize(
    JSON.parse(
      JSON.stringify(JSONFunctions.serialize({ callRequest: callRequest })),
    ),
  )["callRequest"] as unknown as CallRequest;
}

// What the gateway was posted, as it got it.
function posted(): Array<{ data: JSONObject; headers: Record<string, string> }> {
  return post.mock.calls.map((call: Array<unknown>) => {
    const request: Record<string, unknown> = call[0] as Record<string, unknown>;

    return {
      data: request["data"] as JSONObject,
      headers: request["headers"] as Record<string, string>,
    };
  });
}

function onlyPayload(): JSONObject {
  expect(posted()).toHaveLength(1);

  return posted()[0]!.data;
}

function inLanguageOf(payload: JSONObject): JSONObject | null {
  return payload["inLanguage"] as JSONObject | null;
}

beforeEach(() => {
  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(GATEWAY);
  (getTwilioConfig as unknown as jest.Mock).mockReset();

  createCall = jest.fn();
  (Twilio as unknown as jest.Mock).mockReset();
  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { calls: { create: createCall } };
  });

  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
  approveEveryWebhookAddress();
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();

  jest
    .spyOn(OnCallPageLinks, "getCallResponseUrl")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/${TIMELINE_ID.toString()}`,
      ),
    );

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

  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(CustomChannelActionToken, "getActionLinks")
    .mockResolvedValue(ACTIONS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A page's call through the gateway, for a reader of `language`: what the gateway got.
async function pageThroughGateway(language: string): Promise<JSONObject> {
  await CallService.makeCall(overTheWire(await pageCall(language)), {
    projectId: PROJECT_ID,
    userOnCallLogTimelineId: TIMELINE_ID,
  });

  expect(createCall).not.toHaveBeenCalled();
  expect(getTwilioConfig).not.toHaveBeenCalled();

  return onlyPayload();
}

describe.each([
  ["de"],
  ["ja"],
  ["ar"],
  ["zh-TW"],
  ["pt"],
  ["hi"],
  ["ru"],
  ["ko"],
])("an on-call page's call to a person who reads %s", (language: string) => {
  test("hands the gateway the call in the language, with the language's code, beside the English message", async () => {
    const callRequest: CallRequest = await pageCall(language);
    const payload: JSONObject = await pageThroughGateway(language);

    expect(inLanguageOf(payload)).toEqual({
      language: language,
      message: getCallGatewayMessage(
        { data: callRequest.inLanguage!.data },
        language,
      ),
    });
    expect(payload["message"]).toBe(getCallGatewayMessage(callRequest));
    expect(payload["message"]).toContain("This is a call from Acme Production.");
  });

  test("the words in the language are the call's spoken sentences, as the English ones are: no keypad prompt, no answers to a key", async () => {
    const callRequest: CallRequest = await pageCall(language);
    const words: string = (
      inLanguageOf(await pageThroughGateway(language)) as JSONObject
    )["message"] as string;
    const sentences: Array<Say> = callRequest.inLanguage!.data.filter(
      (item: unknown): boolean => {
        return typeof (item as Say).sayMessage === "string";
      },
    ) as Array<Say>;
    const gatherOf: { introMessage: string; noInputMessage: string } =
      callRequest.inLanguage!.data.find((item: unknown): boolean => {
        return Boolean((item as { introMessage?: string }).introMessage);
      }) as unknown as { introMessage: string; noInputMessage: string };

    expect(words).toContain(sentences[0]!.sayMessage.trim().slice(0, 8));
    expect(words).not.toContain(gatherOf.introMessage);
    expect(words).not.toContain(gatherOf.noInputMessage);
    // The team's title, as written.
    expect(words).toContain("Checkout API is down");
    expect(words).not.toContain("This is a call from");
    // Each sentence ended once, as the language ends one: never "。." or "।.".
    expect(words).not.toMatch(/[。！？।؟]\./u);
  });

  test("the page's actions are there, as for every page: the gateway offers them its own way", async () => {
    const payload: JSONObject = await pageThroughGateway(language);

    expect(payload["actions"]).toEqual({
      acknowledge: ACTIONS.acknowledge,
      escalate: ACTIONS.escalate,
      resolve: ACTIONS.resolve,
    });
  });

  test("the signature covers the whole body, the words in the language included", async () => {
    await pageThroughGateway(language);

    const request: { data: JSONObject; headers: Record<string, string> } =
      posted()[0]!;

    expect(request.headers["X-OneUptime-Signature"]).toBe(
      signWebhookBody({
        secret: GATEWAY.secret,
        body: JSON.stringify(request.data),
      }),
    );
  });
});

describe("a gateway that ignores the language", () => {
  test("reads the English message it always read, word for word: the page's call to a German reader says what it says to an English one", async () => {
    const german: JSONObject = await pageThroughGateway("de");

    post.mockClear();
    callLogs = [];

    const english: JSONObject = await pageThroughGateway("en");

    expect(german["message"]).toBe(english["message"]);
    expect(german["isSensitive"]).toBe(english["isSensitive"]);
    expect(german["actions"]).toEqual(english["actions"]);
    expect(german["version"]).toBe(1);
    // Everything a gateway of before reads, in the same places.
    expect(Object.keys(german).slice(0, 9)).toEqual(
      Object.keys(english).slice(0, 9),
    );
  });

  test("an English reader's call carries no other wording: null, as every field a request has is there", async () => {
    const payload: JSONObject = await pageThroughGateway("en");

    expect(inLanguageOf(payload)).toBeNull();
    expect("inLanguage" in payload).toBe(true);
  });

  test("the call log keeps what the English call says: OneUptime does not know which the gateway spoke", async () => {
    await pageThroughGateway("ja");

    expect(String((callLogs[0]!.callData as unknown as JSONObject)["message"]))
      .toContain("This is a call from Acme Production.");
  });
});

describe("Persian, which no Twilio voice speaks", () => {
  test("goes to the gateway in Persian too, with its code: the gateway picks its own voice", async () => {
    const callRequest: CallRequest = await pageCall("fa");
    const payload: JSONObject = await pageThroughGateway("fa");

    expect(inLanguageOf(payload)).toEqual({
      language: "fa",
      message: getCallGatewayMessage(
        { data: callRequest.inLanguage!.data },
        "fa",
      ),
    });
    expect((inLanguageOf(payload) as JSONObject)["message"]).toContain(
      "این تماسی از طرف Acme Production است.",
    );
    expect(payload["message"]).toContain("This is a call from Acme Production.");
  });
});

describe("the verification call through the gateway", () => {
  async function verificationThroughGateway(
    language: string,
  ): Promise<JSONObject> {
    jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue(language);
    const makeCall: jest.SpyInstance = jest
      .spyOn(CommonCallService, "makeCall")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    const userCall: UserCall = new UserCall();
    userCall.phone = TO;
    userCall.projectId = PROJECT_ID;
    userCall.userId = USER_ID;

    await UserCallService.sendVerificationCode(userCall, "048291");

    const [callRequest, options] = makeCall.mock.calls[0] as [
      CallRequest,
      JSONObject,
    ];

    await CallService.makeCall(overTheWire(callRequest), {
      projectId: PROJECT_ID,
      isSensitive: options["isSensitive"] as boolean,
    });

    return onlyPayload();
  }

  test("is sensitive, and hands the gateway the code in English and in the person's language", async () => {
    const payload: JSONObject = await verificationThroughGateway("de");
    const sentence: string = SERVER_LOCALES["de"]![
      VERIFICATION_CALL_CODE_SENTENCE
    ]!.replace("{{code}}", "0  4  8  2  9  1");

    expect(payload["isSensitive"]).toBe(true);
    expect(payload["message"]).toBe(
      "This is a call from OneUptime. Your verification code is 0  4  8  2  9  1. Your verification code is 0  4  8  2  9  1. Your verification code is 0  4  8  2  9  1. Thank you for using OneUptime. Good bye.",
    );
    expect(inLanguageOf(payload)!["language"]).toBe("de");
    expect(
      (inLanguageOf(payload)!["message"] as string).split(sentence).length - 1,
    ).toBe(3);
    // The code itself stays out of the call log, as a sensitive call's words do.
    expect(JSON.stringify(callLogs)).not.toContain("0  4  8");
  });

  test("to a person who reads English: the English alone, as before", async () => {
    const payload: JSONObject = await verificationThroughGateway("en");

    expect(inLanguageOf(payload)).toBeNull();
    expect(payload["isSensitive"]).toBe(true);
  });
});

describe("Make test call through the gateway", () => {
  test("hands it the test call in the admin's language beside the English", async () => {
    jest
      .spyOn(ServerSendingStatus, "readConfig")
      .mockResolvedValue(new GlobalConfig());
    jest.spyOn(ServerChannelSetup, "readSetUpProblem").mockReturnValue(null);

    await ServerTestSendService.makeCall(TO, "ja");

    const payload: JSONObject = onlyPayload();

    expect(payload["message"]).toBe(
      "This is a test call from OneUptime. Calls from this server work.",
    );
    expect(inLanguageOf(payload)).toEqual({
      language: "ja",
      message: SERVER_LOCALES["ja"]![SERVER_TEST_CALL_SENTENCE]!.replace(
        "{{product}}",
        "OneUptime",
      ),
    });
    expect(payload["project"]).toBeNull();
  });
});

describe("getCallGatewayMessageInLanguage", () => {
  const call: (inLanguage: unknown) => CallRequestMessage = (
    inLanguage: unknown,
  ): CallRequestMessage => {
    return {
      data: [{ sayMessage: "Checkout is down" }],
      inLanguage: inLanguage as CallRequestMessage["inLanguage"],
    };
  };

  test("the call's words in its language, as the English message reads them: each sentence ended as one", () => {
    expect(
      getCallGatewayMessageInLanguage(
        call({
          language: "de",
          data: [
            { sayMessage: "Dies ist ein Anruf von Acme" },
            { sayMessage: "  Checkout ist ausgefallen  " },
          ],
        }),
      ),
    ).toEqual({
      language: "de",
      message: "Dies ist ein Anruf von Acme. Checkout ist ausgefallen.",
    });
  });

  test("a tag of a region is its language", () => {
    expect(
      getCallGatewayMessageInLanguage(
        call({ language: "pt-BR", data: [{ sayMessage: "Olá." }] }),
      )?.language,
    ).toBe("pt");
  });

  test.each([
    ["none", undefined],
    ["English", { language: "en", data: [{ sayMessage: "Hello." }] }],
    [
      "a language OneUptime does not write in",
      { language: "xx", data: [{ sayMessage: "Hello." }] },
    ],
    ["a language that is not text", { language: 7, data: [] }],
    ["words that are not a list", { language: "de", data: "Hallo." }],
    ["no words", { language: "de", data: [] }],
    ["words that say nothing", { language: "de", data: [{ sayMessage: "  " }] }],
    ["not an object", "de"],
  ])("%s: undefined, and the gateway has the English alone", (
    _label: string,
    inLanguage: unknown,
  ) => {
    expect(getCallGatewayMessageInLanguage(call(inLanguage))).toBeUndefined();
  });
});

/*
 * Each sentence ended once, as its language ends one (asSentenceInLanguage):
 * a Japanese, Chinese or Hindi sentence was given a "." after its own full
 * stop, in what a gateway was told and in the message left on voicemail.
 */
describe("a sentence ended as its language ends one", () => {
  test.each([
    ["ja", "確認コードは 1  2 です。", "確認コードは 1  2 です。"],
    ["zh-CN", "这是来自 Acme 的电话。", "这是来自 Acme 的电话。"],
    ["zh-TW", "這是來自 Acme 的電話！", "這是來自 Acme 的電話！"],
    ["hi", "यह Acme की ओर से एक कॉल है।", "यह Acme की ओर से एक कॉल है।"],
    ["ar", "هل هذه مكالمة؟", "هل هذه مكالمة؟"],
    ["fa", "این تماسی از طرف Acme است.", "این تماسی از طرف Acme است."],
    ["de", "Checkout API is down", "Checkout API is down."],
    ["ja", "Checkout API is down", "Checkout API is down。"],
    ["zh-TW", "Checkout API is down", "Checkout API is down。"],
    ["hi", "Checkout API is down", "Checkout API is down।"],
    ["ar", "Checkout API is down", "Checkout API is down."],
  ])(
    "%s: %j is told as %j",
    (language: string, sentence: string, told: string) => {
      expect(
        getCallGatewayMessageInLanguage({
          data: [],
          inLanguage: { language: language, data: [{ sayMessage: sentence }] },
        })?.message,
      ).toBe(told);
    },
  );

  test("the English call's words are ended as they always were", () => {
    expect(
      getCallGatewayMessage({
        data: [
          { sayMessage: "This is a call from Acme" },
          { sayMessage: "Checkout is down." },
          { sayMessage: "Can you take it?" },
        ],
      }),
    ).toBe("This is a call from Acme. Checkout is down. Can you take it?");
  });

  test("the message left on voicemail, in Japanese: one full stop to a sentence", () => {
    expect(
      getCallVoicemailWords(
        {
          data: [
            { sayMessage: "Acme Production からのお電話です。" },
            { sayMessage: "Checkout API is down" },
          ],
        },
        [],
        "ja",
      ),
    ).toBe("Acme Production からのお電話です。 Checkout API is down。");
  });

  test("the message left on voicemail, in Hindi: its danda, never a full stop after it", () => {
    const words: string = getCallVoicemailWords(
      { data: [{ sayMessage: "यह Acme की ओर से एक कॉल है।" }] },
      [],
      "hi",
    );

    expect(words).toBe("यह Acme की ओर से एक कॉल है।");
    expect(words).not.toContain("।.");
  });
});
