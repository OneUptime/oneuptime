import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import { PHONE_CODE_NOT_SENT_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/AddWaysToReach";
import {
  PAGING_LADDER_DEFAULT_START_COPY,
  describeDefaultStartLeftOut,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderWords";
import {
  NOT_SENT_RIGHT_NOW,
  SMS_AND_CALLS_NOT_SENT_COPY,
  StepsNotSentNowLine,
  getChannelsNotSentNow,
  getChannelsNotSentNowInSteps,
  getStepsNotSentNowLines,
  isStepNotSentNow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/StepsNotSentNow";
import {
  SERVER_CANNOT_SEND_COPY,
  ServerCannotSendChannel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ServerCannotSendPanel";
import { PagingLadderStep } from "../../../Types/NotificationRule/PagingLadder";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { PROJECT_CAN_SEND_EVERYTHING } from "../../../Types/ServerSending/ProjectCanSend";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * HOW TO REACH ME'S WORDS FOR THE PROJECT'S DEFAULT (#9445) AND FOR WHAT
 * THIS SERVER CAN'T SEND (#9446).
 *
 *   - which channels a step is marked for: only a plain "no" from GET
 *     /project-can-send, in Notification Methods' order, and SMS and calls
 *     said in one sentence when both are stopped;
 *   - what Start From the Project's Default says it left out, for your own
 *     page and a member's, in English and, through the Dashboard's own
 *     locale files, in German (a long language) and Persian (read right to
 *     left);
 *   - every new sentence translated in every Dashboard language, its
 *     placeholders kept.
 */

type Locale = Record<string, string>;

const LOCALES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const translatorFor: (locale: Locale, language: string) => Translator = (
  locale: Locale,
  language: string,
): Translator => {
  return createTranslator((text: string) => {
    return locale[text];
  }, language);
};

const ENGLISH: Translator = translatorFor(
  englishLocale as unknown as Locale,
  "en",
);
const GERMAN: Translator = translatorFor(
  germanLocale as unknown as Locale,
  "de",
);
const PERSIAN: Translator = translatorFor(
  persianLocale as unknown as Locale,
  "fa",
);

const step: (
  methodColumn: PagingLadderStep["methodColumn"],
  notifyAfterMinutes: number,
) => PagingLadderStep = (
  methodColumn: PagingLadderStep["methodColumn"],
  notifyAfterMinutes: number,
): PagingLadderStep => {
  return {
    methodColumn: methodColumn,
    methodId: `${methodColumn}-1`,
    notifyAfterMinutes: notifyAfterMinutes,
  };
};

describe("which steps this server can't send right now (#9446)", () => {
  test("only a plain no marks a channel: not while the answer is unknown, nor when it is yes", () => {
    expect(getChannelsNotSentNow(null)).toEqual([]);
    expect(getChannelsNotSentNow(undefined)).toEqual([]);
    expect(getChannelsNotSentNow({ ...PROJECT_CAN_SEND_EVERYTHING })).toEqual(
      [],
    );
    expect(
      getChannelsNotSentNow({ email: false, sms: false, call: false }),
    ).toEqual([
      OnCallPageChannel.Email,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ]);
    expect(
      getChannelsNotSentNow({ email: true, sms: false, call: true }),
    ).toEqual([OnCallPageChannel.SMS]);
  });

  test("a step is marked by its method's channel; push, chat and webhooks never are", () => {
    const stopped: Array<OnCallPageChannel> = getChannelsNotSentNow({
      email: false,
      sms: false,
      call: false,
    });

    expect(isStepNotSentNow(step("userEmailId", 0), stopped)).toBe(true);
    expect(isStepNotSentNow(step("userSmsId", 0), stopped)).toBe(true);
    expect(isStepNotSentNow(step("userCallId", 0), stopped)).toBe(true);

    for (const column of [
      "userPushId",
      "userWhatsAppId",
      "userTelegramId",
      "userSlackId",
      "userMicrosoftTeamsId",
      "userMattermostId",
      "userWebhookId",
      "customNotificationChannelId",
    ] as Array<PagingLadderStep["methodColumn"]>) {
      expect([column, isStepNotSentNow(step(column, 0), stopped)]).toEqual([
        column,
        false,
      ]);
    }
  });

  test("the page names only the stopped channels its steps use, each once, in Notification Methods' order", () => {
    const stopped: Array<OnCallPageChannel> = [
      OnCallPageChannel.Email,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Call,
    ];

    expect(
      getChannelsNotSentNowInSteps(
        [
          step("userCallId", 10),
          step("userPushId", 0),
          step("userCallId", 0),
          step("userEmailId", 5),
        ],
        stopped,
      ),
    ).toEqual([OnCallPageChannel.Email, OnCallPageChannel.Call]);
    expect(getChannelsNotSentNowInSteps([], stopped)).toEqual([]);
    expect(getChannelsNotSentNowInSteps([step("userEmailId", 0)], [])).toEqual(
      [],
    );
  });

  test("one sentence a channel, in Notification Methods' words; SMS and calls together in one", () => {
    const keys: (channels: Array<OnCallPageChannel>) => Array<string> = (
      channels: Array<OnCallPageChannel>,
    ): Array<string> => {
      return getStepsNotSentNowLines(channels).map(
        (line: StepsNotSentNowLine): string => {
          return line.key;
        },
      );
    };

    expect(keys([])).toEqual([]);
    expect(keys([OnCallPageChannel.Email])).toEqual(["email"]);
    expect(keys([OnCallPageChannel.SMS])).toEqual(["sms"]);
    expect(keys([OnCallPageChannel.Call])).toEqual(["call"]);
    expect(keys([OnCallPageChannel.SMS, OnCallPageChannel.Call])).toEqual([
      "sms-and-call",
    ]);
    expect(
      keys([
        OnCallPageChannel.Call,
        OnCallPageChannel.Email,
        OnCallPageChannel.SMS,
      ]),
    ).toEqual(["email", "sms-and-call"]);

    const [email, sms]: Array<StepsNotSentNowLine> = getStepsNotSentNowLines([
      OnCallPageChannel.Email,
      OnCallPageChannel.SMS,
    ]);

    // The very sentences Notification Methods says over the lists.
    expect(email!.words).toBe(
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.Email],
    );
    expect(sms!.words).toBe(
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.SMS],
    );
    // A master admin sets SMS and calls up in one place.
    expect(
      getStepsNotSentNowLines([
        OnCallPageChannel.SMS,
        OnCallPageChannel.Call,
      ])[0]!.fixChannel,
    ).toBe(ServerCannotSendChannel.SMS);
  });

  test("never an error, a provider's words or a setting: who can fix it, and nothing else", () => {
    for (const sentence of [
      SMS_AND_CALLS_NOT_SENT_COPY.member,
      SMS_AND_CALLS_NOT_SENT_COPY.admin,
      PHONE_CODE_NOT_SENT_COPY.member,
      PHONE_CODE_NOT_SENT_COPY.admin,
      NOT_SENT_RIGHT_NOW,
    ]) {
      expect(sentence).not.toMatch(/twilio|smtp|error|failed|api key/i);
    }

    for (const words of [
      SMS_AND_CALLS_NOT_SENT_COPY,
      PHONE_CODE_NOT_SENT_COPY,
    ]) {
      expect(words.member).toContain("Ask your server's admin");
      expect(words.admin).toContain("Admin Dashboard");
    }
  });

  test("Add your phone says what Notification Methods says of SMS, with the code in the middle, and nothing of what else reaches you", () => {
    const panel: { member: string; admin: string } =
      SERVER_CANNOT_SEND_COPY[ServerCannotSendChannel.SMS];

    for (const key of ["member", "admin"] as const) {
      const sentences: Array<string> = panel[key].split(
        ", so these numbers get no SMS. ",
      );
      expect(sentences).toHaveLength(2);

      expect(PHONE_CODE_NOT_SENT_COPY[key]).toBe(
        `${sentences[0]}, so it can't text you a code to add your number. ${sentences[1]}`,
      );
      // The server may not send email either: the ladder above says so.
      expect(PHONE_CODE_NOT_SENT_COPY[key]).not.toMatch(/email|the app/i);
    }
  });
});

describe("what Start From the Project's Default says it left out (#9445)", () => {
  test("nothing left out says nothing", () => {
    expect(
      describeDefaultStartLeftOut({
        translator: ENGLISH,
        leftOutChannels: [],
        keptChannels: [OnCallPageChannel.Email],
      }),
    ).toBe("");
  });

  test("your own page names the channels you have not verified", () => {
    expect(
      describeDefaultStartLeftOut({
        translator: ENGLISH,
        leftOutChannels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
        keptChannels: [],
      }),
    ).toBe(
      "You have not verified SMS, phone call yet, so those steps are left out.",
    );
  });

  test("and what of yours stays meanwhile, never a custom channel, which is nobody's own", () => {
    expect(
      describeDefaultStartLeftOut({
        translator: ENGLISH,
        leftOutChannels: [OnCallPageChannel.Telegram],
        keptChannels: [
          OnCallPageChannel.Email,
          OnCallPageChannel.CustomChannel,
        ],
      }),
    ).toBe(
      "You have not verified Telegram yet, so those steps are left out, and your own email steps stay meanwhile.",
    );
    expect(
      describeDefaultStartLeftOut({
        translator: ENGLISH,
        leftOutChannels: [OnCallPageChannel.Telegram],
        keptChannels: [OnCallPageChannel.CustomChannel],
      }),
    ).toBe("You have not verified Telegram yet, so those steps are left out.");
  });

  test("a member's page names the member", () => {
    expect(
      describeDefaultStartLeftOut({
        translator: ENGLISH,
        leftOutChannels: [OnCallPageChannel.SMS],
        keptChannels: [OnCallPageChannel.Call],
        memberName: "Ana",
      }),
    ).toBe(
      "Ana has not verified SMS yet, so those steps are left out, and their own phone call steps stay meanwhile.",
    );
  });

  test("in German and in Persian, through the Dashboard's own locales, with every name in its place", () => {
    const german: string = describeDefaultStartLeftOut({
      translator: GERMAN,
      leftOutChannels: [OnCallPageChannel.SMS],
      keptChannels: [OnCallPageChannel.Email],
    });

    expect(german).toContain("noch nicht verifiziert");
    expect(german).toContain("SMS");
    expect(german).not.toContain("{{");
    expect(german).not.toContain("have not verified");

    const persian: string = describeDefaultStartLeftOut({
      translator: PERSIAN,
      leftOutChannels: [OnCallPageChannel.SMS],
      keptChannels: [],
      memberName: "Ana",
    });

    expect(persian).toContain("Ana");
    expect(persian).toContain("تأیید نکرده است");
    expect(persian).not.toContain("{{");
  });
});

describe("the new words, in every Dashboard language", () => {
  const SENTENCES: Array<string> = [
    PAGING_LADDER_DEFAULT_START_COPY.start,
    PAGING_LADDER_DEFAULT_START_COPY.started,
    PAGING_LADDER_DEFAULT_START_COPY.ownLeftOut,
    PAGING_LADDER_DEFAULT_START_COPY.ownLeftOutKeepingOwn,
    PAGING_LADDER_DEFAULT_START_COPY.memberLeftOut,
    PAGING_LADDER_DEFAULT_START_COPY.memberLeftOutKeepingOwn,
    NOT_SENT_RIGHT_NOW,
    SMS_AND_CALLS_NOT_SENT_COPY.member,
    SMS_AND_CALLS_NOT_SENT_COPY.admin,
    PHONE_CODE_NOT_SENT_COPY.member,
    PHONE_CODE_NOT_SENT_COPY.admin,
  ];

  const PLACEHOLDER: RegExp = /\{\{\s*(\w+)\s*\}\}/g;

  const placeholders: (text: string) => Array<string> = (
    text: string,
  ): Array<string> => {
    return Array.from(text.matchAll(PLACEHOLDER))
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .sort();
  };

  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(".json", "");
    });

  test("there are 17 languages besides English", () => {
    expect(locales).toHaveLength(17);
  });

  test.each(locales)(
    "%s translates each of them, keeping its placeholders",
    (language: string) => {
      const locale: Locale = JSON.parse(
        fs.readFileSync(
          path.join(LOCALES_DIRECTORY, `${language}.json`),
          "utf8",
        ),
      ) as Locale;

      for (const sentence of SENTENCES) {
        const translated: string | undefined = locale[sentence];

        expect([sentence, typeof translated]).toEqual([sentence, "string"]);
        expect([sentence, translated === sentence]).toEqual([sentence, false]);
        expect([sentence, placeholders(translated!)]).toEqual([
          sentence,
          placeholders(sentence),
        ]);
      }
    },
  );
});
