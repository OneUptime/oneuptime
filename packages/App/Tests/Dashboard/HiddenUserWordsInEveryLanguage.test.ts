import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import { FILTER_BY_HIDDEN_USER } from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/HiddenUserCopy";
import { UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE } from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";

/*
 * THE WORDS FOR A USER A SCRUB RULE HID (#10435), IN EVERY LANGUAGE THE
 * DASHBOARD SHIPS - read from its locale files as they ship.
 *
 * A user id a scrub rule hid is never one user, and the page says so where
 * it would have counted or named one: an exception's row counts hidden
 * users and events with a hidden user, the AI Usage tab files spend nobody's
 * name can be put to under one row and says what it is, Run on Past Events
 * says how many a rule hid the user of, and an event's Principal User
 * filters to every event whose user a rule hid. A German, Japanese or
 * Arabic reader meets none of it in English.
 */

// The exceptions row's numbers (Components/Exceptions/ExceptionRow.tsx).
const HIDDEN_USERS: PluralTemplate = {
  one: "{{number}} hidden user",
  other: "{{number}} hidden users",
};

const EVENTS_WITH_A_HIDDEN_USER: PluralTemplate = {
  one: "{{number}} event with a hidden user",
  other: "{{number}} events with a hidden user",
};

// Their hover text, and the AI Usage tab's notes (Components/AI/LlmUsageBreakdown.tsx).
const SENTENCES: ReadonlyArray<string> = [
  FILTER_BY_HIDDEN_USER,
  "Users whose ID a scrub rule hashed: each is counted once, but nobody can name them",
  "A scrub rule redacted or masked the user of these events, so they can't be counted as users",
  "{{hidden}} is usage whose person a scrub rule hid, so it isn't counted as anyone's.",
  "{{hidden}} is usage whose team a scrub rule hid, so it isn't counted as any team's.",
];

const PLURALS: ReadonlyArray<PluralTemplate> = [
  HIDDEN_USERS,
  EVENTS_WITH_A_HIDDEN_USER,
  UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE,
];

// Every key: each sentence, and each plural's general form and its "one".
const KEYS: ReadonlyArray<string> = [
  ...SENTENCES,
  ...PLURALS.flatMap((plural: PluralTemplate): Array<string> => {
    return [plural.other, `${plural.other}_one`];
  }),
];

describe("the words for a user a scrub rule hid", () => {
  test("are each a key the Dashboard's English holds", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }

    for (const plural of PLURALS) {
      expect({
        other: english[plural.other],
        one: english[`${plural.other}_one`],
      }).toEqual({ other: plural.other, one: plural.one });
    }
  });

  test("are worded in every language, each keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
          continue;
        }

        const english: string = key.endsWith("_one")
          ? key.slice(0, -"_one".length)
          : key;

        expect({
          language,
          key,
          placeholders: placeholdersOf(words[key] || ""),
        }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english),
        });
      }
    }

    expect(unworded).toEqual([]);
  });

  test("the counts read right at one and at many, in the reader's digits, in every language", () => {
    const english: Translator = dashboardTranslator("en");

    expect(english.translatePlural(HIDDEN_USERS, 1, { number: "1" })).toBe(
      "1 hidden user",
    );
    expect(
      english.translatePlural(EVENTS_WITH_A_HIDDEN_USER, 1204, {
        number: english.formatNumber(1204),
      }),
    ).toBe("1,204 events with a hidden user");
    expect(
      english.translatePlural(UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE, 312),
    ).toBe("A scrub rule hid the user of 312 of them.");

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const count of [1, 21, 1204]) {
        const number: string = translator.formatNumber(count);

        for (const plural of [HIDDEN_USERS, EVENTS_WITH_A_HIDDEN_USER]) {
          const drawn: string = translator.translatePlural(plural, count, {
            number,
          });

          expect({
            language,
            count,
            plural: plural.other,
            counted: drawn.includes(number),
            english:
              drawn === english.translatePlural(plural, count, { number }),
          }).toEqual({
            language,
            count,
            plural: plural.other,
            counted: true,
            english: false,
          });
        }

        const hidden: string = translator.translatePlural(
          UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE,
          count,
        );

        expect({
          language,
          count,
          counted: hidden.includes(number),
        }).toEqual({ language, count, counted: true });
      }
    }
  });

  test("the AI Usage tab's notes name their row in the reader's language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const row: string = translator.translateText("Hidden by a scrub rule");

      for (const note of SENTENCES.slice(3)) {
        const drawn: string = translator.translateTemplate(note, {
          hidden: row,
        });

        expect({
          language,
          note,
          named: drawn.includes(row),
          english:
            drawn ===
            dashboardTranslator("en").translateTemplate(note, {
              hidden: "Hidden by a scrub rule",
            }),
        }).toEqual({ language, note, named: true, english: false });
      }
    }
  });
});
