import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import TwilioPhoneNumbers, {
  PHONE_NUMBER_LIST_EXAMPLE,
} from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import { getTableColumns } from "Common/Types/Database/TableColumn";
import { PHONE_NUMBER_LIST_ERROR } from "Common/UI/Utils/PhoneNumberListError";
import TwilioConfigNumbersCopy from "../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigNumbersCopy";
import TwilioTestSendCopy from "../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioTestSendCopy";
import { SMS_NUMBER_HINT } from "../../FeatureSet/Notification/Utils/TwilioSendError";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE TWILIO SMS PHONE NUMBERS NAME NO COUNTRY, wherever a reader meets them.
 *
 * "Please remove the Singapore warning or Singapore text from this. We need
 * to make the product global." (the maintainer, on the help under Twilio SMS
 * Phone Numbers)
 *
 * The list was built for a customer in Singapore, whose national numbers are
 * voice-only, and its help, the example in its empty field, the example in
 * the error that refuses a list, its API description and its docs all took
 * their example from there. OneUptime is used worldwide, and which numbers
 * can send SMS differs from country to country, so each now says when the
 * list is needed - numbers that can only make calls - without naming a
 * country, and its example is no one country's (PHONE_NUMBER_LIST_EXAMPLE).
 * This holds it, in every language:
 *
 *   - the help on a project's Twilio config and on the Admin Dashboard's
 *     Call and SMS settings, and its translations in all 17 + 17 locales;
 *   - the example both forms show in the empty field, and the error that
 *     refuses a list, in the forms and on the server;
 *   - the API's description and example of the column;
 *   - what Send Test SMS / Send Test Call say, and what the Notification
 *     service says when Twilio refuses an SMS from a number that cannot send
 *     one.
 *
 * The docs page (self-hosted/twilio-integration) is held, in all 17
 * languages, by InstallIntegrationsDocsFacts. The country lists people pick
 * from - the country to buy a number in, a time zone - keep Singapore:
 * there it is one country among all the others.
 */

const APP: string = path.join(__dirname, "..", "..", "FeatureSet");
const DASHBOARD_LOCALES: string = path.join(APP, "Dashboard", "src", "Locales");
const ADMIN_LOCALES: string = path.join(
  APP,
  "AdminDashboard",
  "src",
  "Locales",
);
const CONFIG_TABLE: string = path.join(
  APP,
  "Dashboard",
  "src",
  "Components",
  "CallSMS",
  "CallSMSConfigTable.tsx",
);
const ADMIN_CALL_SMS: string = path.join(
  APP,
  "AdminDashboard",
  "src",
  "Pages",
  "Settings",
  "CallSMS",
  "Index.tsx",
);

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

/*
 * Singapore as each language writes it - as the Dashboard's own country
 * picker does, for buying a number there ("Singapore (+65)").
 */
const SINGAPORE_BY_LANGUAGE: Readonly<Record<string, string>> = {
  en: "Singapore",
  de: "Singapur",
  fr: "Singapour",
  es: "Singapur",
  it: "Singapore",
  pt: "Singapura",
  nl: "Singapore",
  da: "Singapore",
  no: "Singapore",
  sv: "Singapore",
  ru: "Сингапур",
  ja: "シンガポール",
  ko: "싱가포르",
  "zh-CN": "新加坡",
  "zh-TW": "新加坡",
  hi: "सिंगापुर",
  fa: "سنگاپور",
};

/*
 * What gives one country away: its name in any language, its country code
 * in Latin and in Persian digits, its registry and the sender its
 * unregistered SMS arrive from.
 */
const ONE_COUNTRY: ReadonlyArray<string> = [
  ...new Set(Object.values(SINGAPORE_BY_LANGUAGE)),
  "+65",
  "+۶۵",
  "SGNIC",
  "Likely-SCAM",
];

// The help under Twilio SMS Phone Numbers, on both forms.
const SMS_NUMBERS_HELP: string =
  "Numbers to send SMS from if yours can only make calls. Each SMS uses the one in the recipient's country, or the first.";

// The keys the list was once explained and refused with.
const RETIRED_KEYS: ReadonlyArray<string> = [
  "Numbers to send SMS from if yours can't (Singapore's national ones are voice-only). Each SMS uses the one in the recipient's country, or the first.",
  "{{entry}} is not a phone number. Write each number with its country code and separate them with commas, like +6581234567, +447700900123.",
];

// The field object that draws the SMS numbers in a form's source.
const SMS_FIELD_START: string =
  'twilioSmsPhoneNumbers: true,\n            },\n            title: "Twilio SMS Phone Numbers",';

function readLocale(folder: string, language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function translation(
  folder: string,
  language: string,
  key: string,
): string | undefined {
  const value: unknown = readLocale(folder, language)[key];

  return typeof value === "string" ? value : undefined;
}

// The words of ONE_COUNTRY a text holds.
function countryWords(text: string): Array<string> {
  return ONE_COUNTRY.filter((word: string): boolean => {
    return text.includes(word);
  });
}

/*
 * The SMS numbers' field objects of a form, as its source writes them: two
 * since a config says what it is used for - the open, required one of an
 * account used for SMS only, and the folded, optional one of an account
 * used for calls and SMS (Dashboard TwilioConfigUseCopy).
 */
function smsFields(source: string): Array<string> {
  const fields: Array<string> = [];
  let start: number = source.indexOf(SMS_FIELD_START);

  while (start !== -1) {
    const end: number = source.indexOf("\n          },", start);

    expect(end).toBeGreaterThan(start);
    fields.push(source.slice(start, end));

    start = source.indexOf(SMS_FIELD_START, start + 1);
  }

  expect(fields).toHaveLength(2);

  return fields;
}

// The folded one: SMS numbers for numbers that can only make calls.
function foldedSmsField(source: string): string {
  const folded: Array<string> = smsFields(source).filter(
    (field: string): boolean => {
      return field.includes("collapsibleSection:");
    },
  );

  expect(folded).toHaveLength(1);

  return folded[0]!;
}

describe("the words that give one country away", () => {
  test("hold Singapore's name in every language the dashboards draw", () => {
    expect(Object.keys(SINGAPORE_BY_LANGUAGE).sort()).toEqual(
      [...LANGUAGES].sort(),
    );

    for (const folder of [DASHBOARD_LOCALES, ADMIN_LOCALES]) {
      expect(
        fs
          .readdirSync(folder)
          .filter((file: string): boolean => {
            return file.endsWith(".json");
          })
          .map((file: string): string => {
            return file.slice(0, -".json".length);
          })
          .sort(),
      ).toEqual([...LANGUAGES].sort());
    }
  });

  test.each(LANGUAGES)(
    "spell it in %s as the Dashboard's country picker does",
    (language: string) => {
      const picked: string =
        translation(DASHBOARD_LOCALES, language, "Singapore (+65)") || "";

      expect({ language, picked: picked.split(" (")[0] }).toEqual({
        language,
        picked: SINGAPORE_BY_LANGUAGE[language],
      });
      expect(countryWords(picked).length).toBeGreaterThanOrEqual(2);
    },
  );
});

describe("the help under Twilio SMS Phone Numbers", () => {
  test("says when the numbers are needed and what they change, naming no country", () => {
    expect(TwilioConfigNumbersCopy.smsPhoneNumbersDescription).toBe(
      SMS_NUMBERS_HELP,
    );
    expect(countryWords(SMS_NUMBERS_HELP)).toEqual([]);
    // When: the config's numbers can only make calls.
    expect(SMS_NUMBERS_HELP).toContain("if yours can only make calls");
    // What they change: every SMS, by the recipient's country, else the first.
    expect(SMS_NUMBERS_HELP).toContain(
      "Each SMS uses the one in the recipient's country, or the first.",
    );
    // Two short lines under the label (ShortDescriptionsGuard's field limit).
    expect(SMS_NUMBERS_HELP.length).toBeLessThanOrEqual(150);
  });

  test("is the same on the Admin Dashboard's Call and SMS settings", () => {
    const field: string = foldedSmsField(
      fs.readFileSync(ADMIN_CALL_SMS, "utf8"),
    );

    expect(field).toContain(`"${SMS_NUMBERS_HELP}"`);
  });

  test.each(LANGUAGES)(
    "is translated in %s, naming no country, on both dashboards",
    (language: string) => {
      for (const folder of [DASHBOARD_LOCALES, ADMIN_LOCALES]) {
        const translated: string =
          translation(folder, language, SMS_NUMBERS_HELP) || "";

        expect({
          folder,
          language,
          translated: translated.length > 0,
          inOtherWords: language === "en" || translated !== SMS_NUMBERS_HELP,
          words: countryWords(translated),
        }).toEqual({
          folder,
          language,
          translated: true,
          inOtherWords: true,
          words: [],
        });
      }
    },
  );
});

describe("the example a reader is shown, and the error that refuses a list", () => {
  test.each([CONFIG_TABLE, ADMIN_CALL_SMS])(
    "%s shows the server's example list in the empty field, and names no country",
    (file: string) => {
      const source: string = fs.readFileSync(file, "utf8");

      // Open for SMS only, folded for calls and SMS: the same example in both.
      for (const field of smsFields(source)) {
        expect(field).toContain("placeholder: PHONE_NUMBER_LIST_EXAMPLE,");
        expect(countryWords(field)).toEqual([]);
      }
      expect(source).toContain(
        'import { PHONE_NUMBER_LIST_EXAMPLE } from "Common/Types/CallAndSMS/TwilioPhoneNumbers";',
      );
      // Nothing on the page - nor a comment beside it - names one country.
      expect(countryWords(source)).toEqual([]);
    },
  );

  test("the example holds no one country's numbers", () => {
    expect(countryWords(PHONE_NUMBER_LIST_EXAMPLE)).toEqual([]);
    expect(TwilioPhoneNumbers.getListError(PHONE_NUMBER_LIST_EXAMPLE)).toBe(
      null,
    );
  });

  test("the server's error and the forms' give the same example", () => {
    expect(TwilioPhoneNumbers.getListEntryError("x")).toContain(
      `like ${PHONE_NUMBER_LIST_EXAMPLE}.`,
    );
    // The forms' key leaves the numbers to the example it is filled with.
    expect(PHONE_NUMBER_LIST_ERROR).toBe(
      "{{entry}} is not a phone number. Write each number with its country code and separate them with commas, like {{example}}.",
    );
  });

  test.each(LANGUAGES)(
    "the error is translated in %s with the example left to fill in, on both dashboards",
    (language: string) => {
      for (const folder of [DASHBOARD_LOCALES, ADMIN_LOCALES]) {
        const translated: string =
          translation(folder, language, PHONE_NUMBER_LIST_ERROR) || "";

        expect({
          folder,
          language,
          entry: translated.includes("{{entry}}"),
          example: translated.includes("{{example}}"),
          // No number of its own: every locale shows the server's example.
          numbers: translated.includes("+"),
          words: countryWords(translated),
        }).toEqual({
          folder,
          language,
          entry: true,
          example: true,
          numbers: false,
          words: [],
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "no %s locale keeps the Singapore wording",
    (language: string) => {
      for (const folder of [DASHBOARD_LOCALES, ADMIN_LOCALES]) {
        const locale: Record<string, unknown> = readLocale(folder, language);

        for (const retired of RETIRED_KEYS) {
          expect({
            folder,
            language,
            retired,
            kept: retired in locale,
          }).toEqual({ folder, language, retired, kept: false });
        }
      }
    },
  );
});

describe("the API's description of the column", () => {
  test("says what the list is for without naming a country, on a project's config as on the server's", () => {
    const project: string =
      getTableColumns(new ProjectCallSMSConfig())["twilioSmsPhoneNumbers"]
        ?.description || "";
    const server: string =
      getTableColumns(new GlobalConfig())["twilioSmsPhoneNumbers"]
        ?.description || "";

    expect(project).toContain("for phone numbers that can only make calls");
    expect(countryWords(project)).toEqual([]);
    // One description of one rule, on both configs.
    expect(project).toBe(server);
  });

  test("gives the example list the forms show", () => {
    expect(
      getTableColumns(new ProjectCallSMSConfig())["twilioSmsPhoneNumbers"]
        ?.example,
    ).toBe(PHONE_NUMBER_LIST_EXAMPLE);
  });
});

describe("what a test send and a refused SMS say", () => {
  test("name no country", () => {
    for (const text of [
      ...Object.values(TwilioTestSendCopy),
      SMS_NUMBER_HINT,
    ]) {
      expect({ text, words: countryWords(text) }).toEqual({ text, words: [] });
    }

    // A refused SMS names the case the help does.
    expect(SMS_NUMBER_HINT).toContain("can only make calls");
  });
});
