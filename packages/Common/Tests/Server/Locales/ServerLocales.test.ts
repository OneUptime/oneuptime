import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  alignLocale,
  buildEnglishLocale,
  ENGLISH,
  findKeysInSource,
  findServerTextKeys,
  getDashboardSharedKeys,
  getLocalePath,
  LANGUAGES_WITHOUT_ONE_FORM,
  LocaleDictionary,
  PLURAL_ONE_SUFFIX,
  readLocale,
  REPOSITORY_ROOT,
  SERVER_LOCALES_DIRECTORY,
  ServerTextKey,
  toLocaleText,
  TRANSLATED_LANGUAGES,
} from "../../../Scripts/I18n/ServerLocales";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import { DEFAULT_STATUS_NAMES } from "../../../Types/StatusPage/DefaultStatusNames";
import { getTemplatePlaceholders } from "../../../UI/Utils/TranslateTemplate";

/*
 * THE SERVER'S LOCALE SET: EVERY SENTENCE IT LOOKS UP, IN EVERY LANGUAGE.
 *
 * Common/Server/Locales holds the words the server writes in a reader's
 * language: a status page's subscriber notifications and the messages
 * about a subscription (README.md there). These hold the files to the
 * sentences the code and the email templates look up, and to the rules a
 * translation keeps.
 */

const SAME_AS_ENGLISH_FILE: string = path.join(
  SERVER_LOCALES_DIRECTORY,
  "SameAsEnglish.json",
);

const STATUS_PAGE_LOCALES: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
  "Locales",
);

// The status page's own key for each of OneUptime's default names.
const STATUS_NAME_KEYS: Record<string, string> = {
  Identified: "identified",
  Acknowledged: "acknowledged",
  Resolved: "resolved",
  "Critical Incident": "criticalIncident",
  "Major Incident": "majorIncident",
  "Minor Incident": "minorIncident",
  Operational: "operational",
  Degraded: "degraded",
  Offline: "offline",
  Scheduled: "scheduled",
  Ongoing: "ongoing",
  Ended: "ended",
  Completed: "completed",
};

// The placeholders a text message carries a link in.
const LINK_PLACEHOLDERS: ReadonlyArray<string> = [
  "detailsUrl",
  "unsubscribeUrl",
  "confirmationUrl",
  "manageUrl",
];

// Placeholders whose values are translated with the sentence.
const TRANSLATED_VALUE_PLACEHOLDERS: ReadonlyArray<string> = [
  "state",
  "severity",
];

const LETTER: RegExp = /\p{L}/u;

// A {{placeholder}}: a value, which belongs to no language.
const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

/*
 * Whether a sentence has words of its own besides its placeholders, as the
 * translator reads it (Types/Translator's hasWords): "{{lead}}: {{record}}"
 * has none, and belongs to no language - a language may punctuate it its
 * own way ("{{lead}}：{{record}}" in Japanese), or leave it as it is.
 */
const hasWordsOfItsOwn: (sentence: string) => boolean = (
  sentence: string,
): boolean => {
  return LETTER.test(sentence.replace(PLACEHOLDER, ""));
};

const english: LocaleDictionary = readLocale(ENGLISH);

/*
 * The sentences the Dashboard words (DASHBOARD_SHARED_TEXT_SOURCES): held to
 * the Dashboard's wording instead (ServerLocalesDashboardWords.test.ts).
 */
const sharedWithDashboard: Set<string> =
  getDashboardSharedKeys(findServerTextKeys());

const sameAsEnglish: Record<string, Array<string>> = JSON.parse(
  fs.readFileSync(SAME_AS_ENGLISH_FILE, "utf8"),
) as Record<string, Array<string>>;

describe("en.json", () => {
  test("holds exactly the sentences the server's code and email templates look up", () => {
    const keys: Array<ServerTextKey> = findServerTextKeys();

    expect(keys.length).toBeGreaterThan(100);
    expect(english).toEqual(buildEnglishLocale(keys));
  });

  test("is in canonical form: sorted, two-space JSON, a trailing newline", () => {
    expect(fs.readFileSync(getLocalePath(ENGLISH), "utf8")).toBe(
      toLocaleText(buildEnglishLocale(findServerTextKeys())),
    );
  });

  test("names every default state, severity and status name", () => {
    for (const name of DEFAULT_STATUS_NAMES) {
      expect(english[name]).toBe(name);
    }
  });

  test("looks up the subscriber messages' words, the partials' and the templates'", () => {
    const files: Set<string> = new Set<string>(
      findServerTextKeys().map((key: ServerTextKey): string => {
        return key.file;
      }),
    );

    for (const file of [
      "packages/Common/Server/Utils/StatusPage/SubscriberMessageText.ts",
      "packages/Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder.ts",
      "packages/Common/Types/StatusPage/StateChangeNoteMessage.ts",
      "packages/App/FeatureSet/Notification/Templates/SubscriberIncidentCreated.hbs",
      "packages/App/FeatureSet/Notification/Templates/Partials/UnsubscribeBlock.hbs",
      "packages/App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
    ]) {
      expect(files).toContain(file);
    }
  });
});

describe("every language's file", () => {
  test("there is one for each language OneUptime writes in", () => {
    expect([ENGLISH, ...TRANSLATED_LANGUAGES].sort()).toEqual(
      [...READER_LANGUAGE_CODES].sort(),
    );

    for (const language of TRANSLATED_LANGUAGES) {
      expect(fs.existsSync(getLocalePath(language))).toBe(true);
    }
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s has en.json's keys, in its order, and nothing else",
    (language: string) => {
      const locale: LocaleDictionary = readLocale(language);

      expect(Object.keys(locale)).toEqual(Object.keys(english));
      // What npm run i18n:server-sync writes: nothing changes.
      expect(fs.readFileSync(getLocalePath(language), "utf8")).toBe(
        toLocaleText(alignLocale({ english: english, locale: locale })),
      );
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s keeps every placeholder of every sentence, and no other",
    (language: string) => {
      const locale: LocaleDictionary = readLocale(language);

      for (const key of Object.keys(english)) {
        const value: string = locale[key] || "";

        expect([key, getTemplatePlaceholders(value).sort()]).toEqual([
          key,
          getTemplatePlaceholders(english[key]!).sort(),
        ]);
        expect([key, value.trim().length > 0]).toEqual([key, true]);
      }
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s words every sentence, or lists it as reading the same as English",
    (language: string) => {
      const locale: LocaleDictionary = readLocale(language);
      const listed: Array<string> = sameAsEnglish[language] || [];

      const untranslated: Array<string> = Object.keys(english).filter(
        (key: string): boolean => {
          if (locale[key] !== english[key]) {
            return false;
          }

          // A sentence of no words of its own reads the same in every language.
          if (!hasWordsOfItsOwn(english[key]!)) {
            return false;
          }

          /*
           * A sentence the Dashboard words reads as the Dashboard reads it,
           * the same as English where the Dashboard's is ("{{monitorName}}
           * is offline" in Dutch).
           */
          if (sharedWithDashboard.has(key)) {
            return false;
          }

          // A language without a "one" form never reads its "_one" key.
          if (
            key.endsWith(PLURAL_ONE_SUFFIX) &&
            LANGUAGES_WITHOUT_ONE_FORM.includes(language)
          ) {
            return false;
          }

          return !listed.includes(key);
        },
      );

      expect(untranslated).toEqual([]);

      // And it lists only what does read the same.
      for (const key of listed) {
        expect([key, locale[key]]).toEqual([key, english[key]]);
      }
    },
  );

  test("the same-as-English lists are sorted, and name only languages and sentences there are", () => {
    for (const [language, keys] of Object.entries(sameAsEnglish)) {
      expect(TRANSLATED_LANGUAGES).toContain(language);
      expect(keys).toEqual([...keys].sort());
      expect(new Set<string>(keys).size).toBe(keys.length);

      for (const key of keys) {
        expect(Object.keys(english)).toContain(key);
      }
    }
  });

  /*
   * A wording equal to the English reads as not translated, and the
   * sentence's values are then put in in English: "[Incident {{state}}]" in
   * French would read "[Incident Resolved]". So a sentence whose values are
   * translated is worded apart from the English in every language.
   */
  test("a sentence whose values are translated is worded apart from the English", () => {
    for (const language of TRANSLATED_LANGUAGES) {
      const locale: LocaleDictionary = readLocale(language);

      for (const key of Object.keys(english)) {
        const placeholders: Array<string> = getTemplatePlaceholders(key);

        if (
          placeholders.some((name: string): boolean => {
            return TRANSLATED_VALUE_PLACEHOLDERS.includes(name);
          })
        ) {
          expect([language, key, locale[key] !== english[key]]).toEqual([
            language,
            key,
            true,
          ]);
        }
      }
    }
  });

  /*
   * A text message's links go out exactly as written, and only a word that
   * starts with a link is one (Common/Utils/Sms/Gsm7Text's toGsm7Message):
   * every language keeps a space, or the start of the text, before each.
   */
  test("a link in a text message starts a word in every language", () => {
    for (const language of [ENGLISH, ...TRANSLATED_LANGUAGES]) {
      const locale: LocaleDictionary = readLocale(language);

      for (const key of Object.keys(english)) {
        const value: string = locale[key]!;

        for (const name of LINK_PLACEHOLDERS) {
          const placeholder: string = `{{${name}}}`;
          let at: number = value.indexOf(placeholder);

          while (at >= 0) {
            const before: string = at === 0 ? " " : value[at - 1]!;

            expect([language, key, before.trim()]).toEqual([language, key, ""]);

            at = value.indexOf(placeholder, at + placeholder.length);
          }
        }
      }
    }
  });

  test("OneUptime's default names read as the status page reads them, in every language", () => {
    for (const language of TRANSLATED_LANGUAGES) {
      const locale: LocaleDictionary = readLocale(language);
      const statusPage: { statusNames: Record<string, string> } = JSON.parse(
        fs.readFileSync(path.join(STATUS_PAGE_LOCALES, `${language}.json`), {
          encoding: "utf8",
        }),
      ) as { statusNames: Record<string, string> };

      for (const name of DEFAULT_STATUS_NAMES) {
        expect([language, name, locale[name]]).toEqual([
          language,
          name,
          statusPage.statusNames[STATUS_NAME_KEYS[name]!],
        ]);
      }
    }
  });
});

describe("findKeysInSource", () => {
  test("reads the markers and the lookups of a TypeScript file", () => {
    const keys: Array<ServerTextKey> = findKeysInSource({
      file: "x.ts",
      text: [
        'const a: string = translationKey("Marked {{name}}");',
        'translator.translateText("Plain text");',
        "translator.translateTemplate(",
        '  "Across lines: {{x}}",',
        "  { x: 1 },",
        ");",
        'translator.translatePlural({ one: "{{count}} row", other: "{{count}} rows" }, 2);',
        "translator.translateText(SOME_CONSTANT);",
        'translationKey("With \\"quotes\\" inside");',
      ].join("\n"),
    });

    expect(
      keys.map((key: ServerTextKey): [string, string | undefined] => {
        return [key.key, key.one];
      }),
    ).toEqual([
      ["Marked {{name}}", undefined],
      ["Plain text", undefined],
      ["Across lines: {{x}}", undefined],
      ['With "quotes" inside', undefined],
      ["{{count}} rows", "{{count}} row"],
    ]);
  });

  test("reads a sentence in single quotes, which Prettier writes for one with double quotes in it", () => {
    const keys: Array<ServerTextKey> = findKeysInSource({
      file: "x.ts",
      text: [
        "translator.translateTemplate(",
        "  'Checks if {{name}} does not contain \"{{keyword}}\"',",
        "  { name: 1 },",
        ");",
        "translationKey('It\\'s {{name}}');",
        "translator.translateText('Back\\\\slash');",
        "translator.translateText('Escaped \\\"double\\\"');",
        "translator.translatePlural({ one: '{{count}} \"row\"', other: '{{count}} \"rows\"' }, 2);",
        'translator.translatePlural({ one: "{{count}} item", other: \'{{count}} "items"\' }, 2);',
        "translator.translateText('Not closed",
        "');",
      ].join("\n"),
    });

    expect(
      keys.map((key: ServerTextKey): [string, string | undefined] => {
        return [key.key, key.one];
      }),
    ).toEqual([
      ['Checks if {{name}} does not contain "{{keyword}}"', undefined],
      ["It's {{name}}", undefined],
      ["Back\\slash", undefined],
      ['Escaped "double"', undefined],
      ['{{count}} "rows"', '{{count}} "row"'],
      ['{{count}} "items"', "{{count}} item"],
    ]);
  });

  test("reads the email language helpers of a template", () => {
    const keys: Array<ServerTextKey> = findKeysInSource({
      file: "x.hbs",
      text: [
        '{{> EmailTitle title=(tt "New Incident: {{title}}" title=incidentTitle) }}',
        '{{> InfoBlock info=(tHtml "It\'s on.")}}',
        '<a>{{t "Unsubscribe"}}</a>',
        '{{> InfoBlock info=(ttHtml "On {{name}}." name=statusPageName) }}',
        '{{tp "{{count}} resource" "{{count}} resources" count}}',
        '{{> DetailBoxField title="Not looked up" }}',
        "{{tt someVariable}}",
      ].join("\n"),
    });

    expect(
      keys.map((key: ServerTextKey): [string, string | undefined] => {
        return [key.key, key.one];
      }),
    ).toEqual([
      ["New Incident: {{title}}", undefined],
      ["It's on.", undefined],
      ["Unsubscribe", undefined],
      ["On {{name}}.", undefined],
      ["{{count}} resources", "{{count}} resource"],
    ]);
  });

  test("a plural's one form is kept under its key plus _one", () => {
    expect(
      buildEnglishLocale([
        { key: "{{count}} rows", one: "{{count}} row", file: "x.ts" },
        { key: "B", file: "x.ts" },
        { key: "A", file: "x.ts" },
      ]),
    ).toEqual({
      A: "A",
      B: "B",
      "{{count}} rows": "{{count}} rows",
      "{{count}} rows_one": "{{count}} row",
    });
  });

  test("a language's new sentence starts in English, and a gone one goes", () => {
    expect(
      alignLocale({
        english: { A: "A", B: "B" },
        locale: { B: "Bee", Gone: "Weg" },
      }),
    ).toEqual({ A: "A", B: "Bee" });
  });
});
