import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A new on-call policy pages someone from the start: Create On-Call Policy
 * asks "Who gets paged first?", and the policy overview's two "pages nobody"
 * states say so in a sentence and offer a way to the Escalation Rules page.
 * Every word of that is looked up in the Dashboard locale files by its
 * English text, so a string no locale carries stays English for everyone.
 * This pins the strings the change draws - in all seventeen locales,
 * translated - and that the one it replaced, which sent readers to an
 * "Escalation tab", left the source and the locales together.
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

// Every string this change draws, by where it is drawn.
const NEW_STRINGS: Array<string> = [
  // The create form's question, and what it says under it.
  "Who gets paged first?",
  "Paged as soon as this policy is triggered. You can add more escalation levels later.",
  // The policy overview, when the policy has no rules.
  "This policy has no escalation rules yet, so triggering it will not page anyone.",
  // ...and when its rules have nobody in them.
  "No responders are assigned",
  "This policy will not page anyone when it is triggered.",
  // The way out of both.
  "Go to Escalation Rules",
];

// The sentence it replaced. Nothing draws it any more.
const RETIRED_STRINGS: Array<string> = [
  "This policy will not page anyone when it is triggered. Add on-call schedules, teams, or users on the Escalation tab.",
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

// The files that draw these strings, without the prose about them.
const SOURCE_FILES: Array<string> = [
  "Components/OnCallPolicy/OnCallPolicyCreateForm.ts",
  "Components/OnCallPolicy/OnCallPolicySummary.tsx",
];

const CODE: string = SOURCE_FILES.map((file: string): string => {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8"),
  ).replace(/\s+/g, " ");
}).join("\n");

const endsWithOneOf: (value: string, endings: Array<string>) => boolean = (
  value: string,
  endings: Array<string>,
): boolean => {
  return endings.some((ending: string): boolean => {
    return value.trim().endsWith(ending);
  });
};

describe("the first responders change's strings", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("each new string is drawn by the code, as one whole string", () => {
    const unused: Array<string> = NEW_STRINGS.filter(
      (text: string): boolean => {
        return !CODE.includes(`"${text}"`);
      },
    );

    expect(unused).toEqual([]);
  });

  test("the retired sentence is not drawn any more", () => {
    const drawn: Array<string> = RETIRED_STRINGS.filter(
      (text: string): boolean => {
        return CODE.includes(text);
      },
    );

    expect(drawn).toEqual([]);
  });

  test("English carries every new string as itself", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    const wrong: Array<string> = NEW_STRINGS.filter((text: string): boolean => {
      return english[text] !== text;
    });

    expect(wrong).toEqual([]);
  });

  test.each(LOCALE_FILES)("%s keeps none of the retired keys", (file: string) => {
    const locale: Record<string, unknown> = readLocale(file);

    const kept: Array<string> = RETIRED_STRINGS.filter(
      (text: string): boolean => {
        return text in locale;
      },
    );

    expect(kept).toEqual([]);
  });

  test.each(NON_ENGLISH_FILES)(
    "%s translates every new string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      const problems: Array<string> = NEW_STRINGS.flatMap(
        (text: string): Array<string> => {
          const value: unknown = locale[text];

          if (typeof value !== "string" || value.trim().length === 0) {
            return [`missing: ${text}`];
          }

          if (value === text) {
            return [`left in English: ${text}`];
          }

          const placeholders: string = (text.match(PLACEHOLDER) || [])
            .sort()
            .join(",");

          if (
            (value.match(PLACEHOLDER) || []).sort().join(",") !== placeholders
          ) {
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
        },
      );

      expect(problems).toEqual([]);
    },
  );
});
