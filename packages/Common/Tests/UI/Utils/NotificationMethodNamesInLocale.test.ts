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
    // A device with no name is an unknown device in the reader's words too.
    expect(words["Unknown Device"]).toBe("Unbekanntes Gerät");
    expect(NotificationMethodUtil.getTranslatedLabel(german, device)).toBe(
      `${words["Push notification"]}: ${words["Unknown Device"]}`,
    );
    // ... and in English, as getLabel calls it.
    expect(
      NotificationMethodUtil.getTranslatedLabel(translatorFor("en"), device),
    ).toBe("Push notification: Unknown Device");
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

    /*
     * Drawn as it is, never looked up again, and the page's way, as the
     * "Notification Method" column draws the line: left to the label's
     * letters, a Persian menu read its "WhatsApp: ..." from the left under
     * lines read from the right.
     */
    expect(worded).toEqual([
      {
        label: `${readLocale("fr")["Phone call"]} : +15555550100`,
        value: ID,
        isUserContent: true,
        isInPageDirection: true,
      },
    ]);
    // getLabel's English, which no page reads as a sentence.
    expect(plain).toEqual([{ label: "Call: +15555550100", value: ID }]);
    expect(NotificationMethodUtil.getLabel(phoneCall())).toBe(
      "Call: +15555550100",
    );
  });
});

/*
 * A push device registered without a name is stored as "Unknown Device"
 * (UserPushAPI): the product's word, so a line words it in the reader's
 * language like the rest of the line. A name someone gave a device, or
 * the same words on another kind of method, stay as written.
 */
describe("NotificationMethodUtil.getIdentifierText", () => {
  test("a device stored without a name is an unknown device in the reader's words", () => {
    for (const language of ["de", "fa", "fr", "zh-CN"]) {
      const words: Record<string, string> = readLocale(language);

      expect([language, words["Unknown Device"]]).not.toEqual([
        language,
        "Unknown Device",
      ]);
      expect(
        NotificationMethodUtil.getIdentifierText(
          translatorFor(language),
          OnCallPageChannel.Push,
          "Unknown Device",
        ),
      ).toBe(words["Unknown Device"]);
      expect(
        NotificationMethodUtil.getIdentifierText(
          translatorFor(language),
          OnCallPageChannel.Push,
          "",
        ),
      ).toBe(words["Unknown Device"]);
    }

    const persian: Translator = translatorFor("fa");
    const words: Record<string, string> = readLocale("fa");

    expect(
      withoutIsolateMarks(
        NotificationMethodUtil.getMethodLabel(
          persian,
          OnCallPageChannel.Push,
          "Unknown Device",
        ),
      ),
    ).toBe(`${words["Push notification"]}: ${words["Unknown Device"]}`);
  });

  test("a name someone gave, and any other method, as written", () => {
    const german: Translator = translatorFor("de");

    expect(
      NotificationMethodUtil.getIdentifierText(
        german,
        OnCallPageChannel.Push,
        "Pixel 8",
      ),
    ).toBe("Pixel 8");
    expect(
      NotificationMethodUtil.getIdentifierText(
        german,
        OnCallPageChannel.Webhook,
        "Unknown Device",
      ),
    ).toBe("Unknown Device");
    expect(
      NotificationMethodUtil.getIdentifierText(
        german,
        OnCallPageChannel.SMS,
        NUMBER,
      ),
    ).toBe(NUMBER);
  });
});

/*
 * A method named inside a sentence - "Remove this {{methodType}} method?",
 * "Deleting {{methodLabel}} removes 2 notification rules." - is named in
 * the sentence's own language: the reader's where the sentence is
 * translated, English where it is not yet. Named in the reader's language
 * before the sentence was looked up, a German page read "Remove this
 * Telefonanruf method?". In the middle of a sentence the name is cased as
 * the middle of a sentence is: "phone call", "SMS", "Microsoft Teams".
 */
describe("a method named inside a sentence takes the sentence's language", () => {
  const REMOVE: string = "Remove this {{methodType}} method?";
  const DELETING: string =
    "Deleting {{methodLabel}} removes {{count}} notification rules.";

  test("English: the name in the middle of the sentence, cased so", () => {
    const english: Translator = translatorFor("en");

    expect(
      english.translateTemplate(REMOVE, {
        methodType: NotificationMethodUtil.getMethodNameInSentence(
          OnCallPageChannel.Call,
        ),
      }),
    ).toBe("Remove this phone call method?");

    for (const [channel, name] of [
      [OnCallPageChannel.SMS, "SMS"],
      [OnCallPageChannel.WhatsApp, "WhatsApp"],
      [OnCallPageChannel.Push, "push notification"],
      [OnCallPageChannel.Email, "email"],
      [OnCallPageChannel.MicrosoftTeams, "Microsoft Teams"],
      [OnCallPageChannel.Mattermost, "Mattermost"],
      [OnCallPageChannel.Telegram, "Telegram"],
      [OnCallPageChannel.CustomChannel, "custom channel"],
    ] as Array<[OnCallPageChannel, string]>) {
      expect(
        english.translateTemplate(REMOVE, {
          methodType: NotificationMethodUtil.getMethodNameInSentence(channel),
        }),
      ).toBe(`Remove this ${name} method?`);
    }
  });

  test("a sentence not yet in the reader's language names the method in English", () => {
    const german: Translator = translatorFor("de");

    // The German file has the sentence in English still.
    expect(readLocale("de")[REMOVE]).toBe(REMOVE);
    expect(
      german.translateTemplate(REMOVE, {
        methodType: NotificationMethodUtil.getMethodNameInSentence(
          OnCallPageChannel.Call,
        ),
      }),
    ).toBe("Remove this phone call method?");
    expect(
      german.translateTemplate(DELETING, {
        count: 2,
        methodLabel: NotificationMethodUtil.getMethodLabelInSentence(
          OnCallPageChannel.Call,
          "+15555550100",
        ),
      }),
    ).toBe("Deleting Phone call: +15555550100 removes 2 notification rules.");
  });

  test("a translated sentence names the method in the reader's language", () => {
    const persian: Translator = translatorFor("fa");
    const words: Record<string, string> = readLocale("fa");

    expect(
      withoutIsolateMarks(
        persian.translateTemplate(REMOVE, {
          methodType: NotificationMethodUtil.getMethodNameInSentence(
            OnCallPageChannel.Call,
          ),
        }),
      ),
    ).toBe(words[REMOVE]!.replace("{{methodType}}", words["Phone call"]!));

    const deleting: string = withoutIsolateMarks(
      persian.translateTemplate(DELETING, {
        count: 2,
        methodLabel: NotificationMethodUtil.getMethodLabelInSentence(
          OnCallPageChannel.Call,
          "+15555550100",
        ),
      }),
    );

    expect(deleting).toContain(`${words["Phone call"]}: +15555550100`);
    expect(deleting).not.toContain("Phone call");
  });

  test("German keeps a noun's capital in the middle of its sentence", () => {
    const german: Translator = createTranslator(
      (text: string): string | undefined => {
        return (
          {
            [REMOVE]: "Methode {{methodType}} entfernen?",
            "Phone call": "Telefonanruf",
          } as Record<string, string>
        )[text];
      },
      "de",
    );

    expect(
      german.translateTemplate(REMOVE, {
        methodType: NotificationMethodUtil.getMethodNameInSentence(
          OnCallPageChannel.Call,
        ),
      }),
    ).toBe("Methode Telefonanruf entfernen?");
  });

  test("a type this build does not know is named as it came", () => {
    expect(NotificationMethodUtil.getMethodNameInSentence("Pager")).toBe(
      "Pager",
    );
  });
});
