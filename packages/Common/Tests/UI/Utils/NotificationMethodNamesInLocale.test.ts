import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import NotificationMethodUtil, {
  NOTIFICATION_METHOD_LINE,
  NOTIFICATION_METHOD_NAMES,
  NotificationMethodModels,
} from "../../../UI/Utils/NotificationMethodUtil";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Phone from "../../../Types/Phone";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * ISSUE #7178: A NOTIFICATION METHOD IS NAMED IN THE READER'S LANGUAGE.
 *
 * An on-call rule's method, a log line's, a dropdown's option was "SMS:
 * +447700900123", "Call: ...", "Push: ..." in every language. The shared
 * words could not simply be translated: "Call" is a function call (调用)
 * in Chinese and "Push" a payment (الدفع) in Arabic. A method is named by
 * a phrase of its own now (NOTIFICATION_METHOD_NAMES) - "Phone call",
 * "Push notification" - in every Dashboard language, its line a sentence
 * of the language ("{{label}}: {{identifier}}"), and which kind of method
 * it is decided by its kind (OnCallPageChannel), never by its words.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

function translatorFor(language: string): Translator {
  const words: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

const NUMBER: string = "+447700900123";
const ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

// Channels whose name is a product's, kept as it is written.
const PRODUCT_NAMES: ReadonlyArray<OnCallPageChannel> = [
  OnCallPageChannel.WhatsApp,
  OnCallPageChannel.Telegram,
  OnCallPageChannel.Slack,
  OnCallPageChannel.MicrosoftTeams,
  OnCallPageChannel.Mattermost,
];

describe("every kind of method has a name", () => {
  test("one for each channel, English under its own key", () => {
    expect(Object.keys(NOTIFICATION_METHOD_NAMES).sort()).toEqual(
      Object.values(OnCallPageChannel).sort(),
    );

    for (const name of Object.values(NOTIFICATION_METHOD_NAMES)) {
      expect(ENGLISH[name]).toBe(name);
    }

    expect(ENGLISH[NOTIFICATION_METHOD_LINE]).toBe(NOTIFICATION_METHOD_LINE);
  });

  test("a call is a phone call and a push a push notification, never the shared word", () => {
    expect(NOTIFICATION_METHOD_NAMES[OnCallPageChannel.Call]).toBe(
      "Phone call",
    );
    expect(NOTIFICATION_METHOD_NAMES[OnCallPageChannel.Push]).toBe(
      "Push notification",
    );
  });
});

describe.each(DASHBOARD_LANGUAGES)("the %s locale", (language: string) => {
  const words: Record<string, string> = readLocale(language);

  test.each(Object.entries(NOTIFICATION_METHOD_NAMES))(
    "names %s",
    (channel: string, name: string) => {
      const translated: string | undefined = words[name];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);

      if (
        channel === OnCallPageChannel.Call ||
        channel === OnCallPageChannel.Push ||
        channel === OnCallPageChannel.Email ||
        channel === OnCallPageChannel.CustomChannel
      ) {
        // Words every language has its own for.
        expect({ language, channel, translated }).not.toEqual({
          language,
          channel,
          translated: name,
        });
      }

      if (PRODUCT_NAMES.includes(channel as OnCallPageChannel)) {
        expect(translated).toBe(name);
      }
    },
  );

  test("a method's line keeps its name and its identifier", () => {
    const line: string | undefined = words[NOTIFICATION_METHOD_LINE];

    expect(line).toBeDefined();
    expect(line!.split("{{label}}")).toHaveLength(2);
    expect(line!.split("{{identifier}}")).toHaveLength(2);
    expect(line!.indexOf("{{label}}")).toBeLessThan(
      line!.indexOf("{{identifier}}"),
    );
  });
});

describe("the senses a shared word got wrong", () => {
  test("Chinese: a phone call is 电话, never 调用 (a function call)", () => {
    const words: Record<string, string> = readLocale("zh-CN");

    expect(words["Call"]).toBe("调用");
    expect(words["Phone call"]).not.toContain("调用");
    expect(
      NotificationMethodUtil.getMethodName(
        translatorFor("zh-CN"),
        OnCallPageChannel.Call,
      ),
    ).toBe(words["Phone call"]);
  });

  test("Arabic: a push notification is a notification, never الدفع (a payment)", () => {
    const words: Record<string, string> = readLocale("ar");

    expect(words["Push"]).toBe("الدفع");
    expect(words["Push notification"]).not.toContain("الدفع");
    expect(
      NotificationMethodUtil.getMethodName(
        translatorFor("ar"),
        OnCallPageChannel.Push,
      ),
    ).toBe(words["Push notification"]);
  });
});

describe("NotificationMethodUtil.getMethodOfType", () => {
  test.each(Object.values(OnCallPageChannel))(
    "%s is the kind it names",
    (channel: OnCallPageChannel) => {
      expect(NotificationMethodUtil.getMethodOfType(channel)).toBe(channel);
    },
  );

  test("a type this build does not know, or none, is no kind", () => {
    for (const type of ["call", "Phone call", "Pager", "", null, undefined]) {
      expect(NotificationMethodUtil.getMethodOfType(type)).toBeNull();
    }
  });
});

describe("NotificationMethodUtil.isPhoneNumberChannel", () => {
  test("a call, an SMS and a WhatsApp message go to a phone number", () => {
    expect(
      Object.values(OnCallPageChannel).filter(
        (channel: OnCallPageChannel): boolean => {
          return NotificationMethodUtil.isPhoneNumberChannel(channel);
        },
      ),
    ).toEqual([
      OnCallPageChannel.Call,
      OnCallPageChannel.SMS,
      OnCallPageChannel.WhatsApp,
    ]);
  });
});

describe("NotificationMethodUtil.getMethodName", () => {
  test("English: the method's own phrase", () => {
    const english: Translator = translatorFor("en");

    expect(NotificationMethodUtil.getMethodName(english, "Call")).toBe(
      "Phone call",
    );
    expect(NotificationMethodUtil.getMethodName(english, "Push")).toBe(
      "Push notification",
    );
    expect(
      NotificationMethodUtil.getMethodName(english, "Custom Channel"),
    ).toBe("Custom channel");
    expect(NotificationMethodUtil.getMethodName(english, "SMS")).toBe("SMS");
  });

  test.each(["de", "fa", "ar", "ja"])(
    "%s: the locale's phrase for each kind",
    (language: string) => {
      const words: Record<string, string> = readLocale(language);

      for (const channel of Object.values(OnCallPageChannel)) {
        expect(
          NotificationMethodUtil.getMethodName(
            translatorFor(language),
            channel,
          ),
        ).toBe(words[NOTIFICATION_METHOD_NAMES[channel]]);
      }
    },
  );

  test("Persian names an SMS پیامک", () => {
    expect(
      NotificationMethodUtil.getMethodName(
        translatorFor("fa"),
        OnCallPageChannel.SMS,
      ),
    ).toBe("پیامک");
  });

  test("a type this build does not know is named as it came", () => {
    expect(
      NotificationMethodUtil.getMethodName(translatorFor("de"), "Pager"),
    ).toBe("Pager");
  });
});

describe("NotificationMethodUtil.getMethodLabel", () => {
  test("English: name, colon, identifier", () => {
    expect(
      NotificationMethodUtil.getMethodLabel(
        translatorFor("en"),
        OnCallPageChannel.Call,
        NUMBER,
      ),
    ).toBe(`Phone call: ${NUMBER}`);
  });

  test("with no identifier, just the name", () => {
    for (const identifier of [undefined, null, ""]) {
      expect(
        NotificationMethodUtil.getMethodLabel(
          translatorFor("de"),
          OnCallPageChannel.SMS,
          identifier,
        ),
      ).toBe(readLocale("de")["SMS"]);
    }
  });

  test("French spaces its colon, Chinese writes a full-width one", () => {
    expect(
      NotificationMethodUtil.getMethodLabel(
        translatorFor("fr"),
        OnCallPageChannel.Email,
        "jane@example.com",
      ),
    ).toBe(`${readLocale("fr")["Email"]} : jane@example.com`);
    expect(
      withoutIsolateMarks(
        NotificationMethodUtil.getMethodLabel(
          translatorFor("zh-CN"),
          OnCallPageChannel.Call,
          NUMBER,
        ),
      ),
    ).toBe(`电话：${NUMBER}`);
  });

  test.each(["fa", "ar"])(
    "%s: the name is the reader's and the number is set apart, so its + stays in front",
    (language: string) => {
      const label: string = NotificationMethodUtil.getMethodLabel(
        translatorFor(language),
        OnCallPageChannel.SMS,
        NUMBER,
      );

      expect(withoutIsolateMarks(label)).toBe(
        `${readLocale(language)["SMS"]}: ${NUMBER}`,
      );
      // An isolate opens right before the number and closes right after it.
      expect(label).toMatch(/[⁦-⁨]\+447700900123⁩$/);
    },
  );
});

describe("NotificationMethodUtil.getTranslatedLabel and getDropdownOptions", () => {
  function phoneCall(): UserCall {
    const model: UserCall = new UserCall();
    model.id = new ObjectID(ID);
    model.phone = new Phone("+15555550100");
    return model;
  }

  test("each kind of row in the reader's words", () => {
    const german: Translator = translatorFor("de");
    const words: Record<string, string> = readLocale("de");

    const sms: UserSMS = new UserSMS();
    sms.id = new ObjectID(ID);
    sms.phone = new Phone("+15555550100");

    const email: UserEmail = new UserEmail();
    email.id = new ObjectID(ID);
    email.email = new Email("jane@example.com");

    const device: UserPush = new UserPush();
    device.id = new ObjectID(ID);

    const channel: CustomNotificationChannel = new CustomNotificationChannel();
    channel.id = new ObjectID(ID);
    channel.name = "CorpoApp";

    expect(NotificationMethodUtil.getTranslatedLabel(german, sms)).toBe(
      `${words["SMS"]}: +15555550100`,
    );
    expect(NotificationMethodUtil.getTranslatedLabel(german, phoneCall())).toBe(
      `${words["Phone call"]}: +15555550100`,
    );
    expect(NotificationMethodUtil.getTranslatedLabel(german, email)).toBe(
      `${words["Email"]}: jane@example.com`,
    );
    // A device with no name keeps the label's fallback.
    expect(NotificationMethodUtil.getTranslatedLabel(german, device)).toBe(
      `${words["Push notification"]}: Unknown Device`,
    );
    expect(NotificationMethodUtil.getTranslatedLabel(german, channel)).toBe(
      `${words["Custom channel"]}: CorpoApp`,
    );
  });

  test("a dropdown worded by a translator; without one, as it always was", () => {
    const models: NotificationMethodModels = {
      userCalls: [phoneCall()],
      userEmails: [],
      userSMSs: [],
      userPush: [],
      userWhatsApps: [],
      userTelegrams: [],
      userSlacks: [],
      userMicrosoftTeamsAccounts: [],
      userMattermostAccounts: [],
      userWebhooks: [],
    };

    const worded: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(models, translatorFor("fr"));
    const plain: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(models);

    expect(worded).toEqual([
      {
        label: `${readLocale("fr")["Phone call"]} : +15555550100`,
        value: ID,
      },
    ]);
    // getLabel's English, which no page reads as a sentence.
    expect(plain).toEqual([{ label: "Call: +15555550100", value: ID }]);
    expect(NotificationMethodUtil.getLabel(phoneCall())).toBe(
      "Call: +15555550100",
    );
  });
});
