import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A new on-call schedule asks who takes turns: Create On-Call Schedule asks
 * "Who takes turns?" with the people picker, and how long each turn lasts
 * under Advanced, which - folded, with somebody picked - says what the
 * default will do. Every word of that is looked up in the Dashboard locale
 * files by its English text, so a string no locale carries stays English for
 * everyone. This pins the strings the form draws - in all seventeen locales,
 * translated - including the picker's own, which existed before but were
 * still English in most languages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

// The English that reads the same in a language (Locales/README.md).
const I18N_DIR: string = path.join(DASHBOARD_SRC, "..", "i18n");

const FORM_FILE: string = "Components/OnCallPolicy/OnCallScheduleCreateForm.ts";

// The strings this change adds, as the form writes them.
const NEW_STRINGS: Array<string> = [
  // The question, and what it says under it.
  "Who takes turns?",
  "On call one at a time, in the order you add them, starting now.",
  // Under Advanced, once somebody is picked.
  "Each turn lasts",
  "Then the next person takes over.",
  // The folded section's line while nothing in it is changed.
  "Each person is on call for a week, then the next one takes over.",
];

// The picker's button, search box and empty list, and the turn lengths.
const REUSED_STRINGS: Array<string> = [
  "Add user",
  "Search by name or email…",
  "No project members",
  "1 day",
  "1 week",
  "2 weeks",
  "1 month",
];

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];
const QUESTION_ENDINGS: Array<string> = ["?", "？", "؟"];

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

type ReadLocaleFunction = (file: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string) => {
    return file.endsWith(".json");
  })
  .sort();

const NON_ENGLISH_FILES: Array<string> = LOCALE_FILES.filter((file: string) => {
  return file !== "en.json";
});

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
};

// The form module, without the prose about it.
const CODE: string = stripComments(
  fs.readFileSync(path.join(DASHBOARD_SRC, FORM_FILE), "utf8"),
).replace(/\s+/g, " ");

const endsWithOneOf: (value: string, endings: Array<string>) => boolean = (
  value: string,
  endings: Array<string>,
): boolean => {
  return endings.some((ending: string): boolean => {
    return value.trim().endsWith(ending);
  });
};

/*
 * What reads the same in the language of `file`: the global list and the
 * locale's own (i18n/Progress/<code>.json), as `npm run i18n:check` counts.
 */
type SameAsEnglishFunction = (file: string) => Set<string>;

const readSameAsEnglish: SameAsEnglishFunction = (
  file: string,
): Set<string> => {
  const global: Array<string> = JSON.parse(
    fs.readFileSync(path.join(I18N_DIR, "SameAsEnglish.json"), "utf8"),
  ) as Array<string>;

  const progressFile: string = path.join(I18N_DIR, "Progress", file);

  const own: Array<string> = fs.existsSync(progressFile)
    ? (
        JSON.parse(fs.readFileSync(progressFile, "utf8")) as {
          sameAsEnglish?: Array<string>;
        }
      ).sameAsEnglish || []
    : [];

  return new Set<string>([...global, ...own]);
};

type ProblemsFunction = (file: string, texts: Array<string>) => Array<string>;

const findProblems: ProblemsFunction = (
  file: string,
  texts: Array<string>,
): Array<string> => {
  const locale: Record<string, unknown> = readLocale(file);
  const sameAsEnglish: Set<string> = readSameAsEnglish(file);

  return texts.flatMap((text: string): Array<string> => {
    const value: unknown = locale[text];

    if (typeof value !== "string" || value.trim().length === 0) {
      return [`missing: ${text}`];
    }

    if (value === text && !sameAsEnglish.has(text)) {
      return [`left in English: ${text}`];
    }

    const placeholders: string = (text.match(PLACEHOLDER) || [])
      .sort()
      .join(",");

    if ((value.match(PLACEHOLDER) || []).sort().join(",") !== placeholders) {
      return [`placeholders changed: ${text}`];
    }

    // A sentence stays a sentence, a question a question, a label a label.
    const isSentence: boolean = text.endsWith(".");
    const isQuestion: boolean = text.endsWith("?");

    if (isSentence !== endsWithOneOf(value, SENTENCE_ENDINGS)) {
      return [`punctuation differs: ${text}`];
    }

    if (isQuestion !== endsWithOneOf(value, QUESTION_ENDINGS)) {
      return [`question mark differs: ${text}`];
    }

    return [];
  });
};

describe("the who-takes-turns form's strings", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("each string is drawn by the form, as one whole string", () => {
    const unused: Array<string> = [...NEW_STRINGS, ...REUSED_STRINGS].filter(
      (text: string): boolean => {
        return !CODE.includes(`"${text}"`);
      },
    );

    expect(unused).toEqual([]);
  });

  test("English carries every string as itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    const wrong: Array<string> = [...NEW_STRINGS, ...REUSED_STRINGS].filter(
      (text: string): boolean => {
        return english[text] !== text;
      },
    );

    expect(wrong).toEqual([]);
  });

  test("the new strings read in each language's own words", () => {
    // Nothing new is excused as reading the same as English anywhere.
    for (const file of NON_ENGLISH_FILES) {
      const excused: Array<string> = NEW_STRINGS.filter(
        (text: string): boolean => {
          return readSameAsEnglish(file).has(text);
        },
      );

      expect({ file, excused }).toEqual({ file, excused: [] });
    }
  });

  test.each(NON_ENGLISH_FILES)(
    "%s translates every new string",
    (file: string) => {
      expect(findProblems(file, NEW_STRINGS)).toEqual([]);
    },
  );

  test.each(NON_ENGLISH_FILES)(
    "%s translates the picker's and the turn lengths' strings too",
    (file: string) => {
      expect(findProblems(file, REUSED_STRINGS)).toEqual([]);
    },
  );
});
