import {
  ExtractedString,
  scanSourceRoots,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  LocaleProgress,
  readGlobalSameAsEnglish,
  readLocaleProgress,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ISSUES #7181 AND #7553: THE PHONE AND NOTIFICATION SCREENS IN EVERY
 * LANGUAGE.
 *
 * A Persian reader verifying a phone number read the dialog in English, and
 * the SMS logs beside it, their own notification methods page, a project's
 * Twilio settings and the incoming call policy pages had sentences of their
 * own still in English: fa.json held the English for them, where Arabic -
 * the other language read right to left - had its words (#7181). The same
 * scan, run for every other Dashboard language, found up to 176 of these
 * screens' keys still English in each of 15 languages: the verification
 * code dialog, browser push setup, the delete checks on a method, the
 * Telegram verify box (#7553). Every word these screens draw is worded in
 * every Dashboard language now, as the toolchain counts it (`npm run
 * i18n:check`): a value of its own, or the same English a language keeps
 * on purpose (a brand: WhatsApp, Telegram; browsers' names), or text with
 * no words.
 *
 * A word added to these screens later is translated with it, in every
 * language, or fails here.
 */

const PHONE_ROOTS: Array<SourceRoot> = [
  // The verification dialog, and each notification method's card and form.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods",
    kind: "ui",
  },
  // The SMS logs, and the call, email, push, WhatsApp and chat logs beside them.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs",
    kind: "ui",
  },
  // A project's own Twilio settings, and the numbers it buys and releases.
  {
    directory: "packages/App/FeatureSet/Dashboard/src/Components/CallSMS",
    kind: "ui",
  },
  // The incoming call policy pages.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy",
    kind: "ui",
  },
  // The notification methods pages: a user's own, and a colleague's.
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationMethods.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/OnCall/NotificationMethods.tsx",
    kind: "ui",
  },
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/IncomingCallPhoneNumbers.tsx",
    kind: "ui",
  },
  // A test page's result, its lines worded from codes (#7260).
  {
    directory:
      "packages/App/FeatureSet/Dashboard/src/Components/OnCallTestPage",
    kind: "ui",
  },
];

/*
 * What a person types, shown as an example of it: an address, a handle.
 * They read the same in every language - Arabic records them so - and a
 * translation would only be a wrong example.
 */
const TYPED_EXAMPLES: ReadonlyArray<string> = ["you@company.com", "@alice"];

// The languages read right to left, whose readers #7181 was about.
const RIGHT_TO_LEFT_LANGUAGES: ReadonlyArray<string> = ["fa", "ar"];

/*
 * Every language the Dashboard is read in but English (#7553): the ones a
 * person picks in its language menu, so a language added there is held to
 * these screens too.
 */
const EVERY_LANGUAGE: ReadonlyArray<string> = TRANSLATED_LOCALES;

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const ENGLISH: Record<string, unknown> = readLocale("en");
const GLOBAL_SAME_AS_ENGLISH: Set<string> = new Set<string>(
  readGlobalSameAsEnglish(),
);

interface PhoneKey {
  key: string;
  file: string;
}

// Every key the phone screens read: each text, and a plural's "one" form.
function getPhoneKeys(): Array<PhoneKey> {
  const keys: Map<string, string> = new Map<string, string>();

  for (const entry of scanSourceRoots(PHONE_ROOTS).strings) {
    if (entry.nestedPath) {
      continue;
    }

    const found: ExtractedString = entry;

    if (!keys.has(found.text)) {
      keys.set(found.text, found.file);
    }

    if (found.pluralOne !== undefined && !keys.has(`${found.text}_one`)) {
      keys.set(`${found.text}_one`, found.file);
    }
  }

  return Array.from(keys.entries()).map(
    ([key, file]: [string, string]): PhoneKey => {
      return { key, file };
    },
  );
}

const PHONE_KEYS: Array<PhoneKey> = getPhoneKeys();

// Whether `language` words `key` its own way, as npm run i18n:check counts it.
function isWorded(data: {
  key: string;
  locale: Record<string, unknown>;
  sameAsEnglish: Set<string>;
}): boolean {
  const english: unknown = ENGLISH[data.key];
  const value: unknown = data.locale[data.key];

  if (typeof english !== "string" || typeof value !== "string") {
    return false;
  }

  if (!value.trim()) {
    return false;
  }

  if (value !== english) {
    return true;
  }

  if (!LETTER.test(english.replace(PLACEHOLDER, ""))) {
    return true;
  }

  return GLOBAL_SAME_AS_ENGLISH.has(english) || data.sameAsEnglish.has(english);
}

describe("the phone and notification screens' words in every Dashboard language", () => {
  test("every language the Dashboard offers is held to these screens, the two read right to left among them", () => {
    expect([...EVERY_LANGUAGE].sort()).toEqual(
      [
        "ar",
        "da",
        "de",
        "es",
        "fa",
        "fr",
        "hi",
        "it",
        "ja",
        "ko",
        "nl",
        "no",
        "pt",
        "ru",
        "sv",
        "zh-CN",
        "zh-TW",
      ].sort(),
    );

    for (const language of RIGHT_TO_LEFT_LANGUAGES) {
      expect(EVERY_LANGUAGE).toContain(language);
    }
  });

  test("the scan reads the words #7553 found English in 15 languages", () => {
    const keys: Set<string> = new Set<string>(
      PHONE_KEYS.map((entry: PhoneKey): string => {
        return entry.key;
      }),
    );

    for (const key of [
      // The verification code dialog.
      "The code we sent to {{destination}} has expired.",
      "Send a new code",
      "Call me with a new code",
      "It works until {{expiresAt}}.",
      "We emailed a 6-digit code to {{destination}} at {{sentAt}}.",
      "We called {{destination}} at {{sentAt}} and read out a 6-digit code.",
      "We sent a 6-digit code on WhatsApp to {{destination}} at {{sentAt}}.",
      // Browser push setup.
      "Browsers only allow push notifications over a secure connection. Open OneUptime over HTTPS to register this browser.",
      "Send Test Notification",
      "Browser Registered",
      // The delete checks on a method.
      "This is the last rule covering {{cells}}. Deleting it leaves those with no rule.",
      // The Call method's description.
      "Manage Phone Numbers that will receive call notifications for this project. A number you have verified for SMS is verified for calls too, with no new code.",
      // The Telegram verify box.
      "To verify, message our bot in Telegram. Pick whichever option is easiest:",
      "Still waiting — please send /start to the bot in Telegram.",
      // A test page's own failure lines (#7550).
      "Error sending SMS.",
      "The Notification service refused to send this (HTTP {{statusCode}}): {{words}}",
    ]) {
      expect([key, keys.has(key)]).toEqual([key, true]);
    }
  });

  test("the screens draw words, every one of them an English key", () => {
    expect(PHONE_KEYS.length).toBeGreaterThan(400);
    expect(
      PHONE_KEYS.filter((entry: PhoneKey): boolean => {
        return typeof ENGLISH[entry.key] !== "string";
      }),
    ).toEqual([]);

    const keys: Set<string> = new Set<string>(
      PHONE_KEYS.map((entry: PhoneKey): string => {
        return entry.key;
      }),
    );

    // The scan reads each screen the issue named: a word of each, among them.
    for (const key of [
      // The verification dialog.
      "We sent a 6-digit code by SMS to {{destination}} at {{sentAt}}.",
      "Didn't get it?",
      // The SMS logs.
      "SMS sent for this project.",
      // The notification methods pages.
      "Email address or phone number",
      // A project's Twilio settings.
      "Release Number",
      // A test page's result (#7260).
      "{{name}} has no verified notification method.",
    ]) {
      expect(keys.has(key)).toBe(true);
    }

    // The examples kept as written are ones the screens do draw.
    for (const example of TYPED_EXAMPLES) {
      expect(keys.has(example)).toBe(true);
    }
  });

  test.each(EVERY_LANGUAGE)(
    "%s words every one of them",
    (language: string) => {
      const progress: LocaleProgress | undefined = readLocaleProgress(language);
      const sameAsEnglish: Set<string> = new Set<string>(
        progress ? progress.sameAsEnglish : [],
      );
      const locale: Record<string, unknown> = readLocale(language);

      const unworded: Array<string> = PHONE_KEYS.filter(
        (entry: PhoneKey): boolean => {
          if (TYPED_EXAMPLES.includes(entry.key)) {
            return false;
          }

          return !isWorded({ key: entry.key, locale, sameAsEnglish });
        },
      ).map((entry: PhoneKey): string => {
        return `${entry.key} (${path.basename(entry.file)})`;
      });

      expect(unworded).toEqual([]);
    },
  );

  test("the typed examples read as typed in Arabic, as they do in Persian", () => {
    const arabic: LocaleProgress | undefined = readLocaleProgress("ar");
    const persian: Record<string, unknown> = readLocale("fa");

    for (const example of TYPED_EXAMPLES) {
      // Arabic records them as the same in its language, on purpose.
      expect(arabic?.sameAsEnglish).toContain(example);
      expect(persian[example]).toBe(example);
    }
  });

  /*
   * Persian is not Arabic: the letters ي and ك are Arabic's, and Persian
   * writes ی and ک. A Persian value copied from the Arabic file would carry
   * them.
   */
  test("Persian writes its own letters, not Arabic's yeh and kaf", () => {
    const persian: Record<string, unknown> = readLocale("fa");
    const arabicLetters: RegExp = new RegExp(
      `[${String.fromCharCode(0x064a)}${String.fromCharCode(0x0643)}]`,
    );

    expect(
      PHONE_KEYS.filter((entry: PhoneKey): boolean => {
        return arabicLetters.test(String(persian[entry.key] || ""));
      }).map((entry: PhoneKey): string => {
        return entry.key;
      }),
    ).toEqual([]);
  });

  /*
   * Persian and Arabic share words - حذف, متصل, حساب - but they are two
   * languages, and never share a sentence. A Persian sentence that reads as
   * the Arabic one was copied from it.
   */
  test("no Persian sentence is the Arabic one", () => {
    const persian: Record<string, unknown> = readLocale("fa");
    const arabic: Record<string, unknown> = readLocale("ar");

    const wordCount: (value: string) => number = (value: string): number => {
      return value
        .replace(PLACEHOLDER, "")
        .split(/\s+/)
        .filter((word: string): boolean => {
          return LETTER.test(word);
        }).length;
    };

    expect(
      PHONE_KEYS.filter((entry: PhoneKey): boolean => {
        const value: unknown = persian[entry.key];

        return (
          typeof value === "string" &&
          value !== ENGLISH[entry.key] &&
          value === arabic[entry.key] &&
          wordCount(value) >= 4
        );
      }).map((entry: PhoneKey): string => {
        return entry.key;
      }),
    ).toEqual([]);
  });

  /*
   * Persian joins a prefix or a suffix to its word with a zero-width
   * non-joiner ("می‌", "‌ها"): typed as a space, the word reads as two.
   */
  test("Persian joins می and ها to their words, never with a space", () => {
    const persian: Record<string, unknown> = readLocale("fa");
    const spaced: RegExp = /(^|\s)می\s|\sها(\s|$|[.،؟:])/u;

    expect(
      PHONE_KEYS.filter((entry: PhoneKey): boolean => {
        return spaced.test(String(persian[entry.key] || ""));
      }).map((entry: PhoneKey): string => {
        return `${entry.key} => ${String(persian[entry.key])}`;
      }),
    ).toEqual([]);
  });
});
