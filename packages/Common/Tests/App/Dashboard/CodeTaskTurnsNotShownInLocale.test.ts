import { describe, expect, test } from "@jest/globals";
import { CODE_TASK_TURNS_NOT_SHOWN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTurnsNotShown";
import { CODE_TASK_LOG_TURN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskLogTurns";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHERE A LONG CODE TASK'S PAGE LEAVES TURNS OUT, IN EVERY DASHBOARD
 * LANGUAGE (issue #6529): "5 earlier turns are not shown", read from the
 * locale files themselves, so a form that lost its translation or kept the
 * English is caught - and each language words it with the word it already
 * uses for a turn of a task.
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const OTHER: string = CODE_TASK_TURNS_NOT_SHOWN_COPY.other;
const ONE: string = `${CODE_TASK_TURNS_NOT_SHOWN_COPY.other}_one`;

describe("English holds both forms under the sentence's own words", () => {
  test("the general form, and the one form under it", () => {
    expect(ENGLISH[OTHER]).toBe("{{count}} earlier turns are not shown");
    expect(ENGLISH[ONE]).toBe("{{count}} earlier turn is not shown");
  });
});

describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
  const words: Record<string, string> = readDashboardLocale(language);

  test("both forms are the language's own, each with its count", () => {
    for (const key of [OTHER, ONE]) {
      expect({
        key,
        worded: isWordedInDashboardLocale(key, language),
      }).toEqual({ key, worded: true });
      expect(placeholdersOf(words[key]!)).toEqual(["{{count}}"]);
    }

    // Not the English, even where the one form is never read.
    expect(words[OTHER]).not.toBe(ENGLISH[OTHER]);
  });

  test("the sentence reads with a count the reader's way", () => {
    const translator: Translator = dashboardTranslator(language);

    for (const count of [1, 2, 5, 21, 205]) {
      const sentence: string = translator.translatePlural(
        CODE_TASK_TURNS_NOT_SHOWN_COPY,
        count,
      );

      expect(sentence).not.toContain("{{");
      expect(sentence).not.toContain("earlier turn");
    }
  });
});

/*
 * The word a language uses for a turn of a task (the Log page's "Turn
 * {{number}}"), in the sentence too: a reader meets one word for one thing.
 */
describe("each language names a turn with its own word for one", () => {
  const TURN_WORDS: Record<string, string> = {
    de: "Durchg",
    fr: "tour",
    es: "turno",
    it: "turn",
    pt: "turno",
    nl: "beurt",
    da: "tur",
    no: "tur",
    sv: "tur",
    ru: "ход",
    ja: "ターン",
    ko: "차례",
    "zh-CN": "回合",
    "zh-TW": "回合",
    // बारी, and its plural बारियाँ.
    hi: "बार",
    fa: "نوبت",
    ar: "جول",
  };

  test("every Dashboard language is named here", () => {
    expect(Object.keys(TURN_WORDS).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );
  });

  test.each(Object.entries(TURN_WORDS))(
    "%s",
    (language: string, word: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[CODE_TASK_LOG_TURN_COPY.option]!.toLowerCase()).toContain(
        word.toLowerCase(),
      );
      expect(words[OTHER]!.toLowerCase()).toContain(word.toLowerCase());
      expect(words[ONE]!.toLowerCase()).toContain(word.toLowerCase());
    },
  );
});

/*
 * Arabic reads a plural's general form for 0, 2, 3-10, 11-99 and 100 and
 * up (Locales/ARABIC.md): a label and its count, which reads right for
 * each; the one form keeps its count and a singular noun. Russian's general
 * form serves every count but its "one" ones (2-4, 5-20 ...): a label and
 * its count too.
 */
describe("a language with many plural forms reads right for every count", () => {
  test("Arabic: the label, then the count; one: the count and one turn", () => {
    const ARABIC: Record<string, string> = readDashboardLocale("ar");

    expect(ARABIC[OTHER]).toMatch(/: \{\{count\}\}$/);
    expect(ARABIC[ONE]).toContain("{{count}} جولة");
  });

  test("Russian: the label, then the count", () => {
    const RUSSIAN: Record<string, string> = readDashboardLocale("ru");

    expect(RUSSIAN[OTHER]).toMatch(/: \{\{count\}\}$/);
  });
});

describe("the Dashboard's own conventions", () => {
  // The Dashboard's Spanish speaks to the reader as tú.
  test("Spanish never says usted", () => {
    const SPANISH: Record<string, string> = readDashboardLocale("es");

    for (const key of [OTHER, ONE]) {
      expect(SPANISH[key]).not.toMatch(/\busted\b/i);
    }
  });

  // Locales/ARABIC.md: the only mark a locale file keeps is an LRM by a lone sign.
  test("Arabic and Persian put no direction mark in the sentence", () => {
    const marks: RegExp = new RegExp(
      `[${String.fromCharCode(0x200e)}${String.fromCharCode(0x200f)}${String.fromCharCode(0x061c)}]`,
    );

    for (const language of ["ar", "fa"]) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [OTHER, ONE]) {
        expect(words[key]).not.toMatch(marks);
      }
    }
  });
});

/*
 * The check above can fail: German keeps some keys in English for now, and
 * the check says so for each of them - so a sentence left in English, as
 * ours was before it was translated, would not pass it.
 */
describe("negative control", () => {
  // A sentence, not a name or a unit: two words of four letters or more.
  const TWO_WORDS: RegExp = /[a-z]{4,} [a-z]{4,}/;

  test("a key German leaves in English is not worded in German", () => {
    const GERMAN: Record<string, string> = readDashboardLocale("de");

    const leftInEnglish: string | undefined = Object.keys(ENGLISH).find(
      (key: string): boolean => {
        return (
          !key.endsWith("_one") &&
          GERMAN[key] === ENGLISH[key] &&
          TWO_WORDS.test(key) &&
          !isWordedInDashboardLocale(key, "de")
        );
      },
    );

    expect(leftInEnglish).toBeDefined();
    expect(isWordedInDashboardLocale(leftInEnglish!, "de")).toBe(false);
  });

  test("a sentence no locale holds is worded in none", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(
        isWordedInDashboardLocale(
          "{{count}} earlier turns are not shown, nowhere",
          language,
        ),
      ).toBe(false);
    }
  });
});
