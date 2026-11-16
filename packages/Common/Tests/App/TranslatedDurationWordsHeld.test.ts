// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import { getServerTranslator } from "../../Server/Utils/ServerTranslation";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
  NoBreakLocaleTree,
  withNoBreakSpacesInLocale,
  withPlainSpaces,
} from "../../Types/NoBreakSpaces";
import { createTranslator, Translator } from "../../Types/Translator";
import { getNameAfterPick } from "../../UI/Components/Forms/Utils/FollowPickName";
import { describeCronSchedule } from "../../Utils/CronScheduleText";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../Helpers/DashboardLocales";

/*
 * A TRANSLATED SENTENCE KEEPS A DURATION'S NUMBER ON THE LINE OF ITS WORD
 * (#8770).
 *
 * The Translator and every frontend's i18next held a number to a unit's
 * symbol ("Alle 5 Min.") but not to a duration's word: "Every {{count}}
 * minutes" broke as "Alle 5" over "Minuten", "Toutes les 5" over
 * "minutes", and English's own "Every 5" over "minutes". A duration's word
 * after a number and a space is a unit now (NoBreakSpaces'
 * ENGLISH_DURATION_WORDS), so each language's wording holds the figure to
 * whatever word it names the unit with, and so does a page's English
 * (drawsOnPage). English that may become a record's text - written with no
 * page's translator, or the server's - holds a unit's symbol only, so what
 * is stored still matches what reads it back. A sentence that becomes a
 * value - the name a form fills in - is written with plain spaces
 * (withPlainSpaces), so it still matches a name saved before and a search.
 */

const NB: string = NO_BREAK_SPACE;

// An English key that writes its count before a duration's word, plural.
const COUNT_BEFORE_A_DURATION_WORD: RegExp =
  /\{\{count\}\} (?:seconds|minutes|hours|days|weeks|months|years)(?![A-Za-z])/;

// Persian, Arabic-Indic and Devanagari digits as Latin ones.
const inLatinDigits: (text: string) => string = (text: string): string => {
  return text.replace(/[٠-٩۰-۹०-९]/g, (digit: string): string => {
    const code: number = digit.charCodeAt(0);
    const zero: number = code >= 0x966 ? 0x966 : code >= 0x6f0 ? 0x6f0 : 0x660;

    return String(code - zero);
  });
};

/*
 * Whether `text` writes `figure`, whichever digits its language writes: as
 * a number, or as Danish and Norwegian's ordinal ("Hvert 5. minut").
 */
const writes: (text: string, figure: string) => boolean = (
  text: string,
  figure: string,
): boolean => {
  return new RegExp(`(?<![\\d.,])${figure}(?![\\d,]|\\.\\d)`, "u").test(
    inLatinDigits(text),
  );
};

// Whether `text` has a plain space right after `figure`, before more words.
const breaksAfter: (text: string, figure: string) => boolean = (
  text: string,
  figure: string,
): boolean => {
  return new RegExp(`(?<![\\d.,])${figure} \\S`, "u").test(inLatinDigits(text));
};

describe("the Translator holds a duration's number to its word", () => {
  test("English templates, through the Dashboard's translator", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      english.translatePlural(
        { one: "Every {{count}} hour", other: "Every {{count}} hours" },
        6,
      ),
    ).toBe(`Every 6${NB}hours`);
    expect(
      english.translatePlural(
        {
          one: "Test ended: nobody acknowledged it within {{count}} minute.",
          other: "Test ended: nobody acknowledged it within {{count}} minutes.",
        },
        5,
      ),
    ).toBe(`Test ended: nobody acknowledged it within 5${NB}minutes.`);
    // Negative control: a number before another word is no duration's.
    expect(
      english.translatePlural(
        { one: "{{count}} monitor", other: "{{count}} monitors" },
        3,
      ),
    ).toBe("3 monitors");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s: every sentence whose English writes a count before a duration's word holds it",
    (language: string) => {
      const english: Record<string, string> = readDashboardLocale("en");
      const translator: Translator = dashboardTranslator(language);
      const found: Array<string> = [];
      let checked: number = 0;

      for (const key of Object.keys(english)) {
        if (key.endsWith("_one") || !COUNT_BEFORE_A_DURATION_WORD.test(key)) {
          continue;
        }

        const drawn: string = translator.translatePlural(
          { one: english[`${key}_one`] || key, other: key },
          7,
          { minute: "05", min: "9002", max: "9003", default: "9004" },
        );

        // A wording that writes the figure: what this check is for.
        if (!writes(drawn, "7")) {
          continue;
        }

        checked++;

        if (breaksAfter(drawn, "7")) {
          found.push(`${key}: ${drawn}`);
        }
      }

      expect(checked).toBeGreaterThan(20);
      expect(found).toEqual([]);
    },
  );

  test("German, French, Persian and Arabic wordings, as the Dashboard's i18next is handed them", () => {
    const english: NoBreakLocaleTree = {
      "Reminders can be sent between 15 minutes and 14 days before a shift.":
        "Reminders can be sent between 15 minutes and 14 days before a shift.",
      "Every {{count}} minutes": "Every {{count}} minutes",
    };

    expect(
      withNoBreakSpacesInLocale({
        locale: {
          "Reminders can be sent between 15 minutes and 14 days before a shift.":
            "Erinnerungen können zwischen 15 Minuten und 14 Tagen vor einer Schicht gesendet werden.",
          "Every {{count}} minutes": "Alle {{count}} Minuten",
        },
        language: "de",
        english,
      }),
    ).toEqual({
      "Reminders can be sent between 15 minutes and 14 days before a shift.": `Erinnerungen können zwischen 15${NB}Minuten und 14${NB}Tagen vor einer Schicht gesendet werden.`,
      "Every {{count}} minutes": `Alle {{count}}${NB}Minuten`,
    });
    expect(
      withNoBreakSpacesInLocale({
        locale: { "Every {{count}} minutes": "Toutes les {{count}} minutes" },
        language: "fr",
        english,
      }),
    ).toEqual({
      "Every {{count}} minutes": `Toutes les {{count}}${NB}minutes`,
    });
    expect(
      withNoBreakSpacesInLocale({
        locale: { "Every {{count}} minutes": "هر {{count}} دقیقه" },
        language: "fa",
        english,
      }),
    ).toEqual({ "Every {{count}} minutes": `هر {{count}}${NB}دقیقه` });
    expect(
      withNoBreakSpacesInLocale({
        locale: { "Every {{count}} minutes": "كل {{count}} دقائق" },
        language: "ar",
        english,
      }),
    ).toEqual({ "Every {{count}} minutes": `كل {{count}}${NB}دقائق` });
  });

  test("a cron schedule in German, as the Translator words it", () => {
    const drawn: string = describeCronSchedule(
      "*/5 * * * *",
      dashboardTranslator("de"),
    ) as string;

    expect(writes(drawn, "5")).toBe(true);
    expect(breaksAfter(drawn, "5")).toBe(false);
  });

  test("the reminder refusal, looked up whole by its English", () => {
    const key: string =
      "Reminders can be sent between 15 minutes and 14 days before a shift.";
    const german: string = dashboardTranslator("de").translateText(key) || "";

    expect(german).not.toBe(key);
    expect(breaksAfter(german, "15")).toBe(false);
    expect(breaksAfter(german, "14")).toBe(false);
  });

  test("the server's wordings hold it, and its English is left as it may be stored", () => {
    // A German email's sentence is a wording: held.
    expect(
      breaksAfter(
        getServerTranslator("de").translatePlural(
          { one: "{{count}} minute", other: "{{count}} minutes" },
          30,
        ),
        "30",
      ),
    ).toBe(false);
    // The server's English may become a record's text read back by its English.
    expect(
      getServerTranslator("en").translateTemplate("{{count}} minutes", {
        count: 30,
      }),
    ).toBe("30 minutes");
  });

  test("negative control: a value, and a text no locale words, go out as written", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(
      english.translateTemplate("Monitor {{name}}", {
        name: "Every 5 minutes",
      }),
    ).toBe("Monitor Every 5 minutes");
    expect(english.translateText("Rescan every 15 minutes")).toBe(
      "Rescan every 15 minutes",
    );
  });

  test("control: the check finds a plain space after a figure, in any digits", () => {
    expect(breaksAfter("Alle 7 Minuten", "7")).toBe(true);
    expect(breaksAfter("هر ۷ دقیقه", "7")).toBe(true);
    expect(breaksAfter(`هر ۷${NB}دقیقه`, "7")).toBe(false);
    expect(breaksAfter("Alle 17 Minuten", "7")).toBe(false);
    expect(writes("هر ۷ دقیقه", "7")).toBe(true);
    expect(writes("Hvert 5. minut", "5")).toBe(true);
    expect(writes("Alle 17 Minuten", "7")).toBe(false);
  });
});

describe("a sentence that becomes a value is written with plain spaces", () => {
  test("withPlainSpaces writes the held spaces as plain ones, and nothing else", () => {
    expect(withPlainSpaces(`Remind every 15${NB}minutes until resolved`)).toBe(
      "Remind every 15 minutes until resolved",
    );
    expect(withPlainSpaces(`Durée${NARROW_NO_BREAK_SPACE}: 5${NB}min`)).toBe(
      "Durée : 5 min",
    );
    // Negative controls: plain text, an empty name, and other spaces.
    expect(withPlainSpaces("Remind every 15 minutes")).toBe(
      "Remind every 15 minutes",
    );
    expect(withPlainSpaces("")).toBe("");
    expect(withPlainSpaces("a\tb\u2009c")).toBe("a\tb\u2009c");
  });

  test("a name the form fills in follows, whichever spaces the saved name has", () => {
    const filled: string = `Remind every 15${NB}minutes until resolved`;
    const saved: string = "Remind every 15 minutes until resolved";

    // The form's own name, saved before this with plain spaces: it follows.
    expect(
      getNameAfterPick({
        name: saved,
        pickedName: `Remind every 30${NB}minutes until resolved`,
        filledInNames: [filled],
      }),
    ).toBe("Remind every 30 minutes until resolved");
    // And a held one, filled in by this form, matches its plain record.
    expect(
      getNameAfterPick({
        name: filled,
        pickedName: "Remind every 45 minutes until resolved",
        filledInNames: [saved],
      }),
    ).toBe("Remind every 45 minutes until resolved");
    // Negative control: a name somebody typed stays theirs.
    expect(
      getNameAfterPick({
        name: "Page the night shift",
        pickedName: `Remind every 30${NB}minutes until resolved`,
        filledInNames: [filled],
      }),
    ).toBeNull();
  });
});
