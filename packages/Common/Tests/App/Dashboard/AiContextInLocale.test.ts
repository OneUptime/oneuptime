import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AI_CONTEXT_ACTIVITY_COPY,
  AI_CONTEXT_CARD_COPY,
  AI_CONTEXT_CHARACTERS_TEMPLATE,
  AI_CONTEXT_OUTLINE_BUTTON_TEXT,
  AI_CONTEXT_OUTLINE_HEADINGS,
  AI_CONTEXT_SIZE_TEMPLATE,
  AI_CONTEXT_TOKENS_TEMPLATE,
  AI_CONTEXT_TOO_LONG_TEMPLATE,
  AI_RULE_AI_CONTEXT_FIELD_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextCopy";
import Project from "../../../Models/DatabaseModels/Project";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";

/*
 * EVERY WORD THE AI CONTEXT ADDS IS EVERY LANGUAGE'S OWN (issue #5198): the
 * project's card and its dialog, the AI rule's field, the count and token
 * estimate under both, the outline an empty field starts from, and the line
 * a run's activity draws for what it read - read from the Dashboard's
 * locale files themselves, so a key that lost its translation, kept the
 * English or lost a placeholder is caught.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

// Japanese, Korean and Chinese read no "one" form: theirs may stay as is.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

// Words the product already had, translated long before the AI context.
const ALREADY_TRANSLATED: Array<string> = [
  "Edit",
  "Show more",
  "Show less",
  "View",
  "Project",
  "Close",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

// Every sentence the AI context adds, by the key the code looks it up with.
const SENTENCES: Array<string> = Array.from(
  new Set<string>([
    ...Object.values(AI_CONTEXT_CARD_COPY),
    ...Object.values(AI_RULE_AI_CONTEXT_FIELD_COPY),
    AI_CONTEXT_OUTLINE_BUTTON_TEXT,
    ...AI_CONTEXT_OUTLINE_HEADINGS,
    AI_CONTEXT_CHARACTERS_TEMPLATE,
    AI_CONTEXT_TOO_LONG_TEMPLATE,
    AI_CONTEXT_ACTIVITY_COPY.projectOnly,
    AI_CONTEXT_ACTIVITY_COPY.viewButtonText,
    AI_CONTEXT_ACTIVITY_COPY.modalTitle,
    AI_CONTEXT_ACTIVITY_COPY.modalDescription,
    AI_CONTEXT_ACTIVITY_COPY.projectPartTitle,
    AI_CONTEXT_ACTIVITY_COPY.rulePartTitle,
    AI_CONTEXT_ACTIVITY_COPY.closeButtonText,
    // The column's title, where a form or the API reference names it.
    new Project().getTableColumnMetadata("aiContext").title!,
  ]),
).filter((sentence: string): boolean => {
  return !ALREADY_TRANSLATED.includes(sentence);
});

// The plural sentences: their "other" key, and the "one" form under _one.
const PLURALS: Array<PluralTemplate> = [
  AI_CONTEXT_TOKENS_TEMPLATE,
  AI_CONTEXT_SIZE_TEMPLATE,
  AI_CONTEXT_ACTIVITY_COPY.projectAndRules,
  AI_CONTEXT_ACTIVITY_COPY.rulesOnly,
  AI_CONTEXT_ACTIVITY_COPY.leftOut,
];

/*
 * The placeholders a sentence fills, each once: a language may name the
 * count twice, or once where English does.
 */
const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("English holds every sentence under its own words", () => {
  test("there is something to check", () => {
    expect(SENTENCES.length).toBeGreaterThanOrEqual(18);
    expect(SENTENCES).toContain("AI Context");
    expect(SENTENCES).toContain("Start from an outline");
  });

  test.each(SENTENCES)("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    expect(ENGLISH[plural.other]).toBe(plural.other);
    expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
  });

  test("the words the product already had are still its own", () => {
    for (const word of ALREADY_TRANSLATED) {
      expect(ENGLISH[word]).toBe(word);
    }
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  const words: Record<string, string> = LOCALES[language]!;

  test("every sentence is the language's own, with the English placeholders", () => {
    for (const sentence of SENTENCES) {
      const translated: string | undefined = words[sentence];

      expect({
        sentence,
        isTranslated: Boolean(translated) && translated !== sentence,
      }).toEqual({
        sentence,
        isTranslated: true,
      });
      expect({ sentence, placeholders: placeholders(translated!) }).toEqual({
        sentence,
        placeholders: placeholders(sentence),
      });
    }
  });

  test("every plural is the language's own, with the English placeholders", () => {
    for (const plural of PLURALS) {
      expect(words[plural.other]).toBeDefined();
      expect(words[plural.other]).not.toBe(plural.other);
      expect(placeholders(words[plural.other]!)).toEqual(
        placeholders(plural.other),
      );

      if (!WITHOUT_ONE_FORM.includes(language)) {
        expect(words[`${plural.other}_one`]).toBeDefined();
        expect(words[`${plural.other}_one`]).not.toBe(plural.one);
        expect(placeholders(words[`${plural.other}_one`]!)).toEqual(
          placeholders(plural.one),
        );
      }
    }
  });

  test("the outline's headings are the language's own, so a team's notes start in it", () => {
    const headings: Array<string> = AI_CONTEXT_OUTLINE_HEADINGS.map(
      (heading: string): string => {
        return words[heading] || heading;
      },
    );

    expect(new Set(headings).size).toBe(AI_CONTEXT_OUTLINE_HEADINGS.length);
    for (const heading of headings) {
      expect(AI_CONTEXT_OUTLINE_HEADINGS).not.toContain(heading);
    }
  });
});
