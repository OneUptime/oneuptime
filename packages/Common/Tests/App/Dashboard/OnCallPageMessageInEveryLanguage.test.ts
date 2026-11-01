import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";

/*
 * ---------------------------------------------------------------------------
 * "Page Message", in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * An on-call run's Page Message is what the person who paged from Slack or
 * Microsoft Teams wrote to the people the page reaches. The column's title
 * reached master without being translated, and sat as an English
 * placeholder in the 16 other Dashboard locales.
 *
 * Each language names it with the word it pages with everywhere else in
 * the Dashboard - an on-call page, not a web page: German "Alarmierung",
 * French "alerte", Japanese "呼び出し" - read here from that language's
 * "You do not have permission to page on-call policies.".
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

const OTHER_LANGUAGES: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const LOCALES: Record<string, Locale> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
}

const PAGE_MESSAGE: string = "Page Message";

// A sentence each language already words with its verb for paging.
const PAGING_SENTENCE: string =
  "You do not have permission to page on-call policies.";

// The stem of each language's word for an on-call page.
const PAGE_WORD: Record<string, string> = {
  da: "tilkald",
  de: "alarm",
  es: "avis",
  fa: "فراخوانی",
  fr: "alert",
  hi: "पेज",
  it: "allert",
  ja: "呼び出",
  ko: "호출",
  nl: "roep",
  no: "tilkall",
  pt: "acion",
  ru: "вызов",
  sv: "larm",
  "zh-CN": "呼叫",
  "zh-TW": "呼叫",
};

const INSTANCES: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts): default separators.
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: LOCALES["en"] as Locale },
        [language]: { translation: LOCALES[language] as Locale },
      },
      interpolation: { escapeValue: false },
    });

    INSTANCES[language] = instance;
  }
});

describe("the on-call run's Page Message, in the Dashboard's locales", () => {
  test("is the title of the run's pageMessage column, and a key of the Dashboard's English", () => {
    expect(
      new OnCallDutyPolicyExecutionLog().getTableColumnMetadata("pageMessage")
        .title,
    ).toBe(PAGE_MESSAGE);
    expect((LOCALES["en"] as Locale)[PAGE_MESSAGE]).toBe(PAGE_MESSAGE);
  });

  test("every language but English is checked, with its word for a page", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(Object.keys(PAGE_WORD).sort()).toEqual(OTHER_LANGUAGES);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own words for it, which the Dashboard draws",
    (language: string) => {
      const translated: unknown = (LOCALES[language] as Locale)[PAGE_MESSAGE];

      expect(typeof translated).toBe("string");
      expect((translated as string).trim()).not.toBe("");
      expect(translated).not.toBe(PAGE_MESSAGE);
      expect((INSTANCES[language] as i18n).t(PAGE_MESSAGE)).toBe(translated);
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s names the page with the word it pages with elsewhere",
    (language: string) => {
      const word: string = PAGE_WORD[language] as string;
      const lower: (text: unknown) => string = (text: unknown): string => {
        return String(text).toLocaleLowerCase(language);
      };

      expect(lower((LOCALES[language] as Locale)[PAGING_SENTENCE])).toContain(
        lower(word),
      );
      expect(lower((LOCALES[language] as Locale)[PAGE_MESSAGE])).toContain(
        lower(word),
      );
    },
  );
});
