import { describe, expect, test } from "@jest/globals";
import {
  createTranslator,
  DOT_ZERO_INLINE_SEPARATOR,
  formatInline,
  getInlineSeparator,
  INLINE_SEPARATOR,
  Translator,
  writesZeroAsADot,
} from "../../Types/Translator";

/*
 * WHAT STANDS BETWEEN TWO FACTS ON ONE LINE, IN A LANGUAGE WHOSE ZERO IS A DOT.
 *
 * OneUptime sets facts on one line apart with a middle dot: "12 incidents ·
 * 3 alerts", "Uptime · 24 hours". Persian writes its zero as a dot ("۰"),
 * about the middle dot's size and at its height, so beside Persian digits
 * the separator read as a digit: "۱۲ حادثه · ۳ هشدار" looked like "۳ ۰". A
 * language whose zero is a dot takes a bullet there (" • "): in every
 * sentence OneUptime words for a Persian reader - translated, or still
 * English beside Persian digits - and wherever code sets facts apart
 * (getInlineSeparator, formatInline). A value is never touched: a monitor
 * named "API · EU" is named as written. Every other language is as it was.
 */

const LANGUAGES: Array<string> = [
  "en",
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

const UPTIME: string = "Uptime · {{window}}";
const COUNTS: string = "{{incidents}} · {{alerts}}";
const LINES: { one: string; other: string } = {
  one: "Valid {{language}} · {{count}} line",
  other: "Valid {{language}} · {{count}} lines",
};

const PERSIAN_WORDS: Record<string, string> = {
  [UPTIME]: "زمان کارکرد · {{window}}",
  [COUNTS]: "{{incidents}} · {{alerts}}",
  "Drag to zoom · double-click to reset":
    "برای بزرگ‌نمایی بکشید · برای بازنشانی دوبار کلیک کنید",
  [LINES.other]: "{{language}} معتبر · {{count}} خط",
};

const persian: Translator = createTranslator((text: string) => {
  return PERSIAN_WORDS[text];
}, "fa");

const german: Translator = createTranslator((text: string) => {
  return (
    {
      [UPTIME]: "Verfügbarkeit · {{window}}",
    } as Record<string, string>
  )[text];
}, "de");

describe("writesZeroAsADot and getInlineSeparator", () => {
  test("Persian alone, of the product's languages, writes its zero as a dot", () => {
    for (const language of LANGUAGES) {
      expect({ language, isDot: writesZeroAsADot(language) }).toEqual({
        language,
        isDot: language === "fa",
      });
      expect({ language, separator: getInlineSeparator(language) }).toEqual({
        language,
        separator:
          language === "fa" ? DOT_ZERO_INLINE_SEPARATOR : INLINE_SEPARATOR,
      });
    }
  });

  test("the separators: a middle dot, and a bullet where a zero is a dot", () => {
    expect(INLINE_SEPARATOR).toBe(" \u{00B7} ");
    expect(DOT_ZERO_INLINE_SEPARATOR).toBe(" \u{2022} ");
    /*
     * Arabic writes Latin digits in OneUptime, in every region, so its zero
     * is a "0" and takes the middle dot. Arabic-Indic digits, asked for by
     * name, write their zero as a dot ("٠") and take the bullet.
     */
    expect(writesZeroAsADot("ar-EG")).toBe(false);
    expect(writesZeroAsADot("ar-SA")).toBe(false);
    expect(writesZeroAsADot("ar-EG-u-nu-arab")).toBe(true);
    expect(writesZeroAsADot("fa-IR")).toBe(true);
    // A tag Intl cannot read, and none: the middle dot.
    expect(getInlineSeparator("not a language tag!")).toBe(INLINE_SEPARATOR);
    expect(getInlineSeparator(undefined)).toBe(INLINE_SEPARATOR);
  });
});

describe("formatInline", () => {
  test("sets facts apart the reader's way", () => {
    expect(formatInline(["۱۲ حادثه", "۳ هشدار"], persian)).toBe(
      "۱۲ حادثه • ۳ هشدار",
    );
    expect(formatInline(["12 incidents", "3 alerts"], german)).toBe(
      "12 incidents · 3 alerts",
    );
  });
});

describe("a Persian reader's sentences", () => {
  test("a translated sentence's separator is a bullet; its values are as written", () => {
    expect(persian.translateTemplate(UPTIME, { window: "۲۴ ساعت" })).toBe(
      "زمان کارکرد • ۲۴ ساعت",
    );
    expect(
      persian.translateTemplate(COUNTS, {
        incidents: "API · EU",
        alerts: "۳ هشدار",
      }),
    ).toBe("API · EU • ۳ هشدار");
  });

  test("a translated text's separator is a bullet", () => {
    expect(persian.translateText("Drag to zoom · double-click to reset")).toBe(
      "برای بزرگ‌نمایی بکشید • برای بازنشانی دوبار کلیک کنید",
    );
  });

  test("a text with no wording of its own - a value - is as written", () => {
    expect(persian.translateText("API · EU")).toBe("API · EU");
  });

  test("an English sentence beside Persian digits takes the bullet too", () => {
    expect(
      persian.translateTemplate("Checked {{count}} hosts · {{failed}} failed", {
        count: persian.formatNumber(12),
        failed: persian.formatNumber(3),
      }),
    ).toBe("Checked ۱۲ hosts • ۳ failed");
  });

  test("a count-dependent sentence, translated and not", () => {
    expect(persian.translatePlural(LINES, 12, { language: "YAML" })).toBe(
      "YAML معتبر • ۱۲ خط",
    );
    expect(
      persian.translatePlural(
        {
          one: "{{count}} rule · Page {{page}}",
          other: "{{count}} rules · Page {{page}}",
        },
        3,
        { page: persian.formatNumber(2) },
      ),
    ).toBe("۳ rules • Page ۲");
  });

  test("a sentence drawn with its values set apart keeps the bullet outside them", () => {
    const drawn: string = persian.translateTemplate(
      COUNTS,
      { incidents: "12 incidents", alerts: "۳ هشدار" },
      { setsValuesApart: true },
    );

    expect(drawn).toContain(" \u{2022} ");
    expect(drawn).not.toContain(INLINE_SEPARATOR);
  });
});

describe("every other language's sentences are as they were", () => {
  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "fa";
    }),
  )("%s keeps the middle dot", (language: string) => {
    const translator: Translator = createTranslator(undefined, language);

    expect(translator.translateTemplate(UPTIME, { window: "24 hours" })).toBe(
      "Uptime · 24 hours",
    );
    expect(translator.translatePlural(LINES, 12, { language: "YAML" })).toBe(
      `Valid YAML · ${translator.formatNumber(12)} lines`,
    );
  });

  test("a German sentence keeps its own middle dot", () => {
    expect(german.translateTemplate(UPTIME, { window: "24 Stunden" })).toBe(
      "Verfügbarkeit · 24 Stunden",
    );
  });
});
