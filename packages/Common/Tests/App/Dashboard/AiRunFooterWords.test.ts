import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * Issue #5073: an Ask AI answer's footer ("$0.0183 · 10,962 tokens · 3
 * queries · claude-sonnet-5-5") and an investigation's "Model and tokens"
 * footer ("10,962 tokens · Model claude-sonnet-5-5") show a run's tokens as
 * OneUptime counts them, and so does every AI Logs row's "28,496 tokens"
 * fact. "{{count}} tokens" still read English in 15 of the 16 languages, and
 * so did the two facts beside it in those footers - so a German footer read
 * "10.962 tokens · 3 queries", and translating only the tokens would have
 * made it half German. The three are translated together, and the footers
 * read in one language.
 */

const LOCALES_DIR: string = path.join(
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

// The footer facts, as the components ask for them.
const TOKENS: PluralTemplate = {
  one: "{{count}} token",
  other: "{{count}} tokens",
};
const QUERIES: PluralTemplate = {
  one: "{{count}} query",
  other: "{{count}} queries",
};
const MODEL: string = "Model {{name}}";

/*
 * Where a language writes the words as English does, its entry may stay the
 * English text: "tokens" in Danish, Spanish, Dutch, Norwegian, Portuguese and
 * Swedish, Italian's invariable "token" and "query", Dutch's "query", and
 * "Model" in Danish and Dutch. Japanese, Korean and Chinese have no "one"
 * form, so theirs is never read.
 */
const AS_IN_ENGLISH: Record<string, Array<string>> = {
  "{{count}} tokens": ["da", "es", "nl", "no", "pt", "sv"],
  "{{count}} tokens_one": ["da", "es", "it", "nl", "no", "pt", "sv"],
  "{{count}} queries_one": ["it", "nl"],
  "Model {{name}}": ["da", "nl"],
};
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

describe("the AI run footers' words", () => {
  test("en.json keys them as the components ask for them", () => {
    const english: Record<string, string> = readLocale("en");

    expect(english[TOKENS.other]).toBe(TOKENS.other);
    expect(english[`${TOKENS.other}_one`]).toBe(TOKENS.one);
    expect(english[QUERIES.other]).toBe(QUERIES.other);
    expect(english[`${QUERIES.other}_one`]).toBe(QUERIES.one);
    expect(english[MODEL]).toBe(MODEL);
  });

  test.each(LANGUAGES)(
    "%s words every footer fact its own way, keeping its value",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);

      for (const key of [
        TOKENS.other,
        `${TOKENS.other}_one`,
        QUERIES.other,
        `${QUERIES.other}_one`,
        MODEL,
      ]) {
        const value: string | undefined = locale[key];
        const placeholder: string = key === MODEL ? "{{name}}" : "{{count}}";

        expect({ language, key, keeps: value?.includes(placeholder) }).toEqual({
          language,
          key,
          keeps: true,
        });

        const mayStayEnglish: boolean =
          (AS_IN_ENGLISH[key] || []).includes(language) ||
          (key.endsWith("_one") && WITHOUT_ONE_FORM.includes(language));

        if (!mayStayEnglish) {
          expect({
            language,
            key,
            translated: value !== english[key],
          }).toEqual({ language, key, translated: true });
        }
      }
    },
  );

  test("a German Ask AI footer reads in German", () => {
    const german: Translator = translatorFor("de");

    expect(
      [
        german.translatePlural(TOKENS, 10_962),
        german.translatePlural(QUERIES, 3),
        german.translateTemplate(MODEL, { name: "claude-sonnet-5-5" }),
      ].join(" · "),
    ).toBe("10.962 Tokens · 3 Abfragen · Modell claude-sonnet-5-5");
    expect(german.translatePlural(QUERIES, 1)).toBe("1 Abfrage");
  });

  test("a Russian footer reads right for any count", () => {
    const russian: Translator = translatorFor("ru");

    expect(russian.translatePlural(TOKENS, 10_962)).toBe(
      `Токенов: ${(10_962).toLocaleString("ru")}`,
    );
    expect(russian.translatePlural(QUERIES, 3)).toBe("Запросов: 3");
    expect(russian.translatePlural(QUERIES, 21)).toBe("21 запрос");
  });

  test("a Chinese footer reads in Chinese", () => {
    const chinese: Translator = translatorFor("zh-CN");

    expect(chinese.translatePlural(TOKENS, 10_962)).toBe("10,962 个令牌");
    expect(chinese.translatePlural(QUERIES, 3)).toBe("3 次查询");
    expect(
      chinese.translateTemplate(MODEL, { name: "claude-sonnet-5-5" }),
    ).toBe("模型 claude-sonnet-5-5");
  });
});
