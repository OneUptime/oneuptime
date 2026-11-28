import CallService from "../../FeatureSet/Notification/Services/CallService";
import ServerTestSendService, {
  SERVER_TEST_CALL_TEXT,
} from "../../FeatureSet/Notification/Services/ServerTestSendService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Project from "Common/Models/DatabaseModels/Project";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import CommonCallService from "Common/Server/Services/CallService";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserCallService from "Common/Server/Services/UserCallService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import getCallInLanguage from "Common/Server/Utils/Call/CallInLanguage";
import UserLanguage from "Common/Server/Utils/Notification/UserLanguage";
import ServerChannelSetup from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import { SERVER_LOCALES } from "Common/Server/Utils/ServerTranslation";
import CallRequest, { Say } from "Common/Types/Call/CallRequest";
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
import { DEFAULT_READER_LANGUAGE } from "Common/Types/ReaderLanguage";
import { ServerTestSendAnswer } from "Common/Types/ServerSetup/ServerTestSend";
import { Translator } from "Common/Types/Translator";
import { CALL_CODE_PAUSE } from "Common/Utils/Call/CallSpeech";
import { MAX_CALL_TWIML_LENGTH } from "Common/Utils/MessageFit";
import {
  PROJECT_TEST_CALL_SENTENCE,
  SERVER_TEST_CALL_SENTENCE,
  getProjectTestCallData,
} from "Common/Utils/Call/TestCall";
import {
  VERIFICATION_CALL_CODE_SENTENCE,
  VERIFICATION_CALL_GOODBYE,
} from "Common/Utils/Call/VerificationCodeCall";
import { DOMParser, Element as XmlElement } from "@xmldom/xmldom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import Twilio from "twilio";

/*
 * THE PHONE NUMBER VERIFICATION CALL AND SEND TEST CALL, IN EVERY LANGUAGE
 * A CALL CAN BE SPOKEN IN, PLACED (#11461).
 *
 * The verification call is written by the real UserCallService for a
 * person who reads each language, carried as the Notification service's
 * route takes it - through JSON - and placed by the Notification service's
 * real CallService through a Twilio account that chose a voice; Make test
 * call by the real ServerTestSendService, for an admin who reads the
 * language; a project's Send Test Call through the project's own account
 * and its voice. Their TwiML is read element by element: in each language a
 * voice of that language, of the account's kind, says the call's words in
 * that language - and only those. The code stays unmistakable: each digit
 * its own <say-as interpret-as="characters">, a pause between two, in its
 * order, three times. The English call is the fallback, word for word as
 * it always was: through an account with no voice chosen, to a person who
 * reads English or Persian - which no Twilio voice speaks.
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
  "0fa11461-0000-4000-8000-000000000e01",
);
const USER_ID: ObjectID = new ObjectID("0fa11461-0000-4000-8000-000000000e02");
const TO: Phone = new Phone("+15555550142");

// The voice the server's account chose: a woman's, in US English.
const ACCOUNT_VOICE: string = "Polly.Joanna-Neural";

const CODE: string = "048291";
const DIGITS: Array<string> = CODE.split("");

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

// Every language a call can be spoken in besides English: each has voices.
const SPOKEN_LANGUAGES: Array<string> = Array.from(
  new Set(
    CALL_LANGUAGE_VOICES.map((voice: SpokenCallVoice): string => {
      return voice.readerLanguage;
    }),
  ),
);

const JOANNA: CallVoice = CALL_VOICES.find((voice: CallVoice): boolean => {
  return voice.value === ACCOUNT_VOICE;
})!;

let createCall: jest.Mock;
let callLogs: Array<CallLog>;
let project: Project;

function elementsOf(twiml: string, tag: string): Array<XmlElement> {
  return Array.from(
    new DOMParser()
      .parseFromString(twiml, "text/xml")
      .getElementsByTagName(tag),
  );
}

// What each <Say> says, its spelled characters left as they are.
function saidIn(twiml: string): Array<string> {
  return elementsOf(twiml, "Say").map((say: XmlElement): string => {
    return say.textContent || "";
  });
}

// The characters each <say-as> of a <Say> spells, in order.
function spelledBy(say: XmlElement): Array<string> {
  return Array.from(say.getElementsByTagName("say-as")).map(
    (sayAs: XmlElement): string => {
      expect(sayAs.getAttribute("interpret-as")).toBe("characters");
      return sayAs.textContent || "";
    },
  );
}

function pausesOf(say: XmlElement): Array<string> {
  return Array.from(say.getElementsByTagName("break")).map(
    (pause: XmlElement): string => {
      return pause.getAttribute("time") || "";
    },
  );
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

// A locale's own words for a key, the product and code filled as a call fills them.
function wordsOf(
  language: string,
  key: string,
  values: Record<string, string>,
): string {
  let words: string = SERVER_LOCALES[language]![key]!;

  for (const [name, value] of Object.entries(values)) {
    words = words.replace(`{{${name}}}`, value);
  }

  return words;
}

// As the Notification service's /make-call route reads a call request: through JSON.
function overTheWire(callRequest: CallRequest): CallRequest {
  return JSONFunctions.deserialize(
    JSON.parse(
      JSON.stringify(JSONFunctions.serialize({ callRequest: callRequest })),
    ),
  )["callRequest"] as unknown as CallRequest;
}

/*
 * The verification call UserCallService writes for a person who reads
 * `language` - read, as it reads it, from their account - as the
 * Notification service receives it.
 */
async function verificationCall(
  language: string,
  code: string = CODE,
): Promise<{ callRequest: CallRequest; options: JSONObject }> {
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

  await UserCallService.sendVerificationCode(userCall, code);

  expect(makeCall).toHaveBeenCalledTimes(1);
  expect(UserLanguage.getLanguage).toHaveBeenCalledWith(USER_ID);

  const [callRequest, options] = makeCall.mock.calls[0] as [
    CallRequest,
    JSONObject,
  ];

  makeCall.mockRestore();

  return { callRequest: overTheWire(callRequest), options: options };
}

// The TwiML handed to Twilio, and the call's log.
async function place(
  callRequest: CallRequest,
  options: {
    isSensitive?: boolean;
    customTwilioConfig?: TwilioConfig | undefined;
  } = {},
): Promise<{ twiml: string; log: CallLog; created: JSONObject }> {
  await CallService.makeCall(callRequest, {
    projectId: PROJECT_ID,
    isSensitive: options.isSensitive,
    customTwilioConfig: options.customTwilioConfig,
  });

  expect(createCall).toHaveBeenCalledTimes(1);
  expect(callLogs).toHaveLength(1);

  const created: JSONObject = createCall.mock.calls[0]![0] as JSONObject;

  return {
    twiml: String(created["twiml"]),
    log: callLogs[0]!,
    created: created,
  };
}

// The TwiML of the call every release made, through the same account.
async function legacyTwiml(
  callRequest: CallRequest,
  options: { isSensitive?: boolean } = {},
): Promise<string> {
  createCall.mockClear();
  callLogs = [];

  return (await place(callRequest, options)).twiml;
}

beforeEach(() => {
  (getCallAndSmsGateway as unknown as jest.Mock).mockReset();
  (getCallAndSmsGateway as unknown as jest.Mock).mockResolvedValue(null);
  (getTwilioConfig as unknown as jest.Mock).mockReset();
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    accountWith(ACCOUNT_VOICE),
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(
  SPOKEN_LANGUAGES.map((language: string): [string] => {
    return [language];
  }),
)("the verification call to a person who reads %s", (language: string) => {
  const voice: SpokenCallVoice = getCallVoiceForLanguage(JOANNA, language)!;

  test("is said in the language, by its woman's voice, every <Say> telling Twilio the language", async () => {
    const { callRequest, options } = await verificationCall(language);

    expect(callRequest.inLanguage?.language).toBe(language);
    expect(options["isSensitive"]).toBe(true);

    const { twiml } = await place(callRequest, { isSensitive: true });

    expect(voice.gender).toBe("female");
    expectEverySayIn(twiml, voice);
    expect(elementsOf(twiml, "Say")).toHaveLength(5);
    // None of the English call's words.
    expect(twiml).not.toContain("This is a call from");
    expect(twiml).not.toContain("Your verification code");
    expect(twiml).not.toContain("Thank you for using");
    expect(twiml).not.toContain("Good bye");
    expect(twiml.length).toBeLessThanOrEqual(MAX_CALL_TWIML_LENGTH);
  });

  test("says who calls, and goodbye, in the language's own words", async () => {
    const { callRequest } = await verificationCall(language);
    const said: Array<string> = saidIn(
      (await place(callRequest, { isSensitive: true })).twiml,
    );

    expect(said[0]).toBe(
      wordsOf(language, "This is a call from {{project}}.", {
        project: "One Uptime",
      }),
    );
    expect(said[4]).toBe(
      wordsOf(language, VERIFICATION_CALL_GOODBYE, { product: "One Uptime" }),
    );
  });

  test("says the code three times, each digit its own <say-as>, in order, a pause between two", async () => {
    const { callRequest } = await verificationCall(language);
    const { twiml } = await place(callRequest, { isSensitive: true });
    const says: Array<XmlElement> = elementsOf(twiml, "Say");

    for (const index of [1, 2, 3]) {
      const say: XmlElement = says[index]!;

      expect(spelledBy(say)).toEqual(DIGITS);
      expect(pausesOf(say)).toEqual(
        Array(DIGITS.length - 1).fill(CALL_CODE_PAUSE),
      );
    }

    // The code is never one number, nor spaced-out text, in the language's voice.
    expect(twiml).not.toContain(CODE);
    expect(twiml).not.toContain("0  4  8");
    // Only the code sentences spell anything.
    expect(spelledBy(says[0]!)).toEqual([]);
    expect(spelledBy(says[4]!)).toEqual([]);
  });

  test("the words around the code are the language's own sentence, the code where the language puts it", async () => {
    const { callRequest } = await verificationCall(language);
    const { twiml } = await place(callRequest, { isSensitive: true });
    const sentence: string =
      SERVER_LOCALES[language]![VERIFICATION_CALL_CODE_SENTENCE]!;
    const [before, after] = sentence.split("{{code}}") as [string, string];

    for (const said of saidIn(twiml).slice(1, 4)) {
      // The <say-as> digits read as they are, in order, between the language's words.
      expect(said).toBe(`${before}${DIGITS.join("")}${after}`);
    }
  });

  test("is sensitive: its log keeps neither the code nor what it said", async () => {
    const { callRequest } = await verificationCall(language);
    const { log } = await place(callRequest, { isSensitive: true });

    expect(log.callData).toEqual({
      message: "This call is sensitive and is not logged",
    });
    expect(JSON.stringify(log)).not.toContain("0  4  8");
  });

  test("is no on-call page: nobody is asked who answered it", async () => {
    const { callRequest } = await verificationCall(language);
    const { created } = await place(callRequest, { isSensitive: true });

    expect(created["machineDetection"]).toBeUndefined();
    expect(created["asyncAmd"]).toBeUndefined();
  });
});

describe("the verification call, more ways", () => {
  test("a man's voice chosen speaks each language with its man's voice", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
      accountWith("Polly.Brian-Neural"),
    );

    for (const language of ["de", "ja", "ru", "ar"]) {
      createCall.mockClear();
      callLogs = [];

      const { callRequest } = await verificationCall(language);
      const { twiml } = await place(callRequest, { isSensitive: true });
      const man: SpokenCallVoice = getCallVoiceForLanguage(
        CALL_VOICES.find((voice: CallVoice): boolean => {
          return voice.value === "Polly.Brian-Neural";
        })!,
        language,
      )!;

      expect([language, man.gender]).toEqual([language, "male"]);
      expectEverySayIn(twiml, man);
    }
  });

  test("leading zeros are said as their digits, never dropped", async () => {
    const { callRequest } = await verificationCall("fr", "000123");
    const { twiml } = await place(callRequest, { isSensitive: true });

    expect(spelledBy(elementsOf(twiml, "Say")[1]!)).toEqual([
      "0",
      "0",
      "0",
      "1",
      "2",
      "3",
    ]);
  });

  test("to a person who reads English: word for word the TwiML every release made", async () => {
    const { callRequest } = await verificationCall("en");

    expect(callRequest.inLanguage).toBeUndefined();

    const now: string = (await place(callRequest, { isSensitive: true })).twiml;
    const before: string = await legacyTwiml(
      {
        to: TO,
        data: [
          { sayMessage: "This is a call from OneUptime." },
          { sayMessage: "Your verification code is 0  4  8  2  9  1" },
          { sayMessage: "Your verification code is 0  4  8  2  9  1" },
          { sayMessage: "Your verification code is 0  4  8  2  9  1" },
          { sayMessage: "Thank you for using OneUptime. Good bye." },
        ],
      },
      { isSensitive: true },
    );

    expect(now).toBe(before);
    expect(saidIn(now)[1]).toBe("Your verification code is 0  4  8  2  9  1");
  });

  test("through an account that chose no voice: English, word for word, in the account's default voice", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(accountWith());

    const { callRequest } = await verificationCall("de");
    const { twiml } = await place(callRequest, { isSensitive: true });

    for (const say of elementsOf(twiml, "Say")) {
      expect(say.hasAttribute("voice")).toBe(false);
      expect(say.hasAttribute("language")).toBe(false);
    }

    expect(saidIn(twiml)).toEqual([
      "This is a call from One Uptime.",
      "Your verification code is 0  4  8  2  9  1",
      "Your verification code is 0  4  8  2  9  1",
      "Your verification code is 0  4  8  2  9  1",
      "Thank you for using One Uptime. Good bye.",
    ]);
  });

  test("to a person who reads Persian: its Persian goes with it for a gateway, and Twilio says the English, in the account's voice", async () => {
    const { callRequest } = await verificationCall("fa");

    expect(callRequest.inLanguage?.language).toBe("fa");

    const { twiml } = await place(callRequest, { isSensitive: true });

    expectEverySayIn(twiml, JOANNA);
    expect(saidIn(twiml)[1]).toBe("Your verification code is 0  4  8  2  9  1");
  });

  test("a person whose language cannot be read is called in English, and the call goes out", async () => {
    jest
      .spyOn(UserLanguage, "getLanguage")
      .mockResolvedValue(DEFAULT_READER_LANGUAGE);

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

    await UserCallService.sendVerificationCode(userCall, CODE);

    expect(
      (makeCall.mock.calls[0]![0] as CallRequest).inLanguage,
    ).toBeUndefined();
  });

  test("through a project's own Twilio config, with its own voice: that voice's kind in the language", async () => {
    const { callRequest } = await verificationCall("ko");
    const { twiml } = await place(callRequest, {
      isSensitive: true,
      customTwilioConfig: accountWith("Google.en-US-Neural2-J"),
    });
    const korean: SpokenCallVoice = getCallVoiceForLanguage(
      CALL_VOICES.find((voice: CallVoice): boolean => {
        return voice.value === "Google.en-US-Neural2-J";
      })!,
      "ko",
    )!;

    expect(korean.value).toBe("Google.ko-KR-Neural2-C");
    expectEverySayIn(twiml, korean);
    expect(spelledBy(elementsOf(twiml, "Say")[2]!)).toEqual(DIGITS);
  });
});

describe.each(
  SPOKEN_LANGUAGES.map((language: string): [string] => {
    return [language];
  }),
)("Make test call for an admin who reads %s", (language: string) => {
  beforeEach(() => {
    jest
      .spyOn(ServerSendingStatus, "readConfig")
      .mockResolvedValue(new GlobalConfig());
    jest.spyOn(ServerChannelSetup, "readSetUpProblem").mockReturnValue(null);
  });

  test("is said in the language, by its voice, through the server's account", async () => {
    const answer: ServerTestSendAnswer = await ServerTestSendService.makeCall(
      TO,
      language,
    );

    expect(answer.message).toBeNull();
    expect(createCall).toHaveBeenCalledTimes(1);

    const twiml: string = String(
      (createCall.mock.calls[0]![0] as JSONObject)["twiml"],
    );

    expectEverySayIn(twiml, getCallVoiceForLanguage(JOANNA, language)!);
    expect(saidIn(twiml)).toEqual([
      wordsOf(language, SERVER_TEST_CALL_SENTENCE, { product: "One Uptime" }),
    ]);
    expect(twiml).not.toContain("This is a test call");
  });
});

describe("Make test call, more ways", () => {
  beforeEach(() => {
    jest
      .spyOn(ServerSendingStatus, "readConfig")
      .mockResolvedValue(new GlobalConfig());
    jest.spyOn(ServerChannelSetup, "readSetUpProblem").mockReturnValue(null);
  });

  test("for an admin who reads English, or with no language given: word for word as before", async () => {
    for (const language of ["en", undefined]) {
      createCall.mockClear();

      await ServerTestSendService.makeCall(TO, language);

      const twiml: string = String(
        (createCall.mock.calls[0]![0] as JSONObject)["twiml"],
      );

      expectEverySayIn(twiml, JOANNA);
      expect(saidIn(twiml)).toEqual([
        SERVER_TEST_CALL_TEXT.replace("OneUptime", "One Uptime"),
      ]);
    }
  });

  test("for an admin who reads Persian: English, as Twilio has no Persian voice", async () => {
    await ServerTestSendService.makeCall(TO, "fa");

    expect(
      saidIn(String((createCall.mock.calls[0]![0] as JSONObject)["twiml"])),
    ).toEqual([
      "This is a test call from One Uptime. Calls from this server work.",
    ]);
  });
});

describe.each(
  SPOKEN_LANGUAGES.map((language: string): [string] => {
    return [language];
  }),
)(
  "a project's Send Test Call for a member who reads %s",
  (language: string) => {
    test("is said in the language, by a voice of the project's own account's kind", async () => {
      const callRequest: CallRequest = {
        to: TO,
        data: getProjectTestCallData(),
      };
      callRequest.inLanguage = getCallInLanguage(
        language,
        (translator: Translator): CallRequest["data"] => {
          return getProjectTestCallData(translator);
        },
      );

      const { twiml } = await place(callRequest, {
        customTwilioConfig: accountWith("Polly.Matthew-Neural"),
      });
      const voice: SpokenCallVoice = getCallVoiceForLanguage(
        CALL_VOICES.find((candidate: CallVoice): boolean => {
          return candidate.value === "Polly.Matthew-Neural";
        })!,
        language,
      )!;

      expectEverySayIn(twiml, voice);
      expect(saidIn(twiml)).toEqual([
        wordsOf(language, PROJECT_TEST_CALL_SENTENCE, {
          product: "One Uptime",
        }),
      ]);
      expect((callRequest.data[0] as Say).sayMessage).toBe(
        "This is a test call from OneUptime.",
      );
    });
  },
);
