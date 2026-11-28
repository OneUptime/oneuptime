import CallService, {
  SpokenCallTwiml,
} from "../../FeatureSet/Notification/Services/CallService";
import {
  VOICEMAIL_MESSAGE_CALL_DATA_KEY,
  VOICEMAIL_VOICE_CALL_DATA_KEY,
  getVoicemailMessage,
} from "../../FeatureSet/Notification/Utils/AnsweredBy";
import { getVoicemailVoiceOfCall } from "../../FeatureSet/Notification/Utils/VoicemailCallback";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import OnCallKeypadToken, {
  OnCallKeypadTokenReading,
} from "Common/Server/Utils/OnCall/OnCallKeypadToken";
import OnCallPageLinks from "Common/Server/Utils/OnCall/OnCallPageLinks";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import URL from "Common/Types/API/URL";
import CallRequest from "Common/Types/Call/CallRequest";
import {
  CALL_LANGUAGE_VOICES,
  CALL_VOICES,
  CallVoice,
  SpokenCallVoice,
  getCallVoiceForLanguage,
} from "Common/Types/Call/CallVoice";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { MAX_CALL_TWIML_LENGTH } from "Common/Utils/MessageFit";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { DOMParser, Element as XmlElement } from "@xmldom/xmldom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * A PAGE'S CALL IN EVERY LANGUAGE IT CAN BE SPOKEN IN, PLACED (#11066).
 *
 * The call is written by the worker's real template in the person's
 * language and placed by the Notification service's real CallService
 * through a Twilio account that chose a voice. Its TwiML is read element by
 * element: in each language a voice of that language, of the account's
 * kind, speaks the call's words in that language - and only those - with
 * the record number's SSML. The English call is the fallback: through an
 * account with no voice chosen, to a person who reads Persian, and for a
 * call whose words in another language cannot be built. The call's log and
 * the message it leaves on voicemail say what it said, in its language.
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
  "0fa11066-0000-4000-8000-000000000d01",
);

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "0fa11066-0000-4000-8000-000000000d02",
);

// The voice the server's account chose: a woman's, in US English.
const ACCOUNT_VOICE: string = "Polly.Joanna-Neural";

const accountWith: (voice?: string | undefined) => TwilioConfig = (
  voice?: string | undefined,
): TwilioConfig => {
  return {
    accountSid: "AC-account",
    authToken: "auth-token",
    primaryPhoneNumber: new Phone("+14155550100"),
    secondaryPhoneNumbers: [],
    ...(voice ? { callVoice: voice } : {}),
  };
};

let createCall: jest.Mock;
let callLogs: Array<CallLog>;
let project: Project;
let timeline: OnCallTimelineRows;

function incident(title: string = "Checkout API is down"): Incident {
  const model: Incident = new Incident();
  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  const owner: Project = new Project();
  owner.name = "Acme Production";
  model.project = owner;
  model.title = title;
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
}

// The page's call, written by the worker's own template for a reader of `language`.
async function pageCall(
  language: string,
  title?: string | undefined,
): Promise<CallRequest> {
  return await UserNotificationRuleService.generateCallTemplateForIncidentCreated(
    new Phone("+15555550142"),
    incident(title),
    NOTIFICATION_ID,
    undefined,
    undefined,
    false,
    getServerTranslator(language),
  );
}

function elementsOf(twiml: string, tag: string): Array<XmlElement> {
  return Array.from(
    new DOMParser()
      .parseFromString(twiml, "text/xml")
      .getElementsByTagName(tag),
  );
}

function saidIn(twiml: string): Array<string> {
  return elementsOf(twiml, "Say").map((say: XmlElement): string => {
    return say.textContent || "";
  });
}

function keypadOf(twiml: string): OnCallKeypadTokenReading {
  const action: globalThis.URL = new globalThis.URL(
    elementsOf(twiml, "Gather")[0]!.getAttribute("action")!,
  );

  return OnCallKeypadToken.read({
    claims: JSONFunctions.deserialize(
      JSONWebToken.decodeJsonPayload(action.searchParams.get("token")!),
    ),
    userOnCallLogTimelineId: NOTIFICATION_ID,
    pageToken: undefined,
  });
}

function expectEverySayIn(twiml: string, voice: SpokenCallVoice): void {
  const says: Array<XmlElement> = elementsOf(twiml, "Say");

  expect(says.length).toBeGreaterThan(0);

  for (const say of says) {
    expect([say.getAttribute("voice"), say.getAttribute("language")]).toEqual([
      voice.value,
      voice.language,
    ]);
  }
}

beforeEach(() => {
  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    accountWith(ACCOUNT_VOICE),
  );

  jest
    .spyOn(OnCallPageLinks, "getCallResponseUrl")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/${NOTIFICATION_ID.toString()}`,
      ),
    );

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
  project.name = "Acme Production";
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  project.incidentNumberPrefix = "INC-";

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

// The TwiML handed to Twilio, and the call's log.
async function place(callRequest: CallRequest): Promise<{
  twiml: string;
  log: CallLog;
}> {
  await CallService.makeCall(callRequest, {
    projectId: PROJECT_ID,
    userOnCallLogTimelineId: NOTIFICATION_ID,
  });

  expect(createCall).toHaveBeenCalledTimes(1);
  expect(callLogs).toHaveLength(1);

  return {
    twiml: String((createCall.mock.calls[0]![0] as JSONObject)["twiml"]),
    log: callLogs[0]!,
  };
}

const JOANNA: CallVoice = CALL_VOICES.find((voice: CallVoice): boolean => {
  return voice.value === ACCOUNT_VOICE;
})!;

describe.each(
  Array.from(
    new Set(
      CALL_LANGUAGE_VOICES.map((voice: SpokenCallVoice): string => {
        return voice.readerLanguage;
      }),
    ),
  ).map((language: string): [string] => {
    return [language];
  }),
)("a page's call to a person who reads %s", (language: string) => {
  const voice: SpokenCallVoice = getCallVoiceForLanguage(JOANNA, language)!;

  test("is said in the language, by its woman's voice, every <Say> telling Twilio the language", async () => {
    const callRequest: CallRequest = await pageCall(language);
    const { twiml } = await place(callRequest);

    expect(voice.gender).toBe("female");
    expectEverySayIn(twiml, voice);
    // None of the English call's words.
    expect(twiml).not.toContain("This is a call from");
    expect(twiml).not.toContain("Press 1");
    expect(twiml).not.toContain("Good bye");
    // The team's title, as written.
    expect(twiml).toContain("Checkout API is down");
    // The record's prefix spelled with SSML, in the language's voice.
    expect(twiml).toContain('<say-as interpret-as="characters">INC</say-as>');
    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
  });

  test("its keypad token carries the language's prompt, answers and voice", async () => {
    const callRequest: CallRequest = await pageCall(language);
    const { twiml } = await place(callRequest);
    const keypad: OnCallKeypadTokenReading = keypadOf(twiml);
    const prompt: string = saidIn(twiml)[3]!;

    expect(keypad).toMatchObject({
      isAccepted: true,
      voice: voice.value,
      prompt: { sayMessage: prompt, timeoutInSeconds: 10 },
    });
    expect(prompt).toContain("1");
    expect(prompt).toContain("2");
    expect(
      (keypad as unknown as { answers: { "1": { sayMessage: string } } })
        .answers["1"].sayMessage,
    ).not.toContain("You have acknowledged");
  });

  test("its log says what it said, in the language, and voicemail is left in it, by its voice", async () => {
    const callRequest: CallRequest = await pageCall(language);
    const { log } = await place(callRequest);
    const callData: JSONObject = log.callData as unknown as JSONObject;
    const said: Array<string> = callRequest
      .inLanguage!.data.filter((item: unknown): boolean => {
        return typeof (item as { sayMessage?: string }).sayMessage === "string";
      })
      .map((item: unknown): string => {
        return (item as { sayMessage: string }).sayMessage;
      });

    expect(String(callData["message"])).toContain(said[0]!);
    expect(String(callData["message"])).not.toContain("This is a call from");

    const voicemail: string = String(callData[VOICEMAIL_MESSAGE_CALL_DATA_KEY]);
    // What to do, in the language: what a message of any words ends with.
    const closing: string = getVoicemailMessage("x", language).slice(
      "x ".length,
    );

    expect(voicemail).toContain(said[0]!);
    expect(voicemail.endsWith(closing)).toBe(true);
    expect(closing).not.toBe("Open OneUptime to respond. Good bye.");
    expect(voicemail).not.toContain("Good bye");
    expect(getVoicemailVoiceOfCall(callData)).toBe(voice.value);
    expect(callData[VOICEMAIL_VOICE_CALL_DATA_KEY]).toBe(voice.value);
    // And the message left is said by that voice, in its language.
    expectEverySayIn(
      CallService.generateVoicemailTwiml(voicemail, {
        voice: getVoicemailVoiceOfCall(callData),
      }),
      voice,
    );
  });
});

describe("a man's voice chosen", () => {
  test("speaks each language with its man's voice", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
      accountWith("Polly.Brian-Neural"),
    );

    const { twiml } = await place(await pageCall("ru"));
    const russian: SpokenCallVoice = CALL_LANGUAGE_VOICES.find(
      (voice: SpokenCallVoice): boolean => {
        return voice.value === "Google.ru-RU-Wavenet-B";
      },
    )!;

    expectEverySayIn(twiml, russian);
    expect(saidIn(twiml)[0]).toBe("Это звонок от Acme Production.");
  });
});

describe("the English call", () => {
  test("is the call through an account that chose no voice: its default voice speaks English only", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(accountWith());

    const callRequest: CallRequest = await pageCall("de");
    const { twiml, log } = await place(callRequest);

    for (const say of elementsOf(twiml, "Say")) {
      expect(say.hasAttribute("voice")).toBe(false);
      expect(say.hasAttribute("language")).toBe(false);
    }

    expect(saidIn(twiml)[0]).toBe("This is a call from Acme Production.");
    expect(saidIn(twiml)[1]).toBe(
      "A new Critical Incident has been created: I N C 42.",
    );
    expect(
      String((log.callData as unknown as JSONObject)["message"]),
    ).toContain("This is a call from Acme Production.");
    expect(
      (log.callData as unknown as JSONObject)[VOICEMAIL_VOICE_CALL_DATA_KEY],
    ).toBeUndefined();
  });

  test("is the call to a person who reads Persian, in the voice the account chose", async () => {
    const callRequest: CallRequest = await pageCall("fa");

    /*
     * Its Persian words go with it, for a call and SMS gateway that may
     * have a Persian voice (#11459) - but no Twilio voice speaks Persian,
     * so through Twilio the call is the English one.
     */
    expect(callRequest.inLanguage?.language).toBe("fa");

    const { twiml, log } = await place(callRequest);

    expect(twiml).not.toContain(
      (callRequest.inLanguage!.data[0] as { sayMessage: string }).sayMessage,
    );

    expectEverySayIn(twiml, JOANNA);
    expect(saidIn(twiml)[0]).toBe("This is a call from Acme Production.");
    expect(
      String(
        (log.callData as unknown as JSONObject)[
          VOICEMAIL_MESSAGE_CALL_DATA_KEY
        ],
      ),
    ).toContain("Open OneUptime to respond. Good bye.");
  });

  test("is the call to a person who reads English, word for word as every call was", async () => {
    const callRequest: CallRequest = await pageCall("en");

    expect(callRequest.inLanguage).toBeUndefined();

    const { twiml } = await place(callRequest);

    expectEverySayIn(twiml, JOANNA);
    // Who calls, the headline in one sentence, then the keys.
    expect(saidIn(twiml)[2]).toBe("Press 1 to acknowledge, or 2 to escalate.");
  });

  test("is built when the call's words in another language cannot be: the page is placed in English, never German in an English voice", async () => {
    const original: (...args: Array<unknown>) => unknown = (
      CallService as unknown as {
        generateFittedTwiml: (...args: Array<unknown>) => unknown;
      }
    ).generateFittedTwiml;

    jest
      .spyOn(
        CallService as unknown as {
          generateFittedTwiml: (...args: Array<unknown>) => unknown;
        },
        "generateFittedTwiml",
      )
      .mockImplementation(function (
        this: unknown,
        ...args: Array<unknown>
      ): unknown {
        const speech: { voice?: string } = args[1] as { voice?: string };

        if (speech.voice === "Polly.Vicki-Neural") {
          throw new Error("The German voice could not be built.");
        }

        return original.apply(this, args);
      });

    const built: SpokenCallTwiml = CallService.generateSpokenTwimlForCall(
      await pageCall("de"),
      { userOnCallLogTimelineId: NOTIFICATION_ID, voice: ACCOUNT_VOICE },
    );

    expect(built.spoken.language).toBe("en");
    expect(built.spoken.voice).toBe(ACCOUNT_VOICE);
    expectEverySayIn(built.twiml, JOANNA);
    expect(saidIn(built.twiml)[0]).toBe("This is a call from Acme Production.");
    // Its keypad token says the same: English answers, in Joanna.
    expect(keypadOf(built.twiml)).toMatchObject({
      isAccepted: true,
      voice: ACCOUNT_VOICE,
      prompt: { sayMessage: "Press 1 to acknowledge, or 2 to escalate." },
    });
  });
});

describe("the longest call, in every language", () => {
  test("still fits in Twilio's TwiML: a title of 500 characters and a long project name", async () => {
    for (const language of [
      "de",
      "ru",
      "hi",
      "ar",
      "ja",
      "zh-TW",
      "ko",
      "fr",
    ]) {
      createCall.mockClear();
      callLogs = [];

      const { twiml } = await place(await pageCall(language, "x".repeat(500)));

      expect([language, twiml.length <= MAX_CALL_TWIML_LENGTH]).toEqual([
        language,
        true,
      ]);
      // The prompt is never cut.
      expect(elementsOf(twiml, "Gather")).toHaveLength(1);
    }
  });
});
